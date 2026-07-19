/**
 * CourtEdge Home Detailed Analysis V1
 * One canonical server-built payload for Home expandable analysis + Copy Report.
 * UI must not recalculate side/confidence/risk.
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

export const HOME_DETAILED_ANALYSIS_VERSION = "homeDetailedAnalysisV1";
export const HOME_DETAILED_ANALYSIS_BUILD =
  "courteedge-home-completion-tomorrow-six-v1";

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
  const nums = values.map((v) => num(v)).filter((v) => v !== null);
  if (!nums.length) return null;
  return Number((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(2));
}

function median(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) {
    return Number(((nums[mid - 1] + nums[mid]) / 2).toFixed(2));
  }
  return nums[mid];
}

function hitRateVsLine(points = [], line = null, side = "OVER") {
  const L = num(line);
  const s = normalizeSide(side) || "OVER";
  const pts = (points || []).map((v) => num(v)).filter((v) => v !== null);
  if (L === null || !pts.length) {
    return { hits: null, sample: pts.length, rate: null, label: "Unavailable" };
  }
  const hits = pts.filter((p) => (s === "OVER" ? p > L : p < L)).length;
  return {
    hits,
    sample: pts.length,
    rate: Number((hits / pts.length).toFixed(3)),
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

function extractPointsList(source) {
  if (!source) return [];
  if (Array.isArray(source)) {
    if (!source.length) return [];
    if (typeof source[0] === "number") return source.map((v) => num(v)).filter((v) => v !== null);
    return source
      .map((g) => num(g?.points ?? g?.pts ?? g?.value))
      .filter((v) => v !== null);
  }
  return [];
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
  const s = normalizeSide(side);
  if (open === null || cur === null || !s) {
    return {
      compact: "UNAVAILABLE",
      relativeToSide: "UNAVAILABLE",
      explanation: "Opening or current line missing — not treated as AGAINST.",
    };
  }
  const delta = cur - open;
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

function buildMatchupHistory(pick = {}, evidence = {}, sealedLine = null, finalSide = "OVER") {
  const matchup = evidence.matchup || {};
  const games =
    pick.matchupGames ||
    pick.opponentMatchupGames ||
    (Array.isArray(matchup.points)
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
    };
  }

  const normalized = (games.length ? games : []).slice(0, 3).map((g) => {
    const pts = num(g.points ?? g.pts);
    const lineResult =
      pts === null || sealedLine === null
        ? "Unavailable"
        : pts > sealedLine
          ? "Over"
          : pts < sealedLine
            ? "Under"
            : "Push";
    const differentTeam = Boolean(
      g.differentTeam ||
        (g.team && pick.team && String(g.team).toLowerCase() !== String(pick.team).toLowerCase())
    );
    const differentRole = Boolean(g.differentRole || g.roleContext === "DIFFERENT");
    return {
      date: g.date || g.gameDate || null,
      teamAtTime: g.team || g.teamAtTime || pick.team || null,
      opponent: g.opponent || pick.opponent || null,
      points: pts,
      minutes: num(g.minutes),
      fga: num(g.fga),
      fta: num(g.fta),
      fg3a: num(g.fg3a ?? g.fg3a),
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

  const pts = normalized.map((g) => g.points).filter((v) => v !== null);
  const hit = hitRateVsLine(pts, sealedLine, finalSide);

  return {
    status: normalized.length ? "AVAILABLE" : "UNAVAILABLE",
    display: normalized.length
      ? null
      : "No previous matchup data available.",
    sampleSize: matchup.sampleSize || normalized.length,
    lastMatchup: normalized[0] || null,
    recentMatchups: normalized,
    matchupAverage: matchup.matchupAverage ?? avg(pts),
    matchupMedian: matchup.matchupMedian ?? median(pts),
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
  const originalSide = normalizeSide(
    first(
      pick.originalModelSide,
      pick.sameTeamArbitration?.originalModelSide,
      packet.layers?.freeze?.originalModelSide,
      finalSide
    )
  );

  const last5Pts = extractPointsList(
    first(evidence.recentForm?.last5Points, pick.last5, pick.playerState?.last5)
  ).slice(0, 5);
  const last10Pts = extractPointsList(
    first(evidence.recentForm?.last10Points, pick.last10)
  ).slice(0, 10);
  // Do not fabricate Last 10 from Last 5 alone when fewer than 10 games exist.
  const last10Display =
    last10Pts.length >= 10
      ? last10Pts
      : last10Pts.length > 0
        ? last10Pts
        : [];
  const seasonAvg = num(
    first(
      evidence.recentForm?.seasonPointsAverage,
      pick.seasonAverage,
      pick.playerState?.seasonPoints
    )
  );
  const seasonPts = extractPointsList(pick.bdlSeasonGames || pick.seasonGames || []);
  const trend = scoringTrend(last5Pts.length ? last5Pts : last10Display);
  const lineForHits = sealed ? sealedLine : currentLine ?? sealedLine;
  const last5Hit = hitRateVsLine(last5Pts, lineForHits, finalSide);
  const last10Hit = hitRateVsLine(last10Display, lineForHits, finalSide);
  const seasonHit = hitRateVsLine(
    seasonPts.length ? seasonPts : last10Display,
    lineForHits,
    finalSide
  );

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
    side: finalSide,
    marketStatus,
  });
  const marketVsOriginal = resolveMarketDirection({
    openingLine,
    currentLine,
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
  const matchupHistory = buildMatchupHistory(pick, evidence, lineForHits, finalSide);

  const confidence = num(
    first(
      pick.confidence,
      pick.finalConfidence,
      packet.layers?.freeze?.confidence,
      pick.winProbability
    )
  );
  const risk = String(
    first(
      pick.displayTrueRisk,
      pick.decisionIntelligence?.trueRisk,
      pick.trueRisk,
      packet.layers?.freeze?.risk,
      "MEDIUM"
    )
  ).toUpperCase();

  const sameTeam = Boolean(
    pick.sameTeamArbitrationFlip ||
      pick.sameTeamArbitration?.applied ||
      pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
  );

  const propSnapshot = {
    player: first(pick.player, pick.playerName, evidence.identity?.oddsPlayerName),
    team: first(pick.team, evidence.identity?.team),
    opponent: first(pick.opponent, evidence.identity?.opponent),
    league,
    gameDateTime: first(pick.commenceTime, pick.time, evidence.identity?.commenceTime),
    homeAway: first(pick.homeAway, pick.isHome === true ? "HOME" : pick.isHome === false ? "AWAY" : null),
    finalCourtEdgeSide: finalSide,
    sealedLine,
    originalModelSide: originalSide,
    confidence,
    risk,
    bestSixRank: pick.bestSixRank ?? pick.controlledBestSixRank ?? null,
    topRank: pick.topPickRank ?? null,
    evidenceCoverage: evidence.dataQuality?.coveragePct ?? null,
    dataMode: first(pick.dataMode, pick.wnbaDataCard?.dataMode, pick.playerState?.dataMode),
    sealedLiveStatus: sealed ? "SEALED" : "LIVE",
  };

  const recentPerformance = {
    last5Points: last5Pts.length ? last5Pts : null,
    last5Average: avg(last5Pts),
    last5HitRate: last5Hit,
    last10Points: last10Display.length ? last10Display : null,
    last10Average: avg(last10Display),
    last10HitRate: last10Hit,
    last10SampleSize: last10Display.length,
    seasonAverage: seasonAvg,
    seasonHitRate: seasonHit,
    recentHigh: last5Pts.length || last10Display.length
      ? Math.max(...(last5Pts.length ? last5Pts : last10Display))
      : null,
    recentLow: last5Pts.length || last10Display.length
      ? Math.min(...(last5Pts.length ? last5Pts : last10Display))
      : null,
    recentMedian: median(last5Pts.length ? last5Pts : last10Display),
    scoringTrend: trend,
  };

  const role = evidence.roleAndVolume || {};
  const roleOpportunity = {
    expectedMinutes: num(first(pick.expectedMinutes, role.last5Minutes, pregame.expectedMinutes)),
    last5Minutes: num(role.last5Minutes),
    minutesTrend: role.minutesTrend || null,
    expectedFGA: num(first(pick.expectedFGA, role.fga, pregame.expectedFGA)),
    last5FGA: num(role.fga),
    expectedFTA: num(first(pick.expectedFTA, role.fta, pregame.expectedFTA)),
    last5FTA: num(role.fta),
    expectedUsage: num(role.estimatedUsage),
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
    rawProjection: num(first(pick.projectionBeforeProfileCalibration, evidence.projections?.internalBaseline)),
    profileAdjustedProjection: num(first(pick.projectionAfterProfileCalibration, projection)),
    finalProjection: projection,
    fairLine,
    projectionGap: gap,
    projectionRange: evidence.projections?.projectionRange || pick.projectionRange || null,
    distributionLinePercentile: num(pick.linePercentile),
    recentRoleHitRate: last5Hit,
    ceiling: num(first(pick.ceiling, pick.projectionCeiling)),
    floor: num(first(pick.floor, pick.projectionFloor)),
    overRequiresCeiling: Boolean(pick.overRequiresCeiling || (finalSide === "OVER" && gap !== null && gap < 2)),
    underHasFloorProtection: Boolean(pick.underHasFloorProtection || (finalSide === "UNDER" && gap !== null && gap >= 2)),
    volatilityScore: num(first(pick.volatilityScore, evidence.recentForm?.standardDeviation)),
    volatilityTier: first(pick.volatility, pick.volumeProfile?.minutesStability, "stable"),
    mainVolatilitySource: first(pick.volatilitySource, "scoring_dispersion"),
    projectionSanity: first(pick.projectionSanity, "PASS"),
  };

  const opponentContext = {
    directMatchupHistory: matchupHistory,
    opponentDefenseStatus: defenseStatus,
    opponentDefenseSource: first(defense.source, "unavailable"),
    defenseScore,
    defensiveArchetype: first(pick.defensiveArchetype, signals.engines?.defensiveArchetype?.archetype, null),
    archetypeSampleSize: num(first(pick.archetypeSampleSize, signals.engines?.defensiveArchetype?.sampleSize)),
    matchupSignal: first(pick.matchupSignal, null),
    opponentRecentPointsAllowedProxy: num(
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
    spread: num(first(pick.spread, gameEnv.spread)),
    gameTotal: num(first(pick.gameTotal, gameEnv.total)),
    impliedTeamTotal: num(first(pick.impliedTeamTotal, gameEnv.impliedTeamTotal)),
    blowoutRisk: num(first(pick.blowoutRisk, gameEnv.blowoutRisk)),
    truePace: null,
    truePaceStatus: league === "WNBA" ? "UNAVAILABLE" : "ENTITLEMENT_OR_UNAVAILABLE",
    paceProxy: num(first(defense.paceProxy, defense.scoringEnvironmentProxy)),
    paceProxyLabel: "SCORING_ENVIRONMENT_PROXY",
    scoringEnvironmentProxy: num(first(defense.scoringEnvironmentProxy, defense.paceProxy)),
    homeAway: propSnapshot.homeAway,
    daysRest: num(first(pick.daysRest, pick.scheduleGapDays)),
    backToBack: Boolean(pick.backToBack),
    scheduleDensity: first(pick.scheduleDensity, null),
    overtimeMinuteLoad: first(pick.previousOt, pick.overtimeLoad, null),
    travelBurden: first(pick.travelBurden, null),
  };

  const marketAnalysis = {
    openingLine,
    selectedSealedLine: sealedLine,
    currentLine,
    bookCount: num(first(pick.bookCount, evidence.market?.quality?.sampleSize)),
    consensus: num(first(pick.consensusLine, evidence.market?.bookConsensus)),
    openingPrice: first(pick.openingOverPrice, pick.openingUnderPrice, null),
    currentPrice: first(pick.overOdds, pick.underOdds, evidence.market?.currentPrice),
    lineMovement: num(first(pick.lineDelta, evidence.market?.lineMovement)),
    priceMovement: null,
    marketRelativeToOriginalSide: marketVsOriginal,
    marketRelativeToFinalSide: marketVsFinal,
    marketQuality: first(pick.marketQuality, pick.marketGrade, null),
    staleMarketStatus: Boolean(pick.marketWarnings?.length || evidence.market?.staleMarketWarning),
    providerTimestamp: first(pick.snapshotTime, evidence.market?.quality?.fetchedAt, null),
    compactResult: marketVsFinal.compact,
  };

  const finalDecision = {
    originalModelSide: originalSide,
    readerSide: normalizeSide(first(pick.readerSide, pick.wnbaReader?.finalSide)),
    flipFirstAction: first(
      pick.flipFirst?.action,
      pick.decisionDataIntelligence?.flipFirst?.action,
      "KEEP"
    ),
    sideRescueAction: first(pick.sideRescue?.action, pick.sideRescueAction, "KEEP_ORIGINAL"),
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
    originalConfidence: num(first(pick.confidenceBeforeProfileCalibration, pick.originalModelConfidence)),
    finalConfidence: confidence,
    finalRisk: risk,
    strongestSupportingSignals: first(
      pick.wnbaReader?.supports,
      pick.reasons,
      []
    ),
    strongestContradictingSignals: first(pick.wnbaReader?.disagrees, []),
    duplicateEvidenceSuppressed: first(
      signals.aggregation?.dedupLedger,
      packet.layers?.evidence?.suppressedDuplicates,
      []
    ),
    finalReadableExplanation: first(
      pick.displayWhy,
      pick.decisionIntelligence?.simpleExplanation,
      ""
    ),
    topPickTransparency: (() => {
      const rank = Number(pick.topPickRank ?? pick.topRank ?? 0);
      if (!(rank >= 1 && rank <= 2)) return null;
      const why =
        pick.topPickReason ||
        pick.decisionIntelligence?.topPickReason ||
        pick.displayWhy ||
        pick.decisionIntelligence?.simpleExplanation ||
        "Selected among Tomorrow Best 6 on relative edge, confidence, and risk.";
      return {
        rank,
        reason: String(why),
        selectedFromBestSix: true,
        labelOnly: true,
      };
    })(),
    decisionPacketVersion: first(packet.version, packet.schemaVersion, null),
    decisionPacketHash: first(packet.decisionHash, null),
    buildVersion: HOME_DETAILED_ANALYSIS_BUILD,
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
    canonical: {
      side: finalSide,
      line: sealedLine,
      confidence,
      risk,
      bestSixRank: propSnapshot.bestSixRank,
      topRank: propSnapshot.topRank,
      originalModelSide: originalSide,
    },
  };

  return payload;
}

/**
 * Attach analysis to a pick. Respects sealed immutability for official fields.
 */
export function attachHomeDetailedAnalysisV1(pick = {}, options = {}) {
  if (!pick || typeof pick !== "object") return pick;

  const alreadySealed =
    pick.homeDetailedAnalysisV1?.sealed === true &&
    pick.homeDetailedAnalysisV1?.canonical;

  if (alreadySealed && options.rebuildSealed !== true) {
    // Refresh reference-only live market; keep frozen official analysis.
    const liveLine = num(first(pick.currentLine, pick.marketIntelligence?.currentLine));
    const frozen = pick.homeDetailedAnalysisV1;
    return {
      ...pick,
      homeDetailedAnalysisV1: {
        ...frozen,
        liveMarketReference: {
          referenceOnly: true,
          currentLine: liveLine,
          note: "Live market is reference-only after seal.",
          marketRelativeToFinalSide: resolveMarketDirection({
            openingLine: frozen.marketAnalysis?.openingLine,
            currentLine: liveLine,
            side: frozen.canonical?.side,
            marketStatus: liveLine == null ? "UNAVAILABLE" : "AVAILABLE",
          }),
        },
      },
    };
  }

  const cacheKey = buildAnalysisCacheKey({
    league: pick.league,
    playerId: pick.playerId || pick.wnbaPlayerId || pick.providerIdentity?.canonicalPlayerId,
    teamId: pick.teamId || pick.providerIdentity?.canonicalTeamId,
    opponentId: pick.opponentId,
    season: pick.season,
    slateDate: pick.slateDate || pick.gameDate || pick.date,
    line: resolveSealedLine(pick),
    engineBuild: HOME_DETAILED_ANALYSIS_BUILD,
    evidenceSchema: pick.courtEdgePlayerEvidence?.schemaVersion,
    decisionPacketVersion: pick.courtEdgeDecisionPacketV1?.version,
    bucket: "homeDetailedAnalysisV1",
  });

  const analysis = options.useCache
    ? cacheWrap(cacheKey, () => buildHomeDetailedAnalysisV1(pick, options))
    : buildHomeDetailedAnalysisV1(pick, options);

  return {
    ...pick,
    homeDetailedAnalysisV1: analysis,
    homeDetailedAnalysisVersion: HOME_DETAILED_ANALYSIS_VERSION,
    courtEdgeSideCalibrationV1: analysis.sideCalibration,
  };
}

export function ensureHomeDetailedAnalysisOnPicks(picks = [], options = {}) {
  return (Array.isArray(picks) ? picks : []).map((p) =>
    attachHomeDetailedAnalysisV1(p, options)
  );
}

/**
 * Text formatter for Copy Report — uses the same payload as the UI.
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

  const lines = [
    "  --- DETAILED ANALYSIS ---",
    `  Prop Snapshot: ${s.player} | ${s.team} vs ${s.opponent} | ${s.finalCourtEdgeSide} ${s.sealedLine} | Conf ${s.confidence}% | Risk ${s.risk} | ${s.sealedLiveStatus}`,
    `  Original model side: ${s.originalModelSide} | Best6 #${s.bestSixRank ?? "—"} | Coverage ${s.evidenceCoverage ?? "—"}%`,
    `  Recent: L5 [${(r.last5Points || []).join(", ") || "Unavailable"}] avg ${r.last5Average ?? "Unavailable"} hit ${r.last5HitRate?.label || "Unavailable"}`,
    `  L10 [${(r.last10Points || []).join(", ") || "Unavailable"}] avg ${r.last10Average ?? "Unavailable"} (n=${r.last10SampleSize ?? 0}) seasonAvg ${r.seasonAverage ?? "Unavailable"} trend ${r.scoringTrend?.trend || "Unavailable"}`,
    m.status === "UNAVAILABLE"
      ? `  Matchup: ${m.display}`
      : `  Last matchup: ${m.lastMatchup?.date || "—"} pts ${m.lastMatchup?.points ?? "Unavailable"} min ${m.lastMatchup?.minutes ?? "Unavailable"} FGA ${m.lastMatchup?.fga ?? "Unavailable"} FTA ${m.lastMatchup?.fta ?? "Unavailable"} vs line: ${m.lastMatchup?.againstTodaysLine || "—"} (n=${m.sampleSize})`,
    `  Role: expMin ${role.expectedMinutes ?? "Unavailable"} L5min ${role.last5Minutes ?? "Unavailable"} expFGA ${role.expectedFGA ?? "Unavailable"} expFTA ${role.expectedFTA ?? "Unavailable"} stability ${role.roleStability ?? "—"}`,
    `  Projection: raw ${proj.rawProjection ?? "—"} final ${proj.finalProjection ?? "—"} fair ${proj.fairLine ?? "—"} gap ${proj.projectionGap ?? "—"} vol ${proj.volatilityTier ?? "—"}`,
    `  Opponent defense: ${opp.opponentDefenseStatus} score ${opp.defenseScore ?? "Unavailable"} source ${opp.opponentDefenseSource}`,
    `  Environment: spread ${env.spread ?? "Unavailable"} total ${env.gameTotal ?? "Unavailable"} itt ${env.impliedTeamTotal ?? "Unavailable"} paceProxy ${env.paceProxy ?? "Unavailable"} (not true pace) rest ${env.daysRest ?? "Unavailable"}`,
    `  Market: open ${mkt.openingLine ?? "Unavailable"} sealed ${mkt.selectedSealedLine ?? "Unavailable"} current ${mkt.currentLine ?? "Unavailable"} → ${mkt.compactResult} (${mkt.marketRelativeToFinalSide?.explanation || ""})`,
    `  Availability: ${avail.displayStatus}`,
    `  Decision: ${dec.originalModelSide} → ${dec.finalCourtEdgeSide} | Flip ${dec.flipFirstAction} | Rescue ${dec.sideRescueAction} | SameTeam ${dec.sameTeamArbitration?.applied ? "YES" : "NO"}`,
    `  Sources: coverage ${dq.coverage ?? "—"}% fetchedAt ${dq.fetchedAt || "—"} missing [${(dq.missingFields || []).join(", ") || "none"}]`,
  ];
  return lines.join("\n");
}
