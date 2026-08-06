/**
 * CourtEdge slate membership integrity — Aug 5 quarantine + relock lineage.
 * Build: courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1
 *
 * Does NOT rewrite Official prop identities. Invalidated slates keep grades
 * for diagnostics but are excluded from Official W-L / calibration.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");

export const MEMBERSHIP_INTEGRITY_BUILD =
  "courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1";

export const MEMBERSHIP_INTEGRITY_STATUS = Object.freeze({
  VALID: "VALID",
  INVALIDATED: "INVALIDATED",
});

export const STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED =
  "STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED";

export const AUG5_INCIDENT_CODE = "AUG5_WRONG_BOARD_RELOCK";

export const AUG5_INCIDENT_DIR = path.join(
  SERVER_ROOT,
  "backups",
  "incidents",
  "courteedge-aug5-membership-relock-incident-v1"
);

/** Intended clear-side reconstruction (diagnostic only — not Official). */
export const AUG5_INTENDED_CLEAR_SIDE_IDS = Object.freeze([
  "Rhyne Howard|UNDER|17.5|atlantadream",
  "Kelsey Plum|OVER|16.5|phoenixmercury",
  "Nneka Ogwumike|UNDER|18.5|losangelessparks",
  "Flau'jae Johnson|OVER|15.5|seattlestorm",
]);

export const AUG5_INTEGRITY_WARNING =
  "Slate excluded from Official record: membership was relocked from an obsolete 16-prop board.";

/** Built-in invalidation map (date → fields). Persisted onto lock registry when applied. */
export const SLATE_INTEGRITY_INVALIDATIONS = Object.freeze({
  "2026-08-05": Object.freeze({
    officialRecordEligible: false,
    calibrationEligible: false,
    membershipIntegrityStatus: MEMBERSHIP_INTEGRITY_STATUS.INVALIDATED,
    membershipIncidentCode: AUG5_INCIDENT_CODE,
    incorrectMembershipCount: 16,
    intendedReconstructionCount: 4,
    retroactiveOfficialCorrectionAllowed: false,
    diagnosticGradingAllowed: true,
    incidentReportPath:
      "backups/incidents/courteedge-aug5-membership-relock-incident-v1/",
    invalidatedAt: "2026-08-06T04:30:00.000Z",
    invalidatedByBuild: MEMBERSHIP_INTEGRITY_BUILD,
    integrityWarning: AUG5_INTEGRITY_WARNING,
    intendedReconstructionLabel: "INTENDED_CLEAR_SIDE_RECONSTRUCTION",
    recordedCorruptedMembershipLabel: "RECORDED_CORRUPTED_MEMBERSHIP",
  }),
});

const OBSOLETE_SELECTION_MODES = new Set([
  "BEST_SIX",
  "BEST6",
  "FIXED_BEST_SIX",
  "LEGACY_BEST_SIX",
  "TOP_SIX",
  "HOME_DISPLAY",
  "DISPLAY_ROWS",
  "TRACKED_RESULTS",
  "RESULTS_ROWS",
]);

const ALLOWED_SOURCE_TYPES = new Set([
  "CANONICAL_BOARD",
  "ACTIVE_BUNDLE",
  "OFFICIAL_SEAL_SNAPSHOT",
  "STARTUP_REHYDRATE_CANONICAL",
]);

export function propMembershipIdentity(prop = {}) {
  const player = String(prop.playerName || prop.player || "").trim();
  const side = String(prop.side || prop.pick || "")
    .trim()
    .toUpperCase();
  const line = prop.line ?? prop.lockedLine ?? prop.currentLine ?? "";
  const team = String(prop.team || prop.teamKey || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return `${player}|${side}|${line}|${team}`;
}

export function hashMembershipIdentities(props = []) {
  const ids = (Array.isArray(props) ? props : [])
    .map(propMembershipIdentity)
    .filter(Boolean)
    .sort();
  return crypto.createHash("sha256").update(ids.join("\n")).digest("hex");
}

export function getSlateIntegrityInvalidation(slateDate) {
  const date = String(slateDate || "");
  return SLATE_INTEGRITY_INVALIDATIONS[date] || null;
}

export function isOfficialRecordEligible(slateDate, entryOrSnapshot = null) {
  const inv = getSlateIntegrityInvalidation(slateDate);
  if (inv && inv.officialRecordEligible === false) return false;
  if (entryOrSnapshot?.officialRecordEligible === false) return false;
  if (
    String(entryOrSnapshot?.membershipIntegrityStatus || "").toUpperCase() ===
    MEMBERSHIP_INTEGRITY_STATUS.INVALIDATED
  ) {
    return false;
  }
  return true;
}

export function isCalibrationEligible(slateDate, entryOrSnapshot = null) {
  const inv = getSlateIntegrityInvalidation(slateDate);
  if (inv && inv.calibrationEligible === false) return false;
  if (entryOrSnapshot?.calibrationEligible === false) return false;
  if (
    String(entryOrSnapshot?.membershipIntegrityStatus || "").toUpperCase() ===
    MEMBERSHIP_INTEGRITY_STATUS.INVALIDATED
  ) {
    return false;
  }
  return true;
}

export function buildSlateIntegrityPacket(slateDate, options = {}) {
  const date = String(slateDate || "");
  const inv = getSlateIntegrityInvalidation(date);
  const entry = options.entry || options.snapshot || null;
  if (!inv && !entry?.membershipIntegrityStatus) {
    return {
      slateDate: date,
      membershipIntegrityStatus: MEMBERSHIP_INTEGRITY_STATUS.VALID,
      officialRecordEligible: true,
      calibrationEligible: true,
      build: MEMBERSHIP_INTEGRITY_BUILD,
    };
  }
  const base = inv
    ? { ...inv }
    : {
        officialRecordEligible: entry.officialRecordEligible !== false,
        calibrationEligible: entry.calibrationEligible !== false,
        membershipIntegrityStatus:
          entry.membershipIntegrityStatus || MEMBERSHIP_INTEGRITY_STATUS.VALID,
        membershipIncidentCode: entry.membershipIncidentCode || null,
        integrityWarning: entry.integrityWarning || null,
      };
  return {
    slateDate: date,
    ...base,
    build: MEMBERSHIP_INTEGRITY_BUILD,
    recordedCorruptedMembership: options.recordedProps
      ? {
          label: base.recordedCorruptedMembershipLabel || "RECORDED_CORRUPTED_MEMBERSHIP",
          propCount: options.recordedProps.length,
          identities: options.recordedProps.map(propMembershipIdentity),
          gradesDiagnosticOnly: true,
        }
      : undefined,
    intendedClearSideReconstruction: options.intendedIdentities
      ? {
          label: "INTENDED_CLEAR_SIDE_RECONSTRUCTION",
          propCount: options.intendedIdentities.length,
          identities: options.intendedIdentities,
          official: false,
          diagnosticGradesOnly: true,
        }
      : date === "2026-08-05"
        ? {
            label: "INTENDED_CLEAR_SIDE_RECONSTRUCTION",
            propCount: AUG5_INTENDED_CLEAR_SIDE_IDS.length,
            identities: [...AUG5_INTENDED_CLEAR_SIDE_IDS],
            official: false,
            diagnosticGradesOnly: true,
          }
        : undefined,
  };
}

/**
 * Gate any path that would write/replace Official membership from a payload.
 */
export function assertCanonicalMembershipLineage(payload = {}, options = {}) {
  const reason = STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED;
  const props = Array.isArray(payload.props)
    ? payload.props
    : Array.isArray(payload)
      ? payload
      : [];
  const sourceType = String(
    payload.membershipSourceType || options.membershipSourceType || ""
  ).toUpperCase();
  const selectionMode = String(
    payload.selectionMode || options.selectionMode || ""
  ).toUpperCase();
  const boardVersion = String(
    payload.canonicalBoardVersion ||
      payload.boardVersion ||
      options.canonicalBoardVersion ||
      ""
  );
  const slateDate = String(
    payload.slateDate || options.slateDate || ""
  );
  const expectedDate = String(options.expectedSlateDate || slateDate || "");

  const failures = [];

  if (options.requireSourceType !== false) {
    if (!sourceType || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      failures.push(`membershipSourceType=${sourceType || "missing"}`);
    }
  }

  if (OBSOLETE_SELECTION_MODES.has(selectionMode)) {
    failures.push(`obsolete_selectionMode=${selectionMode}`);
  }

  if (
    /best.?6|best_six|fixed.?six/i.test(selectionMode) ||
    /best.?6|best_six/i.test(boardVersion)
  ) {
    failures.push("stale_best6_era_payload");
  }

  if (options.forbidHomeDisplay === true || sourceType === "HOME_DISPLAY") {
    failures.push("home_display_cannot_create_membership");
  }
  if (
    options.forbidResultsRows === true ||
    sourceType === "TRACKED_RESULTS" ||
    sourceType === "RESULTS_ROWS"
  ) {
    failures.push("results_rows_cannot_create_membership");
  }

  if (expectedDate && slateDate && expectedDate !== slateDate) {
    failures.push(`slateDate_mismatch:${slateDate}!=${expectedDate}`);
  }

  if (options.expectedEventIds?.length) {
    const got = new Set(
      props
        .map((p) => String(p.eventId || p.gameId || "").trim())
        .filter(Boolean)
    );
    for (const id of options.expectedEventIds) {
      if (!got.has(String(id))) failures.push(`missing_eventId:${id}`);
    }
  }

  if (options.expectedMembershipHash) {
    const hash = hashMembershipIdentities(props);
    if (hash !== options.expectedMembershipHash) {
      failures.push("membershipSourceHash_mismatch");
    }
  }

  if (
    options.maxPropCount != null &&
    props.length > Number(options.maxPropCount)
  ) {
    failures.push(
      `count_expansion:${props.length}>${options.maxPropCount}`
    );
  }

  if (options.rejectPreRepairBestSixExpansion === true && props.length >= 12) {
    // Heuristic: obsolete Best-6-era full boards were 12–16 props.
    const hasLineage =
      payload.membershipSourceHash &&
      payload.membershipSourceBuild &&
      payload.membershipSealedAt;
    if (!hasLineage) {
      failures.push("stale_high_count_without_lineage");
    }
  }

  if (options.requiredBuildLineage) {
    const build =
      payload.membershipSourceBuild || options.membershipSourceBuild || "";
    if (build && build !== options.requiredBuildLineage) {
      // Soft: only fail when caller requires exact match
      if (options.requireExactBuild === true) {
        failures.push(`build_lineage_mismatch:${build}`);
      }
    }
  }

  if (failures.length) {
    return {
      ok: false,
      blocked: true,
      reason,
      hardReason: reason,
      failures,
      build: MEMBERSHIP_INTEGRITY_BUILD,
    };
  }

  return {
    ok: true,
    blocked: false,
    reason: null,
    membershipSourceType: sourceType || null,
    membershipSourceBuild:
      payload.membershipSourceBuild || options.membershipSourceBuild || null,
    membershipSourceCommit:
      payload.membershipSourceCommit || options.membershipSourceCommit || null,
    membershipSourceHash:
      payload.membershipSourceHash || hashMembershipIdentities(props),
    membershipCreatedAt:
      payload.membershipCreatedAt || options.membershipCreatedAt || null,
    membershipSealedAt:
      payload.membershipSealedAt ||
      payload.officialSeal?.sealedAt ||
      options.membershipSealedAt ||
      null,
    selectionMode: selectionMode || null,
    canonicalBoardVersion: boardVersion || null,
    build: MEMBERSHIP_INTEGRITY_BUILD,
  };
}

/**
 * Block converting an obsolete snapshot file into current Official membership.
 */
export function assertSnapshotEligibleForOfficialRelock(snapshot = {}, options = {}) {
  const props = Array.isArray(snapshot.props) ? snapshot.props : [];
  const lockReason = String(snapshot.lockReason || "");
  const selectionMode =
    snapshot.selectionMode ||
    snapshot.membershipModel ||
    (lockReason.includes("BEST_SIX") || lockReason.includes("BEST6")
      ? "BEST_SIX"
      : snapshot.canonicalBoardVersion || "");

  return assertCanonicalMembershipLineage(
    {
      ...snapshot,
      props,
      selectionMode,
      membershipSourceType:
        snapshot.membershipSourceType || options.membershipSourceType || "",
    },
    {
      ...options,
      expectedSlateDate: options.expectedSlateDate || snapshot.slateDate,
      rejectPreRepairBestSixExpansion:
        options.rejectPreRepairBestSixExpansion !== false,
      forbidHomeDisplay: true,
      forbidResultsRows: true,
    }
  );
}

export function attachIntegrityFieldsToLockEntry(entry = {}, slateDate) {
  const inv = getSlateIntegrityInvalidation(slateDate);
  if (!inv) return entry;
  return {
    ...entry,
    ...inv,
    membershipIntegrityBuild: MEMBERSHIP_INTEGRITY_BUILD,
  };
}

export function readIncidentManifestExists() {
  try {
    return fs.existsSync(path.join(AUG5_INCIDENT_DIR, "MANIFEST.json"));
  } catch {
    return false;
  }
}
