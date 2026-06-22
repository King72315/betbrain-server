import { getPickScore } from "./pickRanker.js";
import { probeWnbaDefenseDataSources } from "./defenseScoreEngine.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "";
}

export const WNBA_UNDER_GAP_FLOOR = 3.0;
export const WNBA_OVER_GAP_FLOOR = 4.0;

export function isWnbaShadowRecalibrationEnabled() {
  return (
    process.env.WNBA_SHADOW_RECALIBRATION === "true" ||
    process.env.COURTEDGE_WNBA_SHADOW === "true"
  );
}

export function isWnbaLimitedData(pick = {}) {
  const dataMode = String(
    pick.dataMode || pick.playerState?.dataMode || ""
  ).toUpperCase();
  if (dataMode.includes("WNBA_LIMITED")) return true;
  return (
    String(pick.league || "").toUpperCase() === "WNBA" &&
    Boolean(pick.volumeProfile?.wnbaLimitedData)
  );
}

/**
 * Correct line-movement danger: line down = danger for Over, line up = danger for Under.
 * (Official marketIntelligence uses inverted semantics — shadow layer corrects this.)
 */
export function computeLineMovementAgainstSide(pickSide = "", lineDelta = 0) {
  const side = normalizeSide(pickSide);
  const delta = num(lineDelta);
  if (!side || delta === 0) return false;
  if (side === "OVER") return delta < -0.5;
  if (side === "UNDER") return delta > 0.5;
  return false;
}

export function getProjectionGap(pick = {}, side = "") {
  const pickSide = normalizeSide(side || pick.side || pick.pick || pick.currentEngineSide);
  const line = num(pick.line ?? pick.sportsbookLine ?? pick.officialLine);
  const projection = num(
    pick.projection ??
      pick.sportsProjection ??
      pick.playerState?.sportsProjection ??
      pick.fairLine
  );
  if (line <= 0 || projection <= 0) return null;
  if (pickSide === "OVER") return Number((projection - line).toFixed(2));
  if (pickSide === "UNDER") return Number((line - projection).toFixed(2));
  return null;
}

export function evaluateWnbaGapFloor(pick = {}, side = "") {
  if (!isWnbaLimitedData(pick)) {
    return { passes: true, gap: getProjectionGap(pick, side), reason: null };
  }

  const pickSide = normalizeSide(side || pick.side || pick.pick || pick.currentEngineSide);
  const gap = getProjectionGap(pick, pickSide);

  if (gap === null) {
    return {
      passes: false,
      gap: null,
      reason: "wnba_gap_unknown",
      shadowTierCap: "LEAN/TESTING",
      label: "Gap unknown — WNBA limited data",
    };
  }

  if (pickSide === "UNDER" && gap < WNBA_UNDER_GAP_FLOOR) {
    return {
      passes: false,
      gap,
      reason: "under_gap_too_small",
      shadowTierCap: "WATCHLIST",
      label: `Under gap ${gap} below ${WNBA_UNDER_GAP_FLOOR} floor`,
    };
  }

  if (pickSide === "OVER" && gap < WNBA_OVER_GAP_FLOOR) {
    return {
      passes: false,
      gap,
      reason: "over_gap_too_small",
      shadowTierCap: "WATCHLIST",
      label: `Over gap ${gap} below ${WNBA_OVER_GAP_FLOOR} floor`,
    };
  }

  return { passes: true, gap, reason: null };
}

function demoteTier(currentTier = "LEAN", cap = "WATCHLIST") {
  const order = ["PREMIUM", "WATCHLIST", "LEAN"];
  const capIdx = order.indexOf(cap === "LEAN/TESTING" ? "LEAN" : cap);
  const curIdx = order.indexOf(String(currentTier || "LEAN").toUpperCase());
  if (curIdx === -1 || capIdx === -1) return "LEAN";
  return order[Math.max(curIdx, capIdx)] || "LEAN";
}

function applyShadowPickScorePenalties(baseScore, penalties = []) {
  let score = num(baseScore);
  for (const penalty of penalties) {
    score -= num(penalty.amount);
  }
  return Number(score.toFixed(2));
}

export function buildShadowPickScorePenalties(pick = {}, shadowContext = {}) {
  const penalties = [];
  const gapEval = shadowContext.gapEval || evaluateWnbaGapFloor(pick);

  if (!gapEval.passes && gapEval.reason) {
    penalties.push({
      code: gapEval.reason,
      amount: gapEval.reason === "under_gap_too_small" ? 45 : 55,
      label: gapEval.label,
    });
  }

  if (shadowContext.lineMovementAgainstSide) {
    penalties.push({
      code: "line_movement_against_side",
      amount: 25,
      label: "Line moved against shadow side",
    });
  }

  if (isWnbaLimitedData(pick) && pick.fairLineSide && pick.fairLineSide !== "NONE") {
    penalties.push({
      code: "wnba_fair_line_demoted",
      amount: 15,
      label: "Fair line demoted for WNBA limited data",
    });
  }

  if (
    String(pick.league || "").toUpperCase() === "WNBA" &&
    pick.availabilityGate?.applicable === false &&
    (pick.dangerReasons || []).some((r) =>
      /injury|questionable|out|availability/i.test(String(r))
    )
  ) {
    penalties.push({
      code: "wnba_availability_unknown",
      amount: 10,
      label: "WNBA availability unverified",
    });
  }

  const defenseScore = num(
    shadowContext.wnbaDefenseScore ?? pick.defenseResult?.defenseScore
  );
  if (
    String(pick.league || "").toUpperCase() === "WNBA" &&
    defenseScore > 0 &&
    defenseScore <= 45
  ) {
    penalties.push({
      code: "wnba_weak_defense_context",
      amount: 12,
      label: "Weak WNBA defense context",
    });
  }

  return penalties;
}

export function applyWnbaFairLineShadowDemotion(pick = {}) {
  if (!isWnbaLimitedData(pick)) {
    return {
      fairLineSideOfficial: pick.fairLineSide || "NONE",
      fairLineSideShadow: pick.fairLineSide || "NONE",
      fairLineBoostSuppressed: false,
    };
  }

  const officialSide = pick.fairLineSide || "NONE";
  return {
    fairLineSideOfficial: officialSide,
    fairLineSideShadow: "NONE",
    fairLineBoostSuppressed: officialSide !== "NONE",
    fairLineShadowNote:
      "WNBA_LIMITED_DATA — fairLineSide does not boost tier/confidence in shadow",
  };
}

export function applyWnbaShadowRecalibration(pick = {}, options = {}) {
  if (!isWnbaLimitedData(pick) && String(pick.league || "").toUpperCase() !== "WNBA") {
    return null;
  }

  const pickSide = normalizeSide(
    pick.side || pick.pick || pick.currentEngineSide
  );
  const lineDelta = num(
    pick.lineDelta ?? pick.marketIntelligence?.lineDelta
  );
  const lineMovementAgainstSide = computeLineMovementAgainstSide(
    pickSide,
    lineDelta
  );
  const gapEval = evaluateWnbaGapFloor(pick, pickSide);
  const fairLineShadow = applyWnbaFairLineShadowDemotion(pick);

  let shadowTier = String(pick.tier || "LEAN").toUpperCase();
  const shadowTierReasons = [];

  if (!gapEval.passes && gapEval.shadowTierCap) {
    const capped = demoteTier(shadowTier, gapEval.shadowTierCap);
    if (capped !== shadowTier) {
      shadowTierReasons.push(
        `Shadow gap floor: ${gapEval.label} — tier capped at ${capped}`
      );
      shadowTier = capped;
    }
    if (gapEval.shadowTierCap === "WATCHLIST" && shadowTier === "PREMIUM") {
      shadowTier = "WATCHLIST";
      shadowTierReasons.push("WNBA gap floor blocks PREMIUM in shadow");
    }
  }

  if (fairLineShadow.fairLineBoostSuppressed) {
    shadowTier = demoteTier(shadowTier, "WATCHLIST");
    shadowTierReasons.push(fairLineShadow.fairLineShadowNote);
  }

  if (lineMovementAgainstSide) {
    shadowTierReasons.push(
      `Line movement against ${pickSide} (delta ${lineDelta >= 0 ? "+" : ""}${lineDelta})`
    );
  }

  const officialPickScore = num(pick.pickScore ?? getPickScore(pick));
  const penalties = buildShadowPickScorePenalties(pick, {
    gapEval,
    lineMovementAgainstSide,
    wnbaDefenseScore: options.wnbaDefenseScore,
  });
  const shadowPickScore = applyShadowPickScorePenalties(
    officialPickScore,
    penalties
  );

  let shadowConfidence = num(pick.confidence ?? pick.finalConfidence);
  if (!gapEval.passes) shadowConfidence = Math.min(shadowConfidence, 59);
  if (fairLineShadow.fairLineBoostSuppressed) {
    shadowConfidence = Math.min(shadowConfidence, shadowConfidence - 5);
  }
  if (lineMovementAgainstSide) {
    shadowConfidence = Math.min(shadowConfidence, shadowConfidence - 8);
  }

  return {
    enabled: true,
    version: "wnba-shadow-recalibration-v1",
    gapEval,
    lineMovementAgainstSide,
    lineMovedAgainstSideOfficial: Boolean(
      pick.marketIntelligence?.lineMovedAgainstSide
    ),
    fairLineShadow,
    shadowTier,
    shadowTierReasons,
    shadowPickScore,
    shadowPickScorePenalties: penalties,
    officialPickScore,
    shadowConfidence: Math.max(0, Math.round(shadowConfidence)),
    officialTier: pick.tier,
    officialConfidence: pick.confidence,
    wnbaDefenseProbe: options.wnbaDefenseProbe || null,
    wnbaDefenseScore: options.wnbaDefenseScore ?? null,
    shadowLabBucket:
      shadowTier === "PREMIUM"
        ? "OFFICIAL"
        : shadowTier === "WATCHLIST"
          ? "WATCHLIST"
          : "LEAN/TESTING",
  };
}

export async function buildWnbaDefenseShadowContext({
  opponentTeam = "",
  league = "WNBA",
} = {}) {
  if (String(league).toUpperCase() !== "WNBA" || !opponentTeam) {
    return { wnbaDefenseProbe: null, wnbaDefenseScore: null };
  }

  const probe = await probeWnbaDefenseDataSources(opponentTeam);
  return {
    wnbaDefenseProbe: probe.logSummary,
    wnbaDefenseScore: probe.shadowDefenseScore,
  };
}

export function classifyWnbaShadowLoss(prop = {}) {
  const side = String(prop.currentEngineSide || prop.side || "").toLowerCase();
  const gapEval = evaluateWnbaGapFloor(prop, side);

  if (!gapEval.passes) {
    if (gapEval.reason === "under_gap_too_small") {
      return {
        missType: "under_gap_too_small",
        explanation: gapEval.label,
      };
    }
    if (gapEval.reason === "over_gap_too_small") {
      return {
        missType: "over_gap_too_small",
        explanation: gapEval.label,
      };
    }
  }

  const gate = prop.availabilityGate || {};
  if (
    String(prop.league || "").toUpperCase() === "WNBA" &&
    gate.applicable === false
  ) {
    const hasAvailabilitySignal = [
      ...(prop.dangerReasons || []),
      ...(prop.warningReasons || []),
      ...(prop.resistance || []),
    ].some((r) => /injury|questionable|out|inactive|gtd/i.test(String(r)));

    if (hasAvailabilitySignal) {
      return {
        missType: "wnba_availability_unknown",
        explanation:
          "WNBA has no availability gate — injury signals are unverified, not a confirmed availability miss.",
      };
    }
  }

  return null;
}
