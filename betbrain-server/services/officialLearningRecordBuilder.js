/**
 * Official Lab learning records — mined from locked/graded Official Slate props.
 * Analysis only: never regenerates membership, projections, or rankings.
 * Pregame snapshot is immutable; postgame learning fields may update on rebuild.
 */
import { buildOfficialPropId } from "./officialSlateService.js";

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
  const slateDate = String(prop.slateDate || "");
  const officialPropId =
    prop.officialPropId || buildOfficialPropId(prop, slateDate);
  const pregame = prop.pregameSnapshot || options.pregameSnapshot || null;

  const side = normalizeSide(
    pregame?.side || prop.lockedSide || prop.side || prop.pick
  );
  const opp = oppositeSide(side);
  const line = num(
    pregame?.line ?? prop.officialLine ?? prop.pickLine ?? prop.line
  );
  const actual = num(prop.actualStat ?? prop.actualPoints ?? prop.finalPoints);
  const projection = num(
    pregame?.projection ??
      prop.projectedPoints ??
      prop.projection ??
      prop.projectedStat ??
      prop.sealedDecisionIntelligence?.projectedPoints
  );
  const fairLine = num(pregame?.fairLine ?? prop.fairLine);
  const confidence = num(
    pregame?.confidence ?? prop.confidence ?? prop.winProbability
  );
  const status = String(prop.status || "").toLowerCase();
  const result = String(prop.result || prop.status || "").toUpperCase();
  const margin = num(prop.resultMargin ?? prop.margin);

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

  const di = pregame?.gate
    ? {
        trackEligibility: pregame.gate.trackEligibility,
        gateReason: pregame.gate.gateReason,
        bestSixPromoted: pregame.gate.bestSixPromoted,
        promotionReasons: pregame.gate.promotionReasons,
        naturalDecision: pregame.naturalDecision,
        trueRisk: pregame.risk,
      }
    : prop.sealedDecisionIntelligence || prop.decisionIntelligence || {};
  const sr = pregame?.sideRescue || prop.sealedSideRescue || prop.sideRescue || {};
  const reader =
    pregame?.readerEvidence || prop.sealedWnbaReader || prop.wnbaReader || {};
  const flip =
    pregame?.flipFirst ||
    prop.sealedFlipFirst ||
    prop.flipFirstDecision ||
    prop.decisionDataIntelligence?.flipFirstDecision ||
    {};
  const profile =
    pregame?.playerIntelligenceProfile ||
    prop.sealedPlayerProfile ||
    prop.playerRoleProfile ||
    prop.playerIntelligence ||
    {};
  const market = pregame?.marketBookData || {};
  const gap = num(
    pregame?.projectionEdge ??
      prop.projectionEdge ??
      prop.edge ??
      reader.overGap ??
      reader.underGap
  );

  // Immutable pregame block — rebuild must deep-equal this when source freeze is stable.
  const pregameSnapshot = {
    line,
    side,
    projection,
    confidence,
    fairLine,
    projectionEdge: gap,
    risk: di.trueRisk || pregame?.risk || prop.trueRisk || prop.riskLabel || null,
    naturalDecision:
      di.naturalDecision ||
      pregame?.naturalDecision ||
      di.originalGateEligibility ||
      di.trackEligibility ||
      null,
    readerEvidence: {
      finalSide: reader.finalSide || null,
      score: reader.score ?? reader.finalScore ?? null,
      overGap: reader.overGap ?? null,
      underGap: reader.underGap ?? null,
      thinGap: reader.thinGap ?? null,
      contradictions: reader.contradictions || prop.contradictions || [],
    },
    flipFirst: flip,
    gate: {
      trackEligibility: di.trackEligibility || prop.trackingEligibility || null,
      gateReason: di.gateReason || prop.wnbaTrackingReason || null,
      bestSixPromoted: Boolean(di.bestSixPromoted),
      promotionReasons: di.promotionReasons || [],
    },
    sideRescue: sr,
    playerIntelligenceProfile: profile,
    marketBookData: {
      bookCount: market.bookCount ?? prop.bookCount ?? prop.marketBookCount ?? null,
      marketQuality: market.marketQuality ?? prop.marketQuality ?? null,
      openingLine: market.openingLine ?? prop.openingLine ?? null,
      consensus: market.consensus ?? prop.consensus ?? null,
    },
    sameTeamOpportunity:
      pregame?.sameTeamOpportunity ||
      prop.sameTeamOpportunity ||
      prop.slateCollision ||
      null,
    buildVersion: pregame?.buildVersion || prop.serverBuild || null,
    engineVersions: pregame?.engineVersions || {
      controlledBestSixVersion: prop.controlledBestSixVersion || null,
      decisionIntelligenceVersion: di.version || null,
      sideRescueVersion: sr.version || null,
      calibrationVersion: prop.calibrationVersion || null,
    },
    sealedAt: pregame?.sealedAt || prop.officialSealedAt || null,
  };

  const missType =
    prop.missType ||
    prop.gradingNotes ||
    options.analysis?.missType ||
    null;

  const signalVerdict = (() => {
    if (chosenWon === true) return "helped";
    if (chosenWon === false) return "hurt";
    return "neutral";
  })();

  // Postgame learning — may update on report rebuild; never mutates pregameSnapshot.
  const postgameLearning = {
    actualPoints: actual,
    result,
    status,
    margin,
    projectionError: projError,
    absoluteError: absError,
    signedError,
    oppositeSideResult: oppositeWon,
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
    missType,
    calibrationLesson:
      prop.calibrationLesson ||
      options.analysis?.calibrationLesson ||
      prop.gradingNotes ||
      null,
    gradedAt: prop.gradedAt || prop.resolvedAt || null,
    analysisUpdatedAt: new Date().toISOString(),
    ...(options.analysis || {}),
  };

  return {
    officialPropId,
    officialSlateId: slateDate,
    immutableOfficial: prop.immutableOfficial === true,
    player: prop.player,
    team: prop.team,
    opponent: prop.opponent,
    league: prop.league,
    stat: prop.stat || "points",
    bestSixRank: prop.bestSixRank || prop.controlledBestSixRank || null,
    isTopPick: Boolean(prop.topPickRank || prop.isTopPickReference),

    /** Frozen at seal — Lab rebuild must not alter these fields. */
    pregameSnapshot,

    /** Grade / learning only — may be enriched after games finish. */
    postgameLearning,

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
      rescueAction: sr.action || prop.sideRescueAction || null,
    },

    reader: {
      confidence: num(reader.confidence ?? reader.readerConfidence),
      score: num(reader.score ?? reader.finalScore),
      evidence: reader.evidence || reader.evidenceSummary || null,
      uncertainty: reader.uncertainty || reader.uncertain || null,
      contradictions: reader.contradictions || prop.contradictions || [],
      thinGap: reader.thinGap ?? null,
      overGap: num(reader.overGap),
      underGap: num(reader.underGap),
    },

    flipFirst: {
      triggered: Boolean(flip.action && String(flip.action).includes("FLIP")),
      action: flip.action || prop.flipFirstAction || null,
      reason: flip.reason || flip.primaryReason || null,
      flipScore: num(flip.score ?? flip.flipScore),
      flipMargin: num(flip.margin ?? flip.flipMargin),
      blockedReason: flip.blockedReason || flip.blockReason || null,
    },

    trackingGate: {
      gateDecision:
        di.trackEligibility ||
        prop.trackingEligibility ||
        prop.wnbaTrackingDecision ||
        null,
      gateReason: di.gateReason || prop.wnbaTrackingReason || null,
      dangerStack: di.dangerGateCount ?? prop.dangerGateCount ?? null,
      warnings: di.warnings || prop.trackingWarnings || [],
      naturalDecision: di.naturalDecision || di.originalGateEligibility || null,
      promotedDecision: di.bestSixPromoted ? "TRACK" : di.trackEligibility || null,
      bestSixPromoted: Boolean(di.bestSixPromoted),
      promotionReasons: di.promotionReasons || prop.bestSixQualityFlags || [],
    },

    decisionIntelligence: {
      risk: di.trueRisk || prop.trueRisk || prop.riskLabel || null,
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
        profile.profileType || profile.type || prop.profileType || null,
      roleStability: num(profile.roleStability ?? profile.roleStabilityScore),
      minutesStability: num(
        profile.minutesStability ??
          prop.minutesStabilityScore ??
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
          prop.openingLine ??
          prop.lineHistory?.[0]?.line
      ),
      closingLine: num(prop.latestLine ?? prop.currentLine ?? line),
      lineMovement: prop.lineMovement || null,
      bookCount: num(pregameSnapshot.marketBookData.bookCount),
      marketQuality: num(pregameSnapshot.marketBookData.marketQuality),
      consensus: pregameSnapshot.marketBookData.consensus || null,
    },

    gameContext: {
      pace: prop.pace ?? prop.wnbaGameContext?.pace ?? null,
      spread: prop.spread ?? prop.wnbaGameContext?.spread ?? null,
      blowoutProbability:
        prop.blowoutProbability ?? prop.wnbaGameContext?.blowoutProbability ?? null,
      injuries: prop.injuries || prop.availabilityNotes || null,
      availability: prop.availability || null,
      opponentStrength: prop.opponentDefense || prop.opponentStrength || null,
      opponentHistory: prop.h2h || prop.opponentHistory || null,
    },

    outcome: {
      status,
      result,
      margin,
      gradedAt: prop.gradedAt || prop.resolvedAt || null,
      won: status === "win" || result === "WIN",
      lost: status === "loss" || result === "LOSS",
      push: status === "push" || result === "PUSH",
    },

    calibration: {
      modulesHelped: [],
      modulesHurt: [],
      strongestEvidence: null,
      failedEvidence: null,
      thresholdsTooAggressive: [],
      thresholdsTooConservative: [],
      notes: missType,
      lesson: postgameLearning.calibrationLesson,
    },

    versions: {
      officialSealVersion: prop.officialSealVersion || null,
      controlledBestSixVersion: prop.controlledBestSixVersion || null,
      serverBuild: prop.serverBuild || null,
      calibrationVersion: prop.calibrationVersion || null,
      buildVersion: pregameSnapshot.buildVersion,
      engineVersions: pregameSnapshot.engineVersions,
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
  return {
    ...report,
    officialLearningRecords: records,
    officialLabDailySummary: summary,
  };
}
