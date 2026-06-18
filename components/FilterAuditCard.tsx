import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  type FilterAudit,
  getFilterAuditReasonRows,
  getFilterAuditTierRows,
} from "../utils/filterAudit";

type Props = {
  audit: FilterAudit | null | undefined;
  compact?: boolean;
};

export default function FilterAuditCard({ audit, compact = false }: Props) {
  if (!audit) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Filter Audit</Text>
        <Text style={styles.muted}>
          Refresh props to load scan vs. track counts.
        </Text>
      </View>
    );
  }

  const reasonRows = getFilterAuditReasonRows(audit);
  const tierRows = getFilterAuditTierRows(audit);
  const tracked =
    audit.trackedToResults ?? audit.propsPassed ?? audit.officialTracked ?? 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Filter Audit</Text>
      <Text style={styles.subtitle}>
        {audit.trackingMode === "ALL_GENERATED_PROPS"
          ? "Testing mode — all board-generated props tracked to Results."
          : "Snapshot of what the engine scanned vs. officially tracked."}
      </Text>

      <View style={styles.metricGrid}>
        <Metric label="Scanned" value={audit.totalScanned ?? 0} />
        <Metric label="Generated" value={audit.generatedProps ?? audit.displayedProps ?? 0} />
        <Metric label="Tracked" value={tracked} accent="#22c55e" />
        <Metric label="Filtered" value={audit.filteredOut ?? 0} accent="#f97316" />
        <Metric
          label="Filtered %"
          value={`${audit.filteredPct ?? 0}%`}
          accent="#fbbf24"
        />
        <Metric
          label="Playable"
          value={audit.playableCandidates ?? 0}
          accent="#93c5fd"
        />
      </View>

      {!compact && audit.pipeline ? (
        <Text style={styles.pipelineMeta}>
          Pipeline: {audit.pipeline.chosenPicks ?? 0} built •{" "}
          {audit.pipeline.riskRejected ?? 0} risk-rejected •{" "}
          {audit.pipeline.boardPropsTracked ?? audit.pipeline.topPropsListed ?? 0} tracked
          from boards • {audit.pipeline.topPropsListed ?? 0} in Top Props
        </Text>
      ) : null}

      {tierRows.length ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonTitle}>Tier distribution (tracked)</Text>
          {tierRows.map((row) => (
            <View key={row.tier} style={styles.reasonRow}>
              <Text style={styles.reasonLabel}>{row.tier}</Text>
              <Text style={styles.reasonCount}>{row.count}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {reasonRows.length ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonTitle}>Filter reasons</Text>
          {reasonRows.slice(0, compact ? 4 : 10).map((row) => (
            <View key={row.reason} style={styles.reasonRow}>
              <Text style={styles.reasonLabel}>{row.reason}</Text>
              <Text style={styles.reasonCount}>{row.count}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>No filter reason breakdown available.</Text>
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  accent = "#f8fafc",
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 16,
  },
  title: {
    color: "#facc15",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  metricBox: {
    minWidth: "30%",
    flexGrow: 1,
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 12,
    marginBottom: 4,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
  },
  pipelineMeta: {
    color: "#64748b",
    fontSize: 12,
    marginBottom: 10,
  },
  reasonBlock: {
    marginTop: 4,
  },
  reasonTitle: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  reasonLabel: {
    color: "#e2e8f0",
    fontSize: 13,
    flex: 1,
    paddingRight: 8,
  },
  reasonCount: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "700",
  },
  muted: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 18,
  },
});
