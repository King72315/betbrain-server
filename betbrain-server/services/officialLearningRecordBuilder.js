/**
 * Official Lab learning records — mined from locked/graded Official Slate props.
 * Analysis only: never regenerates membership, projections, or rankings.
 * Pregame snapshot is immutable; postgame learning fields may update on rebuild.
 */
import { buildOfficialPropId } from "./officialSlateService.js";
import { buildCompletePregameSnapshot } from "./pregameSnapshotBuilder.js";
import { buildLabAggregateBreakdown } from "./labAggregateBreakdown.js";
import {
  enrichGradedPropForLab,
  buildPostgameTruth,
  LAB_LEARNING_VERSION,
} from "./labLearningEnrichmentService.js";

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

function gapBucket(gap) {
  const g = Math.abs(num(gap, 0) || 0);
  if (g < 1.5) return "0-1.4";
  if (g < 2.5) return "1.5-2.4";
  if (g < 4) return "2.5-3.9";
  return "4+";
}

function wouldSideWin(side, line, actual) {
  const s = normalizeSide(side);
  const l = num(line);
  const a = num(actual);
  if (!s || l == null || a == null) return null;
  if (s === "OVER") {
    if (a > l) return true;
    if (a < l) return false;
    return null; // push
  }
  if (s === "UNDER") {
    if (a < l) return true;
    if (a > l) return false;
    return null;
  }
  return null;
}

/**
 * Build a complete per-prop learning record for Lab.
 * Pregame snapshot is immutable; postgame learning fields may update on rebuild.
 * Uses sealed snapshots when present; never invents new engine outputs.
 */
export function buildOfficialLearningRecord(prop = {}, options = {}) {
  const enriched =
    ["win", "loss", "push"].includes(String(prop.status || "").toLowerCase())
      ? enrichGradedPropForLab(prop)
      : prop;
  const slateDate = String(enriched.slateDate || "");
  const officialPropId =
    enriched.officialPropId || buildOfficialPropId(enriched, slateDate);
  const pregameRaw = enriched.pregameSnapshot || options.pregameSnapshot || null;
  const pregameSnapshot = pregameRaw?.sealedAt
    ? pregameRaw
    : buildCompletePregameSnapshot(enriched, { slateDate });
  const truth = buildPostgameTruth(enriched);

  const side = normalizeSide(
    pregameSnapshot.side || enriched.lockedSide || enriched.side || enriched.pick
  );
  const opp = oppositeSide(side);
  const line = num(
    pregameSnapshot.line ?? enriched.officialLine ?? enriched.pickLine ?? enriched.line
  );
  const actual = num(
    truth.actualPoints ?? enriched.actualStat ?? enriched.actualPoints ?? enriched.finalPoints
  );
  const projection = num(
    pregameSnapshot.projection ??
      enriched.projectedPoints ??
      enriched.projection ??
      enriched.projectedStat ??
      enriched.sealedDecisionIntelligence?.projectedPoints
  );
  const fairLine = num(pregameSnapshot.fairLine ?? enriched.fairLine);
  const confidence = num(
    pregameSnapshot.confidence ?? enriched.confidence ?? enriched.winProbability
  );
  const status = String(enriched.status || "").toLowerCase();
  const result = String(enriched.result || enriched.status || "").toUpperCase();
  const margin = num(enriched.resultMargin ?? enriched.margin);

  const projError =
    projection != null && actual != null ? actual - projection : null;
  const absError = projError == null ? null : Math.abs(projError);
  const signedError = projError;

  const chosenWon = wouldSideWin(side, line, actual);
  const oppositeWon = wouldSideWin(opp, line, actual);
  const flipBeneficial =
    chosenWon === false && oppositeWon === true
      ? true
      : chosenWon === true && oppositeWon === false
        ? false
        : null;

  const di = {
    ...(pregameSnapshot.decisionIntelligence || {}),
    ...(enriched.sealedDecisionIntelligence || enriched.decisionIntelligence || {}),
    trackEligibility:
      pregameSnapshot.gate?.trackEligibility ||
      enriched.trackingEligibility ||
      null,
    gateReason: pregameSnapshot.gate?.gateReason || enriched.wnbaTrackingReason || null,
    trueRisk: pregameSnapshot.risk || enriched.trueRisk || enriched.riskLabel || null,
  };
  const sr = pregameSnapshot.sideRescue || enriched.sealedSideRescue || enriched.sideRescue || {};
  const reader =
    pregameSnapshot.readerEvidence || enriched.sealedWnbaReader || enriched.wnbaReader || {};
  const flip =
    pregameSnapshot.flipFirst?.raw ||
    pregameSnapshot.flipFirst ||
    enriched.sealedFlipFirst ||
    enriched.flipFirstDecision ||
    enriched.decisionDataIntelligence?.flipFirstDecision ||
    {};
  const profile =
    pregameSnapshot.playerIntelligenceProfile ||
    enriched.sealedPlayerProfile ||
    enriched.playerRoleProfile ||
    enriched.playerIntelligence ||
    {};
  const market = pregameSnapshot.marketBookData || {};
  const gap = num(
    pregameSnapshot.projectionGap ??
      pregameSnapshot.projectionEdge ??
      enriched.projectionEdge ??
      enriched.edge ??
      reader.overGap ??
      reader.underGap
  );

  // pregameSnapshot is immutable when sealed — do not rebuild inline fields.

  const missType = enriched.missType || options.analysis?.missType || null;
  const missSubtype = enriched.missSubtype || options.analysis?.missSubtype || null;

  const signalVerdict = (() => {
    if (chosenWon === true) return "helped";
    if (chosenWon === false) return "hurt";
    return "neutral";
  })();

  // Postgame learning — may update on report rebuild; never mutates pregameSnapshot.
  const postgameLearning = {
    ...truth,
    result,
    status,
    margin,
    projectionError: projError,
    absoluteError: absError,
    signedError,
    oppositeSideResult: oppositeWon,
    missType,
    missSubtype,
    calibrationLesson:
      enriched.calibrationLesson ||
      options.analysis?.calibrationLesson ||
      enriched.gradingNotes ||
      null,
    modulesHelped: enriched.modulesHelped || [],
    modulesHurt: enriched.modulesHurt || [],
    modulesNeutral: enriched.modulesNeutral || [],
    counterfactual: enriched.labCounterfactual || null,
    flip: {
      beneficial: flipBeneficial === true,
      harmful: flipBeneficial === false,
      missed: flipBeneficial === true,
      verdict:
        flipBeneficial === true
          ? "beneficial"
          : flipBeneficial === false
            ? "harmful"
            : "neutral",
    },
    signal: {
      helped: signalVerdict === "helped",
      hurt: signalVerdict === "hurt",
      neutral: signalVerdict === "neutral",
      verdict: signalVerdict,
    },
    gradedAt: enriched.gradedAt || enriched.resolvedAt || null,
    analysisUpdatedAt: new Date().toISOString(),
    labLearningVersion: LAB_LEARNING_VERSION,
    ...(options.analysis || {}),
  };

  return {
    officialPropId,
    officialSlateId: slateDate,
    immutableOfficial: enriched.immutableOfficial === true,
    player: enriched.player,
    team: enriched.team,
    opponent: enriched.opponent,
    league: enriched.league,
    stat: enriched.stat || "points",
    bestSixRank: enriched.bestSixRank || enriched.controlledBestSixRank || null,
    isTopPick: Boolean(enriched.topPickRank || enriched.isTopPickReference),

    /** Frozen at seal — Lab rebuild must not alter these fields. */
    pregameSnapshot,

    /** Grade / learning only — may be enriched after games finish. */
    postgameLearning,

    // Compact primary packet for Lab UI — full four-layer learning unit.
    learningPacket: {
      officialPropId,
      player: enriched.player,
      team: enriched.team,
      opponent: enriched.opponent,
      pregame: pregameSnapshot,
      postgame: {
        ...postgameLearning,
        measuredFields: truth.measuredFields || null,
      },
      diagnosis: {
        missType: postgameLearning.missType,
        missSubtype: postgameLearning.missSubtype,
        calibrationLesson: postgameLearning.calibrationLesson,
        modulesHelped: postgameLearning.modulesHelped,
        modulesHurt: postgameLearning.modulesHurt,
        modulesNeutral: postgameLearning.modulesNeutral,
        chosenSideCorrect: chosenWon,
        oppositeSideWouldWin: oppositeWon,
        counterfactual: postgameLearning.counterfactual,
        flipFirstEffect: postgameLearning.flip?.verdict || null,
        sideRescueEffect: postgameLearning.counterfactual?.sideRescueHelped,
        shouldHaveAvoided: postgameLearning.counterfactual?.noPlayPreferable === true,
        primaryFailureDomain: postgameLearning.missType,
      },
    },

    // Legacy flat shapes for existing Lab UI consumers (sourced from freeze + grade).
    projection: {
      projection: pregameSnapshot.projection,
      actual,
      fairLine: pregameSnapshot.fairLine,
      projectionError: projError,
      absoluteError: absError,
      signedError,
      projectionDirection: side,
      projectionStrength: confidence,
      gap,
      gapBucket: gapBucket(gap),
    },

    sideAnalysis: {
      chosenSide: side,
      oppositeSide: opp,
      wouldOppositeWin: oppositeWon,
      flipBeneficial,
      flipHarmful:
        flipBeneficial === false ? true : flipBeneficial === true ? false : null,
      flipMissed: flipBeneficial === true,
      readerSide: normalizeSide(reader.finalSide || reader.side),
      finalSide: side,
      rescueSide: normalizeSide(sr.finalSide || sr.side),
      rescueAction: sr.action || enriched.sideRescueAction || null,
    },

    reader: {
      confidence: num(reader.confidence ?? reader.readerConfidence),
      score: num(reader.score ?? reader.finalScore),
      evidence: reader.evidence || reader.evidenceSummary || null,
      uncertainty: reader.uncertainty || reader.uncertain || null,
      contradictions: reader.contradictions || enriched.contradictions || [],
      thinGap: reader.thinGap ?? null,
      overGap: num(reader.overGap),
      underGap: num(reader.underGap),
    },

    flipFirst: {
      triggered: Boolean(flip.action && String(flip.action).includes("FLIP")),
      action: flip.action || enriched.flipFirstAction || null,
      reason: flip.reason || flip.primaryReason || null,
      flipScore: num(flip.score ?? flip.flipScore),
      flipMargin: num(flip.margin ?? flip.flipMargin),
      blockedReason: flip.blockedReason || flip.blockReason || null,
    },

    trackingGate: {
      gateDecision:
        di.trackEligibility ||
        enriched.trackingEligibility ||
        enriched.wnbaTrackingDecision ||
        null,
      gateReason: di.gateReason || enriched.wnbaTrackingReason || null,
      dangerStack: di.dangerGateCount ?? enriched.dangerGateCount ?? null,
      warnings: di.warnings || enriched.trackingWarnings || [],
      naturalDecision: di.naturalDecision || di.originalGateEligibility || null,
      promotedDecision: di.bestSixPromoted ? "TRACK" : di.trackEligibility || null,
      bestSixPromoted: Boolean(di.bestSixPromoted),
      promotionReasons: di.promotionReasons || enriched.bestSixQualityFlags || [],
    },

    decisionIntelligence: {
      risk: di.trueRisk || enriched.trueRisk || enriched.riskLabel || null,
      riskDebts: di.riskDebts || [],
      riskRepairs: di.riskRepairs || [],
      debtCategories: (di.riskDebts || [])
        .map((d) => d.code || d.label || d)
        .filter(Boolean),
      repairCategories: (di.riskRepairs || [])
        .map((r) => r.code || r.label || r)
        .filter(Boolean),
      confidenceAdjustments: di.confidenceAdjustments || null,
      simpleExplanation: di.simpleExplanation || null,
    },

    playerIntelligence: {
      profileType:
        profile.profileType || profile.type || enriched.profileType || null,
      roleStability: num(profile.roleStability ?? profile.roleStabilityScore),
      minutesStability: num(
        profile.minutesStability ??
          enriched.minutesStabilityScore ??
          di.minutesStabilityScore
      ),
      usageStability: num(profile.usageStability ?? profile.volumeStability),
      fgaStability: num(profile.fgaStability),
      ftaStability: num(profile.ftaStability),
      scoringVariance: num(profile.scoringVariance ?? profile.volatility),
      roleTrend: profile.roleTrend || null,
      playerVolatility: num(profile.playerVolatility ?? profile.volatility),
      profileConfidence: num(profile.profileConfidence ?? profile.confidence),
    },

    market: {
      openingLine: num(
        pregameSnapshot.marketBookData.openingLine ??
          enriched.openingLine ??
          enriched.lineHistory?.[0]?.line
      ),
      closingLine: num(truth.closingLine ?? enriched.latestLine ?? enriched.currentLine ?? line),
      closingLineValue: truth.closingLineValue,
      lineMovement: enriched.lineMovement || null,
      bookCount: num(pregameSnapshot.marketBookData.bookCount),
      marketQuality: num(pregameSnapshot.marketBookData.marketQuality),
      consensus: pregameSnapshot.marketBookData.consensus || null,
    },

    gameContext: {
      pace: enriched.pace ?? enriched.wnbaGameContext?.pace ?? null,
      spread: enriched.spread ?? enriched.wnbaGameContext?.spread ?? null,
      blowoutProbability:
        enriched.blowoutProbability ?? enriched.wnbaGameContext?.blowoutProbability ?? null,
      injuries: enriched.injuries || enriched.availabilityNotes || null,
      availability: enriched.availability || null,
      opponentStrength: enriched.opponentDefense || enriched.opponentStrength || null,
      opponentHistory: enriched.h2h || enriched.opponentHistory || null,
      teamFinalScore: truth.teamFinalScore,
      opponentFinalScore: truth.opponentFinalScore,
      finalMargin: truth.finalMargin,
    },

    outcome: {
      status,
      result,
      margin,
      gradedAt: enriched.gradedAt || enriched.resolvedAt || null,
      won: status === "win" || result === "WIN",
      lost: status === "loss" || result === "LOSS",
      push: status === "push" || result === "PUSH",
    },

    calibration: {
      modulesHelped: postgameLearning.modulesHelped,
      modulesHurt: postgameLearning.modulesHurt,
      modulesNeutral: postgameLearning.modulesNeutral,
      strongestEvidence: postgameLearning.modulesHelped[0] || null,
      failedEvidence: postgameLearning.modulesHurt[0] || null,
      thresholdsTooAggressive: [],
      thresholdsTooConservative: [],
      notes: missType,
      missSubtype,
      lesson: postgameLearning.calibrationLesson,
    },

    versions: {
      officialSealVersion: enriched.officialSealVersion || null,
      controlledBestSixVersion: enriched.controlledBestSixVersion || null,
      serverBuild: enriched.serverBuild || null,
      calibrationVersion: enriched.calibrationVersion || null,
      buildVersion: pregameSnapshot.buildVersion,
      engineVersions: pregameSnapshot.engineVersions,
      labLearningVersion: LAB_LEARNING_VERSION,
    },
  };
}

export function buildOfficialLearningRecords(props = []) {
  return (Array.isArray(props) ? props : []).map(buildOfficialLearningRecord);
}

function emptySignalStats() {
  return {
    wins: 0,
    losses: 0,
    pushes: 0,
    sampleSize: 0,
    decided: 0,
    accuracy: null,
    averageError: null,
    medianError: null,
    errors: [],
  };
}

function bumpSignal(map, key, record) {
  if (!key) return;
  if (!map[key]) map[key] = emptySignalStats();
  const row = map[key];
  row.sampleSize += 1;
  if (record.outcome?.won) row.wins += 1;
  else if (record.outcome?.lost) row.losses += 1;
  else if (record.outcome?.push) row.pushes += 1;
  row.decided = row.wins + row.losses;
  row.accuracy =
    row.decided > 0
      ? Number(((row.wins / row.decided) * 100).toFixed(1))
      : null;
  if (record.projection?.absoluteError != null) {
    row.errors.push(record.projection.absoluteError);
    const sorted = [...row.errors].sort((a, b) => a - b);
    row.averageError = Number(
      (row.errors.reduce((a, b) => a + b, 0) / row.errors.length).toFixed(3)
    );
    row.medianError = sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * Aggregate Lab daily summary across Official learning records.
 */
export function buildOfficialLabDailySummary(records = [], options = {}) {
  const list = Array.isArray(records) ? records : [];
  const bySide = {};
  const byRisk = {};
  const byGap = {};
  const byProfile = {};
  const byBookCount = {};
  const byGate = {};
  const byRescue = {};
  const byFlip = {};
  const byReader = { hits: emptySignalStats() };

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let topPickWins = 0;
  let topPickLosses = 0;

  for (const rec of list) {
    if (rec.outcome?.won) wins += 1;
    else if (rec.outcome?.lost) losses += 1;
    else if (rec.outcome?.push) pushes += 1;

    if (rec.isTopPick) {
      if (rec.outcome?.won) topPickWins += 1;
      if (rec.outcome?.lost) topPickLosses += 1;
    }

    bumpSignal(bySide, rec.sideAnalysis?.chosenSide, rec);
    bumpSignal(byRisk, rec.decisionIntelligence?.risk, rec);
    bumpSignal(byGap, rec.projection?.gapBucket, rec);
    bumpSignal(byProfile, rec.playerIntelligence?.profileType, rec);
    bumpSignal(
      byBookCount,
      rec.market?.bookCount != null ? String(rec.market.bookCount) : null,
      rec
    );
    bumpSignal(byGate, rec.trackingGate?.gateDecision, rec);
    bumpSignal(byRescue, rec.sideAnalysis?.rescueAction, rec);
    bumpSignal(
      byFlip,
      rec.flipFirst?.action || (rec.flipFirst?.triggered ? "FLIP" : "NO_FLIP"),
      rec
    );
    bumpSignal(byReader, "reader", rec);
  }

  const decided = wins + losses;
  return {
    slateDate: options.slateDate || null,
    overallRecord: {
      wins,
      losses,
      pushes,
      decided,
      winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null,
      sampleSize: list.length,
    },
    overRecord: bySide.OVER || emptySignalStats(),
    underRecord: bySide.UNDER || emptySignalStats(),
    riskBuckets: byRisk,
    topPicks: {
      wins: topPickWins,
      losses: topPickLosses,
      decided: topPickWins + topPickLosses,
      winRate:
        topPickWins + topPickLosses > 0
          ? Number(
              ((topPickWins / (topPickWins + topPickLosses)) * 100).toFixed(1)
            )
          : null,
    },
    readerPerformance: byReader.reader || emptySignalStats(),
    flipPerformance: byFlip,
    rescuePerformance: byRescue,
    gatePerformance: byGate,
    playerProfilePerformance: byProfile,
    projectionGapPerformance: byGap,
    bookCountPerformance: byBookCount,
    learningRecordCount: list.length,
    version: "official-lab-learning-v1",
  };
}

export function attachOfficialLearningToReport(report = {}, props = []) {
  const records = buildOfficialLearningRecords(props);
  const summary = buildOfficialLabDailySummary(records, {
    slateDate: report.slateDate,
  });

  // Module attribution rollup — only from modules that actually influenced decisions.
  const moduleStats = {};
  for (const rec of records) {
    const outcome = rec.outcome || {};
    for (const mod of rec.calibration?.modulesHelped || []) {
      if (!moduleStats[mod]) moduleStats[mod] = { helped: 0, hurt: 0, neutral: 0, wins: 0, losses: 0 };
      moduleStats[mod].helped += 1;
      if (outcome.won) moduleStats[mod].wins += 1;
      if (outcome.lost) moduleStats[mod].losses += 1;
    }
    for (const mod of rec.calibration?.modulesHurt || []) {
      if (!moduleStats[mod]) moduleStats[mod] = { helped: 0, hurt: 0, neutral: 0, wins: 0, losses: 0 };
      moduleStats[mod].hurt += 1;
      if (outcome.won) moduleStats[mod].wins += 1;
      if (outcome.lost) moduleStats[mod].losses += 1;
    }
    for (const mod of rec.calibration?.modulesNeutral || []) {
      if (!moduleStats[mod]) moduleStats[mod] = { helped: 0, hurt: 0, neutral: 0, wins: 0, losses: 0 };
      moduleStats[mod].neutral += 1;
    }
  }

  const missTypeCounts = {};
  for (const rec of records) {
    const key = rec.postgameLearning?.missType || "UNKNOWN";
    missTypeCounts[key] = (missTypeCounts[key] || 0) + 1;
  }

  const aggregateBreakdown = buildLabAggregateBreakdown(records);

  return {
    ...report,
    officialLearningRecords: records,
    officialLabDailySummary: {
      ...summary,
      moduleAttribution: moduleStats,
      missTypeCounts,
      aggregateBreakdown,
      labLearningVersion: LAB_LEARNING_VERSION,
    },
    labAggregateBreakdown: aggregateBreakdown,
    learningPackets: records.map((r) => ({
      officialPropId: r.officialPropId,
      player: r.player,
      ...r.learningPacket,
    })),
  };
}
