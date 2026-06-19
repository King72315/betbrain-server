function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "NEUTRAL";
}

function pushRow(rows, row) {
  if (!row?.label) return;
  rows.push({
    category: row.category,
    side: row.side || "NEUTRAL",
    score: row.score ?? null,
    pressure: row.pressure ?? null,
    label: row.label,
    explanation: row.explanation || "",
  });
}

export function buildScoreLedger({
  side = "",
  projection = 0,
  line = 0,
  seasonAverage = 0,
  last5Average = 0,
  fairLine = null,
  fairLineEdge = null,
  volumeProfile = {},
  volumeDangerGates = {},
  marketIntelligence = {},
  availabilityGate = {},
  defenseResult = {},
  opportunity = {},
  riskComparison = {},
  dataQuality = 0,
} = {}) {
  const pickSide = normalizeSide(side);
  const rows = [];

  const edge = num(projection) - num(line);
  if (num(projection) > 0 && num(line) > 0) {
    pushRow(rows, {
      category: "projection",
      side: edge >= 2 ? "OVER" : edge <= -2 ? "UNDER" : "NEUTRAL",
      score: Math.abs(edge) >= 2 ? Math.round(Math.min(Math.abs(edge) * 3, 15)) : 0,
      label:
        edge >= 2
          ? "Projection clears line"
          : edge <= -2
            ? "Projection below line"
            : "Projection near line",
      explanation: `Projection ${projection} vs line ${line} (${edge >= 0 ? "+" : ""}${edge.toFixed(1)})`,
    });
  }

  if (num(last5Average) > 0 && num(line) > 0) {
    const recentEdge = num(last5Average) - num(line);
    pushRow(rows, {
      category: "recent scoring",
      side:
        recentEdge >= 2 ? "OVER" : recentEdge <= -2 ? "UNDER" : "NEUTRAL",
      score: Math.abs(recentEdge) >= 2 ? 8 : 0,
      label:
        recentEdge >= 2
          ? "Recent scoring above line"
          : recentEdge <= -2
            ? "Recent scoring below line"
            : "Recent scoring near line",
      explanation: `Last-5 avg ${last5Average} vs line ${line}`,
    });
  }

  if (volumeProfile.recentFGA > 0) {
    pushRow(rows, {
      category: "volume",
      side:
        volumeProfile.volumeStability === "STABLE" && pickSide === "OVER"
          ? "OVER"
          : volumeProfile.volumeStability === "UNSTABLE"
            ? pickSide
            : "NEUTRAL",
      score: num(volumeProfile.roleChangeScore) || null,
      pressure: num(volumeDangerGates.dangerPressure) || null,
      label: `Volume ${volumeProfile.volumeStability?.toLowerCase() || "profile"}`,
      explanation: `${volumeProfile.recentFGA} FGA / ${volumeProfile.recentMinutes} MIN (${volumeProfile.roleTrend || "stable"} role)`,
    });
  }

  if (fairLine !== null && num(fairLine) > 0 && num(line) > 0) {
    const flEdge = num(fairLineEdge ?? num(fairLine) - num(line));
    pushRow(rows, {
      category: "fair line",
      side:
        flEdge >= 1.5 ? "OVER" : flEdge <= -1.5 ? "UNDER" : "NEUTRAL",
      score: Math.round(Math.min(Math.abs(flEdge) * 5, 15)),
      label: `Fair line ${fairLine}`,
      explanation: `Fair edge ${flEdge >= 0 ? "+" : ""}${flEdge.toFixed(1)} vs book ${line}`,
    });
  }

  if (num(marketIntelligence.marketQuality) > 0) {
    pushRow(rows, {
      category: "market quality",
      side: marketIntelligence.bookCount >= 4 ? pickSide : "NEUTRAL",
      score: num(marketIntelligence.marketQuality),
      label: `Market quality ${marketIntelligence.marketQuality}%`,
      explanation: `${marketIntelligence.bookCount} books, spread ${marketIntelligence.lineSpread}`,
    });
  }

  if (marketIntelligence.lineDelta !== 0) {
    pushRow(rows, {
      category: "line movement",
      side: marketIntelligence.lineMovedAgainstSide ? pickSide : "NEUTRAL",
      pressure: marketIntelligence.lineMovedAgainstSide
        ? num(marketIntelligence.dangerPressure)
        : null,
      score: marketIntelligence.lineMovedAgainstSide
        ? null
        : num(marketIntelligence.supportScore),
      label: marketIntelligence.lineMovedAgainstSide
        ? "Line moved against side"
        : "Line movement neutral/favorable",
      explanation: `Open ${marketIntelligence.openingLine} → ${marketIntelligence.currentLine} (${marketIntelligence.lineDelta >= 0 ? "+" : ""}${marketIntelligence.lineDelta})`,
    });
  }

  if (defenseResult.source !== "default") {
    pushRow(rows, {
      category: "matchup/defense",
      side:
        num(defenseResult.defenseScore) >= 58
          ? "OVER"
          : num(defenseResult.defenseScore) <= 42
            ? "UNDER"
            : "NEUTRAL",
      score: num(defenseResult.defenseScore),
      label: `Defense score ${defenseResult.defenseScore}`,
      explanation: (defenseResult.reasons || []).join("; "),
    });
  }

  if (num(opportunity.opportunityScore) > 0) {
    pushRow(rows, {
      category: "opportunity",
      side: opportunity.opportunityScore >= 65 ? "OVER" : "NEUTRAL",
      score: num(opportunity.opportunityScore),
      label: `Opportunity ${opportunity.opportunityScore}`,
      explanation: (opportunity.reasons || []).slice(0, 2).join("; ") || "Volume/opportunity profile",
    });
  }

  if (availabilityGate.applicable) {
    pushRow(rows, {
      category: "availability",
      side:
        availabilityGate.statusLevel === "OUT"
          ? pickSide
          : availabilityGate.statusLevel === "QUESTIONABLE"
            ? pickSide
            : "NEUTRAL",
      pressure: num(availabilityGate.dangerPressure) || null,
      label: `Availability: ${availabilityGate.statusLevel}`,
      explanation:
        availabilityGate.statusLabel ||
        availabilityGate.status ||
        "No status on file",
    });
  }

  pushRow(rows, {
    category: "data quality",
    side: "NEUTRAL",
    score: num(dataQuality),
    label: `Data quality ${dataQuality}%`,
    explanation: volumeProfile.wnbaLimitedData
      ? "WNBA limited-data mode"
      : "NBA full-data mode",
  });

  for (const gate of volumeDangerGates.gates || []) {
    pushRow(rows, {
      category: "danger gates",
      side: pickSide,
      pressure: num(volumeDangerGates.dangerPressure) || null,
      label: gate.replace(/_/g, " "),
      explanation:
        (volumeDangerGates.dangerReasons || []).find((r) =>
          r.toLowerCase().includes(gate.split("_")[0])
        ) || "Volume danger gate triggered",
    });
  }

  if (num(riskComparison.netEdge) !== 0) {
    pushRow(rows, {
      category: "risk comparison",
      side: pickSide,
      score: num(riskComparison.supportScore),
      pressure:
        num(riskComparison.resistanceScore) > num(riskComparison.supportScore)
          ? 0.15
          : null,
      label: `Net edge ${riskComparison.netEdge}`,
      explanation: `Support ${riskComparison.supportScore} vs resistance ${riskComparison.resistanceScore}`,
    });
  }

  return rows;
}

export function mergeIntelligenceIntoRiskComparison(
  riskComparison = {},
  {
    volumeDangerGates = {},
    marketIntelligence = {},
    availabilityGate = {},
    pickSide = "",
  } = {}
) {
  const side = String(pickSide || riskComparison.pickSide || "").toUpperCase();
  const support = [...(riskComparison.support || [])];
  const resistance = [...(riskComparison.resistance || [])];
  const warnings = [...(riskComparison.warnings || [])];
  const noPlayReasons = [...(riskComparison.noPlayReasons || [])];

  for (const reason of volumeDangerGates.supportReasons || []) {
    if (!support.includes(reason)) support.push(reason);
  }
  for (const reason of volumeDangerGates.dangerReasons || []) {
    if (!resistance.includes(reason)) resistance.push(reason);
  }
  for (const reason of marketIntelligence.supportReasons || []) {
    if (!support.includes(reason)) support.push(reason);
  }
  for (const reason of marketIntelligence.dangerReasons || []) {
    if (!resistance.includes(reason)) resistance.push(reason);
    if (!warnings.includes(reason)) warnings.push(reason);
  }
  for (const reason of availabilityGate.dangerReasons || []) {
    if (!resistance.includes(reason)) resistance.push(reason);
    if (!warnings.includes(reason)) warnings.push(reason);
  }

  let supportScore = num(riskComparison.supportScore);
  let resistanceScore = num(riskComparison.resistanceScore);

  if (side === "OVER") {
    supportScore += num(marketIntelligence.supportScore);
    resistanceScore +=
      num(volumeDangerGates.resistanceScore) +
      num(marketIntelligence.resistanceScore);
  } else if (side === "UNDER") {
    supportScore += num(marketIntelligence.supportScore);
    resistanceScore +=
      num(volumeDangerGates.resistanceScore) * 0.7 +
      num(marketIntelligence.resistanceScore);
  }

  for (const reason of [
    ...(volumeDangerGates.noPlayReasons || []),
    ...(availabilityGate.noPlayReasons || []),
  ]) {
    if (!noPlayReasons.includes(reason)) noPlayReasons.push(reason);
  }

  const netEdge = Number((supportScore - resistanceScore).toFixed(1));
  const totalEvidence = Number((supportScore + resistanceScore).toFixed(1));

  const trustable =
    noPlayReasons.length === 0 && Boolean(riskComparison.trustable);

  return {
    ...riskComparison,
    support,
    resistance,
    danger: resistance,
    warnings,
    supportScore,
    resistanceScore,
    dangerScore: resistanceScore,
    netEdge,
    gap: netEdge,
    totalEvidence,
    noPlayReasons,
    noPlay: !trustable,
    trustable,
    extraDangerPressure:
      num(volumeDangerGates.dangerPressure) +
      num(marketIntelligence.dangerPressure) +
      num(availabilityGate.dangerPressure),
  };
}
