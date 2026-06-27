/**
 * Availability Impact v1 — player + teammate availability side effects.
 */
export const AVAILABILITY_IMPACT_VERSION = "availability-impact-v1";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function evaluateAvailabilityImpact(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const availabilityGate = pick.availabilityGate || options.availabilityGate || {};
  const injury = card.injuryAvailability || availabilityGate || {};
  const reasons = [];
  const teammateBoosts = [];
  const teammateReductions = [];

  const playerStatus = String(
    injury.level ?? availabilityGate.status ?? availabilityGate.availabilityStatus ?? "UNKNOWN"
  ).toUpperCase();
  const sourceStatus = String(
    availabilityGate.availabilitySourceStatus ??
      injury.sourceStatus ??
      (availabilityGate.availabilityDataMissing ? "SOURCE_UNAVAILABLE" : "AVAILABLE")
  ).toUpperCase();
  const uncertaintyAdded =
    availabilityGate.availabilityDataMissing === true ||
    injury.availabilityDataMissing === true ||
    playerStatus === "UNKNOWN" ||
    playerStatus === "QUESTIONABLE";

  let sideImpact = "NEUTRAL";

  if (["OUT", "DOUBTFUL"].includes(playerStatus)) {
    reasons.push(`Player ${playerStatus} — scoring path unreliable.`);
    sideImpact = "UNDER";
  } else if (playerStatus === "QUESTIONABLE" || playerStatus === "PROBABLE") {
    reasons.push(`Player ${playerStatus} — minutes uncertainty.`);
    if (side === "UNDER") sideImpact = "OVER";
    else sideImpact = "NEUTRAL";
  } else if (playerStatus === "ACTIVE") {
    reasons.push("Player active.");
  }

  const usageBoost = num(availabilityGate.usageBoost ?? injury.usageBoost);
  const teammateOut = availabilityGate.teammateOutNames || injury.teammateOutNames || [];
  if (usageBoost > 0 || teammateOut.length > 0) {
    teammateBoosts.push(
      ...teammateOut.map((name) => `${name} out — usage boost path`)
    );
    if (usageBoost >= 0.08 || teammateOut.length >= 1) {
      reasons.push("Teammate absence may boost usage.");
      if (side === "OVER") sideImpact = "OVER";
    }
  }

  const returning = availabilityGate.teammateReturningNames || injury.teammateReturningNames || [];
  if (returning.length > 0) {
    teammateReductions.push(...returning.map((name) => `${name} returning — usage share risk`));
    reasons.push("Returning teammate may reduce usage.");
    if (side === "OVER") sideImpact = "UNDER";
    if (side === "UNDER") sideImpact = "UNDER";
  }

  if (uncertaintyAdded && sourceStatus === "SOURCE_UNAVAILABLE") {
    reasons.push("Availability source missing — uncertainty added.");
    if (side === "UNDER") sideImpact = sideImpact === "OVER" ? "NEUTRAL" : "OVER";
  }

  return {
    version: AVAILABILITY_IMPACT_VERSION,
    playerStatus,
    teammateBoosts: teammateBoosts.slice(0, 4),
    teammateReductions: teammateReductions.slice(0, 4),
    sourceStatus,
    uncertaintyAdded,
    sideImpact,
    reasons: reasons.slice(0, 6),
  };
}
