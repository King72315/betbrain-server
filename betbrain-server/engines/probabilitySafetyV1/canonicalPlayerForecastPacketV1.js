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
import { classifyRiskEmpiricalV2 } from "../empiricalSafePropV2/reliabilityModelV2.js";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  MEMBERSHIP_VERSION_V2,
} from "../empiricalSafePropV2/versions.js";
import { persistResearchUniversePacketsV2 } from "../empiricalSafePropV2/researchPacketPersistenceV2.js";
import { annotateSlateRelativeStrengthV1 } from "../empiricalSafePropV2/slateRelativeStrengthV1.js";
import { buildEmpiricalRiskExplanationV2 } from "../empiricalSafePropV2/explanationsV2.js";
import { computeCalibrationHashV2 } from "../empiricalSafePropV2/prospectiveSlateFreezeV2.js";
import { isEmpiricalSafePropV2Enabled } from "../topProps/courtEdgeFeatureFlagsV1.js";

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

  const riskV1 = classifyRiskV1({
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

  const risk = isEmpiricalSafePropV2Enabled(options)
    ? classifyRiskEmpiricalV2({
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
      })
    : riskV1;

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
    riskV1Legacy: riskV1,
    reliabilityProbability: risk.reliabilityProbability ?? null,
    safePathway: risk.safePathway ?? null,
    rawWinProbability,
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    forcedSide: false,
    sourcePick: stamped,
    architectureBuild: isEmpiricalSafePropV2Enabled(options)
      ? EMPIRICAL_SAFE_PROP_V2_BUILD
      : ARCHITECTURE_BUILD,
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
    riskV1Legacy: selected.riskV1Legacy,
    reliabilityProbability:
      selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
    trustScore: selected.risk?.trustScore ?? null,
    trustComponents: selected.risk?.trustComponents ?? null,
    safePathway: selected.safePathway ?? selected.risk?.safePathway,
    pathwayMatched: selected.risk?.pathwayMatched ?? false,
    pathwayScore: selected.risk?.pathwayScore ?? 0,
    pathwayEvidence: selected.risk?.pathwayEvidence ?? [],
    membership: {
      officialEligible: selected.risk.officialEligible,
      risk: selected.risk.risk,
      wouldPassLowGate: selected.risk.wouldPassLowGate,
      wouldPassMediumGate: selected.risk.wouldPassMediumGate,
      safePathway: selected.risk?.safePathway ?? null,
      reliabilityProbability: selected.risk?.reliabilityProbability ?? null,
      trustScore: selected.risk?.trustScore ?? null,
    },
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: isEmpiricalSafePropV2Enabled(options)
      ? EMPIRICAL_SAFE_PROP_V2_BUILD
      : ARCHITECTURE_BUILD,
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
  // Prefer reliability, then TrustScore, then SafetyScore, then rawP
  const rel =
    packet.reliabilityProbability ?? packet.risk?.reliabilityProbability ?? 0;
  const trust = packet.trustScore ?? packet.risk?.trustScore ?? 0;
  const s = packet.safety?.finalSafetyScore ?? 0;
  const p =
    packet.probability?.rawWinProbability ?? packet.selectedSideProbability ?? 0;
  if (packet.reliabilityProbability != null || packet.risk?.reliabilityProbability != null) {
    return rel * 1e6 + trust * 1e3 + p * 100 + s;
  }
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

  // Persist every research packet (including HIGH) — never counts-only
  try {
    const slateDateCT =
      options.requestedSlateDate ||
      candidates[0]?.slateDate ||
      candidates[0]?.canonicalSlateDateCT ||
      null;
    if (slateDateCT && research.packets?.length) {
      persistResearchUniversePacketsV2({
        slateDateCT,
        packets: research.packets,
        researchUniverse: research.counts,
        meta: { source: "selectOfficialBoardFromProbabilitySafetyV1" },
      });
    }
  } catch {
    // persistence must never break Official selection
  }

  const v2On = isEmpiricalSafePropV2Enabled(options);
  let calibrationHash = null;
  if (v2On) {
    try {
      calibrationHash = computeCalibrationHashV2();
    } catch {
      calibrationHash = null;
    }
  }

  // Annotate full research universe with slate-relative ranks (not just Official)
  const rankedResearch = annotateSlateRelativeStrengthV1(
    (research.packets || []).map((p) => ({
      ...p,
      reliabilityProbability:
        p.reliabilityProbability ?? p.risk?.reliabilityProbability,
      trustScore: p.trustScore ?? p.risk?.trustScore,
      SafetyScore: p.safety?.finalSafetyScore,
      rawWinProbability:
        p.probability?.rawWinProbability ?? p.selectedSideProbability,
    }))
  );
  const rankByKey = new Map(
    rankedResearch.map((p) => [
      p.playerKey || p.marketKey || `${p.playerName}|${p.selectedSide}|${p.line}`,
      p.slateRelativeStrength,
    ])
  );

  const officialPackets = rankedResearch
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
    const slateRel =
      packet.slateRelativeStrength ||
      rankByKey.get(
        packet.playerKey ||
          packet.marketKey ||
          `${packet.playerName}|${packet.selectedSide}|${packet.line}`
      );
    return {
      ...src,
      ...decorateOfficialProp(packet, sidePacket, index, {
        v2On,
        slateRelativeStrength: slateRel,
        calibrationHash,
      }),
    };
  });

  const highCandidates = rankedResearch
    .filter((p) => p.risk?.risk === "HIGH" || p.membership?.officialEligible !== true)
    .sort((a, b) => safetyRankKey(b) - safetyRankKey(a))
    .slice(0, 10);

  return {
    version: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    membershipModel: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    productionFreeze: v2On ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE : null,
    calibrationHash,
    selectedProps,
    officialCount: selectedProps.length,
    lowCount: selectedProps.filter((p) => p.trueRisk === "LOW").length,
    mediumCount: selectedProps.filter((p) => p.trueRisk === "MEDIUM").length,
    highBlocked: research.HIGH,
    topHighCandidates: highCandidates,
    research: { ...research, packets: rankedResearch },
    boardSizePolicy: "UNBOUNDED_QUALITY_FIRST",
    forcedSide: false,
    noFixedSix: true,
    noMinimumCount: true,
    noSideQuota: true,
    v1ShadowEnabled: true,
  };
}

function decorateOfficialProp(packet, sidePacket, index, opts = {}) {
  const v2On = opts.v2On === true;
  const risk = packet.risk || {};
  const riskV1 = packet.riskV1Legacy || sidePacket?.riskV1Legacy || null;
  const slateRel = opts.slateRelativeStrength || packet.slateRelativeStrength || null;
  const v2Risk = risk.risk;
  const v1Risk = riskV1?.risk ?? null;
  return {
    side: packet.selectedSide,
    pick: packet.selectedSide,
    trueRisk: v2On ? v2Risk : v1Risk || v2Risk,
    riskLabel: v2On ? v2Risk : v1Risk || v2Risk,
    /** Production risk under Calibration 2 (champion). */
    v2Risk,
    /** Shadow V1 giant-AND classification — comparison only, not Official authority. */
    v1Risk,
    riskV1Legacy: riskV1,
    safetyScore: packet.safety?.finalSafetyScore,
    SafetyScore: packet.safety?.finalSafetyScore,
    rawWinProbability: packet.probability?.rawWinProbability,
    reliabilityProbability:
      risk.reliabilityProbability ?? packet.reliabilityProbability ?? null,
    reliabilityBand: risk.reliabilityBand ?? null,
    trustScore: risk.trustScore ?? null,
    trustComponents: risk.trustComponents ?? null,
    trustBonuses: risk.trustBonuses ?? null,
    trustPenalties: risk.trustPenalties ?? null,
    safePathway: risk.safePathway ?? null,
    pathwayMatched: risk.pathwayMatched ?? false,
    pathwayScore: risk.pathwayScore ?? 0,
    pathwayEvidence: risk.pathwayEvidence ?? [],
    pathwayWarnings: risk.pathwayWarnings ?? [],
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    conflictIndex: packet.uncertainty?.conflictIndex,
    minutesStabilityScore: packet.minutesModel?.minutesStabilityScore,
    roleStabilityScore: packet.roleModel?.roleStabilityScore,
    marketQualityScore: packet.market?.marketQualityScore,
    bookCount: packet.market?.bookCount,
    expectedMinutes: packet.minutesModel?.expectedMinutes,
    projection: sidePacket?.projection ?? packet.projection,
    projectionEdge: sidePacket?.projectionEdge,
    fairLineEdge: sidePacket?.fairLineEdge,
    fairLine: sidePacket?.fairLine ?? packet.fairLine,
    edge: sidePacket?.projectionEdge,
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
    membershipVersion: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    productionFreeze: v2On ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE : null,
    modelVersion: v2On
      ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE
      : MEMBERSHIP_VERSION,
    calibrationHash: opts.calibrationHash || null,
    pregameTimestamp: packet.predictionCreatedAt || new Date().toISOString(),
    safetyRank: index + 1,
    slateReliabilityRank: slateRel?.slateReliabilityRank ?? null,
    slateTrustRank: slateRel?.slateTrustRank ?? null,
    slatePercentile: slateRel?.slatePercentile ?? null,
    slateRelativeStrength: slateRel,
    officialEligible: true,
    forcedSide: false,
    noFixedSix: true,
    noMinimumBoard: true,
    noTeamQuota: true,
    whyNotLow: risk.whyNotLow || [],
    riskExplanation: risk.explanation || null,
    membershipQualificationStatus:
      (v2On ? v2Risk : v1Risk) === "LOW"
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
  // Prefer V2 empirical explanation when reliability/trust/pathway present
  if (
    prop.reliabilityProbability != null ||
    prop.trustScore != null ||
    (prop.safePathway && prop.safePathway !== "NONE") ||
    prop.riskExplanation?.whyCourtEdgeTrustsIt
  ) {
    if (prop.riskExplanation?.plainLanguage) return prop.riskExplanation;
    return buildEmpiricalRiskExplanationV2(prop, prop.risk || null);
  }

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
    // Role missing/unknown is not treated as "below threshold"
    if (prop.roleStabilityScore != null && prop.roleStabilityScore < 55) {
      whyNotLow.push(`Severe role instability ${prop.roleStabilityScore}`);
    }
    if ((prop.conflictIndex ?? 0) > 20) {
      whyNotLow.push(`Conflict index ${prop.conflictIndex}`);
    }
    if ((prop.majorFailurePathCount ?? 0) > 1) {
      whyNotLow.push(`${prop.majorFailurePathCount} meaningful failure paths`);
    }
    // Do not treat thin market quality as a LOW veto badge
  }

  return {
    risk,
    title: `${risk} RISK`,
    whyCourtEdgeLikesIt: whyLike,
    whyCourtEdgeTrustsIt: whyLike,
    whyItIsNotLow: whyNotLow,
    mainWayItLoses: mainLose,
    plainLanguage:
      risk === "LOW"
        ? `LOW RISK\n\nWhy CourtEdge trusts it:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nMain way it loses:\n• ${mainLose}`
        : risk === "MEDIUM"
          ? `MEDIUM RISK\n\nWhy it qualifies:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nWhy it isn't LOW:\n${whyNotLow.map((x) => `• ${x}`).join("\n")}`
          : `HIGH RISK — research only`,
  };
}
