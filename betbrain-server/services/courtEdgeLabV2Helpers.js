/**
 * CourtEdge Lab V2 helpers — sealed prop extraction, records, engine scorecards.
 * Missing values stay null/unavailable; never fabricate 0/50/neutral wins.
 */

import {
  LAB_V2_ENGINE_KEYS,
  LAB_V2_ENGINE_LABELS,
  LAB_V2_ENGINE_KINDS,
  CONFIDENCE_BUCKETS,
  INSTRUMENTED_LEARNING_MIN_PROPS,
  LAB_EVIDENCE_SCHEMA_V1,
  LAB_DECISION_PACKET_V1,
} from "./courtEdgeLabV2Constants.js";
import { readMeasuredValue } from "./labMeasuredFields.js";
import {
  measuredMetric,
  unavailableMetric,
  asMetricAvailability,
  readMetricValue,
  deltaMetricAvailability,
  buildCompatibleDeltaMetric,
} from "./labMetricAvailability.js";

export function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(value) {
  return num(value, null);
}

export function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function avg(values = []) {
  const nums = (values || []).map((v) => num(v, null)).filter((n) => n !== null);
  if (!nums.length) return null;
  return Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(3));
}

export function round(value, digits = 1) {
  const n = num(value, null);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return null;
}

export function normalizeLeague(league = "") {
  const raw = String(league || "").toUpperCase();
  if (raw.includes("WNBA")) return "WNBA";
  if (raw.includes("NBA")) return "NBA";
  return raw || null;
}

export function normalizeRisk(risk = "") {
  const label = String(risk || "").toUpperCase();
  if (label.includes("LOW")) return "LOW";
  if (label.includes("MEDIUM") || label.includes("MED")) return "MEDIUM";
  if (label.includes("HIGH")) return "HIGH";
  return null;
}

export function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

export function statusOf(prop = {}) {
  return String(prop.status || prop.result || "").toLowerCase();
}

export function isOfficialBestSixProp(prop = {}) {
  // Immutable official seal wins over trackingType mislabels (e.g. TEST + immutableOfficial).
  // Never drop a sealed official Best 6 prop from Lab because of a stale TEST tag.
  if (prop.immutableOfficial === true) return true;
  if (prop.excludedFromOfficialRecord === true) return false;
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return true;
  if (explicit === "TEST" || explicit === "NO_BET") return false;
  if (prop.controlledBestSixDisplayTracked === true) return true;
  if (prop.controlledBestSixDisplay === true) return true;
  if (prop.bestSixRank != null && Number(prop.bestSixRank) > 0) return true;
  if (prop.controlledBestSixRank != null && Number(prop.controlledBestSixRank) > 0) {
    return true;
  }
  const tier = String(prop.tier || "").toUpperCase();
  if (tier === "LEAN" || tier === "WATCHLIST") return false;
  if (tier === "PREMIUM" || tier === "OFFICIAL") return true;
  if (prop.officialEligible === true) return true;
  return Boolean(prop.officialPropId);
}

/** Alias */
export const isOfficialProp = isOfficialBestSixProp;

export function extractPregameSnapshot(prop = {}) {
  return (
    prop.pregameSnapshot ||
    prop.canonicalSealedProp?.pregameSnapshot ||
    prop.sealedProp?.pregameSnapshot ||
    null
  );
}

export function extractEngineSignals(prop = {}) {
  const raw =
    prop.courtEdgeEngineSignalsV1 ||
    prop.engineSignals ||
    prop.pregameSnapshot?.courtEdgeEngineSignalsV1 ||
    prop.canonicalSealedProp?.courtEdgeEngineSignalsV1 ||
    null;

  if (!raw) {
    return {
      available: false,
      unavailableReason: "expansion_unavailable_legacy_record",
      enabled: false,
      engines: {},
      aggregation: null,
      evidenceDeduplication: null,
    };
  }

  const engines = { ...(raw.engines || {}) };

  // Ensure all 11 scoreboard keys exist; evidenceDeduplication is top-level.
  if (!engines.evidenceDeduplication && raw.evidenceDeduplication) {
    engines.evidenceDeduplication = raw.evidenceDeduplication;
  }
  // Aliases
  if (!engines.distribution && (raw.distributionProfile || engines.distributionProfile)) {
    engines.distribution = raw.distributionProfile || engines.distributionProfile;
  }
  if (!engines.volatility && (raw.volatilityProfile || engines.volatilityProfile)) {
    engines.volatility = raw.volatilityProfile || engines.volatilityProfile;
  }
  if (!engines.lineMovementClv && (raw.lineMovement || engines.lineMovement)) {
    engines.lineMovementClv = raw.lineMovement || engines.lineMovement;
  }

  for (const key of LAB_V2_ENGINE_KEYS) {
    if (!engines[key]) {
      engines[key] = {
        available: false,
        unavailableReason: raw.enabled
          ? "signal_missing"
          : "expansion_unavailable_legacy_record",
        quality: "UNAVAILABLE",
      };
    }
  }

  return {
    available: raw.enabled === true,
    unavailableReason: raw.enabled === true ? null : raw.reason || "expansion_disabled",
    enabled: raw.enabled === true,
    version: raw.version || null,
    schemaBuild: raw.schemaBuild || null,
    engines,
    aggregation: raw.aggregation || null,
    evidenceDeduplication: raw.evidenceDeduplication || null,
    ownership: raw.ownership || null,
  };
}

export function extractDecisionPacket(prop = {}) {
  return (
    prop.courtEdgeDecisionPacketV1 ||
    prop.courtEdgeDecisionPacket ||
    prop.pregameSnapshot?.courtEdgeDecisionPacketV1 ||
    prop.canonicalSealedProp?.courtEdgeDecisionPacketV1 ||
    null
  );
}

/**
 * Sealed expansion instrumentation — never invent signals from postgame/live Board.
 * Missing sealed courtEdgeEngineSignalsV1 → uninstrumented / UNAVAILABLE.
 */
export function hasSealedEngineSignals(prop = {}) {
  const signals = extractEngineSignals(prop);
  return signals.available === true && signals.enabled === true;
}

export function hasSealedDecisionPacket(prop = {}) {
  const packet = extractDecisionPacket(prop);
  if (!packet || typeof packet !== "object") return false;
  return (
    packet.finalConfidence != null ||
    packet.trueRisk != null ||
    packet.confidence != null ||
    Boolean(packet.version || packet.schemaBuild)
  );
}

/**
 * Canonical conf/risk owner matches analysis integrity:
 * courtEdgeDecisionPacketV1.finalConfidence|trueRisk (sealed) — not live recalcs.
 */
export function resolveSealedConfidenceRisk(prop = {}) {
  const packet = extractDecisionPacket(prop) || {};
  const freeze = packet.layers?.freeze || {};
  const pregame = extractPregameSnapshot(prop);
  const confidence = num(
    first(
      freeze.finalConfidence,
      freeze.confidence,
      packet.finalConfidence,
      packet.confidence,
      prop.finalConfidence,
      prop.confidence,
      pregame?.confidence
    ),
    null
  );
  const risk = normalizeRisk(
    first(
      freeze.trueRisk,
      freeze.risk,
      packet.trueRisk,
      packet.finalRisk,
      prop.displayTrueRisk,
      prop.trueRisk,
      prop.riskLabel,
      pregame?.risk
    )
  );
  const fromPacket =
    packet.finalConfidence != null ||
    packet.trueRisk != null ||
    packet.finalRisk != null ||
    freeze.finalConfidence != null ||
    freeze.trueRisk != null;
  return {
    confidence,
    risk,
    source: fromPacket
      ? "courtEdgeDecisionPacketV1"
      : confidence != null || risk != null
        ? "prop_fallback_unsealed"
        : "unavailable",
    packetPresent: hasSealedDecisionPacket(prop),
  };
}

export function classifyPropInstrumentation(prop = {}) {
  const signals = extractEngineSignals(prop);
  const packet = extractDecisionPacket(prop);
  const instrumented = hasSealedEngineSignals(prop);
  const coverage =
    signals?.aggregation?.evidenceCoverage != null
      ? num(signals.aggregation.evidenceCoverage, null)
      : instrumented
        ? 100
        : 0;
  return {
    instrumented,
    legacy: !instrumented,
    uninstrumented: !instrumented,
    evidenceCoverage: coverage,
    signalsAvailable: instrumented,
    packetAvailable: hasSealedDecisionPacket(prop),
    unavailableReason: instrumented
      ? null
      : signals.unavailableReason || "expansion_unavailable_legacy_record",
    evidenceSchema: signals.version || (instrumented ? LAB_EVIDENCE_SCHEMA_V1 : null),
    decisionPacketVersion:
      packet?.version || (packet ? LAB_DECISION_PACKET_V1 : null),
    schemaBuild: packet?.schemaBuild || signals?.schemaBuild || null,
    serverBuild: prop.serverBuild || prop.buildVersion || null,
  };
}

/**
 * Slate-level instrumentation for Lab / three-slate eligibility.
 *
 * - Six-prop learning block: official propCount >= 6 (thin 3-prop like Jul 16 stays historical/legacy).
 * - Engine scoreboards: only sealed courtEdgeEngineSignalsV1 (never invent from postgame).
 */
export function classifySlateInstrumentation(props = []) {
  const list = (props || []).filter(isOfficialBestSixProp);
  const total = list.length;
  const instrumentedProps = list.filter(hasSealedEngineSignals);
  const instrumentedCount = instrumentedProps.length;
  const evidenceCoverage =
    total > 0 ? round((instrumentedCount / total) * 100, 1) : null;
  const fullyInstrumented = total > 0 && instrumentedCount === total;
  const sixProp = total >= INSTRUMENTED_LEARNING_MIN_PROPS;
  const uninstrumented = total === 0 || instrumentedCount === 0;
  const legacy = !fullyInstrumented;
  const thinOfficial = total > 0 && total < INSTRUMENTED_LEARNING_MIN_PROPS;
  // New active three-slate learning membership: sealed six-prop official size.
  // Engine directional/calibration metrics still require sealed expansion signals.
  const eligibleForSixPropLearningBlock = sixProp;
  const eligibleForInstrumentedLearning = fullyInstrumented && sixProp;
  return {
    propCount: total,
    instrumentedCount,
    evidenceCoverage,
    instrumented: fullyInstrumented,
    legacy,
    uninstrumented,
    sixProp,
    thinOfficial,
    eligibleForSixPropLearningBlock,
    eligibleForInstrumentedLearning,
    flags: {
      legacy,
      uninstrumented,
      instrumented: fullyInstrumented,
      sixProp,
      thinOfficial,
    },
    note: fullyInstrumented
      ? sixProp
        ? "sealed_instrumented_six_prop"
        : "sealed_instrumented_thin_official"
      : thinOfficial
        ? "legacy_thin_official_not_six_prop"
        : uninstrumented
          ? "legacy_uninstrumented_no_sealed_engine_signals"
          : "partial_instrumentation_treated_as_legacy",
  };
}

export function filterInstrumentedRecords(records = []) {
  return (records || []).filter(
    (r) => r?.signals?.available === true || r?.instrumentation?.instrumented === true
  );
}

function emptyEngineCard(key) {
  return {
    engine: key,
    engineId: key,
    engineName: LAB_V2_ENGINE_LABELS[key],
    label: LAB_V2_ENGINE_LABELS[key],
    kind: LAB_V2_ENGINE_KINDS[key],
    availableCount: 0,
    unavailableCount: 0,
    instrumentedEligibleCount: 0,
    uninstrumentedExcludedCount: 0,
    coveragePct: null,
    coverage: unavailableMetric("NO_ELIGIBLE_EVIDENCE"),
    directionalOpportunities: 0,
    directionalCorrect: 0,
    directionalIncorrect: 0,
    directionalAccuracy: null,
    directionalAccuracyMetric: unavailableMetric("NO_ELIGIBLE_EVIDENCE"),
    helped: 0,
    hurt: 0,
    neutral: 0,
    averageContribution: null,
    averageConfidenceAdjustment: null,
    averageRiskAdjustment: null,
    avgMarginWhenAligned: null,
    avgMarginWhenOpposed: null,
    calibrationHelped: 0,
    calibrationHurt: 0,
    calibrationNeutral: 0,
    suppressedVisible: 0,
    sampleSize: 0,
    noEligibleEvidence: true,
  };
}

/**
 * Directional attribution (positional API used by courtEdgeLabV2.js).
 * Unavailable / zero contribution → neutral (not a directional loss).
 */
export function attributeDirectional(signal, finalSide, won, lost) {
  if (!signal || signal.available !== true) {
    return { attribution: "neutral", kind: "neutral", reason: "unavailable" };
  }
  const over = num(signal.overContribution, 0) || 0;
  const under = num(signal.underContribution, 0) || 0;
  const net = over - under || num(signal.normalizedSignal, 0) || 0;
  if (Math.abs(net) < 1e-9) {
    return { attribution: "neutral", kind: "neutral", reason: "zero_contribution" };
  }
  const signalSide = net > 0 ? "OVER" : "UNDER";
  const side = normalizeSide(finalSide);
  if (!side || (won !== true && lost !== true)) {
    return { attribution: "neutral", kind: "neutral", reason: "unresolved" };
  }
  const aligned = signalSide === side;
  if (aligned && won) {
    return { attribution: "helped", kind: "helped", reason: "aligned_win", supported: signalSide, aligned: true };
  }
  if (aligned && lost) {
    return { attribution: "hurt", kind: "hurt", reason: "aligned_loss", supported: signalSide, aligned: true };
  }
  if (!aligned && won) {
    return { attribution: "hurt", kind: "hurt", reason: "opposed_win", supported: signalSide, aligned: false };
  }
  if (!aligned && lost) {
    return { attribution: "helped", kind: "helped", reason: "opposed_loss", supported: signalSide, aligned: false };
  }
  return { attribution: "neutral", kind: "neutral", reason: "unresolved" };
}

export function attributeCalibration(signal, won, lost, margin = null) {
  const pack = (kind, reason) => ({
    kind,
    attribution: kind,
    reason,
    calibration: true,
    margin: margin ?? null,
  });
  if (!signal || signal.available !== true) {
    return pack("neutral", "unavailable");
  }
  if (won !== true && lost !== true) {
    return pack("neutral", "unresolved");
  }
  const confAdj = num(signal.confidenceAdjustment, 0) || 0;
  const risk = String(signal.riskAdjustment || "NEUTRAL").toUpperCase();
  if (confAdj > 0.5) {
    return pack(won ? "helped" : "hurt", "confidence_raise");
  }
  if (confAdj < -0.5) {
    return pack(lost ? "helped" : "hurt", "confidence_penalty");
  }
  if (risk === "ELEVATE" || risk === "HIGH" || risk === "MONITOR") {
    return pack(lost ? "helped" : "neutral", "risk_elevate");
  }
  if (risk === "REDUCE") {
    return pack(won ? "helped" : "neutral", "risk_reduce");
  }
  return pack("neutral", "no_material_adjustment");
}

export function deltaMetric(previous, current) {
  return deltaMetricAvailability(previous, current);
}

export function confidenceBucketKey(confidence) {
  const c = num(confidence, null);
  if (c === null) return null;
  if (c < 40) return "0-39";
  if (c < 50) return "40-49";
  if (c < 60) return "50-59";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  return "80+";
}

export function buildRecordStats(records = []) {
  const list = Array.isArray(records) ? records : [];
  const graded = list.filter((r) => !r.pending && (r.won || r.lost || r.push));
  const wins = graded.filter((r) => r.won);
  const losses = graded.filter((r) => r.lost);
  const pushes = graded.filter((r) => r.push);
  const pending = list.filter((r) => r.pending).length;
  const decided = wins.length + losses.length;
  const winRate =
    decided > 0 ? round((wins.length / decided) * 100, 1) : null;
  const overallAccuracy =
    graded.length > 0 ? round((wins.length / graded.length) * 100, 1) : null;

  const measuredClvs = graded
    .map((r) => {
      if (r.clvMetric) return asMetricAvailability(r.clvMetric);
      if (r.clv != null) return measuredMetric(r.clv);
      return unavailableMetric("MISSING_MARKET_SNAPSHOT");
    })
    .filter((m) => m.available);
  const avgClv =
    measuredClvs.length > 0
      ? Number(
          (
            measuredClvs.reduce((s, m) => s + m.value, 0) / measuredClvs.length
          ).toFixed(3)
        )
      : null;
  const avgClvMetric =
    measuredClvs.length > 0
      ? measuredMetric(avgClv)
      : unavailableMetric(
          graded.some((r) => r.uninstrumented || r.legacy)
            ? "UNINSTRUMENTED"
            : "MISSING_MARKET_SNAPSHOT"
        );

  const measuredAbsErr = graded
    .map((r) => num(r.absProjectionError, null))
    .filter((n) => n !== null);
  const avgAbsProjectionError =
    measuredAbsErr.length > 0 ? avg(measuredAbsErr) : null;
  const avgAbsProjectionErrorMetric =
    avgAbsProjectionError != null
      ? measuredMetric(avgAbsProjectionError)
      : unavailableMetric("MISSING_PROJECTION");

  return {
    totalProps: list.length,
    graded: graded.length,
    pending,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    decided,
    record: `${wins.length}-${losses.length}-${pushes.length}`,
    winRate,
    winRateMetric:
      winRate != null
        ? measuredMetric(winRate)
        : unavailableMetric("NO_ELIGIBLE_EVIDENCE"),
    accuracy: winRate,
    overallAccuracy,
    avgMargin: avg(graded.map((r) => r.margin)),
    avgResultMargin: avg(graded.map((r) => r.margin)),
    avgProjectionError: avg(graded.map((r) => r.projectionError)),
    avgAbsProjectionError,
    avgAbsProjectionErrorMetric,
    avgClv,
    avgClvMetric,
    measuredClvCount: measuredClvs.length,
  };
}

/** Alias used by older service drafts */
export const buildRecord = (props) => {
  if (props?.[0]?._lab || props?.[0]?.officialPropId) {
    // If raw props, map through buildLabPropRecord first when possible
    if (props[0] && !("won" in props[0]) && props[0].status !== undefined) {
      return buildRecordStats(props.map(buildLabPropRecord));
    }
  }
  return buildRecordStats(props);
};

export function splitBy(records = [], fn) {
  const map = {};
  for (const rec of records) {
    const key = fn(rec) || "UNKNOWN";
    if (!map[key]) map[key] = [];
    map[key].push(rec);
  }
  const out = {};
  for (const [k, list] of Object.entries(map)) {
    out[k] = buildRecordStats(list);
  }
  return out;
}

export function buildLabPropRecord(prop = {}) {
  const pregame = extractPregameSnapshot(prop);
  const signals = extractEngineSignals(prop);
  const packet = extractDecisionPacket(prop);
  const instrumentation = classifyPropInstrumentation(prop);
  const sealedConfRisk = resolveSealedConfidenceRisk(prop);
  const status = statusOf(prop);
  const won = status === "win";
  const lost = status === "loss";
  const push = status === "push";
  const pending = !won && !lost && !push;

  const finalSide = normalizeSide(
    first(
      packet?.side,
      prop.side,
      prop.pick,
      prop.lockedSide,
      prop.currentEngineSide,
      pregame?.side
    )
  );
  const organicSide = normalizeSide(
    first(
      packet?.organicModelSide,
      prop.originalModelSide,
      prop.initialSide,
      signals?.aggregation?.organicModelSide,
      pregame?.originalModelSide
    )
  );

  // Prefer sealed pregameSnapshot values over live Board fields
  const projection = num(
    first(
      pregame?.projection,
      pregame?.projectedPoints,
      prop.projection,
      prop.projectedPoints
    ),
    null
  );
  const actual = num(
    first(
      prop.actualPoints,
      prop.actualStat,
      prop.postgameTruth?.actualPoints,
      readMeasuredValue(prop.postgameTruth?.measuredFields?.actualPoints)
    ),
    null
  );
  const projectionError =
    num(prop.projectionError ?? prop.postgameLearning?.projectionError, null) ??
    (projection != null && actual != null ? actual - projection : null);
  const absProjectionError =
    projectionError == null ? null : Math.abs(projectionError);

  const sealedLine = num(
    first(pregame?.line, prop.sealedLine, prop.officialLine, packet?.line, prop.line),
    null
  );
  const openingLine = num(first(pregame?.openingLine, prop.openingLine), null);
  // CLV closing evidence must be an explicit market snapshot — never live currentLine.
  const closingLineExplicit = num(
    first(
      prop.closingLine,
      prop.postgameTruth?.closingLine,
      readMeasuredValue(prop.postgameTruth?.measuredFields?.closingLine)
    ),
    null
  );
  // Display-only live board line (not CLV-eligible) — intentionally unused for CLV math.
  void num(prop.currentLine, null);
  const closingLine = closingLineExplicit ?? null;

  const explicitClv = num(
    first(
      prop.closingLineValue,
      prop.clv,
      prop.postgameLearning?.closingLineValue,
      prop.postgameTruth?.closingLineValue,
      readMeasuredValue(prop.postgameTruth?.measuredFields?.closingLineValue)
    ),
    null
  );

  let clv = null;
  let clvMetric = unavailableMetric("MISSING_MARKET_SNAPSHOT");
  if (explicitClv != null) {
    clv = explicitClv;
    clvMetric = measuredMetric(explicitClv);
  } else if (sealedLine != null && closingLineExplicit != null && finalSide) {
    clv =
      finalSide === "OVER"
        ? round(closingLineExplicit - sealedLine, 2)
        : round(sealedLine - closingLineExplicit, 2);
    clvMetric = measuredMetric(clv);
  } else if (closingLineExplicit == null && sealedLine != null) {
    clvMetric = unavailableMetric("MISSING_CLOSING_LINE");
  } else if (openingLine == null && closingLineExplicit == null) {
    clvMetric = unavailableMetric(
      instrumentation.uninstrumented ? "UNINSTRUMENTED" : "MISSING_MARKET_SNAPSHOT"
    );
  } else {
    clvMetric = unavailableMetric(
      instrumentation.uninstrumented ? "UNINSTRUMENTED" : "MISSING_MARKET_SNAPSHOT"
    );
  }

  const forcedSameTeam =
    Boolean(prop.sameTeamArbitrationFlip) ||
    Boolean(prop.sameTeamForcedUnder) ||
    Boolean(prop.sameTeamArbitration?.forced) ||
    Boolean(packet?.sameTeamArbitrationFlip) ||
    Boolean(prop.sideLockedAfterArbitration) ||
    Boolean(packet?.sideLockedAfterArbitration);

  return {
    officialPropId: prop.officialPropId || null,
    slateDate: prop.slateDate || null,
    player: prop.player || prop.playerName || null,
    team: prop.team || null,
    opponent: prop.opponent || null,
    league: normalizeLeague(prop.league || pregame?.league),
    status: status.toUpperCase() || null,
    won,
    lost,
    push,
    pending,
    finalSide,
    organicSide,
    sealedLine,
    openingLine,
    closingLine,
    projection,
    fairLine: num(first(pregame?.fairLine, prop.fairLine), null),
    actual,
    margin: num(prop.resultMargin ?? prop.margin, null),
    projectionError,
    absProjectionError,
    clv,
    clvMetric,
    openingLineMetric: openingLine != null
      ? measuredMetric(openingLine)
      : unavailableMetric("MISSING_OPENING_LINE"),
    closingLineMetric: closingLineExplicit != null
      ? measuredMetric(closingLineExplicit)
      : unavailableMetric("MISSING_CLOSING_LINE"),
    projectionMetric: projection != null
      ? measuredMetric(projection)
      : unavailableMetric("MISSING_PROJECTION"),
    // Sealed decision packet owns finalConfidence / trueRisk (analysis integrity).
    confidence: sealedConfRisk.confidence,
    risk: sealedConfRisk.risk,
    confidenceRiskSource: sealedConfRisk.source,
    instrumentation,
    legacy: instrumentation.legacy,
    uninstrumented: instrumentation.uninstrumented,
    evidenceCoverage: instrumentation.evidenceCoverage,
    bestSixRank: num(prop.bestSixRank ?? prop.controlledBestSixRank, null),
    isTopPick: Boolean(
      prop.isTopPick ||
        prop.topPick ||
        (prop.topRank != null && Number(prop.topRank) > 0) ||
        (prop.topPickRank != null && Number(prop.topPickRank) > 0)
    ),
    topPickRank: num(prop.topRank ?? prop.topPickRank, null),
    forcedSameTeam,
    sameTeam: {
      applied: forcedSameTeam,
      reason: first(packet?.sameTeamArbitrationReason, prop.sameTeamArbitrationReason),
      sideLocked: Boolean(
        packet?.sideLockedAfterArbitration || prop.sideLockedAfterArbitration
      ),
      forcedSide: forcedSameTeam ? finalSide : null,
      role: prop.sameTeamRole || null,
    },
    signals,
    packet,
    pregame,
    reader: pregame?.readerEvidence || prop.sealedWnbaReader || prop.wnbaReader || null,
    flipFirst:
      pregame?.flipFirst ||
      prop.sealedFlipFirst ||
      prop.flipFirstDecision ||
      prop.decisionDataIntelligence?.flipFirstDecision ||
      null,
    sideRescue:
      pregame?.sideRescue || prop.sealedSideRescue || prop.sideRescue || null,
    missType: prop.missType || prop.postgameLearning?.missType || null,
    missSubtype: prop.missSubtype || prop.postgameLearning?.missSubtype || null,
    diagnosis: prop.postgameLearning?.calibrationLesson || prop.gradingNotes || null,
    modulesHelped: prop.modulesHelped || prop.postgameLearning?.modulesHelped || [],
    modulesHurt: prop.modulesHurt || prop.postgameLearning?.modulesHurt || [],
    modulesNeutral: prop.modulesNeutral || prop.postgameLearning?.modulesNeutral || [],
    counterfactual: prop.counterfactualResult ?? prop.postgameLearning?.oppositeSideResult ?? null,
    buildVersion: first(
      prop.buildVersion,
      prop.serverBuild,
      packet?.schemaBuild,
      signals?.schemaBuild
    ),
    engineVersions: {
      signals: signals?.version || null,
      packet: packet?.version || null,
      schemaBuild: packet?.schemaBuild || signals?.schemaBuild || null,
    },
  };
}

export function buildAllEngineScorecards(records = [], options = {}) {
  const instrumentedOnly = options.instrumentedOnly !== false;
  const source = instrumentedOnly
    ? filterInstrumentedRecords(records)
    : Array.isArray(records)
      ? records
      : [];
  const cards = {};
  const contribs = {};
  const confAdjs = {};
  const alignedMargins = {};
  const opposedMargins = {};

  for (const key of LAB_V2_ENGINE_KEYS) {
    cards[key] = emptyEngineCard(key);
    contribs[key] = [];
    confAdjs[key] = [];
    alignedMargins[key] = [];
    opposedMargins[key] = [];
  }

  for (const rec of source) {
    for (const key of LAB_V2_ENGINE_KEYS) {
      const card = cards[key];
      card.sampleSize += 1;
      const signal = rec.signals?.engines?.[key] || { available: false };
      const available = signal.available === true;
      if (available) card.availableCount += 1;
      else card.unavailableCount += 1;
      if (signal.suppressed) card.suppressedVisible += 1;

      const over = num(signal.overContribution, null);
      const under = num(signal.underContribution, null);
      if (available && over != null && under != null) {
        contribs[key].push(over - under);
      }
      const confAdj = available ? num(signal.confidenceAdjustment, null) : null;
      if (confAdj != null) confAdjs[key].push(confAdj);

      const kind = LAB_V2_ENGINE_KINDS[key];
      if (kind === "directional") {
        const attr = attributeDirectional(signal, rec.finalSide, rec.won, rec.lost);
        if (attr.attribution === "helped") {
          card.helped += 1;
          card.directionalOpportunities += 1;
          card.directionalCorrect += 1;
          if (rec.margin != null) alignedMargins[key].push(rec.margin);
        } else if (attr.attribution === "hurt") {
          card.hurt += 1;
          card.directionalOpportunities += 1;
          card.directionalIncorrect += 1;
          if (rec.margin != null) opposedMargins[key].push(rec.margin);
        } else {
          card.neutral += 1;
        }
      } else {
        const attr = attributeCalibration(signal, rec.won, rec.lost, rec.margin);
        if (attr.attribution === "helped") {
          card.helped += 1;
          card.calibrationHelped += 1;
        } else if (attr.attribution === "hurt") {
          card.hurt += 1;
          card.calibrationHurt += 1;
        } else {
          card.neutral += 1;
          card.calibrationNeutral += 1;
        }
      }
      if (signal.riskAdjustment) {
        card.averageRiskAdjustment = signal.riskAdjustment;
      }
    }
  }

  for (const key of LAB_V2_ENGINE_KEYS) {
    const card = cards[key];
    const total = card.availableCount + card.unavailableCount;
    card.instrumentedEligibleCount = source.length;
    card.uninstrumentedExcludedCount = Math.max(
      0,
      (records || []).length - source.length
    );
    card.noEligibleEvidence = source.length === 0;

    if (source.length === 0) {
      card.coveragePct = null;
      card.coverage = unavailableMetric(
        (records || []).length > 0 ? "UNINSTRUMENTED" : "NO_ELIGIBLE_EVIDENCE"
      );
      card.directionalAccuracy = null;
      card.directionalAccuracyMetric = unavailableMetric(
        (records || []).length > 0 ? "UNINSTRUMENTED" : "NO_ELIGIBLE_EVIDENCE"
      );
    } else {
      card.coveragePct =
        total > 0 ? round((card.availableCount / total) * 100, 1) : null;
      card.coverage =
        card.coveragePct != null
          ? measuredMetric(card.coveragePct)
          : unavailableMetric("NO_ELIGIBLE_EVIDENCE");
      card.directionalAccuracy =
        card.directionalOpportunities > 0
          ? round((card.directionalCorrect / card.directionalOpportunities) * 100, 1)
          : null;
      card.directionalAccuracyMetric =
        card.directionalAccuracy != null
          ? measuredMetric(card.directionalAccuracy)
          : unavailableMetric("NO_ELIGIBLE_EVIDENCE");
    }

    card.averageContribution = avg(contribs[key]);
    card.averageConfidenceAdjustment = avg(confAdjs[key]);
    card.avgMarginWhenAligned = avg(alignedMargins[key]);
    card.avgMarginWhenOpposed = avg(opposedMargins[key]);
    card.smallSample = card.sampleSize > 0 && card.sampleSize < 6;
    card.instrumentedOnly = instrumentedOnly;
    card.excludedUninstrumentedCount = card.uninstrumentedExcludedCount;
    // Always expose calibration counters (separate from directional)
    if (card.calibrationHelped == null) card.calibrationHelped = 0;
    if (card.calibrationHurt == null) card.calibrationHurt = 0;
    if (card.calibrationNeutral == null) card.calibrationNeutral = 0;
  }

  return cards;
}

export function compareRecords(current, previous, options = {}) {
  if (!previous) {
    return {
      hasPrevious: false,
      available: false,
      reason: "NOT_APPLICABLE",
      metrics: {},
      notes: ["No previous three-slate block to compare."],
    };
  }

  const gateOfficialDeltas = options.gateOfficialDeltas === true;
  const previousComplete = options.previousComplete === true;
  const currentComplete = options.currentComplete === true;
  const erasCompatible = options.erasCompatible !== false;

  const keys = [
    "winRate",
    "overallAccuracy",
    "avgMargin",
    "avgResultMargin",
    "avgProjectionError",
    "avgAbsProjectionError",
    "avgClv",
    "wins",
    "losses",
    "pushes",
    "graded",
    "decided",
  ];
  const metrics = {};
  for (const key of keys) {
    const prevVal =
      key === "avgMargin"
        ? previous.avgMargin ?? previous.avgResultMargin
        : key === "avgClv" && previous.avgClvMetric
          ? readMetricValue(previous.avgClvMetric)
          : key === "avgAbsProjectionError" && previous.avgAbsProjectionErrorMetric
            ? readMetricValue(previous.avgAbsProjectionErrorMetric)
            : previous[key];
    const curVal =
      key === "avgMargin"
        ? current.avgMargin ?? current.avgResultMargin
        : key === "avgClv" && current.avgClvMetric
          ? readMetricValue(current.avgClvMetric)
          : key === "avgAbsProjectionError" && current.avgAbsProjectionErrorMetric
            ? readMetricValue(current.avgAbsProjectionErrorMetric)
            : current[key];

    const rateLike = [
      "winRate",
      "overallAccuracy",
      "avgClv",
      "avgAbsProjectionError",
      "avgMargin",
      "avgResultMargin",
      "avgProjectionError",
    ].includes(key);

    if (gateOfficialDeltas && rateLike) {
      metrics[key] = buildCompatibleDeltaMetric(prevVal, curVal, {
        previousComplete,
        currentComplete,
        previousDecided: previous.decided,
        currentDecided: current.decided,
        erasCompatible,
      });
    } else {
      metrics[key] = deltaMetric(prevVal, curVal);
    }
  }
  return {
    hasPrevious: true,
    available: metrics.winRate?.available === true,
    reason: metrics.winRate?.reason || null,
    metrics,
    note: metrics.winRate?.note || null,
  };
}

export { CONFIDENCE_BUCKETS, LAB_V2_ENGINE_KEYS, LAB_V2_ENGINE_LABELS };
