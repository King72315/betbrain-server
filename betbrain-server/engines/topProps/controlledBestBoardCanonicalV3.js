/**
 * CourtEdge Canonical Controlled Best Board Sealing Path V3
 * Official membership = controlledBestBoardV2.selectedProps only.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  HOME_HISTORY_LOCK_BUILD,
  applySafetyRanking,
  assertNoDuplicateMembership,
  assertSelectionBuildLock,
  LOCK_FAIL,
} from "./variableTeamBoardHomeHistoryLockV1.js";

// Keep version strings inline to avoid circular import with controlledBestBoardV2.
export const CANONICAL_BOARD_VERSION = "controlled-best-board-v2";
export const CANONICAL_BOARD_BUILD =
  "courteedge-clear-side-strong-edge-membership-path-v1";
export const CANONICAL_BOARD_MEMBERSHIP_MODEL = "controlled-best-board-v2";
/** Structural lock supersedes V3 seal build label for new seals. */
export const CANONICAL_BOARD_SEAL_BUILD = HOME_HISTORY_LOCK_BUILD;

export const MEMBERSHIP_FAIL = {
  OFFICIAL_BOARD_MEMBERSHIP_INTEGRITY_FAIL:
    "OFFICIAL_BOARD_MEMBERSHIP_INTEGRITY_FAIL",
  NOT_IN_CONTROLLED_BOARD: "REJECT_OFFICIAL_PROP — NOT_IN_CONTROLLED_BOARD",
  TEAM_SLOT_SIDE_MISMATCH: "TEAM_SLOT_SIDE_MISMATCH",
  STALE_SELECTION_BUILD: "STALE_SELECTION_BUILD",
  DUPLICATE_TEAM_OVER: "DUPLICATE_TEAM_OVER",
  DUPLICATE_TEAM_UNDER: "DUPLICATE_TEAM_UNDER",
  TEAM_CAP_EXCEEDED: "TEAM_CAP_EXCEEDED",
  PLAYER_DUPLICATE: "PLAYER_DUPLICATE",
  SIDE_CHANGED_AFTER_PAIR: "SIDE_CHANGED_AFTER_PAIR",
  DUPLICATE_BOARD_MEMBERSHIP: LOCK_FAIL.DUPLICATE_BOARD_MEMBERSHIP,
};

function str(v) {
  return v == null ? "" : String(v).trim();
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER")) return "OVER";
  if (raw.startsWith("UNDER")) return "UNDER";
  return null;
}

function playerKey(pick = {}) {
  return str(pick.player || pick.playerId)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamKey(pick = {}) {
  return str(pick.teamKey || pick.team || pick.teamName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function boardSelectionId(pick = {}, slateDate = "") {
  if (pick.boardSelectionId) return String(pick.boardSelectionId);
  return [
    slateDate || pick.canonicalSlateDate || pick.slateDate || "",
    pick.providerEventId || pick.gameId || pick.eventId || "",
    teamKey(pick),
    playerKey(pick),
    normalizeSide(pick.side || pick.pick) || "",
    pick.line ?? pick.officialLine ?? "",
    pick.teamSlot || "",
  ].join("|");
}

export function createSelectionBuildId(seed = "") {
  const raw = `${Date.now()}|${randomUUID()}|${seed}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Stamp and freeze canonical membership from V2 board output.
 */
export function buildCanonicalControlledBoardPacket(boardResult = {}, options = {}) {
  const slateDate = str(
    options.requestedSlateDate ||
      boardResult.audit?.requestedSlateDate ||
      boardResult.board?.[0]?.canonicalSlateDate ||
      boardResult.board?.[0]?.slateDate ||
      ""
  );
  const selectionBuildId =
    options.selectionBuildId || createSelectionBuildId(slateDate);

  const stamped = (boardResult.board || boardResult.selectedProps || boardResult.bestSix || []).map(
    (pick, index) => {
      const side = normalizeSide(pick.side || pick.pick);
      const id = boardSelectionId(pick, slateDate);
      return {
        ...pick,
        boardSelectionId: id,
        selectionBuildId,
        membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
        boardVersion: CANONICAL_BOARD_VERSION,
        variableBoardSize: true,
        controlledBestBoard: true,
        controlledBestBoardRank: pick.controlledBestBoardRank || index + 1,
        controlledBestSixDisplay: true,
        sourcePool: "CONTROLLED_BEST_BOARD",
        trackingAdmissionSource: "CONTROLLED_BEST_BOARD",
        organicSide: pick.organicSide || side,
        evaluatedSide: pick.evaluatedSide || side,
        finalSide: side,
        side: side === "UNDER" ? "Under" : "Over",
        pick: side === "UNDER" ? "Under" : "Over",
        sideChanged: false,
        forcedSide: false,
        autoFlip: false,
        resultsAdmissionEligible: true,
        slateDate: slateDate || pick.slateDate,
        canonicalSlateDate: pick.canonicalSlateDate || slateDate,
        requestedSlateDate: pick.requestedSlateDate || slateDate,
        homeHistoryLockBuild: HOME_HISTORY_LOCK_BUILD,
      };
    }
  );

  const dupCheck = assertNoDuplicateMembership(stamped, slateDate);
  const safety = applySafetyRanking(stamped, slateDate);
  const selectedProps = safety.props;

  const packet = {
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    boardVersion: CANONICAL_BOARD_VERSION,
    boardBuild: CANONICAL_BOARD_BUILD,
    sealBuild: CANONICAL_BOARD_SEAL_BUILD,
    homeHistoryLockBuild: HOME_HISTORY_LOCK_BUILD,
    selectionBuildId,
    variableBoardSize: true,
    noGlobalCap: true,
    teamSlotRules: "one-over-one-under-per-team",
    verifiedSlateDate: slateDate,
    timezone: "America/Chicago",
    selectedProps,
    officialCount: selectedProps.length,
    // Removed from active product — empty for API compatibility only
    bestSixOverall: [],
    bestSixOverallCount: 0,
    topPicks: [],
    topPicksRemoved: true,
    bestSixRemoved: true,
    labLifecycleRemoved: true,
    audit: {
      ...(boardResult.audit || boardResult.controlledBestBoardAudit || {}),
      duplicateCheck: dupCheck,
      safetyRankingOk: safety.ok,
    },
    officialMembership: selectedProps,
    controlledBestBoard: { selectedProps },
  };

  const invariants = validateCanonicalBoardInvariants(packet);
  if (!dupCheck.ok) {
    invariants.ok = false;
    invariants.status = MEMBERSHIP_FAIL.DUPLICATE_BOARD_MEMBERSHIP;
    invariants.reasons = [
      ...(invariants.reasons || []),
      MEMBERSHIP_FAIL.DUPLICATE_BOARD_MEMBERSHIP,
    ];
  }
  if (!safety.ok) {
    invariants.ok = false;
    invariants.reasons = [...(invariants.reasons || []), LOCK_FAIL.SAFETY_RANK_INVALID];
  }
  packet.invariants = invariants;
  packet.membershipValid = invariants.ok;
  packet.duplicateCheck = dupCheck;

  return packet;
}

/**
 * Enforce team caps, slot/side match, uniqueness, no post-pair flips.
 */
export function validateCanonicalBoardInvariants(packet = {}) {
  const reasons = [];
  const props = packet.selectedProps || packet.officialMembership || [];
  const byTeam = new Map();
  const players = new Set();
  const ids = new Set();

  for (const pick of props) {
    const id = pick.boardSelectionId || boardSelectionId(pick);
    if (ids.has(id)) reasons.push(`DUPLICATE_BOARD_SELECTION_ID:${id}`);
    ids.add(id);

    const pk = playerKey(pick);
    if (players.has(pk)) reasons.push(`${MEMBERSHIP_FAIL.PLAYER_DUPLICATE}:${pk}`);
    players.add(pk);

    const side = normalizeSide(pick.side || pick.pick || pick.finalSide);
    const slot = String(pick.teamSlot || pick.selectedTeamSlot || "").toUpperCase();
    if (slot.includes("OVER") && side !== "OVER") {
      reasons.push(`${MEMBERSHIP_FAIL.TEAM_SLOT_SIDE_MISMATCH}:${pick.player}`);
    }
    if (slot.includes("UNDER") && side !== "UNDER") {
      reasons.push(`${MEMBERSHIP_FAIL.TEAM_SLOT_SIDE_MISMATCH}:${pick.player}`);
    }
    if (pick.sideChanged === true || pick.forcedSide === true || pick.autoFlip === true) {
      reasons.push(`${MEMBERSHIP_FAIL.SIDE_CHANGED_AFTER_PAIR}:${pick.player}`);
    }

    const tk = teamKey(pick);
    if (!byTeam.has(tk)) byTeam.set(tk, { overs: 0, unders: 0, total: 0 });
    const t = byTeam.get(tk);
    t.total += 1;
    if (side === "OVER") t.overs += 1;
    if (side === "UNDER") t.unders += 1;
  }

  for (const [tk, t] of byTeam.entries()) {
    if (t.overs > 1) reasons.push(`${MEMBERSHIP_FAIL.DUPLICATE_TEAM_OVER}:${tk}`);
    if (t.unders > 1) reasons.push(`${MEMBERSHIP_FAIL.DUPLICATE_TEAM_UNDER}:${tk}`);
    if (t.total > 2) reasons.push(`${MEMBERSHIP_FAIL.TEAM_CAP_EXCEEDED}:${tk}`);
    if (t.overs > 1 || t.unders > 1 || t.total > 2) {
      // already pushed
    }
  }

  // Six-cap must not have been applied as membership truncation signal
  if (
    packet.audit?.sixRowCapApplied === true ||
    packet.slicedToSix === true
  ) {
    reasons.push("SIX_ROW_CAP_APPLIED_TO_MEMBERSHIP");
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    status: unique.length
      ? MEMBERSHIP_FAIL.OFFICIAL_BOARD_MEMBERSHIP_INTEGRITY_FAIL
      : "PASS",
    reasons: unique,
    officialCount: props.length,
    teamCounts: Object.fromEntries(byTeam),
  };
}

/**
 * Before seal: every official prop must be in selectedProps; counts must match.
 */
export function assertOfficialMatchesControlledBoard({
  officialProps = [],
  selectedProps = [],
  selectionBuildId = null,
  sealRequestBuildId = null,
} = {}) {
  const reasons = [];
  const buildLock = assertSelectionBuildLock({
    selectionBuildId,
    sealBuildId: sealRequestBuildId,
  });
  if (!buildLock.ok) {
    reasons.push(MEMBERSHIP_FAIL.STALE_SELECTION_BUILD);
  }
  const dupOfficial = assertNoDuplicateMembership(officialProps);
  const dupBoard = assertNoDuplicateMembership(selectedProps);
  if (!dupOfficial.ok || !dupBoard.ok) {
    reasons.push(MEMBERSHIP_FAIL.DUPLICATE_BOARD_MEMBERSHIP);
  }

  const boardIds = new Set(
    (selectedProps || []).map((p) => p.boardSelectionId || boardSelectionId(p))
  );
  const officialIds = new Set();

  for (const prop of officialProps || []) {
    const id = prop.boardSelectionId || boardSelectionId(prop);
    officialIds.add(id);
    if (!boardIds.has(id)) {
      reasons.push(`${MEMBERSHIP_FAIL.NOT_IN_CONTROLLED_BOARD}:${prop.player}`);
    }
  }

  if ((officialProps || []).length !== (selectedProps || []).length) {
    reasons.push(
      `COUNT_MISMATCH:official=${(officialProps || []).length}:board=${(selectedProps || []).length}`
    );
  }

  for (const id of boardIds) {
    if (!officialIds.has(id)) {
      reasons.push(`BOARD_PROP_MISSING_FROM_OFFICIAL:${id}`);
    }
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    status: unique.length
      ? MEMBERSHIP_FAIL.OFFICIAL_BOARD_MEMBERSHIP_INTEGRITY_FAIL
      : "PASS",
    reasons: unique,
  };
}

export function isCanonicalBoardProp(pick = {}) {
  return (
    pick.membershipModel === CANONICAL_BOARD_MEMBERSHIP_MODEL ||
    pick.boardVersion === CANONICAL_BOARD_VERSION ||
    pick.controlledBestBoard === true ||
    String(pick.sourcePool || "").includes("CONTROLLED_BEST_BOARD")
  );
}

export function shouldUseVariableBoardSeal(props = [], options = {}) {
  if (options.membershipModel === CANONICAL_BOARD_MEMBERSHIP_MODEL) return true;
  if (options.variableBoardSize === true) return true;
  if (options.forceVariableBoard === true) return true;
  // Home-History lock: WNBA always uses full controlled board (no six-cap).
  const list = Array.isArray(props) ? props : [];
  if (
    list.some(
      (p) =>
        String(p.league || "").toUpperCase() === "WNBA" ||
        isCanonicalBoardProp(p)
    )
  ) {
    return true;
  }
  return list.some(isCanonicalBoardProp);
}
