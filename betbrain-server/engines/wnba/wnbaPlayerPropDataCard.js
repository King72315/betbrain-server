import { findBallPlayer } from "../../services/ballService.js";
import { buildFairLine } from "../fairLineEngine.js";
import { projectWnbaPoints } from "./wnbaProjectionEngine.js";
import {
  auditWnbaDataIntegrity,
  DATA_INTEGRITY_VERSION,
  summarizeDataIntegrityForDisplay,
} from "./wnbaDataIntegrityV1.js";
import { resolveStableWnbaPlayerId } from "./wnbaPlayerIdResolver.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function ptsPerFGA(points = 0, fga = 0) {
  if (fga <= 0) return 0;
  return Number((points / fga).toFixed(3));
}

function deriveScoringTrend(last5Points = [], seasonPoints = 0) {
  if (!last5Points.length) return "unknown";
  const recent = avg(last5Points);
  if (seasonPoints <= 0) return recent >= 12 ? "up" : "stable";
  const delta = recent - seasonPoints;
  if (delta >= 3) return "up";
  if (delta <= -3) return "down";
  return "stable";
}

function deriveRoleTrendLabel(roleChange = {}, volumeProfile = {}) {
  const trend =
    volumeProfile.roleTrend ||
    roleChange.roleTrend ||
    roleChange.recentMinutesTrend;
  if (!trend) return "unknown";
  const raw = String(trend).toUpperCase();
  if (raw.includes("UP") || raw.includes("EXPAND")) return "up";
  if (raw.includes("DOWN") || raw.includes("CONTRACT")) return "down";
  if (raw.includes("STABLE")) return "stable";
  return "unknown";
}

function computeDataConfidence(flags = []) {
  const weights = {
    playerId: 15,
    seasonStats: 15,
    last5: 20,
    minutes: 10,
    fga: 10,
    availabilityFeed: 5,
    defense: 10,
    matchup: 5,
    market: 10,
    projection: 10,
    gameContext: 5,
  };
  let score = 0;
  let max = 0;
  for (const flag of flags) {
    const w = weights[flag.key] || 5;
    max += w;
    if (!flag.missing) score += w;
  }
  if (max <= 0) return 0;
  return Math.round((score / max) * 100);
}

export async function buildWnbaPlayerPropDataCard(pick = {}, context = {}) {
  const {
    playerName,
    team,
    opponent,
    prop = {},
    game = {},
    last5 = [],
    bdlSeasonGames = [],
    seasonAverage = 0,
    playerState = {},
    roleChange = {},
    volumeProfile = {},
    availabilityGate = {},
    defenseResult = {},
    wnbaGameContext = null,
    marketSnapshot = {},
    marketIntelligence = {},
    opportunity = {},
    matchupGames = [],
  } = context;

  const ballPlayer = await findBallPlayer(playerName, "WNBA");
  const stablePlayerId = resolveStableWnbaPlayerId(playerName);
  const stablePlayerIdUsed = Boolean(
    stablePlayerId && String(ballPlayer?.id || "") === String(stablePlayerId)
  );
  const playerId = String(
    ballPlayer?.id ||
      stablePlayerId ||
      playerState.playerId ||
      pick.playerId ||
      ""
  );

  const seasonPoints = num(
    playerState.seasonPoints ?? seasonAverage
  );
  const recentPoints = num(
    playerState.recentPoints ??
      opportunity.recentPoints ??
      avg(last5.map((g) => g.points))
  );
  const seasonMinutes = num(playerState.seasonMinutes);
  const recentMinutes = num(
    playerState.recentMinutes ?? opportunity.recentMinutes
  );
  const seasonFGA = num(playerState.seasonFGA);
  const recentFGA = num(playerState.recentFGA ?? opportunity.recentFGA);
  const seasonFTA = num(playerState.seasonFTA);
  const recentFTA = num(playerState.recentFTA ?? opportunity.recentFTA);

  const last5Points = last5.map((g) => num(g.points));
  const scoringTrend = deriveScoringTrend(last5Points, seasonPoints);
  const roleTrend = deriveRoleTrendLabel(roleChange, volumeProfile);

  const teammateUsageShift = roleChange.teammateOutBoost
    ? {
        active: true,
        fgaBoost: num(roleChange.expectedFGADelta) * 0.15,
        minutesBoost: num(roleChange.expectedMinutesDelta) * 0.1,
        reasons: roleChange.teammateOutBoost?.reasons || [],
      }
    : { active: false, fgaBoost: 0, minutesBoost: 0, reasons: [] };

  const projectionResult = projectWnbaPoints({
    seasonMinutes,
    recentMinutes,
    seasonFGA,
    recentFGA,
    seasonFTA,
    recentFTA,
    seasonPoints,
    recentPoints,
    roleChange,
    teammateUsageShift,
  });

  const fairLine = buildFairLine({
    playerState: {
      ...playerState,
      sportsProjection: projectionResult.projection,
    },
    roleChange,
    prop,
  });

  const line = num(prop.line);
  const openingLine = num(marketSnapshot.openingLine ?? prop.openingLine);
  const currentLine = num(marketSnapshot.currentLine ?? prop.line);
  const lineMovement = num(
    marketIntelligence.lineDelta ?? currentLine - openingLine
  );

  const dataMissingFlags = [];
  const flag = (key, missing, note = "") =>
    dataMissingFlags.push({ key, missing, note });

  flag("playerId", !playerId, "No stable BallDontLie player id");
  flag("seasonStats", seasonPoints <= 0, "Missing season points");
  flag("last5", last5.length < 3, `Only ${last5.length} recent games`);
  flag("minutes", recentMinutes <= 0 && seasonMinutes <= 0, "No minutes data");
  flag("fga", recentFGA <= 0 && seasonFGA <= 0, "No FGA data");
  flag(
    "availabilityFeed",
    Boolean(availabilityGate.availabilityDataMissing),
    availabilityGate.availabilityMessage ||
      "WNBA availability feed missing — uncertainty treated as risk"
  );
  flag(
    "defense",
    num(defenseResult.defenseScore) <= 0 && !defenseResult.context,
    "Opponent defense context missing"
  );
  flag(
    "matchup",
    num(playerState.matchupAverage) <= 0 && matchupGames.length === 0,
    "No opponent matchup history"
  );
  flag("market", num(prop.bookCount) <= 0, "No book line data");
  flag(
    "projection",
    projectionResult.projection <= 0,
    "Volume projection unavailable"
  );
  flag(
    "gameContext",
    !wnbaGameContext?.spread && wnbaGameContext?.spread !== 0,
    "Game spread/total context missing"
  );

  const dataConfidenceScore = computeDataConfidence(dataMissingFlags);
  const lineToRecentAvgRatio =
    line > 0 && recentPoints > 0
      ? Number((line / recentPoints).toFixed(2))
      : null;
  const lineToSeasonAvgRatio =
    line > 0 && seasonPoints > 0
      ? Number((line / seasonPoints).toFixed(2))
      : null;
  const absoluteLineBucket =
    line <= 8.5 ? "low" : line <= 15.5 ? "mid" : "high";
  const playerContextLineBucket =
    lineToRecentAvgRatio !== null
      ? lineToRecentAvgRatio >= 1.15
        ? "above_recent"
        : lineToRecentAvgRatio <= 0.85
          ? "below_recent"
          : "near_recent"
      : "unknown";

  const availabilityDataMissing = Boolean(availabilityGate.availabilityDataMissing);

  const dataIntegrity = auditWnbaDataIntegrity({
    playerName,
    playerId,
    team,
    opponent,
    last5,
    matchupGames,
    matchupAverage: playerState.matchupAverage,
    seasonAverage: seasonPoints,
    availabilityGate,
    defenseResult,
    prop,
    playerState,
    ballPlayerResolved: Boolean(ballPlayer),
    stablePlayerIdUsed,
  });
  const dataIntegrityDisplay = summarizeDataIntegrityForDisplay(dataIntegrity);

  return {
    version: "wnba-data-card-v2",
    dataMode: playerState.dataMode || "",
    playerId,
    player: playerName,
    team,
    opponent,
    propType: "Points",
    gameLabel: game.game || pick.game || "",
    gameDate: game.date || pick.gameDate || "",
    overCandidate: { side: "OVER", line },
    underCandidate: { side: "UNDER", line },
    bookLine: line,
    openingLine: openingLine || null,
    currentLine: currentLine || line,
    lineMovement,
    bookCount: num(prop.bookCount),
    lineSpread: num(prop.lineSpread),
    overOdds: prop.overOdds ?? null,
    underOdds: prop.underOdds ?? null,
    marketQuality: num(prop.marketQuality),
    season: {
      points: seasonPoints,
      minutes: seasonMinutes,
      fga: seasonFGA,
      fta: seasonFTA,
      ptsPerFGA: ptsPerFGA(seasonPoints, seasonFGA),
      ftPath: seasonFTA > 0,
    },
    last5: {
      points: recentPoints,
      pointsList: last5Points,
      minutes: recentMinutes,
      fga: recentFGA,
      fta: recentFTA,
      ptsPerFGA: ptsPerFGA(recentPoints, recentFGA),
      ftPath: recentFTA >= 2,
      games: last5.length,
    },
    scoringTrend,
    usageShotTrend: volumeProfile.volumeStability || opportunity.shotVolumeStability?.label || "unknown",
    roleTrend,
    injuryAvailability: {
      status: availabilityGate.status || availabilityGate.statusLevel || "unknown",
      level: availabilityGate.statusLevel || "UNKNOWN",
      availabilityStatus: availabilityGate.availabilityStatus || availabilityGate.statusLevel || "UNKNOWN",
      availabilityDataMissing,
      availabilityRisk: Boolean(availabilityGate.availabilityRisk),
      availabilitySourceStatus:
        availabilityGate.availabilitySourceStatus || "OK",
      blocksPlay: Boolean(availabilityGate.noPlay),
      reasons: availabilityGate.noPlayReasons || availabilityGate.dangerReasons || [],
    },
    teammateUsageShift,
    opponentDefense: {
      score: num(defenseResult.defenseScore),
      label: defenseResult.defenseLabel || defenseResult.label || null,
      context: defenseResult.context || defenseResult.wnbaDefenseProbe || null,
    },
    gameEnvironment: {
      spread: wnbaGameContext?.spread ?? null,
      total: wnbaGameContext?.total ?? null,
      impliedTeamTotal: wnbaGameContext?.impliedTeamTotal ?? null,
      blowoutRisk: num(wnbaGameContext?.blowoutRisk),
      pace: wnbaGameContext?.pace ?? null,
      highBlowoutRisk: Boolean(wnbaGameContext?.highBlowoutRisk),
    },
    projection: projectionResult,
    fairLine,
    dataMissingFlags,
    dataConfidenceScore,
    dataIntegrity,
    dataIntegrityVersion: DATA_INTEGRITY_VERSION,
    dataIntegrityOverall: dataIntegrityDisplay.label,
    dataIntegrityCompact: dataIntegrityDisplay.compact,
    lineToRecentAvgRatio,
    lineToSeasonAvgRatio,
    absoluteLineBucket,
    playerContextLineBucket,
    builtAt: new Date().toISOString(),
  };
}
