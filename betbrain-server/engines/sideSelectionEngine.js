import { buildFairLine } from "./fairLineEngine.js";
import { computeLineMovementAgainstSide } from "./marketIntelligenceEngine.js";
import {
  evaluateWnbaOfficialEligibility,
  isCourteEdgeWnbaV1Enabled,
} from "./wnbaOfficialEngine.js";
import { evaluateWnbaGapFloor, isWnbaLimitedData } from "./wnbaShadowEngine.js";

const ENGINE_VERSION = "side-selection-v1";
const WNBA_OVER_WEAK_THRESHOLD = 2.5;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "";
}

function addUnique(list, text) {
  if (text && !list.includes(text)) list.push(text);
}

function getSignalStrength({ totalEvidence, netEdge, dataQuality }) {
  if (dataQuality >= 75 && totalEvidence >= 35 && netEdge >= 12) return "STRONG";
  if (dataQuality >= 55 && totalEvidence >= 22 && netEdge >= 6) return "MODERATE";
  return "WEAK";
}

function getRiskLabel(chosenRisk) {
  if (chosenRisk <= 32) return "Low Risk";
  if (chosenRisk <= 48) return "Medium Risk";
  return "High Risk";
}

function classifyFairLineInfluence(fairLine = {}, candidateSide = "", limitedData = false) {
  const fairSide = normalizeSide(fairLine.fairLineSide);
  const quality = num(fairLine.fairLineQuality);
  const edge = Math.abs(num(fairLine.fairLineEdge));

  if (fairSide === "NONE" || edge < 1.5) {
    return { role: "neutral", weight: 0, note: "Fair line neutral zone" };
  }

  if (limitedData && quality < 45) {
    return {
      role: "unreliable",
      weight: 0,
      note: "WNBA limited data — fair line unreliable for official boost",
    };
  }

  if (fairSide === candidateSide) {
    const weight = clamp(Math.round(quality / 10 + edge * 2), 3, 14);
    return {
      role: "support",
      weight,
      note: `Fair line ${fairLine.fairLine} supports ${candidateSide}`,
    };
  }

  return {
    role: "contradict",
    weight: clamp(Math.round(quality / 8 + edge * 2), 4, 16),
    note: `Fair line ${fairLine.fairLine} favors ${fairSide}, not ${candidateSide}`,
  };
}

function scoreSideCase({
  side,
  line,
  projection,
  seasonAvg,
  last5Avg,
  minutesAvg,
  fgaAvg,
  ftaAvg,
  roleCertainty,
  blowoutRisk,
  fairLineInfluence,
  riskComparison = {},
}) {
  let score = side === "OVER" ? num(riskComparison.overNet) : num(riskComparison.underNet);
  const supports = [];
  const resistances = [];

  const edge =
    side === "OVER"
      ? num(projection) - num(line)
      : num(line) - num(projection);

  if (edge >= 4) {
    score += 10;
    supports.push(`${side} projection gap ${edge.toFixed(1)}`);
  } else if (edge >= 2.5) {
    score += 6;
    supports.push(`${side} projection gap ${edge.toFixed(1)}`);
  } else if (edge <= 1) {
    score -= 6;
    resistances.push(`Thin ${side} projection gap (${edge.toFixed(1)})`);
  }

  if (side === "OVER" && last5Avg >= line + 2) {
    score += 5;
    supports.push("Recent form supports over");
  }
  if (side === "UNDER" && last5Avg <= line - 2) {
    score += 5;
    supports.push("Recent form supports under");
  }

  if (side === "OVER" && seasonAvg >= line + 2) {
    score += 3;
    supports.push("Season average supports over");
  }
  if (side === "UNDER" && seasonAvg <= line - 2) {
    score += 3;
    supports.push("Season average supports under");
  }

  if (side === "OVER") {
    if (minutesAvg >= 28) score += 4;
    else if (minutesAvg > 0 && minutesAvg < 24) {
      score -= 8;
      resistances.push("Low minutes hurt over case");
    }
    if (fgaAvg >= 12) score += 4;
    else if (fgaAvg > 0 && fgaAvg < 8) {
      score -= 6;
      resistances.push("Low FGA hurt over case");
    }
    if (ftaAvg >= 4) score += 2;
    if (blowoutRisk >= 70) {
      score -= 10;
      resistances.push("Blowout risk hurts over");
    }
  }

  if (side === "UNDER") {
    if (minutesAvg > 0 && minutesAvg < 24) score += 4;
    if (fgaAvg > 0 && fgaAvg < 8) score += 4;
    if (blowoutRisk >= 70) score += 5;
  }

  if (roleCertainty > 0 && roleCertainty < 45) {
    score -= side === "OVER" ? 8 : 4;
    resistances.push("Role uncertainty");
  }

  if (fairLineInfluence.role === "support") {
    score += fairLineInfluence.weight;
    supports.push(fairLineInfluence.note);
  } else if (fairLineInfluence.role === "contradict") {
    score -= fairLineInfluence.weight;
    resistances.push(fairLineInfluence.note);
  }

  return {
    side,
    score: Number(score.toFixed(1)),
    edge,
    supports,
    resistances,
    chosenRisk: side === "OVER" ? num(riskComparison.overRisk) : num(riskComparison.underRisk),
  };
}

function detectContradictions({
  finalSide,
  projection,
  line,
  fairLine = {},
  fairLineInfluence,
  blowoutRisk,
  minutesAvg,
  fgaAvg,
  lineDelta,
  availabilityGate = {},
  overCase,
  underCase,
  limitedData,
}) {
  const contradictions = [];
  const edge =
    finalSide === "OVER"
      ? num(projection) - num(line)
      : num(line) - num(projection);

  if (
    fairLineInfluence.role === "contradict" &&
    num(fairLine.fairLineQuality) >= 50 &&
    !limitedData
  ) {
    contradictions.push({
      type: "fair_line_mismatch",
      severity: "moderate",
      message: fairLineInfluence.note,
    });
  }

  if (finalSide === "OVER" && edge > 0 && edge < 2.5) {
    contradictions.push({
      type: "thin_over_gap",
      severity: "moderate",
      message: `Projection over by only ${edge.toFixed(1)} — weak over context`,
    });
  }

  if (finalSide === "UNDER" && overCase.score > underCase.score + 4) {
    contradictions.push({
      type: "under_vs_over_evidence",
      severity: "moderate",
      message: "Over evidence stronger than under despite under selection",
    });
  }

  if (finalSide === "OVER" && blowoutRisk >= 75) {
    contradictions.push({
      type: "blowout_over",
      severity: "high",
      message: `Blowout risk ${blowoutRisk} conflicts with over`,
    });
  }

  if (finalSide === "OVER" && minutesAvg > 0 && minutesAvg < 22) {
    contradictions.push({
      type: "minutes_over",
      severity: "moderate",
      message: `Minutes ${minutesAvg} too low for confident over`,
    });
  }

  if (finalSide === "OVER" && fgaAvg > 0 && fgaAvg < 7) {
    contradictions.push({
      type: "volume_over",
      severity: "moderate",
      message: `FGA ${fgaAvg} too low for confident over`,
    });
  }

  if (computeLineMovementAgainstSide(finalSide, num(lineDelta))) {
    contradictions.push({
      type: "line_movement_against",
      severity: "high",
      message: "Line movement against selected side",
    });
  }

  if (availabilityGate.statusLevel === "QUESTIONABLE") {
    contradictions.push({
      type: "availability_questionable",
      severity: "moderate",
      message: "Player questionable — side trust reduced",
    });
  }

  return contradictions;
}

export function evaluateSideSelection({
  league = "",
  line = 0,
  projection = 0,
  seasonAvg = 0,
  last5Avg = 0,
  minutesAvg = 0,
  fgaAvg = 0,
  ftaAvg = 0,
  roleCertainty = 50,
  blowoutRisk = 50,
  dataQuality = 50,
  marketQuality = null,
  lineSpread = null,
  lineDelta = 0,
  bookCount = 0,
  playerState = {},
  roleChange = {},
  prop = {},
  riskComparison = {},
  fairLine: fairLineInput = null,
  availabilityGate = {},
  volumeProfile = {},
  volumeDangerGates = {},
  marketIntelligence = {},
  wnbaGameContext = null,
} = {}) {
  const limitedData =
    String(league || "").toUpperCase() === "WNBA" &&
    (isWnbaLimitedData({ league, volumeProfile, dataMode: playerState.dataMode }) ||
      isCourteEdgeWnbaV1Enabled());

  const fairLine =
    fairLineInput ||
    buildFairLine({
      playerState,
      roleChange,
      prop: { line, ...prop },
      auditOldSide: riskComparison.pickSide || "",
    });

  const overFair = classifyFairLineInfluence(fairLine, "OVER", limitedData);
  const underFair = classifyFairLineInfluence(fairLine, "UNDER", limitedData);

  const overCase = scoreSideCase({
    side: "OVER",
    line,
    projection,
    seasonAvg,
    last5Avg,
    minutesAvg,
    fgaAvg,
    ftaAvg,
    roleCertainty,
    blowoutRisk,
    fairLineInfluence: overFair,
    riskComparison,
  });

  const underCase = scoreSideCase({
    side: "UNDER",
    line,
    projection,
    seasonAvg,
    last5Avg,
    minutesAvg,
    fgaAvg,
    ftaAvg,
    roleCertainty,
    blowoutRisk,
    fairLineInfluence: underFair,
    riskComparison,
  });

  let finalSide = normalizeSide(riskComparison.pickSide);
  if (!finalSide) {
    if (overCase.score > underCase.score) finalSide = "OVER";
    else if (underCase.score > overCase.score) finalSide = "UNDER";
  }

  const chosenCase = finalSide === "OVER" ? overCase : underCase;
  const fairLineInfluence = finalSide === "OVER" ? overFair : underFair;

  const contradictions = detectContradictions({
    finalSide,
    projection,
    line,
    fairLine,
    fairLineInfluence,
    blowoutRisk,
    minutesAvg,
    fgaAvg,
    lineDelta: num(lineDelta ?? marketIntelligence.lineDelta),
    availabilityGate,
    overCase,
    underCase,
    limitedData,
  });

  const noBetReasons = [];
  const testReasons = [];

  if (availabilityGate.applicable && availabilityGate.statusLevel === "OUT") {
    noBetReasons.push("Player OUT — no bet");
  }
  if (availabilityGate.noPlay) {
    noBetReasons.push(...(availabilityGate.noPlayReasons || ["Availability blocks play"]));
  }

  if (!finalSide) {
    noBetReasons.push("No clear over/under side");
  }

  const hasProjection = num(projection) > 0;
  const hasRecent = num(last5Avg) > 0;
  if (!hasProjection && !hasRecent) {
    noBetReasons.push("Missing projection and recent scoring");
  }

  if (num(dataQuality) <= 30) {
    noBetReasons.push("Data quality too thin");
  }

  const highSeverity = contradictions.filter((c) => c.severity === "high");
  const moderateSeverity = contradictions.filter((c) => c.severity === "moderate");

  let sideTrustScore = clamp(
    Math.round(50 + chosenCase.score - highSeverity.length * 12 - moderateSeverity.length * 6),
    0,
    100
  );

  if (num(marketQuality) > 0 && num(marketQuality) < 30) {
    sideTrustScore = clamp(sideTrustScore - 10, 0, 100);
    testReasons.push("Weak market quality");
  }

  if (num(lineSpread) >= 2.5) {
    sideTrustScore = clamp(sideTrustScore - 6, 0, 100);
    testReasons.push("Wide line spread across books");
  }

  for (const reason of volumeDangerGates.dangerReasons || []) {
    if (finalSide === "OVER") {
      sideTrustScore = clamp(sideTrustScore - 4, 0, 100);
      addUnique(testReasons, reason);
    }
  }

  const sideTrustable =
    noBetReasons.length === 0 &&
    sideTrustScore >= 42 &&
    chosenCase.score >= 4 &&
    highSeverity.length === 0;

  const totalEvidence = num(riskComparison.totalEvidence) || chosenCase.score + 10;
  const netEdge = num(riskComparison.netEdge) || chosenCase.score;
  const signalStrength = getSignalStrength({ totalEvidence, netEdge, dataQuality: num(dataQuality) });
  const chosenRisk = chosenCase.chosenRisk || num(riskComparison.chosenRisk, 55);
  const riskLabel = getRiskLabel(chosenRisk);

  let finalDecision = "NO_BET";
  let trackingType = "NO_BET";

  if (noBetReasons.length > 0 || sideTrustScore < 25) {
    finalDecision = "NO_BET";
    trackingType = "NO_BET";
  } else {
    const sideLabel = finalSide === "OVER" ? "Over" : "Under";
    const gapEval = evaluateWnbaGapFloor(
      {
        league,
        line,
        projection,
        side: sideLabel,
        volumeProfile,
        dataMode: playerState.dataMode,
      },
      finalSide
    );

    const weakOverContext =
      finalSide === "OVER" &&
      (chosenCase.edge < WNBA_OVER_WEAK_THRESHOLD ||
        signalStrength === "WEAK" ||
        minutesAvg < 24 ||
        fgaAvg < 9);

    if (weakOverContext) {
      addUnique(testReasons, "Projection over with weak volume/context");
    }

    if (!gapEval.passes) {
      addUnique(testReasons, gapEval.label || gapEval.reason || "Gap floor failed");
    }

    if (highSeverity.length > 0) {
      addUnique(testReasons, highSeverity.map((c) => c.message).join("; "));
    }

    if (moderateSeverity.length >= 2) {
      addUnique(testReasons, "Multiple side contradictions");
    }

    if (!riskComparison.trustable) {
      addUnique(testReasons, ...(riskComparison.noPlayReasons || ["Risk comparison not trustable"]));
    }

    if (sideTrustable || sideTrustScore >= 38) {
      finalDecision = "TEST";
      trackingType = "TEST";
    } else {
      finalDecision = "NO_BET";
      trackingType = "NO_BET";
      noBetReasons.push("Side trust too low after contradiction review");
    }
  }

  const audit = {
    overCase,
    underCase,
    fairLineInfluence,
    fairLineQuality: fairLine.fairLineQuality,
    fairLineSide: fairLine.fairLineSide,
    fairLineEdge: fairLine.fairLineEdge,
    limitedData,
    sideTrustScore,
    signalStrength,
    riskLabel,
    chosenRisk,
  };

  return {
    engineVersion: ENGINE_VERSION,
    finalSide,
    finalDecision,
    trackingType,
    recordType: trackingType,
    sideTrustScore,
    sideTrustable,
    contradictions,
    noBetReasons,
    testReasons,
    signalStrength,
    risk: riskLabel,
    riskLabel,
    chosenRisk,
    fairLine,
    sideSelectionAudit: audit,
    sideSelectionDecision: finalDecision,
    officialEligible: false,
    excludedFromOfficialRecord: true,
    v1OfficialGatePassed: false,
    generatedAfterV1: isCourteEdgeWnbaV1Enabled(),
    trustable: finalDecision !== "NO_BET",
    noPlay: finalDecision === "NO_BET",
  };
}

export function finalizeSideTrackingDecision(pick = {}, sideSelection = {}) {
  if (!sideSelection?.finalSide) return {};

  const league = String(pick.league || "").toUpperCase();
  const tier = String(pick.tier || "").toUpperCase();
  const sideLabel = sideSelection.finalSide === "OVER" ? "Over" : "Under";

  if (sideSelection.finalDecision === "NO_BET") {
    return {
      trackingType: "NO_BET",
      recordType: "NO_BET",
      finalDecision: "NO_BET",
      sideSelectionDecision: "NO_BET",
      officialEligible: false,
      excludedFromOfficialRecord: true,
      v1OfficialGatePassed: false,
      trustable: false,
      noPlay: true,
    };
  }

  const officialEligibility =
    league === "WNBA" && isCourteEdgeWnbaV1Enabled()
      ? evaluateWnbaOfficialEligibility({ ...pick, side: sideLabel, pick: sideLabel })
      : { eligible: Boolean(pick.officialEligible ?? sideSelection.sideTrustable) };

  const gapEval = evaluateWnbaGapFloor(
    { ...pick, side: sideLabel, pick: sideLabel },
    sideSelection.finalSide
  );
  const highSeverity = (sideSelection.contradictions || []).filter((c) => c.severity === "high");
  const weakOverContext = sideSelection.testReasons?.some((r) =>
    String(r).includes("weak volume/context")
  );

  const v1OfficialGatePassed =
    officialEligibility.eligible &&
    sideSelection.sideTrustable &&
    gapEval.passes &&
    highSeverity.length === 0 &&
    !weakOverContext &&
    tier === "PREMIUM";

  const testReasons = [...(sideSelection.testReasons || [])];
  if (!v1OfficialGatePassed) {
    for (const reason of officialEligibility.reasons || []) {
      addUnique(testReasons, reason);
    }
  }

  const finalDecision = v1OfficialGatePassed ? "OFFICIAL" : "TEST";
  const trackingType = finalDecision;

  return {
    trackingType,
    recordType: trackingType,
    finalDecision,
    sideSelectionDecision: finalDecision,
    officialEligible: finalDecision === "OFFICIAL",
    excludedFromOfficialRecord: finalDecision !== "OFFICIAL",
    v1OfficialGatePassed,
    testReason: testReasons.join("; ") || null,
    testReasons,
    trustable: true,
    noPlay: false,
  };
}

export { ENGINE_VERSION as SIDE_SELECTION_ENGINE_VERSION };
