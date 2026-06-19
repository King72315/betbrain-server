function safeDisplay(value: any) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);

  if (Number.isFinite(n)) {
    return Number(n.toFixed(1)).toString();
  }

  return String(value);
}

function formatGateLabel(gate: string) {
  return String(gate || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAvailabilitySummary(availabilityGate: any, league = "") {
  if (
    availabilityGate.applicable === false ||
    availabilityGate.status === "N/A" ||
    league === "WNBA"
  ) {
    return "Skipped (WNBA — no injury feed)";
  }

  const level = availabilityGate.statusLevel || availabilityGate.status || "—";
  const label = availabilityGate.statusLabel || availabilityGate.status || "";
  const suffix = availabilityGate.noPlay ? " — NO PLAY" : "";
  return `${level}${label && label !== level ? ` (${label})` : ""}${suffix}`;
}

function formatDefenseSummary(defenseResult: any, league = "") {
  if (league === "WNBA") {
    return `Neutral/deferred (${defenseResult.source || "WNBA"})`;
  }

  const score = defenseResult.defenseScore ?? pickDefenseScore(defenseResult);
  const source = defenseResult.source || "default";
  const reason = defenseResult.reasons?.[0];
  return `${safeDisplay(score)} (${source})${reason ? ` — ${reason}` : ""}`;
}

function pickDefenseScore(defenseResult: any) {
  return defenseResult.defenseScore ?? "—";
}

function formatLineDelta(delta: any) {
  const n = Number(delta);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${safeDisplay(n)}`;
}

export function formatPointStrengthLedgerLines(pick: any): string[] {
  const league = pick.league || "";
  const volumeProfile = pick.volumeProfile || {};
  const marketIntelligence = pick.marketIntelligence || {};
  const volumeDangerGates = pick.volumeDangerGates || {};
  const availabilityGate = pick.availabilityGate || {};
  const defenseResult = pick.defenseResult || {};
  const scoreLedger = pick.scoreLedger || [];

  const openingLine =
    pick.openingLine ?? marketIntelligence.openingLine;
  const currentLine =
    pick.currentLine ?? marketIntelligence.currentLine ?? pick.line;
  const lineDelta =
    pick.lineDelta ?? marketIntelligence.lineDelta;

  const lines: string[] = [];

  if (Object.keys(volumeProfile).length > 0) {
    const limited = volumeProfile.wnbaLimitedData ? " | WNBA limited-data" : "";
    lines.push(
      `Volume: ${safeDisplay(volumeProfile.recentFGA)} FGA / ${safeDisplay(volumeProfile.recentMinutes)} MIN | ${volumeProfile.volumeStability || "—"} | ${volumeProfile.roleTrend || "—"}${limited}`
    );
    if (volumeProfile.efficiencyWarning) {
      lines.push(`  ⚠ ${volumeProfile.efficiencyWarning}`);
    }
  }

  if (openingLine !== undefined || currentLine !== undefined) {
    lines.push(
      `Line: open ${safeDisplay(openingLine)} → ${safeDisplay(currentLine)} (${formatLineDelta(lineDelta)})`
    );
    if (marketIntelligence.lineMovedAgainstSide) {
      lines.push("  Line moved against pick side");
    }
  }

  if (marketIntelligence.signals?.length) {
    lines.push(`Market signals: ${marketIntelligence.signals.join(", ")}`);
  }

  const marketReasons = [
    ...(marketIntelligence.supportReasons || []).slice(0, 2),
    ...(marketIntelligence.dangerReasons || []).slice(0, 2),
  ];
  if (marketReasons.length) {
    lines.push(`Market intel: ${marketReasons.join(" | ")}`);
  }

  if (Object.keys(defenseResult).length > 0 || league) {
    lines.push(`Defense: ${formatDefenseSummary(defenseResult, league)}`);
  }

  if (Object.keys(availabilityGate).length > 0 || league) {
    lines.push(
      `Availability: ${formatAvailabilitySummary(availabilityGate, league)}`
    );
  }

  if (volumeDangerGates.gates?.length) {
    lines.push(
      `Danger gates: ${volumeDangerGates.gates.map(formatGateLabel).join(", ")}`
    );
    const gateReasons = (volumeDangerGates.dangerReasons || []).slice(0, 3);
    if (gateReasons.length) {
      lines.push(`  ${gateReasons.join(" | ")}`);
    }
  }

  if (scoreLedger.length > 0) {
    lines.push("Score ledger:");
    for (const row of scoreLedger.slice(0, 8)) {
      const side =
        row.side && row.side !== "NEUTRAL" ? `[${row.side}] ` : "";
      const detail = row.explanation ? `: ${row.explanation}` : "";
      lines.push(`  • ${side}${row.label}${detail}`);
    }
    if (scoreLedger.length > 8) {
      lines.push(`  … +${scoreLedger.length - 8} more ledger rows`);
    }
  }

  return lines;
}

export function formatPointStrengthLedgerBlock(pick: any): string | null {
  const lines = formatPointStrengthLedgerLines(pick);
  if (!lines.length) return null;
  return lines.map((line) => `  ${line}`).join("\n");
}

export { formatGateLabel, formatAvailabilitySummary, formatDefenseSummary };
