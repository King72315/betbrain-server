/**
 * CourtEdge state reconciler — dry-run first, then safe lifecycle-link repairs only.
 * Never manufactures props, rewrites sealed fields, deletes history, or hardcodes dates.
 */
import {
  STATE_INTEGRITY_BUILD,
  LIFECYCLE,
  buildCanonicalSlateId,
  buildCanonicalSlateRecord,
  loadCanonicalStore,
  saveCanonicalStore,
  upsertCanonicalSlate,
  transitionLifecycle,
  hashDecisionPacket,
  listCanonicalSlates,
  logStateIntegrityEvent,
  getCanonicalSlateDate,
} from "./courtEdgeStateIntegrityV1.js";

export const RECONCILER_VERSION = "courtedge-state-reconciler-v1";

function isResolved(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function officialPropsFromTracked(trackedProps = []) {
  return (trackedProps || []).filter((p) => {
    if (p.immutableOfficial || p.officialPropId) return true;
    if (p.trackingEligibility === "TRACK" || p.finalDecision === "TRACK") return true;
    if (p.controlledBestSixDisplayTracked || p.controlledBestSixDisplay) return true;
    return false;
  });
}

function groupBySlateDate(props = []) {
  const map = new Map();
  for (const p of props) {
    const d = String(p.slateDate || p.resultsSlateDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(p);
  }
  return map;
}

/**
 * Classify a missing/eligible slate without hardcoding dates.
 */
export function classifyMissingSlateAnswer({
  slateDate,
  sealedCohort = null,
  completedCohort = null,
  partialOnly = false,
  identityConflict = false,
} = {}) {
  if (identityConflict) {
    return {
      slateDate,
      answer:
        "Found completed cohort but canonical identity conflict requires report",
      mutate: false,
    };
  }
  if (sealedCohort && (sealedCohort.props || []).length >= 6) {
    return {
      slateDate,
      answer: "Found exact sealed canonical cohort and repaired lifecycle link",
      mutate: true,
      sealedCohort,
    };
  }
  if (completedCohort && (completedCohort.props || []).length >= 6) {
    return {
      slateDate,
      answer: "Found exact sealed canonical cohort and repaired lifecycle link",
      mutate: true,
      completedCohort,
    };
  }
  if (partialOnly) {
    return {
      slateDate,
      answer: "Found partial/nonofficial data only; no mutation performed",
      mutate: false,
    };
  }
  return {
    slateDate,
    answer: "No qualifying canonical record found",
    mutate: false,
  };
}

export function scanStateIntegrity(context = {}) {
  const {
    trackedProps = [],
    board = null,
    archives = [],
    reports = [],
    labDefaultSlateDate = null,
    frozenBlockDates = [],
    storePath,
  } = context;

  const store = loadCanonicalStore(storePath);
  const official = officialPropsFromTracked(trackedProps);
  const byDate = groupBySlateDate(official);
  const findings = [];
  const orphanedSealed = [];
  const completedNotInLab = [];
  const duplicates = [];
  const hashMismatches = [];
  const placeholderDowngrades = [];
  const missingAnswers = [];

  // Board sealed cohorts vs canonical store
  const boardBuckets = [
    {
      key: "bestSixDisplayTodayWNBA",
      league: "WNBA",
      dayBucket: "TODAY",
      slateDate: getCanonicalSlateDate(),
    },
    {
      key: "bestSixDisplayTomorrowWNBA",
      league: "WNBA",
      dayBucket: "TOMORROW",
      slateDate: null,
    },
  ];

  for (const bucket of boardBuckets) {
    const props = board?.[bucket.key] || [];
    if (!props.length) continue;
    const slateDate =
      bucket.slateDate ||
      String(props[0]?.slateDate || props[0]?.resultsSlateDate || "").slice(0, 10) ||
      null;
    if (!slateDate) {
      findings.push({
        type: "board_bucket_missing_slate_date",
        key: bucket.key,
        propCount: props.length,
      });
      continue;
    }
    const slateId = buildCanonicalSlateId({
      league: bucket.league,
      slateDate,
    });
    const canonical = store.slates[slateId];
    const hashes = props.map((p) => hashDecisionPacket(p, { slateDate }));
    if (!canonical) {
      orphanedSealed.push({
        slateId,
        slateDate,
        dayBucket: bucket.dayBucket,
        propCount: props.length,
        hashes,
      });
    } else {
      const cHashes = (canonical.decisionPackets || []).map((p) => p.contentHash);
      const a = [...hashes].sort().join(",");
      const b = [...cHashes].sort().join(",");
      if (a && b && a !== b) {
        hashMismatches.push({ slateId, boardHashes: hashes, canonicalHashes: cHashes });
      }
    }
  }

  // Completed Results not linked to Lab
  for (const [slateDate, props] of byDate.entries()) {
    const graded = props.every((p) => isResolved(p.status || p.result));
    const six = props.length >= 6;
    if (!graded || !six) continue;
    const inLab =
      labDefaultSlateDate === slateDate ||
      (archives || []).some((a) => String(a.slateDate) === slateDate) ||
      (reports || []).some(
        (r) => String(r.slateDate) === slateDate && (r.labReady || r.completed)
      );
    const slateId = buildCanonicalSlateId({
      league: props[0]?.league || "WNBA",
      slateDate,
    });
    const canonical = store.slates[slateId];
    const lifecycle = canonical?.lifecycle;
    if (
      !inLab &&
      lifecycle !== LIFECYCLE.IN_LAB &&
      lifecycle !== LIFECYCLE.IN_HISTORY
    ) {
      completedNotInLab.push({
        slateDate,
        slateId,
        propCount: props.length,
        lifecycle: lifecycle || null,
      });
    }
  }

  // Duplicate semantic slates under different IDs
  const byHash = new Map();
  for (const slate of Object.values(store.slates || {})) {
    const h = slate.slateContentHash;
    if (!h) continue;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(slate.slateId);
  }
  for (const [hash, ids] of byHash.entries()) {
    if (ids.length > 1) {
      duplicates.push({ slateContentHash: hash, slateIds: ids });
    }
  }

  // Frozen blocks referencing missing slates
  for (const date of frozenBlockDates || []) {
    const props = byDate.get(date) || [];
    if (!props.length) {
      findings.push({
        type: "frozen_block_missing_slate",
        slateDate: date,
      });
    }
  }

  // Newest eligible vs Lab default
  const completedDates = [...byDate.entries()]
    .filter(
      ([, props]) =>
        props.length >= 6 && props.every((p) => isResolved(p.status || p.result))
    )
    .map(([d]) => d)
    .sort();
  const newestEligible = completedDates.slice(-1)[0] || null;
  if (
    newestEligible &&
    labDefaultSlateDate &&
    newestEligible > labDefaultSlateDate
  ) {
    findings.push({
      type: "lab_default_lags_newest_eligible",
      labDefaultSlateDate,
      newestEligible,
    });
  }

  // Build missing-slate answers for completedNotInLab (general, not date-hardcoded)
  for (const row of completedNotInLab) {
    const props = byDate.get(row.slateDate) || [];
    const answer = classifyMissingSlateAnswer({
      slateDate: row.slateDate,
      sealedCohort: props.length >= 6 ? { props } : null,
      completedCohort: props.length >= 6 ? { props } : null,
      partialOnly: props.length > 0 && props.length < 6,
    });
    missingAnswers.push(answer);
  }

  return {
    ok: true,
    version: RECONCILER_VERSION,
    buildVersion: STATE_INTEGRITY_BUILD,
    scannedAt: new Date().toISOString(),
    findings,
    orphanedSealed,
    completedNotInLab,
    duplicates,
    hashMismatches,
    placeholderDowngrades,
    missingAnswers,
    newestEligible,
    labDefaultSlateDate,
    canonicalSlateCount: Object.keys(store.slates || {}).length,
  };
}

/**
 * Dry-run then optional apply of lifecycle-link repairs only.
 */
export function reconcileStateIntegrity(context = {}) {
  const dryRun = context.dryRun !== false;
  const scan = scanStateIntegrity(context);
  const repairs = [];

  for (const answer of scan.missingAnswers || []) {
    if (!answer.mutate) {
      repairs.push({
        slateDate: answer.slateDate,
        action: "none",
        answer: answer.answer,
      });
      continue;
    }
    const props =
      answer.sealedCohort?.props || answer.completedCohort?.props || [];
    const league = props[0]?.league || "WNBA";
    const slateId = buildCanonicalSlateId({
      league,
      slateDate: answer.slateDate,
    });
    const record = buildCanonicalSlateRecord({
      league,
      slateDate: answer.slateDate,
      props,
      lifecycle: LIFECYCLE.GRADED_COMPLETE,
      sealedAt:
        props.find((p) => p.sealedAt || p.officialSealedAt)?.sealedAt ||
        props.find((p) => p.officialSealedAt)?.officialSealedAt ||
        null,
      buildVersion: STATE_INTEGRITY_BUILD,
    });

    if (dryRun) {
      repairs.push({
        slateDate: answer.slateDate,
        slateId,
        action: "would_upsert_and_link_lab",
        answer: answer.answer,
        propCount: props.length,
        slateContentHash: record.slateContentHash,
      });
      continue;
    }

    upsertCanonicalSlate(record, {
      source: "reconcileStateIntegrity",
      storePath: context.storePath,
      protectSealedDecisions: true,
    });
    // Advance lifecycle toward Lab when graded complete
    let life = transitionLifecycle(slateId, LIFECYCLE.IN_RESULTS, {
      source: "reconcileStateIntegrity",
      reason: "lifecycle_link_repair",
      idempotencyKey: `recon-in-results-${slateId}`,
      storePath: context.storePath,
    });
    if (life.ok || life.idempotent) {
      life = transitionLifecycle(slateId, LIFECYCLE.GRADED_COMPLETE, {
        source: "reconcileStateIntegrity",
        reason: "lifecycle_link_repair",
        idempotencyKey: `recon-graded-${slateId}`,
        storePath: context.storePath,
      });
    }
    if (life.ok || life.idempotent) {
      life = transitionLifecycle(slateId, LIFECYCLE.IN_LAB, {
        source: "reconcileStateIntegrity",
        reason: "lifecycle_link_repair",
        idempotencyKey: `recon-lab-${slateId}`,
        storePath: context.storePath,
      });
    }
    repairs.push({
      slateDate: answer.slateDate,
      slateId,
      action: "upserted_and_linked_lab",
      answer: answer.answer,
      propCount: props.length,
      transitionOk: life.ok || life.idempotent,
    });
    logStateIntegrityEvent({
      operation: "reconcile_lifecycle_link",
      source: "reconcileStateIntegrity",
      slateId,
      slateDate: answer.slateDate,
      result: "applied",
      reason: answer.answer,
    });
  }

  // Link orphaned board sealed cohorts into canonical store (metadata only)
  for (const orphan of scan.orphanedSealed || []) {
    const props =
      context.board?.[
        orphan.dayBucket === "TOMORROW"
          ? "bestSixDisplayTomorrowWNBA"
          : "bestSixDisplayTodayWNBA"
      ] || [];
    if (!props.length) continue;
    const record = buildCanonicalSlateRecord({
      league: "WNBA",
      slateDate: orphan.slateDate,
      dayBucket: orphan.dayBucket,
      props,
      lifecycle: LIFECYCLE.SEALED,
      buildVersion: STATE_INTEGRITY_BUILD,
    });
    if (dryRun) {
      repairs.push({
        slateId: orphan.slateId,
        action: "would_register_orphaned_sealed",
        propCount: props.length,
      });
    } else {
      upsertCanonicalSlate(record, {
        source: "reconcile_orphan_register",
        storePath: context.storePath,
        protectSealedDecisions: true,
      });
      repairs.push({
        slateId: orphan.slateId,
        action: "registered_orphaned_sealed",
        propCount: props.length,
      });
    }
  }

  return {
    ok: true,
    dryRun,
    version: RECONCILER_VERSION,
    buildVersion: STATE_INTEGRITY_BUILD,
    scan,
    repairs,
    applied: !dryRun,
  };
}

export function explainMissingCompletedSlate(slateDate, context = {}) {
  const scan = scanStateIntegrity(context);
  const hit = (scan.missingAnswers || []).find(
    (a) => a.slateDate === String(slateDate)
  );
  if (hit) return hit;
  const official = officialPropsFromTracked(context.trackedProps || []);
  const props = official.filter(
    (p) => String(p.slateDate || p.resultsSlateDate).slice(0, 10) === String(slateDate)
  );
  return classifyMissingSlateAnswer({
    slateDate,
    sealedCohort: props.length >= 6 ? { props } : null,
    completedCohort:
      props.length >= 6 && props.every((p) => isResolved(p.status || p.result))
        ? { props }
        : null,
    partialOnly: props.length > 0 && props.length < 6,
  });
}
