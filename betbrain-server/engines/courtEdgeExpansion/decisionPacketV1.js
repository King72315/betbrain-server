/**
 * CourtEdge Engine Expansion — Immutable Decision Packet V1.1
 *
 * Prefer: evaluate each candidate once before Best 6; attach a versioned
 * immutable decision packet. Results tracking consumes the packet without
 * re-running engines.
 */
import { createHash } from "crypto";
import { SCHEMA_BUILD } from "./versionConstants.js";

export const DECISION_PACKET_VERSION = "courtEdgeDecisionPacketV1";
export const ENGINE_EXPANSION_BUILD = SCHEMA_BUILD;

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function hashObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24);
}

export function buildEngineInputFingerprint(ctx = {}) {
  return {
    league: ctx.league || null,
    playerId: ctx.playerId || null,
    gameId: ctx.gameId || null,
    line: ctx.line ?? ctx.currentLine ?? null,
    openingLine: ctx.openingLine ?? null,
    selectedLine: ctx.selectedLine ?? null,
    sealedLine: ctx.sealedLine ?? null,
    projection: ctx.projection ?? null,
    finalSide: ctx.finalSide || null,
    organicModelSide: ctx.organicModelSide || null,
    gameLogCount: Array.isArray(ctx.gameLogs) ? ctx.gameLogs.length : 0,
    availabilityStatus: ctx.availabilityStatus || null,
    injuryStatus: ctx.injuryRow?.status || null,
    bookCount: ctx.bookCount ?? null,
    scoringEnvironmentProxy: ctx.scoringEnvironmentProxy ?? null,
    teammateCount: Array.isArray(ctx.teammateStatuses) ? ctx.teammateStatuses.length : 0,
    teamGameDateCount: Array.isArray(ctx.teamGameDates) ? ctx.teamGameDates.length : 0,
  };
}

/**
 * Build an immutable decision packet from signals + pick snapshot.
 */
export function buildDecisionPacketV1({
  pick = {},
  ctx = {},
  signals = null,
  evaluatedAt = null,
} = {}) {
  const engineSignals =
    signals || pick.courtEdgeEngineSignalsV1 || pick.courtEdgeEngineSignals || null;
  const at = evaluatedAt || engineSignals?.generatedAt || new Date().toISOString();
  const inputFingerprint = buildEngineInputFingerprint(ctx);
  const inputHash = hashObject(inputFingerprint);
  const decisionHash = hashObject({
    inputHash,
    aggregation: engineSignals?.aggregation || null,
    availability: engineSignals?.availabilityRoster?.state || null,
    organicSide: engineSignals?.aggregation?.organicSide || null,
    confidenceAdjustment: engineSignals?.aggregation?.confidenceAdjustment ?? null,
    riskAdjustment: engineSignals?.aggregation?.riskAdjustment || null,
    side: pick.side || pick.pick || null,
    line: pick.line ?? pick.selectedLine ?? null,
    confidence: pick.confidence ?? null,
  });

  return Object.freeze({
    version: DECISION_PACKET_VERSION,
    schemaBuild: ENGINE_EXPANSION_BUILD,
    engineVersion: engineSignals?.version || "courtEdgeEngineSignalsV1",
    evaluatedAt: at,
    inputHash,
    decisionHash,
    immutable: true,
    alreadyApplied: false,
    side: pick.side || pick.pick || null,
    line: pick.line ?? pick.selectedLine ?? null,
    selectedLine: pick.selectedLine ?? pick.line ?? null,
    confidence: pick.confidence ?? null,
    finalConfidence: pick.finalConfidence ?? pick.confidence ?? null,
    riskAdjustment:
      engineSignals?.aggregation?.riskAdjustment || pick.courtEdgeRiskAdjustment || "NEUTRAL",
    trueRisk: pick.trueRisk || null,
    confidenceAdjustment: engineSignals?.aggregation?.confidenceAdjustment ?? 0,
    organicModelSide: engineSignals?.aggregation?.organicModelSide || null,
    sameTeamArbitrationFlip: Boolean(pick.sameTeamArbitrationFlip),
    sameTeamArbitrationReason: pick.sameTeamArbitrationReason || null,
    sideLockedAfterArbitration: Boolean(pick.sideLockedAfterArbitration),
    userFacingDecision: "TRACK",
    engineSignalsRef: {
      version: engineSignals?.version || null,
      schemaBuild: engineSignals?.schemaBuild || null,
      enabled: engineSignals?.enabled === true,
      coveragePct: engineSignals?.aggregation?.evidenceCoverage?.coveragePct ?? null,
    },
    inputFingerprint,
  });
}

/** @deprecated alias */
export const buildCourtEdgeDecisionPacket = buildDecisionPacketV1;

export function attachDecisionPacket(pick = {}, packet) {
  if (!packet) return pick;
  const existing = pick.courtEdgeDecisionPacketV1 || pick.courtEdgeDecisionPacket;
  if (
    existing &&
    existing.decisionHash === packet.decisionHash &&
    existing.version === packet.version
  ) {
    return {
      ...pick,
      courtEdgeDecisionPacketV1: existing,
      courtEdgeDecisionPacket: existing,
      decisionPacket: existing,
      courtEdgeDecisionPacketVersion: existing.version,
    };
  }
  return {
    ...pick,
    courtEdgeDecisionPacketV1: packet,
    courtEdgeDecisionPacket: packet,
    decisionPacket: packet,
    courtEdgeDecisionPacketVersion: packet.version,
  };
}

export function markDecisionPacketApplied(packet, appliedFields = {}) {
  if (!packet) return null;
  return Object.freeze({
    ...packet,
    immutable: true,
    alreadyApplied: true,
    appliedAt: new Date().toISOString(),
    ...appliedFields,
  });
}

export function hasEngineSignalsAlreadyApplied(pick = {}, packet = null) {
  const pkt = packet || pick.courtEdgeDecisionPacketV1 || pick.courtEdgeDecisionPacket;
  if (
    (pick.courtEdgeEngineAdjustmentsApplied === true ||
      pick.courtEdgeEngineSignalsApplied === true) &&
    pick.courtEdgeEngineSignalsDecisionHash
  ) {
    if (!pkt) return true;
    return pick.courtEdgeEngineSignalsDecisionHash === pkt.decisionHash;
  }
  if (pkt?.alreadyApplied === true) return true;
  return false;
}

/**
 * Results admission: consume sealed packet without re-running engines.
 */
export function admitResultsFromDecisionPacket(pick = {}) {
  const packet =
    pick.courtEdgeDecisionPacketV1 ||
    pick.courtEdgeDecisionPacket ||
    pick.decisionPacket ||
    pick.canonicalSealedProp?.courtEdgeDecisionPacketV1 ||
    null;
  const signals =
    pick.courtEdgeEngineSignalsV1 ||
    pick.courtEdgeEngineSignals ||
    pick.canonicalSealedProp?.courtEdgeEngineSignalsV1 ||
    null;

  if (!packet && !signals) return { ...pick };

  return {
    ...pick,
    side: packet?.side || pick.side,
    pick: packet?.side || pick.pick,
    line: packet?.line ?? pick.line,
    selectedLine: packet?.selectedLine ?? pick.selectedLine ?? pick.line,
    confidence: packet?.confidence ?? pick.confidence,
    finalConfidence: packet?.finalConfidence ?? pick.finalConfidence ?? pick.confidence,
    courtEdgeRiskAdjustment: packet?.riskAdjustment || pick.courtEdgeRiskAdjustment,
    trueRisk: packet?.trueRisk || pick.trueRisk,
    courtEdgeEngineSignalsV1: signals,
    courtEdgeEngineSignals: signals,
    courtEdgeDecisionPacketV1: packet || pick.courtEdgeDecisionPacketV1 || null,
    courtEdgeDecisionPacket: packet || pick.courtEdgeDecisionPacket || null,
    decisionPacket: packet || pick.decisionPacket || null,
    courtEdgeEngineAdjustmentsApplied: true,
    courtEdgeEngineSignalsApplied: true,
    admittedFromDecisionPacket: true,
    userFacingDecision: "TRACK",
    finalDecision: "TRACK",
  };
}

/** Alias used by some callers */
export const admitFromDecisionPacket = admitResultsFromDecisionPacket;

export function assertDecisionPacketUnchanged(before = {}, after = {}) {
  const fields = [
    ["side", before.side || before.pick, after.side || after.pick],
    ["line", before.line, after.line],
    ["confidence", before.confidence, after.confidence],
    ["risk", before.courtEdgeRiskAdjustment, after.courtEdgeRiskAdjustment],
    [
      "signalsAgg",
      JSON.stringify(before.courtEdgeEngineSignalsV1?.aggregation || null),
      JSON.stringify(after.courtEdgeEngineSignalsV1?.aggregation || null),
    ],
    [
      "decisionHash",
      before.courtEdgeDecisionPacketV1?.decisionHash ||
        before.courtEdgeDecisionPacket?.decisionHash,
      after.courtEdgeDecisionPacketV1?.decisionHash ||
        after.courtEdgeDecisionPacket?.decisionHash,
    ],
  ];
  const diffs = fields
    .filter(([, a, b]) => String(a) !== String(b))
    .map(([name, a, b]) => ({ field: name, before: a, after: b }));
  return { ok: diffs.length === 0, diffs };
}
