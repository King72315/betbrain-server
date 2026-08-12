/**
 * CourtEdge Home Detailed Analysis V1
 * One canonical server-built payload for Home expandable analysis + Copy Report.
 * UI must not recalculate side/confidence/risk.
 *
 * Confidence/risk display owner: courtEdgeAnalysisIntegrityV1
 * (sealed canonical → decision packet → pick final fields).
 */

import {
  COURT_EDGE_SIDE_CALIBRATION_VERSION,
  COURT_EDGE_SIDE_CALIBRATION_BUILD,
  absoluteProjectionEdge,
  buildSideCalibrationMarker,
} from "./courtEdgeSideCalibrationV1.js";
import {
  buildAnalysisCacheKey,
  cacheWrap,
} from "./courtEdgeAnalysisCacheV1.js";
import {
  ANALYSIS_INTEGRITY_BUILD,
  ANALYSIS_INTEGRITY_VERSION,
  CANONICAL_DECISION_DISPLAY_OWNER,
  buildTopPickTransparency,
  ensureValidPlayerEvidence,
  measuredNum,
  nonNegativeVolume,
  resolveCanonicalDecisionFields,
  roundConfidence,
  roundRate,
  roundStat,
  scrubConsumerFacingText,
  syncCanonicalDecisionOntoPick,
  translateOrScrubAction,
} from "./courtEdgeAnalysisIntegrityV1.js";

export const HOME_DETAILED_ANALYSIS_VERSION = "homeDetailedAnalysisV1";
export const HOME_DETAILED_ANALYSIS_BUILD = ANALYSIS_INTEGRITY_BUILD;

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function avg(values = []) {
  const nums = values.map((v) => measuredNum(v)).filter((v) => v !== null);
  if (!nums.length) return null;
  return roundStat(nums.reduce((s, v) => s + v, 0) / nums.length);
}

function median(values = []) {
  const nums = values
    .map((v) => measuredNum(v))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) {
    return roundStat((nums[mid - 1] + nums[mid]) / 2);
  }
  return roundStat(nums[mid]);
}

function hitRateVsLine(points = [], line = null, side = "OVER") {
  const L = measuredNum(line);
  const s = normalizeSide(side) || "OVER";
  const pts = (points || []).map((v) => measuredNum(v)).filter((v) => v !== null);
  if (L === null || !pts.length) {
    return { hits: null, sample: pts.length, rate: null, label: "Unavailable" };
  }
  const hits = pts.filter((p) => (s === "OVER" ? p > L : p < L)).length;
  return {
    hits,
    sample: pts.length,
    rate: roundRate(hits / pts.length),
    label: `${hits} of ${pts.length}`,
  };
}

function scoringTrend(points = []) {
  const pts = (points || []).map((v) => num(v)).filter((v) => v !== null);
  if (pts.length < 3) return { trend: "Unavailable", status: "INSUFFICIENT_SAMPLE" };
  const recent = avg(pts.slice(0, Math.min(3, pts.length)));
  const older = avg(pts.slice(Math.min(3, pts.length)));
  if (recent === null || older === null) {
    return { trend: "Unavailable", status: "INSUFFICIENT_SAMPLE" };
  }
  const delta = recent - older;
  if (delta >= 2) return { trend: "Rising", status: "AVAILABLE", delta };
  if (delta <= -2) return { trend: "Declining", status: "AVAILABLE", delta };
  return { trend: "Stable", status: "AVAILABLE", delta };
}

function unavailable(reason = "UNAVAILABLE") {
  return { value: null, status: reason };
}

function displayOrUnavailable(value, statusWhenMissing = "UNAVAILABLE") {
  if (value === null || value === undefined || value === "") {
    return { value: null, status: statusWhenMissing, display: "Unavailable" };
  }
  return { value, status: "AVAILABLE", display: value };
}

function resolveAnalysisPropType(pick = {}, evidence = {}) {
  const raw = String(
    pick.propType ||
      pick.canonicalPropType ||
      pick.stat ||
      evidence.recentForm?.propType ||
      "POINTS"
  ).toUpperCase();
  if (raw.includes("REBOUND")) return "REBOUNDS";
  if (raw.includes("ASSIST")) return "ASSISTS";
  return "POINTS";
}

function boxValueFromGame(game = {}, propType = "POINTS") {
  if (propType === "REBOUNDS") {
    return num(game?.rebounds ?? game?.reb ?? game?.REB ?? game?.statValue ?? game?.value);
  }
  if (propType === "ASSISTS") {
    return num(game?.assists ?? game?.ast ?? game?.AST ?? game?.statValue ?? game?.value);
  }
  return num(game?.points ?? game?.pts ?? game?.PTS ?? game?.statValue ?? game?.value);
}

function extractStatList(source, propType = "POINTS") {
  if (!source) return [];
  if (Array.isArray(source)) {
    if (!source.length) return [];
    if (typeof source[0] === "number") {
      return source.map((v) => num(v)).filter((v) => v !== null);
    }
    return source
      .map((g) => boxValueFromGame(g, propType))
      .filter((v) => v !== null);
  }
  return [];
}

/** @deprecated use extractStatList(source, propType) */
function extractPointsList(source) {
  return extractStatList(source, "POINTS");
}

function resolveSealedLine(pick = {}) {
  return num(
    first(
      pick.sealedLine,
      pick.selectedLine,
      pick.officialLine,
      pick.pregameSnapshot?.line,
      pick.line,
      pick.sportsbookLine
    )
  );
}

function resolveMarketDirection({
  openingLine,
  currentLine,
  sealedLine,
  side,
  marketStatus,
} = {}) {
  if (String(marketStatus || "").toUpperCase() === "UNAVAILABLE") {
    return {
      compact: "UNAVAILABLE",
      relativeToSide: "UNAVAILABLE",
      explanation: "Market data unavailable — not treated as AGAINST.",
    };
  }
  const open = num(openingLine);
  const cur = num(currentLine);
  const sealed = num(sealedLine);
  const s = normalizeSide(side);
  const reference = cur ?? sealed;

  // Sealed/current only (no open): honest NEUTRAL — never UNAVAILABLE≈AGAINST.
  if (open === null && reference !== null && s) {
    const sealedCurrentDelta =
      sealed !== null && cur !== null ? cur - sealed : 0;
    if (Math.abs(sealedCurrentDelta) < 0.5) {
      return {
        compact: "NEUTRAL",
        relativeToSide: "NEUTRAL",
        lineDelta: sealedCurrentDelta,
        sealedCurrentOnly: true,
        explanation:
          "No opening line — sealed/current only; treated as NEUTRAL (not AGAINST).",
      };
    }
    const withSide =
      (s === "OVER" && sealedCurrentDelta > 0) ||
      (s === "UNDER" && sealedCurrentDelta < 0);
    return {
      compact: withSide ? "WITH" : "AGAINST",
      relativeToSide: withSide ? "WITH" : "AGAINST",
      lineDelta: sealedCurrentDelta,
      sealedCurrentOnly: true,
      explanation: withSide
        ? `Current moved ${sealedCurrentDelta > 0 ? "up" : "down"} from sealed in favor of ${s}.`
        : `Current moved ${sealedCurrentDelta > 0 ? "up" : "down"} from sealed against ${s}.`,
    };
  }

  if (open === null || reference === null || !s) {
    return {
      compact: "UNAVAILABLE",
      relativeToSide: "UNAVAILABLE",
      explanation: "Opening or current line missing — not treated as AGAINST.",
    };
  }
  const delta = reference - open;
  if (Math.abs(delta) < 0.5) {
    return {
      compact: "NEUTRAL",
      relativeToSide: "NEUTRAL",
      lineDelta: delta,
      explanation: "Line unchanged from open (within 0.5).",
    };
  }
  const withSide =
    (s === "OVER" && delta > 0) || (s === "UNDER" && delta < 0);
  return {
    compact: withSide ? "WITH" : "AGAINST",
    relativeToSide: withSide ? "WITH" : "AGAINST",
    lineDelta: delta,
    explanation: withSide
      ? `Line moved ${delta > 0 ? "up" : "down"} in favor of ${s}.`
      : `Line moved ${delta > 0 ? "up" : "down"} against ${s}.`,
  };
}

function translateFlipAction(action = "") {
  const raw = String(action || "").trim().toUpperCase();
  if (!raw || raw === "KEEP" || raw === "KEEP_ORIGINAL") {
    return "Kept original side";
  }
  if (raw === "FLIP" || raw === "FLIP_SIDE") return "Flipped side";
  return translateOrScrubAction(action) || "Kept original side";
}

function buildAvailabilitySection(pick = {}, evidence = {}) {
  const gate = pick.availabilityGate || {};
  const avail = evidence.availability || {};
  const feedStatus = String(
    first(gate.availabilitySourceStatus, avail.feedHealth, "")
  ).toUpperCase();
  const injuryStatus = first(
    gate.status,
    gate.statusLevel,
    gate.availabilityStatus,
    avail.playerInjuryStatus
  );
  const listedOnFeed = Boolean(
    gate.injuryRow ||
      gate.listedOnInjuryReport ||
      (injuryStatus &&
        !/active|healthy|ok/i.test(String(injuryStatus)) &&
        feedStatus === "OK")
  );

  if (feedStatus === "ERROR" || feedStatus === "PROVIDER_ERROR") {
    return {
      injuryReportStatus: "PROVIDER_ERROR",
      availabilitySource: first(gate.source, avail.statusSource, "balldontlie"),
      injuryDescription: null,
      statusBucket: "PROVIDER_ERROR",
      displayStatus: "Provider error",
      confirmedActive: false,
      noCurrentInjuryReportFound: false,
      teammateImpact: first(pick.teammateUsageShift, evidence.roleAndVolume?.teammateOutRoleChange),
      note: "Injury provider error — do not treat as confirmed active.",
    };
  }

  if (!listedOnFeed && !gate.noPlay) {
    return {
      injuryReportStatus: "NO_REPORT",
      availabilitySource: first(gate.source, avail.statusSource, "balldontlie"),
      injuryDescription: null,
      statusBucket: "NO_CURRENT_INJURY_REPORT",
      displayStatus: "No current injury report found",
      confirmedActive: false,
      noCurrentInjuryReportFound: true,
      teammateImpact: first(pick.teammateUsageShift, evidence.roleAndVolume?.teammateOutRoleChange),
      note: "BDL injury feed lists reported injuries only — absence is not confirmed active.",
    };
  }

  const raw = String(injuryStatus || "").toUpperCase();
  let statusBucket = "REPORTED";
  if (/OUT/.test(raw)) statusBucket = "OUT";
  else if (/QUESTIONABLE|GTD|GAME.TIME/.test(raw)) statusBucket = "QUESTIONABLE";
  else if (/PROBABLE/.test(raw)) statusBucket = "PROBABLE";

  return {
    injuryReportStatus: statusBucket,
    availabilitySource: first(gate.source, avail.statusSource, "balldontlie"),
    injuryDescription: first(gate.description, gate.injuryDescription, null),
    statusBucket,
    displayStatus: injuryStatus || statusBucket,
    confirmedActive: false,
    noCurrentInjuryReportFound: false,
    teammateImpact: first(pick.teammateUsageShift, evidence.roleAndVolume?.teammateOutRoleChange),
  };
}

function buildMatchupHistory(
  pick = {},
  evidence = {},
  sealedLine = null,
  finalSide = "OVER",
  propType = "POINTS"
) {
  const matchup = evidence.matchup || {};
  const legacyValues =
    propType === "REBOUNDS"
      ? matchup.rebounds
      : propType === "ASSISTS"
        ? matchup.assists
        : matchup.points;
  const games =
    pick.matchupGames ||
    pick.opponentMatchupGames ||
    (Array.isArray(legacyValues)
      ? legacyValues.map((val, i) => ({
          points: propType === "POINTS" ? val : null,
          rebounds: propType === "REBOUNDS" ? val : null,
          assists: propType === "ASSISTS" ? val : null,
          statValue: val,
          minutes: matchup.minutes?.[i] ?? null,
          fga: matchup.fga?.[i] ?? null,
          fta: matchup.fta?.[i] ?? null,
          fg3a: matchup.fg3a?.[i] ?? null,
          date: matchup.dates?.[i] || matchup.recency || null,
        }))
      : Array.isArray(matchup.points)
        ? matchup.points.map((pts, i) => ({
            points: pts,
            minutes: matchup.minutes?.[i] ?? null,
            fga: matchup.fga?.[i] ?? null,
            fta: matchup.fta?.[i] ?? null,
            fg3a: matchup.fg3a?.[i] ?? null,
            date: matchup.dates?.[i] || matchup.recency || null,
          }))
        : []);

  if (!games.length && !(matchup.sampleSize > 0)) {
    return {
      status: "UNAVAILABLE",
      display: "No previous matchup data available.",
      sampleSize: 0,
      lastMatchup: null,
      recentMatchups: [],
      matchupAverage: null,
      matchupMedian: null,
      matchupHitRate: null,
      propType,
    };
  }

  const normalized = (games.length ? games : []).slice(0, 3).map((g) => {
    const statVal = measuredNum(boxValueFromGame(g, propType));
    const lineResult =
      statVal === null || sealedLine === null
        ? "Unavailable"
        : statVal > sealedLine
          ? "Over"
          : statVal < sealedLine
            ? "Under"
            : "Push";
    const differentTeam = Boolean(
      g.differentTeam ||
        (g.team && pick.team && String(g.team).toLowerCase() !== String(pick.team).toLowerCase())
    );
    const differentRole = Boolean(g.differentRole || g.roleContext === "DIFFERENT");
    const minutes = nonNegativeVolume(g.minutes);
    const fga = nonNegativeVolume(g.fga);
    const fta = nonNegativeVolume(g.fta);
    const fg3a = nonNegativeVolume(g.fg3a ?? g.fg3a);
    return {
      date: g.date || g.gameDate || null,
      teamAtTime: g.team || g.teamAtTime || pick.team || null,
      opponent: g.opponent || pick.opponent || null,
      propType,
      statValue: statVal === null ? null : roundStat(statVal),
      // Legacy field holds the propType-relevant value (not always points).
      points: statVal === null ? null : roundStat(statVal),
      minutes: minutes.value,
      minutesStatus: minutes.status,
      fga: propType === "POINTS" ? fga.value : null,
      fgaStatus: propType === "POINTS" ? fga.status : "NOT_APPLICABLE",
      fta: propType === "POINTS" ? fta.value : null,
      ftaStatus: propType === "POINTS" ? fta.status : "NOT_APPLICABLE",
      fg3a: propType === "POINTS" ? fg3a.value : null,
      starter: g.starter ?? g.started ?? null,
      homeAway: g.homeAway || g.location || null,
      againstTodaysLine: lineResult,
      differentTeamContext: differentTeam ? "Different-team context." : null,
      differentRoleContext: differentRole ? "Different-role context." : null,
      relevanceNote: differentTeam
        ? "Different-team context."
        : differentRole
          ? "Different-role context."
          : games.length === 1
            ? "Sample size 1 — do not treat as strong evidence."
            : null,
    };
  });

  const pts = normalized.map((g) => g.statValue ?? g.points).filter((v) => v !== null);
  const hit = hitRateVsLine(pts, sealedLine, finalSide);

  return {
    status: normalized.length ? "AVAILABLE" : "UNAVAILABLE",
    display: normalized.length
      ? null
      : "No previous matchup data available.",
    propType,
    sampleSize: measuredNum(matchup.sampleSize) || normalized.length,
    lastMatchup: normalized[0] || null,
    // Complete history: up to last 3 real matchups (never pad with zeros).
    recentMatchups: normalized,
    matchupAverage: matchup.matchupAverage != null ? roundStat(matchup.matchupAverage) : avg(pts),
    matchupMedian: matchup.matchupMedian != null ? roundStat(matchup.matchupMedian) : median(pts),
    matchupHitRate: hit,
    evidenceQuality: matchup.quality?.quality || (normalized.length >= 2 ? "USABLE" : "EARLY"),
  };
}

/**
 * Build the canonical Home detailed analysis payload from a pick + evidence.
 */
export function buildHomeDetailedAnalysisV1(pick = {}, options = {}) {
  const evidence = pick.courtEdgePlayerEvidence || pick.courtEdgePlayerEvidenceV1 || {};
  const packet =
    pick.courtEdgeDecisionPacketV1 ||
    pick.courtEdgeDecisionPacket ||
    {};
  const signals = pick.courtEdgeEngineSignalsV1 || pick.courtEdgeEngineSignals || {};
  const pregame = pick.pregameSnapshot || {};
  const sealed = Boolean(
    options.forceSealed ||
      pick.officiallySealed ||
      pick.sealed === true ||
      pick.lockStatus === "LOCKED" ||
      pregame.sealed === true
  );

  const league = String(first(pick.league, evidence.identity?.league, "WNBA")).toUpperCase();
  const sealedLine = resolveSealedLine(pick);
  const currentLine = num(
    first(pick.currentLine, pick.marketIntelligence?.currentLine, sealedLine)
  );
  const openingLine = num(
    first(pick.openingLine, pick.marketIntelligence?.openingLine, evidence.market?.openingLine)
  );
  const finalSide = normalizeSide(
    first(
      pick.finalCourtEdgeSide,
      pick.finalSide,
      pick.side,
      pick.pick,
      packet.layers?.freeze?.side
    )
  );
  const sameTeamFlipHint = Boolean(
    pick.sameTeamArbitrationFlip ||
      pick.sameTeamArbitration?.applied ||
      pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
  );
  const originalSide = normalizeSide(
    first(
      pick.originalModelSide,
      pick.sameTeamArbitration?.originalModelSide,
      pick.sameTeamArbitration?.originalOrganicSide,
      packet.layers?.freeze?.originalModelSide,
      // Same-team policy forces Under from an organic Over lean.
      sameTeamFlipHint && finalSide === "UNDER" ? "OVER" : null,
      finalSide
    )
  );

  const propType = resolveAnalysisPropType(pick, evidence);
  const evidencePropType = resolveAnalysisPropType(
    { propType: evidence.recentForm?.propType || "" },
    {}
  );
  const evidenceMatchesProp =
    !evidencePropType || evidencePropType === propType;
  // Prefer raw game logs for REB/AST so stale points arrays in evidence cannot win.
  const preferGameLogs =
    propType !== "POINTS" &&
    Array.isArray(pick.last5) &&
    pick.last5[0] &&
    typeof pick.last5[0] === "object";
  const last5Pts = extractStatList(
    preferGameLogs
      ? pick.last5
      : first(
          evidenceMatchesProp ? evidence.recentForm?.last5Values : null,
          evidenceMatchesProp ? evidence.recentForm?.last5Points : null,
          pick.last5,
          pick.playerState?.last5
        ),
    propType
  ).slice(0, 5);
  const last10Pts = extractStatList(
    preferGameLogs
      ? first(pick.last10, pick.bdlSeasonGames, pick.seasonGames, pick.last5)
      : first(
          evidenceMatchesProp ? evidence.recentForm?.last10Values : null,
          evidenceMatchesProp ? evidence.recentForm?.last10Points : null,
          pick.last10
        ),
    propType
  ).slice(0, 10);
  // Do not fabricate Last 10 from Last 5 alone when fewer than 10 games exist.
  const last10Display =
    last10Pts.length >= 10
      ? last10Pts
      : last10Pts.length > 0
        ? last10Pts
        : [];
  const seasonAvgRaw = measuredNum(
    first(
      evidence.recentForm?.seasonPointsAverage,
      pick.seasonAverage,
      pick.playerState?.seasonPoints
    )
  );
  // Zero with no game sample is poison — treat as unavailable.
  const seasonAvg =
    seasonAvgRaw === 0 && !last5Pts.length && !last10Display.length
      ? null
      : seasonAvgRaw;
  const seasonPts = extractStatList(
    pick.bdlSeasonGames || pick.seasonGames || [],
    propType
  );
  const trend = scoringTrend(last5Pts.length ? last5Pts : last10Display);
  const lineForHits = sealed ? sealedLine : currentLine ?? sealedLine;
  const last5Hit = hitRateVsLine(last5Pts, lineForHits, finalSide);
  const last10Hit = hitRateVsLine(last10Display, lineForHits, finalSide);
  const seasonHit = hitRateVsLine(
    seasonPts.length ? seasonPts : last10Display,
    lineForHits,
    finalSide
  );
  const statLabel =
    propType === "REBOUNDS"
      ? "rebounds"
      : propType === "ASSISTS"
        ? "assists"
        : "points";

  const projection = num(
    first(
      pick.projection,
      pick.projectedPoints,
      evidence.projections?.finalProjection,
      pregame.projection
    )
  );
  const fairLine = num(first(pick.fairLine, evidence.projections?.fairLine, pregame.fairLine));
  const gap = absoluteProjectionEdge({
    side: finalSide,
    line: sealedLine,
    projection,
  });

  const marketStatus =
    sealedLine === null && currentLine === null && openingLine === null
      ? "UNAVAILABLE"
      : pick.marketIntelligence?.available === false
        ? "UNAVAILABLE"
        : "AVAILABLE";
  const marketVsFinal = resolveMarketDirection({
    openingLine,
    currentLine,
    sealedLine,
    side: finalSide,
    marketStatus,
  });
  const marketVsOriginal = resolveMarketDirection({
    openingLine,
    currentLine,
    sealedLine,
    side: originalSide,
    marketStatus,
  });

  const defense = evidence.opponentContext || pick.defenseResult || {};
  const defenseStatus = String(
    first(defense.defenseStatus, defense.status, "UNAVAILABLE")
  ).toUpperCase();
  const defenseScore =
    defenseStatus === "UNAVAILABLE" ? null : num(defense.defenseScore);

  const availability = buildAvailabilitySection(pick, evidence);
  const matchupHistory = buildMatchupHistory(
    pick,
    evidence,
    lineForHits,
    finalSide,
    propType
  );

  // Single owner: sealed canonical → decision packet → pick final fields.
  const canonicalDecision = resolveCanonicalDecisionFields({
    ...pick,
    courtEdgeDecisionPacketV1: packet,
    finalCourtEdgeSide: finalSide,
  });
  const confidence = canonicalDecision.finalConfidence;
  const risk = canonicalDecision.finalRisk;

  const sameTeam = sameTeamFlipHint;

  const propSnapshot = {
    player: first(pick.player, pick.playerName, evidence.identity?.oddsPlayerName),
    team: first(pick.team, evidence.identity?.team),
    opponent: first(pick.opponent, evidence.identity?.opponent),
    league,
    propType,
    stat: first(pick.stat, propType === "REBOUNDS" ? "Rebounds" : propType === "ASSISTS" ? "Assists" : "Points"),
    gameDateTime: first(pick.commenceTime, pick.time, evidence.identity?.commenceTime),
    homeAway: first(pick.homeAway, pick.isHome === true ? "HOME" : pick.isHome === false ? "AWAY" : null),
    finalCourtEdgeSide: finalSide,
    sealedLine: roundStat(sealedLine),
    originalModelSide: originalSide,
    confidence,
    risk,
    bestSixRank: pick.bestSixRank ?? pick.controlledBestSixRank ?? null,
    topRank: pick.topPickRank ?? null,
    evidenceCoverage: roundStat(evidence.dataQuality?.coveragePct),
    dataMode: first(pick.dataMode, pick.wnbaDataCard?.dataMode, pick.playerState?.dataMode),
    sealedLiveStatus: sealed ? "SEALED" : "LIVE",
  };

  const recentPerformance = {
    propType,
    statLabel,
    last5Values: last5Pts.length ? last5Pts.map((v) => roundStat(v)) : null,
    last10Values: last10Display.length ? last10Display.map((v) => roundStat(v)) : null,
    // Legacy aliases — values are for propType, not always points.
    last5Points: last5Pts.length ? last5Pts.map((v) => roundStat(v)) : null,
    last5Average: avg(last5Pts),
    last5HitRate: last5Hit,
    last10Points: last10Display.length ? last10Display.map((v) => roundStat(v)) : null,
    last10Average: avg(last10Display),
    last10HitRate: last10Hit,
    last10SampleSize: last10Display.length,
    seasonAverage: roundStat(seasonAvg),
    seasonHitRate: seasonHit,
    recentHigh: last5Pts.length || last10Display.length
      ? roundStat(Math.max(...(last5Pts.length ? last5Pts : last10Display)))
      : null,
    recentLow: last5Pts.length || last10Display.length
      ? roundStat(Math.min(...(last5Pts.length ? last5Pts : last10Display)))
      : null,
    recentMedian: median(last5Pts.length ? last5Pts : last10Display),
    scoringTrend: trend,
  };

  const role = evidence.roleAndVolume || {};
  const expMin = nonNegativeVolume(
    first(pick.expectedMinutes, role.last5Minutes, pregame.expectedMinutes)
  );
  const last5Min = nonNegativeVolume(role.last5Minutes);
  const expFga = nonNegativeVolume(
    first(pick.expectedFGA, role.fga, pregame.expectedFGA)
  );
  const last5Fga = nonNegativeVolume(role.fga);
  const expFta = nonNegativeVolume(
    first(pick.expectedFTA, role.fta, pregame.expectedFTA)
  );
  const last5Fta = nonNegativeVolume(role.fta);
  const expUsage = nonNegativeVolume(role.estimatedUsage);
  const roleOpportunity = {
    expectedMinutes: expMin.value,
    expectedMinutesStatus: expMin.status,
    last5Minutes: last5Min.value,
    last5MinutesStatus: last5Min.status,
    minutesTrend: role.minutesTrend || null,
    expectedFGA: expFga.value,
    expectedFGAStatus: expFga.status,
    last5FGA: last5Fga.value,
    expectedFTA: expFta.value,
    expectedFTAStatus: expFta.status,
    last5FTA: last5Fta.value,
    expectedUsage: expUsage.value,
    expectedUsageStatus: expUsage.status,
    usageLabel: role.estimatedUsageLabel || "ESTIMATE_NOT_PROVIDER",
    starterBench: role.inferredRole || null,
    roleStability: role.roleStability || null,
    roleDirection: role.minutesTrend || null,
    roleVelocity: first(pick.roleVelocity, signals.engines?.roleVelocity?.status, null),
    teammateImpactSummary: role.teammateOutRoleChange
      ? "Teammate availability may shift usage"
      : "No notable teammate-impact signal",
    notableTeammateAbsencesReturns: pick.teammateStatuses || null,
    opportunitySignal: first(pick.opportunitySignal, null),
    sourceDistinction: {
      provider: ["last5Minutes", "last5FGA", "last5FTA"],
      calculated: ["expectedMinutes", "expectedFGA", "expectedFTA", "expectedUsage"],
      inferred: ["starterBench", "roleStability", "roleDirection"],
    },
  };

  const projectionDistribution = {
    rawProjection: roundStat(
      first(pick.projectionBeforeProfileCalibration, evidence.projections?.internalBaseline)
    ),
    profileAdjustedProjection: roundStat(
      first(pick.projectionAfterProfileCalibration, projection)
    ),
    finalProjection: roundStat(projection),
    fairLine: roundStat(fairLine),
    projectionGap: gap === null ? null : roundStat(gap),
    projectionRange: evidence.projections?.projectionRange || pick.projectionRange || null,
    distributionLinePercentile: roundStat(pick.linePercentile),
    recentRoleHitRate: last5Hit,
    ceiling: roundStat(first(pick.ceiling, pick.projectionCeiling)),
    floor: roundStat(first(pick.floor, pick.projectionFloor)),
    overRequiresCeiling: Boolean(pick.overRequiresCeiling || (finalSide === "OVER" && gap !== null && gap < 2)),
    underHasFloorProtection: Boolean(pick.underHasFloorProtection || (finalSide === "UNDER" && gap !== null && gap >= 2)),
    volatilityScore: roundStat(first(pick.volatilityScore, evidence.recentForm?.standardDeviation)),
    volatilityTier: first(pick.volatility, pick.volumeProfile?.minutesStability, "stable"),
    mainVolatilitySource: first(pick.volatilitySource, "scoring_dispersion"),
    projectionSanity: first(pick.projectionSanity, "PASS"),
  };

  const opponentContext = {
    directMatchupHistory: matchupHistory,
    opponentDefenseStatus: defenseStatus,
    opponentDefenseSource: first(defense.source, "unavailable"),
    defenseScore: defenseScore === null ? null : roundStat(defenseScore),
    defensiveArchetype: first(pick.defensiveArchetype, signals.engines?.defensiveArchetype?.archetype, null),
    archetypeSampleSize: measuredNum(
      first(pick.archetypeSampleSize, signals.engines?.defensiveArchetype?.sampleSize)
    ),
    matchupSignal: first(pick.matchupSignal, null),
    opponentRecentPointsAllowedProxy: roundStat(
      first(defense.recentPointsAllowedLast5, defense.last5PointsAllowed)
    ),
    comparablePlayerSample: pick.archetypeComparables || null,
    evidenceQuality: defense.dataQuality || defense.quality?.quality || defenseStatus,
    unavailableReason:
      defenseStatus === "UNAVAILABLE"
        ? first(defense.quality?.error, "opponent_defense_unavailable")
        : null,
  };

  const gameEnv = evidence.gameEnvironment || {};
  const gameEnvironment = {
    spread: roundStat(first(pick.spread, gameEnv.spread)),
    gameTotal: roundStat(first(pick.gameTotal, gameEnv.total)),
    impliedTeamTotal: roundStat(first(pick.impliedTeamTotal, gameEnv.impliedTeamTotal)),
    blowoutRisk: roundStat(first(pick.blowoutRisk, gameEnv.blowoutRisk)),
    truePace: null,
    truePaceStatus: league === "WNBA" ? "UNAVAILABLE" : "ENTITLEMENT_OR_UNAVAILABLE",
    paceProxy: roundStat(first(defense.paceProxy, defense.scoringEnvironmentProxy)),
    paceProxyLabel: "SCORING_ENVIRONMENT_PROXY",
    scoringEnvironmentProxy: roundStat(
      first(defense.scoringEnvironmentProxy, defense.paceProxy)
    ),
    homeAway: propSnapshot.homeAway,
    daysRest: measuredNum(first(pick.daysRest, pick.scheduleGapDays)),
    backToBack: Boolean(pick.backToBack),
    scheduleDensity: first(pick.scheduleDensity, null),
    overtimeMinuteLoad: first(pick.previousOt, pick.overtimeLoad, null),
    travelBurden: first(pick.travelBurden, null),
  };

  const marketAnalysis = {
    openingLine: roundStat(openingLine),
    selectedSealedLine: roundStat(sealedLine),
    currentLine: roundStat(currentLine),
    bookCount: measuredNum(first(pick.bookCount, evidence.market?.quality?.sampleSize)),
    consensus: roundStat(first(pick.consensusLine, evidence.market?.bookConsensus)),
    openingPrice: first(pick.openingOverPrice, pick.openingUnderPrice, null),
    currentPrice: first(pick.overOdds, pick.underOdds, evidence.market?.currentPrice),
    lineMovement: roundStat(first(pick.lineDelta, evidence.market?.lineMovement)),
    priceMovement: null,
    marketRelativeToOriginalSide: marketVsOriginal,
    marketRelativeToFinalSide: marketVsFinal,
    marketQuality: first(pick.marketQuality, pick.marketGrade, null),
    staleMarketStatus: Boolean(pick.marketWarnings?.length || evidence.market?.staleMarketWarning),
    providerTimestamp: first(pick.snapshotTime, evidence.market?.quality?.fetchedAt, null),
    compactResult: marketVsFinal.compact,
    // Explicit transparency: UNAVAILABLE ≠ AGAINST
    unavailableIsNotAgainst: true,
    openingSealedCurrentDistinct: true,
  };

  const topPickTransparency = buildTopPickTransparency(pick, {
    finalConfidence: confidence,
    finalRisk: risk,
  });

  const flipRaw = first(
    pick.flipFirst?.action,
    pick.decisionDataIntelligence?.flipFirst?.action,
    "KEEP"
  );
  const finalDecision = {
    originalModelSide: originalSide,
    readerSide: normalizeSide(first(pick.readerSide, pick.wnbaReader?.finalSide)),
    flipFirstAction: flipRaw,
    flipFirstDisplay: translateFlipAction(flipRaw),
    // Side Rescue has no production authority — never surface KEEP_ORIGINAL / NO_DECISIVE_RESCUE.
    sideRescueAction: null,
    sideRescueDisplay: null,
    sideRescueProductionAuthority: false,
    sameTeamArbitration: sameTeam
      ? {
          applied: true,
          originalOrganicSide: originalSide,
          finalForcedSide: finalSide,
          policyReason:
            pick.sameTeamArbitration?.reason ||
            "SameTeamOpportunityV2 — weaker teammate Over forced to Under",
          linePreserved: true,
          organicUnderEvidenceManufactured: false,
        }
      : { applied: false },
    finalCourtEdgeSide: finalSide,
    originalConfidence: roundConfidence(
      first(pick.confidenceBeforeProfileCalibration, pick.originalModelConfidence)
    ),
    finalConfidence: confidence,
    finalRisk: risk,
    strongestSupportingSignals: (first(pick.wnbaReader?.supports, pick.reasons, []) || [])
      .map((s) => scrubConsumerFacingText(s))
      .filter(Boolean),
    strongestContradictingSignals: (first(pick.wnbaReader?.disagrees, []) || [])
      .map((s) => scrubConsumerFacingText(s))
      .filter(Boolean),
    duplicateEvidenceSuppressed: first(
      signals.aggregation?.dedupLedger,
      packet.layers?.evidence?.suppressedDuplicates,
      []
    ),
    finalReadableExplanation: scrubConsumerFacingText(
      first(pick.displayWhy, pick.decisionIntelligence?.simpleExplanation, "")
    ),
    topPickTransparency,
    decisionPacketVersion: first(packet.version, packet.schemaVersion, null),
    decisionPacketHash: first(packet.decisionHash, null),
    buildVersion: HOME_DETAILED_ANALYSIS_BUILD,
    canonicalDecisionOwner: CANONICAL_DECISION_DISPLAY_OWNER,
    canonicalDecisionSource: canonicalDecision.source,
  };

  const dataQuality = {
    sections: {
      propSnapshot: { source: "sealed_pregame_and_identity", provider: "mixed" },
      recentPerformance: { source: "balldontlie", provider: "BALLDONTLIE" },
      matchupHistory: { source: "balldontlie", provider: "BALLDONTLIE" },
      roleOpportunity: { source: "balldontlie_plus_courtedge", provider: "mixed" },
      projectionDistribution: { source: "courtedge_calculation", provider: "CourtEdge" },
      opponentContext: {
        source: defenseStatus === "UNAVAILABLE" ? "unavailable" : "balldontlie_proxy",
        provider: defenseStatus === "ENTITLEMENT_BLOCKED" ? "SportsDataIO" : "BALLDONTLIE",
      },
      gameEnvironment: { source: "the-odds-api", provider: "Odds API" },
      marketAnalysis: { source: "the-odds-api", provider: "Odds API" },
      availability: { source: "balldontlie", provider: "BALLDONTLIE" },
      finalDecision: { source: "courtedge_decision_packet", provider: "CourtEdge" },
    },
    fetchedAt: first(pick.fetchedAt, evidence.builtAt, new Date().toISOString()),
    sampleSize: last5Pts.length,
    coverage: evidence.dataQuality?.coveragePct ?? null,
    staleStatus: Boolean(pick.stale),
    missingFields: [],
    entitlementRestrictions: league === "WNBA"
      ? ["SportsDataIO WNBA projections/team-stats blocked", "BDL team_season_averages 404"]
      : [],
    providerErrors: [],
    secretsExposed: false,
  };

  if (!last5Pts.length) dataQuality.missingFields.push("last5Points");
  if (!last10Display.length) dataQuality.missingFields.push("last10Points");
  if (defenseStatus === "UNAVAILABLE") dataQuality.missingFields.push("opponentDefense");
  if (matchupHistory.status === "UNAVAILABLE") dataQuality.missingFields.push("matchupHistory");

  // Shell gate: identity+market+projection+availability (~44%) without L5 is incomplete.
  const coveragePct = num(evidence.dataQuality?.coveragePct, 0);
  const shellAnalysis =
    last5Pts.length < 3 && coveragePct > 0 && coveragePct <= 55;
  dataQuality.analysisComplete = last5Pts.length >= 3 || coveragePct >= 66.6;
  dataQuality.shellAnalysis = shellAnalysis;
  dataQuality.completenessReason = shellAnalysis
    ? "shell_missing_recent_form"
    : dataQuality.analysisComplete
      ? null
      : "partial_without_form_floor";
  if (shellAnalysis) {
    dataQuality.missingFields.push("analysisShellIncomplete");
  }

  const liveMarketReference = sealed
    ? {
        referenceOnly: true,
        currentLine,
        marketRelativeToFinalSide: marketVsFinal,
        note: "Live market is reference-only after seal; sealed side/line/confidence/risk remain frozen.",
      }
    : null;

  const payload = {
    schemaVersion: HOME_DETAILED_ANALYSIS_VERSION,
    buildVersion: HOME_DETAILED_ANALYSIS_BUILD,
    analysisIntegrityVersion: ANALYSIS_INTEGRITY_VERSION,
    sideCalibrationVersion: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    sideCalibration: buildSideCalibrationMarker(league),
    builtAt: new Date().toISOString(),
    sealed,
    sealedAt: sealed ? first(pick.sealedAt, pregame.sealedAt, pick.lockTime, null) : null,
    propSnapshot,
    recentPerformance,
    matchupHistory,
    roleOpportunity,
    projectionDistribution,
    opponentContext,
    gameEnvironment,
    marketAnalysis,
    availability,
    finalDecision,
    dataQuality,
    liveMarketReference,
    // Canonical decision fields mirrored for UI — do not recompute.
    // Owner: sealed canonical → decision packet → pick final fields.
    canonical: {
      side: finalSide,
      line: roundStat(sealedLine),
      confidence,
      risk,
      bestSixRank: propSnapshot.bestSixRank,
      topRank: propSnapshot.topRank,
      originalModelSide: originalSide,
      owner: CANONICAL_DECISION_DISPLAY_OWNER,
      source: canonicalDecision.source,
    },
  };

  return payload;
}

/**
 * Attach analysis to a pick. Respects sealed immutability for official fields.
 * Rejects/rebuilds invalid evidence (e.g. accented-name join corruption) first.
 */
export function attachHomeDetailedAnalysisV1(pick = {}, options = {}) {
  if (!pick || typeof pick !== "object") return pick;

  let working = ensureValidPlayerEvidence(pick);

  const alreadySealed =
    working.homeDetailedAnalysisV1?.sealed === true &&
    working.homeDetailedAnalysisV1?.canonical;

  if (alreadySealed && options.rebuildSealed !== true) {
    // Refresh reference-only live market; keep frozen official analysis.
    const liveLine = measuredNum(first(working.currentLine, working.marketIntelligence?.currentLine));
    const frozen = working.homeDetailedAnalysisV1;
    const synced = syncCanonicalDecisionOntoPick(working, {
      finalConfidence: frozen.canonical?.confidence,
      finalRisk: frozen.canonical?.risk,
      source: "sealed_canonical",
    });
    return {
      ...synced,
      homeDetailedAnalysisV1: {
        ...frozen,
        liveMarketReference: {
          referenceOnly: true,
          currentLine: roundStat(liveLine),
          note: "Live market is reference-only after seal.",
          marketRelativeToFinalSide: resolveMarketDirection({
            openingLine: frozen.marketAnalysis?.openingLine,
            currentLine: liveLine,
            sealedLine: frozen.marketAnalysis?.selectedSealedLine ?? frozen.canonical?.line,
            side: frozen.canonical?.side,
            marketStatus: liveLine == null ? "UNAVAILABLE" : "AVAILABLE",
          }),
        },
      },
    };
  }

  const cacheKey = buildAnalysisCacheKey({
    league: working.league,
    playerId: working.playerId || working.wnbaPlayerId || working.providerIdentity?.canonicalPlayerId,
    teamId: working.teamId || working.providerIdentity?.canonicalTeamId,
    opponentId: working.opponentId,
    season: working.season,
    slateDate: working.slateDate || working.gameDate || working.date,
    line: resolveSealedLine(working),
    engineBuild: HOME_DETAILED_ANALYSIS_BUILD,
    evidenceSchema: working.courtEdgePlayerEvidence?.schemaVersion,
    decisionPacketVersion: working.courtEdgeDecisionPacketV1?.version,
    bucket: "homeDetailedAnalysisV1",
  });

  const analysis = options.useCache
    ? cacheWrap(cacheKey, () => buildHomeDetailedAnalysisV1(working, options))
    : buildHomeDetailedAnalysisV1(working, options);

  const withAnalysis = {
    ...working,
    homeDetailedAnalysisV1: analysis,
    homeDetailedAnalysisVersion: HOME_DETAILED_ANALYSIS_VERSION,
    courtEdgeSideCalibrationV1: analysis.sideCalibration,
  };

  return syncCanonicalDecisionOntoPick(withAnalysis, {
    finalConfidence: analysis.canonical?.confidence,
    finalRisk: analysis.canonical?.risk,
    source: analysis.canonical?.source || "analysis_build",
  });
}

export function ensureHomeDetailedAnalysisOnPicks(picks = [], options = {}) {
  return (Array.isArray(picks) ? picks : []).map((p) =>
    attachHomeDetailedAnalysisV1(p, options)
  );
}

/**
 * Text formatter for Copy Report — uses the same payload as the UI.
 * No raw gate codes; rounded numbers; complete matchup history (up to 3).
 */
export function formatHomeDetailedAnalysisReportText(analysis = {}, pick = {}) {
  if (!analysis || !analysis.schemaVersion) return "";
  const s = analysis.propSnapshot || {};
  const r = analysis.recentPerformance || {};
  const m = analysis.matchupHistory || {};
  const role = analysis.roleOpportunity || {};
  const proj = analysis.projectionDistribution || {};
  const opp = analysis.opponentContext || {};
  const env = analysis.gameEnvironment || {};
  const mkt = analysis.marketAnalysis || {};
  const avail = analysis.availability || {};
  const dec = analysis.finalDecision || {};
  const dq = analysis.dataQuality || {};
  const matchups = Array.isArray(m.recentMatchups) ? m.recentMatchups : [];

  const propType =
    s.propType ||
    r.propType ||
    analysis.propType ||
    "POINTS";
  const statWord =
    propType === "REBOUNDS"
      ? "reb"
      : propType === "ASSISTS"
        ? "ast"
        : "pts";
  const l5 = r.last5Values || r.last5Points || [];
  const l10 = r.last10Values || r.last10Points || [];
  const matchupLines =
    m.status === "UNAVAILABLE"
      ? [`  Matchup: ${m.display || "No previous matchup data available."}`]
      : matchups.length
        ? matchups.map((row, i) => {
            const val = row.statValue ?? row.points;
            const volume =
              propType === "POINTS"
                ? ` FGA ${row.fga ?? "Unavailable"} FTA ${row.fta ?? "Unavailable"}`
                : "";
            return `  Matchup ${i + 1}: ${row.date || "—"} ${statWord} ${val ?? "Unavailable"} min ${row.minutes ?? "Unavailable"}${volume} vs line: ${row.againstTodaysLine || "—"}`;
          })
        : [`  Matchup: ${m.display || "No previous matchup data available."}`];

  const flipDisplay =
    dec.flipFirstDisplay || translateFlipAction(dec.flipFirstAction);
  const roleLine =
    propType === "POINTS"
      ? `  Role: expMin ${role.expectedMinutes ?? "Unavailable"} L5min ${role.last5Minutes ?? "Unavailable"} expFGA ${role.expectedFGA ?? "Unavailable"} expFTA ${role.expectedFTA ?? "Unavailable"} stability ${role.roleStability ?? "—"}`
      : `  Role: expMin ${role.expectedMinutes ?? "Unavailable"} L5min ${role.last5Minutes ?? "Unavailable"} stability ${role.roleStability ?? "—"}`;

  const lines = [
    "  --- DETAILED ANALYSIS ---",
    `  Prop Snapshot: ${s.player} | ${s.team} vs ${s.opponent} | ${propType} | ${s.finalCourtEdgeSide} ${s.sealedLine} | Conf ${s.confidence}% | Risk ${s.risk} | ${s.sealedLiveStatus}`,
    `  Original model side: ${s.originalModelSide} | Official #${s.bestSixRank ?? "—"} | Coverage ${s.evidenceCoverage ?? "—"}%`,
    `  Recent: L5 ${statWord} [${l5.join(", ") || "Unavailable"}] avg ${r.last5Average ?? "Unavailable"} hit ${r.last5HitRate?.label || "Unavailable"}`,
    `  L10 ${statWord} [${l10.join(", ") || "Unavailable"}] avg ${r.last10Average ?? "Unavailable"} (n=${r.last10SampleSize ?? 0}) seasonAvg ${r.seasonAverage ?? "Unavailable"} trend ${r.scoringTrend?.trend || "Unavailable"}`,
    ...matchupLines,
    roleLine,
    `  Projection: raw ${proj.rawProjection ?? "—"} final ${proj.finalProjection ?? "—"} fair ${proj.fairLine ?? "—"} gap ${proj.projectionGap ?? "—"} vol ${proj.volatilityTier ?? "—"}`,
    `  Opponent defense: ${opp.opponentDefenseStatus} score ${opp.defenseScore ?? "Unavailable"} source ${opp.opponentDefenseSource}`,
    `  Environment: spread ${env.spread ?? "Unavailable"} total ${env.gameTotal ?? "Unavailable"} itt ${env.impliedTeamTotal ?? "Unavailable"} paceProxy ${env.paceProxy ?? "Unavailable"} (not true pace) rest ${env.daysRest ?? "Unavailable"}`,
    `  Market: open ${mkt.openingLine ?? "Unavailable"} sealed ${mkt.selectedSealedLine ?? "Unavailable"} current ${mkt.currentLine ?? "Unavailable"} → ${mkt.compactResult} (${mkt.marketRelativeToFinalSide?.explanation || ""})`,
    `  Availability: ${avail.displayStatus}`,
    `  Decision: ${dec.originalModelSide} → ${dec.finalCourtEdgeSide} | Conf ${dec.finalConfidence}% | Risk ${dec.finalRisk} | Flip ${flipDisplay} | SameTeam ${dec.sameTeamArbitration?.applied ? "YES" : "NO"}`,
    dec.topPickTransparency
      ? `  Top: rank ${dec.topPickTransparency.rank} | ${dec.topPickTransparency.reason}${
          dec.topPickTransparency.scoreVsNext?.explanation
            ? ` | ${dec.topPickTransparency.scoreVsNext.explanation}`
            : ""
        }`
      : null,
    `  Sources: coverage ${dq.coverage ?? "—"}% fetchedAt ${dq.fetchedAt || "—"} missing [${(dq.missingFields || []).join(", ") || "none"}]${
      dq.shellAnalysis ? " | SHELL_INCOMPLETE" : ""
    }`,
  ].filter(Boolean);
  return lines.join("\n");
}
