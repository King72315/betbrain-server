/**
 * WNBA Results Quality Gate — filters weak props from Results tracking cohort.
 * NBA path must not use this module (returns TRACK passthrough).
 */
export const QUALITY_GATE_VERSION = "wnba-results-quality-gate-v1";
export const WNBA_LIMITED_UNDER_GAP_FLOOR = 3.0;

const READER_BLOCK_DECISIONS = new Set(["NO_BET", "AVOID", "PASS"]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function isLowLineContext(line = 0) {
  return num(line) <= 8.5;
}

export function isWnbaQualityGatePick(pick = {}) {
  if (String(pick.league || "").toUpperCase() !== "WNBA") return false;
  return Boolean(pick.wnbaDataCard || pick.wnbaReader);
}

export function resolveQualityGateInputs(pick = {}, dataCard = null, reader = null) {
  const card = dataCard || pick.wnbaDataCard || {};
  const rd = reader || pick.wnbaReader || {};
  const side = normalizeSide(pick.side || pick.pick || rd.finalSide);
  const line = num(pick.line ?? pick.sportsbookLine ?? card.bookLine ?? card.currentLine);
  const projection = num(
    pick.projection ?? card.projection?.projection ?? pick.expectedPoints
  );
  const projectionGap = side === "OVER" ? projection - line : line - projection;
  const dataMode = String(pick.dataMode || card.dataMode || "").toUpperCase();
  const minutes = num(
    pick.recentMinutes ?? card.last5?.minutes ?? pick.minutesAverage
  );
  const fga = num(pick.recentFGA ?? card.last5?.fga ?? pick.fgaAverage);
  const bookCount = num(pick.bookCount ?? card.bookCount);
  const marketQuality = num(pick.marketQuality ?? card.marketQuality);
  const dataConfidence = num(
    pick.evidenceReliability != null
      ? pick.evidenceReliability * 100
      : pick.dataCoverage ?? card.dataConfidenceScore
  );
  const fairLine = pick.fairLine ?? card.fairLine ?? {};
  const fairLineEdge = num(pick.fairLineEdge ?? fairLine.fairLineEdge);
  const fairLineQuality = num(pick.fairLineQuality ?? fairLine.fairLineQuality);
  const fairLineSide = normalizeSide(pick.fairLineSide ?? fairLine.fairLineSide);
  const underGap = num(
    rd.underGap ?? pick.underGap ?? (side === "UNDER" ? projectionGap : 0)
  );
  const roleTrend = String(
    pick.roleTrend ?? card.roleTrend ?? pick.roleChange?.trend ?? "stable"
  ).toLowerCase();
  const volatility = String(
    pick.minutesVolatility ??
      card.minutesVolatility ??
      pick.volumeProfile?.minutesVolatility ??
      "stable"
  ).toLowerCase();
  const opportunityScore = num(pick.opportunityScore ?? card.opportunityScore);
  const readerDecision = String(
    pick.readerDecision ?? rd.decision ?? pick.trackingType ?? ""
  ).toUpperCase();
  const readerConfidence = num(pick.readerConfidence ?? rd.readerConfidence);
  const netEdge = num(
    pick.netEdge ??
      (rd.margin != null
        ? rd.margin
        : Math.abs(num(rd.overCase?.score) - num(rd.underCase?.score)))
  );
  const recent = num(card.last5?.points ?? pick.last5Average);
  const ptsPerFGA = num(card.last5?.ptsPerFGA);
  const seasonPtsPerFGA = num(card.season?.ptsPerFGA);
  const availability = card.injuryAvailability || pick.availabilityGate || {};
  const availabilityDataMissing =
    pick.availabilityDataMissing === true ||
    availability.dataMissing === true ||
    (availability.level === "UNKNOWN" && !availability.status);
  const defenseProxyUsed =
    pick.defenseProxyUsed === true ||
    card.opponentDefense?.proxyUsed === true ||
    String(card.opponentDefense?.label || "").toLowerCase() === "neutral";
  const missingFlags = (card.dataMissingFlags || pick.dataMissingFlags || []).filter(
    (f) => f?.missing
  );

  return {
    side,
    line,
    projection,
    projectionGap,
    dataMode,
    minutes,
    fga,
    bookCount,
    marketQuality,
    dataConfidence,
    fairLineEdge,
    fairLineQuality,
    fairLineSide,
    underGap,
    roleTrend,
    volatility,
    opportunityScore,
    readerDecision,
    readerConfidence,
    netEdge,
    recent,
    ptsPerFGA,
    seasonPtsPerFGA,
    availabilityDataMissing,
    defenseProxyUsed,
    missingFlags,
    card,
    reader: rd,
  };
}

function isStrongFairDisagree(metrics = {}, side = "") {
  const fairSide = metrics.fairLineSide;
  if (!fairSide || fairSide === "NONE") return false;
  if (fairSide === side) return false;
  return (
    Math.abs(metrics.fairLineEdge) >= 3 && metrics.fairLineQuality >= 50
  );
}

function isEfficiencyOnlySpike(metrics = {}, side = "") {
  if (side !== "OVER") return false;
  const hotShooting =
    metrics.ptsPerFGA > 0 &&
    metrics.seasonPtsPerFGA > 0 &&
    metrics.ptsPerFGA >= metrics.seasonPtsPerFGA + 0.15 &&
    metrics.fga < 9;
  return hotShooting && metrics.recent >= metrics.line;
}

function isLowVolumeOverTrap(metrics = {}, side = "") {
  if (side !== "OVER") return false;
  if (metrics.fga > 0 && metrics.fga < 7 && metrics.minutes < 20) return true;
  if (isLowLineContext(metrics.line) && metrics.minutes > 0 && metrics.minutes < 18) {
    return true;
  }
  if (metrics.fga > 0 && metrics.fga < 7 && metrics.projectionGap < 2.5) return true;
  return false;
}

function countMissingDataStack(metrics = {}) {
  let count = 0;
  if (metrics.dataMode === "WNBA_LIMITED_DATA") count += 1;
  if (metrics.availabilityDataMissing) count += 1;
  if (metrics.defenseProxyUsed) count += 1;
  if (metrics.missingFlags.length >= 2) count += 1;
  if (metrics.bookCount <= 1) count += 1;
  if (metrics.volatility === "volatile" || metrics.volatility === "unstable") count += 1;
  if (!metrics.card?.playerId && !metrics.reader?.playerId) count += 1;
  return count;
}

function hasExceptionalUnderSupport(metrics = {}, reader = {}) {
  const chosen = reader.underCase || {};
  const fairAgrees =
    metrics.fairLineSide === "UNDER" && Math.abs(metrics.fairLineEdge) >= 2;
  return (
    num(chosen.score) >= 10 &&
    metrics.netEdge >= 5 &&
    metrics.dataConfidence >= 55 &&
    (fairAgrees || metrics.underGap >= WNBA_LIMITED_UNDER_GAP_FLOOR + 0.5)
  );
}

function computeQualityGateScore(blockReasons = [], warnings = [], metrics = {}) {
  let score = 72;
  score -= blockReasons.length * 18;
  score -= warnings.length * 6;
  score += clamp(metrics.netEdge * 2, 0, 12);
  score += clamp((metrics.dataConfidence - 50) / 4, -8, 10);
  score += metrics.bookCount >= 4 ? 4 : metrics.bookCount <= 1 ? -4 : 0;
  if (metrics.fairLineSide === metrics.side && metrics.fairLineQuality >= 50) {
    score += 5;
  }
  return clamp(Math.round(score), 0, 100);
}

export function evaluateWnbaTrackingEligibility(
  pick = {},
  dataCard = null,
  reader = null
) {
  if (!isWnbaQualityGatePick(pick)) {
    return {
      trackingEligibility: "TRACK",
      trackingBlockReasons: [],
      trackingWarnings: [],
      qualityGateScore: 100,
      qualityGateVersion: QUALITY_GATE_VERSION,
      skipped: true,
      reason: "nba_or_non_wnba_passthrough",
    };
  }

  const metrics = resolveQualityGateInputs(pick, dataCard, reader);
  const blockReasons = [];
  const warnings = [];
  const side = metrics.side;
  const readerDecision = metrics.readerDecision;
  const trackingDecision = String(
    pick.trackingType || pick.recordType || pick.finalDecision || ""
  ).toUpperCase();

  if (trackingDecision === "NO_BET" || pick.noPlay === true) {
    blockReasons.push("NO_BET");
  }
  if (pick.isStarted) {
    blockReasons.push("STARTED_GAME");
  }
  if (!pick.player || !pick.team || !pick.opponent || !side || metrics.line <= 0) {
    blockReasons.push("MISSING_REQUIRED_FIELDS");
  }
  if (READER_BLOCK_DECISIONS.has(readerDecision)) {
    blockReasons.push(`READER_${readerDecision}`);
  }

  const strongFairDisagree = isStrongFairDisagree(metrics, side);
  if (strongFairDisagree) {
    blockReasons.push("FAIR_LINE_STRONG_DISAGREE");
  }

  if (
    metrics.dataMode === "WNBA_LIMITED_DATA" &&
    side === "UNDER" &&
    metrics.underGap < WNBA_LIMITED_UNDER_GAP_FLOOR &&
    !hasExceptionalUnderSupport(metrics, metrics.reader)
  ) {
    blockReasons.push("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR");
  }

  if (isLowVolumeOverTrap(metrics, side)) {
    blockReasons.push("LOW_VOLUME_OVER_TRAP");
  }

  if (isEfficiencyOnlySpike(metrics, side)) {
    blockReasons.push("EFFICIENCY_ONLY_SCORING_SPIKE");
  }

  if (
    side === "OVER" &&
    (metrics.roleTrend === "down" || metrics.volatility === "volatile") &&
    metrics.projectionGap < 3 &&
    metrics.netEdge < 6
  ) {
    blockReasons.push("ROLE_MINUTES_INSTABILITY_NO_CUSHION");
  }

  if (
    metrics.bookCount === 1 &&
    metrics.marketQuality > 0 &&
    metrics.netEdge < 5 &&
    metrics.projectionGap < 3
  ) {
    blockReasons.push("ONE_BOOK_WEAK_EDGE");
  }

  const missingStack = countMissingDataStack(metrics);
  if (missingStack >= 4 && metrics.projectionGap < 3.5 && metrics.netEdge < 7) {
    blockReasons.push("MISSING_DATA_STACK_THIN_EDGE");
  }

  if (metrics.fairLineSide === side && metrics.fairLineQuality >= 50) {
    warnings.push("FAIR_LINE_AGREEMENT");
  } else if (
    metrics.fairLineSide &&
    metrics.fairLineSide !== side &&
    metrics.fairLineQuality >= 40
  ) {
    warnings.push("FAIR_LINE_MILD_DISAGREE");
  }

  if (metrics.bookCount <= 2 && metrics.marketQuality > 0 && metrics.marketQuality < 55) {
    warnings.push("THIN_MARKET");
  }
  if (
    (metrics.volatility === "volatile" || metrics.roleTrend === "down") &&
    metrics.bookCount <= 2
  ) {
    warnings.push("THIN_MARKET_VOLATILE_ROLE");
  }
  if (metrics.dataConfidence < 55) {
    warnings.push("LOW_DATA_CONFIDENCE");
  }
  if (metrics.opportunityScore > 0 && metrics.opportunityScore < 45) {
    warnings.push("WEAK_OPPORTUNITY_SCORE");
  }
  if (missingStack >= 2 && missingStack < 4) {
    warnings.push("PARTIAL_MISSING_DATA_STACK");
  }

  let trackingEligibility = "TRACK";

  if (blockReasons.length > 0) {
    trackingEligibility = "NO_BET";
  } else   if (
    readerDecision === "TEST" &&
    pick.readerOfficialDemoted !== true &&
    (pick.wnbaReader || pick.readerConfidence != null) &&
    (metrics.readerConfidence < 45 || warnings.length >= 3 || metrics.netEdge < 5)
  ) {
    trackingEligibility = "BOARD_ONLY";
    warnings.push("READER_UNCERTAIN_TEST_STRICT");
  } else if (warnings.length >= 4) {
    trackingEligibility = "SHADOW_ONLY";
  } else if (warnings.length >= 2 && metrics.netEdge < 6) {
    trackingEligibility = "BOARD_ONLY";
  }

  const qualityGateScore = computeQualityGateScore(
    blockReasons,
    warnings,
    metrics
  );

  if (
    trackingEligibility === "TRACK" &&
    readerDecision === "TEST" &&
    pick.readerOfficialDemoted !== true &&
    qualityGateScore < 50
  ) {
    trackingEligibility = "BOARD_ONLY";
    warnings.push("READER_UNCERTAIN_LOW_GATE_SCORE");
  }

  return {
    trackingEligibility,
    trackingBlockReasons: blockReasons,
    trackingWarnings: warnings,
    qualityGateScore,
    qualityGateVersion: QUALITY_GATE_VERSION,
    keyMetrics: {
      projectionGap: Number(metrics.projectionGap.toFixed(2)),
      fairLineEdge: metrics.fairLineEdge,
      bookCount: metrics.bookCount,
      marketQuality: metrics.marketQuality,
      dataConfidence: metrics.dataConfidence,
      minutes: metrics.minutes,
      FGA: metrics.fga,
      roleTrend: metrics.roleTrend,
      volatility: metrics.volatility,
      availabilityDataMissing: metrics.availabilityDataMissing,
      defenseProxyUsed: metrics.defenseProxyUsed,
      underGap: metrics.underGap,
      netEdge: metrics.netEdge,
      readerDecision,
      readerConfidence: metrics.readerConfidence,
    },
  };
}

export function applyQualityGateToPick(pick = {}, gate = {}) {
  return {
    ...pick,
    trackingEligibility: gate.trackingEligibility,
    trackingBlockReasons: gate.trackingBlockReasons || [],
    trackingWarnings: gate.trackingWarnings || [],
    qualityGateScore: gate.qualityGateScore,
    qualityGateVersion: gate.qualityGateVersion,
    qualityGateKeyMetrics: gate.keyMetrics || null,
  };
}

export function buildCandidateQualityAuditEntry(pick = {}, gate = {}, extra = {}) {
  const metrics = gate.keyMetrics || resolveQualityGateInputs(pick).keyMetrics;
  return {
    player: pick.player || "",
    league: pick.league || "WNBA",
    team: pick.team || "",
    opponent: pick.opponent || "",
    side: normalizeSide(pick.side || pick.pick),
    line: pick.line,
    readerDecision:
      pick.readerDecision || pick.wnbaReader?.decision || pick.trackingType || "",
    trackingEligibility: gate.trackingEligibility,
    tracked: extra.tracked === true,
    qualityGateScore: gate.qualityGateScore,
    blockReasons: gate.trackingBlockReasons || [],
    warnings: gate.trackingWarnings || [],
    keyMetrics: gate.keyMetrics || metrics,
    ...extra,
  };
}

export function buildTrackingQualityAudit(candidates = [], cohort = [], options = {}) {
  const bySlate = {};
  const bump = (map, key, field, amount = 1) => {
    if (!map[key]) {
      map[key] = {
        slateDate: key,
        generatedCandidates: 0,
        passedQualityGate: 0,
        trackedProps: 0,
        boardOnlyProps: 0,
        shadowOnlyProps: 0,
        noBetProps: 0,
        blockedProps: 0,
        blockReasons: {},
        warningReasons: {},
        officialCount: 0,
        readerOfficialDemotedCount: 0,
        readerUncertainTestCount: 0,
        candidates: [],
      };
    }
    map[key][field] = Number(map[key][field] || 0) + amount;
  };

  const trackedKeys = new Set(
    (options.tracked || cohort).map(
      (p) => p.trackedKey || `${p.player}|${p.line}|${p.side}`
    )
  );

  for (const rawPick of candidates) {
    const pick = rawPick;
    const slateDate =
      pick.slateDate ||
      options.getSlateDate?.(pick) ||
      String(pick.gameDate || "unknown");
    bump(bySlate, slateDate, "generatedCandidates");

    const gate = evaluateWnbaTrackingEligibility(pick);
    const entry = buildCandidateQualityAuditEntry(pick, gate, {
      slateDate,
      tracked: gate.trackingEligibility === "TRACK",
    });

  if (gate.trackingEligibility === "TRACK") {
      bump(bySlate, slateDate, "passedQualityGate");
      const decision = String(pick.trackingType || pick.recordType || "").toUpperCase();
      if (decision === "OFFICIAL") bump(bySlate, slateDate, "officialCount");
      if (decision === "TEST" && pick.readerOfficialDemoted) {
        bump(bySlate, slateDate, "readerOfficialDemotedCount");
      }
      if (decision === "TEST" && !pick.readerOfficialDemoted) {
        bump(bySlate, slateDate, "readerUncertainTestCount");
      }
    } else if (gate.trackingEligibility === "BOARD_ONLY") {
      bump(bySlate, slateDate, "boardOnlyProps");
    } else if (gate.trackingEligibility === "SHADOW_ONLY") {
      bump(bySlate, slateDate, "shadowOnlyProps");
    } else {
      bump(bySlate, slateDate, "noBetProps");
      bump(bySlate, slateDate, "blockedProps");
    }

    for (const reason of gate.trackingBlockReasons || []) {
      const slate = bySlate[slateDate];
      slate.blockReasons[reason] = Number(slate.blockReasons[reason] || 0) + 1;
    }
    for (const warning of gate.trackingWarnings || []) {
      const slate = bySlate[slateDate];
      slate.warningReasons[warning] = Number(slate.warningReasons[warning] || 0) + 1;
    }

    bySlate[slateDate].candidates.push(entry);
  }

  for (const prop of cohort) {
    const slateDate = prop.slateDate || "unknown";
    bump(bySlate, slateDate, "trackedProps");
    const key = prop.trackedKey || `${prop.player}|${prop.line}|${prop.side}`;
    if (trackedKeys.has(key)) {
      const slate = bySlate[slateDate];
      const match = slate?.candidates?.find(
        (c) => c.player === prop.player && String(c.line) === String(prop.line)
      );
      if (match) match.tracked = true;
    }
  }

  return {
    qualityGateVersion: QUALITY_GATE_VERSION,
    topPropsReferenceOnly: true,
    topPropsDidNotControlTracking: true,
    bySlate: Object.values(bySlate).sort((a, b) =>
      String(a.slateDate).localeCompare(String(b.slateDate))
    ),
  };
}

export function buildQualityGatePerformanceFromProps(slateProps = []) {
  const wnba = slateProps.filter((p) => String(p.league).toUpperCase() === "WNBA");
  const tracked = wnba.filter((p) => p.trackingEligibility === "TRACK" || !p.trackingEligibility);
  const boardOnly = wnba.filter((p) => p.trackingEligibility === "BOARD_ONLY");
  const shadowOnly = wnba.filter((p) => p.trackingEligibility === "SHADOW_ONLY");
  const blocked = wnba.filter((p) => p.trackingEligibility === "NO_BET");

  const blockReasons = {};
  const warningReasons = {};
  for (const prop of wnba) {
    for (const reason of prop.trackingBlockReasons || []) {
      blockReasons[reason] = Number(blockReasons[reason] || 0) + 1;
    }
    for (const warning of prop.trackingWarnings || []) {
      warningReasons[warning] = Number(warningReasons[warning] || 0) + 1;
    }
  }

  const avgScore =
    tracked.length > 0
      ? Math.round(
          tracked.reduce((sum, p) => sum + num(p.qualityGateScore, 0), 0) /
            tracked.length
        )
      : null;

  return {
    title: "WNBA Results Quality Gate Performance",
    qualityGateVersion: QUALITY_GATE_VERSION,
    wnbaTrackedCount: tracked.length,
    boardOnlyCount: boardOnly.length,
    shadowOnlyCount: shadowOnly.length,
    blockedCount: blocked.length,
    avgQualityGateScore: avgScore,
    blockReasons,
    warningReasons,
    trackedRecord: null,
  };
}
