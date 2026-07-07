/**
 * Same-Team Usage Collision v1 — multiple same-team overs scoring demand check.
 */
export const SAME_TEAM_COLLISION_VERSION = "same-team-usage-collision-v1";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanTeam(team = "") {
  return String(team || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function evaluateSameTeamUsageCollision(pick = {}, options = {}) {
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const teamKey = cleanTeam(pick.team || pick.teamKey);
  const line = num(pick.line ?? pick.wnbaDataCard?.bookLine);
  const teammates = (options.teamCandidates || options.slateCandidates || []).filter((c) => {
    if (cleanTeam(c.team || c.teamKey) !== teamKey) return false;
    if (String(c.player || "").toLowerCase() === String(pick.player || "").toLowerCase()) return false;
    const cSide = normalizeSide(c.side || c.pick || c.currentEngineSide);
    return cSide === "OVER";
  });

  const reasons = [];
  const impliedTeamTotal = num(
    pick.wnbaGameContext?.impliedTeamTotal ??
      pick.gameContext?.impliedTeamTotal ??
      options.impliedTeamTotal
  );

  if (side !== "OVER" || teammates.length === 0) {
    return {
      version: SAME_TEAM_COLLISION_VERSION,
      detected: false,
      collisionScore: 0,
      teammatesInConflict: [],
      combinedLineDemand: line,
      impliedTeamTotal: impliedTeamTotal > 0 ? impliedTeamTotal : null,
      combinedRecentAvg: num(pick.wnbaDataCard?.last5?.points),
      sideImpact: "NEUTRAL",
      recommendation: side === "OVER" ? "KEEP_OVER" : "KEEP_UNDER",
      reasons: side !== "OVER" ? ["Not a same-team Over collision case."] : ["No teammate Over conflict."],
    };
  }

  const conflictNames = teammates.map((t) => t.player).filter(Boolean);
  const teammateLines = teammates.map((t) => num(t.line ?? t.wnbaDataCard?.bookLine));
  const teammateRecent = teammates.map((t) =>
    num(t.wnbaDataCard?.last5?.points ?? t.last5Average)
  );
  const combinedLineDemand = line + teammateLines.reduce((s, v) => s + v, 0);
  const combinedRecentAvg =
    num(pick.wnbaDataCard?.last5?.points) +
    teammateRecent.reduce((s, v) => s + v, 0);

  let collisionScore = 0;
  if (teammates.length >= 1) collisionScore += 25;
  if (teammates.length >= 2) collisionScore += 20;

  if (impliedTeamTotal > 0 && combinedLineDemand > impliedTeamTotal * 1.15) {
    collisionScore += 30;
    reasons.push(
      `Combined Over demand ${combinedLineDemand.toFixed(1)} exceeds implied team total ${impliedTeamTotal.toFixed(1)}.`
    );
  }

  if (impliedTeamTotal > 0 && combinedRecentAvg > impliedTeamTotal * 1.05) {
    collisionScore += 15;
    reasons.push("Recent combined scoring already near team ceiling.");
  }

  const sharedUsage =
    teammates.some((t) => {
      const mins = num(t.wnbaDataCard?.last5?.minutes ?? t.recentMinutes);
      const myMins = num(pick.wnbaDataCard?.last5?.minutes ?? pick.recentMinutes);
      return mins >= 24 && myMins >= 24;
    });
  if (sharedUsage) {
    collisionScore += 12;
    reasons.push("Multiple high-minute scorers share usage zones.");
  }

  let recommendation = "KEEP_OVER";
  let sideImpact = "NEUTRAL";
  if (collisionScore >= 45) {
    recommendation = "FLIP_TO_UNDER";
    sideImpact = "UNDER";
    reasons.push("Collision pressure — weaker Over should review Under.");
  } else if (collisionScore >= 30) {
    recommendation = "REVIEW_UNDER";
    sideImpact = "NEUTRAL";
    reasons.push("Collision warning — monitor combined scoring demand.");
  }

  return {
    version: SAME_TEAM_COLLISION_VERSION,
    detected: teammates.length > 0,
    collisionScore: Math.min(100, collisionScore),
    teammatesInConflict: conflictNames,
    combinedLineDemand: Number(combinedLineDemand.toFixed(1)),
    impliedTeamTotal: impliedTeamTotal > 0 ? impliedTeamTotal : null,
    combinedRecentAvg: Number(combinedRecentAvg.toFixed(1)),
    sideImpact,
    recommendation,
    reasons: reasons.slice(0, 6),
  };
}
