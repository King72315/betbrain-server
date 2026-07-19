/**
 * CourtEdge Lab V2 helpers — sealed prop extraction, records, engine scorecards.
 * Missing values stay null/unavailable; never fabricate 0/50/neutral wins.
 */

import {
  LAB_V2_ENGINE_KEYS,
  LAB_V2_ENGINE_LABELS,
  LAB_V2_ENGINE_KINDS,
  CONFIDENCE_BUCKETS,
} from "./courtEdgeLabV2Constants.js";
import { readMeasuredValue } from "./labMeasuredFields.js";

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
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return true;
  if (explicit === "TEST" || explicit === "NO_BET") return false;
  if (prop.immutableOfficial === true) return true;
  if (prop.controlledBestSixDisplayTracked === true) return true;
  if (prop.controlledBestSixDisplay === true) return true;
  if (prop.bestSixRank != null && Number(prop.bestSixRank) > 0) return true;
  if (prop.controlledBestSixRank != null && Number(prop.controlledBestSixRank) > 0) {
    return true;
  }
  if (prop.excludedFromOfficialRecord === true) return false;
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

function emptyEngineCard(key) {
  return {
    engine: key,
    label: LAB_V2_ENGINE_LABELS[key],
    kind: LAB_V2_ENGINE_KINDS[key],
    availableCount: 0,
    unavailableCount: 0,
    coveragePct: null,
    directionalOpportunities: 0,
    directionalCorrect: 0,
    directionalIncorrect: 0,
    directionalAccuracy: null,
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
  if (current === null || current === undefined) {
    return {
      previous: previous ?? null,
      current: null,
      difference: null,
      direction: "unavailable",
    };
  }
  if (previous === null || previous === undefined) {
    return {
      previous: null,
      current,
      difference: null,
      direction: "no_previous",
    };
  }
  const difference = round(Number(current) - Number(previous), 3);
  let direction = "flat";
  if (difference > 0) direction = "up";
  if (difference < 0) direction = "down";
  return { previous, current, difference, direction };
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
    accuracy: winRate,
    overallAccuracy,
    avgMargin: avg(graded.map((r) => r.margin)),
    avgResultMargin: avg(graded.map((r) => r.margin)),
    avgProjectionError: avg(graded.map((r) => r.projectionError)),
    avgAbsProjectionError: avg(graded.map((r) => r.absProjectionError)),
    avgClv: avg(graded.map((r) => r.clv)),
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
  const closingLine = num(
    first(
      prop.closingLine,
      prop.postgameTruth?.closingLine,
      readMeasuredValue(prop.postgameTruth?.measuredFields?.closingLine),
      prop.currentLine
    ),
    null
  );

  let clv = num(
    first(
      prop.closingLineValue,
      prop.clv,
      prop.postgameLearning?.closingLineValue,
      prop.postgameTruth?.closingLineValue,
      readMeasuredValue(prop.postgameTruth?.measuredFields?.closingLineValue)
    ),
    null
  );
  if (clv == null && sealedLine != null && closingLine != null && finalSide) {
    clv =
      finalSide === "OVER"
        ? round(closingLine - sealedLine, 2)
        : round(sealedLine - closingLine, 2);
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
    confidence: num(
      first(
        packet?.finalConfidence,
        prop.finalConfidence,
        prop.confidence,
        pregame?.confidence
      ),
      null
    ),
    risk: normalizeRisk(
      prop.trueRisk || prop.riskLabel || packet?.trueRisk || pregame?.risk
    ),
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

export function buildAllEngineScorecards(records = []) {
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

  for (const rec of records) {
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
    card.coveragePct =
      total > 0 ? round((card.availableCount / total) * 100, 1) : null;
    card.directionalAccuracy =
      card.directionalOpportunities > 0
        ? round((card.directionalCorrect / card.directionalOpportunities) * 100, 1)
        : null;
    card.averageContribution = avg(contribs[key]);
    card.averageConfidenceAdjustment = avg(confAdjs[key]);
    card.avgMarginWhenAligned = avg(alignedMargins[key]);
    card.avgMarginWhenOpposed = avg(opposedMargins[key]);
    card.smallSample = card.sampleSize > 0 && card.sampleSize < 6;
    // Always expose calibration counters (separate from directional)
    if (card.calibrationHelped == null) card.calibrationHelped = 0;
    if (card.calibrationHurt == null) card.calibrationHurt = 0;
    if (card.calibrationNeutral == null) card.calibrationNeutral = 0;
  }

  return cards;
}

export function compareRecords(current, previous) {
  if (!previous) {
    return {
      hasPrevious: false,
      metrics: {},
      notes: ["No previous three-slate block to compare."],
    };
  }
  const keys = [
    "winRate",
    "overallAccuracy",
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
    metrics[key] = deltaMetric(previous[key], current[key]);
  }
  return { hasPrevious: true, metrics };
}

export { CONFIDENCE_BUCKETS, LAB_V2_ENGINE_KEYS, LAB_V2_ENGINE_LABELS };
