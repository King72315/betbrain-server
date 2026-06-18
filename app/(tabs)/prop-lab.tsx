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
import CopyReportButton from "../../components/CopyReportButton";
import { buildPropLabReport } from "../../utils/reportBuilders";
import { computeSlateRotation } from "../../utils/slateRotation";

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

function EngineStatusBadge({ status }: { status: string }) {
  const normalized = String(status || "").toUpperCase();
  let badgeStyle = styles.engineStatusNeutral;
  if (normalized === "WORKING") badgeStyle = styles.engineStatusWorking;
  else if (normalized === "WEAK") badgeStyle = styles.engineStatusWeak;
  else if (normalized === "FAILING") badgeStyle = styles.engineStatusFailing;

  return (
    <View style={[styles.engineBadge, badgeStyle]}>
      <Text style={styles.engineBadgeText}>{normalized.replace(/_/g, " ")}</Text>
    </View>
  );
}

function EngineScorecardCard({ engine }: { engine: any }) {
  return (
    <View style={styles.engineCard}>
      <View style={styles.engineCardHeader}>
        <Text style={styles.engineName}>{engine.engine}</Text>
        <EngineStatusBadge status={engine.status} />
      </View>
      <Text style={styles.engineStatLine}>
        {engine.record} • {formatPct(engine.winRate)} • n={engine.sampleSize}
        {engine.gradedCount !== undefined ? ` (${engine.gradedCount} decided)` : ""}
      </Text>
      <Text style={styles.engineStatLine}>
        Avg margin: {formatNum(engine.avgMargin)} •{" "}
        {engine.earlySignal ? "early signal" : engine.hasData === false ? "no field data" : "graded sample"}
      </Text>
      <Text style={styles.engineLesson}>{engine.lesson}</Text>
    </View>
  );
}

function EngineScorecardSection({ scorecard }: { scorecard: any }) {
  const engines = scorecard?.engines || [];
  if (!engines.length) {
    return <Text style={styles.muted}>No engine scorecard data yet.</Text>;
  }

  const summary = scorecard.summary;

  return (
    <View style={styles.engineGrid}>
      {summary ? (
        <Text style={styles.engineSummary}>
          {summary.working} working • {summary.weak} weak • {summary.failing} failing •{" "}
          {summary.notEnoughData} need data
        </Text>
      ) : null}
      {engines.map((engine: any) => (
        <EngineScorecardCard key={engine.engine} engine={engine} />
      ))}
    </View>
  );
}

function MistakeBreakdownSection({ breakdown }: { breakdown: any }) {
  if (!breakdown) {
    return <Text style={styles.muted}>No mistake breakdown yet.</Text>;
  }

  if ((breakdown.totalLosses || 0) === 0) {
    return <Text style={styles.muted}>No losses on this slate.</Text>;
  }

  const categories = Object.values(breakdown.categories || {}).filter(
    (cat: any) => cat.count > 0
  ) as any[];

  return (
    <View style={styles.mistakeSection}>
      <Text style={styles.mistakeTotal}>{breakdown.totalLosses} loss(es) classified</Text>
      {categories.map((cat) => (
        <View key={cat.key} style={styles.mistakeCategory}>
          <Text style={styles.mistakeCategoryTitle}>
            {cat.label} — {cat.count} ({cat.pct}%)
          </Text>
          {(cat.losses || []).slice(0, 3).map((loss: any, index: number) => (
            <Text key={`${cat.key}-${index}`} style={styles.mistakeItem}>
              {loss.player} {loss.side} {loss.line} — {loss.explanation}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function CalibrationRulesSection({ rules }: { rules: any }) {
  if (!rules?.rules?.length) {
    return <Text style={styles.muted}>No calibration rules triggered yet.</Text>;
  }

  return (
    <View style={styles.rulesSection}>
      {rules.doNotAdjustYet ? (
        <Text style={styles.warnNote}>Do not adjust yet — sample too small.</Text>
      ) : null}
      {rules.rules.map((item: any, index: number) => (
        <View key={`${item.id}-${index}`} style={styles.ruleRow}>
          <Text style={styles.rulePriority}>[{String(item.priority).toUpperCase()}]</Text>
          <Text style={styles.ruleText}>{item.rule}</Text>
          <Text style={styles.ruleReason}>{item.reason}</Text>
        </View>
      ))}
      {rules.note ? <Text style={styles.muted}>{rules.note}</Text> : null}
    </View>
  );
}

function SlateLessonSection({ lesson }: { lesson: any }) {
  if (!lesson) {
    return <Text style={styles.muted}>No slate lesson yet.</Text>;
  }

  return (
    <View style={styles.lessonSection}>
      <Text style={styles.lessonHeadline}>{lesson.headline}</Text>
      {lesson.body ? <Text style={styles.lessonBody}>{lesson.body}</Text> : null}
      {(lesson.bullets || []).map((bullet: string, index: number) => (
        <Text key={index} style={styles.lessonBullet}>
          • {bullet}
        </Text>
      ))}
    </View>
  );
}

export default function PropLab() {
  const [reports, setReports] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [trackedProps, setTrackedProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);

  const rotation = useMemo(() => computeSlateRotation(reports), [reports]);
  const currentLabSlateDate = rotation.currentLabSlateDate;

  const loadReports = async () => {
    const list = await fetchDailySlateReports();
    const sorted = list.reports || [];
    setReports(sorted);

    const { currentLabSlateDate: labDate } = computeSlateRotation(sorted);

    if (labDate) {
      const detail = await fetchDailySlateReport(labDate);
      setReport(
        detail.report || sorted.find((r) => r.slateDate === labDate) || null
      );
    } else {
      setReport(null);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const analyticsData = await fetchTrackedAnalytics();
      setAnalytics(analyticsData.analytics || null);
      const trackedData = await fetchTrackedProps();
      setTrackedProps(trackedData.props || []);
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
      await buildDailySlateReports();
      const analyticsData = await fetchTrackedAnalytics();
      setAnalytics(analyticsData.analytics || null);
      const trackedData = await fetchTrackedProps();
      setTrackedProps(trackedData.props || []);
      await loadReports();
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
      await buildDailySlateReports();
      await loadReports();
    } catch (err) {
      console.log("BUILD REPORT ERROR:", err);
    } finally {
      setBuilding(false);
    }
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
  const engineScorecard = report?.engineScorecard || report?.sections?.G;
  const mistakeBreakdown = report?.mistakeBreakdown || report?.sections?.H;
  const calibrationRules = report?.calibrationRules || report?.sections?.I;
  const slateLesson = report?.slateLesson || report?.sections?.J;

  const slateTrackedProps = useMemo(() => {
    if (!currentLabSlateDate) return [];
    return trackedProps
      .filter((p) => p.slateDate === currentLabSlateDate)
      .slice(0, 12);
  }, [trackedProps, currentLabSlateDate]);

  const allTimeRecord = useMemo(() => {
    const o = analytics?.overall?.currentEngine;
    if (!o) return null;
    return formatRecord(o.wins, o.losses, o.pushes, o.accuracy);
  }, [analytics]);

  const getReportText = () =>
    buildPropLabReport({
      reports,
      rotation,
      report,
      analytics,
      loading,
      building,
      refreshing,
    });

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
          <Text style={styles.subtitle}>Current Completed Slate — Learning & Calibration</Text>
          <Text style={styles.note}>
            Official Top Props are auto-tracked. Active grading stays in Results/Saved until
            the slate is fully graded and final.
          </Text>
          <CopyReportButton getReportText={getReportText} />
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

        {loading ? <Text style={styles.muted}>Loading reports...</Text> : null}

        {!loading && !report ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Waiting for completed slate.</Text>
            <Text style={styles.emptyText}>
              Lab shows the most recent fully graded official slate. In-progress slates remain
              in Results/Saved until all props grade and the report is final.
            </Text>
            {rotation.activeResults.length > 0 ? (
              <Text style={styles.activeNote}>
                {rotation.activeResults.length} in-progress slate report
                {rotation.activeResults.length === 1 ? "" : "s"} — not shown in Lab yet.
              </Text>
            ) : null}
          </View>
        ) : null}

        {report ? (
          <View style={styles.labBanner}>
            <Text style={styles.labBannerTitle}>Current Lab Slate</Text>
            <Text style={styles.labBannerNote}>
              This slate remains in Lab until the next completed slate replaces it. Older
              completed slates move to History automatically.
            </Text>
          </View>
        ) : null}

        {sectionA ? (
          <SectionCard title="Current Lab Slate — Status & Record">
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

        {slateLesson ? (
          <SectionCard title="Slate Lesson">
            <SlateLessonSection lesson={slateLesson} />
          </SectionCard>
        ) : null}

        {engineScorecard ? (
          <SectionCard title="Engine Scorecard">
            <EngineScorecardSection scorecard={engineScorecard} />
          </SectionCard>
        ) : null}

        {mistakeBreakdown ? (
          <SectionCard title="Mistake Breakdown">
            <MistakeBreakdownSection breakdown={mistakeBreakdown} />
          </SectionCard>
        ) : null}

        {calibrationRules ? (
          <SectionCard title="Calibration Rules">
            <CalibrationRulesSection rules={calibrationRules} />
          </SectionCard>
        ) : null}

        {sectionB ? (
          <SectionCard title="Risk Calibration (Detail)">
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
          <SectionCard title="Projection / Fair Line (Detail)">
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
          <SectionCard title="Signal Groups (Detail)">
            {Object.entries(sectionD.groups || {}).map(([groupName, groups]) => (
              <View key={groupName} style={styles.signalGroup}>
                <Text style={styles.signalGroupTitle}>{groupName}</Text>
                <GroupPerfTable groups={groups as Record<string, any>} />
              </View>
            ))}
          </SectionCard>
        ) : null}

        {sectionE ? (
          <SectionCard title="Loss Detail (Legacy)">
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
          <SectionCard title="Legacy Calibration Notes">
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

        <SectionCard title="All-Time Analytics">
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

        <SectionCard title="Raw Tracked Props (Slate Sample)">
          {slateTrackedProps.length === 0 ? (
            <Text style={styles.muted}>No tracked props for this slate.</Text>
          ) : (
            slateTrackedProps.map((prop, index) => (
              <View key={prop.trackedId || prop.trackedKey || index} style={styles.rawPropRow}>
                <Text style={styles.rawPropTitle}>
                  {prop.player} — {prop.currentEngineSide} {prop.line} ({prop.league})
                </Text>
                <Text style={styles.rawPropMeta}>
                  {String(prop.status || "pending").toUpperCase()} • conf {prop.confidence ?? "—"} •{" "}
                  {prop.riskLabel || "—"} • {String(prop.tier || "—").toUpperCase()}
                </Text>
                <Text style={styles.rawPropMeta}>
                  proj {formatNum(prop.projection)} • fair {formatNum(prop.fairLine)} • books{" "}
                  {prop.bookCount ?? "—"} • mkt {prop.marketQuality ?? "—"}
                </Text>
              </View>
            ))
          )}
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
  activeNote: {
    color: "#93c5fd",
    fontSize: 12,
    marginTop: 10,
    fontWeight: "700",
  },
  labBanner: {
    backgroundColor: "#14532d",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#22c55e",
    gap: 6,
  },
  labBannerTitle: {
    color: "#bbf7d0",
    fontSize: 14,
    fontWeight: "900",
  },
  labBannerNote: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  engineGrid: {
    gap: 8,
  },
  engineSummary: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  engineCard: {
    backgroundColor: "#111827",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
    gap: 4,
  },
  engineCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  engineName: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "900",
    flex: 1,
  },
  engineBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  engineBadgeText: {
    color: "#f8fafc",
    fontSize: 9,
    fontWeight: "900",
  },
  engineStatusWorking: {
    backgroundColor: "#14532d",
  },
  engineStatusWeak: {
    backgroundColor: "#854d0e",
  },
  engineStatusFailing: {
    backgroundColor: "#7f1d1d",
  },
  engineStatusNeutral: {
    backgroundColor: "#334155",
  },
  engineStatLine: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
  },
  engineLesson: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
  },
  mistakeSection: {
    gap: 8,
  },
  mistakeTotal: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "900",
  },
  mistakeCategory: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    gap: 3,
  },
  mistakeCategoryTitle: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "900",
  },
  mistakeItem: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
  },
  rulesSection: {
    gap: 8,
  },
  ruleRow: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    gap: 2,
  },
  rulePriority: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
  },
  ruleText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "800",
  },
  ruleReason: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
  },
  lessonSection: {
    gap: 6,
  },
  lessonHeadline: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 20,
  },
  lessonBody: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  lessonBullet: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  rawPropRow: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    marginTop: 4,
    gap: 2,
  },
  rawPropTitle: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "900",
  },
  rawPropMeta: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
  },
});
