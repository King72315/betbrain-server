import { CONFIG } from "../config.js";
import {
  evaluateWnbaGapFloor,
  getProjectionGap,
  isWnbaLimitedData,
  WNBA_OVER_GAP_FLOOR,
  WNBA_UNDER_GAP_FLOOR,
} from "./wnbaShadowEngine.js";
import { computeLineMovementAgainstSide } from "./marketIntelligenceEngine.js";

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

function demoteTier(currentTier = "LEAN", cap = "WATCHLIST") {
  const order = ["PREMIUM", "WATCHLIST", "LEAN"];
  const capIdx = order.indexOf(cap);
  const curIdx = order.indexOf(String(currentTier || "LEAN").toUpperCase());
  if (curIdx === -1 || capIdx === -1) return "LEAN";
  return order[Math.max(curIdx, capIdx)] || "LEAN";
}

export function isCourteEdgeWnbaV1Enabled() {
  return (
    CONFIG.COURTEDGE_WNBA_V1 === true ||
    process.env.COURTEDGE_WNBA_V1 === "true"
  );
}

export function evaluateWnbaOfficialGapFloor(pick = {}, side = "") {
  if (String(pick.league || "").toUpperCase() !== "WNBA") {
    return { passes: true, gap: getProjectionGap(pick, side), reason: null };
  }
  return evaluateWnbaGapFloor(pick, side);
}

export function applyWnbaFairLineOfficialDemotion(pick = {}) {
  if (!isWnbaLimitedData(pick)) {
    return {
      fairLineSideOfficial: pick.fairLineSide || "NONE",
      fairLineBoostSuppressed: false,
      fairLineOfficialNote: null,
    };
  }

  const officialSide = pick.fairLineSide || "NONE";
  return {
    fairLineSideOfficial: officialSide,
    fairLineSideEffective: "NONE",
    fairLineBoostSuppressed: officialSide !== "NONE",
    fairLineOfficialNote:
      "WNBA_LIMITED_DATA — fairLineSide does not boost tier/confidence for official eligibility",
  };
}

export function evaluateWnbaLowRiskOfficialGates(pick = {}) {
  const reasons = [];
  let blocksOfficial = false;

  const risk = String(pick.riskLabel || "").toLowerCase();
  if (risk.includes("high")) {
    blocksOfficial = true;
    reasons.push("High Risk label blocks official WNBA play");
  }

  if (risk.includes("low") && num(pick.bookCount) <= 1) {
    blocksOfficial = true;
    reasons.push("Low Risk with ≤1 book is not official-eligible");
  }

  const marketQuality = num(pick.marketQuality);
  if (marketQuality > 0 && marketQuality < 40) {
    blocksOfficial = true;
    reasons.push(`Market quality ${marketQuality} below WNBA official floor (40)`);
  }

  const confidence = num(pick.confidence ?? pick.finalConfidence);
  if (confidence > 0 && confidence < 55) {
    blocksOfficial = true;
    reasons.push(`Confidence ${confidence} below WNBA official floor (55)`);
  }

  const lineDelta = num(pick.lineDelta ?? pick.marketIntelligence?.lineDelta);
  const pickSide = normalizeSide(pick.side || pick.pick);
  if (
    computeLineMovementAgainstSide(pickSide, lineDelta) &&
    String(pick.league || "").toUpperCase() === "WNBA"
  ) {
    blocksOfficial = true;
    reasons.push("Line movement against pick side blocks official WNBA play");
  }

  const blowoutRisk = num(
    pick.wnbaGameContext?.blowoutRisk ?? pick.blowoutRisk
  );
  if (blowoutRisk >= 75) {
    blocksOfficial = true;
    reasons.push(`Blowout risk ${blowoutRisk} too high for official WNBA play`);
  }

  return { blocksOfficial, reasons };
}

export function evaluateWnbaOfficialEligibility(pick = {}) {
  if (String(pick.league || "").toUpperCase() !== "WNBA") {
    return { eligible: true, reasons: [], gates: {} };
  }

  const pickSide = normalizeSide(pick.side || pick.pick || pick.currentEngineSide);
  const gapEval = evaluateWnbaOfficialGapFloor(pick, pickSide);
  const fairLineDemotion = applyWnbaFairLineOfficialDemotion(pick);
  const lowRiskGates = evaluateWnbaLowRiskOfficialGates(pick);
  const availability = pick.availabilityGate || {};
  const reasons = [];

  let eligible = true;
  let maxOfficialTier = "PREMIUM";

  if (!gapEval.passes) {
    eligible = false;
    maxOfficialTier = "WATCHLIST";
    reasons.push(gapEval.label || gapEval.reason || "WNBA gap floor failed");
  }

  if (fairLineDemotion.fairLineBoostSuppressed) {
    maxOfficialTier = demoteTier(maxOfficialTier, "WATCHLIST");
    reasons.push(fairLineDemotion.fairLineOfficialNote);
  }

  if (availability.blocksOfficial) {
    eligible = false;
    if (availability.officialCapTier) {
      maxOfficialTier = demoteTier(maxOfficialTier, availability.officialCapTier);
    }
    reasons.push(
      ...(availability.dangerReasons || []).slice(0, 2)
    );
  } else if (
    availability.applicable &&
    availability.statusLevel === "OUT"
  ) {
    eligible = false;
    reasons.push("Player OUT — official blocked");
  }

  if (lowRiskGates.blocksOfficial) {
    eligible = false;
    reasons.push(...lowRiskGates.reasons);
  }

  const tier = String(pick.tier || "").toUpperCase();
  if (tier === "LEAN" || tier === "WATCHLIST") {
    eligible = false;
    if (tier === "WATCHLIST") {
      reasons.push("WATCHLIST tier — learning only, not official Results");
    }
  }

  if (tier === "PREMIUM" && maxOfficialTier !== "PREMIUM") {
    eligible = false;
    reasons.push(`Official tier cap ${maxOfficialTier} from WNBA v1 gates`);
  }

  return {
    eligible,
    reasons: [...new Set(reasons.filter(Boolean))],
    gates: {
      gapEval,
      fairLineDemotion,
      lowRiskGates,
      maxOfficialTier,
      underGapFloor: WNBA_UNDER_GAP_FLOOR,
      overGapFloor: WNBA_OVER_GAP_FLOOR,
    },
    version: "wnba-official-v1",
  };
}

export function applyWnbaOfficialV1Rules(pick = {}, context = {}) {
  if (!isCourteEdgeWnbaV1Enabled()) return pick;
  if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;

  const pickSide = normalizeSide(pick.side || pick.pick);
  const gapEval = evaluateWnbaOfficialGapFloor(pick, pickSide);
  const fairLineDemotion = applyWnbaFairLineOfficialDemotion(pick);
  const eligibility = evaluateWnbaOfficialEligibility({
    ...pick,
    availabilityGate: context.availabilityGate || pick.availabilityGate,
    wnbaGameContext: context.wnbaGameContext || pick.wnbaGameContext,
  });

  let tier = String(pick.tier || "LEAN").toUpperCase();
  const tierReasons = [...(pick.tierReasons || [])];
  let confidence = num(pick.confidence ?? pick.finalConfidence);

  if (!gapEval.passes && tier === "PREMIUM") {
    tier = "WATCHLIST";
    tierReasons.push(`WNBA gap floor: ${gapEval.label}`);
  }

  if (fairLineDemotion.fairLineBoostSuppressed && tier === "PREMIUM") {
    tier = "WATCHLIST";
    tierReasons.push(fairLineDemotion.fairLineOfficialNote);
    confidence = Math.min(confidence, confidence - 5);
  }

  const availability = context.availabilityGate || pick.availabilityGate || {};
  if (availability.officialCapTier && tier === "PREMIUM") {
    tier = demoteTier(tier, availability.officialCapTier);
    tierReasons.push(`Availability cap: ${availability.statusLevel}`);
  }

  const updated = {
    ...pick,
    tier,
    tierReasons,
    confidence,
    finalConfidence: confidence,
    winProbability: confidence,
    wnbaOfficialEligibility: eligibility,
    fairLineSideEffective: fairLineDemotion.fairLineSideEffective ?? pick.fairLineSide,
    fairLineBoostSuppressed: fairLineDemotion.fairLineBoostSuppressed,
    officialEligible: eligibility.eligible,
    wnbaGameContext: context.wnbaGameContext || pick.wnbaGameContext || null,
    defenseResult: context.defenseResult || pick.defenseResult,
  };

  if (context.wnbaGameContext) {
    updated.blowoutRisk = context.wnbaGameContext.blowoutRisk;
  }

  return updated;
}

export function isWnbaOfficialEligiblePick(pick = {}) {
  if (String(pick.league || "").toUpperCase() !== "WNBA") return true;
  if (!isCourteEdgeWnbaV1Enabled()) return true;
  if (pick.officialEligible === false) return false;
  const evalResult =
    pick.wnbaOfficialEligibility || evaluateWnbaOfficialEligibility(pick);
  return Boolean(evalResult.eligible);
}
