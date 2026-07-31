/**
 * CourtEdge Best 6 Selection Integrity V1
 *
 * Pre-next-slate eligibility / arbitration guards from Jul 29–30 postmortems.
 * Hard exclusions run BEFORE repair labels and ranking bonuses.
 * Does not mutate sealed historical Official membership.
 */

export const BEST_SIX_SELECTION_INTEGRITY_VERSION = "best-six-selection-integrity-v1";
export const BEST_SIX_SELECTION_INTEGRITY_BUILD =
  "courteedge-pre-next-slate-selection-integrity-v1";

/** WNBA Points Under projection-edge floors (points). */
export const UNDER_EDGE_HARD_BLOCK = 1.5;
export const UNDER_EDGE_CORROBORATION_MAX = 3.49;
export const UNDER_EDGE_NORMAL_MIN = 3.5;

/** Best Prop score floors. */
export const BEST_PROP_SCORE_NORMAL_FLOOR = 60;
export const BEST_PROP_SCORE_FILL_FLOOR = 50;

/** Volatility CV threshold for "elevated/high" (Morrow ~0.91). */
export const VOLATILITY_CV_ELEVATED = 0.55;

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw || null;
}

function engineBundle(pick = {}) {
  return (
    pick.courtEdgeEngineSignalsV1?.engines ||
    pick.engineSignals?.engines ||
    pick.engines ||
    {}
  );
}

function engineOf(pick, ...keys) {
  const engines = engineBundle(pick);
  for (const key of keys) {
    if (engines[key]) return engines[key];
    const found = Object.values(engines).find(
      (e) =>
        e &&
        (e.key === key ||
          e.engine === key ||
          String(e.engine || "").toLowerCase().includes(String(key).toLowerCase()))
    );
    if (found) return found;
  }
  return null;
}

function engineDirection(eng) {
  if (!eng) return null;
  return normalizeSide(eng.direction || eng.modelSide || eng.lean || null);
}

export function resolveFinalSide(pick = {}) {
  return normalizeSide(
    pick.finalCourtEdgeSide ||
      pick.side ||
      pick.pick ||
      pick.decisionIntelligence?.finalSide ||
      pick.wnbaReader?.finalSide
  );
}

export function resolveOriginalModelSide(pick = {}) {
  return normalizeSide(
    pick.originalModelSide ||
      pick.sameTeamArbitration?.originalModelSide ||
      pick.sameTeamOpportunityV2?.originalModelSide ||
      pick.organicModelSide ||
      pick.initialSide ||
      pick.wnbaReader?.organicSide
  );
}

/**
 * Projection edge for the FINAL side (positive = supports final side).
 * OVER: projection - line; UNDER: line - projection.
 */
export function resolveProjectionEdgeForFinalSide(pick = {}) {
  const side = resolveFinalSide(pick);
  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const projection = num(
    pick.projection ??
      pick.projectedPoints ??
      pick.modelProjection ??
      pick.wnbaReader?.projection ??
      pick.freeze?.projection
  );
  if (side == null || line == null || projection == null) return null;
  if (side === "OVER") return Number((projection - line).toFixed(3));
  if (side === "UNDER") return Number((line - projection).toFixed(3));
  return null;
}

export function resolveBestPropScore(pick = {}) {
  return num(
    pick.bestPropScore ??
      pick.pickScore ??
      pick.wnbaTopPropScore ??
      pick.score ??
      pick.safetyScore,
    0
  );
}

export function resolveFairLine(pick = {}) {
  return num(
    pick.fairLine ??
      pick.fairValueLine ??
      pick.wnbaReader?.fairLine ??
      pick.marketIntelligence?.fairLine
  );
}

export function resolveRoleStability(pick = {}) {
  const raw =
    pick.roleStability ||
    pick.playerRoleProfile?.stability ||
    pick.wnbaDataCard?.roleStability ||
    pick.roleProfile?.stability ||
    pick.courtEdgeEngineSignalsV1?.engines?.roleVelocity?.rawValues?.stability ||
    null;
  const s = String(raw || "").toUpperCase();
  if (s.includes("UNSTABLE") || s === "UNSTABLE") return "UNSTABLE";
  if (s.includes("STABLE")) return "STABLE";
  // Infer from roleVelocity risk elevation + reasons.
  const rv = engineOf(pick, "roleVelocity", "roleVelocityEngine");
  const reason = String(rv?.reason || "").toLowerCase();
  if (reason.includes("unstable")) return "UNSTABLE";
  if (pick.wnbaTrackingReason && /UNSTABLE|ROLE_DEBT/i.test(String(pick.wnbaTrackingReason))) {
    return "UNSTABLE";
  }
  if (String(pick.displayWhy || pick.decisionIntelligence?.simpleExplanation || "")
    .toUpperCase()
    .includes("UNSTABLE")) {
    return "UNSTABLE";
  }
  return s || "UNKNOWN";
}

export function resolveVolatility(pick = {}) {
  const vol = engineOf(pick, "volatilityProfile", "volatility", "volatilityEngine");
  const cv = num(
    vol?.coefficientOfVariation ??
      vol?.rawValues?.coefficientOfVariation ??
      pick.volatilityCv ??
      pick.coefficientOfVariation
  );
  const tier = String(
    vol?.volatilityTier ||
      vol?.rawValues?.volatilityTier ||
      pick.volatilityTier ||
      ""
  ).toUpperCase();
  let classification = tier || "UNKNOWN";
  if (!tier && cv != null) {
    if (cv >= 0.7) classification = "HIGH";
    else if (cv >= VOLATILITY_CV_ELEVATED) classification = "ELEVATED";
    else if (cv >= 0.35) classification = "MODERATE";
    else classification = "LOW";
  }
  if (classification === "MODERATE" && cv != null && cv >= VOLATILITY_CV_ELEVATED) {
    classification = "ELEVATED";
  }
  return { cv, classification, elevated: ["HIGH", "ELEVATED", "MODERATE"].includes(classification) && (cv == null || cv >= VOLATILITY_CV_ELEVATED) || classification === "HIGH" };
}

export function resolveRoleVelocityDirection(pick = {}) {
  return engineDirection(engineOf(pick, "roleVelocity", "roleVelocityEngine"));
}

export function resolveDefensiveArchetypeDirection(pick = {}) {
  return engineDirection(
    engineOf(pick, "defensiveArchetype", "defensiveArchetypeEngine")
  );
}

export function resolveMatchupShadowDirection(pick = {}) {
  const shadow =
    pick.matchupEngineV2Shadow ||
    pick.matchupShadow ||
    pick.opponentMatchup?.shadow ||
    null;
  const live = pick.matchupEngineV2Live || null;
  const dir = normalizeSide(
    shadow?.modelSide ||
      live?.modelSide ||
      pick.matchupShadowDirection ||
      pick.opponentMatchup?.lean ||
      null
  );
  const sample = num(
    shadow?.sampleProtection?.comparableMatchups ??
      shadow?.comparableMatchups ??
      pick.matchupHistorySample
  );
  return {
    direction: dir,
    sample,
    earlySampleOnly: sample != null && sample > 0 && sample <= 2,
    pass: dir == null || String(shadow?.modelSide || "").toUpperCase() === "PASS",
  };
}

export function resolveProjectionSanity(pick = {}) {
  const eng = engineOf(pick, "projectionSanity", "projectionSanityEngine");
  const hurt = eng?.hurt === true;
  const helped = eng?.helped === true;
  const reason = String(eng?.reason || "");
  const questionsUsage =
    hurt ||
    /usage|minutes|not supported/i.test(reason) ||
    (eng?.confidenceAdjustment != null && Number(eng.confidenceAdjustment) <= -3);
  return {
    hurt,
    helped,
    questionsUsage,
    reason: reason || null,
    direction: engineDirection(eng),
  };
}

export function resolveDistributionDirection(pick = {}) {
  return engineDirection(
    engineOf(pick, "distributionProfile", "distribution", "distributionEngine")
  );
}

export function resolveNaturalGate(pick = {}) {
  return String(
    pick.naturalGateReason ||
      pick.wnbaTrackingReason ||
      pick.decisionIntelligence?.gateReason ||
      pick.decisionIntelligence?.naturalGateReason ||
      pick.naturalDecision ||
      ""
  ).toUpperCase();
}

export function resolveNaturalDecision(pick = {}) {
  return String(
    pick.naturalDecision ||
      pick.decisionIntelligence?.originalGateEligibility ||
      pick.decisionIntelligence?.naturalDecision ||
      pick.wnbaTrackingDecision ||
      pick.trackingEligibility ||
      ""
  ).toUpperCase();
}

export function resolveSideRescueAction(pick = {}) {
  return String(
    pick.sideRescue?.action ||
      pick.sideRescueAction ||
      pick.decisionIntelligence?.sideRescueAction ||
      ""
  ).toUpperCase();
}

export function isSameTeamForced(pick = {}) {
  return (
    pick.sameTeamArbitrationFlip === true ||
    pick.sameTeamForcedUnder === true ||
    pick.sameTeamOpportunityV2?.role === "SECONDARY_UNDER" ||
    pick.sameTeamOpportunityV2?.policyFlip === true ||
    String(pick.sameTeamArbitrationReason || "").includes("SAME_TEAM")
  );
}

function organicEvidenceStrength(pick = {}) {
  if (pick.organicUnderEvidence === "weak" || pick.organicEvidenceStrength === "weak") {
    return "weak";
  }
  if (pick.sameTeamArbitration?.organicUnderEvidence === "weak") return "weak";
  const why = String(pick.displayWhy || pick.decisionIntelligence?.simpleExplanation || "");
  if (/organic under evidence:\s*weak/i.test(why)) return "weak";
  if (pick.organicEvidenceStrength) return String(pick.organicEvidenceStrength).toLowerCase();
  return "unknown";
}

/**
 * Meaningful independent directional confirmations for thin Unders.
 * Integrity-only signals (active player, neutral market, multi-book) do NOT count.
 */
export function collectUnderDirectionalConfirmations(pick = {}) {
  const confirmations = [];
  const finalSide = resolveFinalSide(pick);
  if (finalSide !== "UNDER") return confirmations;

  const rv = resolveRoleVelocityDirection(pick);
  if (rv === "UNDER") confirmations.push("roleVelocity_UNDER");

  const def = resolveDefensiveArchetypeDirection(pick);
  if (def === "UNDER") confirmations.push("defensiveArchetype_UNDER");

  const dist = resolveDistributionDirection(pick);
  if (dist === "UNDER") confirmations.push("distributionProfile_UNDER");

  const shadow = resolveMatchupShadowDirection(pick);
  if (shadow.direction === "UNDER" && !shadow.earlySampleOnly) {
    confirmations.push("matchupShadow_UNDER");
  }

  const role = resolveRoleStability(pick);
  const vol = resolveVolatility(pick);
  if (role === "STABLE" && (vol.classification === "LOW" || vol.cv == null || vol.cv < 0.35)) {
    // Stable low-volume role — only if minutes/volume cues support under.
    const reasons = String(
      pick.displayWhy ||
        (pick.whySelected?.reasons || []).join(" ") ||
        pick.wnbaReader?.supports?.join(" ") ||
        ""
    ).toLowerCase();
    if (
      /low fga|limited minutes|low volume|contracting role|blowout risk/.test(reasons)
    ) {
      confirmations.push("stable_low_volume_role_UNDER");
    }
  }

  const shotTrend = String(
    pick.shotVolumeTrend || pick.recentShotVolumeTrend || ""
  ).toUpperCase();
  if (shotTrend === "DOWN" || shotTrend === "DECLINING") {
    confirmations.push("shot_volume_trend_UNDER");
  } else {
    const why = String(pick.displayWhy || "").toLowerCase();
    if (/shot volume.*(down|declin|low)|low fga supports under/.test(why)) {
      confirmations.push("shot_volume_trend_UNDER");
    }
  }

  return [...new Set(confirmations)];
}

function hasRepairLaunderingAttempt(pick = {}) {
  const repairs = [
    ...(pick.decisionIntelligence?.riskRepairs || []),
    ...(pick.riskRepairs || []),
  ].map((r) => String(r.code || r || "").toUpperCase());
  const flags = (pick.bestSixQualityFlags || []).map((f) => String(f).toUpperCase());
  const all = [...repairs, ...flags];
  return all.some((c) =>
    [
      "ELITE_NET_EDGE",
      "ELITE_PROJECTION_GAP",
      "MULTI_BOOK_COVERAGE",
      "BOARD_PROMOTION",
      "COVERAGE_COMPLETE",
    ].includes(c)
  );
}

/**
 * Core Best 6 eligibility evaluation — hard exclusions before ranking.
 */
export function evaluateBestSixSelectionIntegrity(pick = {}, options = {}) {
  const allowFill = options.allowFillCandidates === true;
  const finalSide = resolveFinalSide(pick);
  const originalSide = resolveOriginalModelSide(pick);
  const line = num(pick.line ?? pick.selectedLine);
  const projection = num(pick.projection ?? pick.projectedPoints ?? pick.modelProjection);
  const fairLine = resolveFairLine(pick);
  const edge = resolveProjectionEdgeForFinalSide(pick);
  const score = resolveBestPropScore(pick);
  const roleStability = resolveRoleStability(pick);
  const volatility = resolveVolatility(pick);
  const roleVelocityDir = resolveRoleVelocityDirection(pick);
  const defensiveDir = resolveDefensiveArchetypeDirection(pick);
  const shadow = resolveMatchupShadowDirection(pick);
  const projSanity = resolveProjectionSanity(pick);
  const naturalGate = resolveNaturalGate(pick);
  const naturalDecision = resolveNaturalDecision(pick);
  const rescue = resolveSideRescueAction(pick);
  const forced = isSameTeamForced(pick);
  const organicStrength = organicEvidenceStrength(pick);
  const underConfirmations = collectUnderDirectionalConfirmations(pick);
  const secondaryWarnings = [];
  const hardExclusions = [];

  const roleOpposes =
    roleVelocityDir && finalSide && roleVelocityDir !== finalSide;
  const volElevated =
    volatility.classification === "HIGH" ||
    volatility.classification === "ELEVATED" ||
    (volatility.cv != null && volatility.cv >= VOLATILITY_CV_ELEVATED);

  // --- Hard exclusions ---

  if (rescue === "NO_DECISIVE_RESCUE") {
    hardExclusions.push("NO_DECISIVE_RESCUE");
  }

  // Best Prop score floors (before repair-label influence).
  if (score < BEST_PROP_SCORE_FILL_FLOOR) {
    hardExclusions.push("BEST_PROP_SCORE_BELOW_50");
  } else if (score < BEST_PROP_SCORE_NORMAL_FLOOR) {
    const fillBlockers = [];
    if (edge != null && edge < 0) fillBlockers.push("NEGATIVE_EDGE");
    if (forced) fillBlockers.push("SAME_TEAM_FORCED");
    if (rescue === "NO_DECISIVE_RESCUE") fillBlockers.push("NO_DECISIVE_RESCUE");
    if (naturalGate.includes("UNDER_GAP_BELOW")) fillBlockers.push("UNDER_GAP_FLOOR");
    if (naturalGate.includes("DANGER_STACK")) fillBlockers.push("DANGER_STACK");
    if (shadow.direction && finalSide && shadow.direction !== finalSide) {
      fillBlockers.push("SHADOW_OPPOSES");
    }
    if (roleOpposes) fillBlockers.push("ROLE_VELOCITY_OPPOSES");
    if (roleStability === "UNSTABLE" && volElevated) {
      fillBlockers.push("UNSTABLE_HIGH_VOL");
    }
    if (organicStrength === "weak") fillBlockers.push("ORGANIC_WEAK");
    if (!allowFill || fillBlockers.length) {
      hardExclusions.push(
        fillBlockers.length
          ? `BEST_PROP_SCORE_50_59_BLOCKED:${fillBlockers.join("+")}`
          : "BEST_PROP_SCORE_BELOW_60"
      );
    } else {
      secondaryWarnings.push("SCORE_FILL_BAND_ALLOWED");
    }
  }

  if (finalSide === "UNDER" && edge != null) {
    if (edge < UNDER_EDGE_HARD_BLOCK) {
      hardExclusions.push("SUB_FLOOR_UNDER_EDGE");
    } else if (edge <= UNDER_EDGE_CORROBORATION_MAX) {
      if (underConfirmations.length < 2) {
        hardExclusions.push("THIN_UNDER_LACKS_CORROBORATION");
      } else {
        secondaryWarnings.push("THIN_UNDER_CORROBORATED");
      }
      if (shadow.pass || shadow.direction === "OVER") {
        hardExclusions.push(
          shadow.direction === "OVER" ? "THIN_UNDER_SHADOW_OVER" : "THIN_UNDER_SHADOW_PASS"
        );
      }
    }
  }

  if (
    naturalGate.includes("UNDER_GAP_BELOW_WNBA_FULL_DATA_FLOOR") ||
    naturalGate.includes("UNDER_GAP_BELOW_WNBA_LIMITED")
  ) {
    if (finalSide === "UNDER" && (edge == null || edge < UNDER_EDGE_NORMAL_MIN)) {
      if (underConfirmations.length < 2) {
        hardExclusions.push("UNDER_GAP_BELOW_FLOOR");
      } else {
        secondaryWarnings.push("UNDER_GAP_FLOOR_WITH_CORROBORATION");
      }
    }
  }

  // Morrow-type: BOARD_ONLY + unstable + elevated vol + roleVelocity opposes + projSanity
  const morrowConditions = [
    roleStability === "UNSTABLE",
    volElevated,
    roleOpposes,
    projSanity.questionsUsage,
  ];
  const morrowCount = morrowConditions.filter(Boolean).length;
  if (
    naturalDecision === "BOARD_ONLY" &&
    morrowConditions.every(Boolean)
  ) {
    hardExclusions.push("BOARD_ONLY_UNSTABLE_VOL_ROLE_SANITY");
  } else if (morrowCount >= 3 && (edge == null || edge < UNDER_EDGE_NORMAL_MIN)) {
    hardExclusions.push("UNSTABLE_VOL_ROLE_STACK");
  }

  if (naturalGate.includes("DANGER_STACK_INSUFFICIENT_EDGE") && naturalDecision === "BOARD_ONLY") {
    if (morrowCount >= 2 || volElevated || roleStability === "UNSTABLE") {
      hardExclusions.push("DANGER_STACK_BOARD_ONLY_BLOCK");
    } else {
      secondaryWarnings.push("DANGER_STACK_INSUFFICIENT_EDGE");
    }
  }

  // Matchup shadow vetoes
  if (forced && finalSide === "UNDER" && shadow.direction === "OVER") {
    hardExclusions.push("FORCED_UNDER_SHADOW_OVER");
  }
  if (edge != null && edge < 0 && shadow.direction && shadow.direction !== finalSide) {
    hardExclusions.push("NEGATIVE_EDGE_SHADOW_OPPOSES");
  }

  // Forced Under without organic support (evaluated at arbitration site too)
  if (forced && finalSide === "UNDER") {
    const unsupported = isUnsupportedForcedUnder(pick);
    if (unsupported.unsupported) {
      hardExclusions.push("UNSUPPORTED_FORCED_UNDER");
      secondaryWarnings.push(...unsupported.reasons);
    }
  }

  // Repair labels never cancel hard exclusions — just note them
  if (hardExclusions.length && hasRepairLaunderingAttempt(pick)) {
    secondaryWarnings.push("REPAIR_LABELS_IGNORED");
  }

  const uniqueHard = [...new Set(hardExclusions)];
  const eligible = uniqueHard.length === 0;
  const primaryReason = eligible
    ? "ELIGIBLE"
    : `REJECTED_BEST_6 — ${uniqueHard.join(" + ")}`;

  const debug = {
    version: BEST_SIX_SELECTION_INTEGRITY_VERSION,
    build: BEST_SIX_SELECTION_INTEGRITY_BUILD,
    originalModelSide: originalSide,
    finalSide,
    line,
    projection,
    fairLine,
    projectionEdgeForFinalSide: edge,
    bestPropScore: score,
    organicEvidenceStrength: organicStrength,
    roleStability,
    volatilityCv: volatility.cv,
    volatilityClassification: volatility.classification,
    roleVelocityDirection: roleVelocityDir,
    defensiveArchetypeDirection: defensiveDir,
    matchupShadowDirection: shadow.direction,
    matchupShadowSample: shadow.sample,
    projectionSanity: projSanity,
    naturalGate,
    naturalDecision,
    sideRescueAction: rescue,
    arbitrationStatus: forced ? "SAME_TEAM_FORCED" : "NONE",
    underDirectionalConfirmations: underConfirmations,
    hardExclusionReasons: uniqueHard,
    secondaryWarnings: [...new Set(secondaryWarnings)],
    finalEligibility: eligible,
    selectionRejectionReason: primaryReason,
  };

  return {
    eligible,
    primaryReason,
    hardExclusions: uniqueHard,
    secondaryWarnings: debug.secondaryWarnings,
    debug,
    pick: {
      ...pick,
      bestSixSelectionIntegrity: debug,
      bestSixIntegrityEligible: eligible,
      bestSixIntegrityReason: primaryReason,
    },
  };
}

/**
 * Forced Under is unsupported when organic Over case still dominates.
 */
export function isUnsupportedForcedUnder(pick = {}) {
  const reasons = [];
  const original = resolveOriginalModelSide(pick) || "OVER";
  const finalSide = resolveFinalSide(pick);
  if (finalSide !== "UNDER") return { unsupported: false, reasons };

  if (original === "OVER") reasons.push("ORIGINAL_MODEL_OVER");

  const line = num(pick.line ?? pick.selectedLine);
  const projection = num(pick.projection ?? pick.projectedPoints);
  const fair = resolveFairLine(pick);
  if (line != null && projection != null && projection > line) {
    reasons.push("PROJECTION_ABOVE_UNDER_LINE");
  }
  if (line != null && fair != null && fair > line) {
    reasons.push("FAIR_LINE_ABOVE_UNDER_LINE");
  }

  const l5 = num(pick.last5Avg ?? pick.l5Avg ?? pick.wnbaReader?.last5Avg);
  if (line != null && l5 != null && l5 > line) {
    reasons.push("RECENT_FORM_ABOVE_UNDER_LINE");
  }

  const rv = resolveRoleVelocityDirection(pick);
  if (rv === "OVER") reasons.push("ROLE_VELOCITY_OVER");

  const shadow = resolveMatchupShadowDirection(pick);
  if (shadow.direction === "OVER") reasons.push("SHADOW_OVER");

  if (organicEvidenceStrength(pick) === "weak") {
    reasons.push("ORGANIC_UNDER_WEAK");
  }

  if (resolveBestPropScore(pick) < BEST_PROP_SCORE_NORMAL_FLOOR) {
    reasons.push("BEST_PROP_BELOW_FLOOR");
  }

  // Require clear organic Under support to keep forced side
  const confirmations = collectUnderDirectionalConfirmations(pick);
  const independentlyQualified =
    pick.sameTeamOpportunityV2?.independentlyQualifiedUnder === true ||
    pick.independentlyQualifiedUnder === true;

  if (!independentlyQualified && confirmations.length < 2) {
    reasons.push("NO_INDEPENDENT_UNDER_EVIDENCE");
  }

  // Unsupported if original Over + any strong contradiction without independent Under case
  const unsupported =
    reasons.includes("NO_INDEPENDENT_UNDER_EVIDENCE") ||
    (reasons.includes("ORIGINAL_MODEL_OVER") &&
      (reasons.includes("PROJECTION_ABOVE_UNDER_LINE") ||
        reasons.includes("FAIR_LINE_ABOVE_UNDER_LINE") ||
        reasons.includes("SHADOW_OVER") ||
        reasons.includes("ORGANIC_UNDER_WEAK") ||
        reasons.includes("BEST_PROP_BELOW_FLOOR")) &&
      confirmations.length < 2);

  return { unsupported, reasons, confirmations };
}

/**
 * Material conflicts that block Low Risk / trim confidence.
 */
export function collectMaterialConflicts(pick = {}) {
  const conflicts = [];
  const finalSide = resolveFinalSide(pick);
  const def = resolveDefensiveArchetypeDirection(pick);
  if (def && finalSide && def !== finalSide) conflicts.push("DEFENSIVE_ARCHETYPE_OPPOSES");

  const sanity = resolveProjectionSanity(pick);
  if (sanity.questionsUsage) conflicts.push("PROJECTION_SANITY_QUESTIONS");

  const rv = resolveRoleVelocityDirection(pick);
  if (rv && finalSide && rv !== finalSide) conflicts.push("ROLE_VELOCITY_OPPOSES");
  if (resolveRoleStability(pick) === "UNSTABLE") conflicts.push("ROLE_UNSTABLE");

  const shadow = resolveMatchupShadowDirection(pick);
  if (shadow.direction && finalSide && shadow.direction !== finalSide) {
    conflicts.push("MATCHUP_SHADOW_OPPOSES");
  }
  if (shadow.sample === 0 || shadow.sample == null) {
    // no opponent history — conflict only for otherwise high-confidence
    if (num(pick.confidence, 0) >= 70) conflicts.push("NO_MATCHUP_HISTORY_HIGH_CONF");
  }

  const vol = resolveVolatility(pick);
  if (vol.classification === "HIGH" || vol.classification === "ELEVATED") {
    conflicts.push("ELEVATED_VOLATILITY");
  }

  if (isSameTeamForced(pick)) conflicts.push("SAME_TEAM_ARBITRATION");
  if (organicEvidenceStrength(pick) === "weak") conflicts.push("ORGANIC_MIXED_OR_WEAK");

  return conflicts;
}

/**
 * Apply confidence haircut + risk floor from material conflicts.
 * Does not change side.
 */
export function applyConflictConfidenceRiskRecalibration(pick = {}) {
  const conflicts = collectMaterialConflicts(pick);
  if (!conflicts.length) {
    return {
      ...pick,
      materialConflicts: [],
      conflictRecalibrationApplied: false,
    };
  }

  const confHaircut = Math.min(18, 4 + conflicts.length * 3);
  const baseConf = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 50);
  const nextConf = Math.max(35, Math.round(baseConf - confHaircut));

  let trueRisk = String(
    pick.decisionIntelligence?.trueRisk || pick.trueRisk || "MEDIUM"
  ).toUpperCase();
  // Never Low Risk with material conflicts
  if (trueRisk === "LOW") trueRisk = "MEDIUM";
  if (
    conflicts.includes("SAME_TEAM_ARBITRATION") ||
    conflicts.includes("ROLE_UNSTABLE") ||
    conflicts.includes("ELEVATED_VOLATILITY") ||
    (conflicts.includes("DEFENSIVE_ARCHETYPE_OPPOSES") &&
      conflicts.includes("PROJECTION_SANITY_QUESTIONS"))
  ) {
    if (trueRisk !== "HIGH") trueRisk = "MEDIUM";
  }
  if (isSameTeamForced(pick) && !collectUnderDirectionalConfirmations(pick).length) {
    trueRisk = "HIGH";
  } else if (isSameTeamForced(pick)) {
    trueRisk = trueRisk === "LOW" ? "HIGH" : trueRisk === "MEDIUM" ? "HIGH" : trueRisk;
    // Forced side: automatic HIGH unless strong organic evidence (≥2 confirmations)
    const confs = collectUnderDirectionalConfirmations(pick);
    trueRisk = confs.length >= 2 ? "HIGH" : "HIGH"; // always HIGH when forced per requirements
  }

  const di = pick.decisionIntelligence || {};
  return {
    ...pick,
    confidence: nextConf,
    trueRisk,
    riskLabel:
      trueRisk === "LOW" ? "Low Risk" : trueRisk === "HIGH" ? "High Risk" : "Medium Risk",
    materialConflicts: conflicts,
    conflictRecalibrationApplied: true,
    conflictConfidenceHaircut: confHaircut,
    policyConflictMarker: isSameTeamForced(pick) ? "SAME_TEAM_POLICY_CONFLICT" : null,
    topPickBlockedByIntegrity:
      isSameTeamForced(pick) && collectUnderDirectionalConfirmations(pick).length < 2,
    decisionIntelligence: {
      ...di,
      trueRisk,
      finalConfidence: nextConf,
      materialConflicts: conflicts,
      riskAfterDecision:
        trueRisk === "LOW" ? "Low Risk" : trueRisk === "HIGH" ? "High Risk" : "Medium Risk",
      topPickEligibility:
        isSameTeamForced(pick) && collectUnderDirectionalConfirmations(pick).length < 2
          ? false
          : di.topPickEligibility,
    },
  };
}

/**
 * Filter + annotate a candidate list for Best 6 selection.
 * Rejected props stay out of Best 6; may remain on broader board.
 */
export function filterCandidatesForBestSixIntegrity(candidates = [], options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const accepted = [];
  const rejected = [];
  const debugRows = [];

  for (const pick of list) {
    if (String(pick.league || "").toUpperCase() !== "WNBA") {
      accepted.push(pick);
      continue;
    }
    const result = evaluateBestSixSelectionIntegrity(pick, options);
    debugRows.push(result.debug);
    if (result.eligible) {
      accepted.push(
        applyConflictConfidenceRiskRecalibration({
          ...result.pick,
          bestSixIntegrityEligible: true,
        })
      );
    } else {
      rejected.push({
        player: pick.player,
        side: resolveFinalSide(pick),
        line: pick.line,
        reason: result.primaryReason,
        hardExclusions: result.hardExclusions,
        secondaryWarnings: result.secondaryWarnings,
        debug: result.debug,
        pick: {
          ...result.pick,
          bestSixIntegrityEligible: false,
          excludedFromOfficialBestSix: true,
          bestSixExclusionReason: result.primaryReason,
        },
      });
    }
  }

  return {
    version: BEST_SIX_SELECTION_INTEGRITY_VERSION,
    build: BEST_SIX_SELECTION_INTEGRITY_BUILD,
    accepted,
    rejected,
    debugRows,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
  };
}

/**
 * Simulate historical slate props through new rules (no mutation).
 */
export function simulateBestSixIntegrityOnProps(props = [], options = {}) {
  const filter = filterCandidatesForBestSixIntegrity(props, {
    ...options,
    allowFill: false,
  });
  return {
    ...filter,
    wouldSelectCount: Math.min(6, filter.accepted.length),
    wouldReject: filter.rejected.map((r) => ({
      player: r.player,
      pick: `${r.side} ${r.line}`,
      reason: r.reason,
    })),
  };
}
