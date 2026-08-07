/**
 * Canonical player forecast packet + research universe + Official membership
 * Forecast layer never sees board size / side quotas.
 */
import { ARCHITECTURE_BUILD, FORECAST_MODEL_VERSION, MEMBERSHIP_VERSION, RESEARCH_UNIVERSE_VERSION } from "./versions.js";
import { buildPlayerMinutesModelV1 } from "./playerMinutesModelV1.js";
import { buildPlayerRoleStabilityEngineV1 } from "./playerRoleStabilityEngineV1.js";
import { buildPlayerScoringOpportunityModelV1 } from "./playerScoringOpportunityModelV1.js";
import { buildPlayerPointsDistributionEngineV1 } from "./playerPointsDistributionEngineV1.js";
import { buildPlayerPropMarketModelV1 } from "./playerPropMarketModelV1.js";
import { buildPredictionConflictIndexV1 } from "./predictionConflictIndexV1.js";
import {
  buildPlayerBlowoutSensitivityEngineV1,
  buildPropFailurePathEngineV1,
} from "./propFailurePathEngineV1.js";
import {
  buildPropSafetyEngineV1,
  classifyRiskV1,
  resolveAvailabilityCertainty,
} from "./propSafetyEngineV1.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeSide(side = "") {
  const s = String(side || "").toUpperCase();
  if (s.startsWith("OVER")) return "OVER";
  if (s.startsWith("UNDER")) return "UNDER";
  return null;
}

function playerKey(pick = {}) {
  return [
    pick.playerId || pick.player_id || "",
    String(pick.playerName || pick.player || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
    pick.eventId || pick.gameId || "",
    pick.line ?? pick.selectedLine ?? "",
  ].join("|");
}

/**
 * Evaluate one side packet (Over or Under) without board context.
 */
export function evaluateSideForecastPacketV1(pick = {}, options = {}) {
  const side = normalizeSide(pick.side || pick.pick);
  const stamped = { ...pick, side };
  const minutes = buildPlayerMinutesModelV1(stamped);
  const role = buildPlayerRoleStabilityEngineV1(stamped);
  const volume = buildPlayerScoringOpportunityModelV1(stamped, minutes);
  const distribution = buildPlayerPointsDistributionEngineV1(
    stamped,
    minutes,
    volume,
    {
      simulationCount: options.simulationCount,
      seed: options.seed ?? hashSeed(playerKey(stamped) + side),
    }
  );
  const market = buildPlayerPropMarketModelV1(stamped);
  const availability = resolveAvailabilityCertainty(stamped);
  const blowout = buildPlayerBlowoutSensitivityEngineV1(stamped, minutes);
  const conflict = buildPredictionConflictIndexV1({
    pick: stamped,
    minutes,
    role,
    volume,
    distribution,
    market,
    availabilityCertaintyScore: availability.availabilityCertaintyScore,
  });
  const failure = buildPropFailurePathEngineV1({
    pick: stamped,
    minutes,
    role,
    volume,
    market,
    blowout,
    conflict,
  });

  const rawWinProbability =
    side === "OVER"
      ? distribution.POver
      : side === "UNDER"
        ? distribution.PUnder
        : null;

  const safety = buildPropSafetyEngineV1({
    rawWinProbability: rawWinProbability ?? 0.5,
    minutes,
    role,
    distribution,
    market,
    conflict,
    failure,
    availability,
  });

  const risk = classifyRiskV1({
    pick: stamped,
    rawWinProbability: rawWinProbability ?? 0.5,
    safety,
    minutes,
    role,
    market,
    conflict,
    failure,
    availability,
    blowout,
    volume,
  });

  const line = num(stamped.line ?? stamped.selectedLine);
  const projection =
    num(stamped.projection) ??
    num(stamped.projectedPoints) ??
    num(stamped.finalProjection);
  const fairLine = num(stamped.fairLine) ?? num(stamped.fair_line);

  return {
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    side,
    line,
    projection,
    fairLine,
    projectionEdge: risk.projectionEdge,
    fairLineEdge: risk.fairEdge,
    projectionFairAgreement: risk.projectionFairAgreement,
    minutes,
    role,
    volume,
    distribution,
    market,
    blowout,
    conflict,
    failure,
    availability,
    safety,
    risk,
    rawWinProbability,
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    forcedSide: false,
    sourcePick: stamped,
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build dual-side research packet for one player-market.
 * Does not know board size.
 */
export function buildCanonicalPlayerForecastPacketV1(basePick = {}, options = {}) {
  const line = num(basePick.line ?? basePick.selectedLine ?? basePick.officialLine);
  const overBase = {
    ...basePick,
    side: "OVER",
    pick: "OVER",
    line,
  };
  const underBase = {
    ...basePick,
    side: "UNDER",
    pick: "UNDER",
    line,
  };

  const overPacket = evaluateSideForecastPacketV1(overBase, options);
  const underPacket = evaluateSideForecastPacketV1(underBase, options);

  const overScore =
    (overPacket.rawWinProbability ?? 0) * 0.55 +
    (overPacket.safety.finalSafetyScore ?? 0) / 100 * 0.45;
  const underScore =
    (underPacket.rawWinProbability ?? 0) * 0.55 +
    (underPacket.safety.finalSafetyScore ?? 0) / 100 * 0.45;

  const selectedSide = overScore >= underScore ? "OVER" : "UNDER";
  const selected =
    selectedSide === "OVER" ? overPacket : underPacket;
  const opposite =
    selectedSide === "OVER" ? underPacket : overPacket;

  return {
    playerId: basePick.playerId || basePick.player_id || null,
    playerName: basePick.playerName || basePick.player || null,
    teamId: basePick.teamId || null,
    team: basePick.team || basePick.teamKey || null,
    opponent: basePick.opponent || null,
    eventId: basePick.eventId || basePick.gameId || null,
    canonicalSlateDateCT:
      basePick.slateDate ||
      basePick.canonicalSlateDateCT ||
      basePick.gameDateCT ||
      null,
    market: selected.market,
    availability: selected.availability,
    minutesModel: selected.minutes,
    roleModel: selected.role,
    volumeModel: selected.volume,
    scoringModel: selected.volume,
    distribution: selected.distribution,
    overPacket,
    underPacket,
    selectedSide,
    selectedSideProbability: selected.rawWinProbability,
    oppositeSideProbability: opposite.rawWinProbability,
    selectedSideScore: selectedSide === "OVER" ? overScore : underScore,
    oppositeSideScore: selectedSide === "OVER" ? underScore : overScore,
    probability: {
      rawWinProbability: selected.rawWinProbability,
      calibratedWinProbability: null,
      probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    },
    uncertainty: {
      distributionWidth: selected.distribution.distributionWidth,
      conflictIndex: selected.conflict.conflictIndex,
    },
    safety: selected.safety,
    risk: selected.risk,
    membership: {
      officialEligible: selected.risk.officialEligible,
      risk: selected.risk.risk,
      wouldPassLowGate: selected.risk.wouldPassLowGate,
      wouldPassMediumGate: selected.risk.wouldPassMediumGate,
    },
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    predictionCreatedAt: new Date().toISOString(),
    forcedSide: false,
  };
}

/**
 * Research universe: evaluate all candidates, preserve HIGH.
 */
export function buildResearchUniverseV1(candidates = [], options = {}) {
  const packets = [];
  for (const c of candidates) {
    try {
      packets.push(buildCanonicalPlayerForecastPacketV1(c, options));
    } catch (err) {
      packets.push({
        error: String(err.message || err),
        playerName: c.playerName || c.player,
        researchEligible: true,
        officialEligible: false,
        risk: { risk: "HIGH", officialEligible: false },
      });
    }
  }

  const low = packets.filter((p) => p.risk?.risk === "LOW");
  const medium = packets.filter((p) => p.risk?.risk === "MEDIUM");
  const high = packets.filter(
    (p) => p.risk?.risk === "HIGH" || !p.risk?.risk
  );

  return {
    version: RESEARCH_UNIVERSE_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    totalValidPlayerMarkets: packets.length,
    researchUniverseSize: packets.length,
    dualSidePacketCount: packets.length * 2,
    LOW: low.length,
    MEDIUM: medium.length,
    HIGH: high.length,
    packets,
    counts: {
      LOW: low.length,
      MEDIUM: medium.length,
      HIGH: high.length,
      Official: low.length + medium.length,
      researchOnly: high.length,
    },
  };
}

function safetyRankKey(packet) {
  const s = packet.safety?.finalSafetyScore ?? 0;
  const p = packet.probability?.rawWinProbability ?? packet.selectedSideProbability ?? 0;
  return s * 1000 + p * 100;
}

/**
 * Official membership: LOW first (safest→riskiest), then qualified MEDIUM.
 * No slice(0,6). No minimum. HIGH blocked.
 */
export function selectOfficialBoardFromProbabilitySafetyV1(
  candidates = [],
  options = {}
) {
  const research = buildResearchUniverseV1(candidates, options);
  const officialPackets = research.packets
    .filter((p) => p.membership?.officialEligible === true)
    .sort((a, b) => {
      const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      const ra = riskOrder[a.risk?.risk] ?? 9;
      const rb = riskOrder[b.risk?.risk] ?? 9;
      if (ra !== rb) return ra - rb;
      return safetyRankKey(b) - safetyRankKey(a);
    });

  const selectedProps = officialPackets.map((packet, index) => {
    const src = packet.selectedSide === "OVER"
      ? packet.overPacket?.sourcePick
      : packet.underPacket?.sourcePick;
    const sidePacket =
      packet.selectedSide === "OVER" ? packet.overPacket : packet.underPacket;
    return {
      ...src,
      ...decorateOfficialProp(packet, sidePacket, index),
    };
  });

  return {
    version: MEMBERSHIP_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    membershipModel: MEMBERSHIP_VERSION,
    selectedProps,
    officialCount: selectedProps.length,
    lowCount: selectedProps.filter((p) => p.trueRisk === "LOW").length,
    mediumCount: selectedProps.filter((p) => p.trueRisk === "MEDIUM").length,
    highBlocked: research.HIGH,
    research,
    boardSizePolicy: "UNBOUNDED_QUALITY_FIRST",
    forcedSide: false,
    noFixedSix: true,
    noMinimumCount: true,
    noSideQuota: true,
  };
}

function decorateOfficialProp(packet, sidePacket, index) {
  return {
    side: packet.selectedSide,
    pick: packet.selectedSide,
    trueRisk: packet.risk?.risk,
    riskLabel: packet.risk?.risk,
    safetyScore: packet.safety?.finalSafetyScore,
    rawWinProbability: packet.probability?.rawWinProbability,
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    conflictIndex: packet.uncertainty?.conflictIndex,
    minutesStabilityScore: packet.minutesModel?.minutesStabilityScore,
    roleStabilityScore: packet.roleModel?.roleStabilityScore,
    marketQualityScore: packet.market?.marketQualityScore,
    expectedMinutes: packet.minutesModel?.expectedMinutes,
    projectionEdge: sidePacket?.projectionEdge,
    fairLineEdge: sidePacket?.fairLineEdge,
    projectionFairAgreement: sidePacket?.projectionFairAgreement,
    supportingEvidenceFamilies:
      sidePacket?.conflict?.supportingEvidenceFamilies || [],
    opposingEvidenceFamilies:
      sidePacket?.conflict?.opposingEvidenceFamilies || [],
    failurePaths: sidePacket?.failure?.failurePaths || [],
    majorFailurePathCount: sidePacket?.failure?.majorFailurePathCount,
    safetyComponents: packet.safety?.safetyComponents,
    forecastPacket: packet,
    forecastModelVersion: packet.forecastModelVersion,
    minutesModelVersion: packet.minutesModel?.version,
    roleModelVersion: packet.roleModel?.version,
    distributionModelVersion: packet.distribution?.version,
    marketModelVersion: packet.market?.version,
    conflictModelVersion: sidePacket?.conflict?.version,
    safetyModelVersion: packet.safety?.version,
    membershipVersion: MEMBERSHIP_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    safetyRank: index + 1,
    officialEligible: true,
    forcedSide: false,
    membershipQualificationStatus:
      packet.risk?.risk === "LOW"
        ? "QUALIFIED_LOW_RISK"
        : "QUALIFIED_MEDIUM_RISK",
  };
}

/**
 * Correlation audit — diagnostic only, no forced flips.
 */
export function buildPropCorrelationAuditV1(officialProps = []) {
  const byTeam = new Map();
  for (const p of officialProps) {
    const team = String(p.team || p.teamKey || "").toLowerCase();
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(p);
  }
  const audits = [];
  for (const [team, props] of byTeam) {
    if (props.length < 2) continue;
    audits.push({
      correlationFamily: `TEAM:${team}`,
      propCount: props.length,
      sharedUsageDependency: true,
      sharedBlowoutDependency: true,
      sharedInjuryDependency: true,
      sharedGameScriptDependency: true,
      correlationRisk: props.length >= 3 ? "ELEVATED" : "MODERATE",
      note: "Diagnostic only — no automatic deletion or side flip",
    });
  }
  return { version: "prop-correlation-audit-v1", audits };
}

export function buildRiskExplanationV1(prop = {}) {
  const risk = prop.trueRisk || prop.riskLabel || "HIGH";
  const whyLike = [];
  const whyNotLow = [];
  if ((prop.rawWinProbability ?? 0) >= 0.57) {
    whyLike.push(
      `${Math.round((prop.rawWinProbability || 0) * 100)}% modeled clear probability`
    );
  }
  if ((prop.minutesStabilityScore ?? 0) >= 75) {
    whyLike.push(
      `Stable ~${prop.expectedMinutes ?? "?"} minute role (stability ${prop.minutesStabilityScore})`
    );
  }
  if (prop.projectionFairAgreement) {
    whyLike.push("Projection and fair line agree");
  }
  const fams = prop.supportingEvidenceFamilies || [];
  if (fams.length) {
    whyLike.push(
      `${fams.length} independent evidence families support ${prop.side || prop.pick}`
    );
  }
  if ((prop.marketQualityScore ?? 0) >= 65) {
    whyLike.push("Strong market agreement / quality");
  }
  const fails = prop.failurePaths || [];
  const mainLose =
    fails[0]?.label ||
    (fails.length ? fails.map((f) => f.label).join("; ") : "Unexpected variance");

  if (risk === "MEDIUM" || risk === "HIGH") {
    if ((prop.minutesStabilityScore ?? 100) < 75) {
      whyNotLow.push(`Minutes stability ${prop.minutesStabilityScore}`);
    }
    if ((prop.roleStabilityScore ?? 100) < 75) {
      whyNotLow.push(`Role stability ${prop.roleStabilityScore}`);
    }
    if ((prop.conflictIndex ?? 0) > 20) {
      whyNotLow.push(`Conflict index ${prop.conflictIndex}`);
    }
    if ((prop.majorFailurePathCount ?? 0) > 1) {
      whyNotLow.push(`${prop.majorFailurePathCount} meaningful failure paths`);
    }
    if ((prop.marketQualityScore ?? 100) < 65) {
      whyNotLow.push("Market quality below LOW threshold");
    }
  }

  return {
    risk,
    title: `${risk} RISK`,
    whyCourtEdgeLikesIt: whyLike,
    whyItIsNotLow: whyNotLow,
    mainWayItLoses: mainLose,
    plainLanguage:
      risk === "LOW"
        ? `LOW RISK\n\nWhy CourtEdge likes it:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nMain way it loses:\n• ${mainLose}`
        : risk === "MEDIUM"
          ? `MEDIUM RISK\n\nWhy it qualifies:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nWhy it isn't LOW:\n${whyNotLow.map((x) => `• ${x}`).join("\n")}`
          : `HIGH RISK — research only`,
  };
}
