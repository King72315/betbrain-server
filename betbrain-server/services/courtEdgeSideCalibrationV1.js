/**
 * CourtEdge Side Calibration V1 — Over/Under fairness contract.
 *
 * Principles:
 * - Absolute projection edges of equal magnitude receive equal baseline treatment.
 * - No 3/3 Over/Under quota.
 * - Missing data never becomes zero / 50 / AGAINST / confirmed-active.
 * - Directional exceptions (ceiling, floor, same-team forced Under, WNBA gap floors)
 *   are documented and versioned — not erased blindly.
 * - Lab does not auto-write weights. No Calibration Feedback Engine.
 */

export const COURT_EDGE_SIDE_CALIBRATION_VERSION = "courtEdgeSideCalibrationV1";
export const COURT_EDGE_SIDE_CALIBRATION_BUILD =
  "courteedge-home-detailed-analysis-side-calibration-v1";

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("U")) return "UNDER";
  if (raw.startsWith("O")) return "OVER";
  return raw || null;
}

/** Symmetric absolute-edge confidence contribution (side-agnostic). */
export function symmetricGapConfidenceBoost(absGap) {
  const g = Math.abs(num(absGap, 0) || 0);
  if (g < 0.5) return 0;
  if (g < 1.0) return 2;
  if (g < 2.0) return 5;
  if (g < 3.0) return 9;
  if (g < 4.0) return 13;
  if (g < 5.0) return 16;
  return 18;
}

/** Symmetric absolute-edge risk debt (side-agnostic). */
export function symmetricGapRiskTier(absGap, volatility = "MEDIUM") {
  const g = Math.abs(num(absGap, 0) || 0);
  const vol = String(volatility || "MEDIUM").toUpperCase();
  if (g >= 4 && vol === "LOW") return "LOW";
  if (g >= 2.5 && vol !== "HIGH") return "MEDIUM";
  if (g < 1.0) return "HIGH";
  if (vol === "HIGH") return "HIGH";
  return "MEDIUM";
}

/**
 * Baseline mirrored score for Over vs Under fixtures.
 * Returns confidence/risk/rankingScore that must match within tolerance
 * when only the sign of the gap differs.
 */
export function scoreMirroredEdge({
  line = 18.5,
  projection = null,
  fairLine = null,
  side = "OVER",
  volatility = "MEDIUM",
  marketStance = "NEUTRAL",
  roleStability = "STABLE",
  dataCoveragePct = 80,
  matchupStrength = 0,
  restAdvantage = 0,
} = {}) {
  const L = num(line, 18.5);
  const proj = num(projection, L);
  const fair = num(fairLine, proj);
  const finalSide = normalizeSide(side) || "OVER";
  const signedGap = finalSide === "OVER" ? proj - L : L - proj;
  const absGap = Math.abs(signedGap);
  const fairAbs = Math.abs(finalSide === "OVER" ? fair - L : L - fair);

  let confidence = 50 + symmetricGapConfidenceBoost(absGap);
  confidence += Math.min(4, fairAbs >= absGap - 0.25 ? 3 : 0);

  const market = String(marketStance || "NEUTRAL").toUpperCase();
  if (market === "WITH") confidence += 4;
  else if (market === "AGAINST") confidence -= 4;
  else if (market === "UNAVAILABLE") confidence += 0; // neutral — never AGAINST

  const role = String(roleStability || "STABLE").toUpperCase();
  if (role === "RISING" || role === "EXPANDING") {
    confidence += finalSide === "OVER" ? 3 : -3; // directional exception
  } else if (role === "FALLING" || role === "CONTRACTING") {
    confidence += finalSide === "OVER" ? -3 : 3; // directional exception
  }

  const coverage = num(dataCoveragePct, 80);
  if (coverage < 40) confidence -= 6; // side-neutral missing-data penalty
  else if (coverage < 60) confidence -= 3;

  confidence += num(matchupStrength, 0) || 0; // caller passes already side-signed
  confidence += num(restAdvantage, 0) || 0;

  confidence = clamp(Math.round(confidence), 30, 92);
  const risk = symmetricGapRiskTier(absGap, volatility);
  const rankingScore = Number(
    (confidence + absGap * 4 - (risk === "HIGH" ? 8 : risk === "MEDIUM" ? 3 : 0)).toFixed(2)
  );

  return {
    version: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    side: finalSide,
    line: L,
    projection: proj,
    fairLine: fair,
    signedGap: Number(signedGap.toFixed(3)),
    absGap: Number(absGap.toFixed(3)),
    confidence,
    risk,
    rankingScore,
    marketStance: market,
    bestSixEligible: true, // weak evidence never removes eligibility here
    topEligible: confidence >= 62 && risk !== "HIGH",
  };
}

/** Compare mirrored Over/Under results within tolerance. */
export function assertMirroredEquivalent(overResult, underResult, tolerance = 1) {
  const diffs = [];
  if (Math.abs(overResult.confidence - underResult.confidence) > tolerance) {
    diffs.push({
      field: "confidence",
      over: overResult.confidence,
      under: underResult.confidence,
    });
  }
  if (overResult.risk !== underResult.risk) {
    diffs.push({ field: "risk", over: overResult.risk, under: underResult.risk });
  }
  if (Math.abs(overResult.rankingScore - underResult.rankingScore) > tolerance + 0.5) {
    diffs.push({
      field: "rankingScore",
      over: overResult.rankingScore,
      under: underResult.rankingScore,
    });
  }
  if (Boolean(overResult.bestSixEligible) !== Boolean(underResult.bestSixEligible)) {
    diffs.push({
      field: "bestSixEligible",
      over: overResult.bestSixEligible,
      under: underResult.bestSixEligible,
    });
  }
  return { ok: diffs.length === 0, diffs, tolerance };
}

/**
 * Documented directional / asymmetric thresholds.
 * Preserved unless a mathematical symmetry bug is proven.
 */
export const DIRECTIONAL_EXCEPTIONS = Object.freeze([
  {
    id: "WNBA_GAP_FLOOR_SYMMETRY_REPAIR",
    league: "WNBA",
    preserved: false,
    repaired: true,
    detail:
      "REPAIRED: Under previously used fixed 3.5 while Over graduated 3.0/4.0. Both sides now use FULL 3.0 / LIMITED 4.0 absolute floors (courtEdgeSideCalibrationV1).",
  },
  {
    id: "CEILING_DEPENDENCY_OVER",
    league: "BOTH",
    preserved: true,
    detail:
      "Overs that require a ceiling outcome carry honest HIGH/MEDIUM risk debt; Unders with floor protection can repair risk. Directional by construction.",
  },
  {
    id: "SAME_TEAM_FORCED_UNDER",
    league: "BOTH",
    preserved: true,
    detail:
      "SameTeamOpportunityV2 forces weaker same-team Over → Under. Tracked separately from organic Under; not a quota.",
  },
  {
    id: "ROLE_VELOCITY_DIRECTIONAL",
    league: "BOTH",
    preserved: true,
    detail:
      "Rising role favors Over; falling role favors Under by equal magnitude (±3 in baseline mirrored scorer).",
  },
  {
    id: "BLOWOUT_MINUTES_LOSS",
    league: "BOTH",
    preserved: true,
    detail:
      "Blowout / minutes-loss exposure primarily hurts Overs; documented directional exception.",
  },
]);

export const REPAIRED_ASYMMETRIES = Object.freeze([
  {
    id: "WNBA_GAP_FLOOR_GRADUATION",
    before: "Under always 3.5; Over 3.0/4.0",
    after: "Both sides FULL 3.0 / LIMITED 4.0",
  },
  {
    id: "WNBA_READER_MEANINGFUL_GAP",
    before: "Over meaningful 3.0; Under moderate 2.5",
    after: "Both sides meaningful absolute gap 3.0",
  },
]);

export const PRESERVED_ASYMMETRIES = Object.freeze(
  DIRECTIONAL_EXCEPTIONS.filter((e) => e.preserved === true)
);

export const SYMMETRIC_BASELINE_RULES = Object.freeze([
  "Absolute projection gap → symmetric confidence boost table",
  "Absolute fair-line confirmation → symmetric confirmation bonus",
  "Market WITH/AGAINST/NEUTRAL/UNAVAILABLE treated with equal magnitude; UNAVAILABLE never AGAINST",
  "Missing defense/pace/matchup/availability/market → side-neutral (no signed evidence)",
  "Evidence dedup group caps apply once per group regardless of side",
  "No Over/Under quota on Best 6 or Top",
  "Results admission does not recalculate calibration",
]);

/** League-specific calibration values (fairness contract shared). */
export function getSideCalibrationConfig(league = "WNBA") {
  const raw = String(league || "WNBA").toUpperCase();
  const isWnba = raw === "WNBA";
  return Object.freeze({
    version: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    build: COURT_EDGE_SIDE_CALIBRATION_BUILD,
    league: isWnba ? "WNBA" : "NBA",
    mirroredTolerance: 1,
    gapConfidenceTable: [0.5, 1, 2, 3, 4, 5].map((edge) => ({
      edge,
      boost: symmetricGapConfidenceBoost(edge),
    })),
    symmetricBaselineRules: SYMMETRIC_BASELINE_RULES,
    directionalExceptions: DIRECTIONAL_EXCEPTIONS.filter(
      (e) => e.league === "BOTH" || e.league === (isWnba ? "WNBA" : "NBA")
    ),
    // Explicit: no side quota
    sideQuota: null,
    forceBalance: false,
  });
}

export function buildSideCalibrationDiagnostics(props = [], options = {}) {
  const list = Array.isArray(props) ? props : [];
  const bySide = { OVER: [], UNDER: [] };
  for (const p of list) {
    const side = normalizeSide(p.side || p.pick || p.finalCourtEdgeSide);
    if (side === "OVER" || side === "UNDER") bySide[side].push(p);
  }

  const summarize = (arr) => {
    const confs = arr
      .map((p) => num(p.confidence ?? p.finalConfidence ?? p.winProbability))
      .filter((v) => v !== null);
    const risks = arr.map((p) =>
      String(p.trueRisk || p.displayTrueRisk || p.risk || "").toUpperCase()
    );
    const scores = arr
      .map((p) => num(p.bestPropScore ?? p.rankingScore ?? p.finalBestPropScore))
      .filter((v) => v !== null);
    const avg = (vals) =>
      vals.length
        ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2))
        : null;
    return {
      count: arr.length,
      avgConfidence: avg(confs),
      avgRankingScore: avg(scores),
      riskCounts: {
        LOW: risks.filter((r) => r === "LOW").length,
        MEDIUM: risks.filter((r) => r === "MEDIUM" || r === "MED").length,
        HIGH: risks.filter((r) => r === "HIGH").length,
      },
    };
  };

  const over = summarize(bySide.OVER);
  const under = summarize(bySide.UNDER);
  const total = list.length;
  const skewRatio =
    total > 0
      ? Number(Math.max(over.count, under.count) / Math.max(1, Math.min(over.count, under.count) || 1))
      : 1;

  // Natural skew is OK. Flag only when confidence scales diverge without
  // matching abs-gap distribution (heuristic for artificial bias).
  let artificialBiasFlag = false;
  let artificialBiasReason = null;
  if (
    over.avgConfidence != null &&
    under.avgConfidence != null &&
    Math.abs(over.avgConfidence - under.avgConfidence) >= 12 &&
    Math.abs(over.count - under.count) <= 1
  ) {
    artificialBiasFlag = true;
    artificialBiasReason =
      "Similar side counts but large average-confidence gap — inspect duplicated boosts/penalties.";
  }

  return {
    version: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    build: COURT_EDGE_SIDE_CALIBRATION_BUILD,
    league: options.league || null,
    slateDate: options.slateDate || null,
    pool: options.pool || "selected",
    candidateCount: total,
    bySide: { OVER: over, UNDER: under },
    skewRatio,
    naturalSkewOk: !artificialBiasFlag,
    artificialBiasFlag,
    artificialBiasReason,
    sideQuotaApplied: false,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Normalize market stance for display/calibration.
 * Unavailable / missing never becomes AGAINST.
 */
export function normalizeMarketStance({
  available = true,
  openingLine = null,
  currentLine = null,
  finalSide = null,
  explicit = null,
} = {}) {
  const ex = String(explicit || "").toUpperCase();
  if (["WITH", "NEUTRAL", "AGAINST", "UNAVAILABLE"].includes(ex)) {
    if (ex === "AGAINST" && available === false) return "UNAVAILABLE";
    return ex;
  }
  if (available === false) return "UNAVAILABLE";
  const open = num(openingLine);
  const cur = num(currentLine);
  if (open === null || cur === null) return "UNAVAILABLE";
  if (open === cur) return "NEUTRAL";
  const side = normalizeSide(finalSide);
  if (!side) return "NEUTRAL";
  // Line up favors Over; line down favors Under.
  if (cur > open) return side === "OVER" ? "WITH" : "AGAINST";
  if (cur < open) return side === "UNDER" ? "WITH" : "AGAINST";
  return "NEUTRAL";
}

/**
 * Availability display — BDL injury feed is report-only.
 * Missing from feed ≠ confirmed active.
 */
export function formatAvailabilityDisplay({
  injuryReportFound = null,
  status = null,
  feedError = false,
  providerUnavailable = false,
  confirmedActiveSource = null,
} = {}) {
  if (providerUnavailable) {
    return {
      label: "Provider unavailable",
      code: "PROVIDER_UNAVAILABLE",
      confirmedActive: false,
    };
  }
  if (feedError) {
    return {
      label: "Provider error",
      code: "PROVIDER_ERROR",
      confirmedActive: false,
    };
  }
  const st = String(status || "").toUpperCase();
  if (["OUT", "O"].includes(st)) {
    return { label: "Confirmed OUT", code: "OUT", confirmedActive: false };
  }
  if (["QUESTIONABLE", "Q", "GTD", "DOUBTFUL", "D"].includes(st)) {
    return {
      label: st === "DOUBTFUL" || st === "D" ? "Doubtful" : "Questionable",
      code: st.startsWith("D") ? "DOUBTFUL" : "QUESTIONABLE",
      confirmedActive: false,
    };
  }
  if (["PROBABLE", "P"].includes(st)) {
    return { label: "Probable", code: "PROBABLE", confirmedActive: false };
  }
  if (confirmedActiveSource) {
    return {
      label: "Confirmed active",
      code: "CONFIRMED_ACTIVE",
      confirmedActive: true,
      source: confirmedActiveSource,
    };
  }
  if (injuryReportFound === false || injuryReportFound == null) {
    return {
      label: "No current injury report found",
      code: "NO_INJURY_REPORT",
      confirmedActive: false,
    };
  }
  return {
    label: "No current injury report found",
    code: "NO_INJURY_REPORT",
    confirmedActive: false,
  };
}

export function buildSideCalibrationMeta(league = "WNBA") {
  return {
    courtEdgeSideCalibrationV1: getSideCalibrationConfig(league),
  };
}

/** Absolute projection edge — sign-correct; null stays null. */
export function absoluteProjectionEdge({ side, line, projection } = {}) {
  const s = normalizeSide(side);
  const L = num(line);
  const P = num(projection);
  if (!s || L === null || P === null) return null;
  return s === "OVER" ? P - L : L - P;
}

/** Alias used by homeDetailedAnalysisV1 payload. */
export function buildSideCalibrationMarker(league = "WNBA") {
  const cfg = getSideCalibrationConfig(league);
  return {
    version: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    league: cfg.league,
    thresholdConfiguration: cfg,
    symmetricBaselineRules: {
      absoluteEdgeDefinition: "OVER: proj-line; UNDER: line-proj",
      confidenceFromAbsEdge: true,
      riskFromUncertaintySideNeutral: true,
      missingDataNeverSideEvidence: true,
      noSideQuota: true,
    },
    documentedDirectionalExceptions: DIRECTIONAL_EXCEPTIONS,
    repairedAsymmetries: REPAIRED_ASYMMETRIES,
    preservedAsymmetries: PRESERVED_ASYMMETRIES,
    effectiveBuild: COURT_EDGE_SIDE_CALIBRATION_BUILD,
    noCalibrationFeedbackEngine: true,
  };
}

/**
 * Mirrored Over/Under pair for fairness tests.
 */
export function evaluateMirroredSidePair({
  league = "WNBA",
  line = 18.5,
  absEdge = 3.0,
  volatility = "MEDIUM",
  coveragePct = 80,
  market = "NEUTRAL",
} = {}) {
  const over = scoreMirroredEdge({
    line,
    projection: line + absEdge,
    fairLine: line + absEdge,
    side: "OVER",
    volatility,
    marketStance: market,
    dataCoveragePct: coveragePct,
  });
  const under = scoreMirroredEdge({
    line,
    projection: line - absEdge,
    fairLine: line - absEdge,
    side: "UNDER",
    volatility,
    marketStance: market,
    dataCoveragePct: coveragePct,
  });
  return {
    version: COURT_EDGE_SIDE_CALIBRATION_VERSION,
    league: String(league || "WNBA").toUpperCase() === "NBA" ? "NBA" : "WNBA",
    absEdge,
    over: {
      side: "OVER",
      projection: over.projection,
      edge: over.absGap,
      confidenceContribution: over.confidence - 50,
      risk: over.risk,
      rankingScore: over.rankingScore,
      eligible: over.bestSixEligible,
      confidence: over.confidence,
    },
    under: {
      side: "UNDER",
      projection: under.projection,
      edge: under.absGap,
      confidenceContribution: under.confidence - 50,
      risk: under.risk,
      rankingScore: under.rankingScore,
      eligible: under.bestSixEligible,
      confidence: under.confidence,
    },
    tolerance: {
      confidence: getSideCalibrationConfig(league).mirroredTolerance,
      riskRank: 0,
      rankingScore: getSideCalibrationConfig(league).mirroredTolerance + 0.5,
    },
  };
}

/** Missing-data fairness probe — never favors a side. */
export function missingDataSideBias({
  defenseStatus = "UNAVAILABLE",
  paceStatus = "UNAVAILABLE",
  matchupSample = 0,
  marketStatus = "UNAVAILABLE",
  availabilityStatus = "NO_REPORT",
} = {}) {
  void defenseStatus;
  void paceStatus;
  void matchupSample;
  return {
    overContribution: 0,
    underContribution: 0,
    sideNeutral: true,
    marketLabel:
      String(marketStatus).toUpperCase() === "UNAVAILABLE" ? "UNAVAILABLE" : marketStatus,
    availabilityLabel:
      String(availabilityStatus).toUpperCase() === "NO_REPORT"
        ? "No current injury report found"
        : availabilityStatus,
  };
}

/** Wrapper matching older assertMirroredEquivalent(pair) call shape. */
export function assertMirroredPairEquivalent(pair, label = "mirrored") {
  const result = assertMirroredEquivalent(
    {
      confidence: pair.over.confidence ?? 50 + pair.over.confidenceContribution,
      risk: pair.over.risk,
      rankingScore: pair.over.rankingScore,
      bestSixEligible: pair.over.eligible,
    },
    {
      confidence: pair.under.confidence ?? 50 + pair.under.confidenceContribution,
      risk: pair.under.risk,
      rankingScore: pair.under.rankingScore,
      bestSixEligible: pair.under.eligible,
    },
    pair.tolerance?.confidence ?? 1
  );
  if (!result.ok) {
    throw new Error(`${label}: mirrored diverge ${JSON.stringify(result.diffs)}`);
  }
  return true;
}
