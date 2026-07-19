import cors from "cors";
import express from "express";

import { CONFIG, checkConfig } from "./config.js";
import {
  attachCourtEdgeEngineSignals,
  applyEngineSignalAdjustments,
  isEngineExpansionEnabled,
} from "./services/courtEdgeEngineSignalsV1.js";

import {
  buildConsensusPointProps,
  computeBlowoutRiskFromSpread,
  fetchConsensusGameSpread,
  fetchOddsGameCards,
  fetchPointsPropsForEvent,
  findOddsEventForGame,
} from "./services/oddsService.js";

import {
  buildPlayerContextMaps,
  clean,
  fetchPlayers,
  fetchProjections,
  fetchSeasonStats,
  fetchTeamSeasonStats,
  getOpponentForTeam,
  getProjectionPoints,
  getSeasonPoints,
  getTeamForPlayer,
} from "./services/sportsDataService.js";

import {
  fetchBallTeams,
  fetchLast3VsOpponent,
  fetchLast5,
  fetchPlayerStats,
  filterGamesBeforeCutoff,
  findBallPlayer,
  getBallPlayerTeam,
  probeWnbaMatchupLookup,
  summarizeOpponentMatchup,
  summarizeScoringProfile,
} from "./services/ballService.js";

import {
  fetchFinalPlayerStats,
  getCachedStatsForPick,
  getPickDate,
  gradePointsPick,
  isPickGameStarted,
  isPickLikelyFinished,
  primePickStatsCache,
  resolvePlayerStatForPick,
} from "./services/resultService.js";

import { buildOpportunityScore } from "./engines/opportunityEngine.js";
import { buildPlayerState } from "./engines/playerStateBuilder.js";
import { buildTopPicksForGame } from "./engines/pickRanker.js";
import {
  selectControlledBestSixCombined,
  CONTROLLED_BEST_SIX_VERSION,
} from "./engines/topProps/controlledBestSixSelector.js";
import {
  selectTopProps,
  selectCombinedTopProps,
  TOP_PROP_SELECTOR_VERSION,
} from "./engines/topProps/topPropSelector.js";
import { buildPlayoffContext } from "./engines/playoffEngine.js";
import { buildFairLine } from "./engines/fairLineEngine.js";
import { buildRoleChange } from "./engines/roleChangeEngine.js";
import { compareOverUnderRisk } from "./engines/riskComparisonEngine.js";
import {
  calcUsageBoost,
  getMissingPlayers,
} from "./engines/usageEngine.js";
import { buildWinProbability } from "./engines/winProbabilityEngine.js";
import { evaluateAvailabilityGate } from "./engines/availabilityGateEngine.js";
import {
  buildTeamStatsMap,
  computeDefenseScore,
} from "./engines/defenseScoreEngine.js";
import { buildMarketIntelligence } from "./engines/marketIntelligenceEngine.js";
import {
  buildScoreLedger,
  mergeIntelligenceIntoRiskComparison,
} from "./engines/scoreLedgerEngine.js";
import { buildVolumeProfile } from "./engines/volumeProfileEngine.js";
import { evaluateVolumeDangerGates } from "./engines/volumeDangerGatesEngine.js";
import {
  applyWnbaOfficialV1Rules,
  isCourteEdgeWnbaV1Enabled,
} from "./engines/wnbaOfficialEngine.js";
import { evaluateSideSelection, finalizeSideTrackingDecision } from "./engines/sideSelectionEngine.js";
import { evaluateWnbaAvailability } from "./services/wnbaAvailabilityService.js";
import { buildWnbaGameContext, enrichWnbaGameContextForTeam } from "./services/wnbaGameContextService.js";
import { buildWnbaOpponentDefenseContext } from "./services/wnbaOpponentContextService.js";
import { PROVIDER_FALLBACK_POLICY } from "./services/providerFallbackPolicy.js";
import { COURTEDGE_PLAYER_EVIDENCE_VERSION } from "./services/courtEdgePlayerEvidenceV1.js";
import {
  applyWnbaShadowRecalibration,
  buildWnbaDefenseShadowContext,
  isWnbaShadowRecalibrationEnabled,
} from "./engines/wnbaShadowEngine.js";
import {
  evaluateWnbaPropDecision,
  isCourteEdgeWnbaV2Enabled,
} from "./engines/wnba/wnbaDecisionEngine.js";
import {
  evaluateWnbaTrackingEligibility,
} from "./engines/wnba/wnbaResultsQualityGate.js";
import {
  applyDecisionIntelligenceToPick,
  DECISION_INTELLIGENCE_VERSION,
} from "./engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { SIDE_RESCUE_VERSION } from "./engines/decisionIntelligence/sideRescueEngineV1.js";
import { DECISION_DATA_INTELLIGENCE_VERSION } from "./engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import {
  auditWnbaDataIntegrity,
  DATA_INTEGRITY_VERSION,
} from "./engines/wnba/wnbaDataIntegrityV1.js";
import {
  attemptWnbaDataRecovery,
  attachDataRecoveryToIntegrity,
  DATA_RECOVERY_VERSION,
} from "./engines/wnba/wnbaDataRecoveryV1.js";
import {
  resolveWnbaTeamId,
  teamsMatch,
} from "./engines/wnba/wnbaTeamAliasResolver.js";
import { resolveStableWnbaPlayerId } from "./engines/wnba/wnbaPlayerIdResolver.js";
import {
  PLAYER_INTELLIGENCE_BUILD_TAG,
  buildPlayerProfileLabReport,
  buildProjectionBiasReport,
  getCalibrationStoreSummary,
} from "./engines/wnba/playerIntelligence/index.js";
import { buildSlateRejectionAnalysisFromProps } from "./services/wnbaSlateRejectionAnalysis.js";

import {
  appendMarketSnapshot,
  getOpeningLine,
} from "./services/marketSnapshotService.js";

import {
  deletePick,
  getSavedPicks,
  savePick,
  savePickHistory,
  updatePlayerAccuracy,
} from "./storage.js";

import { buildFilterAudit } from "./services/filterAuditService.js";
import {
  TRACKING_MODE,
  addTrackedProps,
  applySlateLockFreeze,
  buildFlowValidationDiagnostics,
  buildControlledTrackingCohort,
  buildResultsTrackingCohort,
  buildTrackedPropAnalytics,
  buildTrackingCohortDiagnostics,
  clearTrackedProps,
  collectAllGeneratedCandidatesFromGames,
  collectAllGeneratedProps,
  backfillOfficialLines,
  deleteTrackedProp,
  getAnalyticsScopeProps,
  getLifecycleIntegrityDiagnostics,
  getTrackedProps,
  resetChiDalBadGrades,
  resolveResultsCohortSlateDate,
  resolveTrackedProps,
  runTrackedPropStartupIntegrityCheck,
} from "./services/trackedPropService.js";

import {
  attemptDailySlateReportBuild,
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getDailySlateReports,
  getLifecycleDeliverableReports,
  getRawDailySlateReports,
  resolveDeliverableDailySlateReport,
} from "./services/dailySlateReportService.js";

import {
  sealTomorrowOfficialSlates,
  sealTodayFallbackOfficialSlate,
  sealOfficialSlate,
  inheritTodayResultsFromSealedSlate,
  buildOfficialSlateDiagnostics,
  validateOfficialSlateLifecycle,
  repairImproperThinSealedPregame,
  OFFICIAL_SLATE_BUILD_TAG,
} from "./services/officialSlateService.js";

import { importRuntimeState } from "./services/runtimeStateImportService.js";

import {
  createBackup,
  getLastBackup,
  listBackups,
  restoreFromBackup,
} from "./services/backupService.js";

import {
  countDuplicateStableKeys,
  getAllHistoryArchives,
  getHistoryArchive,
  getLastBlockedWrite,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
  isSlateLocked,
  lockSlate,
} from "./services/slateLockService.js";

import {
  buildHistoryThreeSlateGroups,
  HISTORY_THREE_SLATE_GROUPS_VERSION,
} from "./services/historyThreeSlateGroupsV1.js";
import {
  buildHistoryThreeSlateGroupsV2,
  HISTORY_THREE_SLATE_GROUPS_V2,
} from "./services/historyThreeSlateGroupsV2.js";
import {
  buildCourtEdgeLabV2,
  attachLabV2ToReport,
  LAB_V2_BUILD,
  LAB_V2_VERSION,
} from "./services/courtEdgeLabV2.js";
import { SIGNAL_PERFORMANCE_VERSION } from "./services/signalPerformanceV1.js";

import {
  buildCourtEdgeFlowDiagnostics,
  buildSlateRotationMetadata,
  getTodayLocalDate,
  pickActiveResultsSlateDate,
  sanitizeHomeBoardForLifecycle,
} from "./services/slateScopeService.js";

import {
  buildStaleSealedLifecycleDiagnostics,
  recoverStaleSealedSlates,
} from "./services/staleSealedRecoveryService.js";

import {
  buildSlateLifecycleMap,
  buildTrackedPropsLifecycleDiagnostics,
  classifyTrackedPropsByLifecycle,
  SLATE_LIFECYCLE_STATES,
} from "./services/slateLifecycleService.js";
import {
  getLabBundleInfo,
  getOfficialFreezeInfo,
  LAB_SLATE_BUNDLE_CATALOG,
  OFFICIAL_FREEZE_CATALOG,
  persistSealedSlateBundle,
  rehydrateLockedSlatesOnStartup,
  restoreCompletedLabSlate,
  restoreOfficialSlate,
} from "./services/slateRestoreService.js";
import {
  anyGameStarted,
  classifyV1BoardProps,
  reslate0622V1,
  RESLATE_SLATE_DATE,
} from "./services/reslate0622V1Service.js";
import { classifyTestBoardProps, reslate0622Test } from "./services/reslate0622TestService.js";
import { repairSlateRotation0624 } from "./services/repairSlateRotation0624Service.js";
import { repairLabHistoryMessages0625 } from "./services/repairLabHistoryMessages0625Service.js";
import { repairQuarantine0624AndArchive0621 } from "./services/repairQuarantine0624AndArchive0621Service.js";
import { repairLabSlateRotation } from "./services/repairLabSlateRotationService.js";
import { backfillLabLearningLayers } from "./services/backfillLabLearningLayersService.js";
import {
  auditLifecycleIntegrity,
  repairLifecycleIntegrity,
} from "./services/repairLifecycleIntegrityService.js";
import {
  normalizeDailySlateReport,
  normalizeDailySlateReports,
} from "./services/canonicalDailySlateReportService.js";
import {
  previewSplitResultsCohortRepair,
  repairSplitResultsCohort,
} from "./services/repairSplitResultsCohortService.js";
import { archiveLabSlate0621 } from "./services/archiveLabSlate0621Service.js";
import { resetHistoryArchives } from "./services/resetHistoryArchivesService.js";
import { resetLabNoRestore } from "./services/resetLabArchivesService.js";
import { promoteLabSlate0628Archive0621 } from "./services/promoteLabSlate0628Archive0621Service.js";
import { buildScopedResolveSummary } from "./services/resolveCheckMessageService.js";
import {
  isOfficialPick,
  isTestPick,
} from "./engines/topProps/topPropSelectionAudit.js";
import {
  getActiveTopPicksSnapshot,
  getActiveBestSixSnapshot,
  getTopPickMetaMap,
  saveTopPicksSnapshot,
  saveBestSixSnapshot,
  TOP_PICKS_SOURCE_POOL,
} from "./services/topPicksSnapshotService.js";

import {
  classifyProviderError,
  getSchedulerStatus,
  loadBoardCache,
  runScheduledJobs,
  saveBoardCache,
  shouldPreserveExistingBoard,
  verifySchedulerToken,
  JOB_IDS,
} from "./services/courtEdgeSchedulerV1.js";

const SERVER_BUILD = "courteedge-home-detailed-analysis-side-calibration-v1";
const BOARD_SCHEMA_VERSION = "courtedge-board-schema-v2";

function getRotationRuntimeContext(partial = {}) {
  return {
    archives: partial.archives ?? getAllHistoryArchives(),
    lockedSlates: partial.lockedSlates ?? getLockedSlatesRegistry().slates ?? [],
    quarantinedSlates:
      partial.quarantinedSlates ?? getQuarantinedSlatesFromRegistry(),
    today: partial.today ?? getTodayLocalDate(),
    ...partial,
  };
}

const ENGINE_LOAD_FLAGS = {
  volumeProfileEngineLoaded: typeof buildVolumeProfile === "function",
  scoreLedgerEngineLoaded: typeof buildScoreLedger === "function",
  marketIntelligenceEngineLoaded: typeof buildMarketIntelligence === "function",
  availabilityGateEngineLoaded: typeof evaluateAvailabilityGate === "function",
  defenseScoreEngineLoaded: typeof computeDefenseScore === "function",
  volumeDangerGatesEngineLoaded: typeof evaluateVolumeDangerGates === "function",
  wnbaOfficialV1Loaded: typeof applyWnbaOfficialV1Rules === "function",
  sideSelectionEngineLoaded: typeof evaluateSideSelection === "function",
  topPropSelectorLoaded: typeof selectTopProps === "function",
  topPropSelectorVersion: TOP_PROP_SELECTOR_VERSION,
  controlledBestSixLoaded: typeof selectControlledBestSixCombined === "function",
  controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
  wnbaV2TopPropSelectorLoaded: true,
};

const app = express();

app.use(cors());
app.use(express.json());

function requireAdminSecret(req, res, next) {
  const secret = String(process.env.ADMIN_SECRET || "").trim();
  if (!secret) {
    return res.status(503).json({
      ok: false,
      message: "ADMIN_SECRET is not configured on this server",
    });
  }

  const provided = String(
    req.headers["x-admin-secret"] ||
      req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
      ""
  ).trim();

  if (provided !== secret) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized ? provide x-admin-secret header",
    });
  }

  next();
}

let picksCache = null;
let lastRefreshTime = 0;
let cachedSelectorVersion = null;
let refreshesTodayCount = 0;
let refreshesTodayDate = "";
const AUTO_RESOLVE_INTERVAL_MS = 45 * 60 * 1000;
let autoResolveRunning = false;

function hydratePicksCacheFromDisk() {
  if (picksCache?.games?.length) return picksCache;
  const cached = loadBoardCache();
  if (cached && typeof cached === "object") {
    picksCache = cached;
    if (cached.lastUpdated) {
      const ts = Date.parse(cached.lastUpdated);
      if (Number.isFinite(ts)) lastRefreshTime = ts;
    }
  }
  return picksCache;
}

function getReadOnlyBoard() {
  return hydratePicksCacheFromDisk();
}

function persistBoardAfterRefresh(result) {
  if (!result || result.ok === false) return null;
  const previous = loadBoardCache();
  if (shouldPreserveExistingBoard(previous, result, false)) {
    return previous;
  }
  return saveBoardCache(result);
}

function cacheFresh() {
  if (!picksCache) return false;

  // Reject stale previous-build packets after deploy (missing build = stale).
  if (picksCache.serverBuild !== SERVER_BUILD) {
    return false;
  }

  if (picksCache.boardSchemaVersion !== BOARD_SCHEMA_VERSION) {
    return false;
  }

  if (
    picksCache.controlledBestSixVersion &&
    picksCache.controlledBestSixVersion !== CONTROLLED_BEST_SIX_VERSION
  ) {
    return false;
  }

  if (
    picksCache.decisionIntelligenceVersion &&
    picksCache.decisionIntelligenceVersion !== DECISION_INTELLIGENCE_VERSION
  ) {
    return false;
  }

  if (
    picksCache.sideRescueVersion &&
    picksCache.sideRescueVersion !== SIDE_RESCUE_VERSION
  ) {
    return false;
  }

  if (
    picksCache.decisionDataIntelligenceVersion &&
    picksCache.decisionDataIntelligenceVersion !== DECISION_DATA_INTELLIGENCE_VERSION
  ) {
    return false;
  }

  if (
    picksCache.dataIntegrityVersion &&
    picksCache.dataIntegrityVersion !== DATA_INTEGRITY_VERSION
  ) {
    return false;
  }

  if (
    picksCache.dataRecoveryVersion &&
    picksCache.dataRecoveryVersion !== DATA_RECOVERY_VERSION
  ) {
    return false;
  }

  if (
    picksCache.topPropSelectorVersion &&
    picksCache.topPropSelectorVersion !== TOP_PROP_SELECTOR_VERSION &&
    !picksCache.controlledBestSixVersion
  ) {
    return false;
  }

  if (
    cachedSelectorVersion &&
    cachedSelectorVersion !== CONTROLLED_BEST_SIX_VERSION
  ) {
    return false;
  }

  const ageMinutes = (Date.now() - lastRefreshTime) / 1000 / 60;

  return ageMinutes < CONFIG.CACHE_MINUTES;
}

function clampTopPropsSelection(selection = {}, limit = null) {
  const resolvedLimit = Number(
    limit ?? selection.topProps?.length ?? CONFIG.TOP_PROP_LIMIT ?? 2
  );
  const topProps = (selection.topProps || []).slice(0, resolvedLimit);
  const topOfficialProps = topProps.filter(isOfficialPick);
  const topTestProps = topProps.filter(isTestPick);
  const audit = selection.topSelectionAudit
    ? {
        ...selection.topSelectionAudit,
        selectedCount: topProps.length,
        officialCount: topOfficialProps.length,
        testCount: topTestProps.length,
      }
    : null;

  return {
    ...selection,
    topProps,
    topOfficialProps,
    topTestProps,
    topSelectionAudit: audit,
    selectedCount: topProps.length,
    officialCount: topOfficialProps.length,
    testCount: topTestProps.length,
  };
}

/** Keep tracked-props.json aligned when serving cached board data (cache hits skip refresh). */
function syncTrackedFromCache() {
  if (!picksCache?.games?.length) return;

  const hasCachedBestSix =
    picksCache.bestSixDisplayWNBA?.length ||
    picksCache.bestSixDisplayNBA?.length ||
    picksCache.bestSixWNBA?.length ||
    picksCache.bestSixNBA?.length;

  const cohortBundle = buildControlledTrackingCohort(
    { gameCards: picksCache.games },
    {
      todayLocalDate: getTodayLocalDate(),
      sourcePool: TOP_PICKS_SOURCE_POOL,
      lockedSlates: getLockedSlatesRegistry().slates || [],
      trackedProps: getTrackedProps(),
      controlledSelection: hasCachedBestSix
        ? {
            bestSixDisplayWNBA:
              picksCache.bestSixDisplayWNBA || picksCache.bestSixWNBA || [],
            bestSixDisplayNBA:
              picksCache.bestSixDisplayNBA || picksCache.bestSixNBA || [],
            bestSixWNBA: picksCache.bestSixWNBA || [],
            bestSixNBA: picksCache.bestSixNBA || [],
            topProps: picksCache.topProps || [],
            topNBAProps: picksCache.topNBAProps || [],
            topWNBAProps: picksCache.topWNBAProps || [],
            topOfficialProps: picksCache.topOfficialProps || [],
            topTestProps: picksCache.topTestProps || [],
            topNBAOfficialProps: picksCache.topNBAOfficialProps || [],
            topNBATestProps: picksCache.topNBATestProps || [],
            topWNBAOfficialProps: picksCache.topWNBAOfficialProps || [],
            topWNBATestProps: picksCache.topWNBATestProps || [],
            controlledBestSixAudit: picksCache.controlledBestSixAudit || null,
            topSelectionAudit: picksCache.topSelectionAudit || null,
            candidateCount: picksCache.candidateCount,
            selectedCount: picksCache.selectedCount,
            selectedNBA: picksCache.selectedNBA,
            selectedWNBA: picksCache.selectedWNBA,
            noBetCount: picksCache.noBetCount,
          }
        : undefined,
    }
  );

  if (cohortBundle.trackingCohort.length) {
    addTrackedProps(cohortBundle.trackingCohort, {
      skipTopPickReferences: true,
      preFilteredCohort: true,
    });
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avgPoints(games = []) {
  const points = games
    .map((g) => Number(g.points || 0))
    .filter((p) => Number.isFinite(p));

  if (!points.length) return 0;

  return points.reduce((sum, p) => sum + p, 0) / points.length;
}

function average(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);

  if (!nums.length) return 0;

  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isFiniteMetric(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

const SEVERE_MARKET_WARNINGS = [
  "Missing Over/Under side coverage",
  "One side has no usable odds",
  "Low book coverage",
];

function hasSevereMarketWarnings(marketWarnings = [], bookCount = 0) {
  const warnings = Array.isArray(marketWarnings) ? marketWarnings : [];

  if (warnings.some((w) => SEVERE_MARKET_WARNINGS.includes(w))) {
    return true;
  }

  return num(bookCount) <= 1 && warnings.includes("Low book coverage");
}

function applyReliabilityAdjustedConfidence({
  rawConfidence = 0,
  riskComparison = {},
  opportunity = {},
  prop = {},
  extraDangerPressure = 0,
  extraDangerReasons = [],
} = {}) {
  const confidenceAdjustmentReasons = [];

  const raw = num(rawConfidence);
  const bookCount = num(prop.bookCount);
  const consensusBookCount = num(prop.consensusBookCount);
  const marketQuality = prop.marketQuality;
  const hasBothSides = Boolean(prop.hasBothSides);
  const marketWarnings = Array.isArray(prop.marketWarnings)
    ? prop.marketWarnings
    : [];
  const roleCertainty = num(opportunity.roleCertainty);
  const volatilityLabel = String(
    opportunity.scoringVolatility?.label || ""
  ).toUpperCase();

  /*
   * evidenceReliability blend ? marketQuality is the single book/market composite
   * (oddsService.buildMarketProfile already tiers on bookCount, consensusBookCount,
   * lineSpread, hasBothSides, over/under book counts). Do NOT add separate weights
   * for bookCount or consensusBookCount here; that double-counts the same axis.
   * hasBothSides kept at 5% as a light emphasis (also embedded in marketQuality).
   */
  const reliabilityComponents = [];

  if (isFiniteMetric(marketQuality)) {
    reliabilityComponents.push({
      weight: 0.45,
      value: clamp(marketQuality / 100, 0, 1),
      label: `market quality (${marketQuality})`,
      source: "marketComposite",
    });
  }

  if (isFiniteMetric(opportunity.dataCoverage)) {
    reliabilityComponents.push({
      weight: 0.25,
      value: clamp(opportunity.dataCoverage / 100, 0, 1),
      label: `data coverage (${opportunity.dataCoverage}%)`,
      source: "playerData",
    });
  }

  if (isFiniteMetric(opportunity.rawQuality)) {
    reliabilityComponents.push({
      weight: 0.15,
      value: clamp(opportunity.rawQuality / 100, 0, 1),
      label: `raw quality (${opportunity.rawQuality}%)`,
      source: "playerData",
    });
  }

  reliabilityComponents.push({
    weight: 0.05,
    value: hasBothSides ? 1 : 0.4,
    label: hasBothSides ? "both sides covered" : "missing side coverage",
    source: "marketSideCoverage",
  });

  const reliabilityWeight = reliabilityComponents.reduce(
    (sum, component) => sum + component.weight,
    0
  );

  const evidenceReliability =
    reliabilityWeight > 0
      ? reliabilityComponents.reduce(
          (sum, component) => sum + component.weight * component.value,
          0
        ) / reliabilityWeight
      : 0;

  let dangerPressure = 0;

  const chosenRisk = num(riskComparison.chosenRisk);
  const riskPressure = clamp((chosenRisk - 25) / 45, 0, 1) * 0.25;
  if (riskPressure > 0) {
    dangerPressure += riskPressure;
    confidenceAdjustmentReasons.push(
      `Side risk ${chosenRisk} adds danger pressure`
    );
  }

  if (isFiniteMetric(marketQuality)) {
    const marketWeakness = (1 - marketQuality / 100) * 0.25;
    if (marketWeakness > 0) {
      dangerPressure += marketWeakness;
      if (marketWeakness >= 0.1) {
        confidenceAdjustmentReasons.push(
          `Weak market quality (${marketQuality}) adds danger pressure`
        );
      }
    }
  }

  if (
    num(riskComparison.resistanceScore) > num(riskComparison.supportScore)
  ) {
    dangerPressure += 0.15;
    confidenceAdjustmentReasons.push(
      "Resistance exceeds support on chosen side"
    );
  }

  if (volatilityLabel === "HIGH") {
    dangerPressure += 0.15;
    confidenceAdjustmentReasons.push("High scoring volatility");
  } else if (volatilityLabel === "MEDIUM") {
    dangerPressure += 0.08;
    confidenceAdjustmentReasons.push("Medium scoring volatility");
  }

  if (roleCertainty > 0 && roleCertainty < 45) {
    dangerPressure += 0.1;
    confidenceAdjustmentReasons.push("Role uncertainty detected");
  }

  if (marketWarnings.length) {
    const marketWarningPressure = Math.min(0.2, marketWarnings.length * 0.05);
    dangerPressure += marketWarningPressure;
    confidenceAdjustmentReasons.push(
      `Market warnings (${marketWarnings.join(", ")})`
    );
  }

  const riskWarnings = Array.isArray(riskComparison.warnings)
    ? riskComparison.warnings
    : [];

  if (riskWarnings.length) {
    const riskWarningPressure = Math.min(0.15, riskWarnings.length * 0.04);
    dangerPressure += riskWarningPressure;
    confidenceAdjustmentReasons.push(
      `Risk comparison warnings (${riskWarnings.join(", ")})`
    );
  }

  const additivePressure = clamp(num(extraDangerPressure), 0, 0.35);
  if (additivePressure > 0) {
    dangerPressure += additivePressure;
    const reasonText = (extraDangerReasons || []).slice(0, 3).join("; ");
    confidenceAdjustmentReasons.push(
      reasonText
        ? `Volume/market/availability pressure (+${Math.round(additivePressure * 100)}%): ${reasonText}`
        : `Volume/market/availability pressure (+${Math.round(additivePressure * 100)}%)`
    );
  }

  dangerPressure = clamp(dangerPressure, 0, 1);

  const reliabilityMultiplier = 0.55 + 0.45 * evidenceReliability;
  let finalConfidence = Math.round(
    raw * reliabilityMultiplier - dangerPressure * 24
  );
  finalConfidence = clamp(finalConfidence, 25, 95);

  confidenceAdjustmentReasons.unshift(
    `Raw player signal ${raw} before reliability adjustment`
  );

  for (const component of reliabilityComponents) {
    if (component.value < 0.5) {
      confidenceAdjustmentReasons.push(`Low ${component.label}`);
    } else if (component.value >= 0.8) {
      confidenceAdjustmentReasons.push(`Strong ${component.label}`);
    }
  }

  confidenceAdjustmentReasons.push(
    `Evidence reliability ${Math.round(evidenceReliability * 100)}% (x${reliabilityMultiplier.toFixed(2)})`
  );
  confidenceAdjustmentReasons.push(
    `Danger pressure ${Math.round(dangerPressure * 100)}% (-${Math.round(dangerPressure * 24)} pts)`
  );
  confidenceAdjustmentReasons.push(`Final confidence ${finalConfidence}`);

  const reliabilityInputAudit = buildReliabilityInputAudit({
    bookCount,
    consensusBookCount,
    marketQuality,
    hasBothSides,
    dataCoverage: opportunity.dataCoverage,
    rawQuality: opportunity.rawQuality,
    reliabilityComponents,
    evidenceReliability,
  });

  return {
    rawConfidenceBeforeReliability: raw,
    evidenceReliability,
    dangerPressure,
    finalConfidence,
    confidenceAdjustmentReasons,
    reliabilityInputAudit,
  };
}

function buildReliabilityInputAudit({
  bookCount = 0,
  consensusBookCount = 0,
  marketQuality = null,
  hasBothSides = false,
  dataCoverage = null,
  rawQuality = null,
  reliabilityComponents = [],
  evidenceReliability = 0,
} = {}) {
  return {
    designNote:
      "marketQuality embeds bookCount/consensusBookCount/lineSpread/hasBothSides via buildMarketProfile; separate book weights removed to avoid double-counting",
    embeddedInMarketQuality: [
      "bookCount",
      "consensusBookCount",
      "lineSpread",
      "hasBothSides",
      "overBookCount",
      "underBookCount",
    ],
    activeBlendInputs: reliabilityComponents.map((c) => ({
      label: c.label,
      weight: c.weight,
      value: c.value,
      source: c.source,
    })),
    rawMarketInputs: {
      bookCount: isFiniteMetric(bookCount) ? bookCount : null,
      consensusBookCount: isFiniteMetric(consensusBookCount)
        ? consensusBookCount
        : null,
      marketQuality: isFiniteMetric(marketQuality) ? marketQuality : null,
      hasBothSides: Boolean(hasBothSides),
    },
    rawPlayerInputs: {
      dataCoverage: isFiniteMetric(dataCoverage) ? dataCoverage : null,
      rawQuality: isFiniteMetric(rawQuality) ? rawQuality : null,
    },
    evidenceReliability,
    overlapWarnings: [
      ...(isFiniteMetric(marketQuality) && isFiniteMetric(bookCount)
        ? ["bookCount feeds marketQuality; not weighted separately in blend"]
        : []),
      ...(isFiniteMetric(marketQuality) && isFiniteMetric(consensusBookCount)
        ? [
            "consensusBookCount feeds marketQuality; not weighted separately in blend",
          ]
        : []),
      ...(isFiniteMetric(marketQuality)
        ? ["hasBothSides also adjusts marketQuality (-20 when missing); 5% blend weight is intentional emphasis"]
        : []),
    ],
  };
}

function strengthFromConfidence(confidence) {
  if (confidence >= 75) return "Elite";
  if (confidence >= 68) return "Strong";
  return "Lean";
}

/*
 * PREMIUM tier gate independence (8 checks, not 8 independent axes).
 *
 * Three underlying axes (user model ? agree with nuance):
 *   1) Edge/signal ? supportScore vs resistanceScore ? netEdge; signalStrength
 *      is derived from netEdge + dataQuality + totalEvidence (riskComparisonEngine).
 *   2) Data/market trust ? marketQuality (composite: bookCount, consensusBookCount,
 *      lineSpread, hasBothSides baked in via buildMarketProfile), dataCoverage,
 *      rawQuality, hasBothSides (5% emphasis) ? evidenceReliability; same market
 *      inputs also feed dangerPressure (market weakness) and the marketQuality gate.
 *   3) Risk/danger ? chosenRisk ? riskLabel and dangerPressure; resistance >
 *      support, volatility, warnings, extraDangerPressure also feed dangerPressure.
 *
 * Independent gates (test a primary dimension, not a composite formula output):
 *   - signalAndEdge (STRONG + netEdge?10; STRONG already implies netEdge?12)
 *   - noPlay (playability veto from riskComparison noPlayReasons)
 *
 * Derivative gates (same underlying inputs, different math/threshold):
 *   - finalConfidence ? raw � (0.55+0.45�evidenceReliability) ? dangerPressure�24
 *   - evidenceReliability ? marketQuality (45%, composite book/market signal),
 *     dataCoverage (25%), rawQuality (15%), hasBothSides (5%); bookCount and
 *     consensusBookCount are NOT separate weights (embedded in marketQuality)
 *   - dangerPressure ? chosenRisk, marketQuality weakness, resistance>support,
 *     volatility, roleCertainty, market/risk warnings, extraDangerPressure
 *   - riskLabel ? bucketed chosenRisk (shares chosenRisk with dangerPressure)
 *   - marketQuality?55 ? direct threshold on input also in evidenceReliability (30%)
 *   - noSevereWarnings ? marketWarnings + bookCount (overlaps bookCount/hasBothSides
 *     in evidenceReliability)
 *
 * Cross-cluster coupling: finalConfidence re-checks trust+danger axes already gated
 * separately; a pick can fail multiple gates from one weak marketQuality reading.
 */
function buildPremiumGateAudit({
  finalConfidence = 0,
  evidenceReliability = 0,
  dangerPressure = 0,
  riskLabel = "",
  signal = "",
  cleanNetEdge = 0,
  noPlay = false,
  cleanMarketQuality = 0,
  severeWarnings = false,
} = {}) {
  return [
    {
      gate: "finalConfidence",
      passed: finalConfidence >= 75,
      axis: "derivative",
      sharesInputWith: [
        "evidenceReliability",
        "dangerPressure",
        "marketQuality",
      ],
    },
    {
      gate: "evidenceReliability",
      passed: evidenceReliability >= 0.65,
      axis: "derivative",
      sharesInputWith: ["marketQuality", "finalConfidence", "noSevereWarnings"],
    },
    {
      gate: "dangerPressure",
      passed: dangerPressure <= 0.35,
      axis: "derivative",
      sharesInputWith: ["riskLabel", "finalConfidence", "marketQuality"],
    },
    {
      gate: "signalAndEdge",
      passed: signal === "STRONG" && cleanNetEdge >= 10,
      axis: "independent",
      sharesInputWith: [],
    },
    {
      gate: "riskLabel",
      passed: riskLabel !== "High Risk",
      axis: "derivative",
      sharesInputWith: ["dangerPressure"],
    },
    {
      gate: "noPlay",
      passed: !noPlay,
      axis: "independent",
      sharesInputWith: [],
    },
    {
      gate: "marketQuality",
      passed: cleanMarketQuality >= 55,
      axis: "derivative",
      sharesInputWith: [
        "evidenceReliability",
        "dangerPressure",
        "finalConfidence",
      ],
    },
    {
      gate: "noSevereWarnings",
      passed: !severeWarnings,
      axis: "derivative",
      sharesInputWith: ["evidenceReliability"],
    },
  ];
}

function getTier({
  finalConfidence = 0,
  evidenceReliability = 0,
  dangerPressure = 0,
  riskLabel = "",
  signalStrength = "",
  netEdge = 0,
  noPlay = false,
  marketQuality = 0,
  marketWarnings = [],
  bookCount = 0,
} = {}) {
  const tierReasons = [];
  const signal = String(signalStrength || "").toUpperCase();
  const cleanNetEdge = num(netEdge);
  const cleanMarketQuality = num(marketQuality);
  const severeWarnings = hasSevereMarketWarnings(marketWarnings, bookCount);

  const premiumChecks = [
    {
      pass: finalConfidence >= 75,
      reason:
        finalConfidence >= 75
          ? `Confidence ${finalConfidence} meets PREMIUM threshold (75+)`
          : `Confidence ${finalConfidence} below PREMIUM threshold (75+)`,
    },
    {
      pass: evidenceReliability >= 0.65,
      reason:
        evidenceReliability >= 0.65
          ? `Evidence reliability ${Math.round(evidenceReliability * 100)}% is strong enough`
          : `Evidence reliability ${Math.round(evidenceReliability * 100)}% below 65% requirement`,
    },
    {
      pass: dangerPressure <= 0.35,
      reason:
        dangerPressure <= 0.35
          ? `Danger pressure ${Math.round(dangerPressure * 100)}% is acceptable`
          : `Danger pressure ${Math.round(dangerPressure * 100)}% exceeds 35% limit`,
    },
    {
      pass: signal === "STRONG" && cleanNetEdge >= 10,
      reason:
        signal === "STRONG" && cleanNetEdge >= 10
          ? `Signal is STRONG with net edge ${cleanNetEdge}`
          : `Signal/edge too weak for PREMIUM (${signal}, edge ${cleanNetEdge})`,
    },
    {
      pass: riskLabel !== "High Risk",
      reason:
        riskLabel !== "High Risk"
          ? `Risk label is ${riskLabel || "acceptable"}`
          : "High Risk label blocks PREMIUM",
    },
    {
      pass: !noPlay,
      reason: !noPlay ? "Pick is playable" : "Pick flagged as no-play",
    },
    {
      pass: cleanMarketQuality >= 55,
      reason:
        cleanMarketQuality >= 55
          ? `Market quality ${cleanMarketQuality} meets threshold`
          : `Market quality ${cleanMarketQuality} below 55 requirement`,
    },
    {
      pass: !severeWarnings,
      reason: severeWarnings
        ? "Severe market warnings present"
        : "No severe market warnings",
    },
  ];

  const premiumGateAudit = buildPremiumGateAudit({
    finalConfidence,
    evidenceReliability,
    dangerPressure,
    riskLabel,
    signal,
    cleanNetEdge,
    noPlay,
    cleanMarketQuality,
    severeWarnings,
  });

  for (const check of premiumChecks) {
    tierReasons.push(check.reason);
  }

  const premiumEligible = premiumChecks.every((check) => check.pass);

  if (premiumEligible) {
    return { tier: "PREMIUM", tierReasons, premiumGateAudit };
  }

  if (finalConfidence >= 60) {
    tierReasons.push(`Confidence ${finalConfidence} qualifies for WATCHLIST`);
    return { tier: "WATCHLIST", tierReasons, premiumGateAudit };
  }

  tierReasons.push(`Confidence ${finalConfidence} stays at LEAN tier`);
  return { tier: "LEAN", tierReasons, premiumGateAudit };
}

function getOpponentFromGame(team, game, league = "NBA") {
  if (!team) return "";

  if (String(league).toUpperCase() === "WNBA") {
    const teamId = resolveWnbaTeamId(team);
    const homeId = resolveWnbaTeamId(game.homeTeam);
    const awayId = resolveWnbaTeamId(game.awayTeam);
    if (teamsMatch(teamId, homeId)) return awayId;
    if (teamsMatch(teamId, awayId)) return homeId;
    return "";
  }

  if (clean(team) === clean(game.homeTeam)) return game.awayTeam;
  if (clean(team) === clean(game.awayTeam)) return game.homeTeam;

  return "";
}

function getCombinedDataQuality({ opportunity = {}, prop = {}, last5 = [], matchupGames = [] }) {
  const values = [];

  const opportunityQuality = num(opportunity.dataQuality);
  const marketQuality = num(prop.marketQuality);

  if (opportunityQuality > 0) values.push(opportunityQuality);
  if (marketQuality > 0) values.push(marketQuality);

  if (last5.length >= 5) values.push(85);
  else if (last5.length >= 3) values.push(65);
  else if (last5.length > 0) values.push(45);

  if (matchupGames.length > 0) values.push(70);

  if (!values.length) return 50;

  return Math.round(average(values));
}

function buildTopPropsFromSelector(gameCards = [], options = {}) {
  return selectControlledBestSixCombined(gameCards, options);
}

function formatStartTimeDisplay(commenceTime) {
  if (!commenceTime) return "";

  const parsed = new Date(commenceTime);

  if (Number.isNaN(parsed.getTime())) return String(commenceTime);

  return (
    parsed.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " CT"
  );
}

async function buildDataIntegrityAuditRequest({
  playerName = "",
  team = "",
  opponent = "",
  league = "WNBA",
  line = 0,
  beforeTime = null,
  includeRecovery = false,
} = {}) {
  const normalizedLeague = String(league || "WNBA").toUpperCase();
  const resolvedTeam = resolveWnbaTeamId(team) || team;
  const resolvedOpponent = resolveWnbaTeamId(opponent) || opponent;

  const last5 = await fetchLast5(playerName, normalizedLeague, {
    beforeTime,
  });
  const ballPlayer = await findBallPlayer(playerName, normalizedLeague);
  const stableId = resolveStableWnbaPlayerId(playerName);
  const playerId = String(ballPlayer?.id || stableId || "");
  const matchupProbe =
    normalizedLeague === "WNBA"
      ? await probeWnbaMatchupLookup({
          playerName,
          playerId,
          playerTeam: resolvedTeam,
          opponent: resolvedOpponent,
          beforeTime,
        })
      : null;
  const matchupGames = await fetchLast3VsOpponent(
    playerName,
    resolvedOpponent,
    normalizedLeague,
    { beforeTime, playerTeam: resolvedTeam }
  );
  const availabilityGate = await evaluateWnbaAvailability({
    playerId,
    playerName,
    league: normalizedLeague,
  });
  const seasonGames = await fetchPlayerStats(playerName, normalizedLeague);
  const seasonAverage = seasonGames.length
    ? seasonGames.reduce((sum, g) => sum + Number(g.points || 0), 0) /
      seasonGames.length
    : 0;
  const matchupAverage = matchupGames.length
    ? Number(
        (
          matchupGames.reduce((sum, g) => sum + Number(g.points || 0), 0) /
          matchupGames.length
        ).toFixed(1)
      )
    : null;

  const dataIntegrity = auditWnbaDataIntegrity({
    playerName,
    playerId,
    team: resolvedTeam,
    opponent: resolvedOpponent,
    last5,
    matchupGames,
    matchupAverage,
    seasonAverage,
    availabilityGate,
    defenseResult: {},
    prop: { line: Number(line) || 0, bookCount: 1 },
    playerState: {
      matchupAverage,
      seasonPoints: seasonAverage,
    },
    ballPlayerResolved: Boolean(ballPlayer),
    stablePlayerIdUsed: Boolean(stableId && String(ballPlayer?.id) === stableId),
    matchupProbe,
  });

  let dataRecovery = null;
  let finalIntegrity = dataIntegrity;
  let recoveryContext = null;

  if (includeRecovery) {
    const recoveryResult = await attemptWnbaDataRecovery(
      {
        playerName,
        playerId,
        team: resolvedTeam,
        opponent: resolvedOpponent,
        last5,
        matchupGames,
        matchupAverage,
        seasonAverage,
        availabilityGate,
        defenseResult: {},
        prop: { line: Number(line) || 0, bookCount: 1 },
        playerState: {
          matchupAverage,
          seasonPoints: seasonAverage,
        },
        ballPlayerResolved: Boolean(ballPlayer),
        stablePlayerIdUsed: Boolean(stableId && String(ballPlayer?.id) === stableId),
        beforeTime,
        evaluateAvailability: evaluateWnbaAvailability,
      },
      dataIntegrity
    );
    finalIntegrity = attachDataRecoveryToIntegrity(
      recoveryResult.dataIntegrity,
      recoveryResult.dataRecovery
    );
    dataRecovery = recoveryResult.dataRecovery;
    recoveryContext = recoveryResult.context;
  }

  return {
    playerName,
    team: resolvedTeam,
    opponent: resolvedOpponent,
    playerId: recoveryContext?.playerId || playerId || null,
    matchupGames: (recoveryContext?.matchupGames || matchupGames).map((g) => ({
      date: g.date,
      opponent: g.opponent,
      opponentTeamId: g.opponentTeamId || g.opponent,
      points: g.points,
    })),
    matchupAverage:
      recoveryContext?.playerState?.matchupAverage ?? matchupAverage,
    availabilityGate: recoveryContext?.availabilityGate || availabilityGate,
    dataIntegrity: finalIntegrity,
    dataIntegrityVersion: DATA_INTEGRITY_VERSION,
    dataRecovery,
    dataRecoveryVersion: includeRecovery ? DATA_RECOVERY_VERSION : null,
    beforeIntegrity: includeRecovery ? dataIntegrity : null,
    serverBuild: SERVER_BUILD,
    auditedAt: new Date().toISOString(),
  };
}

async function buildSlateRejectionChain({
  slateDate = "",
  league = "WNBA",
  includeRecovery = false,
} = {}) {
  if (!cacheFresh()) {
    await refreshAllPicks();
  }

  const generatedProps = picksCache?.generatedProps || [];
  const analysis = buildSlateRejectionAnalysisFromProps(generatedProps, {
    slateDate,
    league,
  });

  return {
    ...analysis,
    serverBuild: SERVER_BUILD,
    dataRecoveryVersion: DATA_RECOVERY_VERSION,
    includeRecovery,
    slateDate,
    analyzedAt: new Date().toISOString(),
  };
}

function createSideAudit() {
  return {
    rawOverLines: 0,
    rawUnderLines: 0,
    overCandidatesBuilt: 0,
    underCandidatesBuilt: 0,
    chosenOver: 0,
    chosenUnder: 0,
    rejectedOver: 0,
    rejectedUnder: 0,
    rejectionReasons: {},
    fairLineOver: 0,
    fairLineUnder: 0,
    fairLineNone: 0,
    currentSideOver: 0,
    currentSideUnder: 0,
    sideMatchCount: 0,
    sideMismatchCount: 0,
  };
}

function trackSideAuditRejection(audit, side, reasons = []) {
  const normalizedSide = String(side || "").toUpperCase();

  if (normalizedSide === "OVER") {
    audit.rejectedOver += 1;
  } else if (normalizedSide === "UNDER") {
    audit.rejectedUnder += 1;
  }

  for (const reason of reasons) {
    audit.rejectionReasons[reason] = Number(audit.rejectionReasons[reason] || 0) + 1;
  }
}

async function buildPicksForDay(daysAhead = 0, league = "NBA") {
  const games = await fetchOddsGameCards(league, daysAhead);
  const sideAudit = createSideAudit();

  console.log("PROPS PIPELINE GAMES FETCHED:", {
    league,
    daysAhead,
    gamesFetched: games.length,
  });

  const players = league === "NBA" ? await fetchPlayers() : [];
  const seasonStats = league === "NBA" ? await fetchSeasonStats() : [];
  const projections = league === "NBA" ? await fetchProjections(daysAhead) : [];

  const { playerMap, seasonMap, projectionMap } = buildPlayerContextMaps({
    players,
    seasonStats,
    projections,
  });

  const teamStatsMap =
    league === "NBA"
      ? buildTeamStatsMap(await fetchTeamSeasonStats())
      : null;

  const gameCards = [];

  for (const game of games) {
    console.log("BUILDING GAME:", {
      league,
      game: game.game,
      date: game.date,
      time: game.time,
      isStarted: game.isStarted,
    });

    const oddsEvent =
      game.oddsEventId
        ? { id: game.oddsEventId }
        : await findOddsEventForGame(game, league);

    if (!oddsEvent) {
      gameCards.push({
        ...game,
        picks: [],
        message: "No sportsbook event found yet.",
      });
      continue;
    }

    const rawProps = await fetchPointsPropsForEvent(oddsEvent.id, league);
    const props = buildConsensusPointProps(rawProps);
    const gameSpread = await fetchConsensusGameSpread(oddsEvent.id, league);
    const wnbaGameContext =
      league === "WNBA" && isCourteEdgeWnbaV1Enabled()
        ? await buildWnbaGameContext({
            oddsEventId: oddsEvent.id,
            league,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
          })
        : null;
    const blowoutRisk =
      wnbaGameContext?.blowoutRisk ??
      computeBlowoutRiskFromSpread(gameSpread);

    sideAudit.rawOverLines += rawProps.filter((prop) => prop.side === "Over").length;
    sideAudit.rawUnderLines += rawProps.filter((prop) => prop.side === "Under").length;

    console.log("PROPS PIPELINE EVENT:", {
      league,
      game: game.game,
      oddsEventId: oddsEvent.id,
      rawPropCount: rawProps.length,
      consensusPropCount: props.length,
    });

    const builtPicks = [];
    const rejectedPicks = [];

    for (const prop of props) {
      const playerName = prop.player;

      const team =
        league === "WNBA"
          ? await getBallPlayerTeam(playerName, league)
          : getTeamForPlayer(playerName, playerMap, projectionMap, seasonMap);

      if (!team) {
        trackSideAuditRejection(sideAudit, null, ["Missing player data"]);
        rejectedPicks.push({
          player: playerName,
          reason: "no team match",
        });
        console.log("SKIP PICK - NO TEAM:", {
          league,
          playerName,
          game: game.game,
        });
        continue;
      }

      const safeTeam = team;

      const opponent =
        league === "WNBA"
          ? getOpponentFromGame(team, game, league)
          : getOpponentForTeam(game, team) || getOpponentFromGame(team, game, league);

      if (!opponent) {
        trackSideAuditRejection(sideAudit, null, ["Missing player data"]);
        rejectedPicks.push({
          player: playerName,
          team,
          reason: "no opponent match",
        });
        console.log("SKIP PICK - NO OPPONENT:", {
          league,
          playerName,
          team,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          game: game.game,
        });
        continue;
      }

      const projectionData = projectionMap.get(clean(playerName)) || {};
      const gameCutoff = game.commenceTime || game.time || game.date;

      const last5 = await fetchLast5(playerName, league, {
        beforeTime: gameCutoff,
      });

      const bdlSeasonGamesRaw =
        league === "WNBA" ? await fetchPlayerStats(playerName, league) : [];

      const bdlSeasonGames = filterGamesBeforeCutoff(
        bdlSeasonGamesRaw,
        gameCutoff
      );

      const bdlSeasonAverage =
        league === "WNBA" ? avgPoints(bdlSeasonGames) : 0;

      const seasonAverage =
        league === "WNBA"
          ? bdlSeasonAverage
          : getSeasonPoints(playerName, seasonMap);

      const sportsProjection =
        league === "WNBA"
          ? 0
          : getProjectionPoints(playerName, projectionMap);

      const matchupGames = await fetchLast3VsOpponent(
        playerName,
        opponent,
        league,
        { beforeTime: gameCutoff, playerTeam: team }
      );

      const last5Profile = summarizeScoringProfile(last5);

      const opponentMatchup = summarizeOpponentMatchup(
        matchupGames,
        prop.line,
        last5Profile
      );

      const baseOpportunity = buildOpportunityScore({
        last5,
        projection: projectionData,
        seasonAverage,
        isPlayoff: true,
        league,
      });

      const playerData =
        playerMap.get(clean(playerName)) || projectionData || {};

      const wnbaBallPlayer =
        league === "WNBA" ? await findBallPlayer(playerName, league) : null;
      const wnbaPlayerId = String(
        wnbaBallPlayer?.id ||
          resolveStableWnbaPlayerId(playerName) ||
          playerData.PlayerID ||
          playerData.id ||
          ""
      );

      const missingPlayers =
        league === "WNBA" ? [] : getMissingPlayers(safeTeam, players);

      const usage =
        league === "WNBA"
          ? {
              confidenceBoost: 0,
              projectionBoost: 0,
              reasons: [],
              log: `WNBA usage boost skipped for ${playerName}`,
            }
          : calcUsageBoost(
              {
                ...playerData,
                ...projectionData,
                Name: playerName,
              },
              "Points",
              missingPlayers
            );

      console.log(usage.log);

      const baseSportsProjection = Number(sportsProjection || 0);
      const usageProjectionBoost = Number(usage.projectionBoost || 0);

      const adjustedSportsProjection =
        baseSportsProjection > 0
          ? Math.max(0, baseSportsProjection + usageProjectionBoost)
          : 0;

      const opportunity = {
        ...baseOpportunity,
        opportunityScore: Math.min(
          100,
          Number(baseOpportunity.opportunityScore || 0) +
            Number(usage.confidenceBoost || 0)
        ),
        reasons: [
          ...(baseOpportunity.reasons || []),
          ...(usage.reasons || []).map((r) => `Usage boost from missing ${r}`),
        ],
        risks: baseOpportunity.risks || [],
        usageBoost: usage,
      };

      const playerState = buildPlayerState({
        playerName,
        playerId: wnbaPlayerId || playerData.PlayerID || projectionData.PlayerID || "",
        league,
        team: safeTeam,
        opponent,
        gameDate: game.date,
        commenceTime: game.commenceTime || game.time,
        prop,
        last5,
        bdlSeasonGames,
        seasonMap,
        seasonAverage,
        sportsProjection: adjustedSportsProjection || sportsProjection,
        matchupGames,
        opportunity,
      });

      const roleChange = buildRoleChange(
        playerState,
        league === "NBA" ? usage : null
      );

      const volumeProfile = buildVolumeProfile({
        playerState,
        opportunity,
        roleChange,
        league,
      });

      const availabilityGate =
        league === "WNBA" && isCourteEdgeWnbaV1Enabled()
          ? await evaluateWnbaAvailability({
              playerId: wnbaPlayerId || playerData.PlayerID || playerData.id || "",
              playerName,
              league,
            })
          : evaluateAvailabilityGate({
              playerData,
              league,
            });

      if (availabilityGate.noPlay) {
        trackSideAuditRejection(sideAudit, null, availabilityGate.noPlayReasons);
        rejectedPicks.push({
          player: playerName,
          line: prop.line,
          reason: "no-play",
          details: availabilityGate.noPlayReasons,
        });
        console.log("NO PLAY - AVAILABILITY:", {
          league,
          playerName,
          status: availabilityGate.status,
          noPlayReasons: availabilityGate.noPlayReasons,
        });
        continue;
      }

      const defenseResult =
        league === "WNBA" && isCourteEdgeWnbaV1Enabled()
          ? await buildWnbaOpponentDefenseContext({
              opponentTeam: opponent,
              league,
            })
          : computeDefenseScore({
              opponentTeam: opponent,
              teamStatsMap,
              league,
            });

      const priorOpening = getOpeningLine({
        league,
        gameDate: game.date,
        player: playerName,
        stat: "Points",
        gameId: game.gameId || game.id || "",
      });
      const trackedSeed = getTrackedProps().find(
        (t) =>
          String(t.player || "").toLowerCase() === String(playerName).toLowerCase() &&
          String(t.slateDate || t.gameDate || "").slice(0, 10) ===
            String(game.date || "").slice(0, 10)
      );
      const marketSnapshot = appendMarketSnapshot({
        league,
        gameDate: game.date,
        commenceTime: game.commenceTime || game.time,
        player: playerName,
        team: safeTeam,
        opponent,
        gameId: game.gameId || game.id || "",
        stat: "Points",
        bookLine: prop.line,
        bookCount: prop.bookCount,
        marketQuality: prop.marketQuality,
        lineSpread: prop.lineSpread,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
        seedOpeningLine:
          priorOpening?.openingLine ||
          trackedSeed?.openingLine ||
          trackedSeed?.officialLine ||
          null,
      });

      const playoff = buildPlayoffContext({
        last5,
        matchupGames,
        line: prop.line,
        opportunityScore: opportunity.opportunityScore,
      });

      const dataQuality = getCombinedDataQuality({
        opportunity,
        prop,
        last5,
        matchupGames,
      });

      console.log("PICK DATA CHECK:", {
        league,
        playerName,
        line: prop.line,
        team: safeTeam,
        opponent,
        seasonAverage,
        sportsProjection,
        adjustedSportsProjection,
        last5Points: last5.map((g) => g.points),
        matchupGames: matchupGames.length,
        opponentMatchup,
        minutes: opportunity.recentMinutes,
        fga: opportunity.recentFGA,
        fta: opportunity.recentFTA,
        opportunityScore: opportunity.opportunityScore,
        dataQuality,
        marketQuality: prop.marketQuality,
        bookCount: prop.bookCount,
      });

      if (league === "WNBA" && isCourteEdgeWnbaV2Enabled()) {
        const v2Result = await evaluateWnbaPropDecision({
          playerName,
          team: safeTeam,
          opponent,
          game,
          prop,
          last5,
          bdlSeasonGames,
          seasonAverage,
          matchupGames,
          opponentMatchup,
          blowoutRisk,
          wnbaGameContext,
          availabilityGate,
          defenseResult,
          marketSnapshot,
          playoff,
        });

        if (!v2Result.accepted) {
          trackSideAuditRejection(
            sideAudit,
            null,
            v2Result.rejection?.details || ["WNBA v2 no-play"]
          );
          rejectedPicks.push(v2Result.rejection);
          console.log("NO PLAY - WNBA V2:", {
            league,
            playerName,
            line: prop.line,
            reader: v2Result.reader?.decision,
            reasonCodes: v2Result.reader?.reasonCodes,
          });
          continue;
        }

        const v2Pick = v2Result.pick;
        if (v2Result.pickSide === "OVER") {
          sideAudit.chosenOver += 1;
          sideAudit.currentSideOver += 1;
        } else if (v2Result.pickSide === "UNDER") {
          sideAudit.chosenUnder += 1;
          sideAudit.currentSideUnder += 1;
        }

        builtPicks.push({
          ...v2Pick,
          label: `${playerName} ? ${safeTeam} ${v2Pick.pick} ${prop.line} Points`,
        });
        continue;
      }

      const overPick = buildWinProbability({
        player: playerName,
        team: safeTeam,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Over",
        seasonAverage,
        sportsProjection: adjustedSportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        opponentMatchup,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      const underPick = buildWinProbability({
        player: playerName,
        team: safeTeam,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Under",
        seasonAverage,
        sportsProjection: adjustedSportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        opponentMatchup,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      let riskComparison = compareOverUnderRisk({
        playerName,
        line: prop.line,
        projection: adjustedSportsProjection || overPick.projection,
        seasonAvg: seasonAverage,
        last5Avg: overPick.last5Average,
        minutesAvg: opportunity.recentMinutes,
        fgaAvg: opportunity.recentFGA,
        ftaAvg: opportunity.recentFTA,
        usageScore: opportunity.usageBoost?.confidenceBoost
          ? 50 + Number(opportunity.usageBoost.confidenceBoost)
          : 50,
        opportunityScore: opportunity.opportunityScore,
        matchupScore: overPick.matchupHitRate || 50,
        defenseScore: defenseResult.defenseScore,
        roleCertainty: opportunity.roleCertainty || 50,
        blowoutRisk,
        dataQuality,
        rawQuality: opportunity.rawQuality,
        dataCoverage: opportunity.dataCoverage,
        marketQuality: prop.marketQuality,
      });

      if (riskComparison.pickSide === "OVER") {
        sideAudit.overCandidatesBuilt += 1;
      } else if (riskComparison.pickSide === "UNDER") {
        sideAudit.underCandidatesBuilt += 1;
      }

      const marketIntelligence = buildMarketIntelligence({
        prop,
        marketSnapshot,
        side: riskComparison.pickSide,
        volumeProfile,
      });

      const volumeDangerGates = evaluateVolumeDangerGates({
        volumeProfile,
        side: riskComparison.pickSide,
        league,
        opportunity,
      });

      riskComparison = mergeIntelligenceIntoRiskComparison(riskComparison, {
        volumeDangerGates,
        marketIntelligence,
        availabilityGate,
        pickSide: riskComparison.pickSide,
      });

      const preSideFairLine =
        league === "WNBA" && isCourteEdgeWnbaV1Enabled()
          ? buildFairLine({
              playerState,
              roleChange,
              prop,
              auditOldSide: riskComparison.pickSide || "",
            })
          : null;

      const sideSelection =
        league === "WNBA" && isCourteEdgeWnbaV1Enabled()
          ? evaluateSideSelection({
              league,
              line: prop.line,
              projection: adjustedSportsProjection || overPick.projection,
              seasonAvg: seasonAverage,
              last5Avg: overPick.last5Average,
              minutesAvg: opportunity.recentMinutes,
              fgaAvg: opportunity.recentFGA,
              ftaAvg: opportunity.recentFTA,
              roleCertainty: opportunity.roleCertainty || 50,
              blowoutRisk,
              dataQuality,
              marketQuality: prop.marketQuality,
              lineSpread: prop.lineSpread,
              lineDelta: marketIntelligence.lineDelta,
              bookCount: prop.bookCount,
              playerState,
              roleChange,
              prop,
              riskComparison,
              fairLine: preSideFairLine,
              availabilityGate,
              volumeProfile,
              volumeDangerGates,
              marketIntelligence,
              wnbaGameContext,
            })
          : null;

      const resolvedPickSide = sideSelection?.finalSide || riskComparison.pickSide;

      let bestPick =
        resolvedPickSide === "OVER"
          ? overPick
          : resolvedPickSide === "UNDER"
            ? underPick
            : null;

      const sideSelectionBlocks =
        sideSelection?.finalDecision === "NO_BET" || sideSelection?.trackingType === "NO_BET";
      const legacyBlocks = !bestPick || !riskComparison.trustable;
      const shouldReject =
        league === "WNBA" && isCourteEdgeWnbaV1Enabled()
          ? sideSelectionBlocks || !bestPick
          : legacyBlocks;

      if (shouldReject) {
        const rejectionReasons =
          sideSelection?.noBetReasons?.length
            ? sideSelection.noBetReasons
            : riskComparison.noPlayReasons;
        trackSideAuditRejection(sideAudit, resolvedPickSide, rejectionReasons);
        rejectedPicks.push({
          player: playerName,
          line: prop.line,
          reason: "no-play",
          details: rejectionReasons,
        });
        console.log("NO PLAY:", {
          league,
          playerName,
          line: prop.line,
          pickSide: resolvedPickSide,
          noPlayReasons: rejectionReasons,
          sideSelection: sideSelection?.finalDecision,
          supportScore: riskComparison.supportScore,
          resistanceScore: riskComparison.resistanceScore,
          netEdge: riskComparison.netEdge,
        });
        continue;
      }

      if (sideSelection?.finalSide) {
        riskComparison = {
          ...riskComparison,
          pickSide: sideSelection.finalSide,
        };
      }

      const {
        rawConfidenceBeforeReliability,
        evidenceReliability,
        dangerPressure,
        finalConfidence,
        confidenceAdjustmentReasons,
        reliabilityInputAudit,
      } = applyReliabilityAdjustedConfidence({
        rawConfidence: bestPick.rawWinProbability,
        riskComparison,
        opportunity,
        prop,
        extraDangerPressure: num(riskComparison.extraDangerPressure),
        extraDangerReasons: [
          ...(volumeDangerGates.dangerReasons || []),
          ...(marketIntelligence.dangerReasons || []),
          ...(availabilityGate.dangerReasons || []),
        ],
      });

      const { tier, tierReasons, premiumGateAudit } = getTier({
        finalConfidence,
        evidenceReliability,
        dangerPressure,
        riskLabel: riskComparison.riskLabel,
        signalStrength: riskComparison.signalStrength,
        netEdge: riskComparison.netEdge,
        noPlay: riskComparison.noPlay,
        marketQuality: prop.marketQuality,
        marketWarnings: prop.marketWarnings,
        bookCount: prop.bookCount,
      });

      bestPick = {
        ...bestPick,

        league,
        gameId: game.gameId || game.id,
        gameDate: game.date,
        commenceTime: game.commenceTime || game.time,
        startTimeDisplay: formatStartTimeDisplay(
          game.commenceTime || game.time
        ),
        date: game.date,
        dateLabel: game.dateLabel,
        dayBucket: game.dayBucket || "",
        game: game.game,

        pick: riskComparison.pickSide === "OVER" ? "Over" : "Under",
        side: riskComparison.pickSide === "OVER" ? "Over" : "Under",

        recentMinutes: opportunity.recentMinutes,
        recentFGA: opportunity.recentFGA,
        recentFTA: opportunity.recentFTA,
        minutesAverage: opportunity.recentMinutes,
        fgaAverage: opportunity.recentFGA,
        ftaAverage: opportunity.recentFTA,
        opportunityScore: opportunity.opportunityScore,
        dataCoverage: opportunity.dataCoverage,

        rawConfidenceBeforeReliability,
        evidenceReliability,
        dangerPressure,
        finalConfidence,
        confidenceAdjustmentReasons,
        tierReasons,
        premiumGateAudit,
        reliabilityInputAudit,

        winProbability: finalConfidence,
        confidence: finalConfidence,
        strength: strengthFromConfidence(finalConfidence),
        tier,

        riskLabel: riskComparison.riskLabel,
        overRisk: riskComparison.overRisk,
        underRisk: riskComparison.underRisk,
        chosenRisk: riskComparison.chosenRisk,
        riskGap: riskComparison.riskGap,

        support: riskComparison.support,
        resistance: riskComparison.resistance,
        supportScore: riskComparison.supportScore,
        resistanceScore: riskComparison.resistanceScore,
        netEdge: riskComparison.netEdge,
        signalStrength: riskComparison.signalStrength,
        totalEvidence: riskComparison.totalEvidence,

        overSupportScore: riskComparison.overSupportScore,
        underSupportScore: riskComparison.underSupportScore,
        overResistanceScore: riskComparison.overResistanceScore,
        underResistanceScore: riskComparison.underResistanceScore,
        overNet: riskComparison.overNet,
        underNet: riskComparison.underNet,

        riskReasons: riskComparison.reasons,
        riskWarnings: riskComparison.warnings,
        noPlay: riskComparison.noPlay,
        noPlayReasons: riskComparison.noPlayReasons,

        sportsbookLine: prop.line,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,

        bookCount: prop.bookCount,
        consensusBookCount: prop.consensusBookCount,
        overBookCount: prop.overBookCount,
        underBookCount: prop.underBookCount,
        lineSpread: prop.lineSpread,
        consensusLine: prop.consensusLine,
        hasBothSides: prop.hasBothSides,
        marketQuality: prop.marketQuality,
        marketGrade: prop.marketGrade,
        marketStrengths: prop.marketStrengths,
        marketWarnings: prop.marketWarnings,

        dataQuality,
        last5Profile,

        grading: {
          support: riskComparison.support,
          resistance: riskComparison.resistance,
          supportScore: riskComparison.supportScore,
          resistanceScore: riskComparison.resistanceScore,
          netEdge: riskComparison.netEdge,
          signalStrength: riskComparison.signalStrength,
          riskLabel: riskComparison.riskLabel,
          chosenRisk: riskComparison.chosenRisk,
          confidence: finalConfidence,
          tier,
          dataQuality,
          marketQuality: prop.marketQuality,
          bookCount: prop.bookCount,
        },

        reasons: [...new Set(riskComparison.support || [])].slice(0, 6),
        risks: [...new Set(riskComparison.resistance || [])].slice(0, 5),

        playerState,
        roleChange,
        volumeProfile,
        volumeDangerGates,
        marketIntelligence,
        availabilityGate,
        defenseResult,
        dataMode: playerState.dataMode,

        snapshotId: marketSnapshot.snapshotId,
        snapshotTime: marketSnapshot.snapshotTime,
        openingLine: marketSnapshot.openingLine,
        currentLine: marketSnapshot.currentLine,
        lineDelta: marketIntelligence.lineDelta,
      };

      const fairLine = preSideFairLine ||
        buildFairLine({
          playerState,
          roleChange,
          prop,
          auditOldSide: bestPick.side || bestPick.pick,
        });

      bestPick = {
        ...bestPick,
        ...fairLine,
      };

      if (sideSelection && !(league === "WNBA" && isCourteEdgeWnbaV1Enabled())) {
        bestPick = {
          ...bestPick,
          trackingType: sideSelection.trackingType,
          recordType: sideSelection.recordType,
          engineVersion: sideSelection.engineVersion,
          generatedAfterV1: sideSelection.generatedAfterV1,
          officialEligible: sideSelection.officialEligible,
          excludedFromOfficialRecord: sideSelection.excludedFromOfficialRecord,
          testReason: sideSelection.testReasons?.join("; ") || null,
          testReasons: sideSelection.testReasons || [],
          v1OfficialGatePassed: sideSelection.v1OfficialGatePassed,
          sideSelectionDecision: sideSelection.sideSelectionDecision,
          sideSelectionAudit: sideSelection.sideSelectionAudit,
          contradictions: sideSelection.contradictions,
          noBetReasons: sideSelection.noBetReasons,
          sideTrustScore: sideSelection.sideTrustScore,
          sideTrustable: sideSelection.sideTrustable,
          trustable: sideSelection.trustable,
          noPlay: sideSelection.noPlay,
        };
      }

      bestPick.scoreLedger = buildScoreLedger({
        side: bestPick.side || bestPick.pick,
        projection: adjustedSportsProjection || bestPick.projection,
        line: prop.line,
        seasonAverage,
        last5Average: bestPick.last5Average,
        fairLine: bestPick.fairLine,
        fairLineEdge: bestPick.fairLineEdge,
        volumeProfile,
        volumeDangerGates,
        marketIntelligence,
        availabilityGate,
        defenseResult,
        opportunity,
        riskComparison,
        dataQuality,
      });

      if (league === "WNBA" && isWnbaShadowRecalibrationEnabled()) {
        const defenseShadow = await buildWnbaDefenseShadowContext({
          opponentTeam: opponent,
          league,
        });
        bestPick.wnbaShadow = applyWnbaShadowRecalibration(bestPick, {
          wnbaDefenseProbe: defenseShadow.wnbaDefenseProbe,
          wnbaDefenseScore: defenseShadow.wnbaDefenseScore,
        });
        if (bestPick.wnbaShadow) {
          bestPick.marketIntelligence = {
            ...bestPick.marketIntelligence,
            lineMovementAgainstSide: bestPick.wnbaShadow.lineMovementAgainstSide,
          };
        }
      }

      if (league === "WNBA" && isCourteEdgeWnbaV1Enabled()) {
        const pickGameContext = enrichWnbaGameContextForTeam(
          wnbaGameContext,
          safeTeam
        );

        bestPick = applyWnbaOfficialV1Rules(bestPick, {
          availabilityGate,
          defenseResult,
          wnbaGameContext: pickGameContext,
        });

        if (sideSelection) {
          const finalized = finalizeSideTrackingDecision(bestPick, sideSelection);
          bestPick = {
            ...bestPick,
            ...finalized,
            sideSelectionAudit: sideSelection.sideSelectionAudit,
            contradictions: sideSelection.contradictions,
            sideTrustScore: sideSelection.sideTrustScore,
            sideTrustable: sideSelection.sideTrustable,
            engineVersion: sideSelection.engineVersion,
            generatedAfterV1: sideSelection.generatedAfterV1,
          };
        }
      }

      if (fairLine.fairLineSide === "OVER") {
        sideAudit.fairLineOver += 1;
      } else if (fairLine.fairLineSide === "UNDER") {
        sideAudit.fairLineUnder += 1;
      } else {
        sideAudit.fairLineNone += 1;
      }

      if (riskComparison.pickSide === "OVER") {
        sideAudit.currentSideOver += 1;
      } else if (riskComparison.pickSide === "UNDER") {
        sideAudit.currentSideUnder += 1;
      }

      if (fairLine.fairLineSide !== "NONE") {
        if (fairLine.auditSideMatch) {
          sideAudit.sideMatchCount += 1;
        } else {
          sideAudit.sideMismatchCount += 1;
        }
      }

      if (isEngineExpansionEnabled() && !bestPick.courtEdgeEngineSignalsV1) {
        bestPick = attachCourtEdgeEngineSignals(bestPick, {
          league,
          playerId: bestPick.playerId || null,
          gameId: game.gameId || game.id,
          organicModelSide: bestPick.side || bestPick.pick,
          finalSide: bestPick.side || bestPick.pick,
          projection: bestPick.projection,
          line: prop.line,
          openingLine: marketSnapshot.openingLine ?? bestPick.openingLine,
          currentLine: marketSnapshot.currentLine ?? prop.line,
          gameLogs: last5 || [],
          seasonAverage,
          bookCount: prop.bookCount,
          overOdds: prop.overOdds,
          underOdds: prop.underOdds,
          availabilityStatus: availabilityGate?.status || availabilityGate?.level,
          injuryFeedOk: availabilityGate?.feedFetchOk !== false,
          scoringEnvironmentProxy: defenseResult?.paceProxy ?? null,
          opponentDefenseContext: defenseResult,
          originalModelConfidence: bestPick.confidence,
          force: true,
        });
        bestPick = applyEngineSignalAdjustments(bestPick);
        bestPick.originalModelSide =
          bestPick.originalModelSide ||
          (String(bestPick.side || bestPick.pick || "")
            .toUpperCase()
            .startsWith("U")
            ? "UNDER"
            : "OVER");
      }

      builtPicks.push({
        ...bestPick,
        label: `${playerName} ? ${safeTeam} ${bestPick.pick} ${prop.line} Points`,
      });

      if (riskComparison.pickSide === "OVER") {
        sideAudit.chosenOver += 1;
      } else if (riskComparison.pickSide === "UNDER") {
        sideAudit.chosenUnder += 1;
      }
    }

    const rankedGame = buildTopPicksForGame({
      game,
      picks: builtPicks,
    });

    console.log("PROPS PIPELINE FINAL:", {
      league,
      game: game.game,
      rawPropCount: rawProps.length,
      consensusPropCount: props.length,
      builtPickCount: builtPicks.length,
      displayPickCount: rankedGame.picks?.length || 0,
      playablePickCount: rankedGame.playableCandidateCount || 0,
      rejectedPickCount: rejectedPicks.length,
      rejectedSample: rejectedPicks.slice(0, 5),
    });

    gameCards.push({
      ...rankedGame,
      allGeneratedCandidates: builtPicks.map((pick) => ({ ...pick })),
      rawPropCount: rawProps.length,
      consensusPropCount: props.length,
      rejectedPickCount: rejectedPicks.length,
    });
  }

  console.log("SIDE AUDIT:", {
    league,
    daysAhead,
    ...sideAudit,
    topRejectionReasons: Object.entries(sideAudit.rejectionReasons || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  });

  return { gameCards, sideAudit };
}

function ensureWnbaGateOnPick(pick = {}) {
  if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;
  if (!pick.wnbaDataCard && !pick.wnbaReader) return pick;
  if (
    pick.decisionIntelligence?.version === DECISION_INTELLIGENCE_VERSION &&
    pick.decisionIntelligence?.trackEligibility &&
    pick.wnbaTrackingDecision &&
    pick.riskAfterCeiling
  ) {
    return pick;
  }
  const gate = evaluateWnbaTrackingEligibility(pick, pick.wnbaDataCard, pick.wnbaReader);
  return applyDecisionIntelligenceToPick(pick, null, gate);
}

function ensureWnbaGateOnGames(games = []) {
  return games.map((game) => {
    const picks = (game.picks || []).map(ensureWnbaGateOnPick);
    const allGeneratedCandidates = (game.allGeneratedCandidates || picks).map(
      ensureWnbaGateOnPick
    );
    return {
      ...game,
      picks,
      allGeneratedCandidates,
    };
  });
}

async function refreshAllPicks() {
  const sideAudit = createSideAudit();

  const todayNba = await buildPicksForDay(0, "NBA");
  const todayWnba = await buildPicksForDay(0, "WNBA");
  const tomorrowNba = await buildPicksForDay(1, "NBA");
  const tomorrowWnba = await buildPicksForDay(1, "WNBA");

  sideAudit.rawOverLines =
    todayNba.sideAudit.rawOverLines +
    todayWnba.sideAudit.rawOverLines +
    tomorrowNba.sideAudit.rawOverLines +
    tomorrowWnba.sideAudit.rawOverLines;
  sideAudit.rawUnderLines =
    todayNba.sideAudit.rawUnderLines +
    todayWnba.sideAudit.rawUnderLines +
    tomorrowNba.sideAudit.rawUnderLines +
    tomorrowWnba.sideAudit.rawUnderLines;
  sideAudit.overCandidatesBuilt =
    todayNba.sideAudit.overCandidatesBuilt +
    todayWnba.sideAudit.overCandidatesBuilt +
    tomorrowNba.sideAudit.overCandidatesBuilt +
    tomorrowWnba.sideAudit.overCandidatesBuilt;
  sideAudit.underCandidatesBuilt =
    todayNba.sideAudit.underCandidatesBuilt +
    todayWnba.sideAudit.underCandidatesBuilt +
    tomorrowNba.sideAudit.underCandidatesBuilt +
    tomorrowWnba.sideAudit.underCandidatesBuilt;
  sideAudit.chosenOver =
    todayNba.sideAudit.chosenOver +
    todayWnba.sideAudit.chosenOver +
    tomorrowNba.sideAudit.chosenOver +
    tomorrowWnba.sideAudit.chosenOver;
  sideAudit.chosenUnder =
    todayNba.sideAudit.chosenUnder +
    todayWnba.sideAudit.chosenUnder +
    tomorrowNba.sideAudit.chosenUnder +
    tomorrowWnba.sideAudit.chosenUnder;
  sideAudit.rejectedOver =
    todayNba.sideAudit.rejectedOver +
    todayWnba.sideAudit.rejectedOver +
    tomorrowNba.sideAudit.rejectedOver +
    tomorrowWnba.sideAudit.rejectedOver;
  sideAudit.rejectedUnder =
    todayNba.sideAudit.rejectedUnder +
    todayWnba.sideAudit.rejectedUnder +
    tomorrowNba.sideAudit.rejectedUnder +
    tomorrowWnba.sideAudit.rejectedUnder;
  sideAudit.fairLineOver =
    todayNba.sideAudit.fairLineOver +
    todayWnba.sideAudit.fairLineOver +
    tomorrowNba.sideAudit.fairLineOver +
    tomorrowWnba.sideAudit.fairLineOver;
  sideAudit.fairLineUnder =
    todayNba.sideAudit.fairLineUnder +
    todayWnba.sideAudit.fairLineUnder +
    tomorrowNba.sideAudit.fairLineUnder +
    tomorrowWnba.sideAudit.fairLineUnder;
  sideAudit.fairLineNone =
    todayNba.sideAudit.fairLineNone +
    todayWnba.sideAudit.fairLineNone +
    tomorrowNba.sideAudit.fairLineNone +
    tomorrowWnba.sideAudit.fairLineNone;
  sideAudit.currentSideOver =
    todayNba.sideAudit.currentSideOver +
    todayWnba.sideAudit.currentSideOver +
    tomorrowNba.sideAudit.currentSideOver +
    tomorrowWnba.sideAudit.currentSideOver;
  sideAudit.currentSideUnder =
    todayNba.sideAudit.currentSideUnder +
    todayWnba.sideAudit.currentSideUnder +
    tomorrowNba.sideAudit.currentSideUnder +
    tomorrowWnba.sideAudit.currentSideUnder;
  sideAudit.sideMatchCount =
    todayNba.sideAudit.sideMatchCount +
    todayWnba.sideAudit.sideMatchCount +
    tomorrowNba.sideAudit.sideMatchCount +
    tomorrowWnba.sideAudit.sideMatchCount;
  sideAudit.sideMismatchCount =
    todayNba.sideAudit.sideMismatchCount +
    todayWnba.sideAudit.sideMismatchCount +
    tomorrowNba.sideAudit.sideMismatchCount +
    tomorrowWnba.sideAudit.sideMismatchCount;

  for (const partial of [
    todayNba.sideAudit,
    todayWnba.sideAudit,
    tomorrowNba.sideAudit,
    tomorrowWnba.sideAudit,
  ]) {
    for (const [reason, count] of Object.entries(partial.rejectionReasons || {})) {
      sideAudit.rejectionReasons[reason] =
        Number(sideAudit.rejectionReasons[reason] || 0) + Number(count || 0);
    }
  }

  const todayCards = [...todayNba.gameCards, ...todayWnba.gameCards];
  const tomorrowCards = [...tomorrowNba.gameCards, ...tomorrowWnba.gameCards];

  // Empty/failed odds refresh must not touch Official tracked membership or wipe board.
  const previousBoard = getReadOnlyBoard();
  if (
    todayCards.length === 0 &&
    tomorrowCards.length === 0 &&
    Array.isArray(previousBoard?.games) &&
    previousBoard.games.length > 0
  ) {
    console.log(
      "REFRESH SKIPPED TRACKED MUTATIONS: empty board ? preserving existing board cache"
    );
    return {
      ...previousBoard,
      ok: true,
      incomplete: true,
      preservedBoard: true,
      message:
        "Refresh returned empty board ? preserved existing board and skipped tracked mutations",
      serverBuild: SERVER_BUILD,
      lastUpdated: previousBoard.lastUpdated || new Date().toISOString(),
    };
  }

  const games = ensureWnbaGateOnGames([
    ...todayCards.map((g) => ({
      ...g,
      dateLabel: "Today",
      dayBucket: "TODAY",
    })),
    ...tomorrowCards.map((g) => ({
      ...g,
      dateLabel: "Tomorrow",
      dayBucket: "TOMORROW",
    })),
  ]);

  const nbaGames = games.filter((g) => g.league === "NBA");
  const wnbaGames = games.filter((g) => g.league === "WNBA");

  const controlledSelection = buildTopPropsFromSelector(games);
  const cohortBundle = buildControlledTrackingCohort(
    { gameCards: games },
    {
      todayLocalDate: getTodayLocalDate(),
      sourcePool: TOP_PICKS_SOURCE_POOL,
      lockedSlates: getLockedSlatesRegistry().slates || [],
      trackedProps: getTrackedProps(),
      controlledSelection,
    }
  );

  const bestSixWNBA = cohortBundle.bestSixWNBA;
  const bestSixNBA = cohortBundle.bestSixNBA;
  const bestSixDisplayWNBA = controlledSelection.bestSixDisplayWNBA || [];
  const bestSixDisplayNBA = controlledSelection.bestSixDisplayNBA || [];
  const topProps = controlledSelection.topProps;
  const topNBAProps = controlledSelection.topNBAProps;
  const topWNBAProps = controlledSelection.topWNBAProps;
  const topOfficialProps = controlledSelection.topOfficialProps;
  const topTestProps = controlledSelection.topTestProps;
  const topNBAOfficialProps = controlledSelection.topNBAOfficialProps;
  const topNBATestProps = controlledSelection.topNBATestProps;
  const topWNBAOfficialProps = controlledSelection.topWNBAOfficialProps;
  const topWNBATestProps = controlledSelection.topWNBATestProps;
  const topSelectionAudit = controlledSelection.controlledBestSixAudit;

  saveTopPicksSnapshot(topProps, {
    slateDate: cohortBundle.audit.slateDate || getTodayLocalDate(),
    selectorVersion: CONTROLLED_BEST_SIX_VERSION,
    topSelectionAudit,
    sourcePool: TOP_PICKS_SOURCE_POOL,
    limit: CONFIG.TOP_PROP_COMBINED_LIMIT,
  });

  // Stage 1 ? Upsert Tomorrow Best 6 as DRAFT; seal only when full 6 or FINAL_THIN_SLATE.
  const tomorrowDisplayBestSix = [
    ...(controlledSelection.bestSixDisplayWNBA || []),
    ...(controlledSelection.bestSixDisplayNBA || []),
  ];
  const officialSealResult = sealTomorrowOfficialSlates(
    tomorrowDisplayBestSix,
    {
      todayLocalDate: getTodayLocalDate(),
      serverBuild: SERVER_BUILD,
      selectorVersion: CONTROLLED_BEST_SIX_VERSION,
    }
  );
  for (const sealRow of officialSealResult?.results || []) {
    if (
      (sealRow.sealed || sealRow.alreadySealed) &&
      Array.isArray(sealRow.props) &&
      sealRow.props.length &&
      sealRow.slateDate
    ) {
      applySlateLockFreeze(sealRow.slateDate, sealRow.props);
      persistSealedSlateBundle(sealRow.slateDate, sealRow.props, {
        serverBuild: SERVER_BUILD,
        sealReason: sealRow.sealReason || "FULL_BEST_SIX",
        lockReason: sealRow.sealReason || "official_tomorrow_seal",
      });
    }
  }

  // Date rollover - Today Results inherits sealed Tomorrow slate when present.
  // If inherit fails (thin Today never sealed as yesterday's Tomorrow), seal the
  // closed Today board as FINAL_THIN so Results/Lab cannot vanish on refresh.
  // Also repair improper thin sealed pregame boards when a full Best 6 is available.
  const calendarToday = getTodayLocalDate();
  const resultsSlateDate = cohortBundle.audit.slateDate || calendarToday;
  let todayOfficialSeal = inheritTodayResultsFromSealedSlate(resultsSlateDate, {
    serverBuild: SERVER_BUILD,
  });

  // Home Today Best 6 always stamps calendar today — never overnight Results hold date.
  const todayDisplayBestSix = [
    ...(cohortBundle.bestSixDisplayTodayWNBA || []),
    ...(cohortBundle.bestSixDisplayTodayNBA || []),
  ].map((p) => ({
    ...p,
    slateDate: calendarToday,
    dayBucket: "TODAY",
    dateLabel: p.dateLabel || "Today",
    trackingAdmissionSource:
      p.trackingAdmissionSource || "CONTROLLED_BEST_SIX_DISPLAY",
    sourcePool: p.sourcePool || "CONTROLLED_BEST_SIX_DISPLAY",
    controlledBestSixDisplay: true,
  }));

  let todayPregameRepair = null;
  let calendarTodaySeal = null;

  // Improper thin seal on calendar today (unstarted, >=6 playable) -> audited reseal.
  if (todayDisplayBestSix.length >= 6) {
    todayPregameRepair = repairImproperThinSealedPregame(todayDisplayBestSix, {
      slateDate: calendarToday,
      todayLocalDate: calendarToday,
      serverBuild: SERVER_BUILD,
      selectorVersion: CONTROLLED_BEST_SIX_VERSION,
    });
    if (todayPregameRepair?.repaired) {
      const repairedProps = todayPregameRepair.props || todayDisplayBestSix;
      applySlateLockFreeze(calendarToday, repairedProps);
      persistSealedSlateBundle(calendarToday, repairedProps, {
        serverBuild: SERVER_BUILD,
        sealReason:
          todayPregameRepair.reason || "PREGAME_REPAIR_FULL_BEST_SIX",
        lockReason: "today_pregame_repair",
      });
      addTrackedProps(repairedProps, {
        skipTopPickReferences: true,
        preFilteredCohort: true,
        allowLockedBestSixBackfill: true,
      });
      calendarTodaySeal = todayPregameRepair;
    }
  }

  // Independent of overnight Results hold: seal calendar-today Best 6 when
  // unsealed and playable pool is ready (full 6 preferred; thin only if <6).
  if (!calendarTodaySeal?.repaired && todayDisplayBestSix.length) {
    addTrackedProps(todayDisplayBestSix, {
      skipTopPickReferences: true,
      preFilteredCohort: true,
      allowLockedBestSixBackfill: false,
    });
    // sealTodayFallbackOfficialSlate hardcodes generationWindowClosed/forceThinSeal;
    // full Best 6 must use sealOfficialSlate for FULL_BEST_SIX eligibility.
    if (todayDisplayBestSix.length >= 6) {
      calendarTodaySeal = sealOfficialSlate(todayDisplayBestSix, {
        slateDate: calendarToday,
        todayLocalDate: calendarToday,
        serverBuild: SERVER_BUILD,
        selectorVersion: CONTROLLED_BEST_SIX_VERSION,
        reason: "FULL_BEST_SIX_CALENDAR_TODAY",
      });
    } else {
      calendarTodaySeal = sealTodayFallbackOfficialSlate(todayDisplayBestSix, {
        todayLocalDate: calendarToday,
        serverBuild: SERVER_BUILD,
        selectorVersion: CONTROLLED_BEST_SIX_VERSION,
        generationWindowClosed: true,
        forceThinSeal: true,
        reason: "FINAL_THIN_SLATE_TODAY_FALLBACK",
      });
    }
    if (
      (calendarTodaySeal?.sealed || calendarTodaySeal?.alreadySealed) &&
      Array.isArray(calendarTodaySeal.props) &&
      calendarTodaySeal.props.length
    ) {
      applySlateLockFreeze(calendarToday, calendarTodaySeal.props);
      persistSealedSlateBundle(calendarToday, calendarTodaySeal.props, {
        serverBuild: SERVER_BUILD,
        sealReason:
          calendarTodaySeal.sealReason ||
          (todayDisplayBestSix.length >= 6
            ? "FULL_BEST_SIX_CALENDAR_TODAY"
            : "FINAL_THIN_SLATE_TODAY_FALLBACK"),
        lockReason: "calendar_today_seal",
      });
    }
  }

  todayOfficialSeal = {
    ...todayOfficialSeal,
    todayPregameRepair,
    calendarTodaySeal,
    calendarToday,
    resultsSlateDate,
  };

  saveBestSixSnapshot([...bestSixWNBA, ...bestSixNBA], {
    slateDate: resultsSlateDate,
    selectorVersion: CONTROLLED_BEST_SIX_VERSION,
    controlledBestSixAudit: topSelectionAudit,
  });

  const trackingCohort = cohortBundle.trackingCohort;
  const trackingCohortAudit = cohortBundle.trackingCohortAudit;
  addTrackedProps(trackingCohort, {
    skipTopPickReferences: true,
    preFilteredCohort: true,
    allowLockedBestSixBackfill: false,
  });

  const lifecycleValidation = validateOfficialSlateLifecycle(resultsSlateDate, {
    trackedProps: getTrackedProps(),
  });

  const generatedProps = trackingCohort;
  const boardCappedProps = collectAllGeneratedProps(games);

  const filterAudit = buildFilterAudit(games, sideAudit, {
    generatedProps,
    topProps,
    trackingMode: TRACKING_MODE,
  });

  const result = {
    ok: true,
    lastUpdated: new Date().toISOString(),
    config: checkConfig(),
    filterAudit,
    sideAudit,
    officialSeal: {
      tomorrow: officialSealResult,
      today: todayOfficialSeal,
      lifecycleValidation,
      buildTag: OFFICIAL_SLATE_BUILD_TAG,
    },
    sideAuditSummary: {
      ...sideAudit,
      topRejectionReasons: Object.entries(sideAudit.rejectionReasons || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    },
    fairLineAuditSummary: {
      fairLineOver: sideAudit.fairLineOver,
      fairLineUnder: sideAudit.fairLineUnder,
      fairLineNone: sideAudit.fairLineNone,
      currentSideOver: sideAudit.currentSideOver,
      currentSideUnder: sideAudit.currentSideUnder,
      sideMatchCount: sideAudit.sideMatchCount,
      sideMismatchCount: sideAudit.sideMismatchCount,
    },

    topProps,
    topOfficialProps,
    topTestProps,
    topNBAProps,
    topWNBAProps,
    topNBAOfficialProps,
    topNBATestProps,
    topWNBAOfficialProps,
    topWNBATestProps,
    bestSixWNBA,
    bestSixNBA,
    bestSixDisplayWNBA,
    bestSixDisplayNBA,
    bestSixDisplayTodayWNBA: cohortBundle.bestSixDisplayTodayWNBA || [],
    bestSixDisplayTodayNBA: cohortBundle.bestSixDisplayTodayNBA || [],
    topPropsSource: TOP_PICKS_SOURCE_POOL,
    topWNBAPropsSelectedFromBestSix: true,
    topNBAPropsSelectedFromBestSix: true,
    bestSixCountByLeague: topSelectionAudit?.bestSixCountByLeague ?? {},
    qualityPassedCountByLeague: topSelectionAudit?.qualityPassedCountByLeague ?? {},
    selectedBestSixTeamsByLeague: topSelectionAudit?.selectedBestSixTeamsByLeague ?? {},
    selectedTopTeamsByLeague: topSelectionAudit?.selectedTopTeamsByLeague ?? {},
    hiddenDueToBestSixCap: topSelectionAudit?.hiddenDueToBestSixCap ?? null,
    hiddenDueToTeamCap: topSelectionAudit?.hiddenDueToTeamCap ?? null,
    hiddenDueToGameCap: topSelectionAudit?.hiddenDueToGameCap ?? null,
    hiddenDueToQualityGate: topSelectionAudit?.hiddenDueToQualityGate ?? null,
    controlledBestSixAudit: topSelectionAudit,
    topSelectionAudit,
    candidateCount: topSelectionAudit?.candidateCount ?? null,
    selectedCount: topSelectionAudit?.selectedCount ?? topProps.length,
    selectedNBA: controlledSelection.selectedNBA ?? topNBAProps.length,
    selectedWNBA: controlledSelection.selectedWNBA ?? topWNBAProps.length,
    nbaTopPropLimit: CONFIG.NBA_TOP_PROP_LIMIT,
    wnbaTopPropLimit: CONFIG.WNBA_TOP_PROP_LIMIT,
    topPropTeamDiversityRequired: true,
    selectedTeamsByLeague: topSelectionAudit?.selectedTeamsByLeague ?? {},
    hiddenDueToSameTeam: topSelectionAudit?.hiddenDueToSameTeam ?? null,
    hiddenDueToLeagueLimit: topSelectionAudit?.hiddenDueToLeagueLimit ?? null,
    hiddenDueToNoDifferentTeamByLeague:
      topSelectionAudit?.hiddenDueToNoDifferentTeamByLeague ?? {},
    candidateCountByLeague: topSelectionAudit?.candidateCountByLeague ?? {},
    scoredCountByLeague: topSelectionAudit?.scoredCountByLeague ?? {},
    officialCount: topSelectionAudit?.officialCount ?? null,
    testCount: topSelectionAudit?.testCount ?? null,
    noBetCount: topSelectionAudit?.noBetCount ?? null,
    topPropSelectorVersion: TOP_PROP_SELECTOR_VERSION,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    serverBuild: SERVER_BUILD,
    boardSchemaVersion: BOARD_SCHEMA_VERSION,
    decisionPacketSchemaVersion: picksCache?.decisionPacketSchemaVersion || "courtEdgeDecisionPacketV1",
    decisionIntelligenceVersion: DECISION_INTELLIGENCE_VERSION,
    sideRescueVersion: SIDE_RESCUE_VERSION,
    decisionDataIntelligenceVersion: DECISION_DATA_INTELLIGENCE_VERSION,
    dataIntegrityVersion: DATA_INTEGRITY_VERSION,
    dataRecoveryVersion: DATA_RECOVERY_VERSION,
    topPropLimit: CONFIG.TOP_PROP_COMBINED_LIMIT,
    bestSixLimit: 6,
    generatedProps,
    boardCappedProps,
    trackingCohortAudit,
    trackingCohortVersion: trackingCohortAudit.trackingCohortVersion,
    controlledTrackingCohortVersion: cohortBundle.audit.version,
    controlledTrackingCohortAudit: cohortBundle.audit,
    trackingMode: TRACKING_MODE,
    generatedPropCount: generatedProps.length,
    boardCappedPropCount: boardCappedProps.length,

    games,
    nbaGames,
    wnbaGames,
  };

  picksCache = result;
  lastRefreshTime = Date.now();
  cachedSelectorVersion = CONTROLLED_BEST_SIX_VERSION;
  persistBoardAfterRefresh(result);
  const refreshDay = getTodayLocalDate();
  if (refreshesTodayDate !== refreshDay) {
    refreshesTodayDate = refreshDay;
    refreshesTodayCount = 0;
  }
  refreshesTodayCount += 1;

  console.log("REFRESH SIDE AUDIT:", result.sideAuditSummary);

  return result;
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "CourtEdge backend running",
    serverBuild: SERVER_BUILD,
    boardSchemaVersion: BOARD_SCHEMA_VERSION,
    engines: ENGINE_LOAD_FLAGS,
    config: checkConfig(),
    providerPolicy: {
      version: PROVIDER_FALLBACK_POLICY.version,
      sportsDataWnbaGeneration:
        PROVIDER_FALLBACK_POLICY.sportsDataWnbaGeneration,
      bdlTeamSeasonAverages: PROVIDER_FALLBACK_POLICY.bdlTeamSeasonAverages,
      evidenceVersion: COURTEDGE_PLAYER_EVIDENCE_VERSION,
    },
    time: new Date().toISOString(),
  });
});

app.get("/test-ball-teams", async (req, res) => {
  const league = req.query.league || "NBA";
  const teams = await fetchBallTeams(league);

  res.json({
    ok: true,
    league,
    count: teams.length,
    sample: teams.slice(0, 3),
  });
});

app.get("/picks", async (req, res) => {
  try {
    // Read-only: do not fetch providers / mutate tracking on screen open.
    const board = getReadOnlyBoard();
    if (!board) {
      return res.json({
        ok: true,
        message: "No saved board yet ? waiting for scheduled or manual refresh",
        serverBuild: SERVER_BUILD,
        readOnly: true,
        games: [],
        nbaGames: [],
        wnbaGames: [],
        topProps: [],
        bestSixWNBA: [],
        bestSixNBA: [],
        bestSixDisplayWNBA: [],
        bestSixDisplayNBA: [],
        lastUpdated: null,
      });
    }
    const sanitized = sanitizeHomeBoardForLifecycle(board, {
      todayLocalDate: getTodayLocalDate(),
      trackedProps: getTrackedProps(),
      reports: getRawDailySlateReports(),
      archives: getAllHistoryArchives(),
      lockedSlates: getLockedSlatesRegistry().slates || [],
    });
    return res.json({
      ...sanitized,
      readOnly: true,
      serverBuild: SERVER_BUILD,
      boardSchemaVersion: BOARD_SCHEMA_VERSION,
    });
  } catch (error) {
    console.log("GET PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load picks",
      error: error.message,
      config: checkConfig(),
      games: picksCache?.games || [],
      topProps: picksCache?.topProps || [],
    });
  }
});

app.get("/top-props", async (req, res) => {
  try {
    const board = getReadOnlyBoard();
    if (!board) {
      return res.json({
        ok: true,
        readOnly: true,
        serverBuild: SERVER_BUILD,
        message: "No saved board yet ? waiting for scheduled or manual refresh",
        lastUpdated: null,
        topProps: [],
        topNBAProps: [],
        topWNBAProps: [],
        bestSixWNBA: [],
        bestSixNBA: [],
        bestSixDisplayWNBA: [],
        bestSixDisplayNBA: [],
      });
    }
    picksCache = board;
    const sanitized = sanitizeHomeBoardForLifecycle(board, {
      todayLocalDate: getTodayLocalDate(),
      trackedProps: getTrackedProps(),
      reports: getRawDailySlateReports(),
      archives: getAllHistoryArchives(),
      lockedSlates: getLockedSlatesRegistry().slates || [],
    });

    res.json({
      ok: true,
      readOnly: true,
      serverBuild: SERVER_BUILD,
      lastUpdated: sanitized.lastUpdated,
      topProps: (sanitized.topProps || []).slice(0, CONFIG.TOP_PROP_COMBINED_LIMIT),
      topOfficialProps: (sanitized.topOfficialProps || []).slice(
        0,
        CONFIG.TOP_PROP_COMBINED_LIMIT
      ),
      topTestProps: (sanitized.topTestProps || []).slice(
        0,
        CONFIG.TOP_PROP_COMBINED_LIMIT
      ),
      topNBAProps: (sanitized.topNBAProps || []).slice(0, CONFIG.NBA_TOP_PROP_LIMIT),
      topWNBAProps: (sanitized.topWNBAProps || []).slice(0, CONFIG.WNBA_TOP_PROP_LIMIT),
      topNBAOfficialProps: (sanitized.topNBAOfficialProps || []).slice(
        0,
        CONFIG.NBA_TOP_PROP_LIMIT
      ),
      topNBATestProps: (sanitized.topNBATestProps || []).slice(
        0,
        CONFIG.NBA_TOP_PROP_LIMIT
      ),
      topWNBAOfficialProps: (sanitized.topWNBAOfficialProps || []).slice(
        0,
        CONFIG.WNBA_TOP_PROP_LIMIT
      ),
      topWNBATestProps: (sanitized.topWNBATestProps || []).slice(
        0,
        CONFIG.WNBA_TOP_PROP_LIMIT
      ),
      bestSixWNBA: sanitized.bestSixWNBA || [],
      bestSixNBA: sanitized.bestSixNBA || [],
      bestSixDisplayWNBA: sanitized.bestSixDisplayWNBA || [],
      bestSixDisplayNBA: sanitized.bestSixDisplayNBA || [],
      bestSixDisplayTodayWNBA: sanitized.bestSixDisplayTodayWNBA || [],
      bestSixDisplayTodayNBA: sanitized.bestSixDisplayTodayNBA || [],
      topPropsSource: sanitized.topPropsSource || TOP_PICKS_SOURCE_POOL,
      topWNBAPropsSelectedFromBestSix: true,
      topNBAPropsSelectedFromBestSix: true,
      bestSixCountByLeague: sanitized.bestSixCountByLeague ?? {},
      qualityPassedCountByLeague: sanitized.qualityPassedCountByLeague ?? {},
      selectedBestSixTeamsByLeague: sanitized.selectedBestSixTeamsByLeague ?? {},
      selectedTopTeamsByLeague: sanitized.selectedTopTeamsByLeague ?? {},
      hiddenDueToBestSixCap: sanitized.hiddenDueToBestSixCap ?? null,
      hiddenDueToTeamCap: sanitized.hiddenDueToTeamCap ?? null,
      hiddenDueToGameCap: sanitized.hiddenDueToGameCap ?? null,
      hiddenDueToQualityGate: sanitized.hiddenDueToQualityGate ?? null,
      controlledBestSixAudit: sanitized.controlledBestSixAudit || null,
      topSelectionAudit: sanitized.topSelectionAudit || null,
      candidateCount: sanitized.candidateCount ?? null,
      selectedCount: Math.min(
        sanitized.selectedCount ?? sanitized.topProps?.length ?? 0,
        CONFIG.TOP_PROP_COMBINED_LIMIT
      ),
      selectedNBA: sanitized.selectedNBA ?? sanitized.topNBAProps?.length ?? 0,
      selectedWNBA: sanitized.selectedWNBA ?? sanitized.topWNBAProps?.length ?? 0,
      officialCount: sanitized.officialCount ?? null,
      testCount: sanitized.testCount ?? null,
      noBetCount: sanitized.noBetCount ?? null,
      topPropSelectorVersion:
        sanitized.topPropSelectorVersion || TOP_PROP_SELECTOR_VERSION,
      controlledBestSixVersion:
        sanitized.controlledBestSixVersion || CONTROLLED_BEST_SIX_VERSION,
      topPropLimit: CONFIG.TOP_PROP_COMBINED_LIMIT,
      bestSixLimit: 6,
      nbaTopPropLimit: CONFIG.NBA_TOP_PROP_LIMIT,
      wnbaTopPropLimit: CONFIG.WNBA_TOP_PROP_LIMIT,
      topPropTeamDiversityRequired: true,
      selectedTeamsByLeague: sanitized.selectedTeamsByLeague ?? {},
      hiddenDueToSameTeam: sanitized.hiddenDueToSameTeam ?? null,
      hiddenDueToLeagueLimit: sanitized.hiddenDueToLeagueLimit ?? null,
      hiddenDueToNoDifferentTeamByLeague:
        sanitized.hiddenDueToNoDifferentTeamByLeague ?? {},
      candidateCountByLeague: sanitized.candidateCountByLeague ?? {},
      scoredCountByLeague: sanitized.scoredCountByLeague ?? {},
      lifecycleHomeSanitize: sanitized.lifecycleHomeSanitize || null,
      hiddenDueToLimit: picksCache.topSelectionAudit?.hiddenDueToLimit ?? null,
      engineHandled: picksCache.topSelectionAudit?.engineHandled ?? {},
      filterAudit: picksCache.filterAudit || null,
      trackingMode: TRACKING_MODE,
      generatedPropCount: picksCache.generatedPropCount ?? null,
      topPicksSnapshot: getActiveTopPicksSnapshot(),
      bestSixSnapshot: getActiveBestSixSnapshot(),
      controlledTrackingCohortVersion: picksCache?.controlledTrackingCohortAudit?.version || "controlled-tracking-cohort-v1",
    });
  } catch (error) {
    console.log("GET TOP PROPS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load top props",
      error: error.message,
    });
  }
});

app.get("/picks/:league", async (req, res) => {
  try {
    const league = String(req.params.league || "").toUpperCase();

    if (!["NBA", "WNBA"].includes(league)) {
      return res.status(400).json({
        ok: false,
        message: "League must be NBA or WNBA",
      });
    }

    const board = getReadOnlyBoard();
    if (!board) {
      return res.json({
        ok: true,
        readOnly: true,
        serverBuild: SERVER_BUILD,
        league,
        lastUpdated: null,
        games: [],
        topProps: [],
        trackingMode: TRACKING_MODE,
        generatedPropCount: 0,
      });
    }
    picksCache = board;

    res.json({
      ok: true,
      readOnly: true,
      serverBuild: SERVER_BUILD,
      league,
      lastUpdated: picksCache.lastUpdated,
      games: league === "NBA" ? picksCache.nbaGames : picksCache.wnbaGames,
      topProps:
        league === "NBA" ? picksCache.topNBAProps : picksCache.topWNBAProps,
      trackingMode: TRACKING_MODE,
      generatedPropCount: picksCache.generatedPropCount ?? null,
    });
  } catch (error) {
    console.log("GET LEAGUE PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load league picks",
      error: error.message,
    });
  }
});

app.post("/refresh-picks", async (req, res) => {
  try {
    const result = await refreshAllPicks();
    res.json(result);
  } catch (error) {
    console.log("REFRESH PICKS ERROR:", error.message);
    const classified = classifyProviderError(error);

    res.status(500).json({
      ok: false,
      message: "Refresh failed",
      error: error.message,
      errorType: classified.type,
      config: checkConfig(),
      preservedBoard: Boolean(getReadOnlyBoard()?.games?.length),
    });
  }
});

function requireSchedulerToken(req, res, next) {
  const provided =
    req.headers["x-courtedge-scheduler-token"] ||
    req.headers["x-scheduler-token"] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    "";
  const auth = verifySchedulerToken(provided);
  if (!auth.ok) {
    return res.status(auth.status).json({
      ok: false,
      message: auth.message,
    });
  }
  return next();
}

function buildSchedulerHandlers() {
  return {
    getPreviousBoard: () => getReadOnlyBoard(),
    persistBoard: (board) => {
      picksCache = board;
      lastRefreshTime = Date.now();
      persistBoardAfterRefresh(board);
    },
    isBoardCurrent: (jobId, slateDate) => {
      const board = getReadOnlyBoard();
      if (!board?.games?.length) return false;
      const updated = Date.parse(board.lastUpdated || board.cachedAt || 0);
      if (!Number.isFinite(updated)) return false;
      // Only skip when a very recent manual/scheduled refresh already rebuilt the board.
      if (Date.now() - updated > CONFIG.CACHE_MINUTES * 60 * 1000) {
        return false;
      }
      if (jobId === JOB_IDS.TOMORROW_NIGHT_REFRESH) {
        return (board.games || []).some(
          (g) =>
            g.dayBucket === "TOMORROW" ||
            String(g.date || g.gameDate || "").slice(0, 10) === slateDate
        );
      }
      return (board.games || []).some(
        (g) =>
          g.dayBucket === "TODAY" ||
          String(g.date || g.gameDate || "").slice(0, 10) === slateDate
      );
    },
    refreshBoard: async () => refreshAllPicks(),
    gradeTracked: async () => {
      // Grade active + all sealed unresolved dates (ignore frozen isStarted).
      const { props, summary } = await resolveTrackedProps({
        requireLikelyFinished: true,
      });
      const stale = buildStaleSealedLifecycleDiagnostics({
        trackedProps: props || getTrackedProps(),
      });
      return {
        props,
        summary,
        providerStatus: "ok",
        staleSealedLifecycle: stale,
      };
    },
    runLifecycle: async () => {
      const props = getTrackedProps();
      const dailyReport = attemptDailySlateReportBuild(props);
      return dailyReport;
    },
  };
}

app.post(
  "/internal/courtedge/run-scheduled-jobs",
  requireSchedulerToken,
  async (req, res) => {
    try {
      const result = await runScheduledJobs({
        source: String(req.body?.source || "internal"),
        force: Boolean(req.body?.force),
        serverBuild: SERVER_BUILD,
        handlers: buildSchedulerHandlers(),
      });
      res.json({
        ...result,
        serverBuild: SERVER_BUILD,
      });
    } catch (error) {
      console.log("SCHEDULER RUN ERROR:", error.message);
      res.status(500).json({
        ok: false,
        serverBuild: SERVER_BUILD,
        message: "Scheduler run failed",
        error: error.message,
        errorType: classifyProviderError(error).type,
      });
    }
  }
);

app.get(
  "/internal/courtedge/scheduler-status",
  requireSchedulerToken,
  (req, res) => {
    const status = getSchedulerStatus();
    res.json({
      ...status,
      serverBuild: SERVER_BUILD,
      autoResolveIntervalMinutes: AUTO_RESOLVE_INTERVAL_MS / 60000,
    });
  }
);

app.get("/admin/courtedge-scheduler-status", requireAdminSecret, (req, res) => {
  const status = getSchedulerStatus();
  res.json({
    ...status,
    serverBuild: SERVER_BUILD,
    autoResolveIntervalMinutes: AUTO_RESOLVE_INTERVAL_MS / 60000,
  });
});

app.get("/saved-picks", (req, res) => {
  res.json({
    ok: true,
    picks: getSavedPicks(),
  });
});

app.post("/save-pick", (req, res) => {
  const incoming = req.body || {};
  const side = incoming.side || incoming.pick || "";
  const price = Number(incoming.odds ?? incoming.price);

  const gameDate =
    incoming.gameDate ||
    incoming.date ||
    (incoming.commenceTime
      ? String(incoming.commenceTime).slice(0, 10)
      : "");

  let snapshotFields = {};

  if (
    incoming.snapshotId &&
    (incoming.openingLine !== undefined || incoming.currentLine !== undefined)
  ) {
    snapshotFields = {
      snapshotId: incoming.snapshotId,
      snapshotTime: incoming.snapshotTime || new Date().toISOString(),
      openingLine: num(incoming.openingLine ?? incoming.line),
      currentLine: num(incoming.currentLine ?? incoming.line),
    };
  } else {
    const linked = getOpeningLine({
      league: incoming.league || "",
      gameDate,
      player: incoming.player || "",
      stat: incoming.stat || "Points",
    });

    const snapshot = appendMarketSnapshot({
      league: incoming.league || "",
      gameDate,
      commenceTime: incoming.commenceTime || incoming.time || "",
      player: incoming.player || "",
      team: incoming.team || "",
      opponent: incoming.opponent || "",
      stat: incoming.stat || "Points",
      bookLine: incoming.line ?? incoming.sportsbookLine,
      bookCount: incoming.bookCount,
      marketQuality: incoming.marketQuality,
      lineSpread: incoming.lineSpread,
      overOdds: incoming.overOdds,
      underOdds: incoming.underOdds,
    });

    snapshotFields = {
      snapshotId: snapshot.snapshotId,
      snapshotTime: snapshot.snapshotTime,
      openingLine: num(linked?.openingLine ?? snapshot.openingLine),
      currentLine: num(snapshot.currentLine ?? snapshot.bookLine),
    };
  }

  const pick = {
    ...incoming,
    ...snapshotFields,
    league: incoming.league || "",
    side,
    pick: side,
    stat: incoming.stat || "Points",
    status: incoming.status || "pending",
    gameDate,
    commenceTime: incoming.commenceTime || incoming.time || "",
    startTimeDisplay:
      incoming.startTimeDisplay ||
      formatStartTimeDisplay(incoming.commenceTime || incoming.time),
    odds: Number.isFinite(price) ? price : incoming.odds,
    price: Number.isFinite(price) ? price : incoming.price,
    savedAt: incoming.savedAt || new Date().toISOString(),
    playerState: incoming.playerState || null,
    roleChange: incoming.roleChange || null,
    dataMode: incoming.dataMode || incoming.playerState?.dataMode || "",
  };

  const saved = savePick(pick);

  res.json({
    ok: true,
    message: "Pick saved",
    pick: saved,
  });
});

app.delete("/saved-picks/:id", (req, res) => {
  const result = deletePick(req.params.id);

  if (!result.ok) {
    return res.status(404).json(result);
  }

  res.json(result);
});

app.get("/tracked-props", (req, res) => {
  try {
  const includeLegacy = String(req.query.includeLegacy || "").toLowerCase() === "true";
  const allStored = getTrackedProps();
  const rawReports = getRawDailySlateReports();
  const archives = getAllHistoryArchives();
  const lockedSlates = getLockedSlatesRegistry().slates || [];
  const quarantinedSlates = getQuarantinedSlatesFromRegistry();
  const today = getTodayLocalDate();

  const classification = classifyTrackedPropsByLifecycle(allStored, {
    reports: rawReports,
    archives,
    lockedSlates,
    quarantinedSlates,
    today,
  });
  classification.trackedPropsReturnedMode = includeLegacy
    ? "all_stored_with_lifecycle"
    : "active_results_only";

  const sourceProps = includeLegacy ? allStored : classification.activeResultsProps;
  const metaMap = getTopPickMetaMap();
  const props = sourceProps.map((prop) => {
    const key = prop.trackedKey || prop.trackedId;
    const meta = key ? metaMap.get(key) : undefined;
    const enriched = meta
      ? {
          ...prop,
          topPickRank: meta.topPickRank,
          topPickLabel: meta.topPickLabel,
          topPickLeague: meta.league,
        }
      : prop;
    if (includeLegacy && !enriched.trackedLifecycleState) {
      enriched.trackedLifecycleState = prop.trackedLifecycleState || null;
    }
    return enriched;
  });

  const payload = {
    ok: true,
    props,
    count: props.length,
    topPicksSnapshot: getActiveTopPicksSnapshot(),
    bestSixSnapshot: getActiveBestSixSnapshot(),
    controlledTrackingCohortVersion: "controlled-tracking-cohort-v1",
    trackedPropsReturnedMode: classification.trackedPropsReturnedMode,
    activeResultsSlateDate: classification.activeResultsSlateDate,
    trackedStoreTotalCount: classification.trackedStoreTotalCount,
    activeResultsTrackedCount: classification.activeResultsTrackedCount,
  };

  if (includeLegacy) {
    payload.lifecycle = {
      categories: {
        activeResults: classification.activeResultsProps.length,
        labCurrent: classification.labCurrentTrackedCount,
        archivedHistory: classification.archivedHistoryTrackedCount,
        legacyCompleted: classification.legacyStoredTrackedCount,
        staleUnresolved: classification.staleUnresolvedTrackedCount,
        quarantinedLegacy: classification.quarantinedLegacyTrackedCount,
        homeStaged: classification.homeStagedTrackedCount,
      },
      trackedCountsBySlateDate: classification.trackedCountsBySlateDate,
      trackedCountsByLifecycleState: classification.trackedCountsByLifecycleState,
      currentLabSlateDate: classification.currentLabSlateDate,
      historySlateDates: classification.historySlateDates,
    };
  }

  res.json(payload);
  } catch (error) {
    console.error("GET /tracked-props error:", error);
    res.status(500).json({
      ok: false,
      message: "Tracked props read failed",
      error: error.message,
    });
  }
});

app.get("/tracked-props/analytics", (req, res) => {
  const trackedProps = getTrackedProps();
  const rawReports = getRawDailySlateReports();
  const archives = getAllHistoryArchives();
  const scopedProps = getAnalyticsScopeProps(trackedProps, rawReports, archives);
  const analytics = buildTrackedPropAnalytics(scopedProps);

  res.json({
    ok: true,
    analytics,
    count: scopedProps.length,
    scope: "completed_lab_history_only",
  });
});

app.post("/resolve-tracked-props", async (req, res) => {
  try {
    const beforeProps = getTrackedProps();
    const rawReports = getRawDailySlateReports();
    const archives = getAllHistoryArchives();
    const lockedSlates = getLockedSlatesRegistry().slates || [];

    const { props, summary } = await resolveTrackedProps({
      requireLikelyFinished: Boolean(req.body?.requireLikelyFinished),
    });

    // Results UI must only receive the active Results cohort ? never Lab/History.
    const classification = classifyTrackedPropsByLifecycle(props, {
      reports: rawReports,
      archives,
      lockedSlates,
      today: getTodayLocalDate(),
    });
    const resultsProps = classification.activeResultsProps || [];

    const scopedSummary = buildScopedResolveSummary({
      beforeProps,
      afterProps: props,
      summary,
      reports: rawReports,
      lockedSlates,
      archives,
    });

    res.json({
      ok: true,
      message: scopedSummary.checkMessage || "Tracked props resolved",
      props: resultsProps,
      trackedPropsReturnedMode: "active_results_only",
      activeResultsSlateDate: classification.activeResultsSlateDate || null,
      summary: scopedSummary,
      analytics: buildTrackedPropAnalytics(
        getAnalyticsScopeProps(props, rawReports, archives)
      ),
    });
  } catch (error) {
    console.log("RESOLVE TRACKED PROPS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Resolve tracked props failed",
      error: error.message,
    });
  }
});

app.delete("/tracked-props/:id", (req, res) => {
  const result = deleteTrackedProp(req.params.id);

  if (!result.ok) {
    return res.status(404).json(result);
  }

  res.json(result);
});

app.post("/clear-tracked-props", requireAdminSecret, (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({
      ok: false,
      message:
        "clear-tracked-props requires confirm: true and x-admin-secret. Refusing unauthenticated wipe.",
    });
  }

  const result = clearTrackedProps({
    force: req.body?.force === true,
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json({
    ...result,
    message:
      result.message ||
      "Tracked props cleared. Saved picks were not affected. Use only for research resets.",
  });
});

app.post("/admin/runtime-state-import", requireAdminSecret, (req, res) => {
  try {
    if (req.body?.confirm !== true && req.body?.dryRun !== true) {
      return res.status(400).json({
        ok: false,
        message: "runtime-state-import requires confirm: true or dryRun: true",
      });
    }

    const result = importRuntimeState(
      {
        trackedProps: req.body?.trackedProps,
        slateSnapshots: req.body?.slateSnapshots,
        lockSlateDates: req.body?.lockSlateDates,
      },
      {
        dryRun: Boolean(req.body?.dryRun),
        backupReason: req.body?.backupReason || "pre-runtime-state-import-v1",
        lockReason: req.body?.lockReason || "runtime_state_import_rescue",
        sealReason: req.body?.sealReason || "RESCUE_IMPORT",
      }
    );

    res.json({
      ...result,
      serverBuild: SERVER_BUILD,
    });
  } catch (error) {
    console.log("RUNTIME STATE IMPORT ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "runtime-state-import failed",
      error: error.message,
      serverBuild: SERVER_BUILD,
    });
  }
});

app.get("/daily-slate-reports", (req, res) => {
  const rawReports = getRawDailySlateReports();
  const trackedProps = getTrackedProps();
  const archives = getAllHistoryArchives();
  const lockedSlates = getLockedSlatesRegistry().slates || [];
  const today = getTodayLocalDate();
  const viewedSlateDate = req.query?.viewedSlateDate
    ? String(req.query.viewedSlateDate)
    : null;

  const rotation = buildSlateRotationMetadata(
    rawReports,
    getRotationRuntimeContext({ trackedProps, archives, lockedSlates, today }),
    viewedSlateDate
  );

  const reports = getLifecycleDeliverableReports({
    rotation,
    trackedProps,
    today,
  });

  const historyThreeSlateGroups = buildHistoryThreeSlateGroupsV2({
    archives,
    reports: rawReports,
    trackedProps,
    persist: true,
  });
  // Keep V1 shape available for older History clients via v1Groups
  const historyThreeSlateGroupsV1 = buildHistoryThreeSlateGroups(archives, {
    historySlateDates: rotation.historySlateDates,
  });

  let labV2 = null;
  try {
    labV2 = buildCourtEdgeLabV2({
      slateDate: rotation.currentLabSlateDate || viewedSlateDate,
      trackedProps,
      archives,
      reports: rawReports,
      persistThreeSlate: true,
    });
  } catch (err) {
    console.error("LAB_V2_BUILD_FAILED", err?.message || err);
  }

  res.json({
    ok: true,
    reports: normalizeDailySlateReports(reports),
    count: reports.length,
    serverBuild: SERVER_BUILD,
    signalPerformanceVersion: SIGNAL_PERFORMANCE_VERSION,
    historyThreeSlateGroupsVersion: HISTORY_THREE_SLATE_GROUPS_V2,
    historyThreeSlateGroupsV1Version: HISTORY_THREE_SLATE_GROUPS_VERSION,
    historyThreeSlateGroups,
    historyThreeSlateGroupsV1,
    labV2,
    labV2Version: LAB_V2_VERSION,
    labV2Build: LAB_V2_BUILD,
    currentLabSlateDate: rotation.currentLabSlateDate,
    activeResultsSlateDate: rotation.activeResultsSlateDate,
    viewedSlateDate: rotation.viewedSlateDate,
    viewingHistorical: rotation.viewingHistorical,
    historySlateDates: rotation.historySlateDates,
    activeInProgressSlateDates: rotation.activeInProgressSlateDates,
    quarantinedLegacySlateDates: rotation.quarantinedLegacySlateDates,
    quarantinedSlateDates: rotation.quarantinedSlateDates,
    quarantinedSlateReasons: rotation.quarantinedSlateReasons,
    staleUnresolvedSlateDates: rotation.staleUnresolvedSlateDates,
    lifecycleByDate: rotation.lifecycleByDate,
    rotationDecisionDebug: rotation.rotationDecisionDebug,
    slateLifecycle: buildSlateLifecycleMap(
      getRotationRuntimeContext({
        trackedProps,
        reports: rawReports,
        archives,
        lockedSlates,
      })
    ),
  });
});

app.get("/daily-slate-reports/:slateDate", (req, res) => {
  const trackedProps = getTrackedProps();
  const report = resolveDeliverableDailySlateReport(req.params.slateDate, {
    trackedProps,
  });

  if (!report) {
    return res.status(404).json({
      ok: false,
      message: "Daily slate report not found",
      slateDate: req.params.slateDate,
    });
  }

  const archives = getAllHistoryArchives();
  const withLab =
    report.labV2
      ? report
      : attachLabV2ToReport(report, {
          trackedProps,
          archives,
          reports: [report],
          persistThreeSlate: true,
        });

  res.json({
    ok: true,
    report: normalizeDailySlateReport(withLab),
    labV2: withLab.labV2 || null,
    serverBuild: SERVER_BUILD,
  });
});

app.post("/daily-slate-reports/build", (req, res) => {
  try {
    const slateDate = req.body?.slateDate ? String(req.body.slateDate) : null;
    const forceRebuild = Boolean(req.body?.forceRebuild);
    const learningOnly = Boolean(req.body?.learningOnly);
    const lifecycleRepair = Boolean(req.body?.lifecycleRepair);

    if (lifecycleRepair) {
      const confirm = Boolean(req.body?.confirm);
      const dryRun = Boolean(req.body?.dryRun);
      if (!confirm && !dryRun) {
        return res.status(400).json({
          ok: false,
          message: "lifecycleRepair requires confirm: true or dryRun: true",
        });
      }
      const result = repairLifecycleIntegrity({
        dryRun,
        targetLabSlateDate: slateDate,
        backupReason: req.body?.backupReason || "pre-lifecycle-integrity-repair-v1",
      });
      return res.json({
        ok: result.ok !== false,
        message: dryRun
          ? "Lifecycle integrity repair dry-run complete"
          : "Lifecycle integrity repair applied",
        result,
      });
    }

    if (learningOnly) {
      const confirm = Boolean(req.body?.confirm);
      const dryRun = Boolean(req.body?.dryRun);
      if (!confirm && !dryRun) {
        return res.status(400).json({
          ok: false,
          message: "learningOnly backfill requires confirm: true or dryRun: true",
          description:
            "Appends deep Lab learning layers only. Preserves officialPropId, sealed pregame snapshots, Results, History, and slate membership.",
        });
      }

      const result = backfillLabLearningLayers({
        dryRun,
        slateDate,
        backupReason: req.body?.backupReason || "pre-lab-learning-backfill-v1",
      });

      if (!result.ok) {
        return res.status(result.dryRun ? 200 : 400).json(result);
      }

      return res.json({
        ok: true,
        message: dryRun
          ? "Lab learning backfill dry-run complete"
          : "Lab learning layers backfilled",
        result,
      });
    }

    const props = getTrackedProps();
    const result = buildDailySlateReportsFromTrackedProps(props, {
      slateDate,
      forceRebuild,
    });

    res.json({
      ok: true,
      message: slateDate
        ? `Daily slate report built for ${slateDate}`
        : "Daily slate reports built for all slates",
      reports: result.reports,
      built: result.built,
      summary: result.summary,
      dailyReport: result.summary,
    });
  } catch (error) {
    console.log("BUILD DAILY SLATE REPORTS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Daily slate report build failed",
      error: error.message,
    });
  }
});

app.post("/slates/:slateDate/lock", (req, res) => {
  try {
    const slateDate = String(req.params.slateDate || "");
    const reason = String(req.body?.reason || "manual");

    const result = lockSlate(slateDate, {
      reason,
      getTrackedProps,
    });

    if (!result.ok) {
      return res.status(result.alreadyLocked ? 200 : 400).json(result);
    }

    const frozenProps = result.snapshot?.props || [];
    if (frozenProps.length) {
      applySlateLockFreeze(slateDate, frozenProps);
    }

    res.json({
      ...result,
      propCount: frozenProps.length,
    });
  } catch (error) {
    console.log("LOCK SLATE ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Slate lock failed",
      error: error.message,
    });
  }
});

app.get("/slates/locked", (req, res) => {
  const registry = getLockedSlatesRegistry();

  res.json({
    ok: true,
    slates: registry.slates || [],
    count: registry.slates?.length || 0,
    lastBlockedWrite: getLastBlockedWrite(),
  });
});

app.get("/history-archives", (req, res) => {
  const archives = getAllHistoryArchives();
  const trackedProps = getTrackedProps();
  const historyThreeSlateGroups = buildHistoryThreeSlateGroupsV2({
    archives,
    trackedProps,
    reports: getRawDailySlateReports(),
    persist: true,
  });

  res.json({
    ok: true,
    archives,
    count: archives.length,
    serverBuild: SERVER_BUILD,
    signalPerformanceVersion: SIGNAL_PERFORMANCE_VERSION,
    historyThreeSlateGroupsVersion: HISTORY_THREE_SLATE_GROUPS_V2,
    historyThreeSlateGroups,
  });
});

app.get("/courtedge/lab", (req, res) => {
  try {
    const trackedProps = getTrackedProps();
    const archives = getAllHistoryArchives();
    const reports = getRawDailySlateReports();
    const slateDate = req.query?.slateDate ? String(req.query.slateDate) : null;
    const labV2 = buildCourtEdgeLabV2({
      slateDate,
      trackedProps,
      archives,
      reports,
      persistThreeSlate: true,
      rawPage: Number(req.query?.page || 1),
      rawPageSize: Number(req.query?.pageSize || 100),
      includeAllRawRows: String(req.query?.includeAllRawRows || "") === "true",
    });
    res.json({
      ok: true,
      labV2,
      serverBuild: SERVER_BUILD,
      labV2Version: LAB_V2_VERSION,
      labV2Build: LAB_V2_BUILD,
    });
  } catch (error) {
    console.log("COURTEDGE LAB V2 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab V2 build failed",
      error: error.message,
      serverBuild: SERVER_BUILD,
    });
  }
});

app.get("/courtedge/lab/:slateDate", (req, res) => {
  try {
    const trackedProps = getTrackedProps();
    const archives = getAllHistoryArchives();
    const reports = getRawDailySlateReports();
    const labV2 = buildCourtEdgeLabV2({
      slateDate: String(req.params.slateDate),
      trackedProps,
      archives,
      reports,
      persistThreeSlate: true,
      rawPage: Number(req.query?.page || 1),
      rawPageSize: Number(req.query?.pageSize || 100),
      includeAllRawRows: String(req.query?.includeAllRawRows || "") === "true",
    });
    res.json({
      ok: true,
      slateDate: String(req.params.slateDate),
      labV2,
      serverBuild: SERVER_BUILD,
      labV2Version: LAB_V2_VERSION,
      labV2Build: LAB_V2_BUILD,
    });
  } catch (error) {
    console.log("COURTEDGE LAB V2 SLATE ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab V2 build failed",
      error: error.message,
      serverBuild: SERVER_BUILD,
    });
  }
});

function sendHistoryArchiveByDate(req, res) {
  const archive = getHistoryArchive(req.params.slateDate);

  if (!archive) {
    return res.status(404).json({
      ok: false,
      message: "History archive not found",
      slateDate: req.params.slateDate,
    });
  }

  res.json({ ok: true, archive });
}

app.get("/history-archives/:slateDate", sendHistoryArchiveByDate);
app.get("/history-archive/:slateDate", sendHistoryArchiveByDate);

app.get("/debug/data-integrity", async (req, res) => {
  try {
    const playerName = String(req.query.player || req.query.playerName || "").trim();
    const team = String(req.query.team || "").trim();
    const opponent = String(req.query.opponent || "").trim();
    const league = String(req.query.league || "WNBA").trim();
    const line = Number(req.query.line || 0);
    const slateDate = String(req.query.date || req.query.slateDate || "").trim();
    const includeRecovery =
      String(req.query.includeRecovery || "").toLowerCase() === "true";
    const beforeTime =
      req.query.beforeTime ||
      req.query.commenceTime ||
      (slateDate ? `${slateDate}T23:59:59Z` : null);

    if (!playerName && !slateDate) {
      return res.status(400).json({
        ok: false,
        message: "Provide player or date query param",
        example:
          "/debug/data-integrity?player=Azura%20Stevens&team=chicagosky&opponent=portlandfire&includeRecovery=true",
        slateExample:
          "/debug/data-integrity?date=2026-06-26&league=WNBA&includeRecovery=true",
      });
    }

    if (slateDate && !playerName) {
      const chain = await buildSlateRejectionChain({
        slateDate,
        league,
        includeRecovery,
      });
      return res.json({ ok: true, slateDate, league, includeRecovery, ...chain });
    }

    const audit = await buildDataIntegrityAuditRequest({
      playerName,
      team,
      opponent,
      league,
      line,
      beforeTime,
      includeRecovery,
    });

    res.json({ ok: true, ...audit });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Data integrity audit failed",
      error: error.message,
    });
  }
});

app.get("/admin/data-integrity-audit", requireAdminSecret, async (req, res) => {
  try {
    const playerName = String(req.query.player || req.query.playerName || "").trim();
    const team = String(req.query.team || "").trim();
    const opponent = String(req.query.opponent || "").trim();
    const league = String(req.query.league || "WNBA").trim();
    const line = Number(req.query.line || 0);
    const beforeTime = req.query.beforeTime || req.query.commenceTime || null;
    const pickKey = String(req.query.pickKey || req.query.trackedKey || "").trim();

    if (pickKey && picksCache?.generatedProps?.length) {
      const cached = picksCache.generatedProps.find(
        (p) =>
          String(p.trackedKey || p.stablePropKey || "") === pickKey ||
          String(p.player || "").toLowerCase() === pickKey.toLowerCase()
      );
      if (cached?.dataIntegrity || cached?.wnbaDataCard?.dataIntegrity) {
        return res.json({
          ok: true,
          source: "cache",
          playerName: cached.player,
          team: cached.team,
          opponent: cached.opponent,
          dataIntegrity:
            cached.dataIntegrity || cached.wnbaDataCard?.dataIntegrity,
          wnbaDataCard: cached.wnbaDataCard || null,
          serverBuild: SERVER_BUILD,
        });
      }
    }

    if (!playerName) {
      return res.status(400).json({
        ok: false,
        message: "Provide player or pickKey query param",
      });
    }

    const audit = await buildDataIntegrityAuditRequest({
      playerName,
      team,
      opponent,
      league,
      line,
      beforeTime,
    });

    res.json({ ok: true, source: "live-audit", ...audit });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Admin data integrity audit failed",
      error: error.message,
    });
  }
});

app.get("/diagnostics", (req, res) => {
  try {
  const tracked = getTrackedProps();
  const registry = getLockedSlatesRegistry();
  const dupes = countDuplicateStableKeys(tracked);
  const rawReports = getRawDailySlateReports();
  const reports = getDailySlateReports();
  const activeSlates = [
    ...new Set(tracked.map((p) => p.slateDate).filter(Boolean)),
  ].sort();
  const league = req.query.league ? String(req.query.league).toUpperCase() : null;
  const slateDate = req.query.slateDate ? String(req.query.slateDate) : null;
  const labReport = slateDate
    ? reports.find((report) => String(report.slateDate) === slateDate) || null
    : null;

  const flowValidation = buildFlowValidationDiagnostics(tracked, {
    games: picksCache?.games || [],
    generatedProps: picksCache?.generatedProps || [],
    topProps: picksCache?.topProps || [],
    league,
    slateDate,
    labReport,
  });

  const archives = getAllHistoryArchives();
  const lifecycleClassification = classifyTrackedPropsByLifecycle(tracked, {
    reports: rawReports,
    archives,
    lockedSlates: registry.slates || [],
    quarantinedSlates: getQuarantinedSlatesFromRegistry(),
    today: getTodayLocalDate(),
  });
  lifecycleClassification.trackedPropsReturnedMode = "active_results_only";
  const trackedPropsLifecycle = buildTrackedPropsLifecycleDiagnostics(
    lifecycleClassification
  );

  const trackingCohortDiagnostics = buildTrackingCohortDiagnostics(
    picksCache?.games || [],
    tracked,
    picksCache?.topProps || [],
    {
      todayLocalDate: getTodayLocalDate(),
      activeResultsSlateDate: lifecycleClassification.activeResultsSlateDate,
      activeResultsProps: lifecycleClassification.activeResultsProps,
    }
  );

  const slateLifecycle = buildSlateLifecycleMap(
    getRotationRuntimeContext({
      trackedProps: tracked,
      reports: rawReports,
      archives,
      lockedSlates: registry.slates || [],
      hasGeneratedBoard: Boolean(picksCache?.games?.length),
    })
  );
  const courtEdgeFlow = buildCourtEdgeFlowDiagnostics(
    tracked,
    rawReports,
    archives,
    getTodayLocalDate(),
    registry.slates || []
  );
  const lifecycleIntegrity = getLifecycleIntegrityDiagnostics(tracked);
  const officialSlateDiagnostics = buildOfficialSlateDiagnostics({
    trackedProps: tracked,
    todayLocalDate: getTodayLocalDate(),
  });
  courtEdgeFlow.resultsCohortSlateDate = resolveResultsCohortSlateDate({
    todayLocalDate: getTodayLocalDate(),
    lockedSlates: registry.slates || [],
    trackedProps: tracked,
    reports: rawReports,
  });
  courtEdgeFlow.analyticsScopeCount = getAnalyticsScopeProps(
    tracked,
    rawReports,
    archives
  ).length;
  const staleSealedLifecycle = buildStaleSealedLifecycleDiagnostics({
    todayLocalDate: getTodayLocalDate(),
    trackedProps: tracked,
    lockedSlates: registry.slates || [],
    reports: rawReports,
  });
  courtEdgeFlow.staleSealedLifecycle = staleSealedLifecycle;
  if (staleSealedLifecycle.warning) {
    courtEdgeFlow.staleSealedWarning = staleSealedLifecycle.warning;
  }

  res.json({
    ok: true,
    serverBuild: SERVER_BUILD,
    engines: ENGINE_LOAD_FLAGS,
    trackingMode: TRACKING_MODE,
    providerHealth: {
      keysLoaded: checkConfig(),
      evidenceV1Enabled: CONFIG.COURTEDGE_EVIDENCE_V1_ENABLED,
      wnbaDefenseV2Enabled: CONFIG.COURTEDGE_WNBA_DEFENSE_V2_ENABLED,
      wnbaSportsDataSecondaryEnabled:
        CONFIG.COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED,
      projectionCalibrationV2Enabled:
        CONFIG.COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED,
      fallbackPolicy: PROVIDER_FALLBACK_POLICY,
      evidenceVersion: COURTEDGE_PLAYER_EVIDENCE_VERSION,
      notes: [
        "SportsData WNBA generation disabled ? entitlement 401",
        "BDL team_season_averages disabled ? endpoint 404",
        "WNBA defense uses BDL final-games proxy when available; else UNAVAILABLE (not fake 50)",
      ],
    },
    officialSlate: officialSlateDiagnostics,
    staleSealedLifecycle,
    activeSlate: activeSlates[activeSlates.length - 1] || null,
    activeSlates,
    lockedSlates: registry.slates || [],
    propCounts: {
      total: tracked.length,
      bySlate: activeSlates.reduce((acc, date) => {
        acc[date] = tracked.filter((p) => p.slateDate === date).length;
        return acc;
      }, {}),
      duplicates: dupes,
    },
    courtEdgeFlow,
    lifecycleIntegrity,
    slateLifecycle,
    slateLifecycleStates: SLATE_LIFECYCLE_STATES,
    controlledTrackingCohortVersion: picksCache?.controlledTrackingCohortAudit?.version || "controlled-tracking-cohort-v1",
    flowValidation,
    trackingCohort: trackingCohortDiagnostics,
    trackingAudit: trackingCohortDiagnostics.trackingAudit || [],
    generatedCandidatesBySlate:
      trackingCohortDiagnostics.generatedCandidatesBySlate || {},
    eligibleTrackingCandidatesBySlate:
      trackingCohortDiagnostics.eligibleTrackingCandidatesBySlate || {},
    trackedPropsBySlate: trackingCohortDiagnostics.trackedPropsBySlate || {},
    notTrackedReasonsBySlate:
      trackingCohortDiagnostics.notTrackedReasonsBySlate || {},
    topPropsAreReferenceOnly: true,
    topPropsDidNotAffectTracking: true,
    topPropsDidNotControlTracking: false,
    trackingControlledByBestSix: true,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    controlledBestSixApplied: trackingCohortDiagnostics.controlledBestSixApplied ?? true,
    trackingAdmissionSource:
      trackingCohortDiagnostics.trackingAdmissionSource || "CONTROLLED_BEST_SIX",
    admittedBeforeBestSixCap:
      trackingCohortDiagnostics.admittedBeforeBestSixCap ?? null,
    excessTrackedDueToPreCap:
      lifecycleClassification.activeResultsExcessCount ??
      trackingCohortDiagnostics.excessTrackedDueToPreCap ??
      0,
    qualityGatePassedCountByLeague:
      trackingCohortDiagnostics.qualityGatePassedCountByLeague || {},
    hiddenDueToBestSixCap: trackingCohortDiagnostics.hiddenDueToBestSixCap ?? 0,
    blockedByQualityGate: trackingCohortDiagnostics.blockedByQualityGate ?? 0,
    noBetCount: trackingCohortDiagnostics.noBetCount ?? 0,
    topPropsSource: trackingCohortDiagnostics.topPropsSource || TOP_PICKS_SOURCE_POOL,
    topWNBAPropsSelectedFromBestSix: true,
    topNBAPropsSelectedFromBestSix: true,
    bestSixWNBACount: trackingCohortDiagnostics.bestSixWNBACount ?? null,
    bestSixNBACount: trackingCohortDiagnostics.bestSixNBACount ?? null,
    trackedWNBACount: trackingCohortDiagnostics.trackedWNBACount ?? null,
    trackedNBACount: trackingCohortDiagnostics.trackedNBACount ?? null,
    controlledBestSixAudit: trackingCohortDiagnostics.controlledBestSixAudit || null,
    bestSixCountByLeague: trackingCohortDiagnostics.bestSixCountByLeague || {},
    nbaTrackedCount: trackingCohortDiagnostics.nbaTrackedCount ?? null,
    wnbaTrackedCount: trackingCohortDiagnostics.wnbaTrackedCount ?? null,
    trackingCohortVersion: trackingCohortDiagnostics.trackingCohortVersion,
    qualityGateVersion: trackingCohortDiagnostics.qualityGateVersion,
    qualityGateBlockedCount: trackingCohortDiagnostics.qualityGateBlockedCount,
    boardOnlyCount: trackingCohortDiagnostics.boardOnlyCount,
    shadowOnlyCount: trackingCohortDiagnostics.shadowOnlyCount,
    trackingQualityAudit: trackingCohortDiagnostics.trackingQualityAudit,
    readerOfficialDemotedTrackedCount:
      trackingCohortDiagnostics.readerOfficialDemotedTrackedCount,
    readerUncertainTestTrackedCount:
      trackingCohortDiagnostics.readerUncertainTestTrackedCount,
    officialTrackedCount: trackingCohortDiagnostics.officialTrackedCount,
    testTrackedCount: trackingCohortDiagnostics.testTrackedCount,
    todayLocalDate: trackingCohortDiagnostics.todayLocalDate,
    activeResultsSlateDate: lifecycleClassification.activeResultsSlateDate,
    ...trackedPropsLifecycle,
    reports: {
      total: reports.length,
      final: reports.filter((r) => r.reportStatus === "final").length,
      frozen: reports.filter((r) => r.frozen === true).length,
    },
    lastBackup: getLastBackup(),
    lastBlockedWrite: getLastBlockedWrite(),
    topPropSelectorVersion: TOP_PROP_SELECTOR_VERSION,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    topPropLimit: CONFIG.TOP_PROP_COMBINED_LIMIT,
    bestSixLimit: 6,
    nbaTopPropLimit: CONFIG.NBA_TOP_PROP_LIMIT,
    wnbaTopPropLimit: CONFIG.WNBA_TOP_PROP_LIMIT,
    topPropTeamDiversityRequired: true,
    wnbaReaderCalibration: {
      version: "wnba-reader-v2-calibration",
      underGapFloorWnbaLimitedData: 3.0,
      confidenceBlendVersion: "v1-70-30",
      readerOfficialDemotedCount: tracked.filter((p) => p.readerOfficialDemoted === true)
        .length,
      readerUncertainTestCount: tracked.filter(
        (p) =>
          String(p.trackingType || p.recordType || "").toUpperCase() === "TEST" &&
          p.readerOfficialDemoted !== true
      ).length,
    },
    selectedTeamsByLeague: picksCache?.selectedTeamsByLeague ?? {},
    hiddenDueToSameTeam: picksCache?.hiddenDueToSameTeam ?? null,
    hiddenDueToLeagueLimit: picksCache?.hiddenDueToLeagueLimit ?? null,
    hiddenDueToNoDifferentTeamByLeague:
      picksCache?.hiddenDueToNoDifferentTeamByLeague ?? {},
    candidateCountByLeague: picksCache?.candidateCountByLeague ?? {},
    scoredCountByLeague: picksCache?.scoredCountByLeague ?? {},
    selectedNBA: picksCache?.selectedNBA ?? null,
    selectedWNBA: picksCache?.selectedWNBA ?? null,
    wnbaV2TopPropSelectorLoaded: ENGINE_LOAD_FLAGS.wnbaV2TopPropSelectorLoaded,
    topPropSelection: picksCache?.topSelectionAudit || null,
    topPicksSnapshot: getActiveTopPicksSnapshot(),
    cache: {
      fresh: cacheFresh(),
      cachedSelectorVersion,
      lastRefreshTime: lastRefreshTime
        ? new Date(lastRefreshTime).toISOString()
        : null,
      refreshesTodayCount,
      generatedPropCount: picksCache?.generatedPropCount ?? null,
      topPropsCount: picksCache?.topProps?.length ?? null,
      candidateCount: picksCache?.candidateCount ?? null,
      selectedCount: picksCache?.selectedCount ?? null,
      officialCount: picksCache?.officialCount ?? null,
      testCount: picksCache?.testCount ?? null,
      hiddenDueToLimit: picksCache?.topSelectionAudit?.hiddenDueToLimit ?? null,
      engineHandled: picksCache?.topSelectionAudit?.engineHandled ?? {},
    },
    time: new Date().toISOString(),
  });
  } catch (error) {
    console.error("GET /diagnostics error:", error);
    res.status(500).json({
      ok: false,
      message: "Diagnostics read failed",
      error: error.message,
    });
  }
});

app.post("/admin/backup", requireAdminSecret, (req, res) => {
  try {
    const reason = String(req.body?.reason || "manual");
    const manifest = createBackup(reason);

    res.json({
      ok: true,
      message: `Backup created: ${manifest.backupId}`,
      backup: manifest,
      serverBuild: SERVER_BUILD,
    });
  } catch (error) {
    console.log("BACKUP ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Backup failed",
      error: error.message,
    });
  }
});

app.post("/admin/backfill-official-lines", requireAdminSecret, (req, res) => {
  try {
    const result = backfillOfficialLines();
    res.json(result);
  } catch (error) {
    console.log("BACKFILL OFFICIAL LINES ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Backfill official lines failed",
      error: error.message,
    });
  }
});

app.post("/admin/reset-chi-dal-bad-grades", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        message:
          "Reset requires confirm: true in request body. Resets CHI/DAL 2026-06-20 early grades only.",
      });
    }

    const result = resetChiDalBadGrades({
      backupSuffix: "before-prod-chi-dal-reset-20260621",
      pendingReason: "Game not final yet.",
    });

    if (!result.ok) {
      return res.status(result.status || 500).json(result);
    }

    res.json(result);
  } catch (error) {
    console.log("RESET CHI/DAL BAD GRADES ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Reset CHI/DAL bad grades failed",
      error: error.message,
    });
  }
});

app.post("/admin/restore", requireAdminSecret, (req, res) => {
  try {
    const backupId = String(req.body?.backupId || "");
    const confirm = Boolean(req.body?.confirm);
    const merge = req.body?.merge !== false;

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        message: "Restore requires confirm: true in request body",
        availableBackups: listBackups().slice(0, 10).map((b) => b.backupId),
      });
    }

    if (!merge && req.body?.forceFullReplace !== true) {
      return res.status(400).json({
        ok: false,
        message:
          "Full restore (merge: false) also requires forceFullReplace: true ? refusing wipe of live Official props",
      });
    }

    const result = restoreFromBackup(backupId, {
      merge,
      preserveGrades: req.body?.preserveGrades !== false,
    });

    if (!result.ok) {
      return res.status(404).json(result);
    }

    res.json({ ...result, serverBuild: SERVER_BUILD });
  } catch (error) {
    console.log("RESTORE ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Restore failed",
      error: error.message,
    });
  }
});

app.get("/admin/official-freeze/:slateDate", requireAdminSecret, (req, res) => {
  try {
    res.json(getOfficialFreezeInfo(req.params.slateDate));
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/admin/lab-bundle/:slateDate", requireAdminSecret, (req, res) => {
  try {
    const bundle = getLabBundleInfo(req.params.slateDate);
    // Internal Player Profile Lab + bias monitoring (does not change consumer Lab UX)
    let playerProfileLab = null;
    let projectionBias = null;
    try {
      playerProfileLab = buildPlayerProfileLabReport({
        slateDate: req.params.slateDate,
      });
      projectionBias = buildProjectionBiasReport({
        slateDate: req.params.slateDate,
      });
    } catch {
      /* optional enrichment */
    }
    res.json({
      ...bundle,
      playerProfileLab,
      projectionBias,
      playerIntelligenceBuild: PLAYER_INTELLIGENCE_BUILD_TAG,
      serverBuild: SERVER_BUILD,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

/** Phase 6 ? Player Profile Lab internal report */
app.get("/admin/player-profile-lab", requireAdminSecret, (req, res) => {
  try {
    const report = buildPlayerProfileLabReport({
      slateDate: req.query.slateDate || null,
      limit: Number(req.query.limit) || 2000,
    });
    res.json({
      ok: true,
      serverBuild: SERVER_BUILD,
      playerIntelligenceBuild: PLAYER_INTELLIGENCE_BUILD_TAG,
      report,
      calibrationSummary: getCalibrationStoreSummary(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

/** Phase 7 ? Projection Bias Monitoring internal report */
app.get("/admin/projection-bias", requireAdminSecret, (req, res) => {
  try {
    const report = buildProjectionBiasReport({
      slateDate: req.query.slateDate || null,
    });
    res.json({
      ok: true,
      serverBuild: SERVER_BUILD,
      playerIntelligenceBuild: PLAYER_INTELLIGENCE_BUILD_TAG,
      report,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/internal/courtedge/projection-bias", requireSchedulerToken, (req, res) => {
  try {
    const report = buildProjectionBiasReport({
      slateDate: req.query.slateDate || null,
    });
    res.json({
      ok: true,
      serverBuild: SERVER_BUILD,
      report,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post("/admin/reslate-0622-v1", requireAdminSecret, async (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Reslate requires confirm: true or dryRun: true",
        slateDate: RESLATE_SLATE_DATE,
      });
    }

    let boardPicks = Array.isArray(req.body?.boardPicks) ? req.body.boardPicks : null;
    if (!boardPicks?.length) {
      if (!cacheFresh()) {
        await refreshAllPicks();
      }
      boardPicks = picksCache?.topWNBAProps || picksCache?.topProps || [];
    }

    const boardEval = classifyV1BoardProps(boardPicks);
    const result = reslate0622V1({
      dryRun,
      boardPicks,
      source: req.body?.source || "admin_reslate_0622_v1",
    });

    if (!result.ok) {
      return res.status(result.blocked ? 409 : 400).json(result);
    }

    if (!dryRun) {
      await refreshAllPicks();
    }

    res.json({
      ok: true,
      message: dryRun
        ? "06/22 v1 reslate dry-run complete"
        : "06/22 v1 reslate applied",
      boardEval,
      result,
    });
  } catch (error) {
    console.log("RESLATE 0622 V1 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "06/22 v1 reslate failed",
      error: error.message,
    });
  }
});

app.post("/admin/reslate-0622-test", requireAdminSecret, async (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "TEST reslate requires confirm: true or dryRun: true",
        slateDate: RESLATE_SLATE_DATE,
      });
    }

    let boardPicks = Array.isArray(req.body?.boardPicks) ? req.body.boardPicks : null;
    if (!boardPicks?.length) {
      if (!cacheFresh()) {
        await refreshAllPicks();
      }
      boardPicks = picksCache?.topWNBAProps || picksCache?.topProps || [];
    }

    const boardEval = classifyTestBoardProps(boardPicks);
    const result = reslate0622Test({
      dryRun,
      boardPicks,
      backupTag: req.body?.backupTag || "pre-0622-test-reslate-admin",
    });

    if (!result.ok) {
      return res.status(result.blocked ? 409 : 400).json(result);
    }

    if (!dryRun) {
      await refreshAllPicks();
    }

    res.json({
      ok: true,
      message: dryRun
        ? "06/22 TEST reslate dry-run complete"
        : "06/22 TEST reslate applied",
      boardEval,
      result,
    });
  } catch (error) {
    console.log("RESLATE 0622 TEST ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "06/22 TEST reslate failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-lab-history-0625", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        targetLabDate: "2026-06-24",
        archiveDate: "2026-06-21",
      });
    }

    const result = repairLabHistoryMessages0625({
      dryRun,
      restorePath: req.body?.restorePath,
      backupReason:
        req.body?.backupReason || "pre-lab-history-message-cleanup-v1-0625",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Lab/History message cleanup repair dry-run complete"
        : "Lab/History message cleanup repair applied",
      result,
    });
  } catch (error) {
    console.log("REPAIR LAB HISTORY 0625 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab/History message cleanup repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-quarantine-0624", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        quarantineDate: "2026-06-24",
        archiveDate: "2026-06-21",
        quarantineReason: "INCOMPLETE_PROD_DATA",
      });
    }

    const result = repairQuarantine0624AndArchive0621({
      dryRun,
      backupReason: req.body?.backupReason || "pre-quarantine-0624-archive-0621-v1",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Quarantine 06/24 + archive 06/21 dry-run complete"
        : "Quarantine 06/24 applied; 06/21 archived to History",
      result,
    });
  } catch (error) {
    console.log("REPAIR QUARANTINE 0624 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Quarantine 06/24 repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-slate-rotation", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        targetLabDate: "2026-06-24",
        archiveDate: "2026-06-21",
      });
    }

    const result = repairSlateRotation0624({
      dryRun,
      restorePath: req.body?.restorePath,
      allowRestore0624: Boolean(req.body?.allowRestore0624),
      backupReason: req.body?.backupReason || "pre-slate-rotation-v1",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Slate rotation repair dry-run complete"
        : "Slate rotation repair applied",
      result,
    });
  } catch (error) {
    console.log("REPAIR SLATE ROTATION ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Slate rotation repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/promote-lab-0628-archive-0621", requireAdminSecret, async (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        archiveDate: "2026-06-21",
        targetLabDate: "2026-06-28",
        description:
          "Merge 06/28 Best 6 props if missing, grade, build Lab report, archive 06/21 to History.",
      });
    }

    const result = await promoteLabSlate0628Archive0621({
      dryRun,
      skipResolve: Boolean(req.body?.skipResolve),
      restorePath: req.body?.restorePath,
      backupReason: req.body?.backupReason || "pre-promote-lab-0628-archive-0621-v1",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Promote Lab 06/28 + archive 06/21 dry-run complete"
        : "Promote Lab 06/28 + archive 06/21 applied",
      result,
    });
  } catch (error) {
    console.log("PROMOTE LAB 0628 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Promote Lab 06/28 repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/archive-lab-slate-0621", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Archive requires confirm: true or dryRun: true",
        targetArchiveDate: "2026-06-21",
        description:
          "Archive stuck 2026-06-21 from Lab without promoting a replacement slate. Preserves tracked props.",
      });
    }

    const result = archiveLabSlate0621({
      dryRun,
      backupReason: req.body?.backupReason || "pre-archive-lab-slate-0621-v1",
    });

    res.json({
      ok: result.ok,
      message: dryRun
        ? "Archive Lab 06/21 dry-run complete"
        : result.ok
          ? "Archive Lab 06/21 applied"
          : result.message,
      result,
    });
  } catch (error) {
    console.log("ARCHIVE LAB SLATE 0621 ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Archive Lab 06/21 failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-split-results-cohort", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        description:
          "Realigns Best 6 props split across CT midnight back onto the active Results cohort slate.",
        preview: previewSplitResultsCohortRepair({
          cohortSlateDate: req.body?.cohortSlateDate,
          splitSlateDate: req.body?.splitSlateDate,
        }),
      });
    }

    const result = repairSplitResultsCohort({
      dryRun,
      cohortSlateDate: req.body?.cohortSlateDate,
      splitSlateDate: req.body?.splitSlateDate,
      backupReason: req.body?.backupReason || "pre-split-results-cohort-repair-v1",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Split Results cohort repair dry-run complete"
        : "Split Results cohort repair applied",
      result,
    });
  } catch (error) {
    console.log("REPAIR SPLIT RESULTS COHORT ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Split Results cohort repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-lab-slate-rotation", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
        description:
          "Archives stale LAB bundles so only computeSlateRotation currentLabSlateDate remains in Lab. Preserves tracked props.",
      });
    }

    const result = repairLabSlateRotation({
      dryRun,
      rebuildReports: req.body?.rebuildReports !== false,
      backupReason: req.body?.backupReason || "pre-lab-slate-rotation-repair-v1",
    });

    res.json({
      ok: true,
      message: dryRun
        ? "Lab slate rotation repair dry-run complete"
        : "Lab slate rotation repair applied",
      result,
    });
  } catch (error) {
    console.log("REPAIR LAB SLATE ROTATION ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab slate rotation repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/backfill-lab-learning-layers", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Backfill requires confirm: true or dryRun: true",
        description:
          "Appends deep Lab learning layers (postgame truth, diagnosis, aggregates) for the current Lab slate. Preserves officialPropId, sealed pregame snapshots, Results, History, and slate membership.",
      });
    }

    const result = backfillLabLearningLayers({
      dryRun,
      slateDate: req.body?.slateDate ? String(req.body.slateDate) : null,
      backupReason: req.body?.backupReason || "pre-lab-learning-backfill-v1",
    });

    if (!result.ok) {
      return res.status(result.dryRun ? 200 : 400).json(result);
    }

    res.json({
      ok: true,
      message: dryRun
        ? "Lab learning backfill dry-run complete"
        : "Lab learning layers backfilled",
      result,
    });
  } catch (error) {
    console.log("BACKFILL LAB LEARNING ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab learning backfill failed",
      error: error.message,
    });
  }
});

app.get("/admin/lifecycle-integrity-audit", requireAdminSecret, (req, res) => {
  try {
    res.json(auditLifecycleIntegrity());
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Lifecycle integrity audit failed",
      error: error.message,
    });
  }
});

/** Recover sealed-but-ungraded official props for a slate date (idempotent). */
app.post("/admin/recover-stale-sealed", requireAdminSecret, async (req, res) => {
  try {
    const date = String(req.body?.date || req.query?.date || "").trim();
    const apply =
      req.body?.apply === true ||
      String(req.query?.apply || "").toLowerCase() === "true";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        ok: false,
        message: "date required as YYYY-MM-DD",
      });
    }
    const result = await recoverStaleSealedSlates({
      slateDate: date,
      dryRun: !apply,
      apply,
    });
    res.json({ ok: true, dryRun: !apply, apply, ...result });
  } catch (error) {
    console.log("RECOVER STALE SEALED ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Stale sealed recovery failed",
      error: error.message,
    });
  }
});

app.post("/admin/repair-lifecycle-integrity", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);
    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Repair requires confirm: true or dryRun: true",
      });
    }
    const result = repairLifecycleIntegrity({
      dryRun,
      targetLabSlateDate: req.body?.targetLabSlateDate
        ? String(req.body.targetLabSlateDate)
        : null,
      backupReason: req.body?.backupReason || "pre-lifecycle-integrity-repair-v1",
    });
    res.json({
      ok: result.ok !== false,
      message: dryRun
        ? "Lifecycle integrity repair dry-run complete"
        : "Lifecycle integrity repair applied",
      result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Lifecycle integrity repair failed",
      error: error.message,
    });
  }
});

app.post("/admin/reset-history", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Reset requires confirm: true or dryRun: true",
        description:
          "Backs up, clears history-archive files and ARCHIVED/LAB registry rows, rebuilds ARCHIVED slates from snapshots, archives stuck 06/21 Lab. Preserves tracked props and ACTIVE Results cohort.",
      });
    }

    const result = resetHistoryArchives({
      dryRun,
      rebuildReports: req.body?.rebuildReports !== false,
      archiveStuck0621: req.body?.archiveStuck0621 !== false,
      rebuildArchiveDates: Array.isArray(req.body?.rebuildArchiveDates)
        ? req.body.rebuildArchiveDates
        : undefined,
      backupReason: req.body?.backupReason || "pre-history-archives-reset-v1",
    });

    res.json({
      ok: result.ok,
      message: dryRun
        ? "History reset dry-run complete"
        : "History reset applied",
      result,
    });
  } catch (error) {
    console.log("RESET HISTORY ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "History reset failed",
      error: error.message,
    });
  }
});

app.post("/admin/reset-lab-no-restore", requireAdminSecret, (req, res) => {
  try {
    const confirm = Boolean(req.body?.confirm);
    const dryRun = Boolean(req.body?.dryRun);

    if (!confirm && !dryRun) {
      return res.status(400).json({
        ok: false,
        message: "Lab wipe requires confirm: true or dryRun: true",
        description:
          "Backs up, deletes LAB-phase archives + registry rows, removes stuck Lab report dates, quarantines them. Does NOT restore 06/21. Preserves tracked props and ACTIVE Results.",
      });
    }

    const result = resetLabNoRestore({
      dryRun,
      wipeReportDates: Array.isArray(req.body?.wipeReportDates)
        ? req.body.wipeReportDates
        : undefined,
      quarantineWiped: req.body?.quarantineWiped !== false,
      backupReason: req.body?.backupReason || "pre-lab-wipe-v1",
    });

    res.json({
      ok: result.ok,
      message: dryRun ? "Lab wipe dry-run complete" : "Lab wipe applied",
      result,
      serverBuild: SERVER_BUILD,
    });
  } catch (error) {
    console.log("RESET LAB NO RESTORE ERROR:", error.message);
    res.status(500).json({
      ok: false,
      message: "Lab wipe failed",
      error: error.message,
    });
  }
});

app.post("/admin/restore-official-slate", requireAdminSecret, (req, res) => {
  try {
    const slateDate = String(req.body?.slateDate || "");
    const confirm = Boolean(req.body?.confirm);

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        message: "Restore requires confirm: true and slateDate in request body",
        catalog: Object.keys(OFFICIAL_FREEZE_CATALOG),
        labBundles: Object.keys(LAB_SLATE_BUNDLE_CATALOG),
      });
    }

    if (!slateDate) {
      return res.status(400).json({
        ok: false,
        message: "Missing slateDate (e.g. 2026-06-21)",
      });
    }

    const mode = String(req.body?.mode || "official").toLowerCase();
    const result =
      mode === "lab"
        ? restoreCompletedLabSlate(slateDate, {
            source: req.body?.source || "admin_restore_lab_endpoint",
          })
        : restoreOfficialSlate(slateDate, {
            props: Array.isArray(req.body?.props) ? req.body.props : null,
            reason: req.body?.reason,
            lock: req.body?.lock !== false,
            source: req.body?.source || "admin_restore_endpoint",
          });

    if (!result.ok) {
      return res.status(result.status || 400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.log("RESTORE OFFICIAL SLATE ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Official slate restore failed",
      error: error.message,
    });
  }
});

async function resolvePendingPicks(options = {}) {
  const requireLikelyFinished = Boolean(options.requireLikelyFinished);
  const isReadyToGrade = requireLikelyFinished
    ? isPickLikelyFinished
    : isPickGameStarted;

  const savedPicks = getSavedPicks();
  const pendingPicks = savedPicks.filter(
    (pick) => String(pick.status || "pending").toLowerCase() === "pending"
  );
  const gradeablePicks = pendingPicks.filter((pick) => isReadyToGrade(pick));

  const statsCache = new Map();

  for (const pick of gradeablePicks) {
    await primePickStatsCache(pick, statsCache);
  }

  let gradedCount = 0;
  let skippedNotReady = 0;
  let stillPending = 0;

  const updatedPicks = [];

  for (const pick of savedPicks) {
    if (pick.status && pick.status !== "pending") {
      updatedPicks.push(pick);
      continue;
    }

    if (!isReadyToGrade(pick)) {
      skippedNotReady += 1;
      updatedPicks.push(pick);
      continue;
    }

    const playerStats = getCachedStatsForPick(pick, statsCache);

    const { statResult, pendingReason, resolveDebug } = await resolvePlayerStatForPick(
      pick,
      playerStats
    );
    const graded = gradePointsPick(pick, statResult, { pendingReason, resolveDebug });

    if (graded.status === "win") {
      updatePlayerAccuracy(graded.player, true, {
        side: graded.side,
        tier: graded.tier,
        league: graded.league,
      });
      gradedCount += 1;
    } else if (graded.status === "loss") {
      updatePlayerAccuracy(graded.player, false, {
        side: graded.side,
        tier: graded.tier,
        league: graded.league,
      });
      gradedCount += 1;
    } else if (graded.status === "push") {
      gradedCount += 1;
    } else {
      stillPending += 1;
    }

    updatedPicks.push(graded);
  }

  const normalized = savePickHistory(updatedPicks);

  return {
    picks: normalized,
    summary: {
      pendingTotal: pendingPicks.length,
      gradeable: gradeablePicks.length,
      gradedCount,
      skippedNotReady,
      stillPending,
      requireLikelyFinished,
    },
  };
}

app.post("/resolve-picks", async (req, res) => {
  try {
    const { picks, summary } = await resolvePendingPicks({
      requireLikelyFinished: Boolean(req.body?.requireLikelyFinished),
    });

    res.json({
      ok: true,
      message: "Picks resolved",
      picks,
      summary,
    });
  } catch (error) {
    console.log("RESOLVE PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Resolve failed",
      error: error.message,
    });
  }
});

app.post("/check-pending-results", async (req, res) => {
  try {
    const requireLikelyFinished = Boolean(req.body?.requireLikelyFinished);

    const { picks, summary: savedSummary } = await resolvePendingPicks({
      requireLikelyFinished,
    });

    const { props, summary: trackedSummary } = await resolveTrackedProps({
      requireLikelyFinished,
    });

    const dailyReport = attemptDailySlateReportBuild(props);

    res.json({
      ok: true,
      message: "Pending results checked",
      picks,
      props,
      savedSummary,
      trackedSummary,
      dailyReport: dailyReport.summary,
      reports: dailyReport.reports,
      built: dailyReport.built,
      analytics: buildTrackedPropAnalytics(props),
    });
  } catch (error) {
    console.log("CHECK PENDING RESULTS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Check pending results failed",
      error: error.message,
    });
  }
});

if (process.env.RUN_AUDIT === "1") {
  refreshAllPicks()
    .then((result) => {
      console.log(JSON.stringify(result.sideAuditSummary, null, 2));

      const sides = [];
      for (const game of result.games || []) {
        for (const pick of game.picks || []) {
          sides.push(String(pick.side || pick.pick || "").toLowerCase());
        }
      }

      console.log(
        JSON.stringify(
          {
            displayPicksTotal: sides.length,
            displayOver: sides.filter((s) => s === "over").length,
            displayUnder: sides.filter((s) => s === "under").length,
            topPropsOver: (result.topProps || []).filter(
              (p) => String(p.side || p.pick).toLowerCase() === "over"
            ).length,
            topPropsUnder: (result.topProps || []).filter(
              (p) => String(p.side || p.pick).toLowerCase() === "under"
            ).length,
          },
          null,
          2
        )
      );

      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else {
  const rehydrateResult = rehydrateLockedSlatesOnStartup();
  if (!rehydrateResult.startupIntegrity) {
    runTrackedPropStartupIntegrityCheck();
  }

  async function startServer() {
    if (process.env.COURTEDGE_RESLATE_0622_V1 === "true") {
      try {
        let boardPicks = [];
        try {
          const refreshed = await refreshAllPicks();
          boardPicks = refreshed.topWNBAProps || refreshed.topProps || [];
        } catch (error) {
          console.log("STARTUP RESLATE refresh warning:", error.message);
        }

        const reslateResult = reslate0622V1({
          source: "startup_reslate_0622_v1",
          boardPicks,
        });
        console.log("STARTUP RESLATE 0622 V1:", JSON.stringify(reslateResult));
      } catch (error) {
        console.log("STARTUP RESLATE 0622 V1 ERROR:", error.message);
      }
    }

    if (process.env.COURTEDGE_LAB_WIPE_V1 === "true") {
      if (process.env.COURTEDGE_ALLOW_DESTRUCTIVE_STARTUP !== "true") {
        console.error(
          "STARTUP LAB WIPE BLOCKED: COURTEDGE_LAB_WIPE_V1=true requires COURTEDGE_ALLOW_DESTRUCTIVE_STARTUP=true"
        );
      } else {
      try {
        const wipeResult = resetLabNoRestore({
          backupReason: "startup-lab-wipe-v1",
        });
        console.log(
          "STARTUP LAB WIPE V1:",
          JSON.stringify({
            ok: wipeResult.ok,
            backupId: wipeResult.backupId,
            clearedArchives: wipeResult.clearedArchives,
            clearedRegistry: wipeResult.clearedRegistry,
            after: wipeResult.after,
            meta: wipeResult.meta,
          })
        );
      } catch (error) {
        console.log("STARTUP LAB WIPE V1 ERROR:", error.message);
      }
      }
    } else if (process.env.COURTEDGE_HISTORY_REBUILD_V1 === "true") {
      try {
        const resetResult = resetHistoryArchives({
          backupReason: "startup-history-rebuild-v1",
        });
        console.log(
          "STARTUP HISTORY REBUILD V1:",
          JSON.stringify({
            ok: resetResult.ok,
            backupId: resetResult.backupId,
            clearedFiles: resetResult.clearedFiles,
            after: resetResult.after,
            meta: resetResult.meta,
          })
        );
      } catch (error) {
        console.log("STARTUP HISTORY REBUILD V1 ERROR:", error.message);
      }
    } else if (process.env.COURTEDGE_ARCHIVE_LAB_0621_V1 === "true") {
      try {
        const archiveResult = archiveLabSlate0621({
          backupReason: "startup-archive-lab-slate-0621-v1",
        });
        console.log(
          "STARTUP ARCHIVE LAB 0621 V1:",
          JSON.stringify({
            ok: archiveResult.ok,
            backupId: archiveResult.backupId,
            archive621: archiveResult.archive621,
            meta: archiveResult.meta,
            message: archiveResult.message,
          })
        );
      } catch (error) {
        console.log("STARTUP ARCHIVE LAB 0621 V1 ERROR:", error.message);
      }
    }

    if (process.env.COURTEDGE_PROMOTE_LAB_0628_V1 === "true") {
      try {
        const promoteResult = await promoteLabSlate0628Archive0621({
          source: "startup_promote_lab_0628_v1",
        });
        console.log(
          "STARTUP PROMOTE LAB 0628 V1:",
          JSON.stringify({
            backupId: promoteResult.backupId,
            after0628: promoteResult.after0628,
            archive621: promoteResult.archive621,
            meta: promoteResult.meta,
          })
        );
      } catch (error) {
        console.log("STARTUP PROMOTE LAB 0628 V1 ERROR:", error.message);
      }
    }

    app.listen(CONFIG.PORT, () => {
    console.log(`CourtEdge server running on port ${CONFIG.PORT}`);
    console.log("CONFIG:", checkConfig());
    console.log("SERVER_BUILD:", SERVER_BUILD);

    hydratePicksCacheFromDisk();
    if (picksCache?.games?.length) {
      console.log(
        `BOARD CACHE hydrated: ${picksCache.games.length} games, lastUpdated=${picksCache.lastUpdated || "n/a"}`
      );
    } else {
      console.log("BOARD CACHE empty ? waiting for scheduler or manual refresh");
    }

    if (rehydrateResult.results?.length) {
      console.log(
        "STARTUP REHYDRATION SUMMARY:",
        JSON.stringify(rehydrateResult.results)
      );
    }

    setInterval(async () => {
      if (autoResolveRunning) return;

      autoResolveRunning = true;

      try {
        const { summary } = await resolvePendingPicks({
          requireLikelyFinished: true,
        });

        const { props, summary: trackedSummary } = await resolveTrackedProps({
          requireLikelyFinished: true,
        });

        // Safe auto-build: only when auto-resolve leaves zero still-pending props.
        if (trackedSummary.stillPending === 0) {
          attemptDailySlateReportBuild(props);
        }

        console.log("AUTO RESOLVE PICKS:", summary);
        console.log("AUTO RESOLVE TRACKED PROPS:", trackedSummary);
      } catch (error) {
        console.log("AUTO RESOLVE PICKS ERROR:", error.message);
      } finally {
        autoResolveRunning = false;
      }
    }, AUTO_RESOLVE_INTERVAL_MS);

    console.log(
      `AUTO RESOLVE scheduled every ${AUTO_RESOLVE_INTERVAL_MS / 60000} minutes`
    );
  });
  }

  startServer().catch((error) => {
    console.error("SERVER START ERROR:", error);
    process.exit(1);
  });
}
