function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deltaTrend(recent = 0, season = 0, threshold = 1.5) {
  const delta = recent - season;
  if (Math.abs(delta) < threshold) return "FLAT";
  return delta > 0 ? "UP" : "DOWN";
}

function formatDelta(value = 0) {
  const n = num(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

export function buildRoleChange(playerState = {}, usageBoost = null) {
  const {
    league = "NBA",
    seasonMinutes = 0,
    recentMinutes = 0,
    seasonFGA = 0,
    recentFGA = 0,
    seasonFTA = 0,
    recentFTA = 0,
    seasonPoints = 0,
    recentPoints = 0,
    dataAvailability = 0,
    dataMode = "NBA_FULL_DATA",
  } = playerState;

  const expectedMinutesDelta = Number(
    (recentMinutes - seasonMinutes).toFixed(1)
  );
  const expectedFGADelta = Number((recentFGA - seasonFGA).toFixed(1));
  const expectedFTADelta = Number((recentFTA - seasonFTA).toFixed(1));

  const usageDelta = Number(
    (expectedFGADelta + expectedFTADelta * 0.44).toFixed(2)
  );

  const recentMinutesTrend = deltaTrend(recentMinutes, seasonMinutes, 2);
  const recentFGATrend = deltaTrend(recentFGA, seasonFGA, 1.5);
  const recentFTATrend = deltaTrend(recentFTA, seasonFTA, 1);

  const roleChangeReasons = [];
  const roleRiskReasons = [];

  if (recentMinutesTrend === "UP" && expectedMinutesDelta >= 3) {
    roleChangeReasons.push(
      `Minutes trending up (${formatDelta(expectedMinutesDelta)} vs season)`
    );
  } else if (recentMinutesTrend === "DOWN" && expectedMinutesDelta <= -3) {
    roleRiskReasons.push(
      `Minutes trending down (${formatDelta(expectedMinutesDelta)} vs season)`
    );
  }

  if (recentFGATrend === "UP" && expectedFGADelta >= 2) {
    roleChangeReasons.push(
      `Shot volume trending up (${formatDelta(expectedFGADelta)} FGA vs season)`
    );
  } else if (recentFGATrend === "DOWN" && expectedFGADelta <= -2) {
    roleRiskReasons.push(
      `Shot volume trending down (${formatDelta(expectedFGADelta)} FGA vs season)`
    );
  }

  if (recentFTATrend === "UP" && expectedFTADelta >= 1.5) {
    roleChangeReasons.push(
      `Free throw attempts trending up (${formatDelta(expectedFTADelta)} FTA vs season)`
    );
  } else if (recentFTATrend === "DOWN" && expectedFTADelta <= -1.5) {
    roleRiskReasons.push(
      `Free throw attempts trending down (${formatDelta(expectedFTADelta)} FTA vs season)`
    );
  }

  const pointsDelta = recentPoints - seasonPoints;
  if (pointsDelta >= 4) {
    roleChangeReasons.push(
      `Recent scoring above season (${formatDelta(pointsDelta)} PPG)`
    );
  } else if (pointsDelta <= -5) {
    roleRiskReasons.push(
      `Recent scoring below season (${formatDelta(pointsDelta)} PPG)`
    );
  }

  let teammateOutBoost = null;
  if (league === "NBA" && usageBoost) {
    teammateOutBoost = {
      projectionBoost: num(usageBoost.projectionBoost),
      confidenceBoost: num(usageBoost.confidenceBoost),
      usageScore: num(usageBoost.usageScore),
      reasons: usageBoost.reasons || [],
      missingImpact: usageBoost.missingImpact || [],
    };

    if (usageBoost.reasons?.length) {
      for (const reason of usageBoost.reasons.slice(0, 3)) {
        roleChangeReasons.push(`Teammate out boost: ${reason}`);
      }
    }
  }

  const magnitude =
    Math.abs(expectedMinutesDelta) * 2 +
    Math.abs(expectedFGADelta) * 2.5 +
    Math.abs(expectedFTADelta) * 1.5 +
    (teammateOutBoost?.confidenceBoost || 0) * 2;

  let roleChangeScore = clamp(Math.round(50 + magnitude * 2), 0, 100);

  if (roleChangeReasons.length === 0 && roleRiskReasons.length > 0) {
    roleChangeScore = clamp(roleChangeScore - 15, 0, 100);
  }

  let roleChangeCertainty = clamp(
    Math.round(dataAvailability * 0.7 + (dataMode === "NBA_FULL_DATA" ? 20 : 5)),
    0,
    100
  );

  if (recentMinutes === 0 && recentFGA === 0) {
    roleChangeCertainty = clamp(roleChangeCertainty - 25, 0, 100);
    roleRiskReasons.push("Limited recent role sample");
  }

  if (roleChangeReasons.length === 0 && roleRiskReasons.length === 0) {
    roleChangeReasons.push("Role profile stable vs season baseline");
  }

  return {
    expectedMinutesDelta,
    expectedFGADelta,
    expectedFTADelta,
    usageDelta,
    roleChangeScore,
    roleChangeCertainty,
    roleChangeReasons,
    roleRiskReasons,
    recentMinutesTrend,
    recentFGATrend,
    recentFTATrend,
    teammateOutBoost,
  };
}
