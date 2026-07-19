/**
 * CourtEdge Engine Expansion — Availability / Roster Engine.
 *
 * Evidence order (strictly in this priority):
 *   1. injury status (structured injury feed row)
 *   2. game status (generic status string, e.g. box score / lineup feed)
 *   3. recent participation (did the player actually take the floor lately)
 *   4. schedule (schedule gap — informational ONLY, never implies inactive)
 *   5. prop market (is a market even open for this player)
 *   6. roster (team/roster context, when supplied)
 *   7. provider health (last resort — a feed failure is NOT the same as "out")
 *
 * A schedule gap is never treated as evidence of inactivity, and a provider
 * failure is never treated as evidence the player is out. Both are reported
 * as their own honest state (STATUS_UNAVAILABLE / PROVIDER_ERROR).
 */
import {
  numOrNull,
  clamp,
  first,
  baseEngineSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const AVAILABILITY_ROSTER_ENGINE = "availabilityRosterEngine";

export const AVAILABILITY_STATE = Object.freeze({
  CONFIRMED_ACTIVE: "CONFIRMED_ACTIVE",
  EXPECTED_ACTIVE: "EXPECTED_ACTIVE",
  QUESTIONABLE: "QUESTIONABLE",
  DOUBTFUL: "DOUBTFUL",
  OUT: "OUT",
  STATUS_UNAVAILABLE: "STATUS_UNAVAILABLE",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

function normalizeStatusText(value) {
  return String(value || "").trim().toLowerCase();
}

function classifyStatusText(text = "") {
  if (!text) return null;
  if (
    text.includes("out") ||
    text.includes("inactive") ||
    text.includes("suspended") ||
    text.includes("injured reserve") ||
    text.includes("ineligible") ||
    text.includes("not with team")
  ) {
    return AVAILABILITY_STATE.OUT;
  }
  if (text.includes("doubtful")) return AVAILABILITY_STATE.DOUBTFUL;
  if (
    text.includes("questionable") ||
    text.includes("game time decision") ||
    text.includes("gtd") ||
    text.includes("probable")
  ) {
    return AVAILABILITY_STATE.QUESTIONABLE;
  }
  if (text.includes("active") || text.includes("confirmed") || text.includes("starting")) {
    return AVAILABILITY_STATE.CONFIRMED_ACTIVE;
  }
  if (text.includes("expected")) return AVAILABILITY_STATE.EXPECTED_ACTIVE;
  return null;
}

function recentParticipation(gameLogs = []) {
  const recent = (gameLogs || []).slice(0, 3);
  if (!recent.length) return { available: false, playedRecently: null, sampleSize: 0 };
  const minutesSeen = recent
    .map((g) => numOrNull(g?.minutes))
    .filter((v) => v !== null);
  if (!minutesSeen.length) return { available: false, playedRecently: null, sampleSize: 0 };
  const playedRecently = minutesSeen.some((m) => m > 0);
  return { available: true, playedRecently, sampleSize: minutesSeen.length };
}

export function evaluateAvailabilityRoster(ctx = {}) {
  const injuryRow = ctx.injuryRow || null;
  const availabilityStatus = ctx.availabilityStatus;
  const injuryFeedOk = ctx.injuryFeedOk !== false; // undefined => assume ok unless told otherwise
  const propMarketActive = typeof ctx.propMarketActive === "boolean" ? ctx.propMarketActive : null;
  const scheduleGapDays = numOrNull(ctx.scheduleGapDays);
  const providerHealth = ctx.providerHealth || {};
  const providerOk = providerHealth.ok !== false && providerHealth.status !== "ERROR";
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];

  const evidenceTrail = [];
  let state = null;

  // Prefer already-classified availability from wnbaAvailabilityService adapter
  // so we do not triple-classify the same injury text.
  if (ctx.availabilityMappedState) {
    state = ctx.availabilityMappedState;
    evidenceTrail.push(
      `legacy availability adapter: ${ctx.legacyUpstream?.availability?.injuryClassification?.level || "mapped"} -> ${state}`
    );
  }

  // 1. injury status (structured row wins over a bare string when both exist).
  const injuryStatusText = normalizeStatusText(
    first(injuryRow?.status, injuryRow?.description, injuryRow?.injuryStatus)
  );
  if (!state) {
    state = classifyStatusText(injuryStatusText);
    if (state) evidenceTrail.push(`injury feed: "${injuryStatusText}" -> ${state}`);
  }

  // 2. game status (generic status string / lineup feed).
  if (!state) {
    const gameStatusText = normalizeStatusText(availabilityStatus);
    state = classifyStatusText(gameStatusText);
    if (state) evidenceTrail.push(`game status: "${gameStatusText}" -> ${state}`);
  }

  // 3. recent participation — corroborating only, never overrides an explicit status.
  const participation = recentParticipation(gameLogs);
  if (!state && participation.available) {
    state = participation.playedRecently
      ? AVAILABILITY_STATE.EXPECTED_ACTIVE
      : null; // absence of recent minutes alone is NOT evidence of "out"
    if (state) {
      evidenceTrail.push(
        `recent participation: played in ${participation.sampleSize} of last checked games -> ${state}`
      );
    }
  }

  // 4. schedule gap — informational only. Explicitly does NOT change state.
  const scheduleGapNote =
    scheduleGapDays !== null
      ? `schedule gap of ${scheduleGapDays}d noted (not treated as inactivity evidence)`
      : null;
  if (scheduleGapNote) evidenceTrail.push(scheduleGapNote);

  // 5. prop market — corroborating only.
  if (!state && propMarketActive === false) {
    evidenceTrail.push("prop market closed for this player (corroborating signal only)");
  }

  // 6. roster context — accepted if caller supplies it, otherwise skipped (not fabricated).
  if (!state && ctx.rosterStatus) {
    const rosterText = normalizeStatusText(ctx.rosterStatus);
    const rosterState = classifyStatusText(rosterText);
    if (rosterState) {
      state = rosterState;
      evidenceTrail.push(`roster status: "${rosterText}" -> ${rosterState}`);
    }
  }

  // 7. provider health — last resort. Distinguishes "we don't know" from "provider is broken".
  const providerFailed = !injuryFeedOk || !providerOk;
  if (!state) {
    state = providerFailed ? AVAILABILITY_STATE.PROVIDER_ERROR : AVAILABILITY_STATE.STATUS_UNAVAILABLE;
    evidenceTrail.push(
      providerFailed
        ? "no usable status from any evidence source and provider health degraded -> PROVIDER_ERROR"
        : "no usable status from any evidence source, provider healthy -> STATUS_UNAVAILABLE"
    );
  }

  const sampleSize = participation.sampleSize;
  let quality;
  if (state === AVAILABILITY_STATE.PROVIDER_ERROR) quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  else if (state === AVAILABILITY_STATE.STATUS_UNAVAILABLE) quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  else if (injuryRow) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (availabilityStatus) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;

  const available = state !== AVAILABILITY_STATE.STATUS_UNAVAILABLE && state !== AVAILABILITY_STATE.PROVIDER_ERROR;

  // Availability is not an Over/Under vote — it never casts one. It only
  // moves confidence/risk on the pick that already exists.
  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  switch (state) {
    case AVAILABILITY_STATE.OUT:
      confidenceAdjustment = -12;
      riskAdjustment = RISK_ADJUSTMENT.ELEVATE;
      break;
    case AVAILABILITY_STATE.DOUBTFUL:
      confidenceAdjustment = -8;
      riskAdjustment = RISK_ADJUSTMENT.ELEVATE;
      break;
    case AVAILABILITY_STATE.QUESTIONABLE:
      confidenceAdjustment = -4;
      riskAdjustment = RISK_ADJUSTMENT.MONITOR;
      break;
    case AVAILABILITY_STATE.EXPECTED_ACTIVE:
      confidenceAdjustment = 1;
      riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
      break;
    case AVAILABILITY_STATE.CONFIRMED_ACTIVE:
      confidenceAdjustment = 2;
      riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
      break;
    case AVAILABILITY_STATE.PROVIDER_ERROR:
      confidenceAdjustment = 0;
      riskAdjustment = RISK_ADJUSTMENT.MONITOR;
      break;
    default:
      confidenceAdjustment = 0;
      riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  }

  return baseEngineSignal({
    engine: AVAILABILITY_ROSTER_ENGINE,
    available,
    source: injuryRow ? "injury_feed" : availabilityStatus ? "game_status_feed" : "participation_inference",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    error: state === AVAILABILITY_STATE.PROVIDER_ERROR ? "provider_health_degraded" : null,
    fallbackUsed: !injuryRow && !availabilityStatus && participation.available,
    rawValues: {
      injuryRow,
      availabilityStatus,
      injuryFeedOk,
      propMarketActive,
      scheduleGapDays,
      providerHealth,
      recentParticipation: participation,
    },
    normalizedSignal: 0,
    overContribution: 0,
    underContribution: 0,
    confidenceAdjustment,
    riskAdjustment,
    reason: evidenceTrail.join(" | "),
    units: null,

    status: state,
    evidenceTrail,
    scheduleGapIsInactivityEvidence: false,
    providerFailureIsOutEvidence: false,
  });
}
