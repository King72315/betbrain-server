/**
 * Lab learning enrichment — postgame truth lessons + module attribution.
 * Never mutates pregameSnapshot. Analysis-only fields for Lab / History.
 */
import { labMeasuredField, readMeasuredValue } from "./labMeasuredFields.js";

export const LAB_LEARNING_VERSION = "lab-learning-deep-packet-v2";

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return raw || null;
}

function oppositeSide(side) {
  if (side === "OVER") return "UNDER";
  if (side === "UNDER") return "OVER";
  return null;
}

function wouldSideWin(side, line, actual) {
  const s = normalizeSide(side);
  const l = num(line);
  const a = num(actual);
  if (!s || l == null || a == null) return null;
  if (s === "OVER") {
    if (a > l) return true;
    if (a < l) return false;
    return null;
  }
  if (s === "UNDER") {
    if (a < l) return true;
    if (a > l) return false;
    return null;
  }
  return null;
}

function getExpectedMinutes(prop = {}) {
  return num(
    prop.pregameSnapshot?.expectedMinutes ??
      prop.expectedMinutes ??
      prop.playerState?.expectedMinutes
  );
}

function getExpectedFGA(prop = {}) {
  return num(
    prop.pregameSnapshot?.expectedFGA ?? prop.expectedFGA ?? prop.playerState?.expectedFGA
  );
}

function getExpectedFTA(prop = {}) {
  return num(
    prop.pregameSnapshot?.expectedFTA ?? prop.expectedFTA ?? prop.playerState?.expectedFTA
  );
}

/**
 * Build / normalize postgameTruth from graded prop fields.
 */
export function buildPostgameTruth(prop = {}) {
  if (prop.postgameTruth && typeof prop.postgameTruth === "object") {
    return { ...prop.postgameTruth };
  }
  const meta = prop.resultMeta || {};
  const lockLine = num(
    prop.lockLine ??
      prop.officialLine ??
      prop.pickLine ??
      prop.line ??
      prop.pregameSnapshot?.line
  );
  const openingLine = num(
    prop.pregameSnapshot?.marketBookData?.openingLine ?? prop.openingLine ?? lockLine
  );
  const closingLine = num(prop.closingLine ?? prop.latestLine ?? prop.currentLine ?? lockLine);
  const side = normalizeSide(
    prop.pregameSnapshot?.side || prop.lockedSide || prop.side || prop.pick
  );
  let closingLineValue = prop.closingLineValue ?? null;
  if (closingLineValue == null && lockLine != null && closingLine != null && side) {
    closingLineValue =
      side === "OVER"
        ? Number((closingLine - lockLine).toFixed(2))
        : Number((lockLine - closingLine).toFixed(2));
  }
  const teamScore = num(prop.teamFinalScore ?? meta.teamScore);
  const oppScore = num(prop.opponentFinalScore ?? meta.opponentScore);
  const actualMinutesRaw = num(prop.actualMinutes ?? meta.minutes);
  const actualPointsRaw = num(prop.actualStat ?? prop.actualPoints ?? prop.finalPoints);
  const actualFGARaw = num(prop.actualFGA ?? meta.fga);
  const actualFTARaw = num(prop.actualFTA ?? meta.fta);
  const actualFG3ARaw = num(prop.actualFG3A ?? meta.fg3a);
  const actualFGMRaw = num(prop.actualFGM ?? meta.fgm);
  const actualFGPctRaw = num(prop.actualFGPct ?? meta.fgPct);
  const actualFG3PctRaw = num(prop.actualFG3Pct ?? meta.fg3Pct);
  const actualTSPctRaw = num(prop.actualTSPct ?? meta.tsPct);
  const actualPaceRaw = num(prop.actualPace ?? meta.pace);
  const overtime = Boolean(prop.overtime ?? meta.overtime);
  const blowout = Boolean(
    prop.blowout ??
      (teamScore != null &&
        oppScore != null &&
        Math.abs(teamScore - oppScore) >= 18)
  );

  const minutesReason =
    actualMinutesRaw != null
      ? null
      : meta.dnp
        ? "dnp"
        : prop.pendingReason
          ? String(prop.pendingReason)
          : "box_score_unavailable";
  const measured = {
    actualPoints: labMeasuredField(actualPointsRaw, "box_score_unavailable"),
    actualMinutes: labMeasuredField(actualMinutesRaw, minutesReason || "box_score_unavailable"),
    actualFGA: labMeasuredField(
      actualFGARaw,
      actualMinutesRaw == null ? "minutes_unavailable" : "box_score_unavailable"
    ),
    actualFTA: labMeasuredField(
      actualFTARaw,
      actualMinutesRaw == null ? "minutes_unavailable" : "box_score_unavailable"
    ),
    actualFG3A: labMeasuredField(actualFG3ARaw, "box_score_unavailable"),
    actualFGM: labMeasuredField(actualFGMRaw, "box_score_unavailable"),
    actualFGPct: labMeasuredField(actualFGPctRaw, "box_score_unavailable"),
    actualFG3Pct: labMeasuredField(actualFG3PctRaw, "box_score_unavailable"),
    actualTSPct: labMeasuredField(actualTSPctRaw, "box_score_unavailable"),
    actualUsage: labMeasuredField(prop.actualUsage ?? meta.usage, "usage_unavailable"),
    teamFinalScore: labMeasuredField(teamScore, "score_unavailable"),
    opponentFinalScore: labMeasuredField(oppScore, "score_unavailable"),
    finalMargin: labMeasuredField(
      num(prop.finalMargin ?? meta.gameMargin) ??
        (teamScore != null && oppScore != null ? teamScore - oppScore : null),
      teamScore == null || oppScore == null ? "score_unavailable" : "not_reported"
    ),
    actualPace: labMeasuredField(actualPaceRaw, "pace_unavailable"),
    closingLine: labMeasuredField(closingLine, "closing_line_unavailable"),
    closingLineValue: labMeasuredField(closingLineValue, "clv_unavailable"),
    lockLine: labMeasuredField(lockLine, "lock_line_unavailable"),
    openingLine: labMeasuredField(openingLine, "opening_line_unavailable"),
  };

  const dnpConfirmed =
    Boolean(prop.dnpConfirmed ?? meta.dnp) ||
    (actualMinutesRaw === 0 && minutesReason === "dnp");

  return {
    actualPoints: actualPointsRaw,
    actualMinutes: actualMinutesRaw,
    actualFGA: actualFGARaw,
    actualFTA: actualFTARaw,
    actualFG3A: actualFG3ARaw,
    actualFGM: actualFGMRaw,
    actualFGPct: actualFGPctRaw,
    actualFG3Pct: actualFG3PctRaw,
    actualTSPct: actualTSPctRaw,
    starterResult: prop.starterResult ?? meta.starter ?? null,
    startPosition: prop.startPosition ?? meta.startPosition ?? null,
    teamFinalScore: teamScore,
    opponentFinalScore: oppScore,
    finalMargin: readMeasuredValue(measured.finalMargin),
    actualPace: actualPaceRaw,
    dnpConfirmed,
    restrictionConfirmed: Boolean(prop.restrictionConfirmed ?? meta.restriction),
    foulTrouble: Boolean(prop.foulTrouble ?? meta.foulTrouble),
    injuryConfirmation: prop.injuryConfirmation || meta.injuryNote || null,
    overtime,
    blowout,
    lockLine,
    openingLine,
    closingLine,
    closingLineValue,
    bookLockLine: prop.bookLockLine ?? lockLine,
    bookCloseLine: prop.bookCloseLine ?? closingLine,
    lineMovement: prop.lineMovement || null,
    measuredFields: measured,
  };
}

/**
 * Classify miss with subtype + human calibration lesson.
 */
export function classifyPropMiss(prop = {}, postgame = null) {
  const truth = postgame || buildPostgameTruth(prop);
  const status = String(prop.status || "").toLowerCase();
  const result = String(prop.result || prop.status || "").toUpperCase();
  const won = status === "win" || result === "WIN";
  const lost = status === "loss" || result === "LOSS";
  const push = status === "push" || result === "PUSH";

  const expectedMinutes = getExpectedMinutes(prop);
  const expectedFGA = getExpectedFGA(prop);
  const actualMinutes = num(truth.actualMinutes);
  const actualFGA = num(truth.actualFGA);
  const actualPoints = num(truth.actualPoints);
  const projection = num(
    prop.pregameSnapshot?.projection ?? prop.projectedPoints ?? prop.projection
  );
  const line = num(prop.pregameSnapshot?.line ?? prop.officialLine ?? prop.line);
  const side = normalizeSide(
    prop.pregameSnapshot?.side || prop.lockedSide || prop.side || prop.pick
  );
  const margin = num(prop.resultMargin ?? prop.margin);
  const clv = num(truth.closingLineValue);
  const gameMargin = num(truth.finalMargin);
  const minutesDelta =
    expectedMinutes != null && actualMinutes != null
      ? actualMinutes - expectedMinutes
      : null;
  const fgaDelta =
    expectedFGA != null && actualFGA != null ? actualFGA - expectedFGA : null;

  if (push) {
    return {
      missType: "PUSH",
      missSubtype: "LINE_LAND",
      calibrationLesson: "Result landed on the line. No projection-volume change required.",
      outcomeClass: "push",
    };
  }

  if (won) {
    // Still classify win drivers for learning.
    if (minutesDelta != null && minutesDelta >= 4) {
      return {
        missType: "OPPORTUNITY_HIT",
        missSubtype: "MINUTES_UP",
        calibrationLesson: `Minutes ran hot (expected ${expectedMinutes}, actual ${actualMinutes}). Volume projection was supported by opportunity.`,
        outcomeClass: "win",
      };
    }
    if (
      expectedMinutes != null &&
      actualMinutes != null &&
      Math.abs(minutesDelta) <= 3 &&
      expectedFGA != null &&
      actualFGA != null &&
      Math.abs(fgaDelta) <= 2
    ) {
      return {
        missType: "EFFICIENCY_HIT",
        missSubtype: "HOT_SHOOTING",
        calibrationLesson:
          "Minutes and attempts matched projection; scoring efficiency finished above expectation.",
        outcomeClass: "win",
      };
    }
    return {
      missType: "CORRECT_SIDE",
      missSubtype: "NORMAL_VARIANCE",
      calibrationLesson: "Selected side cashed. No forced calibration change.",
      outcomeClass: "win",
    };
  }

  if (!lost) {
    return {
      missType: "UNKNOWN",
      missSubtype: "UNGRADED",
      calibrationLesson: "Prop is not fully graded yet.",
      outcomeClass: "pending",
    };
  }

  // --- Losses ---
  if (truth.dnpConfirmed || actualMinutes === 0) {
    return {
      missType: "AVAILABILITY_MISS",
      missSubtype: "DNP",
      calibrationLesson:
        "Player did not play (0 minutes). Strengthen availability / DNP gates before board admission.",
      outcomeClass: "loss",
    };
  }

  if (minutesDelta != null && minutesDelta <= -6 && fgaDelta != null && fgaDelta <= -4) {
    return {
      missType: "OPPORTUNITY_MISS",
      missSubtype: "MINUTES_AND_VOLUME_CUT",
      calibrationLesson: `Expected ${expectedMinutes} minutes / ${expectedFGA} FGA; actual ${actualMinutes}m / ${actualFGA} FGA. Reduce projection trust for unstable-role players when volume depends on recent minute increases.`,
      outcomeClass: "loss",
    };
  }

  if (minutesDelta != null && minutesDelta <= -6) {
    return {
      missType: "OPPORTUNITY_MISS",
      missSubtype: "MINUTES_CUT",
      calibrationLesson: `Expected ${expectedMinutes} minutes, actual ${actualMinutes}. Reduce projection trust for this role-stability profile when lineup certainty is weak.`,
      outcomeClass: "loss",
    };
  }

  if (fgaDelta != null && fgaDelta <= -4 && (minutesDelta == null || minutesDelta > -6)) {
    return {
      missType: "OPPORTUNITY_MISS",
      missSubtype: "ATTEMPTS_DOWN",
      calibrationLesson: `Expected ${expectedFGA} FGA, actual ${actualFGA}. Volume assumption failed despite playable minutes.`,
      outcomeClass: "loss",
    };
  }

  if (
    Math.abs(gameMargin || 0) >= 18 &&
    ((side === "OVER" && actualPoints != null && line != null && actualPoints < line) ||
      (side === "UNDER" && gameMargin <= -18))
  ) {
    return {
      missType: "GAME_SCRIPT_MISS",
      missSubtype: "BLOWOUT",
      calibrationLesson: `Final margin ${gameMargin}. Game script compressed scoring opportunity — review blowout / junk-time handling.`,
      outcomeClass: "loss",
    };
  }

  if (clv != null && clv <= -1.0) {
    return {
      missType: "MARKET_MISS",
      missSubtype: "STEAM_AGAINST_SIDE",
      calibrationLesson: `Closing line moved ${Math.abs(clv)} points against the selected side after lock. Review market disagreement weighting for thin-book props.`,
      outcomeClass: "loss",
    };
  }

  if (
    expectedMinutes != null &&
    actualMinutes != null &&
    Math.abs(minutesDelta) <= 3 &&
    expectedFGA != null &&
    actualFGA != null &&
    Math.abs(fgaDelta) <= 2
  ) {
    return {
      missType: "EFFICIENCY_VARIANCE",
      missSubtype: "COLD_SHOOTING",
      calibrationLesson:
        "Minutes and attempts matched projection, but shooting efficiency fell below normal range. No projection-volume change required.",
      outcomeClass: "loss",
    };
  }

  if (
    projection != null &&
    actualPoints != null &&
    side === "OVER" &&
    projection - line < 2 &&
    actualPoints < line
  ) {
    return {
      missType: "SELECTION_MISS",
      missSubtype: "THIN_EDGE",
      calibrationLesson: `Thin over edge (projection ${projection} vs line ${line}). Raise gap floor or demote similar thin edges.`,
      outcomeClass: "loss",
    };
  }

  if (projection != null && actualPoints != null && Math.abs(actualPoints - projection) >= 6) {
    return {
      missType: "PROJECTION_MISS",
      missSubtype: actualPoints < projection ? "OVER_PROJECTED" : "UNDER_PROJECTED",
      calibrationLesson: `Projection ${projection} vs actual ${actualPoints}. Recalibrate volume/efficiency blend for this profile.`,
      outcomeClass: "loss",
    };
  }

  if (margin != null && Math.abs(margin) <= 1.5) {
    return {
      missType: "CLOSE_VARIANCE",
      missSubtype: "NARROW_MISS",
      calibrationLesson: `Narrow miss (margin ${margin}). Treat as normal variance unless pattern repeats across sample.`,
      outcomeClass: "loss",
    };
  }

  return {
    missType: "PROJECTION_MISS",
    missSubtype: "UNSPECIFIED",
    calibrationLesson:
      "Result missed without a clear minutes/attempts/script/market driver. Review full pregame packet before adjusting weights.",
    outcomeClass: "loss",
  };
}

/**
 * Module attribution — only modules that materially influenced the decision.
 */
export function attributeModules(prop = {}, postgame = null, miss = null) {
  const truth = postgame || buildPostgameTruth(prop);
  const classification = miss || classifyPropMiss(prop, truth);
  const helped = [];
  const hurt = [];
  const neutral = [];

  const won = classification.outcomeClass === "win";
  const lost = classification.outcomeClass === "loss";

  const pregame = prop.pregameSnapshot || {};
  const di = prop.sealedDecisionIntelligence || prop.decisionIntelligence || {};
  const sr = pregame.sideRescue || prop.sealedSideRescue || prop.sideRescue || {};
  const flip =
    pregame.flipFirst ||
    prop.sealedFlipFirst ||
    prop.flipFirstDecision ||
    prop.decisionDataIntelligence?.flipFirstDecision ||
    {};
  const reader = pregame.readerEvidence || prop.sealedWnbaReader || prop.wnbaReader || {};
  const gate = pregame.gate || {};
  const profile = pregame.playerIntelligenceProfile || prop.sealedPlayerProfile || {};

  const side = normalizeSide(pregame.side || prop.lockedSide || prop.side || prop.pick);
  const readerSide = normalizeSide(reader.finalSide || reader.side);
  const flipAction = String(flip.action || prop.flipFirstAction || "").toUpperCase();
  const flipped = Boolean(
    prop.flipFirstFlipped || flipAction.includes("FLIP") || flip.triggered
  );
  const rescueAction = String(sr.action || prop.sideRescueAction || "KEEP").toUpperCase();
  const rescueChanged = rescueAction && !["KEEP", "NONE", "NO_CHANGE", ""].includes(rescueAction);

  const gateWarned = Boolean(
    gate.gateReason ||
      di.gateReason ||
      gate.trackEligibility === "BOARD_ONLY" ||
      reader.thinGap ||
      (Array.isArray(di.demotionReasons) && di.demotionReasons.length)
  );

  const profileInfluenced = Boolean(
    profile &&
      (profile.profileType ||
        profile.type ||
        prop.confidenceAfterProfileCalibration != null ||
        prop.profileAdjustedProjection != null)
  );

  const oppositeWon = wouldSideWin(
    oppositeSide(side),
    truth.lockLine ?? pregame.line ?? prop.line,
    truth.actualPoints
  );
  const selectedWon = wouldSideWin(
    side,
    truth.lockLine ?? pregame.line ?? prop.line,
    truth.actualPoints
  );

  // Reader
  if (readerSide) {
    const readerAligned = readerSide === side;
    if (readerAligned && won) helped.push("READER");
    else if (readerAligned && lost) hurt.push("READER");
    else if (!readerAligned && won) helped.push("READER_OVERRIDE");
    else if (!readerAligned && lost) hurt.push("READER_DISAGREE");
    else neutral.push("READER");
  } else {
    neutral.push("READER");
  }

  // Flip-First — only if it actually evaluated/changed
  if (flipped || flipAction) {
    if (flipped) {
      if (selectedWon === true) helped.push("FLIP_FIRST");
      else if (selectedWon === false && oppositeWon === true) hurt.push("FLIP_FIRST");
      else if (selectedWon === false) hurt.push("FLIP_FIRST");
      else neutral.push("FLIP_FIRST");
    } else {
      // Kept original after flip check
      if (selectedWon === true && oppositeWon === false) helped.push("FLIP_FIRST_KEEP");
      else if (selectedWon === false && oppositeWon === true) hurt.push("FLIP_FIRST_MISSED");
      else neutral.push("FLIP_FIRST");
    }
  } else {
    neutral.push("FLIP_FIRST");
  }

  // Gate
  if (gateWarned) {
    if (lost && (classification.missSubtype === "THIN_EDGE" || reader.thinGap)) {
      helped.push("GATE_THIN_EDGE_WARNING"); // gate was right to warn
    } else if (won) {
      neutral.push("GATE");
    } else {
      neutral.push("GATE");
    }
  } else {
    neutral.push("GATE");
  }

  // Side Rescue
  if (rescueChanged) {
    if (won) helped.push("SIDE_RESCUE");
    else if (lost) hurt.push("SIDE_RESCUE");
    else neutral.push("SIDE_RESCUE");
  } else {
    neutral.push("SIDE_RESCUE");
  }

  // Player profile
  if (profileInfluenced) {
    if (classification.missType === "OPPORTUNITY_MISS" && lost) {
      hurt.push("PLAYER_PROFILE");
    } else if (won) {
      helped.push("PLAYER_PROFILE");
    } else {
      neutral.push("PLAYER_PROFILE");
    }
  } else {
    neutral.push("PLAYER_PROFILE");
  }

  // Projection volume — always material for points props
  if (lost && ["OPPORTUNITY_MISS", "PROJECTION_MISS"].includes(classification.missType)) {
    hurt.push("PROJECTION_VOLUME");
  } else if (won && classification.missType === "OPPORTUNITY_HIT") {
    helped.push("PROJECTION_VOLUME");
  } else {
    neutral.push("PROJECTION_VOLUME");
  }

  // Recent form — only if signal text / DI referenced it
  const formUsed = Boolean(
    (di.simpleExplanation && /form|last\s*5|recent/i.test(String(di.simpleExplanation))) ||
      (prop.lockedSignalSnapshot?.last5Signal &&
        prop.lockedSignalSnapshot.last5Signal !== "not enough data")
  );
  if (formUsed) {
    if (lost) hurt.push("RECENT_FORM_WEIGHT");
    else if (won) helped.push("RECENT_FORM_WEIGHT");
    else neutral.push("RECENT_FORM_WEIGHT");
  } else {
    neutral.push("RECENT_FORM_WEIGHT");
  }

  // Opponent history — only if present
  const ohUsed = Boolean(
    prop.opponentHistory ||
      prop.decisionDataIntelligence?.opponentHistory ||
      prop.sealedDecisionIntelligence?.opponentHistory
  );
  if (ohUsed) {
    if (lost) hurt.push("OPPONENT_HISTORY");
    else if (won) helped.push("OPPONENT_HISTORY");
    else neutral.push("OPPONENT_HISTORY");
  } else {
    neutral.push("OPPONENT_HISTORY");
  }

  // Market
  if (classification.missType === "MARKET_MISS") {
    hurt.push("MARKET_WEIGHT");
  } else if (num(truth.closingLineValue) != null && num(truth.closingLineValue) >= 1 && won) {
    helped.push("MARKET_WEIGHT");
  } else {
    neutral.push("MARKET_WEIGHT");
  }

  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  return {
    modulesHelped: uniq(helped),
    modulesHurt: uniq(hurt),
    modulesNeutral: uniq(neutral),
  };
}

/**
 * Counterfactual learning fields.
 */
export function buildLabCounterfactual(prop = {}, postgame = null) {
  const truth = postgame || buildPostgameTruth(prop);
  const side = normalizeSide(
    prop.pregameSnapshot?.side || prop.lockedSide || prop.side || prop.pick
  );
  const opp = oppositeSide(side);
  const line = num(truth.lockLine ?? prop.pregameSnapshot?.line ?? prop.officialLine ?? prop.line);
  const actual = num(truth.actualPoints);
  const selectedResult = wouldSideWin(side, line, actual);
  const oppositeResult = wouldSideWin(opp, line, actual);
  const flip =
    prop.pregameSnapshot?.flipFirst ||
    prop.sealedFlipFirst ||
    prop.flipFirstDecision ||
    {};
  const flipped = Boolean(
    prop.flipFirstFlipped || String(flip.action || "").toUpperCase().includes("FLIP")
  );
  const rescueAction = String(
    prop.pregameSnapshot?.sideRescue?.action || prop.sideRescue?.action || "KEEP"
  ).toUpperCase();
  const readerSide = normalizeSide(
    prop.pregameSnapshot?.readerEvidence?.finalSide || prop.wnbaReader?.finalSide
  );

  let noPlayPreferable = null;
  if (selectedResult === false) {
    // Loss — if opposite also loses/push, both sides weak / no-play better
    if (oppositeResult === false || oppositeResult == null) noPlayPreferable = true;
    else noPlayPreferable = false; // opposite would have won — side error, not no-play
  } else if (selectedResult === true) {
    noPlayPreferable = false;
  }

  return {
    selectedSide: side,
    oppositeSide: opp,
    selectedSideResult: selectedResult,
    oppositeSideResult: oppositeResult,
    noPlayPreferable,
    flipFirstHelped:
      flipped && selectedResult === true
        ? true
        : flipped && selectedResult === false
          ? false
          : !flipped && selectedResult === false && oppositeResult === true
            ? false // missed flip
            : null,
    sideRescueHelped:
      rescueAction && !["KEEP", "NONE", ""].includes(rescueAction)
        ? selectedResult === true
          ? true
          : selectedResult === false
            ? false
            : null
        : null,
    readerSideBetter:
      readerSide && readerSide !== side
        ? wouldSideWin(readerSide, line, actual) === true && selectedResult === false
        : readerSide === side
          ? selectedResult
          : null,
    finalSideBetterThanReader:
      readerSide && readerSide !== side ? selectedResult === true : null,
  };
}

/**
 * Enrich a graded prop with Lab learning fields. Does not mutate pregameSnapshot.
 */
export function enrichGradedPropForLab(prop = {}) {
  if (!prop || typeof prop !== "object") return prop;
  const status = String(prop.status || "").toLowerCase();
  if (!["win", "loss", "push"].includes(status)) {
    return prop;
  }

  const postgameTruth = buildPostgameTruth(prop);
  const miss = classifyPropMiss(prop, postgameTruth);
  const modules = attributeModules(prop, postgameTruth, miss);
  const labCounterfactual = buildLabCounterfactual(prop, postgameTruth);

  return {
    ...prop,
    postgameTruth,
    actualMinutes: postgameTruth.actualMinutes,
    actualFGA: postgameTruth.actualFGA,
    actualFTA: postgameTruth.actualFTA,
    actualFGPct: postgameTruth.actualFGPct,
    actualTSPct: postgameTruth.actualTSPct,
    teamFinalScore: postgameTruth.teamFinalScore,
    opponentFinalScore: postgameTruth.opponentFinalScore,
    finalMargin: postgameTruth.finalMargin,
    closingLine: postgameTruth.closingLine,
    closingLineValue: postgameTruth.closingLineValue,
    lockLine: postgameTruth.lockLine,
    missType: miss.missType,
    missSubtype: miss.missSubtype,
    calibrationLesson: miss.calibrationLesson,
    modulesHelped: modules.modulesHelped,
    modulesHurt: modules.modulesHurt,
    modulesNeutral: modules.modulesNeutral,
    labCounterfactual,
    labLearningVersion: LAB_LEARNING_VERSION,
  };
}

export function enrichGradedPropsForLab(props = []) {
  return (Array.isArray(props) ? props : []).map(enrichGradedPropForLab);
}
