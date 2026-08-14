/**
 * CourtEdge Lifecycle Unblock V1
 *
 * An old unresolved slate may NOT indefinitely block a newer completed slate.
 * Quarantine aged blockers as UNRESOLVED with explicit cause.
 *
 * Pure helpers — no imports from slateScopeService (avoid cycles).
 */
export const LIFECYCLE_UNBLOCK_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

export const MAX_BLOCK_AGE_DAYS = Number(
  process.env.COURTEDGE_RESULTS_MAX_BLOCK_AGE_DAYS || 3
);

function dateDiffDays(earlier, later) {
  const a = String(earlier || "");
  const b = String(later || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

export function isLifecycleQuarantinedProp(prop = {}) {
  return (
    prop.lifecycleQuarantine === true ||
    String(prop.result?.grade || "").toUpperCase() === "UNRESOLVED" ||
    String(prop.status || "").toUpperCase() === "UNRESOLVED" ||
    String(prop.integrity?.lifecycleStatus || "").toUpperCase() ===
      "QUARANTINED_UNRESOLVED"
  );
}

export function shouldQuarantineBlockingSlate(
  slateDate,
  today,
  maxAgeDays = MAX_BLOCK_AGE_DAYS
) {
  const age = dateDiffDays(slateDate, today);
  if (age == null) return false;
  return age > maxAgeDays;
}

export function isResolvedLikeStatus(status = "") {
  return ["win", "loss", "push", "void"].includes(
    String(status || "").toLowerCase()
  );
}

/**
 * Apply unblock policy to a legacy blocking slate date.
 * Returns { activeResultsSlateDate, quarantinedSlates, reason }.
 */
export function applyResultsPointerUnblockPolicy({
  today,
  yesterday,
  legacyBlockingSlateDate = null,
  todayOfficialCount = 0,
  unresolvedOfficialByDate = {},
} = {}) {
  if (todayOfficialCount > 0) {
    return {
      activeResultsSlateDate: today,
      quarantinedSlates: [],
      reason: "TODAY_OFFICIAL_COHORT_OPEN",
      build: LIFECYCLE_UNBLOCK_BUILD,
    };
  }

  const quarantinedSlates = [];
  const dates = Object.keys(unresolvedOfficialByDate || {}).sort();

  for (const d of dates) {
    if (d === today || d === yesterday) continue;
    if (shouldQuarantineBlockingSlate(d, today)) {
      quarantinedSlates.push({
        slateDate: d,
        reason: "STALE_BLOCKER_EXCEEDED_MAX_AGE",
        unresolvedCount: unresolvedOfficialByDate[d] || 0,
        maxBlockAgeDays: MAX_BLOCK_AGE_DAYS,
      });
    }
  }

  const legacy = legacyBlockingSlateDate ? String(legacyBlockingSlateDate) : null;
  if (
    legacy &&
    !shouldQuarantineBlockingSlate(legacy, today) &&
    (unresolvedOfficialByDate[legacy] || 0) > 0
  ) {
    return {
      activeResultsSlateDate: legacy,
      quarantinedSlates,
      reason: "LEGACY_BLOCKER_WITHIN_AGE",
      build: LIFECYCLE_UNBLOCK_BUILD,
    };
  }

  if (legacy && shouldQuarantineBlockingSlate(legacy, today)) {
    if (!quarantinedSlates.some((q) => q.slateDate === legacy)) {
      quarantinedSlates.push({
        slateDate: legacy,
        reason: "STALE_BLOCKER_EXCEEDED_MAX_AGE",
        unresolvedCount: unresolvedOfficialByDate[legacy] || 0,
        maxBlockAgeDays: MAX_BLOCK_AGE_DAYS,
      });
    }
  }

  // Prefer yesterday if still unresolved and not aged out.
  if ((unresolvedOfficialByDate[yesterday] || 0) > 0) {
    return {
      activeResultsSlateDate: yesterday,
      quarantinedSlates,
      reason: "YESTERDAY_OFFICIAL_UNRESOLVED",
      build: LIFECYCLE_UNBLOCK_BUILD,
    };
  }

  // Newest non-quarantined unresolved official date.
  const candidates = dates
    .filter((d) => d < today)
    .filter((d) => !shouldQuarantineBlockingSlate(d, today))
    .filter((d) => (unresolvedOfficialByDate[d] || 0) > 0)
    .sort()
    .reverse();

  return {
    activeResultsSlateDate: candidates[0] || null,
    quarantinedSlates,
    reason: candidates[0] ? "NEWEST_UNRESOLVED_WITHIN_AGE" : "NO_ACTIVE_RESULTS_COHORT",
    build: LIFECYCLE_UNBLOCK_BUILD,
  };
}

export function stampQuarantineUnresolved(prop = {}, reason = "STALE_UNRESOLVED_BLOCKER") {
  return {
    ...prop,
    lifecycleQuarantine: true,
    status:
      String(prop.status || "pending").toLowerCase() === "pending"
        ? "unresolved"
        : prop.status,
    pendingReason: prop.pendingReason || reason,
    result: {
      ...(prop.result || {}),
      status: "UNRESOLVED",
      grade: "UNRESOLVED",
      gameFinal: Boolean(prop.resolveDebug?.gameFinal || prop.gameFinal),
      unresolvedReason: reason,
      gradedAt: new Date().toISOString(),
      gradeSource: LIFECYCLE_UNBLOCK_BUILD,
    },
    integrity: {
      ...(prop.integrity || {}),
      lifecycleStatus: "QUARANTINED_UNRESOLVED",
    },
  };
}
