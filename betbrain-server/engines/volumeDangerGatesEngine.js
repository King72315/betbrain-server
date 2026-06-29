function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getThresholds(league = "NBA") {
  if (league === "WNBA") {
    return {
      lowFGA: 6,
      lowMinutes: 20,
      ftaCollapseDelta: -2,
      unstableMinutesRange: 14,
    };
  }

  return {
    lowFGA: 8,
    lowMinutes: 24,
    ftaCollapseDelta: -2.5,
    unstableMinutesRange: 14,
  };
}

export function evaluateVolumeDangerGates({
  volumeProfile = {},
  side = "",
  league = "NBA",
  opportunity = {},
} = {}) {
  const thresholds = getThresholds(league);
  const pickSide = String(side || "").toUpperCase();
  const gates = [];
  const dangerReasons = [];
  const supportReasons = [];
  let dangerPressure = 0;
  let resistanceScore = 0;
  const noPlayReasons = [];

  const {
    recentMinutes = 0,
    seasonMinutes = 0,
    recentFGA = 0,
    seasonFGA = 0,
    recentFTA = 0,
    seasonFTA = 0,
    shotVolume = 0,
    volumeStability = "MODERATE",
    efficiencyWarning = null,
    wnbaLimitedData = false,
    ftaDelta = 0,
    minutesDelta = 0,
  } = volumeProfile;

  const minutesRange = num(opportunity.minutesStability?.range);

  if (volumeStability === "UNSTABLE" || minutesRange >= thresholds.unstableMinutesRange) {
    gates.push("unstable_minutes");
    dangerReasons.push("Unstable minutes profile");
    dangerPressure += 0.12;
    resistanceScore += 8;
    if (pickSide === "OVER") resistanceScore += 4;
  } else if (volumeStability === "VOLATILE") {
    gates.push("volatile_minutes");
    dangerReasons.push("Some minutes volatility");
    dangerPressure += 0.06;
    resistanceScore += 4;
  }

  if (recentFGA > 0 && recentFGA < thresholds.lowFGA) {
    gates.push("low_fga_floor");
    dangerReasons.push(`Low FGA floor (${recentFGA.toFixed(1)})`);
    dangerPressure += 0.1;
    resistanceScore += pickSide === "OVER" ? 10 : 4;
  }

  if (
    seasonFTA > 0 &&
    recentFTA > 0 &&
    (ftaDelta <= thresholds.ftaCollapseDelta ||
      recentFTA <= seasonFTA - 2)
  ) {
    gates.push("fta_collapse");
    dangerReasons.push("Free throw attempt volume collapsing");
    dangerPressure += 0.08;
    resistanceScore += pickSide === "OVER" ? 8 : 3;
  }

  if (efficiencyWarning) {
    gates.push("efficiency_only_scoring");
    dangerReasons.push(efficiencyWarning);
    dangerPressure += 0.1;
    resistanceScore += pickSide === "OVER" ? 9 : 3;
  }

  if (recentMinutes > 0 && recentMinutes < thresholds.lowMinutes) {
    gates.push("low_minutes_floor");
    dangerReasons.push(`Low recent minutes (${recentMinutes.toFixed(1)})`);
    dangerPressure += 0.08;
    resistanceScore += pickSide === "OVER" ? 8 : 3;
  }

  if (
    pickSide === "OVER" &&
    minutesDelta <= -4 &&
    recentMinutes < seasonMinutes - 3
  ) {
    gates.push("contracting_role_over");
    dangerReasons.push("Contracting role vs season — over trap risk");
    dangerPressure += 0.1;
    resistanceScore += 7;
  }

  if (
    pickSide === "OVER" &&
    shotVolume > 0 &&
    shotVolume < 12 &&
    recentFGA < thresholds.lowFGA + 2
  ) {
    gates.push("low_volume_over_trap");
    dangerReasons.push("Low volume over trap — insufficient shot attempts");
    dangerPressure += 0.12;
    resistanceScore += 9;
  }

  if (
    volumeStability === "STABLE" &&
    recentFGA >= thresholds.lowFGA + 4 &&
    recentMinutes >= thresholds.lowMinutes + 4
  ) {
    supportReasons.push("Stable volume profile supports scoring floor");
    gates.push("stable_volume_support");
  }

  dangerPressure = clamp(dangerPressure, 0, 0.45);

  if (
    gates.includes("low_volume_over_trap") &&
    gates.includes("unstable_minutes") &&
    pickSide === "OVER"
  ) {
    noPlayReasons.push("Extreme volume danger — unstable minutes + low FGA over");
  }

  return {
    gates,
    dangerReasons,
    supportReasons,
    dangerPressure,
    resistanceScore,
    noPlay: noPlayReasons.length > 0,
    noPlayReasons,
  };
}
