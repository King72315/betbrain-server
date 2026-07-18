/**
 * CourtEdge Official Slate — immutable Best 6 lifecycle contract.
 *
 * Stages: Home (Tomorrow seal) → Results (grade only) → Lab (learn) → History (read-only).
 * Once sealed, membership/identity never regenerates, replaces, or reorders.
 *
 * Persists under slate-snapshots/{date}.json with officialSeal metadata.
 * Does not delete existing tracked props, Lab, or History.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getLockedSnapshot,
  getLockedSlatesRegistry,
  isSlateLocked,
  lockSlate,
  getHistoryArchiveProps,
  SLATE_PHASE,
} from "./slateLockService.js";
import { getTodayLocalDate } from "./slateScopeService.js";
import { CONTROLLED_BEST_SIX_VERSION } from "../engines/topProps/controlledBestSixSelector.js";
import { buildCompletePregameSnapshot } from "./pregameSnapshotBuilder.js";
import { attachCanonicalSealedProp } from "./canonicalSealedProp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const AUDIT_FILE = path.join(SERVER_ROOT, "lifecycle-integrity-audit.json");

export const OFFICIAL_SLATE_VERSION = "official-slate-immutable-v2";
export const OFFICIAL_SLATE_BUILD_TAG = "courteedge-lifecycle-integrity-v1.1";
export const BEST_SIX_FULL_COUNT = 6;

/** Internal seal status — not a user-facing label. */
export const OFFICIAL_SEAL_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  READY_TO_SEAL: "READY_TO_SEAL",
  SEALED: "SEALED",
});

export const OFFICIAL_LIFECYCLE_STAGE = Object.freeze({
  HOME_TOMORROW: "HOME_TOMORROW",
  RESULTS: "RESULTS",
  LAB: "LAB",
  HISTORY: "HISTORY",
});

const DRAFT_FILE = path.join(SERVER_ROOT, "official-slate-drafts.json");

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

/** Immutable Official Prop ID — stable for Home → Results → Lab → History. */
export function buildOfficialPropId(pick = {}, slateDate = "") {
  const date = String(slateDate || pick.slateDate || "").trim();
  const league = String(pick.league || "WNBA").toUpperCase();
  const player = clean(pick.player);
  const team = clean(pick.team);
  const opponent = clean(pick.opponent);
  const stat = clean(pick.stat || pick.market || "points") || "points";
  const side = normalizeSide(pick.side || pick.pick || pick.lockedSide);
  const line = Number(pick.officialLine ?? pick.line ?? pick.pickLine ?? pick.currentLine);
  const lineKey = Number.isFinite(line) ? String(line) : "na";
  return [
    date,
    league,
    player,
    team,
    opponent,
    stat,
    side,
    lineKey,
  ].join("|");
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Freeze a full learning-ready official prop record at seal time. */
export function freezeOfficialProp(pick = {}, options = {}) {
  const slateDate = String(options.slateDate || pick.slateDate || "");
  const sealedAt = options.sealedAt || new Date().toISOString();

  const pregameSnapshot =
    pick.pregameSnapshot?.sealedAt
      ? pick.pregameSnapshot
      : buildCompletePregameSnapshot(pick, {
          slateDate,
          sealedAt,
          serverBuild: options.serverBuild || pick.serverBuild || OFFICIAL_SLATE_BUILD_TAG,
        });

  const line = num(pregameSnapshot.line ?? pick.officialLine ?? pick.line, 0);
  const side = normalizeSide(pregameSnapshot.side || pick.side || pick.pick);
  const officialPropId =
    pregameSnapshot.officialPropId ||
    pick.officialPropId ||
    buildOfficialPropId({ ...pick, line, side }, slateDate);
  const confidence = pregameSnapshot.confidence ?? pick.confidence ?? pick.winProbability ?? null;
  const projectedPoints =
    pregameSnapshot.projection ??
    pick.projectedPoints ??
    pick.projection ??
    pick.projectedStat ??
    null;
  const di = pick.decisionIntelligence || pregameSnapshot.decisionIntelligence || {};
  const sr = pick.sideRescue || pregameSnapshot.sideRescue || {};
  const flip = pregameSnapshot.flipFirst?.raw || pick.flipFirstDecision || null;
  const profile = pregameSnapshot.playerIntelligenceProfile || pick.playerRoleProfile || null;

  const frozen = {
    ...pick,
    officialPropId,
    officialSlateId: slateDate,
    slateDate,
    resultsSlateDate: slateDate,
    cohortSlateDate: slateDate,
    officialSealVersion: OFFICIAL_SLATE_VERSION,
    officialSealedAt: pick.officialSealedAt || sealedAt,
    immutableOfficial: true,
    slateLocked: true,
    officialLine: pick.officialLine ?? line,
    pickLine: pick.pickLine ?? line,
    lockedSide: pick.lockedSide || side,
    side: side || pick.side || pick.pick,
    pick: side || pick.pick || pick.side,
    line,
    confidence,
    projectedPoints,
    fairLine: pregameSnapshot.fairLine ?? pick.fairLine ?? null,
    projectionEdge: pregameSnapshot.projectionGap ?? pick.projectionEdge ?? pick.edge ?? null,
    bestSixRank: pregameSnapshot.rank ?? pick.bestSixRank ?? pick.controlledBestSixRank ?? null,
    controlledBestSixDisplay: true,
    controlledBestSixDisplayTracked: true,
    finalDecision: "TRACK",
    resultsDecisionLabel: "TRACK",
    trackingEligibility: "TRACK",
    league: String(pick.league || "WNBA").toUpperCase() === "NBA" ? "NBA" : "WNBA",
    trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
    sourcePool: pick.sourcePool || "CONTROLLED_BEST_SIX_DISPLAY",
    controlledBestSixVersion:
      pick.controlledBestSixVersion || CONTROLLED_BEST_SIX_VERSION,
    serverBuild: options.serverBuild || pick.serverBuild || OFFICIAL_SLATE_BUILD_TAG,
    calibrationVersion:
      pick.calibrationVersion ||
      pick.playerIntelligence?.calibrationVersion ||
      options.calibrationVersion ||
      null,
    pregameSnapshot,
    // Legacy sealed aliases (same freeze — do not regenerate later).
    sealedDecisionIntelligence: pick.decisionIntelligence || null,
    sealedSideRescue: pick.sideRescue || null,
    sealedWnbaReader: pick.wnbaReader || null,
    sealedFlipFirst: flip,
    sealedGate:
      pick.wnbaTrackingGate ||
      pick.trackingGate ||
      pick.decisionIntelligence?.gateReason ||
      null,
    sealedPlayerProfile: profile,
    lockedScoreLedger: pick.lockedScoreLedger ?? pick.scoreLedger ?? [],
    lockedSignalSnapshot: pick.lockedSignalSnapshot ?? pick.signalSnapshot ?? null,
    lockedPlayerState: pick.lockedPlayerState ?? pick.playerState ?? null,
    lockedVolumeProfile: pick.lockedVolumeProfile ?? pick.volumeProfile ?? null,
  };

  return attachCanonicalSealedProp(frozen, { slateDate, sealedAt });
}

export function isOfficialSlateSealed(slateDate = "") {
  const date = String(slateDate || "");
  if (!date) return false;
  const snapshot = getLockedSnapshot(date);
  if (snapshot?.officialSeal?.sealed === true) return true;
  if (snapshot?.immutableOfficial === true) return true;
  return false;
}

export function getOfficialSlate(slateDate = "") {
  const date = String(slateDate || "");
  if (!date) return null;
  const snapshot = getLockedSnapshot(date);
  if (!snapshot) return null;
  if (!isOfficialSlateSealed(date) && !isSlateLocked(date)) return null;
  return {
    slateDate: date,
    officialSlateId: date,
    sealed: isOfficialSlateSealed(date) || isSlateLocked(date),
    status: OFFICIAL_SEAL_STATUS.SEALED,
    lifecycleStage:
      snapshot.officialSeal?.lifecycleStage ||
      snapshot.officialSeal?.stage ||
      null,
    sealReason: snapshot.officialSeal?.sealReason || null,
    sealedAt: snapshot.officialSeal?.sealedAt || snapshot.lockedAt || null,
    propCount: Array.isArray(snapshot.props) ? snapshot.props.length : 0,
    props: Array.isArray(snapshot.props) ? snapshot.props : [],
    officialPropIds: (snapshot.props || [])
      .map((p) => p.officialPropId || buildOfficialPropId(p, date))
      .filter(Boolean),
    snapshot,
    version: snapshot.officialSeal?.version || OFFICIAL_SLATE_VERSION,
  };
}

export function getOfficialPropIds(slateDate = "") {
  const slate = getOfficialSlate(slateDate);
  return slate?.officialPropIds || [];
}

/**
 * Pregame generation is closed when the caller says so, or the slate date
 * has already arrived (midnight rollover — too late to wait for more props).
 */
export function isPregameGenerationWindowClosed(options = {}) {
  if (options.generationWindowClosed === true) return true;
  if (options.forceThinSeal === true) return true;
  const slateDate = String(options.slateDate || "").trim();
  const today = String(options.todayLocalDate || getTodayLocalDate()).trim();
  if (slateDate && today && slateDate <= today) return true;
  return false;
}

/**
 * Seal only when Best 6 is full, OR the generation window is closed and a
 * thin board is all that exists (FINAL_THIN_SLATE). Never seal a partial early.
 */
export function evaluateOfficialSealEligibility(propCount = 0, options = {}) {
  const count = Math.max(0, Number(propCount) || 0);
  if (count <= 0) {
    return {
      eligible: false,
      status: OFFICIAL_SEAL_STATUS.DRAFT,
      reason: "EMPTY_BOARD",
      controlledBestSixCount: count,
    };
  }
  if (count >= BEST_SIX_FULL_COUNT) {
    return {
      eligible: true,
      status: OFFICIAL_SEAL_STATUS.READY_TO_SEAL,
      reason: "FULL_BEST_SIX",
      sealReason: "FULL_BEST_SIX",
      controlledBestSixCount: Math.min(count, BEST_SIX_FULL_COUNT),
    };
  }
  if (isPregameGenerationWindowClosed(options)) {
    return {
      eligible: true,
      status: OFFICIAL_SEAL_STATUS.READY_TO_SEAL,
      reason: "FINAL_THIN_SLATE",
      sealReason: "FINAL_THIN_SLATE",
      controlledBestSixCount: count,
    };
  }
  return {
    eligible: false,
    status: OFFICIAL_SEAL_STATUS.DRAFT,
    reason: "PARTIAL_BOARD_AWAITING_FULL_OR_WINDOW_CLOSE",
    controlledBestSixCount: count,
  };
}

function readDraftStore() {
  return readJSON(DRAFT_FILE, { drafts: {}, updatedAt: null });
}

function writeDraftStore(store) {
  writeJSON(DRAFT_FILE, {
    ...store,
    updatedAt: new Date().toISOString(),
    version: OFFICIAL_SLATE_VERSION,
  });
}

export function getOfficialSlateDraft(slateDate = "") {
  const date = String(slateDate || "").trim();
  if (!date) return null;
  const store = readDraftStore();
  return store.drafts?.[date] || null;
}

/**
 * Upsert Tomorrow board as DRAFT / READY_TO_SEAL without locking membership.
 */
export function upsertOfficialSlateDraft(props = [], options = {}) {
  const slateDate = String(options.slateDate || props[0]?.slateDate || "").trim();
  if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
    return { ok: false, message: "Missing or invalid slateDate", slateDate };
  }

  if (isOfficialSlateSealed(slateDate) || isSlateLocked(slateDate)) {
    return {
      ok: true,
      status: OFFICIAL_SEAL_STATUS.SEALED,
      alreadySealed: true,
      slateDate,
      propCount: getOfficialSlate(slateDate)?.propCount || 0,
      message: `Official slate ${slateDate} already sealed — draft ignored`,
    };
  }

  const incoming = (Array.isArray(props) ? props : [])
    .filter((p) => p?.player)
    .sort(
      (a, b) =>
        Number(a.bestSixRank || a.controlledBestSixRank || 99) -
        Number(b.bestSixRank || b.controlledBestSixRank || 99)
    )
    .slice(0, BEST_SIX_FULL_COUNT);

  const eligibility = evaluateOfficialSealEligibility(incoming.length, {
    ...options,
    slateDate,
  });

  const draftProps = incoming.map((pick, index) => ({
    ...pick,
    slateDate,
    bestSixRank: pick.bestSixRank || pick.controlledBestSixRank || index + 1,
    officialPropId:
      pick.officialPropId ||
      buildOfficialPropId(
        {
          ...pick,
          line: pick.officialLine ?? pick.line ?? pick.currentLine,
          side: pick.side || pick.pick || pick.lockedSide,
        },
        slateDate
      ),
  }));

  const store = readDraftStore();
  if (!store.drafts || typeof store.drafts !== "object") store.drafts = {};
  store.drafts[slateDate] = {
    slateDate,
    status: eligibility.status,
    eligibilityReason: eligibility.reason,
    sealReason: eligibility.sealReason || null,
    controlledBestSixCount: draftProps.length,
    props: draftProps,
    updatedAt: new Date().toISOString(),
    serverBuild: options.serverBuild || OFFICIAL_SLATE_BUILD_TAG,
  };
  writeDraftStore(store);

  return {
    ok: true,
    sealed: false,
    status: eligibility.status,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    sealReason: eligibility.sealReason || null,
    slateDate,
    propCount: draftProps.length,
    props: draftProps,
    message: `Official slate ${slateDate} ${eligibility.status} (${draftProps.length}/${BEST_SIX_FULL_COUNT})`,
  };
}

function clearOfficialSlateDraft(slateDate = "") {
  const date = String(slateDate || "").trim();
  if (!date) return;
  const store = readDraftStore();
  if (store.drafts?.[date]) {
    delete store.drafts[date];
    writeDraftStore(store);
  }
}

function writeSnapshotPatch(slateDate, patchFn) {
  const snapPath = path.join(SERVER_ROOT, "slate-snapshots", `${slateDate}.json`);
  const snapshot = getLockedSnapshot(slateDate) || readJSON(snapPath, null);
  if (!snapshot) return null;
  const next = patchFn(snapshot);
  writeJSON(snapPath, next);
  return next;
}

/**
 * Seal Official Slate only when READY_TO_SEAL.
 * Partial boards stay DRAFT — never lock an incomplete Tomorrow board early.
 * If already sealed: return existing — never regenerate membership.
 */
export function sealOfficialSlate(props = [], options = {}) {
  const slateDate = String(options.slateDate || props[0]?.slateDate || "").trim();
  const serverBuild = options.serverBuild || OFFICIAL_SLATE_BUILD_TAG;
  const sealedAt = options.sealedAt || new Date().toISOString();

  if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
    return { ok: false, message: "Missing or invalid slateDate", slateDate };
  }

  if (isOfficialSlateSealed(slateDate) || isSlateLocked(slateDate)) {
    const existing = getOfficialSlate(slateDate);
    return {
      ok: true,
      alreadySealed: true,
      sealed: true,
      status: OFFICIAL_SEAL_STATUS.SEALED,
      slateDate,
      message: `Official slate ${slateDate} already sealed — membership frozen`,
      officialSlate: existing,
      propCount: existing?.propCount || 0,
      officialPropIds: existing?.officialPropIds || [],
    };
  }

  const draftResult = upsertOfficialSlateDraft(props, { ...options, slateDate });
  if (!draftResult.eligible) {
    return {
      ok: true,
      sealed: false,
      status: OFFICIAL_SEAL_STATUS.DRAFT,
      slateDate,
      propCount: draftResult.propCount || 0,
      eligibilityReason: draftResult.eligibilityReason,
      message:
        draftResult.message ||
        `Official slate ${slateDate} remains DRAFT — will not seal partial board`,
      draft: draftResult,
    };
  }

  const incoming = (draftResult.props || []).filter((p) => p?.player);
  if (!incoming.length) {
    return { ok: false, message: `No props to seal for ${slateDate}`, slateDate };
  }

  const sealReason =
    draftResult.sealReason ||
    options.reason ||
    (incoming.length >= BEST_SIX_FULL_COUNT ? "FULL_BEST_SIX" : "FINAL_THIN_SLATE");

  const frozenProps = incoming.map((pick, index) =>
    freezeOfficialProp(
      {
        ...pick,
        bestSixRank: pick.bestSixRank || pick.controlledBestSixRank || index + 1,
        slateDate,
      },
      { slateDate, sealedAt, serverBuild, calibrationVersion: options.calibrationVersion }
    )
  );

  const seen = new Set();
  const unique = [];
  for (const prop of frozenProps) {
    const id = prop.officialPropId;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(prop);
  }

  const lockResult = lockSlate(slateDate, {
    reason: sealReason,
    autoLocked: true,
    allowFutureOfficialSeal: true,
    trackedProps: unique,
    getTrackedProps: () => unique,
    officialSeal: {
      sealed: true,
      status: OFFICIAL_SEAL_STATUS.SEALED,
      sealedAt,
      version: OFFICIAL_SLATE_VERSION,
      buildTag: OFFICIAL_SLATE_BUILD_TAG,
      serverBuild,
      selectorVersion: options.selectorVersion || CONTROLLED_BEST_SIX_VERSION,
      officialPropIds: unique.map((p) => p.officialPropId),
      sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
      sealReason,
      lifecycleStage: OFFICIAL_LIFECYCLE_STAGE.HOME_TOMORROW,
      stage: OFFICIAL_LIFECYCLE_STAGE.HOME_TOMORROW,
    },
  });

  if (!lockResult.ok && !lockResult.alreadyLocked) {
    return {
      ok: false,
      message: lockResult.message || "lockSlate failed",
      slateDate,
      lockResult,
    };
  }

  const snapshot = getLockedSnapshot(slateDate);
  if (snapshot && !snapshot.officialSeal?.sealed) {
    writeSnapshotPatch(slateDate, (snap) => ({
      ...snap,
      immutableOfficial: true,
      officialSeal: {
        sealed: true,
        status: OFFICIAL_SEAL_STATUS.SEALED,
        sealedAt,
        version: OFFICIAL_SLATE_VERSION,
        buildTag: OFFICIAL_SLATE_BUILD_TAG,
        serverBuild,
        selectorVersion: options.selectorVersion || CONTROLLED_BEST_SIX_VERSION,
        officialPropIds: (snap.props || []).map(
          (p) => p.officialPropId || buildOfficialPropId(p, slateDate)
        ),
        sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
        sealReason,
        lifecycleStage: OFFICIAL_LIFECYCLE_STAGE.HOME_TOMORROW,
        stage: OFFICIAL_LIFECYCLE_STAGE.HOME_TOMORROW,
      },
      props: (snap.props || []).map((p) =>
        p.officialPropId
          ? p
          : freezeOfficialProp(p, { slateDate, sealedAt, serverBuild })
      ),
    }));
  }

  clearOfficialSlateDraft(slateDate);

  appendLifecycleAudit({
    type: "OFFICIAL_SLATE_SEALED",
    slateDate,
    propCount: unique.length,
    officialPropIds: unique.map((p) => p.officialPropId),
    reason: sealReason,
    sealedAt,
  });

  return {
    ok: true,
    sealed: true,
    status: OFFICIAL_SEAL_STATUS.SEALED,
    sealReason,
    slateDate,
    propCount: unique.length,
    officialPropIds: unique.map((p) => p.officialPropId),
    props: unique,
    lockResult,
    message: `Official slate ${slateDate} sealed with ${unique.length} immutable props (${sealReason})`,
  };
}

/**
 * Date rollover: sealed Tomorrow slate → Results.
 * Same official slate ID and prop IDs — no reselection, no Today reseal.
 */
export function promoteSealedSlateToResults(slateDate = "", options = {}) {
  const date = String(slateDate || "").trim();
  if (!date) {
    return { ok: false, inherited: false, message: "Missing slateDate" };
  }

  if (!isOfficialSlateSealed(date) && !isSlateLocked(date)) {
    return {
      ok: false,
      inherited: false,
      slateDate: date,
      message: `No sealed Official Slate for ${date} — Today must inherit yesterday's sealed Tomorrow slate, not regenerate`,
    };
  }

  const existing = getOfficialSlate(date);
  const officialPropIds = existing?.officialPropIds || [];
  const promotedAt = options.promotedAt || new Date().toISOString();

  writeSnapshotPatch(date, (snap) => ({
    ...snap,
    immutableOfficial: true,
    officialSeal: {
      ...(snap.officialSeal || {}),
      sealed: true,
      status: OFFICIAL_SEAL_STATUS.SEALED,
      lifecycleStage: OFFICIAL_LIFECYCLE_STAGE.RESULTS,
      stage: OFFICIAL_LIFECYCLE_STAGE.RESULTS,
      promotedToResultsAt:
        snap.officialSeal?.promotedToResultsAt || promotedAt,
      officialPropIds:
        snap.officialSeal?.officialPropIds ||
        officialPropIds ||
        (snap.props || []).map((p) => p.officialPropId || buildOfficialPropId(p, date)),
    },
  }));

  appendLifecycleAudit({
    type: "OFFICIAL_SLATE_PROMOTED_TO_RESULTS",
    slateDate: date,
    propCount: existing?.propCount || 0,
    officialPropIds,
    promotedAt,
  });

  return {
    ok: true,
    inherited: true,
    resealed: false,
    slateDate: date,
    status: OFFICIAL_SEAL_STATUS.SEALED,
    lifecycleStage: OFFICIAL_LIFECYCLE_STAGE.RESULTS,
    propCount: existing?.propCount || 0,
    officialPropIds,
    props: existing?.props || [],
    message: `Official slate ${date} promoted to Results — membership unchanged`,
  };
}

/**
 * Today Results source of truth: sealed slate for today's date only.
 * Never seals from a refreshed Today Best 6 cohort.
 */
export function inheritTodayResultsFromSealedSlate(todayLocalDate = "", options = {}) {
  const today = String(todayLocalDate || getTodayLocalDate()).trim();
  return promoteSealedSlateToResults(today, options);
}

/**
 * Migrate an existing locked/snapshot slate in place: stamp officialPropId,
 * mark sealed, preserve lines/sides/grades/timestamps. Idempotent. No deletes.
 */
export function migrateExistingOfficialSlate(slateDate = "", options = {}) {
  const date = String(slateDate || "").trim();
  if (!date) return { ok: false, message: "Missing slateDate" };

  const snapPath = path.join(SERVER_ROOT, "slate-snapshots", `${date}.json`);
  const snapshot = getLockedSnapshot(date) || readJSON(snapPath, null);
  if (!snapshot || !Array.isArray(snapshot.props) || !snapshot.props.length) {
    return { ok: false, message: `No snapshot props for ${date}`, slateDate: date };
  }

  const sealedAt =
    snapshot.officialSeal?.sealedAt ||
    snapshot.lockedAt ||
    options.sealedAt ||
    new Date().toISOString();

  let stamped = 0;
  const props = snapshot.props.map((p) => {
    const hadId = Boolean(p.officialPropId);
    const next = {
      ...p,
      officialPropId: p.officialPropId || buildOfficialPropId(p, date),
      officialSlateId: date,
      slateDate: p.slateDate || date,
      immutableOfficial: true,
      slateLocked: true,
      officialSealVersion: p.officialSealVersion || OFFICIAL_SLATE_VERSION,
      officialSealedAt: p.officialSealedAt || sealedAt,
      pregameSnapshot:
        p.pregameSnapshot ||
        freezeOfficialProp(p, { slateDate: date, sealedAt }).pregameSnapshot,
    };
    // Preserve graded / postgame fields exactly — never rewrite.
    if (!hadId) stamped += 1;
    return next;
  });

  const alreadyMigrated =
    snapshot.officialSeal?.sealed === true &&
    snapshot.officialSeal?.migrated === true &&
    stamped === 0;

  const enriched = {
    ...snapshot,
    immutableOfficial: true,
    props,
    officialSeal: {
      ...(snapshot.officialSeal || {}),
      sealed: true,
      status: OFFICIAL_SEAL_STATUS.SEALED,
      sealedAt,
      version: OFFICIAL_SLATE_VERSION,
      buildTag: OFFICIAL_SLATE_BUILD_TAG,
      migrated: true,
      migratedAt: snapshot.officialSeal?.migratedAt || new Date().toISOString(),
      officialPropIds: props.map((p) => p.officialPropId),
      sourcePool:
        snapshot.officialSeal?.sourcePool || "CONTROLLED_BEST_SIX_DISPLAY",
      lifecycleStage:
        snapshot.officialSeal?.lifecycleStage ||
        OFFICIAL_LIFECYCLE_STAGE.RESULTS,
      stage:
        snapshot.officialSeal?.stage || OFFICIAL_LIFECYCLE_STAGE.RESULTS,
      sealReason:
        snapshot.officialSeal?.sealReason ||
        options.reason ||
        "EXISTING_DATA_MIGRATION",
    },
  };
  writeJSON(snapPath, enriched);

  // Ensure registry knows the slate is locked (idempotent).
  if (!isSlateLocked(date)) {
    lockSlate(date, {
      reason: "EXISTING_DATA_MIGRATION",
      autoLocked: true,
      allowFutureOfficialSeal: true,
      trackedProps: props,
      getTrackedProps: () => props,
      officialSeal: enriched.officialSeal,
    });
  }

  appendLifecycleAudit({
    type: "OFFICIAL_SLATE_MIGRATED",
    slateDate: date,
    propCount: props.length,
    stampedOfficialPropIds: stamped,
    alreadyMigrated,
  });

  return {
    ok: true,
    slateDate: date,
    propCount: props.length,
    stampedOfficialPropIds: stamped,
    alreadyMigrated,
    officialPropIds: props.map((p) => p.officialPropId),
    message: alreadyMigrated
      ? `Migration idempotent for ${date}`
      : `Migrated ${date} in place (${stamped} IDs stamped)`,
  };
}

/**
 * Continuous lifecycle validation: same 6 IDs / player / line / side / projection / confidence.
 */
export function validateOfficialSlateLifecycle(slateDate = "", options = {}) {
  const date = String(slateDate || "");
  const failures = [];
  const warnings = [];
  const official = getOfficialSlate(date);

  if (!official) {
    return {
      ok: false,
      slateDate: date,
      sealed: false,
      failures: [{ code: "NOT_SEALED", message: `No official sealed slate for ${date}` }],
      warnings,
    };
  }

  const sealedProps = official.props || [];
  const sealedIds = new Set(
    sealedProps.map((p) => p.officialPropId || buildOfficialPropId(p, date))
  );

  if (sealedProps.length < 1) {
    failures.push({ code: "EMPTY_SEAL", message: "Sealed slate has zero props" });
  }

  const tracked = Array.isArray(options.trackedProps) ? options.trackedProps : [];
  const trackedForDate = tracked.filter((p) => String(p.slateDate || "") === date);
  const trackedIds = new Set(
    trackedForDate.map((p) => p.officialPropId || buildOfficialPropId(p, date))
  );

  for (const id of sealedIds) {
    if (!trackedIds.has(id) && trackedForDate.length > 0) {
      // Tracked may be filtered to active-only; warn rather than fail if empty store slice.
      warnings.push({
        code: "TRACKED_MISSING_ID",
        officialPropId: id,
        message: `Sealed prop ${id} not found in provided tracked props`,
      });
    }
  }

  for (const prop of trackedForDate) {
    const id = prop.officialPropId || buildOfficialPropId(prop, date);
    if (sealedIds.size && !sealedIds.has(id) && prop.immutableOfficial !== true) {
      failures.push({
        code: "TRACKED_EXTRA_OR_REPLACED",
        officialPropId: id,
        player: prop.player,
        message: `Tracked prop not in sealed Official Slate membership`,
      });
    }

    const sealed = sealedProps.find(
      (p) => (p.officialPropId || buildOfficialPropId(p, date)) === id
    );
    if (!sealed) continue;

    const checks = [
      ["player", sealed.player, prop.player],
      ["side", normalizeSide(sealed.lockedSide || sealed.side), normalizeSide(prop.lockedSide || prop.side || prop.pick)],
      ["line", num(sealed.officialLine ?? sealed.line), num(prop.officialLine ?? prop.pickLine ?? prop.line)],
    ];
    for (const [field, expected, actual] of checks) {
      if (expected == null || actual == null) continue;
      if (String(expected).toLowerCase() !== String(actual).toLowerCase()) {
        failures.push({
          code: "IDENTITY_MUTATION",
          field,
          officialPropId: id,
          expected,
          actual,
          message: `${field} changed after seal for ${prop.player}`,
        });
      }
    }

    // Projection / confidence should not be regenerated after seal.
    if (
      sealed.confidence != null &&
      prop.confidence != null &&
      Number(sealed.confidence) !== Number(prop.confidence) &&
      options.strictConfidence === true
    ) {
      failures.push({
        code: "CONFIDENCE_REGENERATED",
        officialPropId: id,
        expected: sealed.confidence,
        actual: prop.confidence,
        message: `confidence regenerated after seal for ${prop.player}`,
      });
    }
  }

  const archiveProps = getHistoryArchiveProps(date);
  if (archiveProps.length) {
    const archiveIds = new Set(
      archiveProps.map((p) => p.officialPropId || buildOfficialPropId(p, date))
    );
    for (const id of sealedIds) {
      if (!archiveIds.has(id)) {
        failures.push({
          code: "ARCHIVE_MISSING_ID",
          officialPropId: id,
          message: `History/Lab archive missing sealed prop ${id}`,
        });
      }
    }
  }

  const result = {
    ok: failures.length === 0,
    slateDate: date,
    sealed: true,
    sealedPropCount: sealedProps.length,
    sealedIds: [...sealedIds],
    failures,
    warnings,
    validatedAt: new Date().toISOString(),
  };

  if (failures.length) {
    appendLifecycleAudit({
      type: "LIFECYCLE_INTEGRITY_FAILURE",
      slateDate: date,
      failures,
      warnings,
    });
  }

  return result;
}

export function appendLifecycleAudit(entry = {}) {
  const store = readJSON(AUDIT_FILE, { events: [], updatedAt: null });
  const events = Array.isArray(store.events) ? store.events : [];
  events.push({
    ...entry,
    at: entry.at || new Date().toISOString(),
  });
  // Keep last 500 events
  const trimmed = events.slice(-500);
  writeJSON(AUDIT_FILE, {
    events: trimmed,
    updatedAt: new Date().toISOString(),
    version: OFFICIAL_SLATE_VERSION,
  });
  return { ok: true, count: trimmed.length };
}

export function getLifecycleAudit(limit = 50) {
  const store = readJSON(AUDIT_FILE, { events: [] });
  const events = Array.isArray(store.events) ? store.events : [];
  return {
    ok: true,
    events: events.slice(-Math.max(1, Number(limit) || 50)).reverse(),
    updatedAt: store.updatedAt || null,
  };
}

/** True when a prop belongs to a sealed official slate membership. */
export function isSealedOfficialProp(pick = {}) {
  if (pick.immutableOfficial === true && pick.officialPropId) return true;
  const date = String(pick.slateDate || "");
  if (!date || !isOfficialSlateSealed(date)) return false;
  const ids = new Set(getOfficialPropIds(date));
  const id = pick.officialPropId || buildOfficialPropId(pick, date);
  return ids.has(id);
}

/**
 * Filter / prefer sealed Official Slate props for Results tracking.
 * Returns sealed props when available — never a regenerated Best 6.
 */
export function resolveResultsPropsFromOfficialSlate(slateDate = "", fallbackProps = []) {
  const official = getOfficialSlate(slateDate);
  if (official?.props?.length) {
    return {
      props: official.props.map((p) => ({
        ...p,
        immutableOfficial: true,
        slateLocked: true,
        resultsAdmissionEligible: true,
        controlledBestSixDisplayTracked: true,
      })),
      source: "OFFICIAL_SEALED_SLATE",
      slateDate,
      propCount: official.props.length,
    };
  }
  return {
    props: fallbackProps,
    source: "FALLBACK_COHORT",
    slateDate,
    propCount: fallbackProps.length,
  };
}

/**
 * When Today has no sealed Official slate (inherit failed) but the Today Best 6
 * board still has props and the pregame window is closed, seal that thin/full
 * Today cohort as FINAL_THIN_SLATE so Results do not vanish on refresh/redeploy.
 * Never reseals an already-sealed slate. Does not change Tomorrow seal rules.
 */
export function sealTodayFallbackOfficialSlate(picks = [], options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate()).trim();
  if (!today) {
    return { ok: false, sealed: false, message: "Missing todayLocalDate" };
  }

  if (isOfficialSlateSealed(today) || isSlateLocked(today)) {
    return {
      ok: true,
      alreadySealed: true,
      sealed: true,
      slateDate: today,
      message: `Today ${today} already sealed — fallback skipped`,
    };
  }

  const todayPicks = (Array.isArray(picks) ? picks : [])
    .filter((p) => {
      if (!p?.player) return false;
      const dayBucket = String(p.dayBucket || "").toUpperCase();
      const dateLabel = String(p.dateLabel || "").toLowerCase();
      const slateDate = String(p.slateDate || "").trim();
      return (
        dayBucket === "TODAY" ||
        dateLabel === "today" ||
        slateDate === today ||
        (!dayBucket && !dateLabel && !slateDate)
      );
    })
    .map((p) => ({
      ...p,
      slateDate: today,
      dayBucket: "TODAY",
      dateLabel: p.dateLabel || "Today",
      trackingAdmissionSource:
        p.trackingAdmissionSource || "CONTROLLED_BEST_SIX_DISPLAY",
      sourcePool: p.sourcePool || "CONTROLLED_BEST_SIX_DISPLAY",
      controlledBestSixDisplay: true,
    }));

  if (!todayPicks.length) {
    return {
      ok: true,
      sealed: false,
      slateDate: today,
      reason: "NO_TODAY_PROPS",
      message: `No Today props to seal for ${today}`,
    };
  }

  return sealOfficialSlate(todayPicks, {
    ...options,
    slateDate: today,
    todayLocalDate: today,
    generationWindowClosed: true,
    forceThinSeal: true,
    reason: options.reason || "FINAL_THIN_SLATE_TODAY_FALLBACK",
  });
}

/**
 * Process Tomorrow Best 6 from refresh: upsert DRAFT, seal only when eligible.
 * Partial boards (1–5 while window open) never seal.
 */
export function sealTomorrowOfficialSlates(picks = [], options = {}) {
  const today = options.todayLocalDate || getTodayLocalDate();
  const tomorrowFallback = (() => {
    // Derive CT calendar tomorrow from YYYY-MM-DD today (no DST edge for date-only math).
    const [y, m, d] = String(today)
      .split("-")
      .map((n) => Number(n));
    if (!y || !m || !d) return "";
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  })();
  const byDate = new Map();

  for (const pick of picks || []) {
    const dayBucket = String(pick.dayBucket || "").toUpperCase();
    const dateLabel = String(pick.dateLabel || "").toLowerCase();
    let slateDate = String(pick.slateDate || "").trim();
    const isTomorrow =
      dayBucket === "TOMORROW" ||
      dateLabel === "tomorrow" ||
      (slateDate && slateDate > today);

    if (!isTomorrow) continue;

    // Display Best 6 often carries dayBucket/dateLabel but omits slateDate —
    // without a date the board cannot enter DRAFT/SEALED. Use tomorrow CT.
    if (!slateDate) {
      slateDate = tomorrowFallback;
    }
    if (!slateDate) continue;

    const stamped = { ...pick, slateDate, dayBucket: dayBucket || "TOMORROW" };
    if (!byDate.has(slateDate)) byDate.set(slateDate, []);
    byDate.get(slateDate).push(stamped);
  }

  const results = [];
  for (const [slateDate, datePicks] of byDate.entries()) {
    const ranked = [...datePicks]
      .sort(
        (a, b) =>
          Number(a.bestSixRank || a.controlledBestSixRank || 99) -
          Number(b.bestSixRank || b.controlledBestSixRank || 99)
      )
      .slice(0, BEST_SIX_FULL_COUNT);

    // Always refresh draft; seal only if full six or FINAL_THIN_SLATE.
    const draft = upsertOfficialSlateDraft(ranked, {
      ...options,
      slateDate,
      todayLocalDate: today,
    });

    if (!draft.eligible) {
      results.push({
        ok: true,
        sealed: false,
        status: OFFICIAL_SEAL_STATUS.DRAFT,
        slateDate,
        propCount: draft.propCount,
        eligibilityReason: draft.eligibilityReason,
        message: draft.message,
        draft,
      });
      continue;
    }

    results.push(
      sealOfficialSlate(ranked, {
        ...options,
        slateDate,
        todayLocalDate: today,
        reason: draft.sealReason || options.reason || "FULL_BEST_SIX",
      })
    );
  }

  return {
    ok: true,
    today,
    sealedCount: results.filter((r) => r.sealed || r.alreadySealed).length,
    draftCount: results.filter((r) => r.status === OFFICIAL_SEAL_STATUS.DRAFT)
      .length,
    results,
  };
}

export function listOfficialSealedSlateDates() {
  const registry = getLockedSlatesRegistry();
  const dates = [];
  for (const entry of registry.slates || []) {
    const date = String(entry.slateDate || "");
    if (date && isOfficialSlateSealed(date)) dates.push(date);
  }
  return dates.sort();
}

export function buildOfficialSlateDiagnostics(options = {}) {
  const today = options.todayLocalDate || getTodayLocalDate();
  const dates = listOfficialSealedSlateDates();
  const validations = dates.map((date) =>
    validateOfficialSlateLifecycle(date, {
      trackedProps: options.trackedProps || [],
    })
  );
  return {
    ok: true,
    version: OFFICIAL_SLATE_VERSION,
    buildTag: OFFICIAL_SLATE_BUILD_TAG,
    today,
    sealedSlateDates: dates,
    validations,
    failureCount: validations.reduce((n, v) => n + (v.failures?.length || 0), 0),
    recentAudit: getLifecycleAudit(20),
  };
}
