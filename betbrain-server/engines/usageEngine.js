// BetBrain Usage Engine — ES Module
// Phase 1: Points only, soft caps, logging first

const POSITION_FLOW = {
  PG: { PG: 0.45, SG: 0.30, SF: 0.15, PF: 0.05, C: 0.05 },
  SG: { PG: 0.30, SG: 0.40, SF: 0.20, PF: 0.05, C: 0.05 },
  SF: { PG: 0.15, SG: 0.20, SF: 0.35, PF: 0.20, C: 0.10 },
  PF: { PG: 0.05, SG: 0.10, SF: 0.25, PF: 0.35, C: 0.25 },
  C: { PG: 0.05, SG: 0.05, SF: 0.10, PF: 0.30, C: 0.50 },
};

function getRoleTier(avgMinutes, avgFGA) {
  if (avgMinutes >= 32 && avgFGA >= 14) return "STAR";
  if (avgMinutes >= 26 && avgFGA >= 9) return "STARTER";
  if (avgMinutes >= 18 && avgFGA >= 5) return "ROLE";
  return "BENCH";
}

function getRoleMultiplier(tier) {
  const multipliers = {
    STAR: 1.6,
    STARTER: 1.1,
    ROLE: 0.6,
    BENCH: 0.3,
  };

  return multipliers[tier] ?? 0.4;
}

function isPlayerMissing(player) {
  const status = String(
    player.Status || player.InjuryStatus || ""
  ).toLowerCase();

  return (
    status.includes("out") ||
    status.includes("inactive") ||
    status.includes("suspended") ||
    status.includes("doubtful")
  );
}

export function getMissingPlayers(team, allPlayers) {
  if (!team || !Array.isArray(allPlayers)) return [];

  return allPlayers.filter((p) => {
    const playerTeam = String(p.Team || p.team || "").toUpperCase();
    const targetTeam = String(team).toUpperCase();

    return playerTeam === targetTeam && isPlayerMissing(p);
  });
}

export { getRoleTier };

export function calcUsageBoost(playerData, stat, missingPlayers = []) {
  if (stat !== "Points") {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      reasons: [],
      log: "USAGE ENGINE: skipped (not Points)",
    };
  }

  if (!playerData || missingPlayers.length === 0) {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      reasons: [],
      log: "USAGE ENGINE: no missing players",
    };
  }

  const playerPos = playerData.Position || "SF";

  let projectionBoost = 0;
  let confidenceBoost = 0;
  const reasons = [];

  for (const missing of missingPlayers) {
    const tier = getRoleTier(
      missing.avgMinutes || missing.Minutes || 0,
      missing.avgFGA || missing.FGA || 0
    );

    const roleMultiplier = getRoleMultiplier(tier);

    const missingPos = missing.Position || "SF";

    const flow =
      POSITION_FLOW[missingPos]?.[playerPos] ?? 0.10;

    const rawProjBoost = flow * roleMultiplier * 4;
    const rawConfBoost = flow * roleMultiplier * 8;

    projectionBoost += rawProjBoost;
    confidenceBoost += rawConfBoost;

    reasons.push(
      `${missing.Name || missing.PlayerName} (${tier})`
    );
  }

  projectionBoost = Math.min(
    Number(projectionBoost.toFixed(1)),
    3.5
  );

  confidenceBoost = Math.min(
    Math.round(confidenceBoost),
    6
  );

  return {
    projectionBoost,
    confidenceBoost,
    reasons,
    log:
      `USAGE ENGINE: ` +
      `${playerData.Name || playerData.PlayerName} | ` +
      `missing: ${reasons.join(", ")} | ` +
      `proj:+${projectionBoost} conf:+${confidenceBoost}`,
  };
}