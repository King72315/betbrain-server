/**
 * CourtEdge End-to-End State Integrity V1
 *
 * Single canonical owner for official sealed slate packets, merge precedence,
 * content hashes, lifecycle transitions, invariants, and paid-API accounting.
 *
 * User-facing labels are unchanged — lifecycle enums are internal only.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

export const STATE_INTEGRITY_BUILD = "courteedge-slate-date-today-repair-v1";
export const STATE_INTEGRITY_SCHEMA = "courtEdgeStateIntegrityV1";
export const CANONICAL_STORE_VERSION = 1;

export const LIFECYCLE = Object.freeze({
  DRAFT: "DRAFT",
  SEALED: "SEALED",
  IN_RESULTS: "IN_RESULTS",
  GRADED_COMPLETE: "GRADED_COMPLETE",
  IN_LAB: "IN_LAB",
  IN_HISTORY: "IN_HISTORY",
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  [LIFECYCLE.DRAFT]: [LIFECYCLE.SEALED],
  [LIFECYCLE.SEALED]: [LIFECYCLE.IN_RESULTS],
  [LIFECYCLE.IN_RESULTS]: [LIFECYCLE.GRADED_COMPLETE],
  [LIFECYCLE.GRADED_COMPLETE]: [LIFECYCLE.IN_LAB],
  [LIFECYCLE.IN_LAB]: [LIFECYCLE.IN_HISTORY],
  [LIFECYCLE.IN_HISTORY]: [],
});

/** Immutable sealed decision fields — never mutated after seal. */
export const SEALED_IMMUTABLE_FIELDS = Object.freeze([
  "propId",
  "officialPropId",
  "slateId",
  "playerId",
  "player",
  "teamId",
  "team",
  "opponentId",
  "opponent",
  "eventId",
  "gameId",
  "league",
  "slateDate",
  "marketType",
  "selectedLine",
  "officialLine",
  "sealedLine",
  "line",
  "originalModelSide",
  "finalCourtEdgeSide",
  "side",
  "finalConfidence",
  "confidence",
  "trueRisk",
  "risk",
  "bestSixRank",
  "rank",
  "isTopPick",
  "topPickRank",
  "decisionExplanation",
  "projection",
  "finalProjection",
  "sealedAnalysis",
  "engineEvidence",
  "buildVersion",
  "schemaVersion",
  "createdAt",
  "sealedAt",
  "contentHash",
]);

/** Mutable market reference fields — may update after seal. */
export const MARKET_REF_FIELDS = Object.freeze([
  "currentLine",
  "currentPrice",
  "bookCount",
  "closingLine",
  "closingPrice",
  "referenceUpdatedAt",
  "latestLine",
  "lineMovement",
]);

const STORE_FILE = path.join(SERVER_ROOT, "canonical-slates-v1.json");
const JOURNAL_FILE = path.join(SERVER_ROOT, "lifecycle-transition-journal-v1.json");
const LOCKS_FILE = path.join(SERVER_ROOT, "state-integrity-locks-v1.json");
const REJECTED_WRITES_FILE = path.join(
  SERVER_ROOT,
  "state-integrity-rejected-writes-v1.json"
);

let paidApiCallCount = 0;
const paidApiLog = [];

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("U")) return "UNDER";
  if (raw.startsWith("O")) return "OVER";
  return raw || null;
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return "null";
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

/**
 * One America/Chicago slate-date function — re-export of existing canonical helper.
 */
export function getCanonicalSlateDate(now = new Date()) {
  return getTodayLocalDate(now);
}

export function getCanonicalSlateDateFromInstant(instant) {
  if (!instant) return "";
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    return String(instant).slice(0, 10);
  }
  return getTodayLocalDate(parsed);
}

/**
 * Stable slate identity: league + America/Chicago date + cohort + market type.
 * Tomorrow→Today of the same sealed slate keeps the same ID.
 */
export function buildCanonicalSlateId({
  league = "WNBA",
  slateDate,
  cohort = "official-best6",
  marketType = "player_points",
} = {}) {
  const date = String(slateDate || "").slice(0, 10);
  const lg = String(league || "WNBA").toUpperCase() === "NBA" ? "NBA" : "WNBA";
  const c = clean(cohort) || "officialbest6";
  const m = clean(marketType) || "playerpoints";
  return `${lg}|${date}|${c}|${m}`;
}

export function extractImmutablePacketFields(pick = {}, options = {}) {
  const slateDate = String(
    options.slateDate ||
      pick.slateDate ||
      pick.resultsSlateDate ||
      pick.cohortSlateDate ||
      ""
  ).slice(0, 10);
  const league =
    String(pick.league || options.league || "WNBA").toUpperCase() === "NBA"
      ? "NBA"
      : "WNBA";
  const side = normalizeSide(
    pick.finalCourtEdgeSide ||
      pick.lockedSide ||
      pick.side ||
      pick.pick ||
      pick.canonicalSealedProp?.finalCourtEdgeSide
  );
  const line = num(
    pick.officialLine ??
      pick.sealedLine ??
      pick.selectedLine ??
      pick.line ??
      pick.canonicalSealedProp?.selectedLine
  );
  const propId =
    pick.officialPropId ||
    pick.propId ||
    [
      slateDate,
      league,
      clean(pick.player),
      clean(pick.team),
      clean(pick.opponent),
      "points",
      side || "na",
      Number.isFinite(line) ? String(line) : "na",
    ].join("|");

  return {
    propId,
    officialPropId: propId,
    slateId:
      pick.slateId ||
      pick.officialSlateId ||
      buildCanonicalSlateId({ league, slateDate }),
    playerId: pick.playerId || pick.athleteId || clean(pick.player) || null,
    player: pick.player || null,
    teamId: pick.teamId || clean(pick.team) || null,
    team: pick.team || pick.teamKey || null,
    opponentId: pick.opponentId || clean(pick.opponent) || null,
    opponent: pick.opponent || null,
    eventId: pick.eventId || pick.gameId || null,
    gameId: pick.gameId || null,
    league,
    slateDate,
    marketType: pick.marketType || pick.stat || "player_points",
    selectedLine: line,
    officialLine: line,
    sealedLine: line,
    line,
    originalModelSide: normalizeSide(
      pick.originalModelSide ||
        pick.sameTeamArbitration?.originalModelSide ||
        pick.canonicalSealedProp?.originalModelSide
    ),
    finalCourtEdgeSide: side,
    side,
    finalConfidence: num(pick.confidence ?? pick.finalConfidence ?? pick.winProbability),
    confidence: num(pick.confidence ?? pick.finalConfidence ?? pick.winProbability),
    trueRisk: String(
      pick.trueRisk ||
        pick.riskLabel ||
        pick.risk ||
        pick.decisionIntelligence?.trueRisk ||
        "MEDIUM"
    ).toUpperCase(),
    risk: String(
      pick.trueRisk ||
        pick.riskLabel ||
        pick.risk ||
        pick.decisionIntelligence?.trueRisk ||
        "MEDIUM"
    ).toUpperCase(),
    bestSixRank: num(
      pick.controlledBestSixRank ?? pick.bestSixRank ?? pick.canonicalSealedProp?.bestSixRank
    ),
    rank: num(
      pick.controlledBestSixRank ?? pick.bestSixRank ?? pick.canonicalSealedProp?.bestSixRank
    ),
    isTopPick: Boolean(pick.isTopPick || pick.topPickRank),
    topPickRank: num(pick.topPickRank),
    decisionExplanation:
      pick.decisionExplanation ||
      pick.whySide ||
      pick.homeDisplayWhy ||
      pick.canonicalSealedProp?.decisionExplanation ||
      null,
    projection: num(
      pick.projection ??
        pick.projectedPoints ??
        pick.finalProjection ??
        pick.canonicalSealedProp?.finalProjection
    ),
    finalProjection: num(
      pick.projection ??
        pick.projectedPoints ??
        pick.finalProjection ??
        pick.canonicalSealedProp?.finalProjection
    ),
    sealedAnalysis: pick.homeDetailedAnalysisV1 || pick.sealedAnalysis || null,
    engineEvidence:
      pick.courtEdgeEngineSignalsV1 ||
      pick.engineEvidence ||
      pick.canonicalSealedProp?.signals ||
      null,
    buildVersion:
      pick.buildVersion ||
      pick.serverBuild ||
      options.buildVersion ||
      STATE_INTEGRITY_BUILD,
    schemaVersion: pick.schemaVersion || STATE_INTEGRITY_SCHEMA,
    createdAt: pick.createdAt || pick.generatedAt || null,
    sealedAt: pick.sealedAt || pick.officialSealedAt || options.sealedAt || null,
  };
}

export function hashDecisionPacket(pick = {}, options = {}) {
  const fields = extractImmutablePacketFields(pick, options);
  const { sealedAnalysis, engineEvidence, decisionExplanation, ...hashable } =
    fields;
  // Hash stable identity + decision values; analysis blobs use presence flags
  // so formatting churn does not break cross-surface parity.
  const payload = {
    ...hashable,
    hasAnalysis: Boolean(sealedAnalysis),
    hasEngineEvidence: Boolean(engineEvidence),
    hasExplanation: Boolean(decisionExplanation),
  };
  return sha256Hex(stableStringify(payload));
}

export function attachContentHash(pick = {}, options = {}) {
  const fields = extractImmutablePacketFields(pick, options);
  const contentHash = hashDecisionPacket(pick, options);
  return {
    ...pick,
    ...fields,
    contentHash,
    immutableOfficial:
      pick.immutableOfficial === true ||
      Boolean(pick.sealedAt || pick.officialSealedAt || options.forceSealed),
  };
}

export function extractMarketReference(pick = {}) {
  const ref = {};
  for (const key of MARKET_REF_FIELDS) {
    if (pick[key] !== undefined) ref[key] = pick[key];
  }
  ref.referenceUpdatedAt = pick.referenceUpdatedAt || new Date().toISOString();
  return ref;
}

export function completenessScore(record = {}) {
  if (!record || typeof record !== "object") return 0;
  let score = 0;
  const props = record.decisionPackets || record.props || [];
  if (Array.isArray(props) && props.length > 0) score += Math.min(props.length, 6) * 10;
  const hydrated = props.filter(
    (p) =>
      p?.sealedAnalysis ||
      p?.homeDetailedAnalysisV1 ||
      (Array.isArray(p?.whySide) && p.whySide.length) ||
      p?.projection != null
  ).length;
  score += hydrated * 5;
  if (record.lifecycle && record.lifecycle !== LIFECYCLE.DRAFT) score += 20;
  if (record.contentHash || record.slateContentHash) score += 10;
  if (props.some((p) => p?.contentHash)) score += 10;
  if (record.placeholder === true || record.recoveryPlaceholder === true) score -= 50;
  if (props.length === 0) score -= 30;
  return score;
}

function isEmptyLike(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return true;
  }
  return false;
}

function isPlaceholderRecord(record = {}) {
  if (!record || typeof record !== "object") return true;
  if (record.placeholder === true || record.recoveryPlaceholder === true) return true;
  if (record.analysisCoveragePct != null && Number(record.analysisCoveragePct) <= 40) {
    const props = record.decisionPackets || record.props || [];
    if (props.length > 0 && props.every((p) => !p?.sealedAnalysis && !p?.homeDetailedAnalysisV1)) {
      return true;
    }
  }
  return false;
}

/**
 * Centralized merge precedence (rules 1–15 from product contract).
 * Returns { winner, rejected, reason, merged }.
 */
export function mergeByPrecedence(existing, incoming, context = {}) {
  const source = context.source || "unknown";
  const reasons = [];

  if (!existing && incoming) {
    return { winner: incoming, rejected: null, reason: "no_existing", merged: incoming };
  }
  if (existing && !incoming) {
    return { winner: existing, rejected: null, reason: "no_incoming", merged: existing };
  }
  if (!existing && !incoming) {
    return { winner: null, rejected: null, reason: "both_empty", merged: null };
  }

  const exLife = existing.lifecycle || LIFECYCLE.DRAFT;
  const inLife = incoming.lifecycle || LIFECYCLE.DRAFT;
  const lifeRank = {
    [LIFECYCLE.DRAFT]: 0,
    [LIFECYCLE.SEALED]: 1,
    [LIFECYCLE.IN_RESULTS]: 2,
    [LIFECYCLE.GRADED_COMPLETE]: 3,
    [LIFECYCLE.IN_LAB]: 4,
    [LIFECYCLE.IN_HISTORY]: 5,
  };

  // 1. Sealed beats draft
  if (lifeRank[exLife] >= 1 && lifeRank[inLife] === 0) {
    reasons.push("sealed_beats_draft");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }

  // 14. Home draft may never overwrite sealed Results cohort
  if (
    context.incomingIsHomeDraft === true &&
    lifeRank[exLife] >= lifeRank[LIFECYCLE.IN_RESULTS]
  ) {
    reasons.push("home_draft_cannot_overwrite_results");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }

  // 15. Results/Lab/History may not overwrite sealed Home decision fields
  if (
    context.protectSealedDecisions === true &&
    (existing.sealed === true || lifeRank[exLife] >= 1)
  ) {
    const merged = mergeMarketRefsOnly(existing, incoming);
    reasons.push("market_refs_only_on_sealed");
    return { winner: merged, rejected: null, reason: reasons.join("|"), merged };
  }

  // 2–3. Completed / hydrated beats incomplete / placeholder
  const exComplete = completenessScore(existing);
  const inComplete = completenessScore(incoming);
  if (isPlaceholderRecord(incoming) && !isPlaceholderRecord(existing)) {
    reasons.push("placeholder_cannot_replace_complete");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }
  if (exComplete > inComplete + 15 && lifeRank[exLife] >= lifeRank[inLife]) {
    reasons.push("richer_existing_beats_weaker_incoming");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }

  // 8–9. Version / stale client
  const exVer = Number(existing.recordVersion || 0);
  const inVer = Number(incoming.recordVersion || 0);
  if (inVer > 0 && exVer > 0 && inVer < exVer) {
    reasons.push("stale_client_rejected");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }

  // 10–11. Today/Tomorrow isolation
  if (
    context.dayBucket &&
    existing.dayBucket &&
    context.dayBucket !== existing.dayBucket &&
    context.allowCrossDay !== true
  ) {
    reasons.push("today_tomorrow_isolation");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }

  // 12–13. Partial/empty cannot replace complete known-good
  const inProps = incoming.decisionPackets || incoming.props || [];
  const exProps = existing.decisionPackets || existing.props || [];
  if (exProps.length >= 6 && inProps.length === 0) {
    reasons.push("empty_cannot_clear_playable");
    return rejectIncoming(existing, incoming, reasons.join("|"), source);
  }
  if (exProps.length >= 6 && inProps.length > 0 && inProps.length < exProps.length) {
    if (context.allowPartialReplace !== true) {
      reasons.push("partial_cannot_replace_complete");
      return rejectIncoming(existing, incoming, reasons.join("|"), source);
    }
  }

  // 5–7. Field-level: missing/empty may not overwrite populated
  const merged = deepMergeProtectingPopulated(existing, incoming);
  reasons.push("merged_with_populated_protection");
  return { winner: merged, rejected: null, reason: reasons.join("|"), merged };
}

function rejectIncoming(existing, incoming, reason, source) {
  recordRejectedWrite({
    reason,
    source,
    existingSlateId: existing?.slateId || existing?.officialSlateId || null,
    incomingSlateId: incoming?.slateId || incoming?.officialSlateId || null,
    existingVersion: existing?.recordVersion ?? null,
    incomingVersion: incoming?.recordVersion ?? null,
    existingHash: existing?.slateContentHash || existing?.contentHash || null,
    incomingHash: incoming?.slateContentHash || incoming?.contentHash || null,
  });
  return {
    winner: existing,
    rejected: incoming,
    reason,
    merged: existing,
  };
}

function mergeMarketRefsOnly(existing, incoming) {
  const exProps = [...(existing.decisionPackets || existing.props || [])];
  const inProps = incoming.decisionPackets || incoming.props || [];
  const byId = new Map(
    inProps.map((p) => [p.officialPropId || p.propId || p.player, p])
  );
  const nextProps = exProps.map((p) => {
    const id = p.officialPropId || p.propId || p.player;
    const inc = byId.get(id);
    if (!inc) return p;
    const refs = extractMarketReference(inc);
    return { ...p, ...refs, contentHash: p.contentHash };
  });
  return {
    ...existing,
    decisionPackets: nextProps,
    props: nextProps,
    marketRefsUpdatedAt: new Date().toISOString(),
    recordVersion: Number(existing.recordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}

function deepMergeProtectingPopulated(existing, incoming) {
  if (Array.isArray(existing) || Array.isArray(incoming)) {
    if (Array.isArray(existing) && existing.length > 0 && isEmptyLike(incoming)) {
      return existing;
    }
    return incoming !== undefined ? incoming : existing;
  }
  if (
    existing &&
    typeof existing === "object" &&
    incoming &&
    typeof incoming === "object"
  ) {
    const out = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (SEALED_IMMUTABLE_FIELDS.includes(key) && existing.sealed === true) {
        continue;
      }
      if (isEmptyLike(value) && !isEmptyLike(existing[key])) {
        continue;
      }
      if (value === 0 && existing[key] == null) {
        // Missing must not become zero evidence — keep missing.
        if (contextTreatZeroAsMissing(key)) continue;
      }
      out[key] = deepMergeProtectingPopulated(existing[key], value);
    }
    out.recordVersion = Math.max(
      Number(existing.recordVersion || 0),
      Number(incoming.recordVersion || 0)
    );
    out.updatedAt = new Date().toISOString();
    return out;
  }
  return incoming !== undefined && incoming !== null ? incoming : existing;
}

function contextTreatZeroAsMissing(key) {
  return [
    "avgClv",
    "clv",
    "projection",
    "confidence",
    "seasonAvg",
    "winRate",
  ].includes(key);
}

export function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  // Validate before rename
  JSON.parse(fs.readFileSync(tmp, "utf8"));
  const bak = `${file}.bak`;
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, bak);
    } catch {
      // best-effort backup
    }
  }
  fs.renameSync(tmp, file);
  return file;
}

export function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Prefer .bak after crash mid-write
    try {
      const bak = `${file}.bak`;
      if (fs.existsSync(bak)) return JSON.parse(fs.readFileSync(bak, "utf8"));
    } catch {
      // fall through
    }
    return fallback;
  }
}

function emptyStore() {
  return {
    schemaVersion: STATE_INTEGRITY_SCHEMA,
    storeVersion: CANONICAL_STORE_VERSION,
    buildVersion: STATE_INTEGRITY_BUILD,
    updatedAt: null,
    slates: {},
  };
}

export function loadCanonicalStore(filePath = STORE_FILE) {
  const raw = readJsonSafe(filePath, null);
  if (!raw || typeof raw !== "object") return emptyStore();
  return {
    ...emptyStore(),
    ...raw,
    slates: raw.slates && typeof raw.slates === "object" ? raw.slates : {},
  };
}

export function saveCanonicalStore(store, filePath = STORE_FILE) {
  const next = {
    ...store,
    schemaVersion: STATE_INTEGRITY_SCHEMA,
    storeVersion: CANONICAL_STORE_VERSION,
    buildVersion: STATE_INTEGRITY_BUILD,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(filePath, next);
  return next;
}

export function buildCanonicalSlateRecord({
  league = "WNBA",
  slateDate,
  cohort = "official-best6",
  marketType = "player_points",
  dayBucket = null,
  props = [],
  lifecycle = LIFECYCLE.DRAFT,
  sealedAt = null,
  buildVersion = STATE_INTEGRITY_BUILD,
  recordVersion = 1,
  grades = null,
  labAnalysis = null,
} = {}) {
  const slateId = buildCanonicalSlateId({ league, slateDate, cohort, marketType });
  const sealed =
    lifecycle !== LIFECYCLE.DRAFT ||
    props.some((p) => p?.immutableOfficial || p?.sealedAt || p?.officialSealedAt);
  const packets = (props || []).map((p) =>
    attachContentHash(p, { slateDate, buildVersion, sealedAt, forceSealed: sealed })
  );
  const slateContentHash = sha256Hex(
    stableStringify(packets.map((p) => p.contentHash).sort())
  );
  return {
    slateId,
    league: String(league).toUpperCase() === "NBA" ? "NBA" : "WNBA",
    slateDate: String(slateDate || "").slice(0, 10),
    cohort,
    marketType,
    dayBucket: dayBucket || null,
    lifecycle: sealed && lifecycle === LIFECYCLE.DRAFT ? LIFECYCLE.SEALED : lifecycle,
    sealed,
    sealedAt: sealedAt || packets.find((p) => p.sealedAt)?.sealedAt || null,
    decisionPackets: packets,
    props: packets,
    marketReferences: Object.fromEntries(
      packets.map((p) => [p.officialPropId || p.propId, extractMarketReference(p)])
    ),
    grades: grades || null,
    labAnalysis: labAnalysis || null,
    slateContentHash,
    contentHash: slateContentHash,
    recordVersion,
    schemaVersion: STATE_INTEGRITY_SCHEMA,
    buildVersion,
    completeness: completenessScore({
      decisionPackets: packets,
      lifecycle,
      slateContentHash,
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function upsertCanonicalSlate(record, options = {}) {
  const storePath = options.storePath || STORE_FILE;
  const store = loadCanonicalStore(storePath);
  const existing = store.slates[record.slateId] || null;
  const merge = mergeByPrecedence(existing, record, {
    source: options.source || "upsertCanonicalSlate",
    protectSealedDecisions: options.protectSealedDecisions === true,
    incomingIsHomeDraft: options.incomingIsHomeDraft === true,
    dayBucket: record.dayBucket,
    allowCrossDay: true,
  });
  store.slates[record.slateId] = merge.merged;
  saveCanonicalStore(store, storePath);
  return merge;
}

export function getCanonicalSlate(slateId, storePath = STORE_FILE) {
  const store = loadCanonicalStore(storePath);
  return store.slates[slateId] || null;
}

export function listCanonicalSlates(storePath = STORE_FILE) {
  const store = loadCanonicalStore(storePath);
  return Object.values(store.slates || {});
}

export function loadJournal(filePath = JOURNAL_FILE) {
  const raw = readJsonSafe(filePath, null);
  if (!raw || !Array.isArray(raw.entries)) {
    return { schemaVersion: STATE_INTEGRITY_SCHEMA, entries: [] };
  }
  return raw;
}

export function appendTransition(entry, filePath = JOURNAL_FILE) {
  const journal = loadJournal(filePath);
  const row = {
    transitionId: entry.transitionId || sha256Hex(`${Date.now()}|${Math.random()}`).slice(0, 16),
    slateId: entry.slateId,
    fromState: entry.fromState,
    toState: entry.toState,
    reason: entry.reason || null,
    source: entry.source || null,
    idempotencyKey: entry.idempotencyKey || null,
    startedAt: entry.startedAt || new Date().toISOString(),
    completedAt: entry.completedAt || new Date().toISOString(),
    buildVersion: entry.buildVersion || STATE_INTEGRITY_BUILD,
    beforeHash: entry.beforeHash || null,
    afterHash: entry.afterHash || null,
    success: entry.success !== false,
    error: entry.error || null,
  };
  journal.entries.push(row);
  // Cap journal size
  if (journal.entries.length > 2000) {
    journal.entries = journal.entries.slice(-1500);
  }
  atomicWriteJson(filePath, journal);
  return row;
}

export function transitionLifecycle(slateId, toState, options = {}) {
  const storePath = options.storePath || STORE_FILE;
  const journalPath = options.journalPath || JOURNAL_FILE;
  const store = loadCanonicalStore(storePath);
  const slate = store.slates[slateId];
  if (!slate) {
    return {
      ok: false,
      message: "slate_not_found",
      slateId,
    };
  }
  const fromState = slate.lifecycle || LIFECYCLE.DRAFT;
  if (fromState === toState) {
    return {
      ok: true,
      idempotent: true,
      slate,
      fromState,
      toState,
    };
  }
  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    appendTransition(
      {
        slateId,
        fromState,
        toState,
        reason: options.reason || "invalid_transition",
        source: options.source || "transitionLifecycle",
        idempotencyKey: options.idempotencyKey,
        beforeHash: slate.slateContentHash,
        afterHash: slate.slateContentHash,
        success: false,
        error: `invalid_transition_${fromState}_to_${toState}`,
      },
      journalPath
    );
    return {
      ok: false,
      message: `invalid_transition_${fromState}_to_${toState}`,
      fromState,
      toState,
    };
  }
  if (options.idempotencyKey) {
    const journal = loadJournal(journalPath);
    const prior = journal.entries.find(
      (e) => e.idempotencyKey === options.idempotencyKey && e.success
    );
    if (prior) {
      return { ok: true, idempotent: true, slate, prior };
    }
  }

  const beforeHash = slate.slateContentHash;
  const next = {
    ...slate,
    lifecycle: toState,
    recordVersion: Number(slate.recordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  store.slates[slateId] = next;
  saveCanonicalStore(store, storePath);
  appendTransition(
    {
      slateId,
      fromState,
      toState,
      reason: options.reason || null,
      source: options.source || "transitionLifecycle",
      idempotencyKey: options.idempotencyKey,
      beforeHash,
      afterHash: next.slateContentHash,
      success: true,
    },
    journalPath
  );
  return { ok: true, slate: next, fromState, toState };
}

/** Persisted per-league/per-slate locks for scheduler/manual concurrency. */
export function acquireSlateLock(lockKey, options = {}) {
  const filePath = options.locksPath || LOCKS_FILE;
  const locks = readJsonSafe(filePath, { locks: {} });
  const now = Date.now();
  const ttlMs = options.ttlMs || 120_000;
  const existing = locks.locks[lockKey];
  if (existing && existing.expiresAt > now && existing.owner !== options.owner) {
    return { ok: false, reason: "lock_held", existing };
  }
  locks.locks[lockKey] = {
    lockKey,
    owner: options.owner || `pid-${process.pid}`,
    acquiredAt: new Date().toISOString(),
    expiresAt: now + ttlMs,
  };
  atomicWriteJson(filePath, locks);
  return { ok: true, lock: locks.locks[lockKey] };
}

export function releaseSlateLock(lockKey, options = {}) {
  const filePath = options.locksPath || LOCKS_FILE;
  const locks = readJsonSafe(filePath, { locks: {} });
  delete locks.locks[lockKey];
  atomicWriteJson(filePath, locks);
  return { ok: true };
}

export function withSlateLock(lockKey, fn, options = {}) {
  const acquired = acquireSlateLock(lockKey, options);
  if (!acquired.ok) {
    return { ok: false, reason: acquired.reason, result: null };
  }
  try {
    const result = fn();
    return { ok: true, result };
  } finally {
    releaseSlateLock(lockKey, options);
  }
}

function recordRejectedWrite(entry) {
  const file = REJECTED_WRITES_FILE;
  const raw = readJsonSafe(file, { entries: [] });
  raw.entries.push({
    ...entry,
    at: new Date().toISOString(),
    buildVersion: STATE_INTEGRITY_BUILD,
  });
  if (raw.entries.length > 500) raw.entries = raw.entries.slice(-400);
  try {
    atomicWriteJson(file, raw);
  } catch {
    // non-fatal
  }
}

export function getRejectedWrites(limit = 50) {
  const raw = readJsonSafe(REJECTED_WRITES_FILE, { entries: [] });
  return (raw.entries || []).slice(-limit);
}

/** Paid API call accounting for tests / diagnostics. */
export function resetPaidApiCounter() {
  paidApiCallCount = 0;
  paidApiLog.length = 0;
}

export function recordPaidApiCall(meta = {}) {
  paidApiCallCount += 1;
  paidApiLog.push({
    at: new Date().toISOString(),
    ...meta,
  });
  return paidApiCallCount;
}

export function getPaidApiCallCount() {
  return paidApiCallCount;
}

export function getPaidApiLog() {
  return [...paidApiLog];
}

/**
 * Preserve sealed Best 6 display lists across board merges.
 * Today refresh must not wipe Tomorrow (and vice versa).
 */
export function mergeBoardDayIsolation(previousBoard, nextBoard) {
  if (!previousBoard || !nextBoard) return nextBoard || previousBoard;
  const out = { ...nextBoard };
  const dayKeys = [
    ["bestSixDisplayTodayWNBA", "TODAY"],
    ["bestSixDisplayTodayNBA", "TODAY"],
    ["bestSixDisplayTomorrowWNBA", "TOMORROW"],
    ["bestSixDisplayTomorrowNBA", "TOMORROW"],
  ];
  for (const [key] of dayKeys) {
    const prev = previousBoard[key] || [];
    const next = nextBoard[key] || [];
    if (prev.length >= 6 && next.length === 0) {
      out[key] = prev;
    } else if (prev.length > 0 && next.length > 0) {
      // If next day bucket is sealed, keep sealed packets
      out[key] = next.map((p, i) => {
        const sealed =
          p.immutableOfficial || p.sealedAt || p.officialSealedAt || p.contentHash;
        const prior = prev.find(
          (x) =>
            (x.officialPropId && x.officialPropId === p.officialPropId) ||
            (x.player && x.player === p.player)
        ) || prev[i];
        if (prior && (prior.immutableOfficial || prior.contentHash) && !sealed) {
          return prior;
        }
        if (prior?.contentHash && sealed) {
          // Keep immutable fields from prior sealed packet
          const hash = prior.contentHash;
          const merged = { ...p };
          for (const field of SEALED_IMMUTABLE_FIELDS) {
            if (prior[field] !== undefined && prior[field] !== null) {
              merged[field] = prior[field];
            }
          }
          merged.contentHash = hash;
          merged.immutableOfficial = true;
          return merged;
        }
        return attachContentHash(p);
      });
    } else if (next.length > 0) {
      out[key] = next.map((p) => attachContentHash(p));
    }
  }
  return out;
}

/**
 * When official slate is sealed, Force Refresh may only update market refs.
 */
export function applyForceRefreshToSealedBoard(previousBoard, refreshedBoard) {
  if (!previousBoard) return refreshedBoard;
  const merged = mergeBoardDayIsolation(previousBoard, refreshedBoard);
  const sealKeys = [
    "bestSixDisplayTodayWNBA",
    "bestSixDisplayTodayNBA",
    "bestSixDisplayTomorrowWNBA",
    "bestSixDisplayTomorrowNBA",
    "bestSixDisplayWNBA",
    "bestSixDisplayNBA",
    "bestSixWNBA",
    "bestSixNBA",
  ];
  for (const key of sealKeys) {
    const prev = previousBoard[key] || [];
    const next = merged[key] || [];
    if (!prev.length) continue;
    const allSealed = prev.every(
      (p) => p.immutableOfficial || p.sealedAt || p.officialSealedAt || p.contentHash
    );
    if (!allSealed) continue;
    merged[key] = prev.map((p) => {
      const match =
        next.find(
          (n) =>
            (n.officialPropId && n.officialPropId === p.officialPropId) ||
            n.player === p.player
        ) || {};
      return {
        ...p,
        ...extractMarketReference(match),
        contentHash: p.contentHash || hashDecisionPacket(p),
        immutableOfficial: true,
      };
    });
  }
  merged.forceRefreshMarketRefsOnly = true;
  merged.serverBuild = refreshedBoard?.serverBuild || previousBoard.serverBuild;
  merged.lastUpdated = new Date().toISOString();
  return merged;
}

export function syncBoardToCanonicalStore(board, options = {}) {
  if (!board || typeof board !== "object") return { ok: false, synced: [] };
  const synced = [];
  const today = options.today || getCanonicalSlateDate();
  const pairs = [
    {
      props: board.bestSixDisplayTodayWNBA || [],
      league: "WNBA",
      slateDate: today,
      dayBucket: "TODAY",
    },
    {
      props: board.bestSixDisplayTomorrowWNBA || [],
      league: "WNBA",
      slateDate: options.tomorrow || addDays(today, 1),
      dayBucket: "TOMORROW",
    },
    {
      props: board.bestSixDisplayTodayNBA || [],
      league: "NBA",
      slateDate: today,
      dayBucket: "TODAY",
    },
    {
      props: board.bestSixDisplayTomorrowNBA || [],
      league: "NBA",
      slateDate: options.tomorrow || addDays(today, 1),
      dayBucket: "TOMORROW",
    },
  ];
  for (const pair of pairs) {
    if (!pair.props.length) continue;
    const sealed = pair.props.some(
      (p) => p.immutableOfficial || p.sealedAt || p.officialSealedAt
    );
    const record = buildCanonicalSlateRecord({
      league: pair.league,
      slateDate: pair.slateDate,
      dayBucket: pair.dayBucket,
      props: pair.props,
      lifecycle: sealed ? LIFECYCLE.SEALED : LIFECYCLE.DRAFT,
      buildVersion: board.serverBuild || STATE_INTEGRITY_BUILD,
      sealedAt: sealed
        ? pair.props.find((p) => p.sealedAt || p.officialSealedAt)?.sealedAt ||
          pair.props.find((p) => p.officialSealedAt)?.officialSealedAt ||
          new Date().toISOString()
        : null,
    });
    const result = upsertCanonicalSlate(record, {
      source: options.source || "syncBoardToCanonicalStore",
      storePath: options.storePath,
      protectSealedDecisions: sealed,
    });
    synced.push({
      slateId: record.slateId,
      dayBucket: pair.dayBucket,
      propCount: pair.props.length,
      reason: result.reason,
    });
  }
  return { ok: true, synced };
}

function addDays(yyyyMmDd, days) {
  const [y, m, d] = String(yyyyMmDd)
    .split("-")
    .map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Rollover: sealed Tomorrow becomes Today with same IDs/hashes.
 */
export function rolloverSealedTomorrowToToday(storeOrOptions = {}, maybeOptions) {
  const options =
    maybeOptions ||
    (storeOrOptions.storePath || storeOrOptions.today
      ? storeOrOptions
      : {});
  const storePath = options.storePath || STORE_FILE;
  const store = loadCanonicalStore(storePath);
  const today = options.today || getCanonicalSlateDate();
  const yesterday = options.yesterday || addDays(today, -1);
  const league = options.league || "WNBA";
  const tomorrowId = buildCanonicalSlateId({
    league,
    slateDate: today,
    cohort: "official-best6",
  });
  // Sealed "tomorrow" for calendar-yesterday was stored under tomorrow's date (= today now)
  // Look for slate that was dayBucket TOMORROW with slateDate === today
  let sealed = store.slates[tomorrowId];
  if (!sealed) {
    // Also accept explicit yesterday→today mapping via options.previousTomorrowSlateId
    const altId = options.previousTomorrowSlateId;
    if (altId) sealed = store.slates[altId];
  }
  if (!sealed || !sealed.sealed) {
    return {
      ok: true,
      action: "no_sealed_tomorrow",
      message: "No sealed tomorrow slate to promote; draft may refresh under pre-seal rules",
      today,
      yesterday,
    };
  }
  // Identity must remain the same slateId (league|date|cohort|market) + hashes.
  // Only dayBucket metadata flips TOMORROW → TODAY; decision packets stay frozen.
  const sameHashes = (sealed.decisionPackets || []).map((p) => p.contentHash);
  const next = {
    ...sealed,
    dayBucket: "TODAY",
    recordVersion: Number(sealed.recordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
    rolloverVerifiedAt: new Date().toISOString(),
  };
  store.slates[sealed.slateId] = next;
  saveCanonicalStore(store, storePath);
  appendTransition(
    {
      slateId: sealed.slateId,
      fromState: sealed.lifecycle || LIFECYCLE.SEALED,
      toState: sealed.lifecycle || LIFECYCLE.SEALED,
      reason: "tomorrow_to_today_rollover_identity_preserved",
      source: "rolloverSealedTomorrowToToday",
      beforeHash: sealed.slateContentHash,
      afterHash: sealed.slateContentHash,
      success: true,
    },
    options.journalPath || JOURNAL_FILE
  );
  return {
    ok: true,
    action: "promoted_identity_preserved",
    slateId: sealed.slateId,
    propIds: (sealed.decisionPackets || []).map((p) => p.officialPropId || p.propId),
    contentHashes: sameHashes,
    sealedAt: sealed.sealedAt,
    slateContentHash: sealed.slateContentHash,
    dayBucket: "TODAY",
  };
}

export function assertSealedImmutability(surfaces = {}) {
  const hashes = Object.entries(surfaces).map(([name, packets]) => {
    const list = (packets || []).map((p) => p.contentHash || hashDecisionPacket(p));
    return { name, hash: sha256Hex(stableStringify(list.sort())), list };
  });
  const first = hashes[0]?.hash;
  const ok = hashes.every((h) => h.hash === first);
  return { ok, hashes };
}

export function assertTrackAllSix(homeProps = [], resultsProps = []) {
  const home = (homeProps || []).length;
  const results = (resultsProps || []).length;
  return {
    ok: home === 6 && results === 6,
    homeOfficialCount: home,
    resultsOriginalCount: results,
    resultsTrackedCount: results,
  };
}

export function assertTodayTomorrowIsolation(before, afterTodayRefresh) {
  const keys = ["bestSixDisplayTomorrowWNBA", "bestSixDisplayTomorrowNBA"];
  for (const key of keys) {
    const a = stableStringify(before?.[key] || []);
    const b = stableStringify(afterTodayRefresh?.[key] || []);
    if (a !== b) {
      return { ok: false, brokenKey: key };
    }
  }
  return { ok: true };
}

/**
 * Attach content hashes to Best 6 display lists in memory (read path).
 * Does not regenerate decisions — only fills identity + hash fields.
 */
export function ensureBoardContentHashes(board) {
  if (!board || typeof board !== "object") return board;
  const keys = [
    "bestSixDisplayTodayWNBA",
    "bestSixDisplayTodayNBA",
    "bestSixDisplayTomorrowWNBA",
    "bestSixDisplayTomorrowNBA",
    "bestSixDisplayWNBA",
    "bestSixDisplayNBA",
  ];
  const out = { ...board };
  for (const key of keys) {
    const list = out[key];
    if (!Array.isArray(list) || !list.length) continue;
    out[key] = list.map((p) =>
      p?.contentHash ? p : attachContentHash(p, { slateDate: p?.slateDate })
    );
  }
  return out;
}

/**
 * Newest Lab-eligible slate date from canonical lifecycle store.
 * Prefers GRADED_COMPLETE / IN_LAB / IN_HISTORY over insertion order.
 */
export function resolveNewestEligibleLabSlateDate(storePath = STORE_FILE) {
  const eligibleLifecycles = new Set([
    LIFECYCLE.GRADED_COMPLETE,
    LIFECYCLE.IN_LAB,
    LIFECYCLE.IN_HISTORY,
  ]);
  const dates = listCanonicalSlates(storePath)
    .filter(
      (s) =>
        eligibleLifecycles.has(s.lifecycle) &&
        (s.decisionPackets || s.props || []).length >= 6
    )
    .map((s) => String(s.slateDate || "").slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return dates.slice(-1)[0] || null;
}

export function buildStateIntegritySnapshot(options = {}) {
  const store = loadCanonicalStore(options.storePath || STORE_FILE);
  const journal = loadJournal(options.journalPath || JOURNAL_FILE);
  const rejected = getRejectedWrites(20);
  const slates = Object.values(store.slates || {});
  return {
    ok: true,
    buildVersion: STATE_INTEGRITY_BUILD,
    schemaVersion: STATE_INTEGRITY_SCHEMA,
    capturedAt: new Date().toISOString(),
    canonicalSlateCount: slates.length,
    slates: slates.map((s) => ({
      slateId: s.slateId,
      slateDate: s.slateDate,
      league: s.league,
      dayBucket: s.dayBucket,
      lifecycle: s.lifecycle,
      sealed: s.sealed,
      propCount: (s.decisionPackets || []).length,
      recordVersion: s.recordVersion,
      slateContentHash: s.slateContentHash,
      completeness: s.completeness,
      sealedAt: s.sealedAt,
    })),
    lastTransitions: (journal.entries || []).slice(-20),
    rejectedWrites: rejected,
    paidApiCallCount: getPaidApiCallCount(),
    storeUpdatedAt: store.updatedAt,
  };
}

export function logStateIntegrityEvent(fields = {}) {
  const row = {
    channel: "courtedge-state-integrity",
    buildVersion: STATE_INTEGRITY_BUILD,
    at: new Date().toISOString(),
    ...fields,
  };
  // Structured single-line JSON for Render log drains
  console.log(JSON.stringify(row));
  return row;
}

export const STATE_INTEGRITY_PATHS = Object.freeze({
  STORE_FILE,
  JOURNAL_FILE,
  LOCKS_FILE,
  REJECTED_WRITES_FILE,
});
