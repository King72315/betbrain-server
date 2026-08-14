/**
 * Official membership selector — production authority.
 *
 * Decision Engine V2 (when promoted): single sort by decisionScoreV2 / modelWinProbability.
 * Legacy SAFEST_2_TO_6 retained only as rollback path when V2 gate is off.
 */
import {
  OFFICIAL_BOARD_MIN,
  OFFICIAL_BOARD_MAX,
  getOfficialBoardSizePolicy,
  resolveC2RankScore,
  resolveAbsoluteDirectionalEdge,
  directionConfidenceRank,
  stableMarketId,
  CONTROL_PLANE_BUILD,
  HIGH_POLICY,
} from "./contract.js";
import {
  selectOfficialMembershipV2,
  isDecisionEngineV2LiveEnabled,
  DECISION_ENGINE_V2_BUILD,
} from "../../services/courtEdgeDecisionEngineV2.js";

function riskTier(packet = {}) {
  const raw =
    (typeof packet.risk === "string" ? packet.risk : null) ||
    packet.risk?.risk ||
    packet.c2Risk ||
    packet.trueRisk ||
    "";
  const r = String(raw).toUpperCase();
  if (r === "LOW" || r === "MEDIUM" || r === "HIGH") return r;
  return "HIGH";
}

function directionAdmissionOf(packet = {}) {
  return String(
    packet.membership?.directionAdmission ||
      packet.direction?.directionAdmission ||
      packet.directionAdmission ||
      ""
  ).toUpperCase();
}

/** PRIMARY outranks BEST_GUESS inside the same C2 tier. */
function admissionRank(packet = {}) {
  return directionAdmissionOf(packet) === "PRIMARY" ? 1 : 0;
}

function compareWithinTier(a, b) {
  const adm = admissionRank(b) - admissionRank(a);
  if (adm !== 0) return adm;

  const rankA = Number(a.officialRankScore);
  const rankB = Number(b.officialRankScore);
  if (Number.isFinite(rankA) && Number.isFinite(rankB) && rankB !== rankA) {
    return rankB - rankA;
  }

  const scoreA = resolveC2RankScore(a);
  const scoreB = resolveC2RankScore(b);
  if (scoreB !== scoreA) return scoreB - scoreA;

  const dirA = directionConfidenceRank(
    a.direction?.confidence ?? a.directionConfidence
  );
  const dirB = directionConfidenceRank(
    b.direction?.confidence ?? b.directionConfidence
  );
  if (dirB !== dirA) return dirB - dirA;

  const edgeA = resolveAbsoluteDirectionalEdge(a);
  const edgeB = resolveAbsoluteDirectionalEdge(b);
  if (edgeB !== edgeA) return edgeB - edgeA;

  return stableMarketId(a).localeCompare(stableMarketId(b));
}

function isBoardCandidate(packet = {}) {
  if (packet.boardCandidate === true) return true;
  if (packet.membership?.boardCandidate === true) return true;
  if (
    packet.membership?.analysisEligible !== false &&
    (packet.selectedSide === "OVER" || packet.selectedSide === "UNDER") &&
    (packet.membership?.directionAdmission === "PRIMARY" ||
      packet.membership?.directionAdmission === "BEST_GUESS" ||
      packet.direction?.directionAdmission === "PRIMARY" ||
      packet.direction?.directionAdmission === "BEST_GUESS") &&
    packet.risk?.risk
  ) {
    return true;
  }
  return false;
}

/**
 * Legacy SAFEST_2_TO_6 — rollback only when Decision Engine V2 gate is off.
 */
function selectOfficialMembershipLegacyV1(packets = [], options = {}) {
  const sizePolicy = getOfficialBoardSizePolicy();
  const pool = (Array.isArray(packets) ? packets : [])
    .filter((p) => isBoardCandidate(p))
    .map((p) => ({
      ...p,
      c2Risk: riskTier(p),
      c2RankScore: resolveC2RankScore(p),
      boardCandidate: true,
      officialSelected: false,
    }));

  const lowMed = pool
    .filter((p) => p.c2Risk === "LOW" || p.c2Risk === "MEDIUM")
    .sort(compareWithinTier);
  const high = pool.filter((p) => p.c2Risk === "HIGH").sort(compareWithinTier);

  let selected = [];
  let thinSlate = false;
  let highFillCount = 0;

  if (lowMed.length >= OFFICIAL_BOARD_MIN) {
    selected = lowMed.slice(0, OFFICIAL_BOARD_MAX);
  } else {
    selected = lowMed.slice();
    const need = Math.max(0, OFFICIAL_BOARD_MIN - selected.length);
    const highPrimary = high.filter((p) => admissionRank(p) === 1);
    const highGuess = high.filter((p) => admissionRank(p) !== 1);
    let highPool = highPrimary.slice();
    if (selected.length + highPool.length < OFFICIAL_BOARD_MIN) {
      highPool = [...highPool, ...highGuess];
    }
    const highTake = highPool.slice(0, need);
    highFillCount = highTake.length;
    selected = [...selected, ...highTake];
    if (pool.length < OFFICIAL_BOARD_MIN) {
      selected = pool.sort(compareWithinTier).slice(0, pool.length);
      thinSlate = true;
      highFillCount = selected.filter((p) => p.c2Risk === "HIGH").length;
    }
  }

  const selectedIds = new Set(selected.map((p) => stableMarketId(p)));
  const withFlags = pool.map((p) => {
    const officialSelected = selectedIds.has(stableMarketId(p));
    return {
      ...p,
      officialSelected,
      officialEligible: officialSelected,
      membership: {
        ...(p.membership || {}),
        analysisEligible: p.membership?.analysisEligible !== false,
        boardCandidate: true,
        officialSelected,
        officialEligible: officialSelected,
      },
    };
  });

  const selectedPackets = withFlags
    .filter((p) => p.officialSelected)
    .sort((a, b) => {
      const order = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      const ra = order[a.c2Risk] ?? 9;
      const rb = order[b.c2Risk] ?? 9;
      if (ra !== rb) return ra - rb;
      return compareWithinTier(a, b);
    });

  return {
    controlPlaneBuild: CONTROL_PLANE_BUILD,
    boardSizePolicy: sizePolicy.policy,
    highPolicy: HIGH_POLICY,
    officialBoardMin: sizePolicy.min,
    officialBoardMax: sizePolicy.max,
    boardCandidateCount: pool.length,
    officialCount: selectedPackets.length,
    lowCount: selectedPackets.filter((p) => p.c2Risk === "LOW").length,
    mediumCount: selectedPackets.filter((p) => p.c2Risk === "MEDIUM").length,
    highFillCount,
    thinSlate,
    thinSlateReason: thinSlate
      ? "FEWER_THAN_TWO_VALID_BOARD_CANDIDATES"
      : null,
    selectedPackets,
    boardCandidates: withFlags,
    teamQuota: false,
    sideQuota: false,
    decisionAuthority: "LEGACY_SAFEST_2_TO_6",
  };
}

/**
 * Rank board candidates and select Official membership.
 * Live authority is Decision Engine V2 after chronological holdout promotion.
 */
export function selectOfficialMembershipV1(packets = [], options = {}) {
  const forceV2 = options.forceDecisionEngineV2 === true;
  const forceLegacy = options.forceLegacySelector === true;
  if (!forceLegacy && (forceV2 || isDecisionEngineV2LiveEnabled())) {
    const result = selectOfficialMembershipV2(packets, options);
    return {
      ...result,
      controlPlaneBuild: result.controlPlaneBuild || DECISION_ENGINE_V2_BUILD,
      legacyRollbackAvailable: true,
    };
  }
  return selectOfficialMembershipLegacyV1(packets, options);
}

export { selectOfficialMembershipLegacyV1, selectOfficialMembershipV2 };
