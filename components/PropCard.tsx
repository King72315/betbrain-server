import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type PropCardProps = {
  pick: any;
  index?: number;
  game?: any;
  onSave?: () => void;
  onDelete?: () => void;
  showSaveHint?: boolean;
  showDelete?: boolean;
};

export default function PropCard({
  pick,
  index = 0,
  game = {},
  onSave,
  onDelete,
  showSaveHint = false,
  showDelete = false,
}: PropCardProps) {
  const [expanded, setExpanded] = useState(false);

  const tier = String(pick.tier || "WATCHLIST").toUpperCase();
  const confidence = pick.confidence ?? pick.winProbability ?? 0;
  const side = pick.side || pick.pick || "";
  const line = pick.line ?? pick.sportsbookLine;
  const stat = pick.stat || "Points";
  const league = pick.league || game.league || "—";
  const status = getStatusLabel(pick);
  const commenceTime =
    pick.commenceTime || pick.time || game.commenceTime || game.time;
  const startTimeDisplay =
    pick.startTimeDisplay || formatTime(commenceTime);
  const matchDate =
    pick.gameDate || pick.date || game.date || game.gameDate || "";
  const dayBucketLabel =
    pick.dateLabel ||
    game.dateLabel ||
    (pick.dayBucket ? String(pick.dayBucket) : "");
  const team = pick.team || "—";
  const opponent = pick.opponent || "—";
  const gameLabel =
    pick.game ||
    game.game ||
    `${formatTeam(team)} vs ${formatTeam(opponent)}`;

  return (
    <TouchableOpacity
      activeOpacity={onSave ? 0.86 : 1}
      onPress={onSave}
      disabled={!onSave}
      style={[styles.pickCard, tier === "PREMIUM" && styles.premiumPickCard]}
    >
      <View style={styles.pickTopRow}>
        <View style={styles.badgeRow}>
          <Text style={styles.rankBadge}>#{pick.rank || index + 1}</Text>
          <Text style={styles.leagueBadge}>{league}</Text>
          <Text
            style={[styles.tierBadge, tier === "PREMIUM" && styles.premiumBadge]}
          >
            {tier}
          </Text>
          {status ? (
            <Text style={[styles.statusBadge, getStatusStyle(status)]}>
              {status}
            </Text>
          ) : null}
        </View>

        <Text style={styles.confidenceText}>{safeDisplay(confidence)}%</Text>
      </View>

      <Text style={styles.playerName}>{pick.player}</Text>
      <Text style={styles.gameText}>{gameLabel}</Text>
      <Text style={styles.metaText}>
        {dayBucketLabel ? `${dayBucketLabel}` : ""}
        {matchDate ? `${dayBucketLabel ? " • " : ""}Date: ${matchDate}` : ""}
        {startTimeDisplay
          ? `${dayBucketLabel || matchDate ? " • " : ""}Start: ${startTimeDisplay}`
          : ""}
      </Text>
      <Text style={styles.teamText}>
        {formatTeam(team)} vs {formatTeam(opponent)}
      </Text>

      <View style={styles.pickLineBox}>
        <Text style={styles.pickSide}>
          {side} {safeDisplay(line)} {stat}
        </Text>
        <Text style={styles.projectionText}>
          Projection {safeDisplay(pick.projection)} • Edge {safeDisplay(pick.edge)}
        </Text>
        {pick.odds || pick.price ? (
          <Text style={styles.projectionText}>
            Odds {safeDisplay(pick.odds ?? pick.price)}
          </Text>
        ) : null}
      </View>

      <View style={styles.metricGrid}>
        <Metric label="Risk" value={pick.riskLabel || "—"} />
        <Metric label="Signal" value={pick.signalStrength || "—"} />
        <Metric label="Support" value={safeDisplay(pick.supportScore)} />
        <Metric
          label="Danger"
          value={safeDisplay(pick.resistanceScore ?? pick.dangerScore)}
        />
        <Metric label="Net Edge" value={safeDisplay(pick.netEdge)} />
        <Metric label="Books" value={safeDisplay(pick.bookCount)} />
        <Metric label="Data" value={`${safeDisplay(pick.dataQuality)}%`} />
        <Metric label="Market" value={`${safeDisplay(pick.marketQuality)}%`} />
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statText}>
          Last 5 Avg: {safeDisplay(pick.last5Average)}
        </Text>
        <Text style={styles.statText}>
          Season Avg: {safeDisplay(pick.seasonAverage)}
        </Text>
      </View>

      {(pick.reasons?.length > 0 || pick.risks?.length > 0) && (
        <View style={styles.previewBox}>
          {pick.reasons?.slice(0, 2).map((reason: string, i: number) => (
            <Text key={`reason-${i}`} style={styles.previewReason}>
              ✅ {reason}
            </Text>
          ))}
          {pick.risks?.slice(0, 2).map((risk: string, i: number) => (
            <Text key={`risk-${i}`} style={styles.previewRisk}>
              ⚠️ {risk}
            </Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={() => setExpanded((value) => !value)}
        style={styles.expandButton}
      >
        <Text style={styles.expandButtonText}>
          {expanded ? "Hide Why This Prop?" : "Why This Prop?"}
        </Text>
      </TouchableOpacity>

      {expanded && <PropFactors pick={pick} />}

      {showSaveHint && onSave ? (
        <Text style={styles.saveHint}>Tap card to save pick</Text>
      ) : null}

      {showDelete && onDelete ? (
        <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
          <Text style={styles.deleteButtonText}>Delete Pick</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export function PropFactors({ pick }: { pick: any }) {
  const sections = [
    {
      title: "Confidence Adjustments",
      items: pick.confidenceAdjustmentReasons || [],
    },
    { title: "Tier Reasons", items: pick.tierReasons || [] },
    { title: "Support", items: pick.reasons || pick.boosts || [] },
    { title: "Danger", items: pick.risks || pick.penalties || [] },
    {
      title: "Warnings",
      items: [
        ...(pick.warnings || []),
        ...(pick.marketWarnings || []),
        ...(pick.riskWarnings || []),
      ],
    },
    { title: "Risk Reasons", items: pick.riskReasons || [] },
  ];

  const metrics = [
    ["Raw Confidence", pick.rawConfidenceBeforeReliability],
    ["Evidence Reliability", formatPercent(pick.evidenceReliability)],
    ["Danger Pressure", formatPercent(pick.dangerPressure)],
    ["Chosen Risk", pick.chosenRisk],
    ["Support Score", pick.supportScore],
    ["Resistance Score", pick.resistanceScore],
    ["Net Edge", pick.netEdge],
    ["Data Coverage", pick.dataCoverage],
    ["Opportunity Score", pick.opportunityScore],
    ["Last 5 Hit Rate", pick.last5HitRate],
    ["Minutes Avg", pick.minutesAverage ?? pick.recentMinutes],
    ["FGA Avg", pick.fgaAverage ?? pick.recentFGA],
    ["FTA Avg", pick.ftaAverage ?? pick.recentFTA],
    ["Line Spread", pick.lineSpread],
    ["Market Quality", pick.marketQuality],
  ];

  return (
    <View style={styles.factorsBox}>
      <Text style={styles.factorsTitle}>Why This Prop?</Text>

      <View style={styles.metricGrid}>
        {metrics.map(([label, value]) => (
          <Metric key={String(label)} label={String(label)} value={safeDisplay(value)} />
        ))}
      </View>

      {sections.map((section) =>
        section.items?.length ? (
          <View key={section.title} style={styles.factorSection}>
            <Text style={styles.factorSectionTitle}>{section.title}</Text>
            {section.items.map((item: string, index: number) => (
              <Text key={`${section.title}-${index}`} style={styles.factorItem}>
                • {item}
              </Text>
            ))}
          </View>
        ) : null
      )}
    </View>
  );
}

export function ResultMarginText({ pick }: { pick: any }) {
  const side = pick.side || pick.pick || "";
  const line = pick.line ?? pick.sportsbookLine;
  const actual = getActual(pick);
  const margin = pick.resultMargin ?? pick.margin;

  if (actual === null || actual === undefined || actual === "") {
    return <Text style={styles.statText}>Result pending</Text>;
  }

  const prefix =
    String(pick.status || "").toLowerCase() === "win"
      ? "Won by"
      : String(pick.status || "").toLowerCase() === "loss"
        ? "Lost by"
        : "Push";

  return (
    <Text style={styles.statText}>
      {side} {safeDisplay(line)} • Actual {safeDisplay(actual)} • {prefix}{" "}
      {margin !== null && margin !== undefined && margin !== ""
        ? `${Number(margin) > 0 ? "+" : ""}${safeDisplay(margin)}`
        : "0"}
    </Text>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function safeDisplay(value: any) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);

  if (Number.isFinite(n)) {
    return Number(n.toFixed(1)).toString();
  }

  return String(value);
}

export function formatTeam(value: any) {
  if (!value) return "—";

  const raw = String(value);

  if (raw.length <= 3) return raw.toUpperCase();

  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .toUpperCase();
}

export function formatTime(value: any) {
  if (!value) return "";

  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);

  return (
    d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " CT"
  );
}

function formatPercent(value: any) {
  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  return `${Math.round(n * 100)}%`;
}

function getActual(pick: any) {
  return (
    pick.actualStat ??
    pick.actualPoints ??
    pick.finalPoints ??
    pick.resultMeta?.points ??
    null
  );
}

function getStatusLabel(pick: any) {
  const raw = String(pick.status || "upcoming").toLowerCase();

  if (raw === "win") return "Graded";
  if (raw === "loss") return "Graded";
  if (raw === "push") return "Graded";
  if (raw === "pending") return "Pending";

  return "Upcoming";
}

function getStatusStyle(status: string) {
  if (status === "Graded") {
    return { backgroundColor: "#14532d", color: "#bbf7d0" };
  }

  if (status === "Pending") {
    return { backgroundColor: "#1e3a8a", color: "#bfdbfe" };
  }

  return { backgroundColor: "#334155", color: "#e2e8f0" };
}

const styles = StyleSheet.create({
  pickCard: {
    backgroundColor: "#1e293b",
    padding: 15,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  premiumPickCard: {
    borderColor: "#facc15",
    backgroundColor: "#172033",
  },
  pickTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  rankBadge: {
    color: "#e2e8f0",
    backgroundColor: "#334155",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  leagueBadge: {
    color: "#bfdbfe",
    backgroundColor: "#1e40af",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  tierBadge: {
    color: "#bbf7d0",
    backgroundColor: "#14532d",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  premiumBadge: {
    color: "#fef9c3",
    backgroundColor: "#713f12",
  },
  statusBadge: {
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  confidenceText: {
    color: "#22c55e",
    fontSize: 24,
    fontWeight: "900",
  },
  playerName: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  gameText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4,
  },
  metaText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  teamText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 10,
  },
  pickLineBox: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263449",
    marginBottom: 12,
  },
  pickSide: {
    color: "#93c5fd",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  projectionText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  metricBox: {
    width: "48%",
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#263449",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  statText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  previewBox: {
    marginBottom: 10,
  },
  previewReason: {
    color: "#dcfce7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  previewRisk: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  expandButton: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 4,
  },
  expandButtonText: {
    color: "#93c5fd",
    fontWeight: "900",
    textAlign: "center",
  },
  factorsBox: {
    marginTop: 10,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  factorsTitle: {
    color: "#facc15",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 10,
  },
  factorSection: {
    marginTop: 10,
  },
  factorSectionTitle: {
    color: "#93c5fd",
    fontWeight: "900",
    marginBottom: 4,
  },
  factorItem: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  saveHint: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "right",
  },
  deleteButton: {
    marginTop: 10,
    backgroundColor: "#7f1d1d",
    borderRadius: 12,
    paddingVertical: 10,
  },
  deleteButtonText: {
    color: "#fecaca",
    fontWeight: "900",
    textAlign: "center",
  },
});
