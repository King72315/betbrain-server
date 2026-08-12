/**
 * Grade monotonicity guard — resolved tracked props are immutable unless explicitly corrected.
 * Shared by every tracked-prop merge/write path.
 */

const FINAL_STATUSES = new Set(["win", "loss", "push"]);
const PENDING_STATUSES = new Set(["pending", "awaiting_stats", "final_ungraded"]);

export const PROTECTED_GRADE_FIELDS = [
  "status",
  "actualStat",
  "result",
  "resultMargin",
  "margin",
  "gradedAt",
  "resolvedAt",
  "pendingReason",
  "gradingNotes",
  "resolveDebug",
  "currentEngineResult",
  "currentEngineWon",
  "currentEngineMargin",
  "fairLineShadowResult",
  "fairLineShadowWon",
  "fairLineShadowMargin",
  "sideComparison",
  "resultMeta",
  "matchVerified",
  "resultConfidence",
  "matchedDate",
  "matchedGameId",
  "matchedSource",
];

export const LIVE_GRADING_OVERLAY_FIELDS = [
  "status",
  "result",
  "actualStat",
  "margin",
  "resultMargin",
  "gradedAt",
  "resolveDebug",
  "matchedSource",
  "pendingReason",
  "gradingNotes",
  "matchedDate",
  "matchedGameId",
  "matchVerified",
  "resultConfidence",
  "resolvedAt",
  "currentEngineResult",
  "currentEngineWon",
  "currentEngineMargin",
  "fairLineShadowResult",
  "fairLineShadowWon",
  "fairLineShadowMargin",
  "sideComparison",
  "resultMeta",
];

export function isResolvedStatus(status = "") {
  return FINAL_STATUSES.has(String(status || "").toLowerCase());
}

export function isPendingStatus(status = "") {
  const normalized = String(status || "pending").toLowerCase();
  return PENDING_STATUSES.has(normalized);
}

let blockedDowngradeCount = 0;
const recentDowngradeBlocks = [];
const MAX_RECENT_BLOCKS = 50;
let lastResolverPersistenceVerification = null;
let lastStartupIntegrityCheck = null;
let lastReconciliation = null;
const staleSnapshotWarnings = [];

export function resetGradeMonotonicityDiagnosticsForTests() {
  blockedDowngradeCount = 0;
  recentDowngradeBlocks.length = 0;
  lastResolverPersistenceVerification = null;
  lastStartupIntegrityCheck = null;
  lastReconciliation = null;
  staleSnapshotWarnings.length = 0;
}

export function getGradeMonotonicityDiagnostics() {
  return {
    blockedDowngradeCount,
    recentDowngradeBlocks: [...recentDowngradeBlocks],
    lastResolverPersistenceVerification,
    lastStartupIntegrityCheck,
    lastReconciliation,
    staleSnapshotWarnings: [...staleSnapshotWarnings],
  };
}

export function recordGradeDowngradeBlocked(diagnostic = {}) {
  blockedDowngradeCount += 1;
  const event = {
    type: "gradeDowngradeBlocked",
    at: new Date().toISOString(),
    ...diagnostic,
  };
  recentDowngradeBlocks.unshift(event);
  if (recentDowngradeBlocks.length > MAX_RECENT_BLOCKS) {
    recentDowngradeBlocks.pop();
  }
  return event;
}

export function recordStaleSnapshotWarning(warning = {}) {
  const event = {
    type: "staleLockSnapshotPendingWhileLiveResolved",
    at: new Date().toISOString(),
    ...warning,
  };
  staleSnapshotWarnings.unshift(event);
  if (staleSnapshotWarnings.length > MAX_RECENT_BLOCKS) {
    staleSnapshotWarnings.pop();
  }
  return event;
}

export function parseGradeTimestamp(prop = {}) {
  const ts = prop.gradedAt || prop.resolvedAt || prop.updatedAt || null;
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

export function pickNewestResolvedGrade(propA = {}, propB = {}) {
  const aResolved = isResolvedStatus(propA.status);
  const bResolved = isResolvedStatus(propB.status);

  if (aResolved && !bResolved) return { winner: propA, loser: propB, source: "a" };
  if (bResolved && !aResolved) return { winner: propB, loser: propA, source: "b" };
  if (!aResolved && !bResolved) {
    const aTs = parseGradeTimestamp(propA);
    const bTs = parseGradeTimestamp(propB);
    if (bTs >= aTs) return { winner: propB, loser: propA, source: "b" };
    return { winner: propA, loser: propB, source: "a" };
  }

  const aTs = parseGradeTimestamp(propA);
  const bTs = parseGradeTimestamp(propB);
  if (bTs > aTs) return { winner: propB, loser: propA, source: "b" };
  if (aTs > bTs) return { winner: propA, loser: propB, source: "a" };
  return { winner: propB, loser: propA, source: "b" };
}

function extractProtectedFields(prop = {}) {
  const fields = {};
  for (const key of PROTECTED_GRADE_FIELDS) {
    if (prop[key] !== undefined) {
      fields[key] = prop[key];
    }
  }
  return fields;
}

function stripProtectedFields(patch = {}) {
  const next = { ...patch };
  for (const key of PROTECTED_GRADE_FIELDS) {
    delete next[key];
  }
  return next;
}

/**
 * Core guard: pending→final OK; final→pending forbidden; final→different final forbidden
 * unless explicit authorized correction with reason.
 */
export function applyGradeMonotonicityGuard(existing = {}, incoming = {}, options = {}) {
  const sourcePath = options.sourcePath || "unknown";
  const slateDate =
    options.slateDate || existing.slateDate || incoming.slateDate || null;
  const allowCorrection = Boolean(
    options.allowGradeCorrection && options.gradeCorrectionReason
  );

  const existingResolved = isResolvedStatus(existing.status);
  const incomingHasStatus = incoming.status !== undefined && incoming.status !== null;
  const incomingStatus = incomingHasStatus
    ? String(incoming.status).toLowerCase()
    : null;
  const incomingResolved = incomingStatus ? isResolvedStatus(incomingStatus) : false;
  const incomingPending = incomingStatus ? isPendingStatus(incomingStatus) : false;

  let blocked = false;
  let blockReason = null;

  if (existingResolved && incomingHasStatus) {
    if (incomingPending) {
      blocked = true;
      blockReason = "resolved_to_pending";
    } else if (
      incomingResolved &&
      incomingStatus !== String(existing.status || "").toLowerCase()
    ) {
      if (!allowCorrection) {
        blocked = true;
        blockReason = "resolved_to_different_final";
      }
    }
  }

  if (!blocked) {
    return {
      result: { ...existing, ...incoming },
      blocked: false,
      diagnostic: null,
    };
  }

  const preserved = extractProtectedFields(existing);
  const safeIncoming = stripProtectedFields(incoming);

  const diagnostic = recordGradeDowngradeBlocked({
    trackedId: existing.trackedId || existing.trackedKey || null,
    trackedKey: existing.trackedKey || existing.trackedId || null,
    player: existing.player || null,
    slateDate,
    existingStatus: existing.status,
    attemptedStatus: incoming.status,
    sourcePath,
    blockReason,
  });

  return {
    result: { ...existing, ...safeIncoming, ...preserved },
    blocked: true,
    diagnostic,
  };
}

export function overlayLiveGradingFields(snapshotProp = {}, liveProp = {}, options = {}) {
  const { winner, loser } = pickNewestResolvedGrade(snapshotProp, liveProp);
  const merged = { ...snapshotProp };

  if (
    isPendingStatus(snapshotProp.status) &&
    isResolvedStatus(liveProp.status) &&
    winner === liveProp
  ) {
    recordStaleSnapshotWarning({
      trackedId: snapshotProp.trackedId || snapshotProp.trackedKey,
      trackedKey: snapshotProp.trackedKey || snapshotProp.trackedId,
      player: snapshotProp.player,
      slateDate:
        options.slateDate || snapshotProp.slateDate || liveProp.slateDate || null,
      snapshotStatus: snapshotProp.status,
      liveStatus: liveProp.status,
      snapshotGradedAt: snapshotProp.gradedAt || null,
      liveGradedAt: liveProp.gradedAt || null,
      sourcePath: options.sourcePath || "overlayLiveGradingFields",
    });
  }

  for (const field of LIVE_GRADING_OVERLAY_FIELDS) {
    if (winner[field] !== undefined) {
      merged[field] = winner[field];
    }
  }

  if (loser !== winner && isResolvedStatus(winner.status)) {
    const guarded = applyGradeMonotonicityGuard(loser, merged, {
      sourcePath: options.sourcePath || "overlayLiveGradingFields",
      slateDate: merged.slateDate,
    });
    return guarded.result;
  }

  return merged;
}

function propIdentity(prop = {}) {
  return String(prop.trackedKey || prop.trackedId || "");
}

export function verifyResolvedPropsPersisted(expectedProps = [], readBackProps = []) {
  const byKey = new Map();
  for (const prop of readBackProps) {
    const key = propIdentity(prop);
    if (key) byKey.set(key, prop);
  }

  const mismatches = [];
  const missing = [];
  let checkedCount = 0;

  for (const expected of expectedProps) {
    if (!isResolvedStatus(expected.status)) continue;
    checkedCount += 1;
    const key = propIdentity(expected);
    const found = key ? byKey.get(key) : null;

    if (!found) {
      missing.push(key);
      mismatches.push({
        trackedKey: key,
        issue: "missing_after_write",
        expectedStatus: expected.status,
      });
      continue;
    }

    if (!isResolvedStatus(found.status)) {
      mismatches.push({
        trackedKey: key,
        issue: "downgraded_after_write",
        expectedStatus: expected.status,
        actualStatus: found.status,
      });
      continue;
    }

    if (
      expected.actualStat !== undefined &&
      expected.actualStat !== null &&
      found.actualStat !== expected.actualStat
    ) {
      mismatches.push({
        trackedKey: key,
        issue: "actualStat_mismatch",
        expected: expected.actualStat,
        actual: found.actualStat,
      });
    }
  }

  const verification = {
    ok: mismatches.length === 0,
    checkedCount,
    mismatchCount: mismatches.length,
    missingIds: missing,
    mismatches,
    verifiedAt: new Date().toISOString(),
  };

  lastResolverPersistenceVerification = verification;
  return verification;
}

export function reconcileTrackedPropIntegrity({
  trackedProps = [],
  lockedSlates = [],
  getSnapshot = () => null,
} = {}) {
  const activeEntry =
    lockedSlates.find((entry) => String(entry.phase || "").toUpperCase() === "ACTIVE") ||
    null;
  const activeSlateDate = activeEntry?.slateDate || null;

  const slateProps = activeSlateDate
    ? trackedProps.filter((p) => String(p.slateDate || "") === activeSlateDate)
    : [];

  const snapshot = activeSlateDate ? getSnapshot(activeSlateDate) : null;
  const snapshotProps = snapshot?.props || [];

  const snapshotByKey = new Map();
  for (const prop of snapshotProps) {
    const key = propIdentity(prop);
    if (key) snapshotByKey.set(key, prop);
  }

  const missingLockedPropIds = [];
  const gradeMismatchIds = [];
  const resolvedButNotPersisted = [];

  for (const snap of snapshotProps) {
    const key = propIdentity(snap);
    const live = slateProps.find((p) => propIdentity(p) === key);
    if (!live) {
      missingLockedPropIds.push(key);
      continue;
    }

    const liveResolved = isResolvedStatus(live.status);
    const snapResolved = isResolvedStatus(snap.status);

    if (liveResolved && !snapResolved) {
      resolvedButNotPersisted.push(key);
    }

    if (liveResolved && snapResolved) {
      if (
        String(live.status).toLowerCase() !== String(snap.status).toLowerCase() ||
        (live.actualStat !== null &&
          snap.actualStat !== null &&
          live.actualStat !== snap.actualStat)
      ) {
        gradeMismatchIds.push(key);
      }
    }
  }

  const pendingCount = slateProps.filter((p) => isPendingStatus(p.status)).length;
  const gradedCount = slateProps.filter((p) => isResolvedStatus(p.status)).length;

  const reconciliation = {
    activeSlateDate,
    lockedCount: snapshotProps.length,
    storedCount: slateProps.length,
    pendingCount,
    gradedCount,
    missingLockedPropIds,
    gradeMismatchIds,
    resolvedButNotPersisted,
    blockedDowngradeCount,
    reconciledAt: new Date().toISOString(),
  };

  lastReconciliation = reconciliation;
  return reconciliation;
}

export function runStartupIntegrityCheck({
  trackedProps = [],
  lockedSlates = [],
  getSnapshot = () => null,
  readTrackedPropsFile = () => true,
} = {}) {
  const fileReadable = (() => {
    try {
      return Boolean(readTrackedPropsFile());
    } catch {
      return false;
    }
  })();

  const reconciliation = reconcileTrackedPropIntegrity({
    trackedProps,
    lockedSlates,
    getSnapshot,
  });

  const check = {
    ...reconciliation,
    trackedPropsReadable: fileReadable,
    ok:
      fileReadable &&
      reconciliation.missingLockedPropIds.length === 0 &&
      reconciliation.gradeMismatchIds.length === 0 &&
      reconciliation.resolvedButNotPersisted.length === 0 &&
      (reconciliation.activeSlateDate
        ? reconciliation.lockedCount === reconciliation.storedCount
        : true),
    checkedAt: new Date().toISOString(),
  };

  lastStartupIntegrityCheck = check;

  if (!check.ok) {
    console.error(
      "LIFECYCLE INTEGRITY STARTUP CHECK FAILED:",
      JSON.stringify(check, null, 2)
    );
  } else {
    console.log("LIFECYCLE INTEGRITY STARTUP CHECK OK:", check.activeSlateDate || "none");
  }

  return check;
}

export function buildLifecycleIntegrityDiagnostics({
  trackedProps = [],
  lockedSlates = [],
  getSnapshot = () => null,
} = {}) {
  const reconciliation = reconcileTrackedPropIntegrity({
    trackedProps,
    lockedSlates,
    getSnapshot,
  });

  return {
    activeSlateDate: reconciliation.activeSlateDate,
    lockedCount: reconciliation.lockedCount,
    storedCount: reconciliation.storedCount,
    pendingCount: reconciliation.pendingCount,
    gradedCount: reconciliation.gradedCount,
    missingLockedPropIds: reconciliation.missingLockedPropIds,
    gradeMismatchIds: reconciliation.gradeMismatchIds,
    resolvedButNotPersisted: reconciliation.resolvedButNotPersisted,
    blockedDowngradeCount,
    lastResolverPersistenceVerification,
    lastStartupIntegrityCheck,
    lastReconciliation: lastReconciliation || reconciliation,
    recentDowngradeBlocks: recentDowngradeBlocks.slice(0, 10),
    staleSnapshotWarnings: staleSnapshotWarnings.slice(0, 10),
  };
}

export function logLifecycleIntegrityEvent(event = {}) {
  const payload = {
    severity: event.severity || "high",
    type: event.type || "lifecycle_integrity",
    at: new Date().toISOString(),
    ...event,
  };
  console.error("LIFECYCLE INTEGRITY EVENT:", JSON.stringify(payload));
  return payload;
}
