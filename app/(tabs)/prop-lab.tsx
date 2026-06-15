import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  buildDailySlateReports,
  fetchDailySlateReport,
  fetchDailySlateReports,
  fetchTrackedAnalytics,
  fetchTrackedProps,
  resolveTrackedProps,
} from "../../services/api";

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value}%`;
}

function formatNum(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value).toFixed(digits);
}

function formatRecord(wins = 0, losses = 0, pushes = 0, winRate?: number | null) {
  const rate = winRate !== null && winRate !== undefined ? ` (${winRate}%)` : "";
  return `${wins}-${losses}-${pushes}${rate}`;
}

function formatSlateLabel(slateDate: string) {
  if (!slateDate) return "Unknown slate";
  const d = new Date(`${slateDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return slateDate;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

function StatusBadge({ status }: { status: string }) {
  const isFinal = status === "final";
  return (
    <View style={[styles.badge, isFinal ? styles.badgeFinal : styles.badgeProgress]}>
      <Text style={styles.badgeText}>{isFinal ? "FINAL" : "IN PROGRESS"}</Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function GroupPerfTable({
  groups,
}: {
  groups: Record<string, any> | undefined;
}) {
  if (!groups || Object.keys(groups).length === 0) {
    return <Text style={styles.muted}>No signal group data yet.</Text>;
  }

  return Object.entries(groups).map(([key, perf]) => (
    <View key={key} style={styles.groupRow}>
      <Text style={styles.groupKey}>{key}</Text>
      <Text style={styles.groupStat}>
        {perf.sample || 0} props • {formatRecord(perf.wins, perf.losses, perf.pushes, perf.winRate)}
        {perf.needsMoreData ? " • small sample" : ""}
      </Text>
    </View>
  ));
}

export default function PropLab() {
  const [reports, setReports] = useState<any[]>([]);
  const [selectedSlate, setSelectedSlate] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);

  const loadReports = async (slateDate?: string | null) => {
    const list = await fetchDailySlateReports();
    const sorted = list.reports || [];
    setReports(sorted);

    const target =
      slateDate ||
      selectedSlate ||
      sorted[0]?.slateDate ||
      null;

    if (target) {
      const detail = await fetchDailySlateReport(target);
      setSelectedSlate(target);
      setReport(detail.report || sorted.find((r) => r.slateDate === target) || null);
    } else {
      setReport(null);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const analyticsData = await fetchTrackedAnalytics();
      setAnalytics(analyticsData.analytics || null);
      await loadReports();
    } catch (err) {
      console.log("LOAD PROP LAB ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    try {
      setRefreshing(true);
      await resolveTrackedProps({ requireLikelyFinished: true });
      await buildDailySlateReports(
        selectedSlate ? { slateDate: selectedSlate } : undefined
      );
      const analyticsData = await fetchTrackedAnalytics();
      setAnalytics(analyticsData.analytics || null);
      await loadReports(selectedSlate);
    } catch (err) {
      console.log("REFRESH PROP LAB ERROR:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleBuildReport = async () => {
    try {
      setBuilding(true);
      await resolveTrackedProps({ requireLikelyFinished: false });
      await buildDailySlateReports(
        selectedSlate ? { slateDate: selectedSlate } : undefined
      );
      await loadReports(selectedSlate);
    } catch (err) {
      console.log("BUILD REPORT ERROR:", err);
    } finally {
      setBuilding(false);
    }
  };

  const selectSlate = async (slateDate: string) => {
    setSelectedSlate(slateDate);
    const detail = await fetchDailySlateReport(slateDate);
    setReport(detail.report || reports.find((r) => r.slateDate === slateDate) || null);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const sectionA = report?.sections?.A;
  const sectionB = report?.sections?.B;
  const sectionC = report?.sections?.C;
  const sectionD = report?.sections?.D;
  const sectionE = report?.sections?.E;
  const sectionF = report?.sections?.F;

  const allTimeRecord = useMemo(() => {
    const o = analytics?.overall?.currentEngine;
    if (!o) return null;
    return formatRecord(o.wins, o.losses, o.pushes, o.accuracy);
  }, [analytics]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshData} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>Prop Lab</Text>
          <Text style={styles.subtitle}>CourtEdge Daily Slate Intelligence</Text>
          <Text style={styles.note}>
            Official Top Props are auto-tracked. Build reports after games grade.
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, building && styles.actionBtnDisabled]}
            onPress={handleBuildReport}
            disabled={building || loading}
          >
            <Text style={styles.actionBtnText}>
              {building ? "Building..." : "Build / Refresh Report"}
            </Text>
          </TouchableOpacity>
        </View>

        {reports.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.slatePicker}
            contentContainerStyle={styles.slatePickerContent}
          >
            {reports.map((item) => (
              <TouchableOpacity
                key={item.slateDate}
                style={[
                  styles.slateChip,
                  selectedSlate === item.slateDate && styles.slateChipActive,
                ]}
                onPress={() => selectSlate(item.slateDate)}
              >
                <Text
                  style={[
                    styles.slateChipText,
                    selectedSlate === item.slateDate && styles.slateChipTextActive,
                  ]}
                >
                  {formatSlateLabel(item.slateDate)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {loading ? <Text style={styles.muted}>Loading reports...</Text> : null}

        {!loading && !report ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No slate reports yet</Text>
            <Text style={styles.emptyText}>
              Tap Build / Refresh Report after tracked props are graded.
            </Text>
          </View>
        ) : null}

        {sectionA ? (
          <SectionCard title="1. Daily Slate Report">
            <View style={styles.summaryHeader}>
              <Text style={styles.slateTitle}>{formatSlateLabel(sectionA.slateDate)}</Text>
              <StatusBadge status={sectionA.reportStatus || report?.status || ""} />
            </View>
            {sectionA.pending > 0 ? (
              <Text style={styles.pendingNote}>
                {sectionA.pending} prop(s) still pending — report updates when all grade.
              </Text>
            ) : null}
            <MetricRow label="Official props" value={String(sectionA.totalOfficialProps || 0)} />
            <MetricRow
              label="Record"
              value={formatRecord(
                sectionA.wins,
                sectionA.losses,
                sectionA.pushes,
                sectionA.overallWinRate
              )}
            />
            <MetricRow label="Graded / Pending" value={`${sectionA.graded} / ${sectionA.pending}`} />
            <MetricRow
              label="Leagues"
              value={(sectionA.leagues || []).join(", ") || "—"}
            />
          </SectionCard>
        ) : null}

        {sectionB ? (
          <SectionCard title="2. Risk Calibration">
            {Object.entries(sectionB.buckets || {}).map(([bucket, stats]: [string, any]) => (
              <View key={bucket} style={styles.bucketBlock}>
                <Text style={styles.bucketTitle}>{bucket}</Text>
                <Text style={styles.bucketLine}>
                  {stats.total} props • {formatRecord(stats.wins, stats.losses, stats.pushes, stats.winRate)} • pending {stats.pending}
                </Text>
                <Text style={styles.bucketMeta}>
                  Avg conf {formatNum(stats.avgConfidence)} • edge {formatNum(stats.avgFairLineEdge)} • gap {formatNum(stats.avgSupportDangerGap)}
                </Text>
                {stats.smallSampleNote ? (
                  <Text style={styles.smallNote}>{stats.smallSampleNote}</Text>
                ) : null}
              </View>
            ))}
          </SectionCard>
        ) : null}

        {sectionC ? (
          <SectionCard title="3. Projection / Fair Line Accuracy">
            {sectionC.needsMoreData ? (
              <Text style={styles.muted}>Not enough graded projection data yet.</Text>
            ) : null}
            <MetricRow label="Sample" value={String(sectionC.sample || 0)} />
            <MetricRow label="Proj side win rate" value={formatPct(sectionC.projectionSideWinRate)} />
            <MetricRow label="Avg projected" value={formatNum(sectionC.avgProjected)} />
            <MetricRow label="Avg fair line" value={formatNum(sectionC.avgFairLine)} />
            <MetricRow label="Avg actual" value={formatNum(sectionC.avgActual)} />
            <MetricRow label="Avg error" value={formatNum(sectionC.avgError)} />
            <MetricRow label="Avg abs error" value={formatNum(sectionC.avgAbsError)} />
            <MetricRow label="Bias" value={sectionC.bias || "—"} />
            {sectionC.bestCall ? (
              <Text style={styles.highlight}>
                Best: {sectionC.bestCall.player} ({sectionC.bestCall.side} {sectionC.bestCall.line}, actual {sectionC.bestCall.actualStat})
              </Text>
            ) : null}
            {sectionC.worstMiss ? (
              <Text style={styles.highlightBad}>
                Worst: {sectionC.worstMiss.player} ({sectionC.worstMiss.side} {sectionC.worstMiss.line}, actual {sectionC.worstMiss.actualStat})
              </Text>
            ) : null}
          </SectionCard>
        ) : null}

        {sectionD ? (
          <SectionCard title="4. Engine / Signal Performance">
            {Object.entries(sectionD.groups || {}).map(([groupName, groups]) => (
              <View key={groupName} style={styles.signalGroup}>
                <Text style={styles.signalGroupTitle}>{groupName}</Text>
                <GroupPerfTable groups={groups as Record<string, any>} />
              </View>
            ))}
          </SectionCard>
        ) : null}

        {sectionE ? (
          <SectionCard title="5. Loss / Miss Type Report">
            {(sectionE.losses || []).length === 0 ? (
              <Text style={styles.muted}>No losses on this slate.</Text>
            ) : (
              sectionE.losses.map((loss: any, index: number) => (
                <View key={`${loss.player}-${index}`} style={styles.lossRow}>
                  <Text style={styles.lossPlayer}>
                    {loss.player} — {loss.side} {loss.line}
                  </Text>
                  <Text style={styles.lossMeta}>
                    {loss.game} • actual {loss.actualStat ?? "—"} • {loss.missType}
                  </Text>
                  <Text style={styles.lossExplain}>{loss.explanation}</Text>
                </View>
              ))
            )}
          </SectionCard>
        ) : null}

        {sectionF ? (
          <SectionCard title="6. Calibration Recommendations">
            {sectionF.doNotAdjustYet ? (
              <Text style={styles.warnNote}>Do not adjust yet — sample too small.</Text>
            ) : null}
            <Text style={styles.recLabel}>Trust more</Text>
            {(sectionF.signalsToTrustMore || []).length === 0 ? (
              <Text style={styles.muted}>None flagged yet.</Text>
            ) : (
              sectionF.signalsToTrustMore.map((item: string, i: number) => (
                <Text key={i} style={styles.recItem}>+ {item}</Text>
              ))
            )}
            <Text style={styles.recLabel}>Trust less</Text>
            {(sectionF.signalsToTrustLess || []).length === 0 ? (
              <Text style={styles.muted}>None flagged yet.</Text>
            ) : (
              sectionF.signalsToTrustLess.map((item: string, i: number) => (
                <Text key={i} style={styles.recItemBad}>- {item}</Text>
              ))
            )}
            {(sectionF.riskBucketNotes || []).map((note: string, i: number) => (
              <Text key={`risk-${i}`} style={styles.recNote}>{note}</Text>
            ))}
            {(sectionF.projectionNotes || []).map((note: string, i: number) => (
              <Text key={`proj-${i}`} style={styles.recNote}>{note}</Text>
            ))}
            <Text style={styles.recNote}>{sectionF.nextAdjustment}</Text>
            <Text style={styles.muted}>{sectionF.note}</Text>
          </SectionCard>
        ) : null}

        <SectionCard title="All-Time Analytics (Secondary)">
          <MetricRow label="Tracked engine" value={allTimeRecord || "—"} />
          <MetricRow
            label="Fair line shadow"
            value={
              analytics?.overall?.fairLineShadow
                ? formatRecord(
                    analytics.overall.fairLineShadow.wins,
                    analytics.overall.fairLineShadow.losses,
                    analytics.overall.fairLineShadow.pushes,
                    analytics.overall.fairLineShadow.accuracy
                  )
                : "—"
            }
          />
          <MetricRow
            label="Total tracked"
            value={String(analytics?.overall?.total || 0)}
          />
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  title: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 4,
    fontWeight: "700",
  },
  note: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: "row",
  },
  actionBtn: {
    flex: 1,
    backgroundColor: "#1d4ed8",
    borderRadius: 12,
    paddingVertical: 12,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    color: "#dbeafe",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 14,
  },
  slatePicker: {
    maxHeight: 44,
  },
  slatePickerContent: {
    gap: 8,
    paddingVertical: 4,
  },
  slateChip: {
    backgroundColor: "#1e293b",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  slateChipActive: {
    backgroundColor: "#14532d",
    borderColor: "#22c55e",
  },
  slateChipText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
  },
  slateChipTextActive: {
    color: "#bbf7d0",
  },
  sectionCard: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    gap: 6,
  },
  sectionTitle: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  slateTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "900",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeFinal: {
    backgroundColor: "#14532d",
  },
  badgeProgress: {
    backgroundColor: "#1e3a8a",
  },
  badgeText: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "900",
  },
  pendingNote: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "800",
  },
  bucketBlock: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    marginTop: 4,
    gap: 2,
  },
  bucketTitle: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "900",
  },
  bucketLine: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  bucketMeta: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
  },
  smallNote: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "700",
  },
  highlight: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  highlightBad: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  signalGroup: {
    marginTop: 6,
    gap: 4,
  },
  signalGroupTitle: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  groupRow: {
    paddingVertical: 3,
  },
  groupKey: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "800",
  },
  groupStat: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
  },
  lossRow: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    marginTop: 6,
    gap: 2,
  },
  lossPlayer: {
    color: "#fecaca",
    fontSize: 12,
    fontWeight: "900",
  },
  lossMeta: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
  },
  lossExplain: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
  },
  recLabel: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 6,
  },
  recItem: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: "700",
  },
  recItemBad: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "700",
  },
  recNote: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  warnNote: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  muted: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyCard: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  emptyTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 6,
    fontWeight: "700",
  },
});
