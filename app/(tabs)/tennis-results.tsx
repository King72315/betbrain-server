import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import PropCard, { ResultMarginText, safeDisplay } from "../../components/PropCard";
import {
  fetchDailySlateReports,
  fetchLockedSlates,
  fetchTrackedProps,
  resolveTrackedProps,
} from "../../services/api";
import {
  RESULTS_STATUS_FILTERS,
  computeVisibleResultsSlates,
  filterResultsPropsByStatus,
  filterTennisTrackedProps,
  formatResultsAwaitingStatsReason,
  formatResultsSlateLabel,
  getTrackedPropStatus,
  groupResultsPropsByGame,
  groupResultsPropsByGameState,
  type ResultsStatusFilter,
} from "../../utils/resultsQueue";
import { getTodayLocalDate } from "../../utils/slateRotation";
import { getPropDisplayLabels } from "../../utils/propLabels";

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  let style = styles.statusPending;
  if (normalized === "WIN") style = styles.statusWin;
  else if (normalized === "LOSS") style = styles.statusLoss;
  else if (normalized === "PUSH") style = styles.statusPush;
  else if (normalized === "AWAITING STATS") style = styles.statusFailed;

  return (
    <View style={[styles.statusBadge, style]}>
      <Text style={styles.statusBadgeText}>{normalized}</Text>
    </View>
  );
}

/**
 * TennisEdge Results — graded tennis props surface.
 * Wires to the same tracked-props store; filters TENNIS / ATP / WTA / TennisEdge rows.
 * CourtEdge NBA/WNBA Results remain on the Results tab.
 */
export default function TennisResultsScreen() {
  const [trackedProps, setTrackedProps] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [lockedSlates, setLockedSlates] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<ResultsStatusFilter>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [todayLocalDate, setTodayLocalDate] = useState(() => getTodayLocalDate());

  const loadData = async () => {
    try {
      setLoading(true);
      const [trackedData, reportData, lockedData] = await Promise.all([
        fetchTrackedProps(),
        fetchDailySlateReports(),
        fetchLockedSlates(),
      ]);
      setTrackedProps(trackedData.props || []);
      setReports(reportData.reports || []);
      setLockedSlates(lockedData.slates || []);
      if (trackedData.error) {
        setLoadError(trackedData.error);
      } else if (!trackedData.ok && (trackedData.props || []).length === 0) {
        setLoadError("Could not load tracked props from backend.");
      } else {
        setLoadError(null);
      }
    } catch (err) {
      console.log("LOAD TENNIS RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const refreshGrading = async () => {
    try {
      setRefreshing(true);
      const resolved = await resolveTrackedProps({ requireLikelyFinished: true });
      if (resolved.props?.length) {
        setTrackedProps(resolved.props);
      } else {
        const trackedData = await fetchTrackedProps();
        setTrackedProps(trackedData.props || []);
      }
      const reportData = await fetchDailySlateReports();
      setReports(reportData.reports || []);
    } catch (err) {
      console.log("REFRESH TENNIS RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setTodayLocalDate(getTodayLocalDate());
      loadData();
    }, [])
  );

  const tennisProps = useMemo(
    () => filterTennisTrackedProps(trackedProps),
    [trackedProps]
  );

  const visibleSlates = useMemo(
    () =>
      computeVisibleResultsSlates(
        tennisProps,
        reports,
        todayLocalDate,
        lockedSlates
      ),
    [tennisProps, reports, todayLocalDate, lockedSlates]
  );

  const filteredSlates = useMemo(() => {
    return visibleSlates.map((slate) => ({
      ...slate,
      props: filterResultsPropsByStatus(slate.props, statusFilter),
    }));
  }, [visibleSlates, statusFilter]);

  const gradedCount = tennisProps.filter((p) =>
    ["Win", "Loss", "Push"].includes(getTrackedPropStatus(p))
  ).length;
  const pendingCount = tennisProps.filter(
    (p) => getTrackedPropStatus(p) === "Pending"
  ).length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshGrading} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.brand}>TennisEdge</Text>
          <Text style={styles.title}>Results</Text>
          <Text style={styles.subtitle}>Graded tennis props · public tracking</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.refreshBtn, (loading || refreshing) && styles.refreshBtnDisabled]}
          onPress={refreshGrading}
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshBtnText}>
            {refreshing ? "Checking..." : "Check Pending Tennis Results"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Tennis Tracked Summary</Text>
          <Text style={styles.summaryLine}>
            Tracked: {tennisProps.length} · Graded: {gradedCount} · Pending:{" "}
            {pendingCount}
          </Text>
          <Text style={styles.summaryNote}>
            Shows TENNIS / ATP / WTA / TennisEdge rows from the shared tracked store.
            CourtEdge basketball stays on the Results tab.
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {RESULTS_STATUS_FILTERS.map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.filterChip, statusFilter === item && styles.filterChipActive]}
              onPress={() => setStatusFilter(item)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === item && styles.filterChipTextActive,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <Text style={styles.loadingText}>Loading tennis grading queue...</Text>
        ) : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Backend connection error</Text>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        {!loading && !loadError && tennisProps.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No tennis results tracked yet</Text>
            <Text style={styles.emptyText}>
              When TennisEdge props are sealed into the tracked store (league TENNIS /
              ATP / WTA), graded results appear here. CourtEdge NBA/WNBA Results are
              unchanged on the Results tab.
            </Text>
          </View>
        ) : null}

        {filteredSlates.map((slate) => {
          const slateFiltered =
            filteredSlates.find((item) => item.slateDate === slate.slateDate)?.props ||
            [];
          const gameStateGroups = groupResultsPropsByGameState(slateFiltered);
          const byGame = groupResultsPropsByGame(slateFiltered);

          if (slateFiltered.length === 0 && statusFilter !== "All") {
            return null;
          }

          return (
            <View key={slate.slateDate} style={styles.slateCard}>
              <Text style={styles.slateTitle}>
                {formatResultsSlateLabel(slate.slateDate)}
              </Text>
              <Text style={styles.slateMeta}>
                {slateFiltered.length} tennis prop
                {slateFiltered.length === 1 ? "" : "s"}
              </Text>

              {(["graded", "awaitingStats", "livePending"] as const).map((groupKey) => {
                const groupProps = gameStateGroups[groupKey] || [];
                if (!groupProps.length) return null;
                const title =
                  groupKey === "graded"
                    ? "Graded"
                    : groupKey === "awaitingStats"
                      ? "Awaiting stats"
                      : "Live / Pending";
                return (
                  <View key={groupKey} style={styles.gameStateSection}>
                    <Text style={styles.gameStateTitle}>{title}</Text>
                    {groupProps.map((prop: any, index: number) => {
                      const status = getTrackedPropStatus(prop);
                      const labels = getPropDisplayLabels(prop);
                      const awaitingLabel = formatResultsAwaitingStatsReason(prop);
                      return (
                        <View
                          key={
                            prop.trackedId ||
                            prop.trackedKey ||
                            `${prop.player}-${index}`
                          }
                          style={[
                            styles.propCard,
                            status === "Win" && styles.winCard,
                            status === "Loss" && styles.lossCard,
                            status === "Awaiting stats" && styles.failedCard,
                          ]}
                        >
                          <View style={styles.propHeader}>
                            <StatusBadge status={status} />
                            <Text style={styles.propRank}>
                              #{prop.rank ?? index + 1}
                            </Text>
                          </View>
                          <View style={styles.labelRow}>
                            {labels.badges.map((badge) => (
                              <View
                                key={`${prop.trackedKey}-${badge}`}
                                style={styles.labelChip}
                              >
                                <Text style={styles.labelChipText}>{badge}</Text>
                              </View>
                            ))}
                          </View>
                          <PropCard
                            pick={{
                              ...prop,
                              resultStatus: status,
                            }}
                            index={index}
                            compact
                          />
                          <View style={styles.propMeta}>
                            <Text style={styles.propLine}>
                              {safeDisplay(prop.player)} · {safeDisplay(prop.market)}{" "}
                              {safeDisplay(prop.side)} {safeDisplay(prop.line)}
                            </Text>
                            <ResultMarginText pick={prop} />
                            {awaitingLabel ? (
                              <Text style={styles.pendingReason}>{awaitingLabel}</Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })}

              {Object.keys(byGame).length === 0 && slateFiltered.length === 0 ? (
                <Text style={styles.emptyText}>No props for this slate filter.</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  container: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#0e7490",
    marginBottom: 14,
  },
  brand: {
    color: "#22d3ee",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 4,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  motto: {
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: "800",
  },
  refreshBtn: {
    backgroundColor: "#0e7490",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  refreshBtnDisabled: { opacity: 0.6 },
  refreshBtnText: {
    color: "#ecfeff",
    fontWeight: "900",
    fontSize: 14,
  },
  summaryCard: {
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#164e63",
    marginBottom: 14,
  },
  summaryTitle: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 6,
  },
  summaryLine: {
    color: "#a5f3fc",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },
  summaryNote: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  filterRow: { marginBottom: 14 },
  filterContent: { gap: 8, paddingRight: 8 },
  filterChip: {
    backgroundColor: "#1e293b",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  filterChipActive: {
    backgroundColor: "#155e75",
    borderColor: "#22d3ee",
  },
  filterChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "900",
  },
  filterChipTextActive: { color: "#cffafe" },
  loadingText: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 12,
  },
  errorCard: {
    backgroundColor: "#450a0a",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#b91c1c",
  },
  errorTitle: { color: "#fecaca", fontWeight: "900", marginBottom: 4 },
  errorText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  emptyCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 14,
  },
  emptyTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  slateCard: {
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#164e63",
    marginBottom: 14,
  },
  slateTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  slateMeta: {
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 10,
  },
  gameStateSection: { marginTop: 10, marginBottom: 6 },
  gameStateTitle: {
    color: "#22d3ee",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  propCard: {
    backgroundColor: "#020617",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 10,
    overflow: "hidden",
  },
  winCard: { borderColor: "#166534" },
  lossCard: { borderColor: "#7f1d1d" },
  failedCard: { borderColor: "#9a3412" },
  propHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPending: { backgroundColor: "#1e3a8a" },
  statusWin: { backgroundColor: "#14532d" },
  statusLoss: { backgroundColor: "#7f1d1d" },
  statusPush: { backgroundColor: "#713f12" },
  statusFailed: { backgroundColor: "#9a3412" },
  statusBadgeText: {
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "900",
  },
  propRank: { color: "#64748b", fontWeight: "900", fontSize: 12 },
  labelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  labelChip: {
    backgroundColor: "#1e293b",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  labelChipText: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "800",
  },
  propMeta: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  propLine: {
    color: "#67e8f9",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 4,
  },
  pendingReason: {
    color: "#fdba74",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
});
