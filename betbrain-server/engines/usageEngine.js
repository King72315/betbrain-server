// CourtEdge Usage Engine — Points Only
// Purpose:
// - Detect scoring opportunity gained from missing teammates
// - Keep usage boosts conservative
// - Never create fake confidence from weak injury data

const POSITION_FLOW = {
  PG: { PG: 0.45, SG: 0.3, SF: 0.15, PF: 0.05, C: 0.05 },
  SG: { PG: 0.3, SG: 0.4, SF: 0.2, PF: 0.05, C: 0.05 },
  SF: { PG: 0.15, SG: 0.2, SF: 0.35, PF: 0.2, C: 0.1 },
  PF: { PG: 0.05, SG: 0.1, SF: 0.25, PF: 0.35, C: 0.25 },
  C: { PG: 0.05, SG: 0.05, SF: 0.1, PF: 0.3, C: 0.5 },
};

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPlayerName(player = {}) {
  return (
    player.Name ||
    player.PlayerName ||
    player.FullName ||
    player.Player ||
    `${player.FirstName || ""} ${player.LastName || ""}`.trim() ||
    "Unknown Player"
  );
}

function getPosition(player = {}) {
  const pos = String(
    player.Position ||
      player.FantasyPosition ||
      player.DepthChartPosition ||
      "SF"
  ).toUpperCase();

  if (["PG", "SG", "SF", "PF", "C"].includes(pos)) return pos;

  if (pos.includes("G")) return "SG";
  if (pos.includes("F")) return "SF";

  return "SF";
}

function getMinutes(player = {}) {
  const games = num(player.Games || player.GamesPlayed || 0);

  const direct =
    num(player.avgMinutes) ||
    num(player.MinutesPerGame) ||
    num(player.MPG) ||
    num(player.AverageMinutes) ||
    num(player.ProjectedMinutes) ||
    num(player.MinutesPlayed);

  if (direct > 0) return direct;

  const totalMinutes = num(player.Minutes);

  if (totalMinutes > 0 && games > 0) {
    return totalMinutes / games;
  }

  return 0;
}

function getFGA(player = {}) {
  const games = num(player.Games || player.GamesPlayed || 0);

  const direct =
    num(player.avgFGA) ||
    num(player.FGAPerGame) ||
    num(player.FieldGoalsAttemptedPerGame) ||
    num(player.AverageFGA) ||
    num(player.ProjectedFGA) ||
    num(player.FGA);

  if (direct > 0) return direct;

  const totalFGA = num(player.FieldGoalsAttempted);

  if (totalFGA > 0 && games > 0) {
    return totalFGA / games;
  }

  return 0;
}

function getPPG(player = {}) {
  const games = num(player.Games || player.GamesPlayed || 0);

  const direct =
    num(player.PPG) ||
    num(player.PointsPerGame) ||
    num(player.AveragePoints) ||
    num(player.ProjectedPoints);

  if (direct > 0) return direct;

  const totalPoints = num(player.Points);

  if (totalPoints > 0 && games > 0) {
    return totalPoints / games;
  }

  return 0;
}

function getUsageRate(player = {}) {
  return (
    num(player.UsageRate) ||
    num(player.USG) ||
    num(player.Usage) ||
    0
  );
}

function getRoleTier(avgMinutes, avgFGA, ppg = 0, usageRate = 0) {
  if (
    avgMinutes >= 32 &&
    (avgFGA >= 14 || ppg >= 18 || usageRate >= 26)
  ) {
    return "STAR";
  }

  if (
    avgMinutes >= 27 &&
    (avgFGA >= 10 || ppg >= 12 || usageRate >= 20)
  ) {
    return "STARTER";
  }

  if (
    avgMinutes >= 18 &&
    (avgFGA >= 6 || ppg >= 7 || usageRate >= 15)
  ) {
    return "ROLE";
  }

  return "BENCH";
}

function getRoleMultiplier(tier) {
  const multipliers = {
    STAR: 1.6,
    STARTER: 1.05,
    ROLE: 0.55,
    BENCH: 0.2,
  };

  return multipliers[tier] ?? 0.35;
}

function getStatus(player = {}) {
  return String(
    player.Status ||
      player.InjuryStatus ||
      player.GameStatus ||
      player.PlayerStatus ||
      player.InjuryNotes ||
      ""
  ).toLowerCase();
}

function isPlayerMissing(player = {}) {
  const status = getStatus(player);

  return (
    status.includes("out") ||
    status.includes("inactive") ||
    status.includes("suspended") ||
    status.includes("doubtful") ||
    status.includes("injured reserve")
  );
}

function isQuestionable(player = {}) {
  const status = getStatus(player);

  return (
    status.includes("questionable") ||
    status.includes("game time") ||
    status.includes("gtd")
  );
}

function normalizeTeam(value = "") {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase();
  const c = clean(raw);

  const map = {
    "atlanta hawks": "atl",
    "boston celtics": "bos",
    "brooklyn nets": "bkn",
    "charlotte hornets": "cha",
    "chicago bulls": "chi",
    "cleveland cavaliers": "cle",
    "dallas mavericks": "dal",
    "denver nuggets": "den",
    "detroit pistons": "det",
    "golden state warriors": "gs",
    "houston rockets": "hou",
    "indiana pacers": "ind",
    "los angeles clippers": "lac",
    "los angeles lakers": "lal",
    "memphis grizzlies": "mem",
    "miami heat": "mia",
    "milwaukee bucks": "mil",
    "minnesota timberwolves": "min",
    "new orleans pelicans": "no",
    "new york knicks": "ny",
    "oklahoma city thunder": "okc",
    "orlando magic": "orl",
    "philadelphia 76ers": "phi",
    "phoenix suns": "phx",
    "portland trail blazers": "por",
    "sacramento kings": "sac",
    "san antonio spurs": "sa",
    "toronto raptors": "tor",
    "utah jazz": "uta",
    "washington wizards": "was",

    atl: "atl",
    bos: "bos",
    bkn: "bkn",
    brk: "bkn",
    cha: "cha",
    chi: "chi",
    cle: "cle",
    dal: "dal",
    den: "den",
    det: "det",
    gsw: "gs",
    gs: "gs",
    hou: "hou",
    ind: "ind",
    lac: "lac",
    lal: "lal",
    mem: "mem",
    mia: "mia",
    mil: "mil",
    min: "min",
    nop: "no",
    no: "no",
    nyk: "ny",
    ny: "ny",
    okc: "okc",
    orl: "orl",
    phi: "phi",
    phx: "phx",
    por: "por",
    sac: "sac",
    sas: "sa",
    sa: "sa",
    tor: "tor",
    uta: "uta",
    was: "was",
  };

  return map[v] || map[c] || c;
}

function getTeam(player = {}) {
  return normalizeTeam(
    player.Team ||
      player.team ||
      player.TeamAbbreviation ||
      player.CurrentTeam ||
      player.CurrentTeamAbbreviation ||
      ""
  );
}

function buildMissingPlayerProfile(player = {}) {
  const minutes = getMinutes(player);
  const fga = getFGA(player);
  const ppg = getPPG(player);
  const usageRate = getUsageRate(player);
  const position = getPosition(player);
  const tier = getRoleTier(minutes, fga, ppg, usageRate);

  let impactScore = 0;

  if (tier === "STAR") impactScore += 30;
  else if (tier === "STARTER") impactScore += 20;
  else if (tier === "ROLE") impactScore += 10;
  else impactScore += 3;

  if (minutes >= 32) impactScore += 15;
  else if (minutes >= 27) impactScore += 10;
  else if (minutes >= 18) impactScore += 5;

  if (fga >= 14) impactScore += 15;
  else if (fga >= 10) impactScore += 10;
  else if (fga >= 6) impactScore += 5;

  if (ppg >= 18) impactScore += 12;
  else if (ppg >= 12) impactScore += 8;
  else if (ppg >= 7) impactScore += 4;

  if (usageRate >= 26) impactScore += 8;
  else if (usageRate >= 20) impactScore += 5;

  if (isQuestionable(player)) {
    impactScore = Math.round(impactScore * 0.45);
  }

  return {
    player: getPlayerName(player),
    team: getTeam(player),
    position,
    minutes: Number(minutes.toFixed(1)),
    fga: Number(fga.toFixed(1)),
    ppg: Number(ppg.toFixed(1)),
    usageRate: Number(usageRate.toFixed(1)),
    tier,
    status: getStatus(player),
    missing: isPlayerMissing(player),
    questionable: isQuestionable(player),
    impactScore: clamp(Math.round(impactScore), 0, 100),
  };
}

export function getMissingPlayers(team, allPlayers = []) {
  if (!team || !Array.isArray(allPlayers)) return [];

  const targetTeam = normalizeTeam(team);

  return allPlayers
    .filter((player) => getTeam(player) === targetTeam)
    .filter((player) => isPlayerMissing(player) || isQuestionable(player))
    .map(buildMissingPlayerProfile)
    .filter((profile) => profile.impactScore >= 8)
    .sort((a, b) => b.impactScore - a.impactScore);
}

export { getRoleTier };

export function calcUsageBoost(playerData = {}, stat = "Points", missingPlayers = []) {
  if (stat !== "Points") {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      usageScore: 50,
      reasons: [],
      warnings: [],
      missingImpact: [],
      log: "USAGE ENGINE: skipped because stat is not Points",
    };
  }

  if (!playerData) {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      usageScore: 50,
      reasons: [],
      warnings: ["Missing player data for usage engine"],
      missingImpact: [],
      log: "USAGE ENGINE: missing player data",
    };
  }

  if (!Array.isArray(missingPlayers) || missingPlayers.length === 0) {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      usageScore: 50,
      reasons: [],
      warnings: [],
      missingImpact: [],
      log: "USAGE ENGINE: no missing players",
    };
  }

  const playerName = getPlayerName(playerData);
  const playerPos = getPosition(playerData);
  const playerMinutes = getMinutes(playerData);
  const playerFGA = getFGA(playerData);
  const playerPPG = getPPG(playerData);
  const playerUsageRate = getUsageRate(playerData);
  const playerTier = getRoleTier(
    playerMinutes,
    playerFGA,
    playerPPG,
    playerUsageRate
  );

  let projectionBoost = 0;
  let confidenceBoost = 0;
  let usageScore = 50;

  const reasons = [];
  const warnings = [];
  const missingImpact = [];

  for (const missing of missingPlayers) {
    const missingProfile =
      missing.impactScore !== undefined
        ? missing
        : buildMissingPlayerProfile(missing);

    if (missingProfile.impactScore < 8) continue;

    const missingPos = missingProfile.position || "SF";
    const flow = POSITION_FLOW[missingPos]?.[playerPos] ?? 0.1;
    const roleMultiplier = getRoleMultiplier(missingProfile.tier);

    const statusMultiplier = missingProfile.questionable ? 0.45 : 1;

    const playerRoleMultiplier =
      playerTier === "STAR"
        ? 1.15
        : playerTier === "STARTER"
          ? 1
          : playerTier === "ROLE"
            ? 0.75
            : 0.45;

    const impactMultiplier = clamp(missingProfile.impactScore / 50, 0.2, 1.4);

    const rawProjectionBoost =
      flow *
      roleMultiplier *
      playerRoleMultiplier *
      impactMultiplier *
      statusMultiplier *
      3.4;

    const rawConfidenceBoost =
      flow *
      roleMultiplier *
      playerRoleMultiplier *
      impactMultiplier *
      statusMultiplier *
      7.5;

    projectionBoost += rawProjectionBoost;
    confidenceBoost += rawConfidenceBoost;

    usageScore += rawConfidenceBoost * 2.2;

    const reason = `${missingProfile.player} ${missingProfile.questionable ? "questionable" : "out"} (${missingProfile.tier})`;

    reasons.push(reason);

    missingImpact.push({
      ...missingProfile,
      flowToPlayerPosition: Number(flow.toFixed(2)),
      projectionBoost: Number(rawProjectionBoost.toFixed(2)),
      confidenceBoost: Number(rawConfidenceBoost.toFixed(2)),
    });
  }

  if (missingImpact.length === 0) {
    return {
      projectionBoost: 0,
      confidenceBoost: 0,
      usageScore: 50,
      reasons: [],
      warnings: ["Missing-player data was too weak to create usage boost"],
      missingImpact: [],
      log: `USAGE ENGINE: ${playerName} | missing impact too weak`,
    };
  }

  if (playerMinutes > 0 && playerMinutes < 20) {
    projectionBoost *= 0.6;
    confidenceBoost *= 0.6;
    usageScore -= 8;
    warnings.push("Player minutes are too low to fully absorb missing usage");
  }

  if (playerFGA > 0 && playerFGA < 7) {
    projectionBoost *= 0.75;
    confidenceBoost *= 0.75;
    usageScore -= 5;
    warnings.push("Player shot volume is low for a major usage bump");
  }

  projectionBoost = clamp(Number(projectionBoost.toFixed(1)), 0, 3.2);
  confidenceBoost = clamp(Math.round(confidenceBoost), 0, 6);
  usageScore = clamp(Math.round(usageScore), 0, 100);

  return {
    projectionBoost,
    confidenceBoost,
    usageScore,
    reasons,
    warnings,
    missingImpact,

    playerUsageProfile: {
      player: playerName,
      position: playerPos,
      tier: playerTier,
      minutes: Number(playerMinutes.toFixed(1)),
      fga: Number(playerFGA.toFixed(1)),
      ppg: Number(playerPPG.toFixed(1)),
      usageRate: Number(playerUsageRate.toFixed(1)),
    },

    log:
      `USAGE ENGINE: ${playerName} | ` +
      `missing: ${reasons.join(", ")} | ` +
      `proj:+${projectionBoost} conf:+${confidenceBoost} usageScore:${usageScore}`,
  };
}