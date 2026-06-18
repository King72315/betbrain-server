export type FilterAudit = {
  trackingMode?: string;
  totalScanned?: number;
  builtCandidates?: number;
  playableCandidates?: number;
  displayedProps?: number;
  generatedProps?: number;
  propsPassed?: number;
  trackedToResults?: number;
  officialTracked?: number;
  filteredBeforeGeneration?: number;
  filteredOut?: number;
  filteredPct?: number;
  tierDistribution?: Record<string, number>;
  reasonCounts?: Record<string, number>;
  topReasons?: Array<{ reason: string; count: number }>;
  pipeline?: {
    rawLines?: number;
    riskRejected?: number;
    chosenPicks?: number;
    topPropsListed?: number;
    boardPropsTracked?: number;
  };
  generatedAt?: string;
};

export function formatFilterAuditSummary(audit: FilterAudit | null | undefined) {
  if (!audit) {
    return "Filter audit unavailable — refresh props to generate.";
  }

  const tracked =
    audit.trackedToResults ?? audit.propsPassed ?? audit.officialTracked ?? 0;

  const lines = [
    `Mode: ${audit.trackingMode || "OFFICIAL_ONLY"}`,
    `Scanned: ${audit.totalScanned ?? 0}`,
    `Generated on boards: ${audit.generatedProps ?? audit.displayedProps ?? 0}`,
    `Tracked to Results: ${tracked}`,
    `Filtered out: ${audit.filteredOut ?? 0} (${audit.filteredPct ?? 0}%)`,
  ];

  const reasons = (audit.topReasons || []).filter((item) => item.count > 0);

  if (reasons.length) {
    lines.push(
      "Top filter reasons:",
      ...reasons.slice(0, 8).map((item) => `- ${item.reason}: ${item.count}`)
    );
  }

  return lines.join("\n");
}

export function getFilterAuditReasonRows(
  audit: FilterAudit | null | undefined
): Array<{ reason: string; count: number }> {
  if (!audit) return [];

  if (audit.topReasons?.length) {
    return audit.topReasons.filter((item) => item.count > 0);
  }

  return Object.entries(audit.reasonCounts || {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function getFilterAuditTierRows(
  audit: FilterAudit | null | undefined
): Array<{ tier: string; count: number }> {
  if (!audit?.tierDistribution) return [];

  return Object.entries(audit.tierDistribution)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => ({ tier, count }))
    .sort((a, b) => b.count - a.count);
}
