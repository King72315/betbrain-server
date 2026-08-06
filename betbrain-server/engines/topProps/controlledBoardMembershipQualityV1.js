/**
 * CourtEdge Controlled Board Membership Quality V1
 * Build: courteedge-clear-side-strong-edge-membership-path-v1
 *
 * Evidence-based Official membership gates. Does NOT change prediction/calibration weights.
 * TEAM_SIDE_LAST_VALID may remain as a ranking/diagnostic label — it cannot independently
 * hard-block a candidate whose current evidence qualifies.
 */

import {
  resolveNaturalDecision,
  resolveSideRescueAction,
  resolveFinalSide,
} from "./bestSixSelectionIntegrityV1.js";

export const MEMBERSHIP_QUALITY_BUILD =
  "courteedge-clear-side-strong-edge-membership-path-v1";

/** Absolute directional edge required for Official Controlled Board membership. */
export const MEMBERSHIP_EDGE_FLOOR = 1.5;
/** Alias — membership minimum edge. */
export const MINIMUM_MEMBERSHIP_EDGE = MEMBERSHIP_EDGE_FLOOR;
/** Preferred gap floor — ranking/safety advantage only (not a hard reject below). */
export const PREFERRED_GAP_FLOOR = 3.0;
/** Alias — preferred edge for stronger safety ranking. */
export const PREFERRED_EDGE = PREFERRED_GAP_FLOOR;
export const BLOWOUT_OVER_HARD_BLOCK_THRESHOLD = 75;
/** Expected FGA at/below this + non-positive under gap → LOW_VOLUME_WITHOUT_UNDER_EDGE */
export const LOW_VOLUME_FGA_CEILING = 5;

export const MEMBERSHIP_REJECT = Object.freeze({
  EDGE_BELOW_MEMBERSHIP_FLOOR: "EDGE_BELOW_MEMBERSHIP_FLOOR",
  NATURAL_NO_BET: "NATURAL_NO_BET",
  BOTH_SIDES_WEAK: "BOTH_SIDES_WEAK",
  UNCERTAINTY: "UNCERTAINTY",
  BLOWOUT_OVER_HARD_BLOCK: "BLOWOUT_OVER_HARD_BLOCK",
  UNCONFIRMED_AVAILABILITY_OVER_BLOCK: "UNCONFIRMED_AVAILABILITY_OVER_BLOCK",
  SEALED_SIDE_PACKET_MISMATCH: "SEALED_SIDE_PACKET_MISMATCH",
  LOW_VOLUME_WITHOUT_UNDER_EDGE: "LOW_VOLUME_WITHOUT_UNDER_EDGE",
  UNDER_PROJECTION_ABOVE_LINE: "UNDER_PROJECTION_ABOVE_LINE",
  UNDER_FAIR_LINE_ABOVE_LINE: "UNDER_FAIR_LINE_ABOVE_LINE",
  UNDER_AVERAGES_ABOVE_LINE: "UNDER_AVERAGES_ABOVE_LINE",
  /** Diagnostic / historical only — not a standalone Official hard block. */
  TEAM_SIDE_LAST_VALID: "TEAM_SIDE_LAST_VALID",
  ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP: "ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP",
  MARKET_SANITY_INVALID: "MARKET_SANITY_INVALID",
  INCOMPLETE_SIDE_EVIDENCE: "INCOMPLETE_SIDE_EVIDENCE",
  FAIR_LINE_DOES_NOT_SUPPORT_SIDE: "FAIR_LINE_DOES_NOT_SUPPORT_SIDE",
  NO_QUALIFIED_TEAM_OVER: "NO_QUALIFIED_TEAM_OVER",
  NO_QUALIFIED_TEAM_UNDER: "NO_QUALIFIED_TEAM_UNDER",
});

/** Soft/legacy tier labels that must never independently hard-reject Official membership. */
export const NON_HARD_MEMBERSHIP_LABELS = Object.freeze([
  "TEAM_SIDE_LAST_VALID",
  "LOW_BEST_PROP_SCORE",
  "PROJECTION_SANITY_WEAK",
  "BOARD_ONLY",
  "BOARD_ONLY_OR_SHADOW",
  "SUB_60_BEST_PROP_SCORE",
]);

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeMembershipSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return null;
}

export function resolveDirectionalEdge(pick = {}, side = "OVER") {
  const s = normalizeMembershipSide(side);
  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const projection = num(
    pick.projection ?? pick.projectedPoints ?? pick.finalProjection
  );
  if (s == null || line == null || projection == null) return null;
  return s === "OVER" ? projection - line : line - projection;
}

export function resolveBlowoutRisk(pick = {}) {
  return num(
    pick.blowoutRisk ??
      pick.decisionIntelligence?.blowoutRisk ??
      pick.wnbaReader?.blowoutRisk ??
      pick.gameEnvironment?.blowoutRisk ??
      pick.homeDetailedAnalysisV1?.gameEnvironment?.blowoutRisk,
    0
  );
}

export function resolveExpectedFga(pick = {}) {
  return num(
    pick.expectedFGA ??
      pick.recentFGA ??
      pick.fgaAverage ??
      pick.roleOpportunity?.expectedFGA ??
      pick.homeDetailedAnalysisV1?.roleOpportunity?.expectedFGA ??
      pick.projectionDependency?.expectedFGA
  );
}

function availabilityBlob(pick = {}) {
  return [
    pick.availability,
    pick.playerStatus,
    pick.injuryStatus,
    pick.availabilityState,
    pick.availabilityGate?.availabilityState,
    pick.availabilityGate?.playerStatus,
    pick.availabilityGate?.displayStatus,
    pick.homeDetailedAnalysisV1?.availability?.displayStatus,
    pick.homeDetailedAnalysisV1?.availability?.status,
    ...(Array.isArray(pick.resistance) ? pick.resistance : []),
    ...(Array.isArray(pick.risks) ? pick.risks : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

export function hasUnconfirmedAvailability(pick = {}) {
  if (pick.confirmedActive === true) return false;
  if (pick.availabilityConfirmedActive === true) return false;
  if (pick.availabilityGate?.confirmedActive === true) return false;
  const blob = availabilityBlob(pick);
  if (/QUESTIONABLE|DAY[\s_-]*TO[\s_-]*DAY|DTD|GAME[\s_-]*TIME[\s_-]*DECISION|GTD/.test(blob)) {
    return true;
  }
  if (pick.confirmedActive === false) return true;
  if (pick.availabilityConfirmedOut === true) return true;
  // Explicit unresolved minutes concern on overs
  if (
    pick.unresolvedMinutesConcern === true ||
    pick.minutesConcernUnresolved === true
  ) {
    return true;
  }
  return false;
}

export function hasVerifiedBlowoutMinutesEvidence(pick = {}) {
  if (pick.blowoutMinutesVerified === true) return true;
  if (pick.blowoutMinutesEvidenceVerified === true) return true;
  const evidence = String(
    pick.blowoutMinutesEvidence ||
      pick.verifiedBlowoutMinutesNote ||
      pick.roleMinutesNote ||
      ""
  ).trim();
  if (!evidence) return false;
  return /maintain|holds? minutes|blowout.?tolerant|similar blowouts|minutes stable in blowout/i.test(
    evidence
  );
}

function flipFirstAction(pick = {}) {
  return String(
    pick.flipFirstAction ||
      pick.flipFirst?.action ||
      pick.decisionDataIntelligence?.flipFirstDecision?.action ||
      pick.decisionIntelligence?.flipFirstAction ||
      ""
  ).toUpperCase();
}

function sideEvidenceClass(pick = {}) {
  return String(
    pick.sideEvidenceClass ||
      pick.decisionIntelligence?.sideEvidenceClass ||
      pick.homeDetailedAnalysisV1?.finalDecision?.sideEvidenceClass ||
      ""
  ).toUpperCase();
}

export function hasBothSidesWeak(pick = {}) {
  const flip = flipFirstAction(pick);
  if (flip.includes("BOTH_SIDES_WEAK")) return true;
  if (pick.bothSidesWeak === true) return true;
  const blob = [
    pick.displayWhy,
    pick.decisionIntelligence?.simpleExplanation,
    pick.sideRescueExplanation,
    ...(Array.isArray(pick.softPenalties) ? pick.softPenalties : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return /BOTH_SIDES_WEAK/.test(blob);
}

export function hasUncertaintySideEvidence(pick = {}) {
  const cls = sideEvidenceClass(pick);
  if (cls.includes("UNCERTAINTY")) return true;
  if (pick.sideEvidenceUncertainty === true) return true;
  const blob = [
    pick.displayWhy,
    pick.decisionIntelligence?.simpleExplanation,
    pick.sideRescueExplanation,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return /\bUNCERTAINTY\b/.test(blob);
}

export function resolveOriginalModelSide(pick = {}) {
  return normalizeMembershipSide(
    pick.originalModelSide ||
      pick.sameTeamArbitration?.originalModelSide ||
      pick.homeDetailedAnalysisV1?.propSnapshot?.originalModelSide ||
      pick.homeDetailedAnalysisV1?.finalDecision?.originalModelSide ||
      pick.readerSide ||
      ""
  );
}

/**
 * Independent Over flip packet required when original model side is UNDER.
 */
export function evaluateValidIndependentOverFlip(pick = {}, options = {}) {
  const overEdge =
    options.overEdge != null
      ? options.overEdge
      : resolveDirectionalEdge(pick, "OVER");
  const underEdge =
    options.underEdge != null
      ? options.underEdge
      : resolveDirectionalEdge({ ...pick, side: "UNDER" }, "UNDER");
  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const fair = num(pick.fairLine ?? pick.fairValueLine);
  const reasons = [];

  if (overEdge == null || overEdge < MEMBERSHIP_EDGE_FLOOR) {
    reasons.push(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR);
  }
  if (!(fair != null && line != null && fair > line)) {
    reasons.push("FAIR_LINE_DOES_NOT_SUPPORT_OVER");
  }
  if (!(overEdge != null && underEdge != null && overEdge > underEdge)) {
    reasons.push("OVER_EVIDENCE_NOT_STRONGER_THAN_UNDER");
  }
  if (hasBothSidesWeak(pick)) reasons.push(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK);
  if (hasUncertaintySideEvidence(pick)) reasons.push(MEMBERSHIP_REJECT.UNCERTAINTY);

  const flipAction = flipFirstAction(pick);
  const rescue = resolveSideRescueAction(pick);
  const flipApproved =
    pick.validIndependentSideFlip === true ||
    pick.independentOverFlipProven === true ||
    /FLIP/.test(flipAction) ||
    rescue === "FLIP_SIDE";

  if (!flipApproved && reasons.length) {
    // Without an explicit flip approval, opposing original side cannot occupy OVER.
    reasons.push(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP);
  } else if (!flipApproved) {
    reasons.push(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP);
  }

  return {
    ok: reasons.length === 0 && flipApproved,
    reasons: [...new Set(reasons)],
    overEdge,
    underEdge,
    flipApproved,
  };
}

/**
 * Sealed side packet agreement — label, slot, narrative, and math must match.
 */
export function assertSealedSidePacketAgreement(pick = {}, expectedSide = null) {
  const side =
    normalizeMembershipSide(expectedSide) ||
    normalizeMembershipSide(pick.evaluatedSide || pick.side || pick.pick);
  const errors = [];
  if (!side) {
    return {
      ok: false,
      reason: MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH,
      errors: ["MISSING_SIDE"],
    };
  }

  const evaluated = normalizeMembershipSide(pick.evaluatedSide || pick.side || pick.pick);
  const organic = normalizeMembershipSide(pick.organicSide);
  const locked = normalizeMembershipSide(pick.lockedSide || pick.finalSide);
  const slot = String(pick.teamSlot || pick.selectedTeamSlot || "").toUpperCase();
  const original = resolveOriginalModelSide(pick);

  if (evaluated && evaluated !== side) errors.push("EVALUATED_SIDE_MISMATCH");
  if (locked && locked !== side) errors.push("LOCKED_SIDE_MISMATCH");
  if (organic && organic !== side && !pick.validIndependentSideFlip) {
    errors.push("ORGANIC_SIDE_MISMATCH");
  }
  if (slot.includes("OVER") && side !== "OVER") errors.push("SLOT_SIDE_MISMATCH");
  if (slot.includes("UNDER") && side !== "UNDER") errors.push("SLOT_SIDE_MISMATCH");

  if (
    original &&
    original !== side &&
    !(side === "OVER" && pick.validIndependentSideFlip === true)
  ) {
    errors.push("ORIGINAL_MODEL_SIDE_MISMATCH");
  }

  // Narrative/support stuck on opposite side
  const narrative = [
    ...(Array.isArray(pick.support) ? pick.support : []),
    pick.displayWhy,
    pick.decisionIntelligence?.simpleExplanation,
    pick.sideRescueExplanation,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (side === "OVER" && /supports under|blowout risk supports under/.test(narrative)) {
    // Allow if also has over-supporting language; hard-fail when under-only narrative on OVER seal
    if (!/supports over|agrees with over|over edge|over gap/.test(narrative)) {
      errors.push("NARRATIVE_OPPOSES_SEALED_SIDE");
    }
  }
  if (side === "UNDER" && /supports over|agrees with over/.test(narrative)) {
    if (!/supports under|agrees with under|under edge|under gap/.test(narrative)) {
      errors.push("NARRATIVE_OPPOSES_SEALED_SIDE");
    }
  }

  const edge = resolveDirectionalEdge(pick, side);
  if (edge == null) errors.push("MISSING_PROJECTION_GAP");

  return {
    ok: errors.length === 0,
    reason:
      errors.length > 0 ? MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH : null,
    errors,
    side,
  };
}

function underAveragesConflict(pick = {}, line) {
  const l5 = num(pick.last5Average ?? pick.playerState?.recentPoints);
  const season = num(pick.seasonAverage ?? pick.playerState?.seasonPoints);
  const hits = [];
  if (l5 != null && l5 > line) hits.push("L5");
  if (season != null && season > line) hits.push("SEASON");
  return hits;
}

function underHitRateWeak(pick = {}) {
  const rate = num(
    pick.last5HitRate ??
      pick.underHitRate ??
      pick.playerState?.last5HitRate
  );
  if (rate == null) return false;
  const frac = rate > 1 ? rate / 100 : rate;
  return frac < 0.4;
}

/**
 * Official membership quality for a single evaluated side candidate.
 */
export function evaluateOfficialMembershipQuality(pick = {}, side = "OVER", options = {}) {
  const s = normalizeMembershipSide(side) || normalizeMembershipSide(pick.side);
  const reasons = [];
  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const projection = num(
    pick.projection ?? pick.projectedPoints ?? pick.finalProjection
  );
  const fair = num(pick.fairLine ?? pick.fairValueLine);
  const edge = resolveDirectionalEdge(pick, s);
  const preferredGapAdvantage =
    edge != null && edge >= PREFERRED_GAP_FLOOR;

  if (!s) {
    reasons.push(MEMBERSHIP_REJECT.INCOMPLETE_SIDE_EVIDENCE);
    return {
      ok: false,
      reasons,
      edge,
      preferredGapAdvantage: false,
      membershipEligible: false,
    };
  }

  // TEAM_SIDE_LAST_VALID is ranking/diagnostic only — never a standalone hard reject.
  // Eligibility is recomputed from evidence below (edge, side, availability, market, decision).

  if (edge == null || edge < MEMBERSHIP_EDGE_FLOOR) {
    reasons.push(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR);
  }

  const natural = resolveNaturalDecision(pick);
  // BOARD_ONLY is not an automatic hard reject — only NO_BET is.
  if (natural === "NO_BET") {
    reasons.push(MEMBERSHIP_REJECT.NATURAL_NO_BET);
  }

  if (hasBothSidesWeak(pick)) {
    reasons.push(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK);
  }
  if (hasUncertaintySideEvidence(pick)) {
    reasons.push(MEMBERSHIP_REJECT.UNCERTAINTY);
  }

  // Fair line must support selected side, or stronger documented evidence must explain disagreement.
  if (fair != null && line != null && edge != null && edge >= MEMBERSHIP_EDGE_FLOOR) {
    const fairSupports =
      s === "OVER" ? fair > line : s === "UNDER" ? fair < line : false;
    const strongerEvidence =
      pick.fairLineDisagreementDocumented === true ||
      pick.validIndependentSideFlip === true ||
      (edge >= PREFERRED_GAP_FLOOR &&
        String(pick.fairLineOverrideReason || pick.strongerEvidenceNote || "").trim().length >
          0);
    if (!fairSupports && !strongerEvidence) {
      reasons.push(MEMBERSHIP_REJECT.FAIR_LINE_DOES_NOT_SUPPORT_SIDE);
    }
  }

  // Market sanity / incomplete evidence
  if (
    pick.marketSanityHold === true ||
    pick.projectionSanityInvalid === true ||
    String(pick.marketSanityStatus || "").toUpperCase() === "HOLD"
  ) {
    reasons.push(MEMBERSHIP_REJECT.MARKET_SANITY_INVALID);
  }
  if (
    pick.incompleteSideEvidence === true ||
    (edge == null && projection == null)
  ) {
    reasons.push(MEMBERSHIP_REJECT.INCOMPLETE_SIDE_EVIDENCE);
  }

  if (s === "OVER") {
    const blowout = resolveBlowoutRisk(pick);
    if (
      blowout >= BLOWOUT_OVER_HARD_BLOCK_THRESHOLD &&
      !hasVerifiedBlowoutMinutesEvidence(pick)
    ) {
      reasons.push(MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK);
    }
    if (hasUnconfirmedAvailability(pick)) {
      reasons.push(MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK);
    }

    const original = resolveOriginalModelSide(pick);
    if (original === "UNDER") {
      const flip = evaluateValidIndependentOverFlip(pick, {
        overEdge: edge,
        underEdge: options.underEdge,
      });
      if (!flip.ok) {
        reasons.push(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP);
        for (const r of flip.reasons) {
          if (
            r === MEMBERSHIP_REJECT.BOTH_SIDES_WEAK ||
            r === MEMBERSHIP_REJECT.UNCERTAINTY ||
            r === MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR
          ) {
            reasons.push(r);
          }
        }
      } else {
        pick = { ...pick, validIndependentSideFlip: true };
      }
    }
  }

  if (s === "UNDER") {
    if (projection != null && line != null && projection > line) {
      reasons.push(MEMBERSHIP_REJECT.UNDER_PROJECTION_ABOVE_LINE);
    }
    if (fair != null && line != null && fair > line) {
      reasons.push(MEMBERSHIP_REJECT.UNDER_FAIR_LINE_ABOVE_LINE);
    }
    const avgHits = line != null ? underAveragesConflict(pick, line) : [];
    if (avgHits.length >= 2 && underHitRateWeak(pick) && !(edge > MEMBERSHIP_EDGE_FLOOR)) {
      reasons.push(MEMBERSHIP_REJECT.UNDER_AVERAGES_ABOVE_LINE);
    }

    const fga = resolveExpectedFga(pick);
    if (
      fga != null &&
      fga <= LOW_VOLUME_FGA_CEILING &&
      (edge == null || edge <= 0)
    ) {
      reasons.push(MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE);
    }
    // Explicit kill reason from engines
    const kills = [
      ...(Array.isArray(pick.killReasons) ? pick.killReasons : []),
      ...(Array.isArray(pick.decisionIntelligence?.killReasons)
        ? pick.decisionIntelligence.killReasons
        : []),
    ]
      .map((k) => String(k).toUpperCase())
      .join(" ");
    if (/LOW_VOLUME_OVER_TRAP/.test(kills) && (edge == null || edge < MEMBERSHIP_EDGE_FLOOR)) {
      reasons.push(MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE);
    }
  }

  const packet = assertSealedSidePacketAgreement(
    {
      ...pick,
      evaluatedSide: s,
      side: s,
      organicSide: pick.organicSide || s,
      validIndependentSideFlip:
        pick.validIndependentSideFlip ||
        (resolveOriginalModelSide(pick) === "UNDER" && s === "OVER"
          ? false
          : pick.validIndependentSideFlip),
    },
    s
  );
  // Only enforce packet mismatch when sealing identity fields are already present
  if (
    (pick.teamSlot || pick.selectedTeamSlot || pick.lockedSide || pick.controlledBestBoard) &&
    !packet.ok
  ) {
    reasons.push(MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH);
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    reasons: unique,
    edge,
    preferredGapAdvantage,
    membershipEligible: unique.length === 0,
    side: s,
    validIndependentSideFlip:
      resolveOriginalModelSide(pick) === "UNDER" && s === "OVER"
        ? evaluateValidIndependentOverFlip(pick, { overEdge: edge }).ok
        : Boolean(pick.validIndependentSideFlip),
  };
}

/**
 * Ranking score boost for preferred gap (≥3.0) — does not change prediction weights.
 */
export function preferredGapRankingBonus(edge) {
  if (edge == null) return 0;
  if (edge >= PREFERRED_GAP_FLOOR + 1) return 12;
  if (edge >= PREFERRED_GAP_FLOOR) return 8;
  if (edge >= MEMBERSHIP_EDGE_FLOOR) return 0;
  return -20;
}

/**
 * Inherit Official TRACK only from qualified natural decision or documented valid flip.
 * Team-slot selection must not invent TRACK.
 */
export function resolveOfficialTrackLabel(pick = {}) {
  const natural = resolveNaturalDecision(pick);
  if (natural === "TRACK") return "TRACK";
  if (pick.validIndependentSideFlip === true && natural !== "NO_BET") {
    return "TRACK";
  }
  if (natural === "BOARD_ONLY" || natural === "SHADOW_ONLY" || natural === "NO_BET") {
    return natural;
  }
  // Qualified membership without an explicit natural gate → BOARD_ONLY (not invented TRACK)
  return natural || "BOARD_ONLY";
}

export function emptySlotReasonForSide(side = "OVER", rejectReasons = []) {
  const s = normalizeMembershipSide(side) || "OVER";
  const set = new Set(rejectReasons || []);
  if (set.has(MEMBERSHIP_REJECT.NATURAL_NO_BET)) return MEMBERSHIP_REJECT.NATURAL_NO_BET;
  if (set.has(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK)) return MEMBERSHIP_REJECT.BOTH_SIDES_WEAK;
  if (set.has(MEMBERSHIP_REJECT.UNCERTAINTY)) return MEMBERSHIP_REJECT.UNCERTAINTY;
  if (set.has(MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK)) {
    return MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK;
  }
  if (set.has(MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK)) {
    return MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK;
  }
  if (set.has(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP)) {
    return MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP;
  }
  if (set.has(MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH)) {
    return MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH;
  }
  if (set.has(MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE)) {
    return MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE;
  }
  if (set.has(MEMBERSHIP_REJECT.UNDER_PROJECTION_ABOVE_LINE)) {
    return MEMBERSHIP_REJECT.UNDER_PROJECTION_ABOVE_LINE;
  }
  if (set.has(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR)) {
    return MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR;
  }
  if (set.has(MEMBERSHIP_REJECT.FAIR_LINE_DOES_NOT_SUPPORT_SIDE)) {
    return MEMBERSHIP_REJECT.FAIR_LINE_DOES_NOT_SUPPORT_SIDE;
  }
  // TEAM_SIDE_LAST_VALID is never the empty-slot reason on its own.
  return s === "OVER"
    ? MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_OVER
    : MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_UNDER;
}
