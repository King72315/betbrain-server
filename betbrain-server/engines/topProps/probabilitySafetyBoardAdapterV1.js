/**
 * Wire Probability/Safety architecture into Controlled Best Board surface.
 * Preserves canonical seal packet shape. No fixed six / no side quotas.
 */
import {
  ARCHITECTURE_BUILD,
  selectOfficialBoardFromProbabilitySafetyV1,
  buildPropCorrelationAuditV1,
  buildRiskExplanationV1,
  MEMBERSHIP_VERSION,
} from "../probabilitySafetyV1/index.js";
import {
  buildCanonicalControlledBoardPacket,
  CANONICAL_BOARD_MEMBERSHIP_MODEL,
  CANONICAL_BOARD_SEAL_BUILD,
} from "../topProps/controlledBestBoardCanonicalV3.js";
import {
  annotatePickWithDateFields,
  verifyCandidateSlateDate,
  SLATE_DATE_VERIFICATION_BUILD,
  SLATE_DATE_VERIFICATION_VERSION,
} from "../../services/slateDateVerificationV1.js";

export const PROBABILITY_SAFETY_BOARD_BUILD = ARCHITECTURE_BUILD;

export function isProbabilitySafetyArchitectureEnabled(options = {}) {
  if (options.probabilitySafetyArchitecture === false) return false;
  if (options.probabilitySafetyArchitecture === true) return true;
  const env = String(
    process.env.PROBABILITY_SAFETY_ARCHITECTURE_V1 || "true"
  ).toLowerCase();
  return env !== "false";
}

export function selectControlledBestBoardViaProbabilitySafetyV1(
  candidates = [],
  options = {},
  requestedSlateDate = null
) {
  const slateDate = requestedSlateDate || options.requestedSlateDate || null;
  const list = Array.isArray(candidates) ? candidates : [];

  // Date-verify first — wrong-date markets never enter research Official path
  const dateOk = [];
  const quarantine = [];
  for (const pick of list) {
    const check = verifyCandidateSlateDate(pick, {
      requestedSlateDate: slateDate,
      expectedDayBucket: options.expectedDayBucket,
      bundleDate: options.bundleDate || slateDate,
    });
    if (!check.ok) {
      quarantine.push({
        player: pick.playerName || pick.player,
        reason: (check.dateVerificationReasons || []).join(" + "),
        hardExclusions: check.dateVerificationReasons,
      });
      continue;
    }
    dateOk.push(
      annotatePickWithDateFields({
        ...pick,
        dateVerificationStatus: "PASS",
      })
    );
  }

  const membership = selectOfficialBoardFromProbabilitySafetyV1(dateOk, {
    simulationCount: options.simulationCount,
    seed: options.simulationSeed,
    empiricalSafePropV2: options.empiricalSafePropV2,
    requestedSlateDate: slateDate,
  });

  const verifiedBoard = (membership.selectedProps || []).map((p, i) => {
    const explanation = buildRiskExplanationV1(p);
    return {
      ...p,
      controlledBestBoardRank: i + 1,
      controlledBestBoardSize: membership.selectedProps.length,
      safetyRank: i + 1,
      isTopPick: false,
      bestSixOverallRank: null,
      controlledBestSixDisplay: true,
      controlledBestSixRank: i + 1,
      resultsAdmissionEligible: true,
      riskExplanation: explanation,
      riskExplanationText: explanation.plainLanguage,
      architectureBuild: ARCHITECTURE_BUILD,
      membershipVersion: MEMBERSHIP_VERSION,
    };
  });

  const correlation = buildPropCorrelationAuditV1(verifiedBoard);

  const preliminary = {
    board: verifiedBoard,
    bestSix: verifiedBoard,
    topPicks: [],
    bestSixOverall: [],
    audit: {
      version: "controlled-best-board-probability-safety-v1",
      build: ARCHITECTURE_BUILD,
      membershipBuild: MEMBERSHIP_VERSION,
      probabilitySafetyArchitecture: true,
      lastValidOfficialFillDisabled: true,
      allowEmptyOfficialBoard: true,
      noFixedMinimumBoardCount: true,
      noFixedSix: true,
      noSideQuota: true,
      noTeamPairRequirement: true,
      highRiskBlockedFromOfficial: false,
      highPolicy: membership.highPolicy || "MINIMUM_2_FILL_ONLY",
      lowRiskFirst: true,
      dateVerificationVersion: SLATE_DATE_VERIFICATION_VERSION,
      dateVerificationBuild: SLATE_DATE_VERIFICATION_BUILD,
      requestedSlateDate: slateDate,
      timezone: "America/Chicago",
      gamesEvaluated: null,
      emptySlots: 0,
      qualifiedOverSlots: verifiedBoard.filter((p) =>
        String(p.side || p.pick || "").toUpperCase().startsWith("OVER")
      ).length,
      qualifiedUnderSlots: verifiedBoard.filter((p) =>
        String(p.side || p.pick || "").toUpperCase().startsWith("UNDER")
      ).length,
      lowCount: membership.lowCount,
      mediumCount: membership.mediumCount,
      highFillCount: membership.highFillCount ?? 0,
      thinSlate: membership.thinSlate === true,
      highBlocked: 0,
      researchUniverse: membership.research?.counts || null,
      correlationAudit: correlation,
      quarantine,
      boardSizePolicy: membership.boardSizePolicy || "SAFEST_2_TO_6",
      officialBoardMin: membership.officialBoardMin ?? 2,
      officialBoardMax: membership.officialBoardMax ?? 6,
      officialPoolSize: membership.officialPoolSize ?? null,
      controlPlaneBuild: membership.controlPlaneBuild || null,
      teamQuota: false,
      sideQuota: false,
    },
    requestedSlateDate: slateDate,
    selectionBuildId: options.selectionBuildId || null,
  };

  const canonical = buildCanonicalControlledBoardPacket(preliminary, {
    requestedSlateDate: slateDate,
    selectionBuildId: options.selectionBuildId || null,
  });

  return {
    ...preliminary,
    selectedProps: canonical.selectedProps,
    officialMembership: canonical.officialMembership,
    controlledBestBoardV2: canonical,
    selectionBuildId: canonical.selectionBuildId,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    board: canonical.selectedProps,
    bestSix: canonical.selectedProps,
    bestSixOverall: canonical.bestSixOverall,
    topPicks: canonical.topPicks,
    probabilitySafety: membership,
    boardCandidates: membership.boardCandidates || [],
    researchUniverse: membership.research,
    audit: {
      ...preliminary.audit,
      selectionBuildId: canonical.selectionBuildId,
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      sealBuild: CANONICAL_BOARD_SEAL_BUILD,
      membershipValid: canonical.membershipValid,
      invariants: canonical.invariants,
    },
    controlledBestBoardAudit: {
      ...preliminary.audit,
      selectionBuildId: canonical.selectionBuildId,
      membershipValid: canonical.membershipValid,
    },
    controlledBestSixDisplayAudit: {
      ...preliminary.audit,
      displayMode: true,
      boardMode: "PROBABILITY_SAFETY_LOW_MEDIUM_V1",
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      selectionBuildId: canonical.selectionBuildId,
      selectedBestSixCount: canonical.selectedProps.length,
      resultsAdmissionCount: canonical.selectedProps.length,
    },
  };
}
