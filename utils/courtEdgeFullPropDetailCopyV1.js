/**
 * CourtEdge Full Prop Detail Copy V1
 *
 * READ-ONLY formatter for ChatGPT / clipboard export.
 * Uses frozen stored fields only. Never recomputes projection, fair line,
 * probability, Safety, Risk, rank, or explanations.
 *
 * Missing stored fields print as: N/A — not stored
 */

export const FULL_PROP_DETAIL_COPY_BUILD =
  "courteedge-full-prop-detail-copy-v1";

const NA = "N/A — not stored";

function isPresent(value) {
  if (value == null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Number.isNaN(value)) return false;
  return true;
}

function num(value) {
  if (!isPresent(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  if (!isPresent(value)) return NA;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return NA;
    }
  }
  return String(value);
}

function fmtNum(value, digits = 1) {
  const n = num(value);
  if (n == null) return NA;
  return Number(n.toFixed(digits)).toString();
}

function signed(value, digits = 1) {
  const n = num(value);
  if (n == null) return NA;
  const body = Number(n.toFixed(digits)).toString();
  return n > 0 ? `+${body}` : body;
}

/**
 * Probability display: one decimal percent. Never integer-round 0.698 → 70.
 * Accepts 0–1 fractions or 0–100 percents.
 */
export function formatStoredProbability(value) {
  const n = num(value);
  if (n == null) return NA;
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(1)}%`;
}

function firstPresent(...values) {
  for (const v of values) {
    if (isPresent(v)) return v;
  }
  return null;
}

function listOrNa(items) {
  const arr = Array.isArray(items)
    ? items
    : items == null
      ? []
      : [items];
  const cleaned = arr
    .map((item) => {
      if (!isPresent(item)) return null;
      if (typeof item === "string") return item.trim();
      if (typeof item === "object") {
        return (
          item.label ||
          item.code ||
          item.reason ||
          item.text ||
          item.message ||
          null
        );
      }
      return String(item);
    })
    .filter((s) => s && String(s).trim());
  if (!cleaned.length) return [`- ${NA}`];
  return cleaned.map((s) => `- ${s}`);
}

function flattenSafetyComponents(packet = {}) {
  const src =
    packet.safetyComponents ||
    packet.SafetyComponents ||
    packet.safetyBreakdown ||
    packet.environmentSafetyComponents ||
    null;
  if (!src || typeof src !== "object") {
    const singles = [
      ["minutes stability", packet.minutesStability ?? packet.minutesStabilityScore],
      ["role stability", packet.roleStability ?? packet.roleStabilityScore],
      ["availability stability", packet.availabilityStability],
      ["data completeness", packet.dataCompleteness ?? packet.evidenceCoverage],
      ["environment stability", packet.environmentStability],
      ["market stability", packet.marketStability],
    ].filter(([, v]) => isPresent(v));
    if (!singles.length) return NA;
    return singles.map(([k, v]) => `${k}: ${v}`).join("; ");
  }
  const parts = Object.entries(src)
    .filter(([, v]) => isPresent(v) && typeof v !== "object")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join("; ") : NA;
}

function riskCode(packet = {}) {
  const raw = firstPresent(
    typeof packet.risk === "string" ? packet.risk : null,
    packet.risk?.risk,
    packet.risk?.level,
    packet.RiskV2,
    packet.riskV2,
    packet.c2Risk,
    packet.trueRisk,
    packet.v2Risk
  );
  if (!isPresent(raw)) return NA;
  const s = String(raw).toUpperCase();
  if (s.includes("LOW")) return "LOW";
  if (s.includes("MEDIUM") || s.includes("MED")) return "MEDIUM";
  if (s.includes("HIGH")) return "HIGH";
  return String(raw);
}

function riskReasons(packet = {}) {
  return firstPresent(
    packet.riskReasons,
    packet.failureExposures,
    packet.risk?.reasons,
    packet.risk?.failureExposures,
    packet.risk?.exposures,
    packet.engineSignals?.flags
  );
}

function membershipLabel(packet = {}) {
  if (
    packet.trustedMembership === true ||
    packet.officialSelected === true ||
    packet.membership === "OFFICIAL" ||
    packet.homeMembershipSection === "TRUSTED"
  ) {
    return "TRUSTED/OFFICIAL";
  }
  if (
    packet.bestAvailableMembership === true ||
    packet.homeMembershipSection === "BEST_AVAILABLE" ||
    packet.bestAvailableRank != null
  ) {
    return "BEST_AVAILABLE";
  }
  if (packet.fullMembership === true || packet.homeMembershipSection === "FULL") {
    return "FULL";
  }
  const m = String(packet.membership || packet.trackingType || "").toUpperCase();
  if (m === "OFFICIAL") return "TRUSTED/OFFICIAL";
  if (m === "RESEARCH") return "FULL";
  return m || NA;
}

function notTrustedWhy(packet = {}, membership) {
  if (membership === "TRUSTED/OFFICIAL") {
    return (
      firstPresent(
        packet.membershipQualificationStatus,
        packet.officialEligibilityReason,
        packet.trustedEligibilityReason
      ) || "DECISION_ENGINE_V2_RANK"
    );
  }
  return (
    firstPresent(
      packet.membershipQualificationStatus,
      packet.officialEligibilityReason,
      packet.belowQualityReason
    ) || "Not Official/Trusted — remains Full or Best Available"
  );
}

/**
 * Pregame field overlay: frozenPredictionFields wins when present.
 * Does not invent values that were never stored.
 */
function pregamePacket(packet = {}) {
  const frozen = packet.frozenPredictionFields;
  if (!frozen || typeof frozen !== "object") return packet;
  return { ...packet, ...frozen, _frozenOverlayApplied: true };
}

function projectionEdge(packet = {}) {
  const stored = firstPresent(
    packet.projectionEdge,
    packet.projectionGap,
    packet.edge
  );
  if (isPresent(stored)) return num(stored);
  const proj = num(packet.projection);
  const line = num(packet.line ?? packet.sealedLine);
  if (proj == null || line == null) return null;
  return proj - line;
}

function fairEdge(packet = {}) {
  const stored = firstPresent(packet.fairEdge, packet.fairGap);
  if (isPresent(stored)) return num(stored);
  const fair = num(packet.fairLine);
  const line = num(packet.line ?? packet.sealedLine);
  if (fair == null || line == null) return null;
  return fair - line;
}

function statWord(propType) {
  const p = String(propType || "").toUpperCase();
  if (p.includes("REB")) return "REB";
  if (p.includes("AST") || p.includes("ASSIST")) return "AST";
  return "PTS";
}

function resultBlock(packet = {}, propType) {
  const grade = String(
    packet.result?.grade || packet.grade || packet.status || "PENDING"
  ).toUpperCase();
  if (grade === "PENDING" || grade === "UNRESOLVED") {
    return ["RESULT", `Status: ${grade}`];
  }
  const actual = firstPresent(
    packet.result?.actual,
    packet.actual,
    packet.actualStat,
    packet.actualPoints,
    packet.finalPoints
  );
  const line = num(packet.line ?? packet.sealedLine);
  const actualN = num(actual);
  const side = String(packet.side || packet.pick || "").toUpperCase();
  let margin = firstPresent(packet.resultMargin, packet.lineMargin, packet.margin);
  if (margin == null && actualN != null && line != null) {
    margin = actualN - line;
  }
  const proj = num(packet.projection);
  const fair = num(packet.fairLine);
  const projErr = actualN != null && proj != null ? actualN - proj : null;
  const fairErr = actualN != null && fair != null ? actualN - fair : null;
  const actualMinutes = firstPresent(
    packet.actualMinutes,
    packet.result?.actualMinutes,
    packet.result?.minutes
  );
  return [
    "RESULT",
    `${grade}`,
    `Actual: ${isPresent(actual) ? `${actual} ${statWord(propType)}` : NA}`,
    `Actual Points: ${String(propType).toUpperCase().includes("POINT") ? str(actual) : NA}`,
    `Actual Rebounds: ${String(propType).toUpperCase().includes("REB") ? str(actual) : NA}`,
    `Actual Assists: ${
      String(propType).toUpperCase().includes("AST") ||
      String(propType).toUpperCase().includes("ASSIST")
        ? str(actual)
        : NA
    }`,
    `Side: ${side || NA}`,
    `Margin vs line: ${signed(margin, 1)}`,
    `Projection Error (Actual - Projection): ${signed(projErr, 1)}`,
    `Fair Line Error (Actual - Fair): ${signed(fairErr, 1)}`,
    `Actual Minutes: ${str(actualMinutes)}`,
  ];
}

/**
 * One prop → human-readable full detail packet.
 */
export function formatFullPropDetailPacket(raw = {}, index = 1) {
  const packet = pregamePacket(raw);
  const player = firstPresent(packet.player, packet.playerName, raw.player, raw.playerName) || "Unknown";
  const propType = String(
    firstPresent(packet.propType, packet.canonicalPropType, packet.stat, raw.propType) || NA
  ).toUpperCase();
  const side = String(firstPresent(packet.side, packet.pick, raw.side) || NA).toUpperCase();
  const line = firstPresent(packet.line, packet.sealedLine, raw.line);
  const membership = membershipLabel({ ...raw, ...packet });
  const predictedProbability = firstPresent(
    packet.predictedProbability,
    raw.predictedProbability
  );
  const modelWinProbability = firstPresent(
    packet.modelWinProbability,
    raw.modelWinProbability
  );
  const decisionScoreV2 = firstPresent(
    packet.decisionScoreV2,
    raw.decisionScoreV2
  );
  const officialRankScore = firstPresent(
    packet.officialRankScore,
    raw.officialRankScore
  );
  const supports = firstPresent(
    packet.topReasons,
    packet.supportingFactors,
    packet.supports,
    packet.displayWhy,
    packet.decisionExplanation,
    packet.wnbaTrackingReason
  );
  const warnings = firstPresent(
    packet.warnings,
    packet.contradictions,
    packet.displayRiskDebts
  );

  const pOver = firstPresent(packet.pOver, raw.pOver);
  const pUnder = firstPresent(packet.pUnder, raw.pUnder);

  const lines = [
    `[${index}] ${player} — ${propType} ${side} ${isPresent(line) ? line : NA}`,
    "",
    "IDENTITY",
    `Player: ${player}`,
    `League: ${str(firstPresent(packet.league, raw.league, "WNBA"))}`,
    `Team: ${str(firstPresent(packet.team, raw.team))}`,
    `Opponent: ${str(firstPresent(packet.opponent, raw.opponent))}`,
    `Game: ${str(
      firstPresent(
        packet.game,
        raw.game,
        packet.team && packet.opponent
          ? `${packet.team} vs ${packet.opponent}`
          : null
      )
    )}`,
    `Game ID: ${str(firstPresent(packet.gameId, packet.eventId, raw.gameId))}`,
    `Slate date CT: ${str(firstPresent(packet.slateDateCt, packet.slateDate, raw.slateDateCt, raw.gameDate))}`,
    `Scheduled time CT: ${str(firstPresent(packet.scheduledTimeCt, packet.startTimeDisplay, packet.commenceTime, raw.startTimeDisplay))}`,
    `Prop Type: ${propType}`,
    `Side: ${side}`,
    `Line: ${str(line)}`,
    `Membership: ${membership}`,
    `Global rank: ${str(firstPresent(packet.fullRank, packet.globalRank, packet.officialRank, raw.fullRank))}`,
    `Trusted rank: ${
      membership === "TRUSTED/OFFICIAL"
        ? str(firstPresent(packet.officialRank, packet.trustedRank, packet.bestSixRank, index))
        : NA
    }`,
    `Canonical Prop ID: ${str(firstPresent(packet.canonicalPropId, raw.canonicalPropId))}`,
    "",
    "PREDICTION",
    `Projection: ${fmtNum(packet.projection, 1)}`,
    `Fair Line: ${fmtNum(packet.fairLine, 1)}`,
    `Projection Edge: ${signed(projectionEdge(packet), 1)}`,
    `Fair Edge: ${signed(fairEdge(packet), 1)}`,
    `pOver: ${pOver == null ? NA : formatStoredProbability(pOver)}`,
    `pUnder: ${pUnder == null ? NA : formatStoredProbability(pUnder)}`,
    `Predicted Probability: ${formatStoredProbability(predictedProbability)}`,
    `Probability Field: predictedProbability`,
    `Probability Authority: frozen stored predictedProbability (read-only; not live-rescored)`,
    `decisionScoreV2: ${formatStoredProbability(decisionScoreV2)}`,
    `modelWinProbability: ${formatStoredProbability(modelWinProbability)}`,
    `officialRankScore: ${str(officialRankScore)}`,
    `Display confidence (frozen integer, if stored): ${str(firstPresent(packet.confidence, raw.confidence))}`,
    "",
    "TRUST",
    `Safety: ${str(firstPresent(packet.safetyScore, packet.SafetyScore, packet.safety, raw.safetyScore))}`,
    `Safety components: ${flattenSafetyComponents(packet)}`,
    `RiskV2: ${riskCode(packet)}`,
    `Risk reasons / failure exposures:`,
    ...listOrNa(riskReasons(packet)),
    `Signal: ${str(firstPresent(packet.signal, packet.signalLevel, raw.signalLevel))}`,
    `Recommendation Tier: ${str(
      firstPresent(packet.recommendationTier, packet.tier)
    )}`,
    `Official/Trusted eligibility: ${str(notTrustedWhy({ ...raw, ...packet }, membership))}`,
    "",
    "ROLE / DATA",
    `Expected Minutes: ${str(firstPresent(packet.expectedMinutes, packet.minutesModel?.expectedMinutes))}`,
    `Starter / Bench: ${str(firstPresent(packet.starterStatus, packet.roleClassification, packet.role))}`,
    `Role classification: ${str(firstPresent(packet.role, packet.roleClassification))}`,
    `Minutes stability: ${str(firstPresent(packet.minutesStability, packet.roleStability))}`,
    `Recent role changes: ${str(packet.recentRoleChanges)}`,
    `Usage indicators: ${str(firstPresent(packet.usage, packet.usageProxy, packet.usageIndicators))}`,
    `Expected FGA: ${str(packet.expectedFGA)}`,
    `Expected FTA: ${str(packet.expectedFTA)}`,
    `Rebound opportunity: ${str(firstPresent(packet.reboundOpportunity, packet.reboundShare, packet.reboundRate))}`,
    `Teammate rebound competition: ${str(packet.teammateReboundCompetition)}`,
    `Creator role: ${str(packet.creatorRole)}`,
    `Assist rate: ${str(packet.assistRate)}`,
    `Potential assists / touches: ${str(firstPresent(packet.potentialAssists, packet.touches))}`,
    `Creator competition: ${str(packet.creatorCompetition)}`,
    `Season Average: ${str(firstPresent(packet.seasonAverage, packet.seasonAvg))}`,
    `L5 Average: ${str(firstPresent(packet.l5Average, packet.last5Average, packet.L5))}`,
    `L10 Average: ${str(firstPresent(packet.l10Average, packet.last10Average, packet.L10))}`,
    `L5 values: ${str(firstPresent(packet.last5Values, packet.l5Values))}`,
    `L10 values: ${str(firstPresent(packet.last10Values, packet.l10Values))}`,
    `Volatility / recent SD: ${str(firstPresent(packet.recentSd, packet.historicalSd, packet.volatility))}`,
    `Calibration source: ${str(firstPresent(packet.calibrationSource, packet.residualPriorsSource))}`,
    "",
    "MARKET",
    `Book Line: ${str(firstPresent(packet.bookLine, packet.sportsbookLine, packet.sealedLine, packet.line))}`,
    `Consensus Line: ${str(firstPresent(packet.consensusLine, packet.sealedLine, packet.line))}`,
    `Books Supporting: ${str(packet.booksSupporting)}`,
    `Book Count: ${str(firstPresent(packet.bookCount, packet.market?.bookCount))}`,
    `Market Quality: ${str(firstPresent(packet.marketQuality, packet.market?.quality))}`,
    `Open Line: ${str(firstPresent(packet.openingLine, packet.openLine))} (usable: ${str(packet.openingLineUsable)})`,
    `Current/Frozen Line: ${str(firstPresent(packet.currentLine, packet.sealedLine, packet.line))}`,
    `Line movement: ${str(firstPresent(packet.lineMovement, packet.marketHistoryIntegrity === "OK" ? null : packet.marketHistoryIntegrity))}`,
    `Alternate-line information: ${str(packet.alternateLines)}`,
    `Market history integrity: ${str(packet.marketHistoryIntegrity)}`,
    "",
    "GAME ENVIRONMENT",
    `Pregame spread: ${str(firstPresent(packet.spread, packet.pregameSpread))}`,
    `Pregame total: ${str(firstPresent(packet.pregameTotal, packet.gameTotal, packet.total))}`,
    `Pace / pace proxy: ${str(firstPresent(packet.pace, packet.paceProxy))}`,
    `Home/Away: ${str(firstPresent(packet.homeAway, packet.venue))}`,
    `Availability context: ${str(firstPresent(packet.availability, packet.availabilityContext))}`,
    `Teammate injuries/absences (frozen): ${str(firstPresent(packet.teammateAbsences, packet.injuries))}`,
    "",
    "EXPOSURE",
    `playerExposure: ${str(firstPresent(packet.playerExposure, packet.exposureSoftPenalty))}`,
    `teamExposure: ${str(packet.teamExposure)}`,
    `gameExposure: ${str(packet.gameExposure)}`,
    `directionExposure: ${str(packet.directionExposure)}`,
    `correlationClusterId: ${str(firstPresent(packet.correlationClusterId, packet.gameClusterId, packet.gameId))}`,
    `sharedFailureFactors: ${str(packet.sharedFailureFactors)}`,
    `portfolioConcentrationScore: ${str(firstPresent(packet.portfolioConcentrationScore, packet.trustedAdjustedScore))}`,
    "",
    "WHY",
    "Supports:",
    ...listOrNa(supports),
    "Warnings:",
    ...listOrNa(warnings),
    `Decision explanation: ${str(
      firstPresent(
        packet.decisionExplanation,
        packet.displayWhy,
        packet.engineSignals?.finalSide
          ? `stored finalSide=${packet.engineSignals.finalSide}`
          : null
      )
    )}`,
    "",
    "PROVENANCE",
    `Data Completeness: ${str(firstPresent(packet.dataCompleteness, packet.evidenceCoverage, packet.integrity?.evidenceStatus))}`,
    `Provider/source provenance: ${str(firstPresent(packet.provider, packet.provenance, packet.engineSignals?.version?.architectureBuild))}`,
    `Projection Version: ${str(firstPresent(packet.projectionVersion, packet.modelVersions?.projection, packet.modelVersion))}`,
    `Probability Version: ${str(firstPresent(packet.probabilityCalibrationVersion, packet.modelVersions?.probability))}`,
    `Safety Version: ${str(firstPresent(packet.safetyVersion, packet.modelVersions?.safety))}`,
    `Risk Version: ${str(firstPresent(packet.riskVersion, packet.modelVersions?.riskV2))}`,
    `Rank authority/version: ${str(
      firstPresent(
        packet.decisionAuthority,
        packet.engineSignals?.version?.productionFreeze,
        "courteedge-result-driven-decision-engine-v2"
      )
    )}`,
    `Frozen At: ${str(firstPresent(packet.frozenAt, packet.freezeTimestamp, raw.frozenAt))}`,
    `Prediction / market timestamp: ${str(firstPresent(packet.marketTimestamp, packet.pregameTimestamp, packet.providerTimestamp))}`,
    `Integrity: ${str(firstPresent(packet.integrity?.lifecycleStatus, packet.integrity?.reconstructionConfidence))}`,
    `Copy build: ${FULL_PROP_DETAIL_COPY_BUILD}`,
    `Pregame source: ${
      packet._frozenOverlayApplied
        ? "frozenPredictionFields overlay + stored packet"
        : "stored canonical/display packet (no live rescore)"
    }`,
    "",
    ...resultBlock(raw, propType),
    "--------------------------------------------------",
  ];

  return lines.join("\n");
}

export function formatFullPropDetailCopyReport(options = {}) {
  const cards = Array.isArray(options.cards) ? options.cards : [];
  const title =
    options.title ||
    (options.mode ? String(options.mode).replace(/_/g, " ").toUpperCase() : "SLATE");
  const header = [
    "==================================================",
    "COURTEDGE PRODUCT TRUTH — FULL PROP DETAIL",
    "==================================================",
    `Slate: ${options.slateDateCt || options.slateDate || NA} CT`,
    `League: ${options.league || "WNBA"}`,
    `Build: ${options.build || FULL_PROP_DETAIL_COPY_BUILD}`,
    `Cohort: ${title}`,
    `Architecture: ${options.architecture || "Product Truth V1 + Decision Engine V2"}`,
    `Copy mode: ${options.mode || "full-detail"}`,
    `N: ${cards.length}`,
    `Read-only: YES — frozen pregame fields + postgame result only`,
    `Live rescore: NO`,
    "",
  ];
  if (!cards.length) {
    return [...header, "No props in this copy set.", ""].join("\n");
  }
  const body = cards.map((card, i) => formatFullPropDetailPacket(card, i + 1));
  return [...header, ...body, ""].join("\n");
}

export function formatFullPropDetailCopyLine(packet = {}) {
  return formatFullPropDetailPacket(packet, 1);
}
