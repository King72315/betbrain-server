function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deriveRoleTrend(roleChange = {}) {
  const trends = [
    roleChange.recentMinutesTrend,
    roleChange.recentFGATrend,
    roleChange.recentFTATrend,
  ].filter(Boolean);

  const up = trends.filter((t) => t === "UP").length;
  const down = trends.filter((t) => t === "DOWN").length;

  if (up >= 2 && down === 0) return "EXPANDING";
  if (down >= 2 && up === 0) return "CONTRACTING";
  if (up > down) return "UP";
  if (down > up) return "DOWN";
  return "STABLE";
}

function deriveVolumeStability(opportunity = {}, roleChange = {}) {
  const minutesRange = num(opportunity.minutesStability?.range);
  const fgaRange = num(opportunity.shotVolumeStability?.range);
  const roleCertainty = num(opportunity.roleCertainty);

  if (minutesRange >= 14 || fgaRange >= 8) return "UNSTABLE";
  if (minutesRange >= 10 || fgaRange >= 6 || roleCertainty < 45) {
    return "VOLATILE";
  }
  if (minutesRange <= 6 && fgaRange <= 4 && roleCertainty >= 70) {
    return "STABLE";
  }
  return "MODERATE";
}

function deriveEfficiencyWarning(playerState = {}, opportunity = {}) {
  const recentEff = num(playerState.recentEfficiency);
  const seasonEff = num(playerState.seasonEfficiency);
  const recentFGA = num(
    playerState.recentFGA ?? opportunity.recentFGA
  );
  const recentFTA = num(
    playerState.recentFTA ?? opportunity.recentFTA
  );
  const recentPoints = num(
    playerState.recentPoints ?? opportunity.recentPoints
  );

  if (recentEff <= 0 || seasonEff <= 0) return null;

  const effDelta = recentEff - seasonEff;
  const lowVolume =
    recentFGA < 8 && recentFTA < 2 && recentPoints >= 12;

  if (effDelta >= 0.08 && recentFGA < 10) {
    return "Efficiency-only scoring spike — low FGA floor";
  }

  if (lowVolume && recentPoints >= 15) {
    return "Scoring driven by hot shooting, not volume";
  }

  if (effDelta <= -0.1 && recentPoints >= seasonEff * 8) {
    return "Recent efficiency regression risk";
  }

  return null;
}

export function buildVolumeProfile({
  playerState = {},
  opportunity = {},
  roleChange = {},
  league = "NBA",
} = {}) {
  const recentMinutes = num(
    playerState.recentMinutes ?? opportunity.recentMinutes
  );
  const seasonMinutes = num(playerState.seasonMinutes);
  const recentFGA = num(playerState.recentFGA ?? opportunity.recentFGA);
  const seasonFGA = num(playerState.seasonFGA);
  const recentFTA = num(playerState.recentFTA ?? opportunity.recentFTA);
  const seasonFTA = num(playerState.seasonFTA);
  const recent3PA = num(opportunity.recent3PA);
  const shotVolume = num(
    opportunity.shotVolume ?? recentFGA + recentFTA * 0.44
  );

  const volatility =
    opportunity.scoringVolatility?.label ||
    playerState.volatility ||
    "UNKNOWN";

  const roleTrend = deriveRoleTrend(roleChange);
  const volumeStability = deriveVolumeStability(opportunity, roleChange);
  const efficiencyWarning = deriveEfficiencyWarning(playerState, opportunity);

  const wnbaLimitedData = league === "WNBA";

  return {
    recentMinutes,
    seasonMinutes,
    recentFGA,
    seasonFGA,
    recentFTA,
    seasonFTA,
    recent3PA,
    shotVolume,
    roleTrend,
    volumeStability,
    volatility,
    efficiencyWarning,
    wnbaLimitedData,
    dataMode: wnbaLimitedData ? "WNBA_LIMITED_DATA" : "NBA_FULL_DATA",
    minutesDelta: num(roleChange.expectedMinutesDelta),
    fgaDelta: num(roleChange.expectedFGADelta),
    ftaDelta: num(roleChange.expectedFTADelta),
    roleChangeScore: num(roleChange.roleChangeScore),
    roleChangeCertainty: num(roleChange.roleChangeCertainty),
  };
}
