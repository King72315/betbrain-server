import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
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

import PropCard, { formatTime, safeDisplay } from "../../components/PropCard";
import CopyReportButton from "../../components/CopyReportButton";
import { deletePick, fetchPickHistory, resolvePicks } from "../../services/api";
import { buildSavedPicksReport } from "../../utils/reportBuilders";

const FILTERS = ["All", "Pending", "Win", "Loss", "Push", "Premium"] as const;

type Filter = (typeof FILTERS)[number];

export default function ViewPicksScreen() {
  const [picks, setPicks] = useState<any[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadIdRef = useRef(0);

  const applyPicks = (nextPicks: any[], loadId: number) => {
    if (loadId !== loadIdRef.current) return;
    if (Array.isArray(nextPicks)) {
      setPicks(nextPicks);
    }
  };

  const loadPicks = async (
    resolvedPicks: any[] | null = null,
    loadId = loadIdRef.current
  ) => {
    const data = await fetchPickHistory();

    if (data.ok && Array.isArray(data.picks)) {
      applyPicks(data.picks, loadId);
      return data.picks;
    }

    if (Array.isArray(resolvedPicks) && resolvedPicks.length) {
      applyPicks(resolvedPicks, loadId);
      return resolvedPicks;
    }

    return null;
  };

  const loadAndResolve = async (forceResolve = false) => {
    const loadId = ++loadIdRef.current;

    try {
      setLoading(true);
      const resolved = await resolvePicks({ force: forceResolve });
      const resolvedPicks =
        resolved.ok && Array.isArray(resolved.picks) ? resolved.picks : null;
      await loadPicks(resolvedPicks, loadId);
    } catch (err) {
      console.log("LOAD SAVED PICKS ERROR:", err);
    } finally {
      if (loadId === loadIdRef.current) {
        setLoading(false);
      }
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadAndResolve(false);

      intervalRef.current = setInterval(() => {
        loadAndResolve(false);
      }, 300000);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }, [])
  );

  const manualRefresh = async () => {
    const loadId = ++loadIdRef.current;

    try {
      setRefreshing(true);
      const resolved = await resolvePicks({ force: true });
      const resolvedPicks =
        resolved.ok && Array.isArray(resolved.picks) ? resolved.picks : null;
      await loadPicks(resolvedPicks, loadId);
    } catch (err) {
      console.log("REFRESH SAVED PICKS ERROR:", err);
    } finally {
      if (loadId === loadIdRef.current) {
        setRefreshing(false);
      }
    }
  };

  const handleDeletePick = async (pick: any) => {
    Alert.alert(
      "Delete Saved Pick?",
      `${pick.player} ${pick.side || pick.pick} ${pick.line}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const result = await deletePick(pick.id || pick.pickKey);
            if (result.ok) {
              setPicks(result.picks || []);
            } else {
              Alert.alert("Delete Failed", result.message || "Could not delete pick.");
            }
          },
        },
      ]
    );
  };

  const stats = useMemo(() => {
    const wins = picks.filter((p) => getStatus(p) === "Win").length;
    const losses = picks.filter((p) => getStatus(p) === "Loss").length;
    const pushes = picks.filter((p) => getStatus(p) === "Push").length;
    const pending = picks.filter((p) => getStatus(p) === "Pending").length;

    const graded = wins + losses;
    const winRate = graded ? Math.round((wins / graded) * 100) : 0;
    const netUnits = wins - losses;

    const gradedPicks = [...picks]
      .filter((p) => ["Win", "Loss"].includes(getStatus(p)))
      .sort((a, b) => {
        const aTime = new Date(
          a.resolvedAt || a.gradedAt || a.updatedAt || a.createdAt || 0
        ).getTime();

        const bTime = new Date(
          b.resolvedAt || b.gradedAt || b.updatedAt || b.createdAt || 0
        ).getTime();

        return aTime - bTime;
      });

    let streakType = "";
    let streakCount = 0;

    for (let i = gradedPicks.length - 1; i >= 0; i--) {
      const result = getStatus(gradedPicks[i]);

      if (!streakType) {
        streakType = result;
        streakCount = 1;
      } else if (result === streakType) {
        streakCount++;
      } else {
        break;
      }
    }

    const streakLabel =
      streakCount > 0 ? `${streakType === "Win" ? "W" : "L"}${streakCount}` : "None";

    return {
      wins,
      losses,
      pushes,
      pending,
      graded,
      winRate,
      netUnits,
      streakLabel,
    };
  }, [picks]);

  const pendingPicks = useMemo(
    () => picks.filter((pick) => getStatus(pick) === "Pending"),
    [picks]
  );

  const filteredPicks = useMemo(() => {
    const source = filter === "Pending" || filter === "All" ? pendingPicks : picks;

    if (filter === "All") return pendingPicks;

    if (filter === "Premium") {
      return picks.filter(
        (p) => String(p.tier || "").toUpperCase() === "PREMIUM"
      );
    }

    return source.filter((p) => getStatus(p) === filter);
  }, [filter, picks, pendingPicks]);

  const getReportText = () =>
    buildSavedPicksReport({
      picks,
      filter,
      stats,
      loading,
      filteredPicks,
    });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={manualRefresh} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>✅ Saved Picks</Text>
          <Text style={styles.subtitle}>CourtEdge Tracking</Text>
          <Text style={styles.motto}>
            Every saved pick feeds the calibration system.
          </Text>
          <CopyReportButton getReportText={getReportText} />
        </View>

        <View style={styles.recordCard}>
          <Text style={styles.recordTitle}>
            Record: {stats.wins}-{stats.losses}
            {stats.pushes ? `-${stats.pushes}` : ""}
          </Text>

          <Text style={styles.recordText}>
            Pending: {stats.pending} • Win Rate: {stats.winRate}% • Net Units:{" "}
            {stats.netUnits > 0 ? "+" : ""}
            {stats.netUnits} • Streak: {stats.streakLabel}
          </Text>
        </View>

        <TouchableOpacity
          onPress={manualRefresh}
          style={styles.refreshButton}
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshText}>
            {loading || refreshing ? "Resolving..." : "Refresh / Resolve Picks"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <SummaryBox label="Wins" value={stats.wins} color="#22c55e" />
          <SummaryBox label="Losses" value={stats.losses} color="#ef4444" />
          <SummaryBox label="Pushes" value={stats.pushes} color="#fbbf24" />
          <SummaryBox label="Pending" value={stats.pending} color="#93c5fd" />
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => setFilter(type)}
              style={[
                styles.filterButton,
                filter === type && styles.activeFilterButton,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  filter === type && styles.activeFilterText,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading saved picks...</Text>
        )}

        {!loading && picks.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved picks yet.</Text>
            <Text style={styles.emptyText}>
              Save a CourtEdge prop from Top Props, NBA, WNBA, or Explore.
            </Text>
          </View>
        )}

        {!loading && picks.length > 0 && pendingPicks.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No pending picks.</Text>
            <Text style={styles.emptyText}>
              Graded picks are in History. Use Win/Loss filters above to
              review them here.
            </Text>
          </View>
        )}

        {!loading &&
          filteredPicks.map((pick, index) => (
            <View
              key={`${pick.id || pick.pickKey || pick.player}-${index}`}
              style={[
                styles.pickCard,
                getStatus(pick) === "Win" && styles.winCard,
                getStatus(pick) === "Loss" && styles.lossCard,
                String(pick.tier || "").toUpperCase() === "PREMIUM" &&
                  styles.premiumCard,
              ]}
            >
              <PropCard
                pick={{ ...pick, status: getStatus(pick).toLowerCase() }}
                index={index}
                showDelete
                onDelete={() => handleDeletePick(pick)}
              />
              <Text style={styles.dateText}>
                Saved: {formatTime(pick.createdAt || pick.savedAt)}
              </Text>
              {pick.resolvedAt || pick.gradedAt ? (
                <Text style={styles.dateText}>
                  Graded: {formatTime(pick.resolvedAt || pick.gradedAt)}
                </Text>
              ) : null}
              {pick.pendingReason ? (
                <Text style={styles.pendingReason}>{pick.pendingReason}</Text>
              ) : null}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryBox({
  label,
  value,
  color,
}: {
  label: string;
  value: any;
  color: string;
}) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
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

function getStatus(pick: any) {
  const raw = String(pick.status || "pending").toLowerCase();

  if (raw === "win") return "Win";
  if (raw === "loss") return "Loss";
  if (raw === "push") return "Push";

  return "Pending";
}

function getStatusStyle(status: string) {
  if (status === "Win") {
    return {
      backgroundColor: "#14532d",
      color: "#bbf7d0",
    };
  }

  if (status === "Loss") {
    return {
      backgroundColor: "#7f1d1d",
      color: "#fecaca",
    };
  }

  if (status === "Push") {
    return {
      backgroundColor: "#713f12",
      color: "#fef9c3",
    };
  }

  return {
    backgroundColor: "#1e3a8a",
    color: "#bfdbfe",
  };
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
    color: "#22c55e",
    fontSize: 34,
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

  recordCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },

  recordTitle: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 6,
  },

  recordText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 20,
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
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },

  summaryBox: {
    width: "48%",
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
    fontSize: 20,
    fontWeight: "900",
  },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },

  filterButton: {
    backgroundColor: "#1e293b",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },

  activeFilterButton: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },

  filterText: {
    color: "#cbd5e1",
    fontWeight: "900",
    fontSize: 12,
  },

  activeFilterText: {
    color: "#111827",
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

  winCard: {
    borderColor: "#166534",
  },

  lossCard: {
    borderColor: "#7f1d1d",
  },

  premiumCard: {
    borderColor: "#facc15",
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

  pickText: {
    color: "#93c5fd",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },

  needText: {
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

  dateText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 8,
    paddingHorizontal: 15,
  },
  pendingReason: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
    paddingHorizontal: 15,
    paddingBottom: 12,
  },
});