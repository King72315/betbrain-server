/**
 * CourtEdge Analysis Integrity V1
 *
 * Single owner for consumer-facing finalConfidence / finalRisk, plus display
 * hygiene: no zero-poison, no negative volume, rounded numbers, invalid
 * evidence reject/rebuild, readable Home copy only.
 *
 * Do not change calibration weights, Best 6 rules, or Lab logic here.
 */

import { normalizePersonName } from "./providerIdentityLayer.js";
import { buildCourtEdgePlayerEvidenceV1 } from "./courtEdgePlayerEvidenceV1.js";
import {
  stripRawDecisionLabels,
  buildHomeDisplayWhy,
} from "../engines/topProps/homeReasonTextV1.js";

export const ANALYSIS_INTEGRITY_VERSION = "courtEdgeAnalysisIntegrityV1";
export const ANALYSIS_INTEGRITY_BUILD = "courteedge-analysis-integrity-v1";

/**
 * Single owner for Home compact / Detailed Analysis / Copy Report / Top display.
 * Prefer sealed immutable decision packet fields, then sealed pick finals.
 * Never prefer winProbability over finalConfidence for consumer display.
 */
export const CANONICAL_CONFIDENCE_RISK_OWNER =
  "courtEdgeDecisionPacketV1.finalConfidence|trueRisk ΓåÆ pick.finalConfidence|displayTrueRisk (sealed)";

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Round stats/lines to 1 decimal; strip long floats. */
export function roundStat(value, decimals = 1) {
  const n = numOrNull(value);
  if (n === null) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Confidence % displayed as integer (product norm). */
export function roundConfidence(value) {
  const n = numOrNull(value);
  if (n === null) return null;
  return Math.round(n);
}

export function roundRate(value, decimals = 3) {
  return roundStat(value, decimals);
}

/**
 * Measured field wrapper ΓÇö missing stays null/UNAVAILABLE, never synthetic 0.
 * For volume fields, treat bare 0 with empty sample as missing.
 */
export function measuredField(value, options = {}) {
  const {
    zeroMeansMissing = false,
    allowZero = true,
    statusWhenMissing = "UNAVAILABLE",
    decimals = null,
  } = options;
  let n = numOrNull(value);
  if (n === null) {
    return { value: null, status: statusWhenMissing, display: "Unavailable" };
  }
  if (zeroMeansMissing && n === 0) {
    return { value: null, status: statusWhenMissing, display: "Unavailable" };
  }
  if (!allowZero && n === 0) {
    return { value: null, status: statusWhenMissing, display: "Unavailable" };
  }
  if (decimals !== null) n = roundStat(n, decimals);
  return { value: n, status: "AVAILABLE", display: n };
}

/** Volume / minutes / attempts ΓÇö never display negative nonsense. */
export function nonNegativeVolume(value, options = {}) {
  const field = measuredField(value, {
    zeroMeansMissing: options.zeroMeansMissing !== false,
    decimals: options.decimals ?? 1,
    ...options,
  });
  if (field.value !== null && field.value < 0) {
    return {
      value: null,
      status: "INVALID_NEGATIVE",
      display: "Unavailable",
      rawRejected: field.value,
    };
  }
  return field;
}

export function clampNonNegativeOrNull(value) {
  const n = numOrNull(value);
  if (n === null) return null;
  if (n < 0) return null;
  return n;
}

/**
 * Resolve the one consumer confidence + risk pair.
 */
export function resolveCanonicalConfidenceRisk(pick = {}) {
  const packet =
    pick.courtEdgeDecisionPacketV1 ||
    pick.courtEdgeDecisionPacket ||
    pick.decisionPacket ||
    {};
  const freeze = packet.layers?.freeze || {};
  const sealedAnalysis = pick.homeDetailedAnalysisV1?.sealed
    ? pick.homeDetailedAnalysisV1
    : null;

  const confidence = roundConfidence(
    first(
      sealedAnalysis?.canonical?.confidence,
      sealedAnalysis?.finalDecision?.finalConfidence,
      freeze.confidence,
      freeze.finalConfidence,
      packet.finalConfidence,
      packet.confidence,
      pick.finalConfidence,
      pick.confidence
      // intentionally omit winProbability ΓÇö competing trail
    )
  );

  // C2 / Probability Safety membership risk outranks stale DDI flood-gate risk.
  const membershipRiskOwner = Boolean(
    pick.v2Risk ||
      pick.riskOwner ||
      pick.productionFreeze ||
      pick.membershipVersion ||
      (pick.architectureBuild &&
        String(pick.architectureBuild).includes("empirical"))
  );
  const risk = String(
    first(
      sealedAnalysis?.canonical?.risk,
      sealedAnalysis?.finalDecision?.finalRisk,
      freeze.risk,
      freeze.trueRisk,
      packet.trueRisk,
      membershipRiskOwner ? pick.v2Risk : null,
      membershipRiskOwner ? pick.displayTrueRisk : null,
      membershipRiskOwner ? pick.trueRisk : null,
      membershipRiskOwner ? null : pick.decisionIntelligence?.trueRisk,
      pick.displayTrueRisk,
      pick.trueRisk,
      pick.decisionIntelligence?.trueRisk,
      "MEDIUM"
    )
  ).toUpperCase();

  return {
    finalConfidence: confidence,
    finalRisk: risk,
    owner: CANONICAL_CONFIDENCE_RISK_OWNER,
    source: sealedAnalysis?.canonical
      ? "sealed_homeDetailedAnalysisV1.canonical"
      : freeze.confidence != null || freeze.finalConfidence != null
        ? "decisionPacket.layers.freeze"
        : packet.finalConfidence != null || packet.confidence != null
          ? "decisionPacket"
          : pick.finalConfidence != null
            ? "pick.finalConfidence"
            : "pick.confidence",
  };
}

/**
 * Accent / apostrophe-safe person key for joins (Le├»la ΓåÆ leilalacan).
 */
export function normalizePlayerJoinKey(name = "") {
  return normalizePersonName(name).replace(/\s+/g, "");
}

/**
 * Detect corrupt / zero-poisoned evidence packets (e.g. Lacan empty L5 + fake 0s).
 */
export function validatePlayerEvidencePacket(evidence = {}, pick = {}) {
  const reasons = [];
  if (!evidence || typeof evidence !== "object") {
    return { valid: false, shouldRebuild: true, reasons: ["missing_evidence"], issues: ["missing_evidence"] };
  }

  const role = evidence.roleAndVolume || {};
  const form = evidence.recentForm || {};
  const last5 = Array.isArray(form.last5Points) ? form.last5Points : [];
  const last10 = Array.isArray(form.last10Points) ? form.last10Points : [];
  const sample = numOrNull(form.sampleSize) ?? last5.length;
  const mins = numOrNull(role.last5Minutes);
  const fga = numOrNull(role.fga);
  const fta = numOrNull(role.fta);
  const quality = role.quality || {};
  const bdlId = evidence.identity?.bdlPlayerId;
  const proj = numOrNull(
    first(
      evidence.projections?.finalProjection,
      pick.projection,
      pick.projectedPoints
    )
  );

  const identityName = first(
    evidence.identity?.oddsPlayerName,
    evidence.identity?.playerName
  );
  const pickName = first(pick.player, pick.playerName);
  if (identityName && pickName) {
    const a = normalizePlayerJoinKey(identityName);
    const b = normalizePlayerJoinKey(pickName);
    if (a && b && a !== b) {
      const ta = normalizePersonName(identityName).split(" ").filter(Boolean);
      const tb = normalizePersonName(pickName).split(" ").filter(Boolean);
      const lastOk =
        ta.length && tb.length && ta[ta.length - 1] === tb[tb.length - 1];
      const firstOk =
        ta[0] && tb[0] && (ta[0] === tb[0] || ta[0][0] === tb[0][0]);
      if (!(lastOk && firstOk)) {
        reasons.push("identity_name_mismatch");
      }
    }
  }

  if (last5.length >= 3 && last5.every((v) => numOrNull(v) === 0)) {
    reasons.push("zero_poison_points");
  }

  if ([mins, fga, fta].some((v) => v !== null && v < 0)) {
    reasons.push("negative_volume");
  }

  if (evidence.dataQuality?.fakeCompleteCoverage === true) {
    reasons.push("fake_complete_coverage");
  }

  const pickHasLast5 = Array.isArray(pick.last5) && pick.last5.length > 0;
  if (pickHasLast5 && !last5.length && (numOrNull(evidence.dataQuality?.coveragePct) || 0) >= 40) {
    reasons.push("stale_empty_form_vs_pick");
  }

  if (sample === 0 && last5.length === 0 && last10.length === 0) {
    if (mins === 0 || fga === 0 || fta === 0) {
      reasons.push("zero_volume_without_game_sample");
    }
    if (quality.available === true && quality.sampleSize === 0) {
      reasons.push("quality_available_with_empty_sample");
    }
    if (quality.confidenceEligible === true && !bdlId && sample === 0) {
      reasons.push("confidence_eligible_without_identity_or_sample");
    }
    const formQuality = form.quality || {};
    if (formQuality.available === true && (formQuality.sampleSize || 0) === 0) {
      reasons.push("form_quality_available_with_empty_sample");
    }
    if (formQuality.confidenceEligible === true && sample === 0) {
      reasons.push("form_confidence_eligible_without_sample");
    }
    if (numOrNull(form.seasonPointsAverage) === 0) {
      reasons.push("zero_poison_season_average");
    }
  }

  if (proj !== null && proj < 0) {
    reasons.push("negative_projection");
  }

  if (
    numOrNull(pick.expectedMinutes) === 0 &&
    last5.length === 0 &&
    !bdlId
  ) {
    reasons.push("expected_minutes_zero_unresolved_identity");
  }

  const invalid = reasons.length > 0;
  return {
    valid: !invalid,
    shouldRebuild: invalid,
    reasons,
    issues: reasons,
  };
}

/**
 * Strip zero-poisoned role/projection fields ΓåÆ null + UNAVAILABLE markers.
 */
export function sanitizeEvidencePacket(evidence = {}) {
  if (!evidence || typeof evidence !== "object") return evidence;
  const next = {
    ...evidence,
    roleAndVolume: { ...(evidence.roleAndVolume || {}) },
    recentForm: { ...(evidence.recentForm || {}) },
    projections: { ...(evidence.projections || {}) },
    matchup: { ...(evidence.matchup || {}) },
  };

  const role = next.roleAndVolume;
  const form = next.recentForm;
  const sample =
    (Array.isArray(form.last5Points) ? form.last5Points.length : 0) ||
    numOrNull(form.sampleSize) ||
    0;

  const scrubZero = (obj, key) => {
    if (numOrNull(obj[key]) === 0 && sample === 0) obj[key] = null;
  };
  scrubZero(role, "last5Minutes");
  scrubZero(role, "seasonMinutes");
  scrubZero(role, "fga");
  scrubZero(role, "fta");
  scrubZero(role, "estimatedUsage");
  if (numOrNull(role.roleConfidence) === 50 && sample === 0) {
    role.roleConfidence = null;
  }
  if (numOrNull(form.seasonPointsAverage) === 0 && sample === 0) {
    form.seasonPointsAverage = null;
  }
  if (form.quality && sample === 0) {
    form.quality = {
      ...form.quality,
      available: false,
      sampleSize: 0,
      quality: "UNAVAILABLE",
      confidenceEligible: false,
      error: form.quality.error || "empty_sample_zero_poison_rejected",
    };
  }
  if (role.quality && sample === 0) {
    role.quality = {
      ...role.quality,
      available: false,
      sampleSize: 0,
      quality: "UNAVAILABLE",
      confidenceEligible: false,
      error: role.quality.error || "empty_sample_zero_poison_rejected",
    };
  }

  const proj = next.projections;
  if (numOrNull(proj.finalProjection) !== null && proj.finalProjection < 0) {
    proj.finalProjection = null;
    proj.quality = {
      ...(proj.quality || {}),
      available: false,
      quality: "UNAVAILABLE",
      error: "negative_projection_rejected",
    };
  }
  if (numOrNull(proj.fairLine) === 0 && sample === 0) proj.fairLine = null;
  if (numOrNull(proj.internalBaseline) === 0 && sample === 0) {
    proj.internalBaseline = null;
  }

  if (Array.isArray(next.matchup.minutes)) {
    next.matchup.minutes = next.matchup.minutes.filter(
      (v) => numOrNull(v) !== null && v >= 0
    );
  }

  next.integrity = {
    version: ANALYSIS_INTEGRITY_VERSION,
    sanitizedAt: new Date().toISOString(),
    zeroPoisonScrubbed: sample === 0,
  };

  return next;
}

/**
 * Reject invalid packet and rebuild from sealed/provider fields on the pick.
 * Never leaves a broken zero-poison packet on the board.
 */
export function rejectOrRebuildEvidencePacket(pick = {}, options = {}) {
  const raw =
    pick.courtEdgePlayerEvidence ||
    pick.courtEdgePlayerEvidenceV1 ||
    null;
  const validation = validatePlayerEvidencePacket(raw || {}, pick);

  if (validation.valid && raw) {
    return {
      ...pick,
      courtEdgePlayerEvidence: sanitizeEvidencePacket(raw),
      evidenceIntegrityV1: {
        valid: true,
        rebuilt: false,
        reasons: [],
        build: ANALYSIS_INTEGRITY_BUILD,
      },
    };
  }

  const rebuilt = buildCourtEdgePlayerEvidenceV1({
    ...pick,
    playerName: pick.player || pick.playerName,
    player: pick.player || pick.playerName,
    identity: {
      ...(pick.providerIdentity || {}),
      oddsPlayerName: pick.player || pick.playerName || pick.providerIdentity?.oddsPlayerName,
      // Drop mismatched identity name from corrupt packet
    },
    last5: Array.isArray(pick.last5) && pick.last5.length ? pick.last5 : [],
    seasonGames: pick.bdlSeasonGames || pick.seasonGames || [],
    bdlSeasonGames: pick.bdlSeasonGames || pick.seasonGames || [],
    matchupGames: pick.matchupGames || pick.opponentMatchupGames || [],
    defenseResult: pick.defenseResult || {},
    opportunity: {
      recentMinutes: clampNonNegativeOrNull(
        first(pick.recentMinutes, pick.expectedMinutes)
      ),
      recentFGA: clampNonNegativeOrNull(pick.expectedFGA ?? pick.recentFGA),
      recentFTA: clampNonNegativeOrNull(pick.expectedFTA ?? pick.recentFTA),
      estimatedUsage: clampNonNegativeOrNull(pick.estimatedUsage),
      roleCertainty: null,
    },
    projection: {
      finalProjection: clampNonNegativeOrNull(pick.projection),
      projection: clampNonNegativeOrNull(pick.projection),
      fairLine: clampNonNegativeOrNull(pick.fairLine),
    },
    fairLine: clampNonNegativeOrNull(pick.fairLine),
    ...options.rebuildCtx,
  });

  const sanitized = sanitizeEvidencePacket(rebuilt);
  if (sanitized.identity) {
    sanitized.identity = {
      ...sanitized.identity,
      oddsPlayerName:
        pick.player || pick.playerName || sanitized.identity.oddsPlayerName,
    };
  }
  // After rebuild, if still empty ΓÇö mark explicitly unavailable (no fake zeros).
  const post = validatePlayerEvidencePacket(sanitized, pick);
  if (!post.valid) {
    sanitized.roleAndVolume = {
      ...sanitized.roleAndVolume,
      last5Minutes: null,
      seasonMinutes: null,
      fga: null,
      fta: null,
      quality: {
        available: false,
        provider: "balldontlie",
        sampleSize: 0,
        quality: "UNAVAILABLE",
        stale: false,
        error: "evidence_rejected_unresolved_or_empty",
        fallbackUsed: false,
        confidenceEligible: false,
      },
    };
    sanitized.dataQuality = {
      ...(sanitized.dataQuality || {}),
      fakeCompleteCoverage: false,
      note: "Invalid evidence packet rejected; fields marked UNAVAILABLE until provider hydrate succeeds.",
    };
  }

  return {
    ...pick,
    courtEdgePlayerEvidence: sanitized,
    courtEdgePlayerEvidenceV1: sanitized,
    evidenceIntegrityV1: {
      valid: post.valid,
      rebuilt: true,
      rejected: true,
      reasons: validation.reasons,
      build: ANALYSIS_INTEGRITY_BUILD,
    },
    // Clear display poison on the pick itself
    expectedMinutes:
      clampNonNegativeOrNull(pick.expectedMinutes) === 0 && !post.valid
        ? null
        : clampNonNegativeOrNull(pick.expectedMinutes),
    expectedFGA:
      clampNonNegativeOrNull(pick.expectedFGA) === 0 && !post.valid
        ? null
        : clampNonNegativeOrNull(pick.expectedFGA),
    expectedFTA:
      clampNonNegativeOrNull(pick.expectedFTA) === 0 && !post.valid
        ? null
        : clampNonNegativeOrNull(pick.expectedFTA),
    projection:
      numOrNull(pick.projection) !== null && pick.projection < 0
        ? null
        : pick.projection,
  };
}

/**
 * Build Top transparency without rewriting conf/risk.
 */
export function buildTopPickTransparency(pick = {}, context = {}) {
  const rank = Number(pick.topPickRank ?? pick.topRank ?? 0);
  if (!(rank >= 1 && rank <= 2)) return null;

  const score = numOrNull(
    first(
      pick.topPickSafetyScore,
      pick.pickScore,
      pick.bestPropScore,
      context.safetyScore,
      context.finalConfidence,
      pick.confidence
    )
  );
  const nextScore = numOrNull(
    first(pick.topPickNextScore, pick.scoreVsNext, pick.nextBestScore, context.nextSafetyScore)
  );
  const margin =
    score !== null && nextScore !== null ? roundStat(score - nextScore, 1) : null;

  const supports = []
    .concat(pick.wnbaReader?.supports || [])
    .concat(pick.reasons || [])
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => stripRawDecisionLabels(String(s)));

  const concerns = []
    .concat(pick.wnbaReader?.disagrees || [])
    .concat(
      (pick.decisionIntelligence?.riskDebts || []).map((d) =>
        typeof d === "string" ? d : d.label || d.code || ""
      )
    )
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => stripRawDecisionLabels(String(s)));

  const reason =
    stripRawDecisionLabels(
      pick.topPickReason ||
        pick.decisionIntelligence?.topPickReason ||
        buildHomeDisplayWhy(pick)
    ) ||
    "Selected among Best 6 on relative safety score, confidence, and risk.";

  return {
    rank,
    reason,
    selectedFromBestSix: true,
    labelOnly: true,
    safetyScore: score,
    scoreVsNext:
      margin !== null
        ? {
            score: roundStat(score),
            nextScore: roundStat(nextScore),
            margin,
            explanation: `Leads next candidate by ${margin} on ranking score.`,
          }
        : score !== null
          ? {
              score: roundStat(score),
              nextScore: null,
              margin: null,
              explanation:
                "Top ranking score available; next-candidate margin unavailable.",
            }
          : null,
    supports,
    concerns,
    confidenceUnchanged: true,
    riskUnchanged: true,
  };
}

/**
 * Apply canonical conf/risk onto pick display fields (does not mutate sealed packet).
 */
export function applyCanonicalDisplayFields(pick = {}) {
  const withEvidence = rejectOrRebuildEvidencePacket(pick);
  const canonical = resolveCanonicalConfidenceRisk(withEvidence);
  const displayWhy = buildHomeDisplayWhy(withEvidence);
  const riskLabel =
    canonical.finalRisk === "HIGH"
      ? "High Risk"
      : canonical.finalRisk === "LOW"
        ? "Low Risk"
        : "Medium Risk";

  return {
    ...withEvidence,
    confidence: canonical.finalConfidence,
    finalConfidence: canonical.finalConfidence,
    displayTrueRisk: canonical.finalRisk,
    trueRisk: canonical.finalRisk,
    riskLabel,
    displayWhy,
    decisionIntelligence: {
      ...(withEvidence.decisionIntelligence || {}),
      trueRisk: canonical.finalRisk,
      simpleExplanation: displayWhy,
      finalConfidence: canonical.finalConfidence,
    },
    analysisIntegrityV1: {
      version: ANALYSIS_INTEGRITY_VERSION,
      build: ANALYSIS_INTEGRITY_BUILD,
      confidenceRiskOwner: CANONICAL_CONFIDENCE_RISK_OWNER,
      confidenceSource: canonical.source,
      finalConfidence: canonical.finalConfidence,
      finalRisk: canonical.finalRisk,
    },
  };
}

// --- Compatibility aliases used by homeDetailedAnalysisV1 / tests ---
export const CANONICAL_DECISION_DISPLAY_OWNER = CANONICAL_CONFIDENCE_RISK_OWNER;
export const measuredNum = numOrNull;
export const resolveCanonicalDecisionFields = resolveCanonicalConfidenceRisk;
export const ensureValidPlayerEvidence = rejectOrRebuildEvidencePacket;
export const syncCanonicalDecisionOntoPick = (pick, fields = null) => {
  if (fields && (fields.finalConfidence != null || fields.finalRisk != null)) {
    const risk = fields.finalRisk || "MEDIUM";
    return {
      ...pick,
      confidence: fields.finalConfidence ?? pick.confidence,
      finalConfidence: fields.finalConfidence ?? pick.finalConfidence,
      winProbability: fields.finalConfidence ?? pick.winProbability,
      trueRisk: risk,
      displayTrueRisk: risk,
      riskLabel:
        risk === "HIGH" ? "High Risk" : risk === "LOW" ? "Low Risk" : "Medium Risk",
      decisionIntelligence: {
        ...(pick.decisionIntelligence || {}),
        trueRisk: risk,
        finalConfidence: fields.finalConfidence,
      },
      canonicalDecisionOwner: CANONICAL_CONFIDENCE_RISK_OWNER,
      canonicalDecisionSource: fields.source || "override",
    };
  }
  return applyCanonicalDisplayFields(pick);
};

export function rebuildPlayerEvidenceFromPick(pick = {}) {
  return rejectOrRebuildEvidencePacket(pick).courtEdgePlayerEvidence;
}

export function scrubConsumerFacingText(text = "") {
  return stripRawDecisionLabels(String(text || ""))
    .replace(/\bdanger[\s_-]*gates?\b/gi, "risk factors")
    .replace(/\bgap[\s_-]*floors?\b/gi, "projection threshold")
    .replace(/\b(BOARD_ONLY|NO_BET|SHADOW_ONLY|NO_DECISIVE_RESCUE|ROLE_TREND_CONTRADICTS_SIDE|KEEP_ORIGINAL|FLIP_SIDE)\b/gi, "")
    .replace(/\bFlip\s+KEEP(?:_ORIGINAL)?\b/gi, "Kept original side")
    .replace(/\bRescue\s+KEEP(?:_ORIGINAL)?\b/gi, "Kept original side")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function consumerTextContainsRawCodes(text = "") {
  return /\b(UNDER_GAP_BELOW_|OVER_GAP_BELOW_|DANGER_STACK_|DANGER_GATE_|NO_DECISIVE_RESCUE|BOARD_ONLY|NO_BET|ROLE_TREND_CONTRADICTS_SIDE|KEEP_ORIGINAL|FLIP_SIDE)\b/i.test(
    String(text || "")
  );
}

export function translateOrScrubAction(action = "") {
  const raw = String(action || "").trim();
  if (!raw) return null;
  if (/NO_DECISIVE_RESCUE/i.test(raw)) {
    return "No stronger opposite-side case was found.";
  }
  if (/^KEEP(_ORIGINAL)?$/i.test(raw)) {
    return "Kept original side";
  }
  if (/^FLIP(_SIDE)?$/i.test(raw)) {
    return "Flipped side";
  }
  if (/ROLE_TREND_CONTRADICTS_SIDE/i.test(raw)) {
    return "Role trend conflicts with this side.";
  }
  if (/BOARD_ONLY|NO_BET|SHADOW_ONLY/i.test(raw)) {
    return scrubConsumerFacingText(raw) || "Kept as a playable board lean.";
  }
  return scrubConsumerFacingText(raw) || raw;
}

export { normalizePersonName, stripRawDecisionLabels, buildHomeDisplayWhy };
