/**
 * CourtEdge Slate Date Verification V1
 * America/Chicago canonical dates + event matching gates.
 * Does not reseal or mutate historical memberships.
 */

import { CONFIG } from "../config.js";

export const SLATE_DATE_VERIFICATION_VERSION = "slate-date-verification-v1";
export const SLATE_DATE_VERIFICATION_BUILD =
  "courteedge-team-balanced-variable-board-date-verification-v1";

export const CT_TIMEZONE = CONFIG.TIMEZONE || "America/Chicago";

export const DATE_BLOCK_REASONS = {
  DATE_MISMATCH: "DATE_MISMATCH — GAME_NOT_ON_REQUESTED_CT_DATE",
  EVENT_ID_MISMATCH: "EVENT_ID_MISMATCH",
  TEAM_MATCHUP_MISMATCH: "TEAM_MATCHUP_MISMATCH",
  STALE_ROW_IDENTITY_DATE: "STALE_ROW_IDENTITY_DATE",
  BUNDLE_DATE_MISMATCH: "BUNDLE_DATE_MISMATCH",
  TODAY_TOMORROW_COHORT_MIX: "TODAY_TOMORROW_COHORT_MIX",
  WRONG_EVENT_INSTANCE: "WRONG_EVENT_INSTANCE",
  DATE_VERIFICATION_INCOMPLETE: "DATE_VERIFICATION_INCOMPLETE",
  SCHEDULE_CHANGED: "SCHEDULE_CHANGED — REBUILD_REQUIRED",
  STALE_BUNDLE_LINEAGE: "STALE_BUNDLE_LINEAGE",
};

function str(value) {
  return value == null ? "" : String(value).trim();
}

export function toCanonicalSlateDate(commenceTime, timeZone = CT_TIMEZONE) {
  const source = str(commenceTime);
  if (!source) return "";
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    const slice = source.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : "";
  }
  return parsed.toLocaleDateString("en-CA", { timeZone });
}

export function formatCommenceTimeCt(commenceTime, timeZone = CT_TIMEZONE) {
  const parsed = new Date(commenceTime || "");
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function getCurrentCtDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: CT_TIMEZONE });
}

export function getNextCtDate(now = new Date()) {
  const today = getCurrentCtDate(now);
  const [y, m, d] = today.split("-").map(Number);
  // Add exactly one calendar day to the CT Y-M-D (avoid +36h DST/UTC skip).
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
export function normalizeTeamToken(value = "") {
  return str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function teamsMatch(a, b) {
  const left = normalizeTeamToken(a);
  const right = normalizeTeamToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function extractRowIdentityDate(pick = {}) {
  const id = str(
    pick.officialPropId || pick.propId || pick.rowIdentity || pick.id || ""
  );
  const m = id.match(/^(\d{4}-\d{2}-\d{2})\|/);
  return m ? m[1] : "";
}

export function resolveProviderEventId(pick = {}) {
  return str(
    pick.providerEventId ||
      pick.oddsEventId ||
      pick.eventId ||
      pick.marketEventId ||
      pick.gameId ||
      pick.game?.id ||
      ""
  );
}

export function resolveOfficialGameId(pick = {}) {
  return str(
    pick.officialGameId ||
      pick.leagueGameId ||
      pick.bdlGameId ||
      pick.espnGameId ||
      ""
  );
}

export function resolveCommenceTimeUtc(pick = {}) {
  return str(
    pick.commenceTimeUtc ||
      pick.commenceTime ||
      pick.time ||
      pick.game?.commenceTime ||
      pick.gameTime ||
      ""
  );
}

export function buildDateFields(pick = {}, options = {}) {
  const requestedSlateDate = str(
    options.requestedSlateDate ||
      pick.requestedSlateDate ||
      pick.slateDate ||
      ""
  );
  const commenceTimeUtc = resolveCommenceTimeUtc(pick);
  // Commence-time CT date is source of truth; do not trust stale pick.canonicalSlateDate.
  const commenceDerived = toCanonicalSlateDate(commenceTimeUtc);
  const canonicalSlateDate =
    commenceDerived ||
    str(pick.canonicalSlateDate) ||
    requestedSlateDate;
  return {
    requestedSlateDate,
    canonicalSlateDate,
    commenceTimeUtc: commenceTimeUtc || null,
    commenceTimeCt: commenceTimeUtc
      ? formatCommenceTimeCt(commenceTimeUtc)
      : pick.commenceTimeCt || null,
    providerEventId: resolveProviderEventId(pick) || null,
    officialGameId: resolveOfficialGameId(pick) || null,
    homeTeam: str(pick.homeTeam || pick.game?.homeTeam || pick.opponent || ""),
    awayTeam: str(pick.awayTeam || pick.game?.awayTeam || pick.team || ""),
    marketEventId: str(pick.marketEventId || resolveProviderEventId(pick) || ""),
    marketFetchedAt: pick.marketFetchedAt || null,
    candidateBuiltAt: pick.candidateBuiltAt || null,
    selectionBuiltAt: pick.selectionBuiltAt || null,
    sourceSnapshotDate: str(pick.sourceSnapshotDate || pick.snapshotDate || ""),
    rowIdentityDate: extractRowIdentityDate(pick) || null,
    bundleDate: str(pick.bundleDate || options.bundleDate || ""),
    timezone: CT_TIMEZONE,
  };
}

/**
 * Verify a candidate belongs on the requested CT slate / game.
 * @param {object} pick
 * @param {object} options
 * @param {string} options.requestedSlateDate
 * @param {object} [options.verifiedGame] — { eventId, homeTeam, awayTeam, commenceTime }
 * @param {string} [options.expectedDayBucket] — TODAY | TOMORROW
 * @param {string} [options.bundleDate]
 */
export function verifyCandidateSlateDate(pick = {}, options = {}) {
  const reasons = [];
  const fields = buildDateFields(pick, options);
  const requested = str(options.requestedSlateDate || fields.requestedSlateDate);
  const verifiedGame = options.verifiedGame || null;

  if (!requested || !fields.canonicalSlateDate) {
    reasons.push(DATE_BLOCK_REASONS.DATE_VERIFICATION_INCOMPLETE);
  } else if (fields.canonicalSlateDate !== requested) {
    reasons.push(DATE_BLOCK_REASONS.DATE_MISMATCH);
  }

  if (fields.rowIdentityDate && requested && fields.rowIdentityDate !== requested) {
    reasons.push(DATE_BLOCK_REASONS.STALE_ROW_IDENTITY_DATE);
  }

  if (fields.bundleDate && requested && fields.bundleDate !== requested) {
    reasons.push(DATE_BLOCK_REASONS.BUNDLE_DATE_MISMATCH);
  }

  if (
    fields.sourceSnapshotDate &&
    requested &&
    fields.sourceSnapshotDate !== requested &&
    /^\d{4}-\d{2}-\d{2}$/.test(fields.sourceSnapshotDate)
  ) {
    // Soft lineage when snapshot explicitly differs
    if (fields.sourceSnapshotDate < requested) {
      reasons.push(DATE_BLOCK_REASONS.STALE_BUNDLE_LINEAGE);
    }
  }

  const expectedBucket = str(options.expectedDayBucket || "").toUpperCase();
  if (expectedBucket === "TODAY" || expectedBucket === "TOMORROW") {
    const pickBucket = str(pick.dayBucket || pick.dateLabel || "").toUpperCase();
    if (
      pickBucket &&
      pickBucket !== expectedBucket &&
      (pickBucket === "TODAY" || pickBucket === "TOMORROW")
    ) {
      reasons.push(DATE_BLOCK_REASONS.TODAY_TOMORROW_COHORT_MIX);
    }
  }

  if (verifiedGame) {
    const gameEventId = str(
      verifiedGame.providerEventId ||
        verifiedGame.eventId ||
        verifiedGame.id ||
        verifiedGame.gameId ||
        ""
    );
    const pickEventId = fields.providerEventId || fields.marketEventId;
    if (gameEventId && pickEventId && gameEventId !== pickEventId) {
      reasons.push(DATE_BLOCK_REASONS.EVENT_ID_MISMATCH);
      reasons.push(DATE_BLOCK_REASONS.WRONG_EVENT_INSTANCE);
    }

    const home = verifiedGame.homeTeam || verifiedGame.home || "";
    const away = verifiedGame.awayTeam || verifiedGame.away || "";
    const pickTeam = pick.team || "";
    const pickOpp = pick.opponent || "";
    if (home && away && pickTeam && pickOpp) {
      const teamOk =
        (teamsMatch(pickTeam, home) || teamsMatch(pickTeam, away)) &&
        (teamsMatch(pickOpp, home) || teamsMatch(pickOpp, away));
      if (!teamOk) reasons.push(DATE_BLOCK_REASONS.TEAM_MATCHUP_MISMATCH);
    }

    const gameCanonical =
      toCanonicalSlateDate(verifiedGame.commenceTime || verifiedGame.commenceTimeUtc) ||
      str(verifiedGame.canonicalSlateDate);
    if (gameCanonical && requested && gameCanonical !== requested) {
      if (!reasons.includes(DATE_BLOCK_REASONS.DATE_MISMATCH)) {
        reasons.push(DATE_BLOCK_REASONS.DATE_MISMATCH);
      }
      if (str(verifiedGame.rescheduled) === "true" || verifiedGame.scheduleChanged) {
        reasons.push(DATE_BLOCK_REASONS.SCHEDULE_CHANGED);
      }
    }
  }

  // Incomplete when we have no commence and no verified game
  if (!fields.commenceTimeUtc && !verifiedGame && !reasons.length) {
    reasons.push(DATE_BLOCK_REASONS.DATE_VERIFICATION_INCOMPLETE);
  }

  const unique = [...new Set(reasons)];
  const ok = unique.length === 0;
  return {
    ok,
    status: ok ? "PASS" : "FAIL",
    dateVerificationStatus: ok ? "PASS" : "FAIL",
    dateVerificationReasons: unique,
    fields: {
      ...fields,
      requestedSlateDate: requested || fields.requestedSlateDate,
      dateVerificationStatus: ok ? "PASS" : "FAIL",
      dateVerificationReasons: unique,
    },
    version: SLATE_DATE_VERIFICATION_VERSION,
    build: SLATE_DATE_VERIFICATION_BUILD,
  };
}

/**
 * Partition events/picks by canonical CT slate date.
 */
export function partitionByCanonicalSlateDate(items = [], getCommence = (x) => x) {
  const buckets = new Map();
  for (const item of items || []) {
    const commence =
      typeof getCommence === "function"
        ? getCommence(item)
        : item?.commenceTime || item?.commenceTimeUtc;
    const date =
      toCanonicalSlateDate(commence) ||
      str(item?.canonicalSlateDate || item?.slateDate || "UNKNOWN");
    if (!buckets.has(date)) buckets.set(date, []);
    buckets.get(date).push(item);
  }
  return buckets;
}

export function annotatePickWithDateFields(pick = {}, options = {}) {
  const verification = verifyCandidateSlateDate(pick, options);
  return {
    ...pick,
    ...verification.fields,
    dateVerificationStatus: verification.status,
    dateVerificationReasons: verification.dateVerificationReasons,
    slateDateVerification: verification,
  };
}
