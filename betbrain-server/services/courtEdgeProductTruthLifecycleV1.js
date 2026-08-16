/**
 * Product Truth lifecycle — one canonical row feeds Home, Results, Lab, History.
 * Read-only mapping plus authentic recovery. Never remints projection/fair/P/Safety/Risk.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadCanonicalPredictionStore,
  getCanonicalRecordsBySlate,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import {
  buildHomeProductTruthSectionsV3,
  BEST_AVAILABLE_DISPLAY_MAX_DEFAULT,
} from "./courtEdgeHomeProductTruthSectionsV3.js";
import { toProductTruthCard } from "./courtEdgeCanonicalPredictionRecordV1.js";
import { admitCanonicalOfficialToResults } from "./courtEdgeOfficialCanonicalAdmitV1.js";
import { addTrackedProps, getTrackedProps } from "./trackedPropService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

export const PRODUCT_TRUTH_LIFECYCLE_BUILD =
  "courteedge-product-truth-lifecycle-v1";

function eraForDate(slateDateCt) {
  const d = String(slateDateCt || "").slice(0, 10);
  if (d === "2026-08-13") return "PRE_V3_INCOMPLETE_STACK";
  if (d >= "2026-08-14") return "PRODUCT_TRUTH_V1_DECISION_ENGINE_V2";
  return "LEGACY";
}

function gradeOf(r) {
  return String(r.result?.grade || r.grade || "").toUpperCase();
}

function wl(rows = []) {
  const g = rows.filter((r) => ["WIN", "LOSS", "PUSH"].includes(gradeOf(r)));
  const W = g.filter((r) => gradeOf(r) === "WIN").length;
  const L = g.filter((r) => gradeOf(r) === "LOSS").length;
  const P = g.filter((r) => gradeOf(r) === "PUSH").length;
  const n = W + L;
  return {
    W,
    L,
    P,
    n: g.length,
    hit: n ? Number((W / n).toFixed(4)) : null,
    record: P ? `${W}-${L}-${P}` : `${W}-${L}`,
  };
}

export function architectureEra(slateDateCt, rows = []) {
  if (String(slateDateCt).slice(0, 10) === "2026-08-13") {
    return "PRE_V3_INCOMPLETE_STACK";
  }
  const hasStack = (rows || []).some(
    (r) => r.projection != null && r.safetyScore != null && r.risk != null
  );
  return hasStack
    ? "PRODUCT_TRUTH_V1_DECISION_ENGINE_V2"
    : eraForDate(slateDateCt);
}

export function summarizeCanonicalSlate(slateDateCt, rows = null) {
  const date = String(slateDateCt || "").slice(0, 10);
  const recs = rows || getCanonicalRecordsBySlate(date);
  const cards = recs.map(toProductTruthCard).filter(Boolean);
  const trusted = cards.filter((c) => c.membership === "OFFICIAL");
  const sections = buildHomeProductTruthSectionsV3({
    trusted,
    full: cards,
    bestAvailableDisplayMax: BEST_AVAILABLE_DISPLAY_MAX_DEFAULT,
  });
  const full = sections.fullPredictions || cards;
  const best = sections.bestAvailable || [];
  const graded = recs.filter((r) => ["WIN", "LOSS", "PUSH"].includes(gradeOf(r)));
  return {
    slateDateCt: date,
    architectureEra: architectureEra(date, recs),
    n: recs.length,
    full: wl(full),
    best: wl(best),
    trusted: wl(trusted),
    fullN: full.length,
    bestN: best.length,
    trustedN: trusted.length,
    gradedN: graded.length,
    fullyGraded: recs.length > 0 && graded.length === recs.length,
    byStat: {
      POINTS: wl(recs.filter((r) => r.propType === "POINTS")),
      REBOUNDS: wl(recs.filter((r) => r.propType === "REBOUNDS")),
      ASSISTS: wl(recs.filter((r) => r.propType === "ASSISTS")),
    },
    bySide: {
      OVER: wl(recs.filter((r) => String(r.side).toUpperCase() === "OVER")),
      UNDER: wl(recs.filter((r) => String(r.side).toUpperCase() === "UNDER")),
    },
    provenance: "CANONICAL_PREDICTIONS_V1",
    build: PRODUCT_TRUTH_LIFECYCLE_BUILD,
  };
}

export function listCanonicalSlateSummaries() {
  const store = loadCanonicalPredictionStore();
  const byDate = {};
  for (const r of store.records || []) {
    const d = String(r.slateDateCt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  }
  return Object.keys(byDate)
    .sort()
    .map((d) => summarizeCanonicalSlate(d, byDate[d]));
}

export function newestFullyGradedProductTruthSlate(options = {}) {
  const exclude = String(options.excludeDate || "").slice(0, 10);
  const summaries = listCanonicalSlateSummaries()
    .filter((s) => s.fullyGraded && s.n > 0 && s.slateDateCt !== exclude)
    .sort((a, b) => a.slateDateCt.localeCompare(b.slateDateCt));
  return summaries.length ? summaries[summaries.length - 1] : null;
}

/**
 * Map one canonical row to a tracked/Lab/History mirror. Frozen fields copied, not recomputed.
 */
export function canonicalRecordToTrackedMirror(record = {}, options = {}) {
  const date = String(record.slateDateCt || options.slateDateCt || "").slice(0, 10);
  const grade = gradeOf(record);
  const official = record.membership === "OFFICIAL";
  const status =
    grade === "WIN"
      ? "win"
      : grade === "LOSS"
        ? "loss"
        : grade === "PUSH"
          ? "push"
          : "pending";
  return {
    canonicalPropId: record.canonicalPropId,
    player: record.playerName,
    playerName: record.playerName,
    playerId: record.playerId,
    team: record.team,
    opponent: record.opponent,
    league: record.league || "WNBA",
    gameId: record.gameId,
    eventId: record.gameId,
    propType: record.propType,
    canonicalPropType: record.propType,
    stat: record.stat || record.propType,
    side: record.side,
    pick: record.side,
    currentEngineSide: record.side,
    line: record.line,
    officialLine: record.sealedLine ?? record.line,
    sealedLine: record.sealedLine ?? record.line,
    projection: record.projection,
    fairLine: record.fairLine,
    predictedProbability: record.predictedProbability,
    modelWinProbability: record.modelWinProbability,
    decisionScoreV2: record.decisionScoreV2,
    officialRankScore: record.officialRankScore,
    confidence: record.confidence,
    safetyScore: record.safetyScore,
    SafetyScore: record.safetyScore,
    risk: record.risk,
    engineSignals: record.engineSignals,
    frozenAt: record.frozenAt,
    membership: record.membership,
    officialSelected: official,
    immutableOfficial: official,
    officialEligible: official,
    trackingType: official ? "OFFICIAL" : "RESEARCH",
    finalDecision: official ? "OFFICIAL" : "RESEARCH",
    officialPropId: record.officialPropId || (official ? record.canonicalPropId : null),
    slateDate: date,
    resultsSlateDate: date,
    cohortSlateDate: date,
    status,
    result: status,
    grade,
    actual: record.result?.actual ?? record.actual ?? null,
    actualStat: record.result?.actual ?? record.actual ?? null,
    gameFinal: Boolean(record.result?.gameFinal),
    productTruthRow: true,
    architectureEra: architectureEra(date, [record]),
    productTruthProvenance:
      options.provenance || "CANONICAL_PREDICTIONS_V1",
    homeStaged: false,
  };
}

export function mergeCanonicalIntoTrackedProps(trackedProps = [], options = {}) {
  const existing = Array.isArray(trackedProps) ? trackedProps : [];
  const seen = new Set(
    existing
      .map((p) => p.canonicalPropId)
      .filter(Boolean)
  );
  const extra = [];
  const store = loadCanonicalPredictionStore();
  for (const r of store.records || []) {
    if (seen.has(r.canonicalPropId)) continue;
    extra.push(canonicalRecordToTrackedMirror(r, options));
    seen.add(r.canonicalPropId);
  }
  return [...existing, ...extra];
}

function compactHistoryArchiveFromCanonical(summary, recs) {
  const trusted = recs.filter((r) => r.membership === "OFFICIAL");
  const research = recs.filter((r) => r.membership !== "OFFICIAL");
  const report = {
    slateDate: summary.slateDateCt,
    status: summary.fullyGraded ? "final" : "partial",
    final: summary.fullyGraded,
    graded: summary.gradedN,
    pending: Math.max(0, summary.n - summary.gradedN),
    wins: summary.full.W,
    losses: summary.full.L,
    pushes: summary.full.P,
    record: summary.full.record,
    sections: {
      A: {
        slateDate: summary.slateDateCt,
        leagues: ["WNBA"],
        wins: summary.full.W,
        losses: summary.full.L,
        pushes: summary.full.P,
        graded: summary.full.n,
        totalOfficialProps: summary.n,
        overallWinRate: summary.full.hit != null ? summary.full.hit * 100 : null,
        pending: Math.max(0, summary.n - summary.gradedN),
        productTruthFull: summary.full,
        productTruthBest: summary.best,
        productTruthTrusted: summary.trusted,
      },
    },
    productTruth: summary,
  };
  return {
    slateDate: summary.slateDateCt,
    phase: "ARCHIVED",
    archivedAt: new Date().toISOString(),
    architectureEra: summary.architectureEra,
    provenance: "RECOVERED_FROM_AUTHENTIC_FROZEN_PRODUCT_TRUTH",
    predictionTimestampUnchanged: true,
    propCount: recs.length,
    officialCount: trusted.length,
    researchCount: research.length,
    leagues: ["WNBA"],
    record: summary.full.record,
    report,
    props: recs.map((r) => canonicalRecordToTrackedMirror(r)),
    _archivePropsOmited: false,
    productTruthCompact: true,
    build: PRODUCT_TRUTH_LIFECYCLE_BUILD,
  };
}

export function listProductTruthHistoryArchives(options = {}) {
  const labDate = String(options.currentLabSlateDate || "").slice(0, 10);
  const today = String(options.today || "").slice(0, 10);
  return listCanonicalSlateSummaries()
    .filter((s) => s.n > 0)
    .filter((s) => s.slateDateCt !== labDate)
    .filter((s) => !today || s.slateDateCt < today)
    .map((s) => {
      const recs = getCanonicalRecordsBySlate(s.slateDateCt);
      return compactHistoryArchiveFromCanonical(s, recs);
    });
}

export function resolveProductTruthLabSlateDate(options = {}) {
  const newest = newestFullyGradedProductTruthSlate({
    excludeDate: options.excludeDate,
  });
  return newest?.slateDateCt || null;
}

/**
 * Disk archives (legacy Official-6) plus compact Product Truth archives.
 * Product Truth compact wins when the disk list stripped props.
 */
export function assembleHistoryArchives(options = {}) {
  const today = String(options.today || "").slice(0, 10);
  const labDate =
    String(options.currentLabSlateDate || "").slice(0, 10) ||
    resolveProductTruthLabSlateDate({ excludeDate: today }) ||
    "";
  const disk = Array.isArray(options.diskArchives) ? options.diskArchives : [];
  const pt = listProductTruthHistoryArchives({
    currentLabSlateDate: labDate,
    today,
  });
  const byDate = new Map();
  for (const a of disk) {
    const d = String(a?.slateDate || "").slice(0, 10);
    if (!d || d === labDate) continue;
    byDate.set(d, a);
  }
  for (const a of pt) {
    const d = String(a?.slateDate || "").slice(0, 10);
    if (!d || d === labDate) continue;
    const existing = byDate.get(d);
    const ptHasProps = Array.isArray(a.props) && a.props.length > 0;
    if (!existing) {
      byDate.set(d, a);
      continue;
    }
    if (existing._archivePropsOmited && ptHasProps) {
      byDate.set(d, a);
      continue;
    }
    if (
      (!Array.isArray(existing.leagues) || !existing.leagues.length) &&
      Array.isArray(a.leagues) &&
      a.leagues.length
    ) {
      byDate.set(d, {
        ...existing,
        leagues: a.leagues,
        architectureEra: existing.architectureEra || a.architectureEra,
        report: existing.report || a.report,
      });
    }
  }
  return [...byDate.values()].sort((a, b) =>
    String(b.slateDate || "").localeCompare(String(a.slateDate || ""))
  );
}

export function attachProductTruthLab(labV2 = {}, options = {}) {
  const summaries = listCanonicalSlateSummaries();
  const pinned = String(options.pinnedSlateDate || "").slice(0, 10);
  const newest = pinned
    ? summaries.find((s) => s.slateDateCt === pinned) || null
    : newestFullyGradedProductTruthSlate({
        excludeDate: options.excludeDate,
      });
  const payload = {
    ...(labV2 || {}),
    productTruthLifecycleBuild: PRODUCT_TRUTH_LIFECYCLE_BUILD,
    productTruthSlates: summaries,
  };
  if (!newest) return payload;

  const recs = getCanonicalRecordsBySlate(newest.slateDateCt);
  const cards = recs.map(toProductTruthCard).filter(Boolean);
  const trusted = cards.filter((c) => c.membership === "OFFICIAL");
  const sections = buildHomeProductTruthSectionsV3({
    trusted,
    full: cards,
  });
  payload.productTruth = {
    ...newest,
    trustedRows: trusted.map((c) => ({
      player: c.player,
      propType: c.propType,
      side: c.side,
      line: c.line,
      grade: c.grade,
      actual: c.actual,
    })),
  };
  if (pinned) {
    payload.slateDate = newest.slateDateCt;
    return overlayLabCurrentFromProductTruth(payload, newest, sections, labV2);
  }
  // Overlay even when Lab V2 already selected this date, so Full/Best/Trusted
  // records are present (Lab V2 otherwise only exposes Official membership).
  const v2Date = String(labV2?.slateDate || labV2?.currentSlate?.slateDate || "");
  if (!v2Date || v2Date <= newest.slateDateCt) {
    return overlayLabCurrentFromProductTruth(payload, newest, sections, labV2);
  }
  return payload;
}

function overlayLabCurrentFromProductTruth(payload, newest, sections, labV2) {
  payload.slateDate = newest.slateDateCt;
  payload.currentSlate = {
    ...(labV2?.currentSlate || {}),
    slateDate: newest.slateDateCt,
    leagueCoverage: ["WNBA"],
    totalProps: newest.n,
    graded: newest.gradedN,
    pending: Math.max(0, newest.n - newest.gradedN),
    wins: newest.full.W,
    losses: newest.full.L,
    pushes: newest.full.P,
    decided: newest.full.n,
    record: newest.full.record,
    winRate: newest.full.hit != null ? Number((newest.full.hit * 100).toFixed(1)) : null,
    winRateMetric: {
      available: newest.full.hit != null,
      value: newest.full.hit != null ? Number((newest.full.hit * 100).toFixed(1)) : null,
      reason: null,
    },
    productTruthFull: newest.full,
    productTruthBest: newest.best,
    productTruthTrusted: newest.trusted,
    architectureEra: newest.architectureEra,
  };
  const fullRows = (sections.fullPredictions || []).map((c, i) => ({
    bestSixRank: i + 1,
    player: c.player,
    league: c.league || "WNBA",
    propType: c.propType,
    finalSide: c.side,
    sealedLine: c.line,
    result: String(c.grade || "").toLowerCase(),
    confidence: c.confidence,
    risk: c.risk,
    projection: c.projection,
    predictedProbability: c.predictedProbability,
    decisionScoreV2: c.decisionScoreV2,
    safetyScore: c.safetyScore,
    actual: c.actual,
    canonicalPropId: c.canonicalPropId,
    membership: c.membership,
    homeMembershipSection: c.homeMembershipSection,
    productTruthRow: true,
  }));
  payload.officialBestSixResults = fullRows.filter(
    (r) => r.membership === "OFFICIAL"
  );
  payload.productTruthFullResults = fullRows;
  payload.productTruthBestResults = (sections.bestAvailable || []).map((c, i) => ({
    bestAvailableRank: i + 1,
    player: c.player,
    propType: c.propType,
    finalSide: c.side,
    sealedLine: c.line,
    result: String(c.grade || "").toLowerCase(),
    canonicalPropId: c.canonicalPropId,
    productTruthRow: true,
  }));
  return payload;
}

/**
 * Admit authentic canonical rows into Results tracked store. Does not remint.
 */
export function recoverCanonicalSlateIntoLifecycle(slateDateCt, options = {}) {
  const date = String(slateDateCt || "").slice(0, 10);
  const recs = getCanonicalRecordsBySlate(date);
  if (!recs.length) {
    return { ok: false, reason: "NO_CANONICAL_ROWS", slateDateCt: date };
  }
  // Persist canonical mirrors first (Full + Trusted on the same row ids).
  // Official admit after that cannot be clobbered by a later research-only write.
  const tracked = getTrackedProps();
  const have = new Set((tracked || []).map((p) => p.canonicalPropId).filter(Boolean));
  const missingMirrors = recs
    .filter((r) => !have.has(r.canonicalPropId))
    .map((r) =>
      canonicalRecordToTrackedMirror(r, {
        provenance: "RECOVERED_FROM_AUTHENTIC_FROZEN_PRODUCT_TRUTH",
      })
    );
  let trackedAdd = null;
  if (missingMirrors.length && options.persistTracked !== false) {
    trackedAdd = addTrackedProps(missingMirrors, {
      preFilteredCohort: true,
      skipTopPickReferences: true,
      allowLockedBestSixBackfill: true,
      forceActiveResultsAdmission: true,
    });
  }
  const officialAdmit =
    recs.some((r) => r.membership === "OFFICIAL")
      ? admitCanonicalOfficialToResults(date, options)
      : { ok: true, skipped: true, officialCount: 0 };
  return {
    ok: true,
    slateDateCt: date,
    canonicalN: recs.length,
    officialAdmit,
    trackedAdded: missingMirrors.length,
    trackedAddNewKeys: missingMirrors.length,
    trackedAddOk: Boolean(trackedAdd),
    summary: summarizeCanonicalSlate(date, recs),
    provenance: "RECOVERED_FROM_AUTHENTIC_FROZEN_PRODUCT_TRUTH",
    mutatedPredictionFields: false,
  };
}

export function writeCompactHistoryArchive(slateDateCt, options = {}) {
  const date = String(slateDateCt || "").slice(0, 10);
  const recs = getCanonicalRecordsBySlate(date);
  if (!recs.length) return { ok: false, reason: "NO_CANONICAL_ROWS" };
  const summary = summarizeCanonicalSlate(date, recs);
  const archive = compactHistoryArchiveFromCanonical(summary, recs);
  const dir = path.join(SERVER_ROOT, "history-archive");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${date}.json`);
  if (fs.existsSync(dest) && options.overwrite !== true) {
    const existingBytes = fs.statSync(dest).size;
    if (existingBytes > 50_000) {
      return {
        ok: true,
        skipped: true,
        reason: "EXISTING_ARCHIVE_PRESERVED",
        dest,
        existingBytes,
      };
    }
  }
  fs.writeFileSync(dest, JSON.stringify(archive, null, 2));
  return { ok: true, dest, propCount: recs.length, summary };
}
