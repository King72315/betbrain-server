import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    RefreshControl,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import {
    fetchTopProps,
    refreshSavedPicks,
    savePick,
} from "../../services/api";

const FILTERS = ["ALL", "NBA", "WNBA"] as const;

type LeagueFilter = (typeof FILTERS)[number];

export default function TopPropsScreen() {
  const [topProps, setTopProps] = useState<any[]>([]);
  const [topNBAProps, setTopNBAProps] = useState<any[]>([]);
  const [topWNBAProps, setTopWNBAProps] = useState<any[]>([]);
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    loadTopProps();
  }, []);

  const visibleProps = useMemo(() => {
    if (leagueFilter === "NBA") return topNBAProps;
    if (leagueFilter === "WNBA") return topWNBAProps;
    return topProps;
  }, [leagueFilter, topProps, topNBAProps, topWNBAProps]);

  const loadTopProps = async () => {
    try {
      setLoading(true);

      const data = await fetchTopProps();

      setTopProps(data.topProps || []);
      setTopNBAProps(data.topNBAProps || []);
      setTopWNBAProps(data.topWNBAProps || []);
      setLastUpdated(data.lastUpdated || null);
    } catch (err) {
      console.log("LOAD TOP PROPS ERROR:", err);
      setTopProps([]);
      setTopNBAProps([]);
      setTopWNBAProps([]);
    } finally {
      setLoading(false);
    }
  };

  const runRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshSavedPicks();
      await loadTopProps();
    } catch (err) {
      console.log("REFRESH TOP PROPS ERROR:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePick = async (pick: any) => {
    const saved = await savePick({
      ...pick,
      savedAt: new Date().toISOString(),
    });

    if (saved.ok) {
      Alert.alert("Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

  const formatTime = (value: any) => {
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
  };

  const premiumCount = visibleProps.filter(
    (pick) => String(pick.tier || "").toUpperCase() === "PREMIUM"
  ).length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={runRefresh} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>🔥 Top Props</Text>
          <Text style={styles.subtitle}>CourtEdge — Powered by BetBrain</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(lastUpdated)}
            </Text>
          )}
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              onPress={() => setLeagueFilter(filter)}
              style={[
                styles.filterButton,
                leagueFilter === filter && styles.activeFilterButton,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  leagueFilter === filter && styles.activeFilterText,
                ]}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={runRefresh}
          style={styles.refreshButton}
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshText}>
            {loading || refreshing ? "Refreshing..." : "Refresh Top Props"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Props</Text>
            <Text style={styles.summaryValue}>{visibleProps.length}</Text>
          </View>

          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Premium</Text>
            <Text style={styles.summaryValue}>{premiumCount}</Text>
          </View>

          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>League</Text>
            <Text style={styles.summaryValue}>{leagueFilter}</Text>
          </View>
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading top props...</Text>
        )}

        {!loading && visibleProps.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No top props available.</Text>
            <Text style={styles.emptyText}>
              Refresh picks or check backend/API connection.
            </Text>
          </View>
        )}

        {!loading &&
          visibleProps.map((pick, index) => (
            <TopPropCard
              key={`${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
              pick={pick}
              index={index}
              onSave={() => handleSavePick(pick)}
            />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function TopPropCard({
  pick,
  index,
  onSave,
}: {
  pick: any;
  index: number;
  onSave: () => void;
}) {
  const tier = String(pick.tier || "WATCHLIST").toUpperCase();
  const confidence = pick.confidence ?? pick.winProbability ?? 0;
  const riskLabel = pick.riskLabel || "Risk Pending";
  const signalStrength = pick.signalStrength || "WEAK";

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onSave}
      style={[styles.pickCard, tier === "PREMIUM" && styles.premiumPickCard]}
    >
      <View style={styles.pickTopRow}>
        <View style={styles.badgeRow}>
          <Text style={styles.rankBadge}>#{pick.rank || index + 1}</Text>
          <Text style={styles.leagueBadge}>{pick.league || "—"}</Text>
          <Text
            style={[
              styles.tierBadge,
              tier === "PREMIUM" && styles.premiumBadge,
            ]}
          >
            {tier}
          </Text>
        </View>

        <Text style={styles.confidenceText}>{safeDisplay(confidence)}%</Text>
      </View>

      <Text style={styles.playerName}>{pick.player}</Text>

      <Text style={styles.gameText}>
        {pick.game || `${formatTeam(pick.team)} vs ${formatTeam(pick.opponent)}`}
      </Text>

      {pick.commenceTime || pick.time ? (
        <Text style={styles.timeText}>{formatCardTime(pick.commenceTime || pick.time)}</Text>
      ) : null}

      <View style={styles.pickLineBox}>
        <Text style={styles.pickSide}>
          {pick.pick} {pick.line} Points
        </Text>
        <Text style={styles.projectionText}>
          Projection {safeDisplay(pick.projection)} • Edge {safeDisplay(pick.edge)}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <Metric label="Risk" value={riskLabel} />
        <Metric label="Signal" value={signalStrength} />
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

      <View style={styles.statRow}>
        <Text style={styles.statText}>
          Last 5 Hit: {safeDisplay(pick.last5HitRate)}%
        </Text>
        <Text style={styles.statText}>
          Line Spread: {safeDisplay(pick.lineSpread)}
        </Text>
      </View>

      {pick.reasons?.length > 0 && (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonTitle}>Support</Text>
          {pick.reasons.slice(0, 4).map((reason: string, i: number) => (
            <Text key={`${reason}-${i}`} style={styles.reasonText}>
              ✅ {reason}
            </Text>
          ))}
        </View>
      )}

      {pick.risks?.length > 0 && (
        <View style={styles.riskBox}>
          <Text style={styles.riskTitle}>Danger</Text>
          {pick.risks.slice(0, 3).map((risk: string, i: number) => (
            <Text key={`${risk}-${i}`} style={styles.riskText}>
              ⚠️ {risk}
            </Text>
          ))}
        </View>
      )}

      {pick.marketWarnings?.length > 0 && (
        <Text style={styles.warningText}>
          Market: {pick.marketWarnings.slice(0, 2).join(" • ")}
        </Text>
      )}

      <Text style={styles.saveHint}>Tap card to save pick</Text>
    </TouchableOpacity>
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

function safeDisplay(value: any) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);

  if (Number.isFinite(n)) {
    return Number(n.toFixed(1)).toString();
  }

  return String(value);
}

function formatTeam(value: any) {
  if (!value) return "—";

  const raw = String(value);

  if (raw.length <= 3) return raw.toUpperCase();

  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .toUpperCase();
}

function formatCardTime(value: any) {
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },

  scroll: {
    flex: 1,
    backgroundColor: "#020617",
  },

  content: {
    padding: 16,
    paddingBottom: 36,
  },

  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 16,
  },

  title: {
    color: "#facc15",
    fontSize: 36,
    fontWeight: "900",
  },

  subtitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },

  motto: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
  },

  lastUpdated: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
  },

  filterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },

  filterButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },

  activeFilterButton: {
    borderColor: "#22c55e",
    backgroundColor: "#052e16",
  },

  filterText: {
    color: "#94a3b8",
    textAlign: "center",
    fontWeight: "900",
  },

  activeFilterText: {
    color: "#86efac",
  },

  refreshButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 14,
  },

  refreshText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },

  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },

  summaryBox: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },

  summaryLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },

  summaryValue: {
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "900",
  },

  loadingText: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },

  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
  },

  emptyTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 6,
  },

  emptyText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },

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

  timeText: {
    color: "#64748b",
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

  reasonBox: {
    marginTop: 10,
    backgroundColor: "#052e16",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#166534",
  },

  reasonTitle: {
    color: "#86efac",
    fontWeight: "900",
    marginBottom: 4,
  },

  reasonText: {
    color: "#dcfce7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },

  riskBox: {
    marginTop: 10,
    backgroundColor: "#450a0a",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },

  riskTitle: {
    color: "#fecaca",
    fontWeight: "900",
    marginBottom: 4,
  },

  riskText: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },

  warningText: {
    color: "#fcd34d",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },

  saveHint: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "right",
  },
});