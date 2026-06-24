import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchFinalPlayerStats,
  evaluateGradingBlock,
  getCachedStatsForPick,
  getPickDate,
  getPickSlateDate,
  gradePointsPick,
  isPickGameStarted,
  isPickLikelyFinished,
  primePickStatsCache,
  resolvePlayerStatForPick,
} from "./resultService.js";

import {
  getHistoryArchiveProps,
  getLockedSlatesRegistry,
  getLockedSnapshot,
  isSlateLocked,
  lockSlate,
  recordBlockedWrite,
} from "./slateLockService.js";
import { isWnbaOfficialEligiblePick, isCourteEdgeWnbaV1Enabled } from "../engines/wnbaOfficialEngine.js";
import {
  applyQualityGateToPick,
  buildTrackingQualityAudit,
  evaluateWnbaTrackingEligibility,
  isWnbaQualityGatePick,
  QUALITY_GATE_VERSION,
} from "../engines/wnba/wnbaResultsQualityGate.js";
import {
  selectControlledBestSixCombined,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";
import {
  filterCompletedDailyReports,
  getBlockingActiveResultsSlateDate,
  getTodayLocalDate,
  isCompletedSlate,
  isFutureSlateDate,
  isOnOrAfterCleanDataCutoff,
} from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Switchable: "ALL_GENERATED_PROPS" (testing) | "OFFICIAL_ONLY" (production). */
export const TRACKING_MODE = "ALL_GENERATED_PROPS";

const TRACKED_FILE = path.join(__dirname, "..", "tracked-props.json");
const BACKUP_FILE = path.join(
  __dirname,
  "..",
  "tracked-props-backup-before-sprint3a.json"
);
const PHASE2_BACKUP_FILE = path.join(
  __dirname,
  "..",
  "tracked-props-backup-before-phase2.json"
);
const DEDUPE_BACKUP_FILE = path.join(
  __dirname,
  "..",
  "tracked-props-backup-before-dedupe-migration.json"
);

const SAFE_LOCKED_UPDATE_FIELDS = new Set([
  "latestLine",
  "currentLine",
  "lineHistory",
  "lineMovement",
  "lastSeenAt",
  "bookCount",
  "marketQuality",
  "lineDelta",
  "lineSpread",
  "consensusLine",
  "overOdds",
  "underOdds",
  "marketIntelligence",
  "status",
  "actualStat",
  "result",
  "resultMargin",
  "margin",
  "gradedAt",
  "resolvedAt",
  "pendingReason",
  "gradingNotes",
  "resolveDebug",
  "currentEngineResult",
  "currentEngineWon",
  "currentEngineMargin",
  "fairLineShadowResult",
  "fairLineShadowWon",
  "fairLineShadowMargin",
  "sideComparison",
  "resultMeta",
  "matchVerified",
  "resultConfidence",
  "matchedDate",
  "matchedGameId",
  "matchedSource",
  "timesSeen",
]);

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureTrackedFile() {
  if (!fs.existsSync(TRACKED_FILE)) {
    writeJSON(TRACKED_FILE, []);
    return;
  }

  const existing = readJSON(TRACKED_FILE, []);

  if (Array.isArray(existing) && existing.length > 0 && !fs.existsSync(BACKUP_FILE)) {
    writeJSON(BACKUP_FILE, existing);
  }
}

ensureTrackedFile();

function backfillTrackedPropPhase2Fields() {
  const tracked = readJSON(TRACKED_FILE, []);
  if (!Array.isArray(tracked) || tracked.length === 0) return tracked;

  if (!fs.existsSync(PHASE2_BACKUP_FILE)) {
    writeJSON(PHASE2_BACKUP_FILE, tracked);
  }

  let changed = false;

  const next = tracked.map((item) => {
    const commenceTime = item.commenceTime || "";
    const slateDate = item.slateDate || getSlateDateCT(commenceTime);
    const gameLabel = item.gameLabel || item.game || "";
    const supportDangerGap = num(item.supportDangerGap ?? item.netEdge);
    const needsSnapshot =
      !item.signalSnapshot ||
      !item.signalSnapshot.last5Signal ||
      item.signalSnapshot.tier !== undefined;

    const patch = {};

    if (!item.slateDate && slateDate) {
      patch.slateDate = slateDate;
      changed = true;
    }

    if (!item.gameLabel && gameLabel) {
      patch.gameLabel = gameLabel;
      changed = true;
    }

    if (item.supportDangerGap === undefined || item.supportDangerGap === null) {
      patch.supportDangerGap = supportDangerGap;
      patch.supportDangerGapBucket = getSupportDangerGapBucket(supportDangerGap);
      changed = true;
    }

    if (needsSnapshot) {
      patch.signalSnapshot = buildSignalSnapshot(item, {
        ...item,
        ...patch,
        supportDangerGap,
      });
      changed = true;
    }

    if (!item.projection && item.fairLine) {
      patch.projection = num(item.fairLine);
      changed = true;
    }

    if (Object.keys(patch).length === 0) return item;

    return { ...item, ...patch };
  });

  if (changed) {
    writeJSON(TRACKED_FILE, next);
  }

  return next;
}

backfillTrackedPropPhase2Fields();

function runDedupeMigration() {
  const tracked = readJSON(TRACKED_FILE, []);
  if (!Array.isArray(tracked) || tracked.length === 0) return;

  const stableIndex = new Map();
  const legacyCollisions = [];

  tracked.forEach((item, index) => {
    const stableKey = getStableTrackedPropKey(item);
    const legacyKey = item.trackedKey || getLegacyTrackedPropKey(item);

    if (stableIndex.has(stableKey)) {
      legacyCollisions.push({
        stableKey,
        keepIndex: stableIndex.get(stableKey),
        dropIndex: index,
        legacyKey,
      });
      return;
    }

    stableIndex.set(stableKey, index);
    if (legacyKey && legacyKey !== stableKey) {
      stableIndex.set(legacyKey, index);
    }
  });

  if (!legacyCollisions.length) return;

  if (!fs.existsSync(DEDUPE_BACKUP_FILE)) {
    writeJSON(DEDUPE_BACKUP_FILE, tracked);
  }

  const merged = [...tracked];
  const dropIndices = new Set();

  for (const collision of legacyCollisions) {
    const keep = merged[collision.keepIndex];
    const drop = merged[collision.dropIndex];
    if (!keep || !drop || dropIndices.has(collision.dropIndex)) continue;

    const keepResolved = isResolvedStatus(keep.status);
    const dropResolved = isResolvedStatus(drop.status);

    if (dropResolved && !keepResolved) {
      merged[collision.keepIndex] = {
        ...drop,
        ...keep,
        trackedKey: getStableTrackedPropKey(keep),
        trackedId: getStableTrackedPropKey(keep),
        status: drop.status,
        actualStat: drop.actualStat,
        result: drop.result,
        resultMargin: drop.resultMargin,
        gradedAt: drop.gradedAt,
        resolvedAt: drop.resolvedAt,
        pendingReason: drop.pendingReason,
        currentEngineResult: drop.currentEngineResult,
        fairLineShadowResult: drop.fairLineShadowResult,
        sideComparison: drop.sideComparison,
      };
    } else {
      merged[collision.keepIndex] = {
        ...drop,
        ...keep,
        trackedKey: getStableTrackedPropKey(keep),
        trackedId: getStableTrackedPropKey(keep),
      };
    }

    dropIndices.add(collision.dropIndex);
  }

  const next = merged.filter((_, index) => !dropIndices.has(index));

  if (next.length !== tracked.length) {
    writeJSON(TRACKED_FILE, next);
    console.log(
      `DEDUPE MIGRATION: merged ${legacyCollisions.length} legacy key collision(s); ${tracked.length} → ${next.length} props`
    );
  }
}

runDedupeMigration();

function getGameDate(pick = {}) {
  const commenceTime = pick.commenceTime || pick.time || "";

  if (commenceTime) {
    return getSlateDateCT(commenceTime);
  }

  const source = pick.gameDate || pick.date || null;

  if (!source) return "";

  const direct = String(source).slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return getSlateDateCT(parsed.toISOString());
}

export function getSlateDateCT(commenceTime) {
  const source = commenceTime || "";

  if (!source) return "";

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}

function passesBaseTrackableGate(pick = {}) {
  if (!pick?.player) return false;
  if (pick.trackingType === "NO_BET" || pick.finalDecision === "NO_BET") return false;
  if (pick.noPlay && pick.trackingType !== "TEST") return false;
  if (pick.isStarted) return false;
  if (pick.trustable === false && pick.trackingType !== "TEST") return false;
  return true;
}

export function isTestTrackingPick(pick = {}) {
  return String(pick.trackingType || pick.recordType || "").toUpperCase() === "TEST";
}

export function isOfficialTrackingPick(pick = {}) {
  const trackingType = String(pick.trackingType || pick.recordType || "").toUpperCase();
  if (trackingType === "OFFICIAL") return true;
  if (trackingType === "TEST" || trackingType === "NO_BET") return false;
  if (pick.excludedFromOfficialRecord === true) return false;
  if (isPreV1ShadowProp(pick)) return false;
  return true;
}

export function isPreV1ShadowProp(pick = {}) {
  if (pick.preV1Shadow === true) return true;
  if (pick.excludedFromV1OfficialRecord === true) return true;
  if (String(pick.shadowLabel || "") === "PRE_V1_LOCKED_PROPS") return true;
  return false;
}

export function labelPreV1ShadowProps(props = [], metadata = {}) {
  const now = new Date().toISOString();
  return props.map((prop) => ({
    ...prop,
    preV1Shadow: true,
    shadowLabel: metadata.shadowLabel || "PRE_V1_LOCKED_PROPS",
    generatedBeforeWnbaV1Engine: true,
    excludedFromV1OfficialRecord: true,
    preV1ArchivedAt: metadata.archivedAt || now,
    preV1ArchiveReason: metadata.archiveReason || "pre_v1_shadow",
    slateLocked: false,
    homeStaged: false,
  }));
}

export function isOfficialResultsProp(pick = {}) {
  if (isPreV1ShadowProp(pick)) return false;
  if (isTestTrackingPick(pick)) return false;
  if (pick.excludedFromOfficialRecord === true) return false;
  return true;
}

export function isOfficialTrackablePick(pick = {}) {
  if (isPreV1ShadowProp(pick)) return false;
  if (!passesBaseTrackableGate(pick)) return false;

  const tier = String(pick.tier || "").toUpperCase();
  if (tier === "LEAN") return false;
  if (tier === "WATCHLIST") return false;

  if (!isWnbaOfficialEligiblePick(pick)) return false;

  return true;
}

export function isTrackablePick(pick = {}) {
  if (!passesBaseTrackableGate(pick)) return false;

  if (isTestTrackingPick(pick)) {
    return true;
  }

  if (TRACKING_MODE === "OFFICIAL_ONLY") {
    return isOfficialTrackablePick(pick);
  }

  if (
    String(pick.league || "").toUpperCase() === "WNBA" &&
    isCourteEdgeWnbaV1Enabled()
  ) {
    if (String(pick.trackingType || "").toUpperCase() === "OFFICIAL") {
      return isOfficialTrackablePick(pick);
    }
    return isOfficialTrackablePick(pick);
  }

  return true;
}

function enrichPickFromGameCard(pick = {}, game = {}) {
  const commenceTime = pick.commenceTime || game.commenceTime || game.time || "";

  return {
    ...pick,
    gameId: game.gameId || game.id,
    game: game.game,
    date: game.date,
    dateLabel: game.dateLabel,
    dayBucket: game.dayBucket || pick.dayBucket || "",
    time: game.time,
    commenceTime,
    minutesUntilStart: game.minutesUntilStart,
    isStarted: Boolean(game.isStarted || pick.isStarted),
    league: game.league || pick.league,
    slateDate: pick.slateDate || getSlateDateCT(commenceTime),
    trackingMode: TRACKING_MODE,
  };
}

export function collectAllGeneratedProps(gameCards = []) {
  const seen = new Map();

  for (const game of gameCards) {
    for (const pick of game.picks || []) {
      const enriched = enrichPickFromGameCard(pick, game);
      if (!isTrackablePick(enriched)) continue;

      const stableKey = getStableTrackedPropKey(enriched);
      const existing = seen.get(stableKey);

      if (!existing) {
        seen.set(stableKey, enriched);
        continue;
      }

      const existingScore = num(existing.pickScore ?? existing.confidence);
      const nextScore = num(enriched.pickScore ?? enriched.confidence);

      if (nextScore > existingScore) {
        seen.set(stableKey, enriched);
      }
    }
  }

  return Array.from(seen.values());
}

export const TRACKING_COHORT_VERSION =
  "results-tracking-cohort-v2-controlled-best-six";
export { QUALITY_GATE_VERSION };

function normalizeTrackingSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function getPickDecision(pick = {}) {
  return String(
    pick.trackingType || pick.recordType || pick.finalDecision || ""
  ).toUpperCase();
}

function hasRequiredTrackingFields(pick = {}) {
  if (!pick?.player) return false;
  if (!pick?.team) return false;
  if (!pick?.opponent) return false;
  const line = pick.line ?? pick.sportsbookLine ?? pick.currentLine;
  if (line === undefined || line === null || line === "") return false;
  return true;
}

function exactCandidateDupeKey(pick = {}) {
  return [
    clean(pick.player),
    clean(pick.team),
    String(pick.line),
    normalizeTrackingSide(pick.side || pick.pick),
    String(pick.league || "").toUpperCase(),
    clean(pick.gameId || pick.game),
  ].join("|");
}

function playerLineConflictKey(pick = {}) {
  return clean(`${pick.player}-${pick.line}-${pick.stat || "points"}`);
}

export function collectAllGeneratedCandidatesFromGames(gameCards = []) {
  const candidates = [];

  for (const game of gameCards) {
    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];

    for (const pick of pool) {
      candidates.push(enrichPickFromGameCard(pick, game));
    }
  }

  return candidates;
}

function getResultsCohortExclusionReason(pick = {}) {
  if (isPreV1ShadowProp(pick)) return "pre_v1_shadow";
  if (pick.isStarted) return "started";
  if (!hasRequiredTrackingFields(pick)) return "missing_data";

  const decision = getPickDecision(pick);
  if (decision === "NO_BET") return "no_bet";
  if (pick.noPlay && decision !== "TEST") return "no_play";
  if (decision !== "OFFICIAL" && decision !== "TEST") return "invalid_decision";
  if (pick.trustable === false && decision !== "TEST") return "not_trustable";

  return null;
}

export function buildResultsTrackingCohort(candidates = [], options = {}) {
  const exactSeen = new Map();
  const playerLineBest = new Map();
  const stableSeen = new Map();
  const cohort = [];
  const trackingAudit = [];

  const audit = {
    trackingCohortVersion: TRACKING_COHORT_VERSION,
    sourcePool: options.sourcePool || "CONTROLLED_BEST_SIX",
    inputCount: candidates.length,
    eligibleCount: 0,
    officialCount: 0,
    testCount: 0,
    noBetCount: 0,
    startedExcludedCount: 0,
    duplicateExcludedCount: 0,
    oppositeSideExcludedCount: 0,
    missingDataExcludedCount: 0,
    invalidDecisionExcludedCount: 0,
    noPlayExcludedCount: 0,
    preV1ShadowExcludedCount: 0,
    notTrustableExcludedCount: 0,
    qualityGateBlockedCount: 0,
    boardOnlyCount: 0,
    shadowOnlyCount: 0,
    qualityGateVersion: QUALITY_GATE_VERSION,
    generatedCandidatesBySlate: {},
    eligibleTrackingCandidatesBySlate: {},
    notTrackedReasonsBySlate: {},
  };

  const bumpSlateCount = (map, slateDate, amount = 1) => {
    const key = String(slateDate || "unknown");
    map[key] = Number(map[key] || 0) + amount;
  };

  const bumpReason = (slateDate, reason) => {
    const slate = String(slateDate || "unknown");
    if (!audit.notTrackedReasonsBySlate[slate]) {
      audit.notTrackedReasonsBySlate[slate] = {};
    }
    audit.notTrackedReasonsBySlate[slate][reason] =
      Number(audit.notTrackedReasonsBySlate[slate][reason] || 0) + 1;
  };

  for (const rawPick of candidates) {
    const pick = enrichPickFromGameCard(rawPick, rawPick);
    const slateDate = pick.slateDate || getSlateDateCT(pick.commenceTime || pick.time);
    pick.slateDate = slateDate;
    bumpSlateCount(audit.generatedCandidatesBySlate, slateDate);

    const decision = getPickDecision(pick);
    const auditEntry = {
      slateDate,
      player: pick.player || "",
      team: pick.team || "",
      opponent: pick.opponent || "",
      line: pick.line,
      side: normalizeTrackingSide(pick.side || pick.pick),
      decision: decision || "UNKNOWN",
      eligibleForResultsTracking: false,
      tracked: false,
      reasonIfNotTracked: null,
    };

    let gatedPick = pick;
    if (isWnbaQualityGatePick(pick)) {
      const gate = evaluateWnbaTrackingEligibility(pick, pick.wnbaDataCard, pick.wnbaReader);
      gatedPick = applyQualityGateToPick(pick, gate);
      auditEntry.trackingEligibility = gate.trackingEligibility;
      auditEntry.qualityGateScore = gate.qualityGateScore;
      auditEntry.qualityGateVersion = gate.qualityGateVersion;
      auditEntry.blockReasons = gate.trackingBlockReasons;
      auditEntry.warnings = gate.trackingWarnings;
      auditEntry.keyMetrics = gate.keyMetrics;
      auditEntry.readerDecision =
        pick.readerDecision || pick.wnbaReader?.decision || decision;
    }

    const exclusionReason = getResultsCohortExclusionReason(gatedPick);
    if (exclusionReason) {
      auditEntry.reasonIfNotTracked = exclusionReason;
      if (exclusionReason === "started") audit.startedExcludedCount += 1;
      else if (exclusionReason === "no_bet") audit.noBetCount += 1;
      else if (exclusionReason === "no_play") audit.noPlayExcludedCount += 1;
      else if (exclusionReason === "missing_data") audit.missingDataExcludedCount += 1;
      else if (exclusionReason === "invalid_decision") audit.invalidDecisionExcludedCount += 1;
      else if (exclusionReason === "not_trustable") audit.notTrustableExcludedCount += 1;
      else if (exclusionReason === "pre_v1_shadow") audit.preV1ShadowExcludedCount += 1;
      bumpReason(slateDate, exclusionReason);
      trackingAudit.push(auditEntry);
      continue;
    }

    if (
      isWnbaQualityGatePick(gatedPick) &&
      gatedPick.trackingEligibility &&
      gatedPick.trackingEligibility !== "TRACK"
    ) {
      const eligibility = gatedPick.trackingEligibility;
      auditEntry.reasonIfNotTracked =
        gatedPick.trackingBlockReasons?.[0] || eligibility.toLowerCase();
      if (eligibility === "NO_BET") audit.qualityGateBlockedCount += 1;
      else if (eligibility === "BOARD_ONLY") audit.boardOnlyCount += 1;
      else if (eligibility === "SHADOW_ONLY") audit.shadowOnlyCount += 1;
      bumpReason(slateDate, auditEntry.reasonIfNotTracked);
      trackingAudit.push(auditEntry);
      continue;
    }

    const dupeKey = exactCandidateDupeKey(gatedPick);
    if (exactSeen.has(dupeKey)) {
      audit.duplicateExcludedCount += 1;
      auditEntry.reasonIfNotTracked = "duplicate";
      bumpReason(slateDate, "duplicate");
      trackingAudit.push(auditEntry);
      continue;
    }

    const plKey = playerLineConflictKey(gatedPick);
    const prior = playerLineBest.get(plKey);
    if (prior) {
      const priorSide = normalizeTrackingSide(prior.side || prior.pick);
      const nextSide = normalizeTrackingSide(gatedPick.side || gatedPick.pick);
      if (priorSide && nextSide && priorSide !== nextSide) {
        audit.oppositeSideExcludedCount += 1;
        auditEntry.reasonIfNotTracked = "opposite_side";
        bumpReason(slateDate, "opposite_side");
        trackingAudit.push(auditEntry);
        continue;
      }
    }

    const stableKey = getStableTrackedPropKey(gatedPick);
    const existingStable = stableSeen.get(stableKey);
    const nextScore = num(gatedPick.pickScore ?? gatedPick.confidence);
    if (existingStable) {
      const existingScore = num(existingStable.pickScore ?? existingStable.confidence);
      if (nextScore <= existingScore) {
        audit.duplicateExcludedCount += 1;
        auditEntry.reasonIfNotTracked = "duplicate_stable_key";
        bumpReason(slateDate, "duplicate_stable_key");
        trackingAudit.push(auditEntry);
        continue;
      }
      const removeIndex = cohort.findIndex(
        (item) => getStableTrackedPropKey(item) === stableKey
      );
      if (removeIndex >= 0) cohort.splice(removeIndex, 1);
    }

    exactSeen.set(dupeKey, gatedPick);
    playerLineBest.set(plKey, gatedPick);

    const normalizedPick = {
      ...gatedPick,
      trackingType: decision,
      recordType: decision,
    };
    if (decision === "TEST") {
      normalizedPick.excludedFromOfficialRecord = true;
    }

    stableSeen.set(stableKey, normalizedPick);
    cohort.push(normalizedPick);
    audit.eligibleCount += 1;
    bumpSlateCount(audit.eligibleTrackingCandidatesBySlate, slateDate);
    if (decision === "TEST") audit.testCount += 1;
    else audit.officialCount += 1;

    auditEntry.eligibleForResultsTracking = true;
    trackingAudit.push(auditEntry);
  }

  audit.trackingAudit = trackingAudit;
  audit.trackingQualityAudit = buildTrackingQualityAudit(candidates, cohort, {
    tracked: options.tracked || [],
    getSlateDate: (item) =>
      item.slateDate || getSlateDateCT(item.commenceTime || item.time),
  });
  return { cohort, audit };
}

export function buildTrackingCohortDiagnostics(
  gameCards = [],
  tracked = [],
  topProps = [],
  options = {}
) {
  const todayLocalDate = options.todayLocalDate || getTodayLocalDate();
  const allCandidates = collectAllGeneratedCandidatesFromGames(gameCards);
  const controlledSelection = selectControlledBestSixCombined(gameCards);
  const bestSixCohort = [
    ...controlledSelection.bestSixWNBA,
    ...controlledSelection.bestSixNBA,
  ];
  const { cohort, audit } = buildResultsTrackingCohort(bestSixCohort, {
    ...options,
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  const trackedKeys = new Set(
    tracked.map((prop) => prop.trackedKey || getStableTrackedPropKey(prop))
  );

  for (const entry of audit.trackingAudit) {
    if (!entry.eligibleForResultsTracking) continue;
    const match = cohort.find(
      (pick) =>
        pick.player === entry.player &&
        String(pick.line) === String(entry.line) &&
        normalizeTrackingSide(pick.side || pick.pick) === entry.side
    );
    if (match) {
      entry.tracked = trackedKeys.has(getStableTrackedPropKey(match));
      if (!entry.tracked) {
        entry.reasonIfNotTracked = "not_yet_persisted";
      }
    }
  }

  const trackedPropsBySlate = {};
  for (const prop of tracked) {
    const slate = String(prop.slateDate || "unknown");
    trackedPropsBySlate[slate] = Number(trackedPropsBySlate[slate] || 0) + 1;
  }

  const topPropsBySlate = {};
  for (const pick of topProps) {
    const slate =
      pick.slateDate || getSlateDateCT(pick.commenceTime || pick.time) || "unknown";
    topPropsBySlate[slate] = Number(topPropsBySlate[slate] || 0) + 1;
  }

  const officialTrackedCount = tracked.filter(isOfficialResultsProp).length;
  const testTrackedCount = tracked.filter(isTestTrackingPick).length;
  const readerOfficialDemotedTrackedCount = tracked.filter(
    (p) => p.readerOfficialDemoted === true
  ).length;
  const readerUncertainTestTrackedCount = tracked.filter(
    (p) =>
      isTestTrackingPick(p) && p.readerOfficialDemoted !== true
  ).length;

  const generatedCandidatesBySlate = {};
  for (const rawPick of allCandidates) {
    const slateDate =
      rawPick.slateDate || getSlateDateCT(rawPick.commenceTime || rawPick.time);
    const key = String(slateDate || "unknown");
    generatedCandidatesBySlate[key] = Number(generatedCandidatesBySlate[key] || 0) + 1;
  }

  const trackingQualityAudit = buildTrackingQualityAudit(allCandidates, cohort, {
    tracked,
    getSlateDate: (item) =>
      item.slateDate || getSlateDateCT(item.commenceTime || item.time),
  });

  return {
    ...audit,
    trackingQualityAudit,
    todayLocalDate,
    activeResultsSlateDate: options.activeResultsSlateDate || todayLocalDate,
    trackedPropsBySlate,
    topPropsSelectedBySlate: topPropsBySlate,
    generatedCandidatesBySlate,
    topPropsAreReferenceOnly: true,
    topPropsDidNotAffectTracking: true,
    topPropsDidNotControlTracking: false,
    trackingControlledByBestSix: true,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    bestSixCountByLeague: controlledSelection.controlledBestSixAudit?.bestSixCountByLeague || {},
    controlledBestSixAudit: controlledSelection.controlledBestSixAudit || null,
    trackingMode: TRACKING_MODE,
    officialTrackedCount,
    testTrackedCount,
    readerOfficialDemotedTrackedCount,
    readerUncertainTestTrackedCount,
    qualityGateVersion: QUALITY_GATE_VERSION,
    qualityGateBlockedCount: audit.qualityGateBlockedCount,
    boardOnlyCount: audit.boardOnlyCount,
    shadowOnlyCount: audit.shadowOnlyCount,
    boardCappedPropCount: collectAllGeneratedProps(gameCards).length,
    fullCandidateCount: allCandidates.length,
    cohortEligibleCount: cohort.length,
    nbaTrackedCount: tracked.filter(
      (p) => String(p.league || "").toUpperCase() === "NBA"
    ).length,
    wnbaTrackedCount: tracked.filter(
      (p) => String(p.league || "").toUpperCase() === "WNBA"
    ).length,
  };
}

export function buildFlowValidationDiagnostics(
  tracked = [],
  picksSnapshot = {}
) {
  const games = picksSnapshot.games || [];
  const generatedProps =
    picksSnapshot.generatedProps || collectAllGeneratedProps(games);
  const topProps = picksSnapshot.topProps || [];
  const league = String(picksSnapshot.league || "").toUpperCase() || null;
  const slateDateFilter = picksSnapshot.slateDate
    ? String(picksSnapshot.slateDate)
    : null;

  const enrichForKey = (pick, game = {}) =>
    enrichPickFromGameCard(pick, {
      commenceTime: pick.commenceTime || pick.time,
      league: pick.league,
      ...game,
    });

  const generatedKeys = new Set(
    generatedProps.map((pick) => getStableTrackedPropKey(pick))
  );
  const topKeys = new Set(
    topProps.map((pick) => getStableTrackedPropKey(enrichForKey(pick)))
  );

  const filterByScope = (prop) => {
    if (league && String(prop.league || "").toUpperCase() !== league) {
      return false;
    }
    if (slateDateFilter && String(prop.slateDate || "") !== slateDateFilter) {
      return false;
    }
    return true;
  };

  const scopedTracked = tracked.filter(filterByScope);
  const scopedGenerated = generatedProps.filter(filterByScope);
  const scopedTop = topProps.filter((pick) => {
    const enriched = enrichForKey(pick);
    return filterByScope(enriched);
  });

  const trackedKeys = new Set(
    scopedTracked.map((prop) => prop.trackedKey || getStableTrackedPropKey(prop))
  );

  const topPropsMissingFromResults = [...topKeys].filter(
    (key) => !trackedKeys.has(key)
  );
  const generatedMissingFromResults = scopedGenerated
    .map((pick) => getStableTrackedPropKey(pick))
    .filter((key) => !trackedKeys.has(key));

  const stableKeyCounts = new Map();
  for (const prop of scopedTracked) {
    const key = prop.trackedKey || getStableTrackedPropKey(prop);
    stableKeyCounts.set(key, (stableKeyCounts.get(key) || 0) + 1);
  }
  const duplicateStableKeys = [...stableKeyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  const boardPropCount = games.reduce(
    (sum, game) => {
      if (league && game.league !== league) return sum;
      return sum + (Array.isArray(game.picks) ? game.picks.length : 0);
    },
    0
  );

  const tierCounts = scopedGenerated.reduce((acc, pick) => {
    const tier = String(pick.tier || "UNKNOWN").toUpperCase();
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  const labReport = picksSnapshot.labReport || null;
  const labPropCount = labReport
    ? Number(
        labReport.sections?.A?.totalOfficialProps ??
          labReport.totalOfficialProps ??
          0
      )
    : null;

  return {
    trackingMode: TRACKING_MODE,
    league,
    slateDate: slateDateFilter,
    generatedPropCount: scopedGenerated.length,
    boardPropCount,
    topPropsCount: scopedTop.length,
    trackedResultsCount: scopedTracked.length,
    duplicateStableKeys: duplicateStableKeys.length,
    duplicateStableKeyDetails: duplicateStableKeys,
    topPropsMissingFromResults: topPropsMissingFromResults.length,
    topPropsMissingKeys: topPropsMissingFromResults,
    generatedMissingFromResults: generatedMissingFromResults.length,
    tierCounts,
    labPropCount,
    resultsMatchGenerated:
      scopedTracked.length >= scopedGenerated.length &&
      generatedMissingFromResults.length === 0,
    resultsMatchTopProps: topPropsMissingFromResults.length === 0,
    labMatchResults:
      labPropCount === null ? null : labPropCount === scopedTracked.length,
    noDuplicates: duplicateStableKeys.length === 0,
  };
}

function normalizeEngineSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "Over";
  if (raw === "UNDER" || raw === "U") return "Under";
  return "";
}

function normalizeFairSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER") return "OVER";
  if (raw === "UNDER") return "UNDER";
  return "NONE";
}

export function getStableTrackedPropKey(pick = {}) {
  const slateDate =
    pick.slateDate ||
    getSlateDateCT(pick.commenceTime || pick.time) ||
    getGameDate(pick);
  const currentEngineSide = normalizeEngineSide(pick.side || pick.pick);

  return [
    slateDate,
    pick.league || "",
    pick.player || "",
    pick.team || "",
    pick.opponent || "",
    pick.stat || "Points",
    currentEngineSide,
  ]
    .map(clean)
    .join("-");
}

function getLegacyTrackedPropKey(pick = {}) {
  const currentEngineSide = normalizeEngineSide(pick.side || pick.pick);
  const line = num(pick.line ?? pick.sportsbookLine);

  return [
    pick.league || "",
    getGameDate(pick),
    pick.player || "",
    pick.team || "",
    pick.opponent || "",
    pick.stat || "Points",
    line,
    currentEngineSide,
  ]
    .map(clean)
    .join("-");
}

export function getTrackedPropKey(pick = {}) {
  return getStableTrackedPropKey(pick);
}

function buildTrackedIndex(tracked = []) {
  const indexByStable = new Map();

  tracked.forEach((item, index) => {
    const stableKey = getStableTrackedPropKey(item);
    indexByStable.set(stableKey, index);

    const legacyKey = item.trackedKey || getLegacyTrackedPropKey(item);
    if (legacyKey && legacyKey !== stableKey) {
      indexByStable.set(legacyKey, index);
    }
  });

  return indexByStable;
}

function getConfidenceBucket(confidence = 0) {
  const c = num(confidence);
  if (c >= 80) return "80+";
  if (c >= 75) return "75-79";
  if (c >= 70) return "70-74";
  if (c >= 65) return "65-69";
  if (c >= 60) return "60-64";
  if (c >= 55) return "55-59";
  return "Under 55";
}

function getMarketQualityBucket(marketQuality = 0) {
  const value = num(marketQuality);
  if (value >= 80) return "80+";
  if (value >= 65) return "65-79";
  if (value >= 50) return "50-64";
  return "Under 50";
}

function getBookCountBucket(bookCount = 0) {
  const value = num(bookCount);
  if (value >= 8) return "8+";
  if (value >= 5) return "5-7";
  if (value >= 3) return "3-4";
  if (value >= 1) return "1-2";
  return "0";
}

function getFairLineEdgeBucket(edge = 0) {
  const value = num(edge);
  const abs = Math.abs(value);
  if (abs >= 4) return "4+";
  if (abs >= 2.5) return "2.5-3.9";
  if (abs >= 1.5) return "1.5-2.4";
  return "Under 1.5";
}

function getSupportDangerGapBucket(gap = 0) {
  const value = num(gap);
  if (value >= 20) return "20+";
  if (value >= 10) return "10-19";
  if (value >= 5) return "5-9";
  return "Under 5";
}

function getProjectionEdgeBucket(projection, line) {
  const proj = num(projection);
  const bookLine = num(line);
  if (!proj || !bookLine) return "not enough data";
  const edge = Math.abs(proj - bookLine);
  if (edge >= 4) return "4+";
  if (edge >= 2.5) return "2.5-3.9";
  if (edge >= 1.5) return "1.5-2.4";
  return "Under 1.5";
}

function sideSupportsValue(side = "", value = 0, line = 0, threshold = 1) {
  const sideNorm = normalizeEngineSide(side);
  if (!sideNorm || !Number.isFinite(value) || !Number.isFinite(line)) {
    return "not enough data";
  }
  if (sideNorm === "Over") {
    if (value > line + threshold) return "supports_side";
    if (value < line - threshold) return "opposes_side";
    return "neutral";
  }
  if (value < line - threshold) return "supports_side";
  if (value > line + threshold) return "opposes_side";
  return "neutral";
}

function textMatches(list = [], pattern) {
  return list.some((item) => pattern.test(String(item || "")));
}

function buildSignalSnapshot(pick = {}, fields = {}) {
  const ps = pick.playerState || {};
  const side = pick.side || pick.pick || fields.currentEngineSide || "";
  const line = num(pick.line ?? pick.sportsbookLine ?? fields.line);
  const supportReasons = [
    ...(pick.support || pick.supportReasons || fields.supportReasons || []),
  ];
  const dangerReasons = [
    ...(pick.resistance || pick.dangerReasons || fields.dangerReasons || []),
  ];
  const warningReasons = [
    ...(pick.warnings || pick.warningReasons || fields.warningReasons || []),
  ];
  const roleChange = pick.roleChange || fields.roleChange || {};
  const projection =
    pick.projection ??
    pick.sportsProjection ??
    ps.sportsProjection ??
    fields.projection ??
    null;
  const supportDangerGap = num(
    pick.supportDangerGap ?? pick.netEdge ?? fields.supportDangerGap ?? fields.netEdge
  );
  const confidence = num(
    pick.confidence ?? pick.winProbability ?? fields.confidence
  );

  let last5Signal = "not enough data";
  const last5Avg = num(pick.last5Average ?? ps.recentPoints);
  if (last5Avg && line) {
    last5Signal = sideSupportsValue(side, last5Avg, line);
  } else if (textMatches(supportReasons, /recent|last 5|last five/i)) {
    last5Signal = "supports_side";
  } else if (textMatches(dangerReasons, /recent|last 5|last five/i)) {
    last5Signal = "opposes_side";
  }

  let seasonAverageSignal = "not enough data";
  const seasonAvg = num(pick.seasonAverage ?? ps.seasonPoints);
  if (seasonAvg && line) {
    seasonAverageSignal = sideSupportsValue(side, seasonAvg, line);
  } else if (textMatches(supportReasons, /season average|season scoring/i)) {
    seasonAverageSignal = "supports_side";
  }

  let h2hSignal = "not enough data";
  const flags = ps.dataAvailabilityFlags || {};
  const matchupAvg = pick.matchupAverage ?? ps.matchupAverage;
  if (matchupAvg !== null && matchupAvg !== undefined && line) {
    h2hSignal = sideSupportsValue(side, num(matchupAvg), line);
  } else if (flags.hasMatchupHistory === false) {
    h2hSignal = "not enough data";
  } else if (textMatches(supportReasons, /h2h|head.to.head|matchup history/i)) {
    h2hSignal = "supports_side";
  } else if (textMatches(dangerReasons, /h2h|head.to.head|matchup history/i)) {
    h2hSignal = "opposes_side";
  }

  let opponentDefenseSignal = "not enough data";
  if (
    textMatches(supportReasons, /opponent|defense|matchup/i) &&
    !textMatches(dangerReasons, /opponent|defense|matchup/i)
  ) {
    opponentDefenseSignal = "supportive";
  } else if (textMatches(dangerReasons, /opponent|defense|matchup/i)) {
    opponentDefenseSignal = "resistance";
  } else if (pick.opponentMatchup?.resistanceSignal) {
    opponentDefenseSignal = String(pick.opponentMatchup.resistanceSignal);
  }

  let usageMinutesSignal = "not enough data";
  const expectedMinutes = num(pick.expectedMinutes ?? fields.expectedMinutes);
  const seasonMinutes = num(ps.seasonMinutes);
  const recentMinutes = num(ps.recentMinutes);
  if (expectedMinutes && seasonMinutes) {
    if (expectedMinutes >= seasonMinutes + 2) usageMinutesSignal = "minutes_up";
    else if (expectedMinutes <= seasonMinutes - 2) usageMinutesSignal = "minutes_down";
    else usageMinutesSignal = "stable";
  } else if (roleChange.recentMinutesTrend) {
    usageMinutesSignal = String(roleChange.recentMinutesTrend).toLowerCase();
  } else if (recentMinutes && seasonMinutes) {
    if (recentMinutes >= seasonMinutes + 2) usageMinutesSignal = "minutes_up";
    else if (recentMinutes <= seasonMinutes - 2) usageMinutesSignal = "minutes_down";
    else usageMinutesSignal = "stable";
  }

  let injuryAvailabilitySignal = "not enough data";
  if (
    textMatches(dangerReasons, /injury|questionable|limited|availability/i) ||
    textMatches(warningReasons, /injury|questionable|limited/i)
  ) {
    injuryAvailabilitySignal = "availability_risk";
  } else if (roleChange.teammateOutBoost) {
    injuryAvailabilitySignal = "teammate_out_boost";
  } else if (textMatches(supportReasons, /minutes are playable|availability/i)) {
    injuryAvailabilitySignal = "clear";
  }

  let homeAwaySignal = "not enough data";
  if (textMatches(supportReasons, /home floor|home game|at home/i)) {
    homeAwaySignal = "home_support";
  } else if (textMatches(dangerReasons, /road|away|travel/i)) {
    homeAwaySignal = "away_risk";
  }

  let restTravelSignal = "not enough data";
  if (textMatches(dangerReasons, /back.to.back|rest|travel|fatigue/i)) {
    restTravelSignal = "rest_travel_risk";
  } else if (textMatches(supportReasons, /rest|fresh/i)) {
    restTravelSignal = "rest_support";
  }

  let paceSignal = "not enough data";
  if (textMatches(supportReasons, /pace|tempo|fast/i)) {
    paceSignal = "pace_support";
  } else if (textMatches(dangerReasons, /slow pace|pace/i)) {
    paceSignal = "pace_risk";
  }

  let marketSignal = "not enough data";
  const bookCount = num(pick.bookCount ?? fields.bookCount);
  const marketQuality = num(pick.marketQuality ?? fields.marketQuality);
  if (bookCount >= 5 && marketQuality >= 65) marketSignal = "strong_market";
  else if (bookCount >= 3 && marketQuality >= 50) marketSignal = "adequate_market";
  else if (bookCount > 0 || marketQuality > 0) marketSignal = "weak_market";

  return {
    last5Signal,
    seasonAverageSignal,
    h2hSignal,
    opponentDefenseSignal,
    usageMinutesSignal,
    injuryAvailabilitySignal,
    homeAwaySignal,
    restTravelSignal,
    paceSignal,
    marketSignal,
    supportDangerGapBucket: getSupportDangerGapBucket(supportDangerGap),
    confidenceBucket: getConfidenceBucket(confidence),
    projectionEdgeBucket: getProjectionEdgeBucket(projection, line),
    tier: pick.tier || fields.tier || "",
    signalStrength: pick.signalStrength || fields.signalStrength || "",
    riskLabel: pick.riskLabel || fields.riskLabel || "",
    fairLineSide: normalizeFairSide(pick.fairLineSide ?? fields.fairLineSide),
    auditSideMatch: Boolean(pick.auditSideMatch ?? fields.auditSideMatch),
  };
}

function getRoleChangeScoreBucket(score = 0) {
  const value = num(score);
  if (value >= 80) return "80+";
  if (value >= 65) return "65-79";
  if (value >= 50) return "50-64";
  return "Under 50";
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function mapPickToTrackedFields(pick = {}) {
  const currentEngineSide = normalizeEngineSide(pick.side || pick.pick);
  const fairLineSide = normalizeFairSide(pick.fairLineSide);
  const commenceTime = pick.commenceTime || pick.time || "";
  const supportScore = num(pick.supportScore);
  const resistanceScore = num(pick.resistanceScore ?? pick.dangerScore);
  const netEdge = num(pick.netEdge ?? pick.gap);
  const ps = pick.playerState || {};
  const projection =
    pick.projection ??
    pick.sportsProjection ??
    ps.sportsProjection ??
    null;

  const baseFields = {
    source: "AUTO_TRACKED",
    league: pick.league || "",
    gameId: pick.gameId || pick.game || "",
    gameLabel: pick.game || pick.gameLabel || "",
    gameDate: getGameDate(pick),
    slateDate: pick.slateDate || getSlateDateCT(commenceTime),
    commenceTime,
    startTimeDisplay: pick.startTimeDisplay || "",
    dayBucket: pick.dayBucket || pick.dateLabel || "",
    player: pick.player || "",
    playerId: pick.playerId || pick.playerState?.playerId || "",
    team: pick.team || "",
    opponent: pick.opponent || "",
    stat: pick.stat || "Points",
    line: num(pick.line ?? pick.sportsbookLine),
    currentEngineSide,
    fairLineSide,
    auditSideMatch: Boolean(pick.auditSideMatch),
    confidence: num(pick.confidence ?? pick.winProbability),
    riskLabel: pick.riskLabel || "",
    tier: pick.tier || "",
    signalStrength: pick.signalStrength || "",
    supportScore,
    resistanceScore,
    netEdge,
    supportDangerGap: num(pick.supportDangerGap ?? netEdge),
    projection: projection !== null ? num(projection) : null,
    last5Average: num(pick.last5Average ?? ps.recentPoints) || null,
    seasonAverage: num(pick.seasonAverage ?? ps.seasonPoints) || null,
    matchupAverage:
      pick.matchupAverage ?? ps.matchupAverage ?? null,
    dataCoverage: num(pick.dataCoverage),
    dataQuality: num(pick.dataQuality),
    evidenceReliability: num(pick.evidenceReliability),
    dangerPressure: num(pick.dangerPressure),
    bookCount: num(pick.bookCount),
    marketQuality: num(pick.marketQuality),
    lineSpread: num(pick.lineSpread),
    overOdds: num(pick.overOdds),
    underOdds: num(pick.underOdds),
    playerState: pick.playerState || null,
    roleChange: pick.roleChange || null,
    dataMode: pick.dataMode || pick.playerState?.dataMode || "",
    fairLine: num(pick.fairLine),
    fairLineEdge: num(pick.fairLineEdge),
    fairLineQuality: num(pick.fairLineQuality),
    fairLineConfidence: num(pick.fairLineConfidence),
    expectedMinutes: num(pick.expectedMinutes),
    expectedFGA: num(pick.expectedFGA),
    expectedFTA: num(pick.expectedFTA),
    pointsPerFGA: num(pick.pointsPerFGA),
    ftPercent: num(pick.ftPercent),
    supportReasons: pick.support || pick.reasons || [],
    dangerReasons: pick.resistance || pick.risks || [],
    warningReasons: pick.warnings || pick.marketWarnings || pick.riskWarnings || [],
    confidenceAdjustmentReasons: pick.confidenceAdjustmentReasons || [],
    tierReasons: pick.tierReasons || [],
    fairLineReasons: pick.fairLineReasons || [],
    fairLineRiskReasons: pick.fairLineRiskReasons || [],
    rank: num(pick.rank),
    pickScore: num(pick.pickScore),
    roleChangeScore: num(pick.roleChange?.roleChangeScore),
    confidenceBucket: getConfidenceBucket(pick.confidence ?? pick.winProbability),
    marketQualityBucket: getMarketQualityBucket(pick.marketQuality),
    bookCountBucket: getBookCountBucket(pick.bookCount),
    fairLineEdgeBucket: getFairLineEdgeBucket(pick.fairLineEdge),
    supportDangerGapBucket: getSupportDangerGapBucket(
      pick.supportDangerGap ?? netEdge
    ),
    roleChangeScoreBucket: getRoleChangeScoreBucket(
      pick.roleChange?.roleChangeScore
    ),
    volumeProfile: pick.volumeProfile || null,
    volumeDangerGates: pick.volumeDangerGates || null,
    marketIntelligence: pick.marketIntelligence || null,
    availabilityGate: pick.availabilityGate || null,
    defenseResult: pick.defenseResult || null,
    defenseScore: num(pick.defenseResult?.defenseScore),
    scoreLedger: pick.scoreLedger || [],
    openingLine: num(pick.openingLine) || null,
    currentLine: num(pick.currentLine) || null,
    lineDelta: num(pick.lineDelta ?? pick.marketIntelligence?.lineDelta) || null,
    consensusLine: num(pick.consensusLine ?? pick.marketIntelligence?.consensusLine) || null,
    trackingType: pick.trackingType || pick.recordType || null,
    recordType: pick.recordType || pick.trackingType || null,
    engineVersion: pick.engineVersion || null,
    generatedAfterV1: pick.generatedAfterV1 ?? null,
    officialEligible: pick.officialEligible ?? null,
    excludedFromOfficialRecord: pick.excludedFromOfficialRecord ?? null,
    testReason: pick.testReason || null,
    testReasons: pick.testReasons || [],
    v1OfficialGatePassed: pick.v1OfficialGatePassed ?? null,
    readerOfficialDemoted: pick.readerOfficialDemoted ?? null,
    officialDemotionReason: pick.officialDemotionReason || null,
    officialEligibilityFailReason: pick.officialEligibilityFailReason || null,
    readerOutcome: pick.readerOutcome || pick.readerDecision || null,
    readerDecision: pick.readerDecision || null,
    trackingReason: pick.trackingReason || null,
    readerConfidence: num(pick.readerConfidence) || null,
    winProbability: num(pick.winProbability) || null,
    finalConfidence: num(pick.finalConfidence ?? pick.confidence) || null,
    confidenceBlendVersion: pick.confidenceBlendVersion || null,
    confidenceBlendFormula: pick.confidenceBlendFormula || null,
    underGap: num(pick.underGap ?? pick.wnbaReader?.underGap) || null,
    underGapFloorUsed: num(pick.underGapFloorUsed ?? pick.wnbaReader?.underGapFloorUsed) || null,
    underGapFloorPassed: pick.underGapFloorPassed ?? pick.wnbaReader?.underGapFloorPassed ?? null,
    limitedDataUnderPenaltyApplied:
      pick.limitedDataUnderPenaltyApplied ??
      pick.wnbaReader?.limitedDataUnderPenaltyApplied ??
      null,
    lineToRecentAvgRatio: num(pick.lineToRecentAvgRatio) || null,
    lineToSeasonAvgRatio: num(pick.lineToSeasonAvgRatio) || null,
    absoluteLineBucket: pick.absoluteLineBucket || null,
    playerContextLineBucket: pick.playerContextLineBucket || null,
    sideSelectionDecision: pick.sideSelectionDecision || null,
    sideSelectionAudit: pick.sideSelectionAudit || null,
    contradictions: pick.contradictions || [],
    noBetReasons: pick.noBetReasons || [],
    sideTrustScore: num(pick.sideTrustScore) || null,
    sideTrustable: pick.sideTrustable ?? null,
  };

  return {
    ...baseFields,
    signalSnapshot: buildSignalSnapshot(pick, baseFields),
  };
}

function buildSideComparison({
  fairLineSide = "NONE",
  currentEngineResult = null,
  fairLineShadowResult = null,
  auditSideMatch = false,
} = {}) {
  if (fairLineSide === "NONE") {
    return "FAIR_NONE";
  }

  if (!currentEngineResult || !fairLineShadowResult) {
    return auditSideMatch ? "MATCH" : null;
  }

  const currentWon = currentEngineResult === "win";
  const fairWon = fairLineShadowResult === "win";
  const currentLost = currentEngineResult === "loss";
  const fairLost = fairLineShadowResult === "loss";

  if (currentWon && fairWon) return "BOTH_WON";
  if (currentLost && fairLost) return "BOTH_LOST";
  if (currentWon && fairLost) return "CURRENT_WON_FAIR_LOST";
  if (currentLost && fairWon) return "FAIR_WON_CURRENT_LOST";

  if (auditSideMatch) return "MATCH";

  return null;
}

function getGradingLine(tracked = {}) {
  if (tracked.officialLine !== undefined && tracked.officialLine !== null) {
    return num(tracked.officialLine);
  }
  return num(tracked.line ?? tracked.pickLine ?? tracked.sportsbookLine);
}

function gradeEngineSide(tracked, statResult, side) {
  const gradingLine = getGradingLine(tracked);

  const graded = gradePointsPick(
    {
      ...tracked,
      side,
      pick: side,
      line: gradingLine,
      officialLine: tracked.officialLine ?? gradingLine,
      league: tracked.league,
      player: tracked.player,
      team: tracked.team,
    },
    statResult
  );

  return {
    result: graded.status,
    won: graded.status === "win",
    margin: num(graded.resultMargin ?? graded.margin),
    actualStat: num(graded.actualStat ?? graded.actualPoints),
    pendingReason: graded.pendingReason || null,
  };
}

function gradeTrackedProp(tracked, statResult, options = {}) {
  if (!statResult) {
    return {
      ...tracked,
      status: "pending",
      pendingReason:
        options.pendingReason ||
        tracked.pendingReason ||
        "No exact game stat match found for pick date and league",
      gradingNotes: options.gradingNotes || tracked.gradingNotes || null,
      matchVerified: options.matchVerified ?? tracked.matchVerified ?? false,
      resultConfidence: options.resultConfidence ?? tracked.resultConfidence ?? null,
      matchedDate: options.matchedDate ?? tracked.matchedDate ?? null,
      matchedGameId: options.matchedGameId ?? tracked.matchedGameId ?? null,
      matchedSource: options.matchedSource ?? tracked.matchedSource ?? null,
      resolveDebug: options.resolveDebug || tracked.resolveDebug || null,
      actualStat: null,
      result: null,
      resultMargin: null,
      sideComparison: buildSideComparison({
        fairLineSide: tracked.fairLineSide,
        auditSideMatch: tracked.auditSideMatch,
      }),
    };
  }

  const current = gradeEngineSide(tracked, statResult, tracked.currentEngineSide);

  let fairShadow = {
    result: null,
    won: false,
    margin: 0,
  };

  if (tracked.fairLineSide === "OVER" || tracked.fairLineSide === "UNDER") {
    const shadowSide =
      tracked.fairLineSide === "OVER" ? "Over" : "Under";
    fairShadow = gradeEngineSide(tracked, statResult, shadowSide);
  }

  const gradedAt = new Date().toISOString();
  const sideComparison = buildSideComparison({
    fairLineSide: tracked.fairLineSide,
    currentEngineResult: current.result,
    fairLineShadowResult: fairShadow.result,
    auditSideMatch: tracked.auditSideMatch,
  });

  return {
    ...tracked,
    status: current.result || "pending",
    actualStat: current.actualStat,
    result: current.actualStat,
    resultMargin: current.margin,
    gradedAt,
    resolvedAt: gradedAt,
    pendingReason: current.pendingReason,
    gradingNotes: options.gradingNotes || null,
    matchVerified: options.matchVerified ?? true,
    resultConfidence: options.resultConfidence || "medium",
    matchedDate: options.matchedDate || tracked.matchedDate || null,
    matchedGameId: options.matchedGameId || tracked.matchedGameId || null,
    matchedSource: options.matchedSource || tracked.matchedSource || null,
    currentEngineResult: current.result,
    currentEngineWon: current.won,
    currentEngineMargin: current.margin,
    fairLineShadowResult: fairShadow.result,
    fairLineShadowWon: fairShadow.won,
    fairLineShadowMargin: fairShadow.margin,
    sideComparison,
  };
}

function appendLineHistory(existing = {}, nextLine = 0) {
  const now = new Date().toISOString();
  const history = Array.isArray(existing.lineHistory) ? [...existing.lineHistory] : [];
  const prevLine = num(existing.latestLine ?? existing.currentLine ?? existing.line);

  if (prevLine && prevLine !== nextLine) {
    history.push({ from: prevLine, to: nextLine, seenAt: now });
  }

  return history.slice(-20);
}

function applySafeLockedMerge(existing = {}, incomingFields = {}) {
  const now = new Date().toISOString();
  const nextLine = num(incomingFields.currentLine ?? incomingFields.line ?? existing.latestLine);
  const patch = {};

  for (const key of SAFE_LOCKED_UPDATE_FIELDS) {
    if (incomingFields[key] !== undefined) {
      patch[key] = incomingFields[key];
    }
  }

  patch.latestLine = nextLine || existing.latestLine || existing.officialLine;
  patch.currentLine = nextLine || existing.currentLine || existing.officialLine;
  patch.lineHistory = appendLineHistory(existing, patch.latestLine);
  patch.lastSeenAt = now;
  patch.timesSeen = num(existing.timesSeen) + 1;

  if (
    incomingFields.lineMovement ||
    (num(existing.officialLine) && patch.latestLine && num(existing.officialLine) !== patch.latestLine)
  ) {
    patch.lineMovement = incomingFields.lineMovement || {
      from: num(existing.officialLine),
      to: patch.latestLine,
      seenAt: now,
    };
  }

  return {
    ...existing,
    ...patch,
    officialLine: existing.officialLine,
    pickLine: existing.pickLine,
    lockedSide: existing.lockedSide,
    currentEngineSide: existing.lockedSide || existing.currentEngineSide,
    lockedScoreLedger: existing.lockedScoreLedger,
    lockedSignalSnapshot: existing.lockedSignalSnapshot,
    lockedPlayerState: existing.lockedPlayerState,
    lockedVolumeProfile: existing.lockedVolumeProfile,
    slateLocked: true,
  };
}

function resolveInitialOfficialLine(existing = null, fields = {}) {
  if (existing?.officialLine !== undefined && existing?.officialLine !== null) {
    return num(existing.officialLine);
  }

  const incomingLine = num(fields.currentLine ?? fields.line);
  const fallback = incomingLine ||
    num(existing?.line ?? existing?.currentLine ?? existing?.latestLine ?? existing?.pickLine);

  return fallback || null;
}

function normalizeTrackedProp(pick = {}, existing = null) {
  const now = new Date().toISOString();
  const fields = mapPickToTrackedFields(pick);
  const trackedKey = getStableTrackedPropKey(pick);
  const slateDate = fields.slateDate || existing?.slateDate || "";
  const locked =
    existing?.slateLocked === true || (slateDate && isSlateLocked(slateDate));

  if (locked && existing) {
    return applySafeLockedMerge(existing, fields);
  }

  const incomingLine = num(fields.currentLine ?? fields.line);
  const officialLine = resolveInitialOfficialLine(existing, fields);
  const pickLine =
    existing?.pickLine !== undefined && existing?.pickLine !== null
      ? num(existing.pickLine)
      : officialLine ?? incomingLine ?? null;
  const lockedSide =
    existing?.lockedSide || fields.currentEngineSide || existing?.currentEngineSide || "";
  const previousLatest =
    existing?.latestLine ?? existing?.currentLine ?? existing?.line ?? null;

  return {
    ...existing,
    ...fields,
    trackedId: existing?.trackedId || trackedKey,
    trackedKey,
    trackingMode: pick.trackingMode || existing?.trackingMode || TRACKING_MODE,
    officialLine,
    pickLine,
    line: officialLine,
    lockedSide,
    currentEngineSide: lockedSide || fields.currentEngineSide,
    latestLine: incomingLine || existing?.latestLine || officialLine,
    currentLine: incomingLine || existing?.currentLine || officialLine,
    lineHistory: appendLineHistory(existing || {}, incomingLine),
    lineMovement:
      previousLatest !== null && num(previousLatest) !== incomingLine
        ? {
            from: num(previousLatest),
            to: incomingLine,
            seenAt: now,
          }
        : existing?.lineMovement || null,
    generatedAt: existing?.generatedAt || now,
    lastSeenAt: now,
    timesSeen: existing ? num(existing.timesSeen) + 1 : 1,
    status: existing?.status || "pending",
    actualStat: existing?.actualStat ?? null,
    result: existing?.result ?? null,
    resultMargin: existing?.resultMargin ?? null,
    gradedAt: existing?.gradedAt ?? null,
    pendingReason: existing?.pendingReason ?? null,
    currentEngineResult: existing?.currentEngineResult ?? null,
    currentEngineWon: existing?.currentEngineWon ?? null,
    currentEngineMargin: existing?.currentEngineMargin ?? null,
    fairLineShadowResult: existing?.fairLineShadowResult ?? null,
    fairLineShadowWon: existing?.fairLineShadowWon ?? null,
    fairLineShadowMargin: existing?.fairLineShadowMargin ?? null,
    sideComparison:
      existing?.sideComparison ??
      buildSideComparison({
        fairLineSide: fields.fairLineSide,
        auditSideMatch: fields.auditSideMatch,
      }),
  };
}

function countPropsForSlate(tracked = [], slateDate = "") {
  return tracked.filter((item) => String(item.slateDate || "") === slateDate).length;
}

function maybeAutoLockTodaySlate(working = [], audit = {}) {
  const today = getTodayLocalDate();
  if (!today || isSlateLocked(today)) {
    return null;
  }

  const lockedSlates = getLockedSlatesRegistry().slates || [];
  const blockingSlate = getBlockingActiveResultsSlateDate(
    working,
    lockedSlates,
    [],
    today
  );
  if (blockingSlate && blockingSlate !== today) {
    audit.autoLockBlocked = true;
    audit.autoLockBlockedBy = blockingSlate;
    return null;
  }

  const todayPropCount = working.filter(
    (item) =>
      String(item.slateDate || "") === today &&
      isOfficialResultsProp(item) &&
      isOfficialTrackablePick(item)
  ).length;
  if (todayPropCount === 0) {
    return null;
  }

  const lockResult = lockSlate(today, {
    reason: "auto_results_track",
    autoLocked: true,
    trackedProps: working,
  });

  if (!lockResult.ok) {
    return lockResult;
  }

  for (let i = 0; i < working.length; i += 1) {
    if (String(working[i].slateDate || "") === today && working[i].homeStaged) {
      working[i] = { ...working[i], homeStaged: false };
    }
  }

  audit.autoLocked = true;
  audit.autoLockSlateDate = today;
  audit.autoLockPropCount = lockResult.snapshot?.propCount ?? 0;

  return lockResult;
}


export function addTrackedProps(picks = [], options = {}) {
  const skipTopPickReferences = Boolean(options.skipTopPickReferences);
  const preFilteredCohort = Boolean(options.preFilteredCohort);
  const incoming = (Array.isArray(picks) ? picks : [picks]).filter((pick) => {
    if (preFilteredCohort) {
      if (!pick?.player) return false;
    } else if (!isTrackablePick(pick)) {
      return false;
    }
    if (skipTopPickReferences && pick.isTopPickReference) return false;
    return true;
  });
  const tracked = readJSON(TRACKED_FILE, []);
  const indexByStable = buildTrackedIndex(tracked);
  const blockedSlates = new Set();
  const audit = {
    blockedSlates: [],
    blockedNewKeys: 0,
    safeUpdates: 0,
    newKeys: 0,
  };

  const lockedSlateCounts = new Map();
  const lockedSlates = getLockedSlatesRegistry().slates || [];
  const blockingSlate = getBlockingActiveResultsSlateDate(
    tracked,
    lockedSlates,
    [],
    getTodayLocalDate()
  );

  for (const item of tracked) {
    const slateDate = String(item.slateDate || "");
    if (!slateDate) continue;
    if (isSlateLocked(slateDate) || getHistoryArchiveProps(slateDate).length) {
      lockedSlateCounts.set(
        slateDate,
        (lockedSlateCounts.get(slateDate) || 0) + 1
      );
    }
  }

  const working = [...tracked];

  for (const pick of incoming) {
    if (!pick?.player) continue;

    const stableKey = getStableTrackedPropKey(pick);
    const legacyKey = getLegacyTrackedPropKey(pick);
    const fields = mapPickToTrackedFields(pick);
    const slateDate = String(fields.slateDate || "");
    const slateLocked =
      slateDate &&
      (isSlateLocked(slateDate) || getHistoryArchiveProps(slateDate).length > 0);

    if (slateLocked && blockedSlates.has(slateDate)) {
      continue;
    }

    const existingIndex =
      indexByStable.get(stableKey) ?? indexByStable.get(legacyKey);

    if (slateLocked && existingIndex === undefined) {
      audit.blockedNewKeys += 1;
      continue;
    }

    if (existingIndex !== undefined) {
      const existing = working[existingIndex];
      working[existingIndex] = normalizeTrackedProp(pick, existing);
      indexByStable.set(stableKey, existingIndex);
      if (legacyKey !== stableKey) {
        indexByStable.set(legacyKey, existingIndex);
      }
      if (slateLocked) audit.safeUpdates += 1;
    } else {
      const normalized = normalizeTrackedProp(pick);
      if (
        blockingSlate &&
        slateDate &&
        slateDate !== blockingSlate &&
        !isSlateLocked(slateDate)
      ) {
        normalized.homeStaged = true;
        audit.homeStagedKeys = (audit.homeStagedKeys || 0) + 1;
      }
      const fallbackLine = num(
        normalized.line ??
          normalized.currentLine ??
          normalized.latestLine ??
          normalized.pickLine
      );
      if (
        (normalized.officialLine === undefined || normalized.officialLine === null) &&
        fallbackLine
      ) {
        normalized.officialLine = fallbackLine;
      }
      const firstLine = num(normalized.officialLine ?? fallbackLine);
      normalized.pickLine = normalized.pickLine ?? firstLine;
      normalized.lockedSide =
        normalized.lockedSide || normalized.currentEngineSide || "";
      normalized.line = firstLine || normalized.line;
      normalized.latestLine = firstLine || normalized.latestLine;
      normalized.currentLine = firstLine || normalized.currentLine;
      normalized.timesSeen = 1;
      indexByStable.set(stableKey, working.length);
      if (legacyKey !== stableKey) {
        indexByStable.set(legacyKey, working.length);
      }
      working.push(normalized);
      audit.newKeys += 1;
    }
  }

  for (const [slateDate, beforeCount] of lockedSlateCounts.entries()) {
    const afterCount = countPropsForSlate(working, slateDate);
    if (afterCount < beforeCount) {
      blockedSlates.add(slateDate);
      audit.blockedSlates.push({
        slateDate,
        beforeCount,
        afterCount,
        reason: "shrink_guard",
      });

      const snapshot = getLockedSnapshot(slateDate);
      const archiveProps = getHistoryArchiveProps(slateDate);
      const snapshotProps = snapshot?.props?.length ? snapshot.props : archiveProps;
      if (snapshotProps.length) {
        const snapshotKeys = new Set(
          snapshotProps.map((p) => p.trackedKey || p.trackedId)
        );
        for (let i = working.length - 1; i >= 0; i -= 1) {
          const item = working[i];
          if (String(item.slateDate || "") !== slateDate) continue;
          const key = item.trackedKey || item.trackedId;
          if (!snapshotKeys.has(key)) {
            working.splice(i, 1);
          }
        }
      }
    }
  }

  if (audit.blockedSlates.length > 0) {
    recordBlockedWrite({
      type: "shrink_guard",
      ...audit,
    });
  }

  writeJSON(TRACKED_FILE, working);

  const autoLock = maybeAutoLockTodaySlate(working, audit);
  if (autoLock?.ok && autoLock.snapshot?.props?.length) {
    return applySlateLockFreeze(
      autoLock.slateDate,
      autoLock.snapshot.props
    );
  }

  return working;
}

export function applySlateLockFreeze(slateDate, frozenProps = []) {
  const date = String(slateDate || "");
  if (!date || !frozenProps.length) return getTrackedProps();

  const tracked = readJSON(TRACKED_FILE, []);
  const frozenByKey = new Map(
    frozenProps.map((prop) => [prop.trackedKey || prop.trackedId, prop])
  );

  const next = tracked.map((item) => {
    if (String(item.slateDate || "") !== date) return item;
    const key = item.trackedKey || item.trackedId;
    const frozen = frozenByKey.get(key);
    return frozen ? { ...item, ...frozen, slateLocked: true } : item;
  });

  writeJSON(TRACKED_FILE, next);
  return next;
}

export function getTrackedPropsForSlate(slateDate) {
  const date = String(slateDate || "");
  if (date && isSlateLocked(date)) {
    const snapshot = getLockedSnapshot(date);
    if (snapshot?.props?.length) {
      return snapshot.props;
    }
  }

  const archiveProps = getHistoryArchiveProps(date);
  if (archiveProps.length) {
    return archiveProps;
  }

  return getTrackedProps().filter((prop) => String(prop.slateDate || "") === date);
}

export function getTrackedProps() {
  return readJSON(TRACKED_FILE, []);
}

/** Replace all tracked props for one slate date; returns full merged list. */
export function replaceTrackedPropsForSlate(slateDate, nextSlateProps = []) {
  const date = String(slateDate || "");
  const tracked = readJSON(TRACKED_FILE, []);
  const preserved = tracked.filter(
    (prop) => String(prop.slateDate || "") !== date
  );
  const merged = [...preserved, ...(Array.isArray(nextSlateProps) ? nextSlateProps : [])];
  writeJSON(TRACKED_FILE, merged);
  return merged;
}

/** Props eligible for Lab/History analytics — completed slates only, never active/future/pre-cutoff. */
export function getAnalyticsScopeProps(
  trackedProps = getTrackedProps(),
  reports = [],
  archives = []
) {
  const today = getTodayLocalDate();
  const completedDates = new Set(
    filterCompletedDailyReports(reports, today).map((report) =>
      String(report.slateDate)
    )
  );

  for (const archive of archives || []) {
    const slateDate = String(archive?.slateDate || "");
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (isFutureSlateDate(slateDate, today)) continue;
    if (completedDates.has(slateDate)) continue;

    const archiveReport = archive.report;
    if (archiveReport && isCompletedSlate(archiveReport)) {
      completedDates.add(slateDate);
    }
  }

  const scoped = [];

  for (const slateDate of completedDates) {
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;

    const archive = archives.find((item) => String(item?.slateDate) === slateDate);
    if (archive?.props?.length) {
      scoped.push(...archive.props);
      continue;
    }

    scoped.push(
      ...trackedProps.filter((prop) => {
        const propDate = String(prop.slateDate || getPickSlateDate(prop) || "");
        return propDate === slateDate;
      })
    );
  }

  return scoped;
}

/** Backfill officialLine from line/currentLine/latestLine when null — never overwrites existing. */
export function backfillOfficialLines() {
  const tracked = readJSON(TRACKED_FILE, []);
  let updated = 0;

  const next = tracked.map((prop) => {
    if (prop.officialLine !== undefined && prop.officialLine !== null) {
      return prop;
    }

    const fallback = num(prop.line ?? prop.currentLine ?? prop.latestLine ?? prop.pickLine);
    if (!fallback) return prop;

    updated += 1;
    return {
      ...prop,
      officialLine: fallback,
      line: prop.line ?? fallback,
      pickLine: prop.pickLine ?? fallback,
      latestLine: prop.latestLine ?? fallback,
      currentLine: prop.currentLine ?? fallback,
    };
  });

  if (updated) {
    writeJSON(TRACKED_FILE, next);
  }

  return {
    ok: true,
    updated,
    total: next.length,
    officialLineNullCount: next.filter(
      (prop) => prop.officialLine === undefined || prop.officialLine === null
    ).length,
  };
}

export function deleteTrackedProp(id) {
  const targetId = String(id || "");
  if (!targetId) return { ok: false, message: "Missing tracked prop id" };

  const tracked = readJSON(TRACKED_FILE, []);
  const next = tracked.filter(
    (item) =>
      String(item.trackedId) !== targetId &&
      String(item.trackedKey) !== targetId
  );

  if (next.length === tracked.length) {
    return { ok: false, message: "Tracked prop not found" };
  }

  writeJSON(TRACKED_FILE, next);
  return { ok: true, message: "Tracked prop deleted", props: next };
}

export function clearTrackedProps() {
  const existing = readJSON(TRACKED_FILE, []);

  if (existing.length > 0 && !fs.existsSync(BACKUP_FILE)) {
    writeJSON(BACKUP_FILE, existing);
  }

  writeJSON(TRACKED_FILE, []);
  return { ok: true, message: "Tracked props cleared", props: [] };
}

const CHI_DAL_RESET_PLAYERS = new Set([
  "Gabriela Jaquez",
  "Arike Ogunbowale",
  "Sydney Taylor",
  "Azzi Fudd",
  "Awak Kuier",
]);

function isChiDalEarlyGradeProp(prop = {}) {
  const slateDate = prop.slateDate || prop.gameDate || "";
  if (slateDate !== "2026-06-20") return false;
  if (!CHI_DAL_RESET_PLAYERS.has(prop.player)) return false;

  const team = String(prop.team || "").toLowerCase();
  const opponent = String(prop.opponent || "").toLowerCase();
  const pair = new Set([team, opponent]);

  return pair.has("chicagosky") && pair.has("dallaswings");
}

function buildChiDalResetProp(prop = {}, options = {}) {
  const pendingReason =
    options.pendingReason === undefined ? "Game not final yet." : options.pendingReason;

  return {
    ...prop,
    status: "pending",
    pendingReason,
    actualStat: null,
    actualPoints: null,
    finalPoints: null,
    result: null,
    resultMargin: null,
    margin: null,
    gradedAt: null,
    resolvedAt: null,
    matchedSource: null,
    matchedDate: null,
    matchedGameId: null,
    matchVerified: false,
    resultConfidence: null,
    gradingNotes: null,
    resultSource: null,
    resultMeta: null,
    hit: null,
    push: null,
    currentEngineResult: null,
    currentEngineWon: null,
    currentEngineMargin: null,
    fairLineShadowResult: null,
    fairLineShadowWon: null,
    fairLineShadowMargin: null,
    resolveDebug: {
      ...(prop.resolveDebug || {}),
      resetReason: "chi-dal-early-grade-reset-20260621",
      resetAt: new Date().toISOString(),
    },
  };
}

/** Reset CHI/DAL 2026-06-20 props graded from live in-game stats. Preserves pick metadata. */
export function resetChiDalBadGrades(options = {}) {
  const tracked = readJSON(TRACKED_FILE, []);
  const backupSuffix = String(options.backupSuffix || "before-chi-dal-reset-20260621");
  const backupPath = `${TRACKED_FILE}-${backupSuffix}`;

  fs.copyFileSync(TRACKED_FILE, backupPath);

  let resetCount = 0;
  const resetPlayers = [];

  const next = tracked.map((prop) => {
    if (!isChiDalEarlyGradeProp(prop)) return prop;
    resetCount += 1;
    resetPlayers.push(prop.player);
    return buildChiDalResetProp(prop, options);
  });

  if (resetCount === 0) {
    return {
      ok: false,
      status: 404,
      message: "No matching CHI/DAL 2026-06-20 props found to reset",
      backup: backupPath,
      resetCount: 0,
    };
  }

  writeJSON(TRACKED_FILE, next);

  return {
    ok: true,
    message: `Reset ${resetCount} CHI/DAL early-grade prop(s) to pending`,
    backup: backupPath,
    resetCount,
    resetPlayers,
    props: next,
  };
}

export async function resolveTrackedProps(options = {}) {
  const requireLikelyFinished = Boolean(options.requireLikelyFinished);
  const isReadyToGrade = requireLikelyFinished
    ? isPickLikelyFinished
    : isPickGameStarted;

  const tracked = getTrackedProps();
  const pending = tracked.filter(
    (item) => !isResolvedStatus(item.status)
  );
  const gradeable = pending.filter((item) => isReadyToGrade(item));

  const statsCache = new Map();

  for (const item of gradeable) {
    await primePickStatsCache(item, statsCache);
  }

  let gradedCount = 0;
  let skippedNotReady = 0;
  let stillPending = 0;

  const updated = [];

  for (const item of tracked) {
    if (isResolvedStatus(item.status)) {
      updated.push(item);
      continue;
    }

    const gradingBlock = evaluateGradingBlock(item);
    if (gradingBlock.blocked) {
      skippedNotReady += 1;
      updated.push({
        ...item,
        resolveDebug: {
          ...(item.resolveDebug || {}),
          gameStarted: gradingBlock.gameStarted,
          gameLikelyFinished: gradingBlock.gameLikelyFinished,
          blockedByFutureGame: gradingBlock.blockedByFutureGame,
          blockedByCommenceTime: gradingBlock.blockedByCommenceTime,
          blockedByGameNotStarted: gradingBlock.blockedByGameNotStarted,
          blocked: true,
          at: new Date().toISOString(),
        },
      });
      continue;
    }

    if (!isReadyToGrade(item)) {
      skippedNotReady += 1;
      updated.push(item);
      continue;
    }

    const playerStats = getCachedStatsForPick(item, statsCache);

    const { statResult, pendingReason, resolveDebug, gradingNotes, matchVerified, resultConfidence, matchedDate, matchedGameId, matchedSource } = await resolvePlayerStatForPick(
      item,
      playerStats
    );

    if (statResult && resolveDebug?.blockedByGameNotFinal) {
      stillPending += 1;
      updated.push({
        ...item,
        status: "pending",
        pendingReason: pendingReason || "Game not final yet.",
        resolveDebug,
        actualStat: null,
        result: null,
        resultMargin: null,
        margin: null,
        gradedAt: null,
        matchedSource: null,
        matchedDate: null,
        matchedGameId: null,
      });
      continue;
    }

    const graded = gradeTrackedProp(item, statResult, {
      pendingReason,
      resolveDebug,
      gradingNotes,
      matchVerified,
      resultConfidence,
      matchedDate,
      matchedGameId,
      matchedSource,
    });

    if (isResolvedStatus(graded.status)) {
      gradedCount += 1;
    } else {
      stillPending += 1;
    }

    updated.push(graded);
  }

  writeJSON(TRACKED_FILE, updated);

  try {
    const { syncLockedSlateGradesFromLive } = await import("./slateLockService.js");
    syncLockedSlateGradesFromLive(updated);
  } catch (err) {
    console.log("LOCKED SLATE GRADE SYNC WARNING:", err.message);
  }

  return {
    props: updated,
    summary: {
      pendingTotal: pending.length,
      gradeable: gradeable.length,
      gradedCount,
      skippedNotReady,
      stillPending,
      requireLikelyFinished,
    },
  };
}

function updateBucket(bucket = {}, key = "UNKNOWN", field = "total", amount = 1) {
  if (!bucket[key]) {
    bucket[key] = {
      total: 0,
      pending: 0,
      graded: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      accuracy: 0,
      shadowWins: 0,
      shadowLosses: 0,
      shadowAccuracy: 0,
    };
  }

  bucket[key][field] = num(bucket[key][field]) + amount;
  return bucket;
}

function finalizeBucket(bucket = {}) {
  for (const key of Object.keys(bucket)) {
    const gradedTotal = bucket[key].wins + bucket[key].losses;
    bucket[key].accuracy =
      gradedTotal > 0
        ? Number(((bucket[key].wins / gradedTotal) * 100).toFixed(1))
        : 0;

    const shadowGraded = bucket[key].shadowWins + bucket[key].shadowLosses;
    bucket[key].shadowAccuracy =
      shadowGraded > 0
        ? Number(((bucket[key].shadowWins / shadowGraded) * 100).toFixed(1))
        : 0;
  }

  return bucket;
}

function buildLeagueCalibrationSlice(props = []) {
  const slice = {
    total: props.length,
    pending: 0,
    graded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    accuracy: 0,
    premium: { total: 0, wins: 0, losses: 0, pushes: 0, accuracy: 0 },
    playable: { total: 0, wins: 0, losses: 0, pushes: 0, accuracy: 0 },
    byTier: {},
    byRiskLabel: {},
  };

  function tallyTierBucket(tierKey, status) {
    if (!slice.byTier[tierKey]) {
      slice.byTier[tierKey] = {
        total: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        accuracy: 0,
      };
    }
    slice.byTier[tierKey].total += 1;
    if (status === "win") slice.byTier[tierKey].wins += 1;
    if (status === "loss") slice.byTier[tierKey].losses += 1;
    if (status === "push") slice.byTier[tierKey].pushes += 1;
  }

  function tallyRiskBucket(riskKey, status) {
    if (!slice.byRiskLabel[riskKey]) {
      slice.byRiskLabel[riskKey] = {
        total: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        accuracy: 0,
      };
    }
    slice.byRiskLabel[riskKey].total += 1;
    if (status === "win") slice.byRiskLabel[riskKey].wins += 1;
    if (status === "loss") slice.byRiskLabel[riskKey].losses += 1;
    if (status === "push") slice.byRiskLabel[riskKey].pushes += 1;
  }

  function finalizeTierStats(bucket) {
    const decided = bucket.wins + bucket.losses;
    bucket.accuracy =
      decided > 0 ? Number(((bucket.wins / decided) * 100).toFixed(1)) : 0;
    return bucket;
  }

  for (const prop of props) {
    const status = String(prop.status || "pending").toLowerCase();
    const resolved = isResolvedStatus(status);
    const tier = String(prop.tier || "UNKNOWN").toUpperCase();
    const risk = prop.riskLabel || "UNKNOWN";

    if (!resolved) {
      slice.pending += 1;
    } else {
      slice.graded += 1;
      if (status === "win") slice.wins += 1;
      if (status === "loss") slice.losses += 1;
      if (status === "push") slice.pushes += 1;
    }

    tallyTierBucket(tier, resolved ? status : null);
    tallyRiskBucket(risk, resolved ? status : null);

    if (tier === "PREMIUM") {
      slice.premium.total += 1;
      if (resolved) {
        if (status === "win") slice.premium.wins += 1;
        if (status === "loss") slice.premium.losses += 1;
        if (status === "push") slice.premium.pushes += 1;
      }
    }
    if (tier === "PLAYABLE") {
      slice.playable.total += 1;
      if (resolved) {
        if (status === "win") slice.playable.wins += 1;
        if (status === "loss") slice.playable.losses += 1;
        if (status === "push") slice.playable.pushes += 1;
      }
    }
  }

  slice.total = props.length;
  const decided = slice.wins + slice.losses;
  slice.accuracy =
    decided > 0 ? Number(((slice.wins / decided) * 100).toFixed(1)) : 0;
  slice.premium = finalizeTierStats(slice.premium);
  slice.playable = finalizeTierStats(slice.playable);

  for (const key of Object.keys(slice.byTier)) {
    slice.byTier[key] = finalizeTierStats(slice.byTier[key]);
  }
  for (const key of Object.keys(slice.byRiskLabel)) {
    slice.byRiskLabel[key] = finalizeTierStats(slice.byRiskLabel[key]);
  }

  return slice;
}

function buildLeagueCalibrationAnalytics(props = []) {
  const nbaProps = props.filter(
    (prop) => String(prop.league || "").toUpperCase() === "NBA"
  );
  const wnbaProps = props.filter(
    (prop) => String(prop.league || "").toUpperCase() === "WNBA"
  );

  return {
    structuralNotes: {
      availabilityGate:
        "skipped for WNBA — evaluateAvailabilityGate returns N/A for non-NBA",
      defenseScore:
        "neutral default (50) for WNBA — no team season stats wired",
      primaryStatSource:
        "BallDontLie (BDL) primary for WNBA — no SportsData projections",
    },
    NBA: buildLeagueCalibrationSlice(nbaProps),
    WNBA: buildLeagueCalibrationSlice(wnbaProps),
  };
}

export function buildTrackedPropAnalytics(props = getTrackedProps()) {
  const analytics = {
    overall: {
      total: props.length,
      pending: 0,
      graded: 0,
      currentEngine: { wins: 0, losses: 0, pushes: 0, accuracy: 0 },
      fairLineShadow: { wins: 0, losses: 0, pushes: 0, accuracy: 0 },
      sideComparison: {},
      auditSideMatch: { match: 0, mismatch: 0 },
    },
    byCurrentEngineSide: {},
    byFairLineSide: {},
    byAuditSideMatch: {},
    byRiskLabel: {},
    byTier: {},
    byLeague: {},
    byDataMode: {},
    byMarketQualityBucket: {},
    byBookCountBucket: {},
    byFairLineEdgeBucket: {},
    byRoleChangeScoreBucket: {},
    byConfidenceBucket: {},
    byPlayer: {},
    byTeam: {},
    bySideComparison: {},
    engineVsShadow: {
      currentEngineBetter: 0,
      fairLineBetter: 0,
      bothWon: 0,
      bothLost: 0,
      tied: 0,
    },
  };

  for (const prop of props) {
    const status = String(prop.status || "pending").toLowerCase();
    const resolved = isResolvedStatus(status);

    if (!resolved) {
      analytics.overall.pending += 1;
    } else {
      analytics.overall.graded += 1;

      if (status === "win") analytics.overall.currentEngine.wins += 1;
      if (status === "loss") analytics.overall.currentEngine.losses += 1;
      if (status === "push") analytics.overall.currentEngine.pushes += 1;

      const shadow = String(prop.fairLineShadowResult || "").toLowerCase();
      if (shadow === "win") analytics.overall.fairLineShadow.wins += 1;
      if (shadow === "loss") analytics.overall.fairLineShadow.losses += 1;
      if (shadow === "push") analytics.overall.fairLineShadow.pushes += 1;
    }

    if (prop.auditSideMatch) {
      analytics.overall.auditSideMatch.match += 1;
    } else if (prop.fairLineSide !== "NONE") {
      analytics.overall.auditSideMatch.mismatch += 1;
    }

    const comparison = prop.sideComparison || "UNKNOWN";
    analytics.overall.sideComparison[comparison] =
      num(analytics.overall.sideComparison[comparison]) + 1;
    updateBucket(analytics.bySideComparison, comparison, "total", 1);

    if (resolved) {
      updateBucket(analytics.bySideComparison, comparison, "graded", 1);
      if (status === "win") {
        updateBucket(analytics.bySideComparison, comparison, "wins", 1);
      }
      if (status === "loss") {
        updateBucket(analytics.bySideComparison, comparison, "losses", 1);
      }
      if (prop.fairLineShadowResult === "win") {
        updateBucket(analytics.bySideComparison, comparison, "shadowWins", 1);
      }
      if (prop.fairLineShadowResult === "loss") {
        updateBucket(analytics.bySideComparison, comparison, "shadowLosses", 1);
      }

      const currentWon = prop.currentEngineWon === true;
      const fairWon = prop.fairLineShadowWon === true;
      const currentLost = prop.currentEngineResult === "loss";
      const fairLost = prop.fairLineShadowResult === "loss";

      if (currentWon && !fairWon) analytics.engineVsShadow.currentEngineBetter += 1;
      else if (fairWon && !currentWon) analytics.engineVsShadow.fairLineBetter += 1;
      else if (currentWon && fairWon) analytics.engineVsShadow.bothWon += 1;
      else if (currentLost && fairLost) analytics.engineVsShadow.bothLost += 1;
      else analytics.engineVsShadow.tied += 1;
    }

    const bucketFields = [
      ["byCurrentEngineSide", prop.currentEngineSide || "UNKNOWN"],
      ["byFairLineSide", prop.fairLineSide || "NONE"],
      [
        "byAuditSideMatch",
        prop.auditSideMatch ? "MATCH" : prop.fairLineSide === "NONE" ? "FAIR_NONE" : "MISMATCH",
      ],
      ["byRiskLabel", prop.riskLabel || "UNKNOWN"],
      ["byTier", prop.tier || "UNKNOWN"],
      ["byLeague", prop.league || "UNKNOWN"],
      ["byDataMode", prop.dataMode || "UNKNOWN"],
      ["byMarketQualityBucket", prop.marketQualityBucket || getMarketQualityBucket(prop.marketQuality)],
      ["byBookCountBucket", prop.bookCountBucket || getBookCountBucket(prop.bookCount)],
      ["byFairLineEdgeBucket", prop.fairLineEdgeBucket || getFairLineEdgeBucket(prop.fairLineEdge)],
      [
        "byRoleChangeScoreBucket",
        prop.roleChangeScoreBucket ||
          getRoleChangeScoreBucket(prop.roleChangeScore),
      ],
      [
        "byConfidenceBucket",
        prop.confidenceBucket || getConfidenceBucket(prop.confidence),
      ],
      ["byPlayer", prop.player || "UNKNOWN"],
      ["byTeam", prop.team || "UNKNOWN"],
    ];

    for (const [bucketName, key] of bucketFields) {
      updateBucket(analytics[bucketName], key, "total", 1);
      if (!resolved) {
        updateBucket(analytics[bucketName], key, "pending", 1);
        continue;
      }

      updateBucket(analytics[bucketName], key, "graded", 1);
      if (status === "win") updateBucket(analytics[bucketName], key, "wins", 1);
      if (status === "loss") updateBucket(analytics[bucketName], key, "losses", 1);
      if (status === "push") updateBucket(analytics[bucketName], key, "pushes", 1);
      if (prop.fairLineShadowResult === "win") {
        updateBucket(analytics[bucketName], key, "shadowWins", 1);
      }
      if (prop.fairLineShadowResult === "loss") {
        updateBucket(analytics[bucketName], key, "shadowLosses", 1);
      }
    }
  }

  const currentGraded =
    analytics.overall.currentEngine.wins + analytics.overall.currentEngine.losses;
  analytics.overall.currentEngine.accuracy =
    currentGraded > 0
      ? Number(
          (
            (analytics.overall.currentEngine.wins / currentGraded) *
            100
          ).toFixed(1)
        )
      : 0;

  const shadowGraded =
    analytics.overall.fairLineShadow.wins +
    analytics.overall.fairLineShadow.losses;
  analytics.overall.fairLineShadow.accuracy =
    shadowGraded > 0
      ? Number(
          (
            (analytics.overall.fairLineShadow.wins / shadowGraded) *
            100
          ).toFixed(1)
        )
      : 0;

  for (const bucketName of [
    "byCurrentEngineSide",
    "byFairLineSide",
    "byAuditSideMatch",
    "byRiskLabel",
    "byTier",
    "byLeague",
    "byDataMode",
    "byMarketQualityBucket",
    "byBookCountBucket",
    "byFairLineEdgeBucket",
    "byRoleChangeScoreBucket",
    "byConfidenceBucket",
    "byPlayer",
    "byTeam",
    "bySideComparison",
  ]) {
    analytics[bucketName] = finalizeBucket(analytics[bucketName]);
  }

  analytics.updatedAt = new Date().toISOString();
  analytics.leagueCalibration = buildLeagueCalibrationAnalytics(props);
  return analytics;
}
