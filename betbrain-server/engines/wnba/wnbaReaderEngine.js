import {
  computeLineMovementAgainstSide,
  interpretLineMovement,
} from "../marketIntelligenceEngine.js";
import { evaluateWnbaOfficialEligibility } from "../wnbaOfficialEngine.js";
import { WNBA_UNDER_GAP_FLOOR } from "./wnbaGraduatedDataModeV1.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addUnique(list, text) {
  if (text && !list.includes(text)) list.push(text);
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "";
}

function isLowLineContext(line = 0) {
  return num(line) <= 8.5;
}

function isWnbaDataMode(dataMode = "") {
  return String(dataMode || "").toUpperCase().includes("WNBA");
}

function scoreVolumePath(side, card = {}) {
  const line = num(card.bookLine);
  const proj = num(card.projection?.projection);
  const minutes = num(card.last5?.minutes);
  const fga = num(card.last5?.fga);
  const fta = num(card.last5?.fta);
  const lowLine = isLowLineContext(line);
  const dataMode = String(card.dataMode || "").toUpperCase();
  let score = 0;
  const supports = [];
  const disagrees = [];

  const edge = side === "OVER" ? proj - line : line - proj;
  let underGap = null;
  let underGapFloorUsed = null;
  let underGapFloorPassed = null;
  let limitedDataUnderPenaltyApplied = false;

  if (edge >= 4) {
    score += 12;
    supports.push(`Projection gap ${edge.toFixed(1)} supports ${side}`);
  } else if (edge >= 2.5) {
    score += 7;
    supports.push(`Moderate projection gap ${edge.toFixed(1)}`);
  } else if (edge <= 1) {
    score -= 8;
    disagrees.push(`Thin ${side} gap (${edge.toFixed(1)})`);
  }

  if (side === "OVER") {
    if (lowLine) {
      if (minutes >= 20 && fga >= 6) {
        score += 8;
        supports.push("Low-line over backed by minutes+FGA volume path");
      } else if (minutes > 0 && minutes < 18) {
        score -= 10;
        disagrees.push("Low-line over without sufficient minutes");
      }
    } else {
      if (minutes >= 28 && fga >= 12) {
        score += 8;
        supports.push("Star-line over with strong minutes+FGA");
      } else if (minutes > 0 && minutes < 24) {
        score -= 8;
        disagrees.push("Minutes too low for confident over");
      }
    }

    if (fga >= 10) score += 4;
    else if (fga > 0 && fga < 7) {
      score -= 6;
      disagrees.push("FGA floor too low for over");
    }

    if (fta >= 3) score += 2;
  }

  if (side === "UNDER") {
    underGap = edge;
    if (isWnbaDataMode(dataMode)) {
      underGapFloorUsed = WNBA_UNDER_GAP_FLOOR;
      underGapFloorPassed = underGap >= underGapFloorUsed;
      if (!underGapFloorPassed) {
        limitedDataUnderPenaltyApplied = true;
        score -= 14;
        disagrees.push(
          `WNBA Under gap ${underGap.toFixed(1)} below floor ${underGapFloorUsed}`
        );
      }
    }
    if (minutes > 0 && minutes < 22) {
      score += 5;
      supports.push("Limited minutes support under");
    }
    if (fga > 0 && fga < 8) {
      score += 4;
      supports.push("Low FGA supports under");
    }
  }

  return {
    score,
    supports,
    disagrees,
    edge,
    underGap,
    underGapFloorUsed,
    underGapFloorPassed,
    limitedDataUnderPenaltyApplied,
  };
}

function scoreRecentScoring(side, card = {}) {
  const line = num(card.bookLine);
  const recent = num(card.last5?.points);
  const season = num(card.season?.points);
  const fga = num(card.last5?.fga);
  const ptsPerFGA = num(card.last5?.ptsPerFGA);
  const seasonPtsPerFGA = num(card.season?.ptsPerFGA);
  let score = 0;
  const supports = [];
  const disagrees = [];

  const hotShooting =
    ptsPerFGA > 0 &&
    seasonPtsPerFGA > 0 &&
    ptsPerFGA >= seasonPtsPerFGA + 0.15 &&
    fga < 9;

  if (side === "OVER") {
    if (recent >= line + 2) {
      score += 6;
      supports.push(`Last-5 avg ${recent} above line`);
    }
    if (hotShooting) {
      score -= 6;
      disagrees.push("Recent scoring driven by hot shooting, not volume");
    } else if (recent >= line && fga >= 8) {
      score += 4;
      supports.push("Recent scoring backed by shot volume");
    }
  }

  if (side === "UNDER") {
    if (recent <= line - 2) {
      score += 6;
      supports.push(`Last-5 avg ${recent} below line`);
    }
    if (hotShooting && recent >= line) {
      score -= 4;
      disagrees.push("Hot shooting may sustain recent over pace");
    }
  }

  if (card.scoringTrend === "up" && side === "OVER") {
    score += 3;
    supports.push("Scoring trend up");
  }
  if (card.scoringTrend === "down" && side === "UNDER") {
    score += 3;
    supports.push("Scoring trend down");
  }

  return { score, supports, disagrees };
}

function scoreFairLine(side, card = {}) {
  const fair = card.fairLine || {};
  const fairSide = normalizeSide(fair.fairLineSide);
  const edge = Math.abs(num(fair.fairLineEdge));
  const quality = num(fair.fairLineQuality);
  let score = 0;
  const supports = [];
  const disagrees = [];

  if (fairSide === "NONE" || edge < 1.5) {
    return { score: 0, supports, disagrees, role: "neutral" };
  }

  if (fairSide === side) {
    score += clamp(Math.round(quality / 12 + edge * 2), 3, 12);
    supports.push(`Fair line ${fair.fairLine} agrees with ${side}`);
    return { score, supports, disagrees, role: "agree" };
  }

  score -= clamp(Math.round(quality / 10 + edge * 2), 4, 14);
  disagrees.push(
    `Fair line ${fair.fairLine} favors ${fairSide}, not ${side}`
  );
  return { score, supports, disagrees, role: "disagree" };
}

function scoreMarket(side, card = {}) {
  let score = 0;
  const supports = [];
  const disagrees = [];
  const movement = num(card.lineMovement);
  const lineMovement = interpretLineMovement(side, movement);

  if (lineMovement.marketDirectionAgainstPick) {
    score -= 10;
    disagrees.push(lineMovement.lineMovementInterpretation);
  } else if (movement !== 0 && lineMovement.lineMovedForPickSide) {
    score += 5;
    supports.push(lineMovement.lineMovementInterpretation);
  } else if (movement !== 0) {
    score += 1;
    supports.push("Line movement neutral for side");
  }

  if (num(card.bookCount) >= 4) {
    score += 3;
    supports.push("Solid book coverage");
  } else if (num(card.bookCount) <= 1) {
    score -= 4;
    disagrees.push("Thin book coverage");
  }

  if (num(card.lineSpread) >= 2.5) {
    score -= 4;
    disagrees.push("Wide line spread across books");
  }

  return { score, supports, disagrees, lineMovement };
}

function scoreEnvironment(side, card = {}) {
  const env = card.gameEnvironment || {};
  const blowout = num(env.blowoutRisk);
  let score = 0;
  const supports = [];
  const disagrees = [];

  if (side === "OVER" && blowout >= 75) {
    score -= 10;
    disagrees.push(`Blowout risk ${blowout} hurts over`);
  }
  if (side === "UNDER" && blowout >= 70) {
    score += 5;
    supports.push("Blowout risk supports under");
  }

  const defScore = num(card.opponentDefense?.score);
  if (side === "OVER" && defScore >= 70) {
    score -= 5;
    disagrees.push("Strong opponent defense vs over");
  }
  if (side === "UNDER" && defScore >= 65) {
    score += 4;
    supports.push("Strong defense supports under");
  }

  return { score, supports, disagrees };
}

function scoreRoleAndUsage(side, card = {}) {
  let score = 0;
  const supports = [];
  const disagrees = [];

  if (card.roleTrend === "up" && side === "OVER") {
    score += 6;
    supports.push("Role trend rising — volume path expanding");
  }
  if (card.roleTrend === "down" && side === "UNDER") {
    score += 5;
    supports.push("Role trend contracting");
  }
  if (card.roleTrend === "down" && side === "OVER") {
    score -= 6;
    disagrees.push("Role trend down conflicts with over");
  }

  if (card.teammateUsageShift?.active && side === "OVER") {
    score += 5;
    supports.push("Teammate-out usage shift boosts over case");
  }

  const avail = card.injuryAvailability || {};
  if (avail.level === "OUT" || avail.blocksPlay) {
    return {
      score: -100,
      supports,
      disagrees: ["Player unavailable — no bet"],
      blocked: true,
    };
  }
  if (avail.level === "LIMITED") {
    score -= 12;
    disagrees.push("Limited/doubtful availability");
  }
  if (avail.level === "QUESTIONABLE") {
    score -= 4;
    disagrees.push("Questionable availability");
  }

  return { score, supports, disagrees, blocked: false };
}

function buildSideCase(side, card = {}) {
  const volume = scoreVolumePath(side, card);
  const recent = scoreRecentScoring(side, card);
  const fair = scoreFairLine(side, card);
  const market = scoreMarket(side, card);
  const env = scoreEnvironment(side, card);
  const role = scoreRoleAndUsage(side, card);

  const totalScore =
    volume.score +
    recent.score +
    fair.score +
    market.score +
    env.score +
    role.score;

  const rawScore = Number(totalScore.toFixed(1));
  return {
    side,
    score: rawScore,
    rawScore,
    adjustedScore: rawScore,
    eligible: !role.blocked,
    blockReasons: role.blocked ? ["ROLE_BLOCKED"] : [],
    notScoredReason: null,
    edge: volume.edge,
    supports: [
      ...volume.supports,
      ...recent.supports,
      ...fair.supports,
      ...market.supports,
      ...env.supports,
      ...role.supports,
    ],
    disagrees: [
      ...volume.disagrees,
      ...recent.disagrees,
      ...fair.disagrees,
      ...market.disagrees,
      ...env.disagrees,
      ...role.disagrees,
    ],
    fairLineRole: fair.role,
    blocked: Boolean(role.blocked),
    underGap: volume.underGap,
    underGapFloorUsed: volume.underGapFloorUsed,
    underGapFloorPassed: volume.underGapFloorPassed,
    limitedDataUnderPenaltyApplied: volume.limitedDataUnderPenaltyApplied,
    lineMovement: market.lineMovement,
  };
}

export function readWnbaProp(dataCard = {}) {
  const missing = (dataCard.dataMissingFlags || [])
    .filter((f) => f.missing)
    .map((f) => f.note || f.key);

  const whyOver = [];
  const whyUnder = [];
  const reasonCodes = [];

  if (dataCard.injuryAvailability?.blocksPlay) {
    return {
      finalSide: null,
      whyOver,
      whyUnder,
      supports: [],
      disagrees: dataCard.injuryAvailability.reasons || ["Player unavailable"],
      missing,
      readerConfidence: 0,
      decision: "NO_BET",
      reasonCodes: ["AVAILABILITY_BLOCK"],
      overCase: null,
      underCase: null,
      readerVersion: "wnba-reader-v2",
    };
  }

  const overCase = buildSideCase("OVER", dataCard);
  const underCase = buildSideCase("UNDER", dataCard);

  if (isWnbaDataMode(dataCard.dataMode) && underCase.underGapFloorPassed === false) {
    underCase.blocked = true;
    underCase.eligible = false;
    underCase.blockReasons = ["UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"];
    reasonCodes.push("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR");
  }

  whyOver.push(...overCase.supports);
  whyUnder.push(...underCase.supports);

  const overEligible = overCase.eligible !== false && !overCase.blocked;
  const underEligible = underCase.eligible !== false && !underCase.blocked;
  let finalSide = "OVER";
  if (overEligible && underEligible) {
    finalSide = overCase.score >= underCase.score ? "OVER" : "UNDER";
  } else if (overEligible) {
    finalSide = "OVER";
  } else if (underEligible) {
    finalSide = "UNDER";
  } else {
    finalSide = overCase.score >= underCase.score ? "OVER" : "UNDER";
  }
  const chosen = finalSide === "OVER" ? overCase : underCase;
  const other = finalSide === "OVER" ? underCase : overCase;
  const margin = Math.abs(overCase.score - underCase.score);

  if (chosen.blocked || chosen.score < 0) {
    finalSide = null;
    reasonCodes.push("SIDE_BLOCKED");
  } else if (margin < 3) {
    reasonCodes.push("SIDE_TOO_CLOSE");
  }

  const disagrees = [...chosen.disagrees];
  const supports = [...chosen.supports];

  let readerConfidence = clamp(
    Math.round(
      num(dataCard.dataConfidenceScore) * 0.45 +
        chosen.score * 3 +
        margin * 2
    ),
    0,
    95
  );

  if (num(dataCard.dataConfidenceScore) < 40) {
    readerConfidence = clamp(readerConfidence - 15, 0, 95);
    reasonCodes.push("LOW_DATA_CONFIDENCE");
    missing.push("Data confidence below 40%");
  }

  if (!dataCard.playerId) {
    reasonCodes.push("MISSING_PLAYER_ID");
    readerConfidence = clamp(readerConfidence - 10, 0, 95);
  }

  const strongFairDisagree =
    chosen.fairLineRole === "disagree" &&
    Math.abs(num(dataCard.fairLine?.fairLineEdge)) >= 3 &&
    num(dataCard.fairLine?.fairLineQuality) >= 50;

  if (strongFairDisagree) {
    reasonCodes.push("FAIR_LINE_STRONG_DISAGREE");
    disagrees.push(
      `Fair line ${dataCard.fairLine?.fairLine} strongly disagrees with ${finalSide}`
    );
    readerConfidence = clamp(readerConfidence - 12, 0, 95);
  }

  let decision = "TEST";

  if (!finalSide || chosen.score < 4 || readerConfidence < 25) {
    decision = "NO_BET";
    reasonCodes.push("INSUFFICIENT_EDGE");
  } else if (
    readerConfidence >= 62 &&
    chosen.score >= 10 &&
    margin >= 5 &&
    num(dataCard.dataConfidenceScore) >= 55 &&
    !strongFairDisagree &&
    reasonCodes.length === 0
  ) {
    decision = "OFFICIAL";
    reasonCodes.push("STRONG_READER_CASE");
  } else {
    reasonCodes.push("READER_TEST_PLAY");
    if (strongFairDisagree) reasonCodes.push("FAIR_LINE_TEST_ONLY");
    if (num(dataCard.dataConfidenceScore) < 55) {
      reasonCodes.push("DATA_TEST_ONLY");
    }
  }

  if (chosen.edge > 0 && chosen.edge < 2.5 && finalSide === "OVER") {
    reasonCodes.push("THIN_OVER_GAP");
    if (decision === "OFFICIAL") decision = "TEST";
  }

  if (
    finalSide === "UNDER" &&
    chosen.limitedDataUnderPenaltyApplied &&
    isWnbaDataMode(dataCard.dataMode)
  ) {
    addUnique(reasonCodes, "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR");
    if (decision === "OFFICIAL") decision = "TEST";
    decision = "NO_BET";
    reasonCodes.push("INSUFFICIENT_EDGE");
    finalSide = null;
  }

  return {
    finalSide,
    whyOver,
    whyUnder,
    supports,
    disagrees,
    missing,
    readerConfidence,
    decision,
    reasonCodes,
    overCase,
    underCase,
    margin,
    underGap: chosen.underGap,
    underGapFloorUsed: chosen.underGapFloorUsed,
    underGapFloorPassed: chosen.underGapFloorPassed,
    limitedDataUnderPenaltyApplied: chosen.limitedDataUnderPenaltyApplied,
    lineMovement: chosen.lineMovement,
    readerVersion: "wnba-reader-v2-calibration",
  };
}

export function mapReaderToTracking(reader = {}, pick = {}) {
  if (reader.decision === "NO_BET") {
    return {
      trackingType: "NO_BET",
      recordType: "NO_BET",
      finalDecision: "NO_BET",
      officialEligible: false,
      excludedFromOfficialRecord: true,
      trustable: false,
      noPlay: true,
      readerOutcome: "NO_BET",
      readerDecision: "NO_BET",
      trackingReason: null,
      readerOfficialDemoted: false,
    };
  }

  const sideLabel = reader.finalSide === "OVER" ? "Over" : "Under";
  const eligibility =
    reader.decision === "OFFICIAL"
      ? evaluateWnbaOfficialEligibility({
          ...pick,
          side: sideLabel,
          pick: sideLabel,
          confidence: reader.readerConfidence,
        })
      : { eligible: false, reasons: [] };

  const readerWantsOfficial = reader.decision === "OFFICIAL";
  const official = readerWantsOfficial && eligibility.eligible;
  const readerOfficialDemoted = readerWantsOfficial && !official;

  const failureReasonCodes = (reader.reasonCodes || []).filter(
    (code) => !["STRONG_READER_CASE", "READER_TEST_PLAY"].includes(code)
  );

  let officialDemotionReason = null;
  let trackingReason = null;

  if (readerOfficialDemoted) {
    officialDemotionReason =
      (eligibility.reasons || []).join("; ") ||
      "WNBA v1 official gate failed";
    trackingReason = officialDemotionReason;
  } else if (!official) {
    trackingReason =
      failureReasonCodes.join("; ") || "Reader uncertain — TEST path";
  }

  const testReasons = official
    ? []
    : readerOfficialDemoted
      ? [...(eligibility.reasons || [])]
      : failureReasonCodes;

  return {
    trackingType: official ? "OFFICIAL" : "TEST",
    recordType: official ? "OFFICIAL" : "TEST",
    finalDecision: official ? "OFFICIAL" : "TEST",
    officialEligible: official,
    excludedFromOfficialRecord: !official,
    trustable: true,
    noPlay: false,
    readerOfficialDemoted,
    officialDemotionReason,
    officialEligibilityFailReason: readerOfficialDemoted
      ? officialDemotionReason
      : null,
    readerOutcome: reader.decision,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence,
    trackingReason,
    testReasons,
    testReason: official ? null : trackingReason || testReasons.join("; ") || null,
    v1OfficialGatePassed: official,
  };
}
