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

import CopyReportButton from "../../components/CopyReportButton";
import PropCard, { ResultMarginText, safeDisplay } from "../../components/PropCard";
import {
  buildDailySlateReports,
  fetchDailySlateReports,
  fetchTrackedProps,
  resolveTrackedProps,
} from "../../services/api";
import { buildResultsReport } from "../../utils/reportBuilders";
import {
  RESULTS_FILTERS,
  computeActiveResultsSlate,
  filterResultsProps,
  formatResultsSlateLabel,
  getTrackedPropStatus,
  type ResultsFilter,
} from "../../utils/resultsQueue";

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  let style = styles.statusPending;
  if (normalized === "WIN") style = styles.statusWin;
  else if (normalized === "LOSS") style = styles.statusLoss;
  else if (normalized === "PUSH") style = styles.statusPush;
  else if (normalized === "FAILED") style = styles.statusFailed;

  return (
    <View style={[styles.statusBadge, style]}>
      <Text style={styles.statusBadgeText}>{normalized}</Text>
    </View>
  );
}

export default function ResultsScreen() {
  const [trackedProps, setTrackedProps] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [filter, setFilter] = useState<ResultsFilter>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastResolveSummary, setLastResolveSummary] = useState<any>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [trackedData, reportData] = await Promise.all([
        fetchTrackedProps(),
        fetchDailySlateReports(),
      ]);

      setTrackedProps(trackedData.props || []);
      setReports(reportData.reports || []);
      setLoadError(null);
    } catch (err) {
      console.log("LOAD RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const refreshGrading = async () => {
    try {
      setRefreshing(true);
      const resolved = await resolveTrackedProps({ requireLikelyFinished: true });
      setLastResolveSummary(resolved.summary || null);

      if (resolved.props?.length) {
        setTrackedProps(resolved.props);
      } else {
        const trackedData = await fetchTrackedProps();
        setTrackedProps(trackedData.props || []);
      }

      const reportData = await fetchDailySlateReports();
      setReports(reportData.reports || []);
    } catch (err) {
      console.log("REFRESH RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleResolveAll = async () => {
    try {
      setResolving(true);
      const resolved = await resolveTrackedProps({ requireLikelyFinished: false });
      setLastResolveSummary(resolved.summary || null);

      if (resolved.props?.length) {
        setTrackedProps(resolved.props);
      }

      await buildDailySlateReports();
      const reportData = await fetchDailySlateReports();
      setReports(reportData.reports || []);
    } catch (err) {
      console.log("RESOLVE RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setResolving(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const activeSlate = useMemo(
    () => computeActiveResultsSlate(trackedProps, reports),
    [trackedProps, reports]
  );

  const filteredProps = useMemo(() => {
    if (!activeSlate) return [];
    return filterResultsProps(activeSlate.props, filter);
  }, [activeSlate, filter]);

  const getReportText = () =>
    buildResultsReport({
      activeSlate,
      filteredProps,
      filter,
      loading,
      refreshing,
      lastResolveSummary,
      error: loadError,
    });

  const summary = activeSlate?.summary;

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
          <Text style={styles.title}>📋 Results</Text>
          <Text style={styles.subtitle}>Official Grading Queue</Text>
          <Text style={styles.motto}>
            Every official Top Prop lands here first. Grade the current slate, then it
            moves to Lab when complete.
          </Text>
          <CopyReportButton getReportText={getReportText} label="Copy Results Report" />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Current Slate</Text>
          {activeSlate ? (
            <>
              <Text style={styles.slateDate}>
                {formatResultsSlateLabel(activeSlate.slateDate)}
              </Text>
              <Text style={styles.slateMeta}>
                {(activeSlate.leagues || []).join(" • ") || "—"}
              </Text>
              <View style={styles.recordGrid}>
                <SummaryBox label="Total" value={summary?.total ?? 0} color="#f8fafc" />
                <SummaryBox label="Graded" value={summary?.graded ?? 0} color="#22c55e" />
                <SummaryBox label="Pending" value={summary?.pending ?? 0} color="#93c5fd" />
                <SummaryBox label="Failed" value={summary?.failed ?? 0} color="#f97316" />
              </View>
              <Text style={styles.recordLine}>
                Record: {summary?.wins ?? 0}-{summary?.losses ?? 0}-{summary?.pushes ?? 0}
              </Text>
              {activeSlate.isComplete ? (
                <View style={styles.completeBanner}>
                  <Text style={styles.completeText}>
                    Slate complete — ready for Lab
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.emptySummary}>
              No active official slate in Results. Completed slates are in Lab; older ones
              archive in History.
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, (refreshing || resolving) && styles.actionBtnDisabled]}
          onPress={handleResolveAll}
          disabled={loading || refreshing || resolving}
        >
          <Text style={styles.actionBtnText}>
            {resolving ? "Grading..." : "Check / Refresh Grading"}
          </Text>
        </TouchableOpacity>

        {lastResolveSummary ? (
          <Text style={styles.resolveMeta}>
            Last check: graded {lastResolveSummary.gradedCount ?? 0} • still pending{" "}
            {lastResolveSummary.stillPending ?? 0} • skipped{" "}
            {lastResolveSummary.skippedNotReady ?? 0}
          </Text>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {RESULTS_FILTERS.map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.filterChip, filter === item && styles.filterChipActive]}
              onPress={() => setFilter(item)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filter === item && styles.filterChipTextActive,
                ]}
              >
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? <Text style={styles.loadingText}>Loading grading queue...</Text> : null}

        {!loading && !activeSlate ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active Results slate.</Text>
            <Text style={styles.emptyText}>
              Official props from Top/NBA/WNBA boards auto-track here. When the slate
              fully grades, it moves to Lab for analysis.
            </Text>
          </View>
        ) : null}

        {!loading &&
          activeSlate &&
          filteredProps.map((prop, index) => {
            const status = getTrackedPropStatus(prop);
            const displayStatus = status.toLowerCase();

            return (
              <View
                key={prop.trackedId || prop.trackedKey || `${prop.player}-${index}`}
                style={[
                  styles.propCard,
                  status === "Win" && styles.winCard,
                  status === "Loss" && styles.lossCard,
                  status === "Failed" && styles.failedCard,
                ]}
              >
                <View style={styles.propHeader}>
                  <StatusBadge status={status} />
                  <Text style={styles.propRank}>#{prop.rank ?? index + 1}</Text>
                </View>
                <PropCard
                  pick={{
                    ...prop,
                    side: prop.currentEngineSide || prop.side,
                    status: displayStatus,
                  }}
                  index={index}
                />
                <View style={styles.propMeta}>
                  <Text style={styles.propLine}>
                    {prop.currentEngineSide || prop.side} {safeDisplay(prop.line)}{" "}
                    {prop.stat || "Points"} — {status}
                  </Text>
                  <ResultMarginText pick={prop} />
                  <Text style={styles.propDetail}>
                    Conf {safeDisplay(prop.confidence)}% • Risk {prop.riskLabel || "—"} •{" "}
                    Tier {String(prop.tier || "—").toUpperCase()}
                  </Text>
                  {prop.pendingReason ? (
                    <Text style={styles.pendingReason}>{prop.pendingReason}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  container: {
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
    fontSize: 32,
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
  summaryCard: {
    backgroundColor: "#111827",
    padding: 15,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  summaryTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },
  slateDate: {
    color: "#facc15",
    fontSize: 18,
    fontWeight: "900",
  },
  slateMeta: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 12,
  },
  recordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
  recordLine: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 12,
  },
  completeBanner: {
    marginTop: 12,
    backgroundColor: "#14532d",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  completeText: {
    color: "#bbf7d0",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  emptySummary: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },
  actionBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 10,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },
  resolveMeta: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 14,
  },
  filterRow: {
    marginBottom: 14,
  },
  filterContent: {
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    backgroundColor: "#1e293b",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  filterChipActive: {
    backgroundColor: "#14532d",
    borderColor: "#22c55e",
  },
  filterChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "900",
  },
  filterChipTextActive: {
    color: "#bbf7d0",
  },
  loadingText: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
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
  propCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  winCard: {
    borderColor: "#166534",
  },
  lossCard: {
    borderColor: "#7f1d1d",
  },
  failedCard: {
    borderColor: "#9a3412",
  },
  propHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  propRank: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "900",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "900",
  },
  statusWin: {
    backgroundColor: "#14532d",
  },
  statusLoss: {
    backgroundColor: "#7f1d1d",
  },
  statusPush: {
    backgroundColor: "#713f12",
  },
  statusPending: {
    backgroundColor: "#1e3a8a",
  },
  statusFailed: {
    backgroundColor: "#9a3412",
  },
  propMeta: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  propLine: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 4,
  },
  propDetail: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  pendingReason: {
    color: "#fdba74",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
});
