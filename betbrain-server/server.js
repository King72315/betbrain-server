import cors from "cors";
import express from "express";

import { CONFIG, checkConfig } from "./config.js";

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
  getBallPlayerTeam,
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
  buildTrackedPropAnalytics,
  clearTrackedProps,
  collectAllGeneratedProps,
  backfillOfficialLines,
  deleteTrackedProp,
  getAnalyticsScopeProps,
  getTrackedProps,
  resetChiDalBadGrades,
  resolveTrackedProps,
} from "./services/trackedPropService.js";

import {
  attemptDailySlateReportBuild,
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getDailySlateReports,
  getRawDailySlateReports,
} from "./services/dailySlateReportService.js";

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
  isSlateLocked,
  lockSlate,
} from "./services/slateLockService.js";

import {
  buildCourtEdgeFlowDiagnostics,
  getTodayLocalDate,
} from "./services/slateScopeService.js";

import {
  getOfficialFreezeInfo,
  OFFICIAL_FREEZE_CATALOG,
  rehydrateLockedSlatesOnStartup,
  restoreOfficialSlate,
} from "./services/slateRestoreService.js";

const SERVER_BUILD = "courteedge-results-today-only-v1";

const ENGINE_LOAD_FLAGS = {
  volumeProfileEngineLoaded: typeof buildVolumeProfile === "function",
  scoreLedgerEngineLoaded: typeof buildScoreLedger === "function",
  marketIntelligenceEngineLoaded: typeof buildMarketIntelligence === "function",
  availabilityGateEngineLoaded: typeof evaluateAvailabilityGate === "function",
  defenseScoreEngineLoaded: typeof computeDefenseScore === "function",
  volumeDangerGatesEngineLoaded: typeof evaluateVolumeDangerGates === "function",
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
      message: "Unauthorized — provide x-admin-secret header",
    });
  }

  next();
}

let picksCache = null;
let lastRefreshTime = 0;
let refreshesTodayCount = 0;
let refreshesTodayDate = "";

function cacheFresh() {
  if (!picksCache) return false;

  const ageMinutes = (Date.now() - lastRefreshTime) / 1000 / 60;

  return ageMinutes < CONFIG.CACHE_MINUTES;
}

/** Keep tracked-props.json aligned when serving cached board data (cache hits skip refresh). */
function syncTrackedFromCache() {
  if (!picksCache?.games?.length) return;

  const generatedProps = collectAllGeneratedProps(picksCache.games);
  if (generatedProps.length) {
    addTrackedProps(generatedProps);
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
   * evidenceReliability blend — marketQuality is the single book/market composite
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
 * Three underlying axes (user model — agree with nuance):
 *   1) Edge/signal — supportScore vs resistanceScore → netEdge; signalStrength
 *      is derived from netEdge + dataQuality + totalEvidence (riskComparisonEngine).
 *   2) Data/market trust — marketQuality (composite: bookCount, consensusBookCount,
 *      lineSpread, hasBothSides baked in via buildMarketProfile), dataCoverage,
 *      rawQuality, hasBothSides (5% emphasis) → evidenceReliability; same market
 *      inputs also feed dangerPressure (market weakness) and the marketQuality gate.
 *   3) Risk/danger — chosenRisk → riskLabel and dangerPressure; resistance >
 *      support, volatility, warnings, extraDangerPressure also feed dangerPressure.
 *
 * Independent gates (test a primary dimension, not a composite formula output):
 *   - signalAndEdge (STRONG + netEdge≥10; STRONG already implies netEdge≥12)
 *   - noPlay (playability veto from riskComparison noPlayReasons)
 *
 * Derivative gates (same underlying inputs, different math/threshold):
 *   - finalConfidence — raw × (0.55+0.45×evidenceReliability) − dangerPressure×24
 *   - evidenceReliability — marketQuality (45%, composite book/market signal),
 *     dataCoverage (25%), rawQuality (15%), hasBothSides (5%); bookCount and
 *     consensusBookCount are NOT separate weights (embedded in marketQuality)
 *   - dangerPressure — chosenRisk, marketQuality weakness, resistance>support,
 *     volatility, roleCertainty, market/risk warnings, extraDangerPressure
 *   - riskLabel — bucketed chosenRisk (shares chosenRisk with dangerPressure)
 *   - marketQuality≥55 — direct threshold on input also in evidenceReliability (30%)
 *   - noSevereWarnings — marketWarnings + bookCount (overlaps bookCount/hasBothSides
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

function getOpponentFromGame(team, game) {
  if (!team) return "";

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

function buildTopProps(gameCards = [], options = {}) {
  const limit = Number(options.limit || CONFIG.TOP_PROP_LIMIT || 8);
  const league = options.league || null;

  const picks = [];

  for (const game of gameCards) {
    if (league && game.league !== league) continue;

    for (const pick of game.picks || []) {
      picks.push({
        ...pick,
        gameId: game.gameId || game.id,
        game: game.game,
        date: game.date,
        dateLabel: game.dateLabel,
        dayBucket: game.dayBucket || pick.dayBucket || "",
        time: game.time,
        commenceTime: game.commenceTime,
        minutesUntilStart: game.minutesUntilStart,
        isStarted: game.isStarted,
        league: game.league || pick.league,
      });
    }
  }

  return picks
    .filter((pick) => !pick.noPlay)
    .filter((pick) => !pick.isStarted)
    .sort((a, b) => {
      const aTier = a.tier === "PREMIUM" ? 2 : a.tier === "WATCHLIST" ? 1 : 0;
      const bTier = b.tier === "PREMIUM" ? 2 : b.tier === "WATCHLIST" ? 1 : 0;

      return (
        bTier - aTier ||
        Number(b.confidence || 0) - Number(a.confidence || 0) ||
        Number(b.netEdge || 0) - Number(a.netEdge || 0) ||
        Number(a.chosenRisk || 99) - Number(b.chosenRisk || 99) ||
        Number(b.marketQuality || 0) - Number(a.marketQuality || 0) ||
        Number(b.bookCount || 0) - Number(a.bookCount || 0)
      );
    })
    .slice(0, limit)
    .map((pick, index) => ({
      ...pick,
      rank: index + 1,
    }));
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
    const blowoutRisk = computeBlowoutRiskFromSpread(gameSpread);

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
          ? getOpponentFromGame(team, game)
          : getOpponentForTeam(game, team) || getOpponentFromGame(team, game);

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
        { beforeTime: gameCutoff }
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
        playerId: playerData.PlayerID || projectionData.PlayerID || "",
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

      const availabilityGate = evaluateAvailabilityGate({
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

      const defenseResult = computeDefenseScore({
        opponentTeam: opponent,
        teamStatsMap,
        league,
      });

      const marketSnapshot = appendMarketSnapshot({
        league,
        gameDate: game.date,
        commenceTime: game.commenceTime || game.time,
        player: playerName,
        team: safeTeam,
        opponent,
        stat: "Points",
        bookLine: prop.line,
        bookCount: prop.bookCount,
        marketQuality: prop.marketQuality,
        lineSpread: prop.lineSpread,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
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

      let bestPick =
        riskComparison.pickSide === "OVER"
          ? overPick
          : riskComparison.pickSide === "UNDER"
            ? underPick
            : null;

      if (!bestPick || !riskComparison.trustable) {
        trackSideAuditRejection(
          sideAudit,
          riskComparison.pickSide,
          riskComparison.noPlayReasons
        );
        rejectedPicks.push({
          player: playerName,
          line: prop.line,
          reason: "no-play",
          details: riskComparison.noPlayReasons,
        });
        console.log("NO PLAY:", {
          league,
          playerName,
          line: prop.line,
          pickSide: riskComparison.pickSide,
          noPlayReasons: riskComparison.noPlayReasons,
          supportScore: riskComparison.supportScore,
          resistanceScore: riskComparison.resistanceScore,
          netEdge: riskComparison.netEdge,
        });
        continue;
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

      const fairLine = buildFairLine({
        playerState,
        roleChange,
        prop,
        auditOldSide: bestPick.side || bestPick.pick,
      });

      bestPick = {
        ...bestPick,
        ...fairLine,
      };

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

      builtPicks.push({
        ...bestPick,
        label: `${playerName} — ${safeTeam} ${bestPick.pick} ${prop.line} Points`,
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

  const games = [
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
  ];

  const nbaGames = games.filter((g) => g.league === "NBA");
  const wnbaGames = games.filter((g) => g.league === "WNBA");

  const topProps = buildTopProps(games);
  const topNBAProps = buildTopProps(games, { league: "NBA" });
  const topWNBAProps = buildTopProps(games, { league: "WNBA" });

  const generatedProps = collectAllGeneratedProps(games);
  addTrackedProps(generatedProps);

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
    topNBAProps,
    topWNBAProps,
    generatedProps,
    trackingMode: TRACKING_MODE,
    generatedPropCount: generatedProps.length,

    games,
    nbaGames,
    wnbaGames,
  };

  picksCache = result;
  lastRefreshTime = Date.now();
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
    engines: ENGINE_LOAD_FLAGS,
    config: checkConfig(),
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
    if (cacheFresh()) {
      syncTrackedFromCache();
      return res.json(picksCache);
    }

    const result = await refreshAllPicks();
    res.json(result);
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
    if (!cacheFresh()) {
      await refreshAllPicks();
    } else {
      syncTrackedFromCache();
    }

    res.json({
      ok: true,
      lastUpdated: picksCache.lastUpdated,
      topProps: picksCache.topProps || [],
      topNBAProps: picksCache.topNBAProps || [],
      topWNBAProps: picksCache.topWNBAProps || [],
      filterAudit: picksCache.filterAudit || null,
      trackingMode: TRACKING_MODE,
      generatedPropCount: picksCache.generatedPropCount ?? null,
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

    if (!cacheFresh()) {
      await refreshAllPicks();
    } else {
      syncTrackedFromCache();
    }

    res.json({
      ok: true,
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

    res.status(500).json({
      ok: false,
      message: "Refresh failed",
      error: error.message,
      config: checkConfig(),
    });
  }
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
  const props = getTrackedProps();

  res.json({
    ok: true,
    props,
    count: props.length,
  });
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
    const { props, summary } = await resolveTrackedProps({
      requireLikelyFinished: Boolean(req.body?.requireLikelyFinished),
    });

    res.json({
      ok: true,
      message: "Tracked props resolved",
      props,
      summary,
      analytics: buildTrackedPropAnalytics(
        getAnalyticsScopeProps(
          props,
          getRawDailySlateReports(),
          getAllHistoryArchives()
        )
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

app.post("/clear-tracked-props", (req, res) => {
  const result = clearTrackedProps();

  res.json({
    ...result,
    message:
      "Tracked props cleared. Saved picks were not affected. Use only for research resets.",
  });
});

app.get("/daily-slate-reports", (req, res) => {
  const reports = getDailySlateReports();

  res.json({
    ok: true,
    reports,
    count: reports.length,
  });
});

app.get("/daily-slate-reports/:slateDate", (req, res) => {
  const report = getDailySlateReport(req.params.slateDate);

  if (!report) {
    return res.status(404).json({
      ok: false,
      message: "Daily slate report not found",
      slateDate: req.params.slateDate,
    });
  }

  res.json({
    ok: true,
    report,
  });
});

app.post("/daily-slate-reports/build", (req, res) => {
  try {
    const slateDate = req.body?.slateDate ? String(req.body.slateDate) : null;
    const forceRebuild = Boolean(req.body?.forceRebuild);
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

  res.json({
    ok: true,
    archives,
    count: archives.length,
  });
});

app.get("/history-archives/:slateDate", (req, res) => {
  const archive = getHistoryArchive(req.params.slateDate);

  if (!archive) {
    return res.status(404).json({
      ok: false,
      message: "History archive not found",
      slateDate: req.params.slateDate,
    });
  }

  res.json({ ok: true, archive });
});

app.get("/diagnostics", (req, res) => {
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
  const courtEdgeFlow = buildCourtEdgeFlowDiagnostics(
    tracked,
    rawReports,
    archives,
    getTodayLocalDate(),
    registry.slates || []
  );
  courtEdgeFlow.analyticsScopeCount = getAnalyticsScopeProps(
    tracked,
    rawReports,
    archives
  ).length;

  res.json({
    ok: true,
    serverBuild: SERVER_BUILD,
    engines: ENGINE_LOAD_FLAGS,
    trackingMode: TRACKING_MODE,
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
    flowValidation,
    reports: {
      total: reports.length,
      final: reports.filter((r) => r.reportStatus === "final").length,
      frozen: reports.filter((r) => r.frozen === true).length,
    },
    lastBackup: getLastBackup(),
    lastBlockedWrite: getLastBlockedWrite(),
    cache: {
      fresh: cacheFresh(),
      lastRefreshTime: lastRefreshTime
        ? new Date(lastRefreshTime).toISOString()
        : null,
      refreshesTodayCount,
      generatedPropCount: picksCache?.generatedPropCount ?? null,
      topPropsCount: picksCache?.topProps?.length ?? null,
    },
    time: new Date().toISOString(),
  });
});

app.post("/admin/backup", (req, res) => {
  try {
    const reason = String(req.body?.reason || "manual");
    const manifest = createBackup(reason);

    res.json({
      ok: true,
      message: `Backup created: ${manifest.backupId}`,
      backup: manifest,
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

app.post("/admin/restore", (req, res) => {
  try {
    const backupId = String(req.body?.backupId || "");
    const confirm = Boolean(req.body?.confirm);

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        message: "Restore requires confirm: true in request body",
        availableBackups: listBackups().slice(0, 10).map((b) => b.backupId),
      });
    }

    const result = restoreFromBackup(backupId, {
      merge: req.body?.merge !== false,
      preserveGrades: req.body?.preserveGrades !== false,
    });

    if (!result.ok) {
      return res.status(404).json(result);
    }

    res.json(result);
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

app.post("/admin/restore-official-slate", requireAdminSecret, (req, res) => {
  try {
    const slateDate = String(req.body?.slateDate || "");
    const confirm = Boolean(req.body?.confirm);

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        message: "Restore requires confirm: true and slateDate in request body",
        catalog: Object.keys(OFFICIAL_FREEZE_CATALOG),
      });
    }

    if (!slateDate) {
      return res.status(400).json({
        ok: false,
        message: "Missing slateDate (e.g. 2026-06-21)",
      });
    }

    const result = restoreOfficialSlate(slateDate, {
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

const AUTO_RESOLVE_INTERVAL_MS = 45 * 60 * 1000;
let autoResolveRunning = false;

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

  app.listen(CONFIG.PORT, () => {
    console.log(`CourtEdge server running on port ${CONFIG.PORT}`);
    console.log("CONFIG:", checkConfig());

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