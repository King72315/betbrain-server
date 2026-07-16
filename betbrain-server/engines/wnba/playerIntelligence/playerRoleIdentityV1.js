/**
 * Persistent, evidence-based player role identity.
 * Identity drives projection bias and evidence requirements — not confidence cuts alone.
 *
 * Lack of Over evidence ≠ automatic Under edge.
 */

export const PLAYER_ROLE_IDENTITY_VERSION = "player-role-identity-v1";

export const ROLE_IDENTITIES = Object.freeze([
  "STABLE_STARTER",
  "BENCH_MICROWAVE",
  "MINUTES_DEPENDENT",
  "EMERGING_ROLE",
  "DECLINING_ROLE",
  "VOLUME_SCORER",
  "EFFICIENCY_SCORER",
  "USAGE_DRIVEN",
  "GAME_SCRIPT_SENSITIVE",
  "UNCLASSIFIED",
]);

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Classify a durable role identity from Player Intelligence + legacy profile fields.
 */
export function buildPlayerRoleIdentity(profile = {}, options = {}) {
  const intel = profile.playerIntelligence || profile;
  const role =
    intel.roleStabilityScore ||
    (profile.roleStability === "STABLE"
      ? "STABLE"
      : profile.roleStability === "UNSTABLE"
        ? "VOLATILE"
        : "MODERATE");
  const usage = intel.usageProfile || profile.shotVolumeStability || "VARIABLE";
  const scoring = intel.scoringProfile || profile.scoringVolatility || "MODERATE";
  const trend =
    intel.opportunityTrend ||
    (profile.roleDirection === "EXPANDING"
      ? "RISING"
      : profile.roleDirection === "CONTRACTING"
        ? "DECLINING"
        : "FLAT");
  const minutesLevel = String(profile.minutesLevel || "").toUpperCase();
  const scoringVolume = String(profile.scoringVolume || "").toUpperCase();
  const minutes = num(
    profile.recentMinutesAverage ??
      intel.recentMinutesAverage ??
      options.recentMinutes,
    null
  );
  const fga = num(
    profile.recentFgaAverage ?? intel.recentFgaAverage ?? options.recentFga,
    null
  );
  const conf = num(intel.profileConfidence ?? profile.profileConfidence, 50) ?? 50;
  const volIdx = num(intel.volatilityIndex, 50) ?? 50;

  const reasons = [];
  let identity = "UNCLASSIFIED";

  if (trend === "RISING" && (role === "MODERATE" || role === "VOLATILE" || conf < 55)) {
    identity = "EMERGING_ROLE";
    reasons.push("Rising opportunity with unfinished role proof");
  } else if (trend === "DECLINING") {
    identity = "DECLINING_ROLE";
    reasons.push("Contracting role / declining opportunity");
  } else if (
    (role === "VERY_STABLE" || role === "STABLE") &&
    (minutesLevel === "HIGH" || (minutes != null && minutes >= 28)) &&
    (usage === "LOCKED" || usage === "STABLE")
  ) {
    identity = "STABLE_STARTER";
    reasons.push("Stable high-minute locked usage");
  } else if (
    (minutesLevel === "LOW" || (minutes != null && minutes < 20)) &&
    (scoringVolume === "MEDIUM" || scoringVolume === "HIGH" || (fga != null && fga >= 8))
  ) {
    identity = "BENCH_MICROWAVE";
    reasons.push("Low minutes with burst scoring volume");
  } else if (
    role === "VOLATILE" ||
    role === "VERY_VOLATILE" ||
    profile.roleStability === "UNSTABLE" ||
    volIdx >= 70
  ) {
    identity = "MINUTES_DEPENDENT";
    reasons.push("Volatile / unstable minutes profile");
  } else if (
    scoringVolume === "HIGH" ||
    (fga != null && fga >= 12) ||
    usage === "LOCKED"
  ) {
    identity = "VOLUME_SCORER";
    reasons.push("High shot volume / locked usage");
  } else if (scoring === "CONSISTENT" && (scoringVolume === "LOW" || (fga != null && fga < 8))) {
    identity = "EFFICIENCY_SCORER";
    reasons.push("Consistent low-volume efficiency scorer");
  } else if (usage === "VARIABLE" || usage === "ERRATIC") {
    identity = "USAGE_DRIVEN";
    reasons.push("Usage share drives outcomes more than role stability");
  } else if (volIdx >= 55 || role === "MODERATE") {
    identity = "GAME_SCRIPT_SENSITIVE";
    reasons.push("Moderate stability — game script sensitive");
  }

  const sideBias = identitySideBias(identity);
  const projectionShift = identityProjectionShift(identity, {
    line: options.line,
    seasonAverage: options.seasonAverage ?? profile.seasonPointsAverage,
    recentAverage: options.recentAverage ?? profile.recentPointsAverage,
  });

  return {
    version: PLAYER_ROLE_IDENTITY_VERSION,
    identity,
    reasons: reasons.slice(0, 4),
    sideBias, // OVER | UNDER | NEUTRAL — natural value lean, not auto-pick
    projectionShift,
    overEvidenceRequirement: sideBias === "UNDER" ? "HIGH" : sideBias === "OVER" ? "BASE" : "ELEVATED",
    underEvidenceRequirement:
      sideBias === "OVER" ? "HIGH" : sideBias === "UNDER" ? "BASE" : "ELEVATED",
    // Uncertainty identities must not mint Unders from missing Over proof alone.
    lackOfOverEvidenceIsNotUnderEdge: [
      "MINUTES_DEPENDENT",
      "EMERGING_ROLE",
      "GAME_SCRIPT_SENSITIVE",
      "UNCLASSIFIED",
      "BENCH_MICROWAVE",
    ].includes(identity),
    confidenceFloorHint: identityConfidenceFloor(identity, conf),
    profileConfidence: conf,
  };
}

function identitySideBias(identity = "") {
  switch (identity) {
    case "STABLE_STARTER":
    case "VOLUME_SCORER":
    case "EMERGING_ROLE":
      return "OVER";
    case "DECLINING_ROLE":
    case "MINUTES_DEPENDENT":
    case "EFFICIENCY_SCORER":
      return "UNDER";
    default:
      return "NEUTRAL";
  }
}

/**
 * Role identity moves projection toward the natural value side.
 * Caps stay modest — identity informs, it does not rewrite the board.
 */
export function identityProjectionShift(
  identity = "",
  { line = null, seasonAverage = null, recentAverage = null } = {}
) {
  const season = num(seasonAverage);
  const recent = num(recentAverage);
  const book = num(line);
  const anchor = recent != null ? recent : season;
  let shift = 0;

  switch (identity) {
    case "STABLE_STARTER":
    case "VOLUME_SCORER":
      shift = 0.35;
      break;
    case "EMERGING_ROLE":
      shift = 0.45;
      break;
    case "DECLINING_ROLE":
      shift = -0.55;
      break;
    case "MINUTES_DEPENDENT":
      // Pull toward season when line sits above observed role.
      if (book != null && season != null && book > season + 1.5) shift = -0.65;
      else if (book != null && season != null && book < season - 1.5) shift = 0.25;
      else shift = -0.35;
      break;
    case "EFFICIENCY_SCORER":
      shift = -0.25;
      break;
    case "BENCH_MICROWAVE":
      // Burst scorer: do not invent Overs — mild regression to recent.
      if (anchor != null && book != null && book > anchor + 2) shift = -0.4;
      else shift = 0.15;
      break;
    case "USAGE_DRIVEN":
    case "GAME_SCRIPT_SENSITIVE":
      shift = 0;
      break;
    default:
      shift = 0;
  }

  return clamp(shift, -0.85, 0.65);
}

function identityConfidenceFloor(identity = "", profileConfidence = 50) {
  // Strong identities get a higher floor; uncertainty identities stay honest but not crushed.
  if (identity === "STABLE_STARTER" || identity === "VOLUME_SCORER") {
    return Math.max(48, Math.round(profileConfidence * 0.55));
  }
  if (identity === "MINUTES_DEPENDENT" || identity === "EMERGING_ROLE") {
    return 36;
  }
  return 40;
}

/**
 * Classify whether a chosen side has positive edge evidence vs mere uncertainty.
 */
export function classifySideEvidenceClass({
  side = "",
  identity = null,
  overCaseScore = null,
  underCaseScore = null,
  overGap = null,
  underGap = null,
  gapFloor = 2.5,
  flipAction = "",
} = {}) {
  const s = String(side || "").toUpperCase();
  const action = String(flipAction || "").toUpperCase();
  const overScore = num(overCaseScore, 0) ?? 0;
  const underScore = num(underCaseScore, 0) ?? 0;
  const oGap = num(overGap);
  const uGap = num(underGap);
  const floor = num(gapFloor, 2.5) ?? 2.5;
  const id = identity?.identity || identity || "";

  if (action === "BOTH_SIDES_WEAK") {
    return {
      sideEvidenceClass: "UNCERTAINTY",
      reason: "Both sides weak — lack of evidence, not a true edge",
    };
  }

  if (s === "UNDER") {
    const hasPositiveUnder =
      (underScore >= 55 && (uGap == null || uGap >= floor - 0.5)) ||
      (uGap != null && uGap >= floor);
    if (!hasPositiveUnder) {
      return {
        sideEvidenceClass: "UNCERTAINTY",
        reason: "Under selected without independent Under edge evidence",
      };
    }
    if (
      identity?.lackOfOverEvidenceIsNotUnderEdge &&
      overScore < 45 &&
      underScore < 60
    ) {
      return {
        sideEvidenceClass: "UNCERTAINTY",
        reason: `${id || "Role"} identity: weak Over is not automatic Under edge`,
      };
    }
    return {
      sideEvidenceClass: "POSITIVE_EDGE",
      reason: "Independent Under evidence present",
    };
  }

  if (s === "OVER") {
    const hasPositiveOver =
      (overScore >= 55 && (oGap == null || oGap >= floor - 0.5)) ||
      (oGap != null && oGap >= floor);
    if (!hasPositiveOver) {
      return {
        sideEvidenceClass: "UNCERTAINTY",
        reason: "Over selected without independent Over edge evidence",
      };
    }
    return {
      sideEvidenceClass: "POSITIVE_EDGE",
      reason: "Independent Over evidence present",
    };
  }

  return {
    sideEvidenceClass: "UNCERTAINTY",
    reason: "No side resolved",
  };
}
