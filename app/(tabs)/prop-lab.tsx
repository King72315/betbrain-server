import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchHistoryArchives,
  fetchTrackedAnalytics,
  resolveTrackedProps,
} from "../../services/api";
import CopyReportButton from "../../components/CopyReportButton";
import { buildPropLabReport } from "../../utils/reportBuilders";
import {
  computeSlateRotation,
  filterCompletedDailyReports,
  filterValidDailyReports,
} from "../../utils/slateRotation";
import { formatPropLabelLine } from "../../utils/propLabels";
import {
  computeContradictionPerformance,
  computeTrackingTypeRecord,
  getTrackedPropStatus,
  isOfficialTrackingProp,
  isReaderOfficialDemotedProp,
  isReaderUncertainTestProp,
  isTestTrackingProp,
} from "../../utils/resultsQueue";
import {
  buildSlateResultsSnapshot,
  type SlateSnapshotEntry,
} from "../../utils/slateResultsSnapshot";
import {
  computeLabSlateTrackingSummary,
  formatLabTrackingSummaryLine,
} from "../../utils/labTrackingInference";

function SnapshotPropLine({ entry }: { entry: SlateSnapshotEntry }) {
  return (
    <Text style={styles.snapshotLine}>
      {entry.formattedLine}
      {entry.isTopPick ? " • TOP" : ""}
      {entry.bestSixRank ? ` • B6 #${entry.bestSixRank}` : ""}
    </Text>
  );
}

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

function BucketPerfTable({
  title,
  buckets,
}: {
  title: string;
  buckets: Record<string, any> | undefined;
}) {
  if (!buckets || Object.keys(buckets).length === 0) {
    return null;
  }

  return (
    <View style={styles.bucketBlock}>
      <Text style={styles.bucketTitle}>{title}</Text>
      {Object.entries(buckets).map(([key, stats]) => (
        <Text key={key} style={styles.bucketLine}>
          {key}: {stats.total || 0} props •{" "}
          {formatRecord(stats.wins, stats.losses, stats.pushes, stats.accuracy)}
          {stats.pending ? ` • pending ${stats.pending}` : ""}
        </Text>
      ))}
    </View>
  );
}

function TierBreakdownSection({
  slateProps,
  sectionD,
}: {
  slateProps: any[];
  sectionD: any;
}) {
  const tierGroups = sectionD?.groups?.tier || {};
  const hasReportTiers = Object.keys(tierGroups).length > 0;

  const tierCounts = slateProps.reduce<Record<string, number>>((acc, prop) => {
    const tier = String(prop.tier || "UNKNOWN").toUpperCase();
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  return (
    <View style={styles.breakdownSection}>
      <Text style={styles.breakdownTitle}>Tier mix (all tracked)</Text>
      {Object.entries(tierCounts).map(([tier, count]) => (
        <Text key={tier} style={styles.breakdownLine}>
          {tier}: {count}
          {hasReportTiers && tierGroups[tier]
            ? ` • graded ${formatRecord(
                tierGroups[tier].wins,
                tierGroups[tier].losses,
                tierGroups[tier].pushes,
                tierGroups[tier].winRate
              )}`
            : ""}
        </Text>
      ))}
    </View>
  );
}

function SlateAnalyticsBreakdown({
  slateProps,
  analytics,
}: {
  slateProps: any[];
  analytics: any;
}) {
  const filterBucket = (bucketName: string) => {
    const bucket = analytics?.[bucketName];
    if (!bucket) return undefined;

    const slatePlayers = new Set(slateProps.map((prop) => prop.player));
    const filtered: Record<string, any> = {};

    for (const [key, stats] of Object.entries(bucket)) {
      const totalOnSlate = slateProps.filter((prop) => {
        if (bucketName === "byTier") {
          return String(prop.tier || "UNKNOWN").toUpperCase() === key;
        }
        if (bucketName === "byRiskLabel") {
          return (prop.riskLabel || "UNKNOWN") === key;
        }
        if (bucketName === "byCurrentEngineSide") {
          return (prop.currentEngineSide || "UNKNOWN") === key;
        }
        if (bucketName === "byBookCountBucket") {
          return (prop.bookCountBucket || "UNKNOWN") === key;
        }
        if (bucketName === "byConfidenceBucket") {
          return (prop.confidenceBucket || "UNKNOWN") === key;
        }
        if (bucketName === "byDataMode") {
          return (prop.dataMode || "UNKNOWN") === key;
        }
        return slatePlayers.has(prop.player);
      }).length;

      if (totalOnSlate > 0) {
        filtered[key] = { ...stats, total: totalOnSlate };
      }
    }

    return filtered;
  };

  return (
    <View style={styles.breakdownSection}>
      <BucketPerfTable title="Risk bucket" buckets={filterBucket("byRiskLabel")} />
      <BucketPerfTable title="Over / Under" buckets={filterBucket("byCurrentEngineSide")} />
      <BucketPerfTable title="Book count" buckets={filterBucket("byBookCountBucket")} />
      <BucketPerfTable
        title="Confidence bucket"
        buckets={filterBucket("byConfidenceBucket")}
      />
      <BucketPerfTable title="Data mode" buckets={filterBucket("byDataMode")} />
      <BucketPerfTable title="Tier performance" buckets={filterBucket("byTier")} />
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

function LeagueSplitSection({
  leagueSplit,
  leagueCalibration,
}: {
  leagueSplit: any;
  leagueCalibration: any;
}) {
  if (!leagueSplit?.byLeague && !leagueCalibration) {
    return <Text style={styles.muted}>No league-split calibration data yet.</Text>;
  }

  const structural =
    leagueSplit?.structuralNotes || leagueCalibration?.structuralNotes || null;

  return (
    <View style={styles.breakdownSection}>
      {structural ? (
        <View style={styles.structuralBlock}>
          <Text style={styles.breakdownTitle}>WNBA structural gaps (pick pipeline)</Text>
          <Text style={styles.structuralLine}>
            Availability gate: {structural.availabilityGate || "—"}
          </Text>
          <Text style={styles.structuralLine}>
            Defense score: {structural.defenseScore || "—"}
          </Text>
          <Text style={styles.structuralLine}>
            Primary stat source: {structural.primaryStatSource || "—"}
          </Text>
        </View>
      ) : null}

      {(["NBA", "WNBA"] as const).map((league) => {
        const slate = leagueSplit?.byLeague?.[league];
        const allTime = leagueCalibration?.[league];
        if (!slate && !allTime) return null;

        return (
          <View key={league} style={styles.leagueBlock}>
            <Text style={styles.breakdownTitle}>{league}</Text>
            {slate?.record ? (
              <MetricRow
                label="Slate record"
                value={formatRecord(
                  slate.record.wins,
                  slate.record.losses,
                  slate.record.pushes,
                  slate.record.winRate
                )}
              />
            ) : null}
            {slate?.premium ? (
              <MetricRow
                label="PREMIUM (slate)"
                value={formatRecord(
                  slate.premium.wins,
                  slate.premium.losses,
                  slate.premium.pushes,
                  slate.premium.winRate
                )}
              />
            ) : null}
            {slate?.playable ? (
              <MetricRow
                label="PLAYABLE (slate)"
                value={formatRecord(
                  slate.playable.wins,
                  slate.playable.losses,
                  slate.playable.pushes,
                  slate.playable.winRate
                )}
              />
            ) : null}
            {allTime ? (
              <MetricRow
                label="All-time tracked"
                value={formatRecord(
                  allTime.wins,
                  allTime.losses,
                  allTime.pushes,
                  allTime.accuracy
                )}
              />
            ) : null}
            {allTime?.premium?.total > 0 ? (
              <MetricRow
                label="All-time PREMIUM"
                value={formatRecord(
                  allTime.premium.wins,
                  allTime.premium.losses,
                  allTime.premium.pushes,
                  allTime.premium.accuracy
                )}
              />
            ) : null}
            {slate?.riskBuckets
              ? Object.entries(slate.riskBuckets)
                  .filter(([, stats]: [string, any]) => (stats.total || 0) > 0)
                  .map(([bucket, stats]: [string, any]) => (
                    <Text key={`${league}-${bucket}`} style={styles.breakdownLine}>
                      {bucket} risk:{" "}
                      {formatRecord(stats.wins, stats.losses, stats.pushes, stats.winRate)}
                    </Text>
                  ))
              : null}
          </View>
        );
      })}

      {leagueSplit?.note ? (
        <Text style={styles.muted}>{leagueSplit.note}</Text>
      ) : null}
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
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [selectedSlateDate, setSelectedSlateDate] = useState<string | null>(null);
  const [rotationMeta, setRotationMeta] = useState<{
    currentLabSlateDate: string | null;
    viewingHistorical: boolean;
    historySlateDates: string[];
  }>({
    currentLabSlateDate: null,
    viewingHistorical: false,
    historySlateDates: [],
  });

  const slateRotation = useMemo(() => {
    const base = computeSlateRotation(reports, { archives });
    return {
      ...base,
      currentLabSlateDate:
        rotationMeta.currentLabSlateDate ?? base.currentLabSlateDate,
      viewingHistorical:
        rotationMeta.viewingHistorical ?? base.viewingHistorical,
    };
  }, [reports, archives, rotationMeta]);
  const currentLabSlateDate =
    rotationMeta.currentLabSlateDate ?? slateRotation.currentLabSlateDate;
  const viewedSlateDate = selectedSlateDate || currentLabSlateDate;
  const isViewingHistoricalReport = Boolean(
    viewedSlateDate &&
      currentLabSlateDate &&
      viewedSlateDate !== currentLabSlateDate
  );
  const validCompletedReports = useMemo(
    () => filterCompletedDailyReports(reports),
    [reports]
  );
  const historySlateCount =
    rotationMeta.historySlateDates.length || slateRotation.historySlates.length;
  const hasCompletedLabSlate = Boolean(viewedSlateDate && report);

  const loadReportForSlate = async (slateDate: string, validReports: any[]) => {
    const frozenReport =
      validReports.find(
        (r) =>
          r.slateDate === slateDate && (r.frozen === true || r.locked === true)
      ) || null;
    const detail = frozenReport
      ? { ok: true, report: frozenReport }
      : await fetchDailySlateReport(slateDate);
    setReport(
      detail.report || validReports.find((r) => r.slateDate === slateDate) || null
    );
  };

  const loadReports = async (targetSlateDate?: string | null) => {
    const list = await fetchDailySlateReports();
    const rawReports = list.reports || [];
    const validReports = filterValidDailyReports(rawReports);
    setReports(validReports);
    setRotationMeta({
      currentLabSlateDate: list.currentLabSlateDate || null,
      viewingHistorical: Boolean(list.viewingHistorical),
      historySlateDates: list.historySlateDates || [],
    });

    const labDate = list.currentLabSlateDate || computeSlateRotation(validReports, { archives }).currentLabSlateDate;
    const slateToLoad = targetSlateDate || selectedSlateDate || labDate;

    if (slateToLoad) {
      await loadReportForSlate(slateToLoad, validReports);
    } else {
      setReport(null);
    }
  };

  const handleSelectSlate = async (slateDate: string) => {
    setSelectedSlateDate(slateDate);
    const validReports = filterValidDailyReports(reports);
    await loadReportForSlate(slateDate, validReports);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [analyticsData, archiveData] = await Promise.all([
        fetchTrackedAnalytics(),
        fetchHistoryArchives(),
      ]);
      setAnalytics(analyticsData.analytics || null);
      setArchives(archiveData.archives || []);
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
      const [analyticsData, archiveData] = await Promise.all([
        fetchTrackedAnalytics(),
        fetchHistoryArchives(),
      ]);
      setAnalytics(analyticsData.analytics || null);
      setArchives(archiveData.archives || []);
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

  useEffect(() => {
    if (!currentLabSlateDate) return;
    if (!selectedSlateDate || selectedSlateDate === currentLabSlateDate) {
      setSelectedSlateDate(currentLabSlateDate);
    }
  }, [currentLabSlateDate, selectedSlateDate]);

  const sectionA = report?.sections?.A;
  const sectionB = report?.sections?.B;
  const sectionC = report?.sections?.C;
  const sectionD = report?.sections?.D;
  const sectionE = report?.sections?.E;
  const sectionF = report?.sections?.F;
  const sectionM = report?.sections?.M || report?.topPicksReview;
  const sectionO = report?.sections?.O || report?.bestSixReview;
  const sectionN = report?.sections?.N || report?.qualityGatePerformance;
  const sectionQ = report?.sections?.Q || report?.wnbaV2GateReview;
  const sectionR = report?.sections?.R || report?.retroGateSimulation;
  const sectionS = report?.sections?.S || report?.decisionIntelligenceReview;
  const sectionT = report?.sections?.T || report?.riskHonestyReview;
  const sectionU = report?.sections?.U || report?.upgradeDemotionReview;
  const sectionP = report?.sections?.P || report?.slateResultsSnapshot;
  const engineScorecard = report?.engineScorecard || report?.sections?.G;
  const mistakeBreakdown = report?.mistakeBreakdown || report?.sections?.H;
  const calibrationRules = report?.calibrationRules || report?.sections?.I;
  const slateLesson = report?.slateLesson || report?.sections?.J;
  const leagueSplit = report?.leagueSplit || report?.sections?.L;

  const slateTrackedProps = useMemo(() => {
    if (!viewedSlateDate) return [];
    const archive = archives.find(
      (item) => String(item.slateDate) === viewedSlateDate
    );
    if (archive?.props?.length) return archive.props;
    return [];
  }, [viewedSlateDate, archives]);

  const labTrackingSummary = useMemo(
    () => computeLabSlateTrackingSummary(slateTrackedProps, sectionA),
    [slateTrackedProps, sectionA]
  );

  const officialSlateProps = useMemo(() => {
    return slateTrackedProps.filter(isOfficialTrackingProp);
  }, [slateTrackedProps]);

  const testSlateProps = useMemo(() => {
    return slateTrackedProps.filter(isTestTrackingProp);
  }, [slateTrackedProps]);

  const officialRecord = useMemo(
    () => computeTrackingTypeRecord(officialSlateProps, getTrackedPropStatus),
    [officialSlateProps]
  );

  const testRecord = useMemo(
    () => computeTrackingTypeRecord(testSlateProps, getTrackedPropStatus),
    [testSlateProps]
  );

  const readerOfficialDemotedProps = useMemo(
    () => testSlateProps.filter(isReaderOfficialDemotedProp),
    [testSlateProps]
  );

  const readerUncertainTestProps = useMemo(
    () => testSlateProps.filter(isReaderUncertainTestProp),
    [testSlateProps]
  );

  const readerOfficialDemotedRecord = useMemo(
    () => computeTrackingTypeRecord(readerOfficialDemotedProps, getTrackedPropStatus),
    [readerOfficialDemotedProps]
  );

  const readerUncertainTestRecord = useMemo(
    () => computeTrackingTypeRecord(readerUncertainTestProps, getTrackedPropStatus),
    [readerUncertainTestProps]
  );

  const labSnapshot = useMemo(() => {
    if (!viewedSlateDate) return null;
    if (sectionP && !sectionP.snapshotMissing) return sectionP;
    return buildSlateResultsSnapshot(slateTrackedProps, {
      slateDate: viewedSlateDate,
    });
  }, [sectionP, slateTrackedProps, viewedSlateDate]);

  const contradictionPerf = useMemo(
    () => computeContradictionPerformance(testSlateProps),
    [testSlateProps]
  );

  const allTimeRecord = useMemo(() => {
    if (!hasCompletedLabSlate) return null;
    const o = analytics?.overall?.currentEngine;
    if (!o || (o.wins + o.losses + o.pushes === 0 && analytics?.overall?.total === 0)) {
      return null;
    }
    return formatRecord(o.wins, o.losses, o.pushes, o.accuracy);
  }, [analytics, hasCompletedLabSlate]);

  const getReportText = () =>
    buildPropLabReport({
      reports,
      rotation: slateRotation,
      report,
      analytics,
      loading,
      building,
      refreshing,
      viewedSlateDate,
      isViewingHistoricalReport,
      labTrackingSummary,
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
            Lab analyzes completed slates only — tier, risk, confidence, book count, and data mode
            breakdowns. Active grading stays in Results until the slate is fully graded.
          </Text>
          <MetricRow
            label="Reports Available"
            value={String(validCompletedReports.length)}
          />
          <MetricRow
            label="History Slates"
            value={String(historySlateCount)}
          />
          <CopyReportButton getReportText={getReportText} />
        </View>

        {validCompletedReports.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.slatePicker}
            contentContainerStyle={styles.slatePickerContent}
          >
            {validCompletedReports.map((item) => {
              const slateDate = String(item.slateDate);
              const isActive = slateDate === viewedSlateDate;
              return (
                <TouchableOpacity
                  key={slateDate}
                  style={[styles.slateChip, isActive && styles.slateChipActive]}
                  onPress={() => handleSelectSlate(slateDate)}
                >
                  <Text
                    style={[
                      styles.slateChipText,
                      isActive && styles.slateChipTextActive,
                    ]}
                  >
                    {formatSlateLabel(slateDate)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

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
            <Text style={styles.emptyTitle}>No completed Lab slate yet.</Text>
            <Text style={styles.emptyText}>
              Today's active slate remains in Results until every prop grades. Completed
              slates appear here automatically.
            </Text>
          </View>
        ) : null}

        {report ? (
          <View style={styles.labBanner}>
            {isViewingHistoricalReport ? (
              <>
                <Text style={styles.labBannerTitle}>
                  Viewing Report: {formatSlateLabel(viewedSlateDate || "")}
                </Text>
                {currentLabSlateDate ? (
                  <Text style={styles.activeNote}>
                    Current Lab Slate: {formatSlateLabel(currentLabSlateDate)}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.labBannerTitle}>
                  Current Lab Slate: {formatSlateLabel(viewedSlateDate || "")}
                </Text>
                <Text style={styles.labBannerNote}>
                  This slate remains in Lab until the next completed slate replaces it. Older
                  completed slates move to History automatically.
                </Text>
              </>
            )}
          </View>
        ) : null}

        {sectionA ? (
          <SectionCard title="Tracked Slate Summary">
            <MetricRow
              label="Total Props"
              value={String(labTrackingSummary.totalProps)}
            />
            <MetricRow
              label="Official Props"
              value={String(labTrackingSummary.officialProps)}
            />
            <MetricRow
              label="Test / Watchlist Props"
              value={String(labTrackingSummary.testWatchlistProps)}
            />
            {labTrackingSummary.legacyLeanProps > 0 ? (
              <MetricRow
                label="Legacy LEAN Props"
                value={String(labTrackingSummary.legacyLeanProps)}
              />
            ) : null}
            {labTrackingSummary.legacyWatchlistProps > 0 ? (
              <MetricRow
                label="Legacy WATCHLIST Props"
                value={String(labTrackingSummary.legacyWatchlistProps)}
              />
            ) : null}
            <MetricRow
              label="Reader official demoted"
              value={String(readerOfficialDemotedRecord.total)}
            />
            <MetricRow
              label="Reader uncertain TEST"
              value={String(readerUncertainTestRecord.total)}
            />
          </SectionCard>
        ) : null}

        {sectionA ? (
          <SectionCard title="Official Performance">
            <View style={styles.summaryHeader}>
              <Text style={styles.slateTitle}>{formatSlateLabel(sectionA.slateDate)}</Text>
              <StatusBadge status={sectionA.reportStatus || report?.status || ""} />
            </View>
            {sectionA.pending > 0 ? (
              <Text style={styles.pendingNote}>
                {sectionA.pending} prop(s) still pending — report updates when all grade.
              </Text>
            ) : null}
            <MetricRow label="Official tracked" value={String(officialRecord.total)} />
            <MetricRow
              label="Official record"
              value={formatRecord(
                officialRecord.wins,
                officialRecord.losses,
                officialRecord.pushes,
                officialRecord.winRate
              )}
            />
            <MetricRow
              label="Graded / Pending"
              value={`${officialRecord.graded} / ${officialRecord.pending}`}
            />
            <MetricRow label="Leagues" value={(sectionA.leagues || []).join(", ") || "—"} />
            {leagueSplit?.byLeague?.NBA?.record ? (
              <MetricRow
                label="NBA record"
                value={formatRecord(
                  leagueSplit.byLeague.NBA.record.wins,
                  leagueSplit.byLeague.NBA.record.losses,
                  leagueSplit.byLeague.NBA.record.pushes,
                  leagueSplit.byLeague.NBA.record.winRate
                )}
              />
            ) : null}
            {leagueSplit?.byLeague?.WNBA?.record ? (
              <MetricRow
                label="WNBA record"
                value={formatRecord(
                  leagueSplit.byLeague.WNBA.record.wins,
                  leagueSplit.byLeague.WNBA.record.losses,
                  leagueSplit.byLeague.WNBA.record.pushes,
                  leagueSplit.byLeague.WNBA.record.winRate
                )}
              />
            ) : null}
          </SectionCard>
        ) : null}

        {sectionO && !sectionO.snapshotMissing ? (
          <SectionCard title="Controlled Best 6 Performance">
            <Text style={styles.muted}>
              Original tracked Best 6 props — not double-counted with Top Picks references.
            </Text>
            <MetricRow
              label="Overall Best 6 record"
              value={formatRecord(
                sectionO.record?.wins ?? 0,
                sectionO.record?.losses ?? 0,
                sectionO.record?.pushes ?? 0,
                sectionO.record?.winRate
              )}
            />
            {sectionO.winningProps?.length ? (
              <>
                <Text style={styles.snapshotHeading}>Winning Props</Text>
                {sectionO.winningProps.map((entry: SlateSnapshotEntry) => (
                  <SnapshotPropLine key={`o-win-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : sectionO.picks?.length ? (
              (() => {
                const bestSixSnapshot = buildSlateResultsSnapshot(sectionO.picks, {
                  slateDate: sectionO.slateDate,
                });
                if (!bestSixSnapshot.winningProps.length) return null;
                return (
                  <>
                    <Text style={styles.snapshotHeading}>Winning Props</Text>
                    {bestSixSnapshot.winningProps.map((entry) => (
                      <SnapshotPropLine key={`o-win-${entry.trackedKey || entry.player}`} entry={entry} />
                    ))}
                  </>
                );
              })()
            ) : null}
            {sectionO.losingProps?.length ? (
              <>
                <Text style={styles.snapshotHeading}>Losing Props</Text>
                {sectionO.losingProps.map((entry: SlateSnapshotEntry) => (
                  <SnapshotPropLine key={`o-loss-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : sectionO.picks?.length ? (
              (() => {
                const bestSixSnapshot = buildSlateResultsSnapshot(sectionO.picks, {
                  slateDate: sectionO.slateDate,
                });
                if (!bestSixSnapshot.losingProps.length) return null;
                return (
                  <>
                    <Text style={styles.snapshotHeading}>Losing Props</Text>
                    {bestSixSnapshot.losingProps.map((entry) => (
                      <SnapshotPropLine key={`o-loss-${entry.trackedKey || entry.player}`} entry={entry} />
                    ))}
                  </>
                );
              })()
            ) : null}
            {sectionO.nbaBestSixReview?.record ? (
              <MetricRow
                label="NBA Best 6 record"
                value={formatRecord(
                  sectionO.nbaBestSixReview.record.wins,
                  sectionO.nbaBestSixReview.record.losses,
                  sectionO.nbaBestSixReview.record.pushes,
                  sectionO.nbaBestSixReview.record.winRate
                )}
              />
            ) : null}
            {sectionO.wnbaBestSixReview?.record ? (
              <MetricRow
                label="WNBA Best 6 record"
                value={formatRecord(
                  sectionO.wnbaBestSixReview.record.wins,
                  sectionO.wnbaBestSixReview.record.losses,
                  sectionO.wnbaBestSixReview.record.pushes,
                  sectionO.wnbaBestSixReview.record.winRate
                )}
              />
            ) : null}
            <MetricRow
              label="Official vs TEST"
              value={`${sectionO.officialVsTest?.officialRecord?.total ?? 0} official / ${sectionO.officialVsTest?.testRecord?.total ?? 0} test`}
            />
          </SectionCard>
        ) : sectionO?.snapshotMissing ? (
          <SectionCard title="Controlled Best 6 Performance">
            <Text style={styles.muted}>
              {sectionO.message || "No Best 6 snapshot found for this slate."}
            </Text>
          </SectionCard>
        ) : null}

        {labSnapshot && !labSnapshot.snapshotMissing ? (
          <SectionCard title="Slate Results Snapshot">
            <MetricRow
              label="Graded record"
              value={`${labSnapshot.winsCount}W / ${labSnapshot.lossesCount}L / ${labSnapshot.pushesCount}P`}
            />
            {labSnapshot.biggestWins?.map((entry: SlateSnapshotEntry) => (
              <SnapshotPropLine key={`p-win-${entry.trackedKey}`} entry={entry} />
            ))}
            {labSnapshot.biggestMisses?.map((entry: SlateSnapshotEntry) => (
              <SnapshotPropLine key={`p-loss-${entry.trackedKey}`} entry={entry} />
            ))}
          </SectionCard>
        ) : labSnapshot?.snapshotMissing ? (
          <SectionCard title="Slate Results Snapshot">
            <Text style={styles.muted}>
              No graded props yet — snapshot appears after grading completes.
            </Text>
          </SectionCard>
        ) : null}

        {sectionM ? (
          <>
            {sectionM.snapshotMissing ? (
              <SectionCard title="Top Picks Selection Review">
                <Text style={styles.muted}>
                  {sectionM.message || "No Top Picks snapshot found for this slate."}
                </Text>
              </SectionCard>
            ) : (
              <>
            <SectionCard title="NBA Top Picks Record">
              <Text style={styles.muted}>
                Reference-only best-2 NBA snapshot — subset analysis, not double-counted in slate record.
              </Text>
              <MetricRow
                label="NBA top picks record"
                value={formatRecord(
                  sectionM.nbaTopPicksReview?.record?.wins ?? 0,
                  sectionM.nbaTopPicksReview?.record?.losses ?? 0,
                  sectionM.nbaTopPicksReview?.record?.pushes ?? 0,
                  sectionM.nbaTopPicksReview?.record?.winRate
                )}
              />
              {sectionM.nbaTopPicksReview?.pickOne ? (
                <Text style={styles.breakdownLine}>
                  {sectionM.nbaTopPicksReview.pickOne.topPickLabel || "Top NBA #1"}{" "}
                  {sectionM.nbaTopPicksReview.pickOne.player} — score{" "}
                  {formatNum(sectionM.nbaTopPicksReview.pickOne.bestPropScore)} —{" "}
                  {String(sectionM.nbaTopPicksReview.pickOne.status || "pending").toUpperCase()}
                </Text>
              ) : null}
              {sectionM.nbaTopPicksReview?.pickTwo ? (
                <Text style={styles.breakdownLine}>
                  {sectionM.nbaTopPicksReview.pickTwo.topPickLabel || "Top NBA #2"}{" "}
                  {sectionM.nbaTopPicksReview.pickTwo.player} — score{" "}
                  {formatNum(sectionM.nbaTopPicksReview.pickTwo.bestPropScore)} —{" "}
                  {String(sectionM.nbaTopPicksReview.pickTwo.status || "pending").toUpperCase()}
                </Text>
              ) : null}
            </SectionCard>

            <SectionCard title="WNBA Top Picks Record">
              <Text style={styles.muted}>
                Reference-only best-2 WNBA snapshot — subset analysis, not double-counted in slate record.
              </Text>
              <MetricRow
                label="WNBA top picks record"
                value={formatRecord(
                  sectionM.wnbaTopPicksReview?.record?.wins ?? 0,
                  sectionM.wnbaTopPicksReview?.record?.losses ?? 0,
                  sectionM.wnbaTopPicksReview?.record?.pushes ?? 0,
                  sectionM.wnbaTopPicksReview?.record?.winRate
                )}
              />
              {sectionM.wnbaTopPicksReview?.pickOne ? (
                <Text style={styles.breakdownLine}>
                  {sectionM.wnbaTopPicksReview.pickOne.topPickLabel || "Top WNBA #1"}{" "}
                  {sectionM.wnbaTopPicksReview.pickOne.player} — score{" "}
                  {formatNum(sectionM.wnbaTopPicksReview.pickOne.bestPropScore)} —{" "}
                  {String(sectionM.wnbaTopPicksReview.pickOne.status || "pending").toUpperCase()}
                </Text>
              ) : null}
              {sectionM.wnbaTopPicksReview?.pickTwo ? (
                <Text style={styles.breakdownLine}>
                  {sectionM.wnbaTopPicksReview.pickTwo.topPickLabel || "Top WNBA #2"}{" "}
                  {sectionM.wnbaTopPicksReview.pickTwo.player} — score{" "}
                  {formatNum(sectionM.wnbaTopPicksReview.pickTwo.bestPropScore)} —{" "}
                  {String(sectionM.wnbaTopPicksReview.pickTwo.status || "pending").toUpperCase()}
                </Text>
              ) : null}
            </SectionCard>

            <SectionCard title="Top Picks vs Rest of Slate">
              <MetricRow
                label="All top picks record"
                value={formatRecord(
                  sectionM.record?.wins ?? 0,
                  sectionM.record?.losses ?? 0,
                  sectionM.record?.pushes ?? 0,
                  sectionM.record?.winRate
                )}
              />
              <MetricRow
                label="Rest of slate"
                value={formatRecord(
                  sectionM.vsRestOfSlate?.restRecord?.wins ?? 0,
                  sectionM.vsRestOfSlate?.restRecord?.losses ?? 0,
                  sectionM.vsRestOfSlate?.restRecord?.pushes ?? 0,
                  sectionM.vsRestOfSlate?.restRecord?.winRate
                )}
              />
            </SectionCard>
              </>
            )}
          </>
        ) : (
          <SectionCard title="Top Picks Selection Review">
            <Text style={styles.muted}>No Top Picks snapshot found for this slate.</Text>
          </SectionCard>
        )}

        {sectionN ? (
          <SectionCard title="WNBA v2 Gate Review">
            <Text style={styles.muted}>
              Tracks how many WNBA candidates passed Tracking Gate v2 vs board-only / blocked.
            </Text>
            <MetricRow
              label="Gate version"
              value={String(sectionN.gateVersion || sectionN.qualityGateVersion || "—")}
            />
            <MetricRow
              label="WNBA tracked (TRACK)"
              value={String(sectionN.wnbaTrackedCount ?? sectionN.trackedCount ?? 0)}
            />
            <MetricRow
              label="Over gate pass"
              value={String(sectionQ?.overGatePassCount ?? "—")}
            />
            <MetricRow
              label="Under gate pass"
              value={String(sectionQ?.underGatePassCount ?? "—")}
            />
            <MetricRow
              label="Board-only"
              value={String(sectionN.boardOnlyCount ?? 0)}
            />
            <MetricRow
              label="Shadow-only"
              value={String(sectionN.shadowOnlyCount ?? 0)}
            />
            <MetricRow
              label="Blocked (NO_BET)"
              value={String(sectionN.blockedCount ?? 0)}
            />
            <MetricRow
              label="Avg gate score (tracked)"
              value={
                sectionN.avgQualityGateScore != null
                  ? String(sectionN.avgQualityGateScore)
                  : "—"
              }
            />
            {sectionN.blockReasons && Object.keys(sectionN.blockReasons).length > 0 ? (
              <>
                <Text style={styles.breakdownTitle}>Top block reasons</Text>
                {Object.entries(sectionN.blockReasons)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([reason, count]) => (
                    <Text key={reason} style={styles.breakdownLine}>
                      {reason}: {count}
                    </Text>
                  ))}
              </>
            ) : null}
          </SectionCard>
        ) : null}

        {sectionQ?.lossReviews?.length ? (
          <SectionCard title="WNBA v2 Loss Review">
            <Text style={styles.muted}>
              Would the new v2 gate have blocked this loss?
            </Text>
            {sectionQ.lossReviews.slice(0, 8).map((loss, index) => (
              <View key={`loss-review-${index}`} style={styles.rawPropRow}>
                <Text style={styles.rawPropTitle}>
                  {loss.player} — {loss.prop} — {String(loss.status || "").toUpperCase()}
                </Text>
                <Text style={styles.rawPropMeta}>
                  Gate: {loss.newGateDecision} — {loss.newGateReason || "—"}
                </Text>
                <Text style={styles.rawPropMeta}>
                  Would block now: {loss.wouldBlockNow ? "YES" : "NO"} — danger stack:{" "}
                  {loss.dangerGateCount ?? 0}
                </Text>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {sectionS ? (
          <SectionCard title="Decision Intelligence Review">
            <MetricRow
              label="Version"
              value={String(sectionS.version || "—")}
            />
            <MetricRow
              label="Low Risk record"
              value={String(sectionS.trueRiskRecords?.LOW?.record || "—")}
            />
            <MetricRow
              label="Medium Risk record"
              value={String(sectionS.trueRiskRecords?.MEDIUM?.record || "—")}
            />
            <MetricRow
              label="High Risk record"
              value={String(sectionS.trueRiskRecords?.HIGH?.record || "—")}
            />
            <MetricRow
              label="TRACK record"
              value={String(sectionS.trackEligibilityRecords?.TRACK?.record || "—")}
            />
            <MetricRow
              label="BOARD_ONLY record"
              value={String(sectionS.trackEligibilityRecords?.BOARD_ONLY?.record || "—")}
            />
          </SectionCard>
        ) : null}

        {sectionT ? (
          <SectionCard title="Risk Honesty Review">
            <Text style={styles.muted}>{sectionT.question || "Was risk honest?"}</Text>
            <MetricRow label="Low Risk count" value={String(sectionT.lowRiskCount ?? 0)} />
            <MetricRow label="Low Risk wins" value={String(sectionT.lowRiskActedLow ?? 0)} />
            <MetricRow label="Low Risk losses" value={String(sectionT.lowRiskFailed ?? 0)} />
            <MetricRow
              label="High Risk excluded"
              value={String(sectionT.highRiskCorrectlyExcluded ?? 0)}
            />
            {sectionT.mostPredictiveDebts?.slice(0, 5).map((item: any, index: number) => (
              <Text key={`debt-${index}`} style={styles.breakdownLine}>
                {item.code}: {item.lossCount} losses
              </Text>
            ))}
          </SectionCard>
        ) : null}

        {sectionU ? (
          <SectionCard title="Upgrade/Demotion Review">
            <MetricRow
              label="Upgraded to TRACK"
              value={String(sectionU.upgradedToTrack?.length ?? 0)}
            />
            <MetricRow
              label="Demoted to BOARD_ONLY"
              value={String(sectionU.demotedToBoardOnly?.length ?? 0)}
            />
            <MetricRow
              label="Blocked NO_BET"
              value={String(sectionU.blockedNoBet?.length ?? 0)}
            />
            <MetricRow
              label="Blocked would-have-won"
              value={String(sectionU.blockedWouldHaveWon?.length ?? 0)}
            />
            {sectionU.allowedLost?.slice(0, 4).map((item: any, index: number) => (
              <Text key={`allowed-loss-${index}`} style={styles.breakdownLine}>
                LOSS kept {item.player} {item.side} {item.line}
              </Text>
            ))}
          </SectionCard>
        ) : null}

        {sectionR?.available !== false && sectionR?.simulatedRecord ? (
          <SectionCard title="Decision Intelligence Retro Simulation">
            <Text style={styles.muted}>Report-only — does not change historical grades.</Text>
            <MetricRow
              label="Actual record"
              value={String(sectionR.actualRecord?.record || "—")}
            />
            <MetricRow
              label="Simulated TRACK record"
              value={String(sectionR.simulatedRecord?.record || "—")}
            />
            <MetricRow
              label="Would track"
              value={String(sectionR.simulatedRecord?.wouldTrack ?? 0)}
            />
            <MetricRow
              label="Losses blocked"
              value={String(sectionR.lossesWouldBeBlocked?.length ?? 0)}
            />
            <MetricRow
              label="Wins kept"
              value={String(sectionR.winsWouldStillTrack?.length ?? 0)}
            />
            <MetricRow
              label="Wins blocked"
              value={String(sectionR.winsWouldBeBlocked?.length ?? 0)}
            />
            {sectionR.lossesWouldBeBlocked?.slice(0, 6).map((item, index) => (
              <Text key={`retro-loss-${index}`} style={styles.breakdownLine}>
                BLOCK {item.player} {item.prop}: {item.reason}
              </Text>
            ))}
          </SectionCard>
        ) : null}

        {readerOfficialDemotedRecord.total > 0 ? (
          <SectionCard title="Reader Official Demoted (TEST)">
            <Text style={styles.muted}>
              Reader called OFFICIAL but v1/tier gates demoted to TEST — separate calibration bucket.
            </Text>
            <MetricRow label="Demoted tracked" value={String(readerOfficialDemotedRecord.total)} />
            <MetricRow
              label="Demoted record"
              value={formatRecord(
                readerOfficialDemotedRecord.wins,
                readerOfficialDemotedRecord.losses,
                readerOfficialDemotedRecord.pushes,
                readerOfficialDemotedRecord.winRate
              )}
            />
            {readerOfficialDemotedProps.slice(0, 4).map((prop, index) => (
              <View key={prop.trackedKey || `demoted-${index}`} style={styles.rawPropRow}>
                <Text style={styles.rawPropTitle}>
                  {prop.player} — {prop.currentEngineSide} {prop.line}
                </Text>
                <Text style={styles.rawPropMeta}>
                  {prop.officialDemotionReason || prop.trackingReason || "Official gate demotion"}
                </Text>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {readerUncertainTestRecord.total > 0 ? (
          <SectionCard title="Reader Uncertain TEST">
            <MetricRow label="Uncertain TEST tracked" value={String(readerUncertainTestRecord.total)} />
            <MetricRow
              label="Uncertain TEST record"
              value={formatRecord(
                readerUncertainTestRecord.wins,
                readerUncertainTestRecord.losses,
                readerUncertainTestRecord.pushes,
                readerUncertainTestRecord.winRate
              )}
            />
          </SectionCard>
        ) : null}

        {testRecord.total > 0 ? (
          <SectionCard title="Test / Learning Performance">
            <MetricRow label="Test tracked" value={String(testRecord.total)} />
            <MetricRow
              label="Test record"
              value={formatRecord(
                testRecord.wins,
                testRecord.losses,
                testRecord.pushes,
                testRecord.winRate
              )}
            />
            <MetricRow
              label="Graded / Pending"
              value={`${testRecord.graded} / ${testRecord.pending}`}
            />
            {Object.keys(contradictionPerf).length > 0 ? (
              <>
                <Text style={styles.breakdownTitle}>Contradiction performance (test)</Text>
                {Object.entries(contradictionPerf).map(([key, stats]) => (
                  <Text key={key} style={styles.breakdownLine}>
                    {key}: {formatRecord(stats.wins, stats.losses, stats.pushes)}
                  </Text>
                ))}
              </>
            ) : null}
            {testSlateProps.slice(0, 6).map((prop, index) => (
              <View key={prop.trackedKey || index} style={styles.rawPropRow}>
                <Text style={styles.rawPropTitle}>
                  {prop.player} — {prop.currentEngineSide} {prop.line}
                </Text>
                <Text style={styles.rawPropMeta}>
                  Side audit: {prop.sideSelectionDecision || "—"} • trust{" "}
                  {prop.sideTrustScore ?? "—"}
                </Text>
                {prop.trackingReason || prop.testReason ? (
                  <Text style={styles.rawPropMeta}>
                    Tracking reason: {prop.trackingReason || prop.testReason}
                  </Text>
                ) : null}
              </View>
            ))}
          </SectionCard>
        ) : null}

        {leagueSplit || analytics?.leagueCalibration ? (
          <SectionCard title="League-Split Calibration">
            <LeagueSplitSection
              leagueSplit={leagueSplit}
              leagueCalibration={analytics?.leagueCalibration}
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
            <TierBreakdownSection slateProps={slateTrackedProps} sectionD={sectionD} />
            {Object.entries(sectionD.groups || {}).map(([groupName, groups]) => (
              <View key={groupName} style={styles.signalGroup}>
                <Text style={styles.signalGroupTitle}>{groupName}</Text>
                <GroupPerfTable groups={groups as Record<string, any>} />
              </View>
            ))}
          </SectionCard>
        ) : null}

        {slateTrackedProps.length > 0 ? (
          <SectionCard title="Slate Breakdown — Tier / Risk / Books / Data">
            <SlateAnalyticsBreakdown
              slateProps={slateTrackedProps}
              analytics={analytics}
            />
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
          <MetricRow label="Tracked engine (pooled)" value={allTimeRecord || "—"} />
          {hasCompletedLabSlate && analytics?.leagueCalibration?.NBA ? (
            <MetricRow
              label="NBA all-time"
              value={formatRecord(
                analytics.leagueCalibration.NBA.wins,
                analytics.leagueCalibration.NBA.losses,
                analytics.leagueCalibration.NBA.pushes,
                analytics.leagueCalibration.NBA.accuracy
              )}
            />
          ) : null}
          {hasCompletedLabSlate && analytics?.leagueCalibration?.WNBA ? (
            <MetricRow
              label="WNBA all-time"
              value={formatRecord(
                analytics.leagueCalibration.WNBA.wins,
                analytics.leagueCalibration.WNBA.losses,
                analytics.leagueCalibration.WNBA.pushes,
                analytics.leagueCalibration.WNBA.accuracy
              )}
            />
          ) : null}
          <MetricRow
            label="Fair line shadow"
            value={
              hasCompletedLabSlate && analytics?.overall?.fairLineShadow
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
            value={String(hasCompletedLabSlate ? analytics?.overall?.total || 0 : 0)}
          />
        </SectionCard>

        <SectionCard title="Raw Tracked Props (Slate Sample)">
          {slateTrackedProps.length === 0 ? (
            <Text style={styles.muted}>No tracked props for this slate.</Text>
          ) : (
            slateTrackedProps.slice(0, 24).map((prop, index) => (
              <View key={prop.trackedId || prop.trackedKey || index} style={styles.rawPropRow}>
                <Text style={styles.rawPropTitle}>
                  {prop.player} — {prop.currentEngineSide} {prop.line} ({prop.league})
                </Text>
                <Text style={styles.rawPropMeta}>{formatPropLabelLine(prop)}</Text>
                <Text style={styles.rawPropMeta}>
                  {String(prop.status || "pending").toUpperCase()} • proj {formatNum(prop.projection)} • fair {formatNum(prop.fairLine)}
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
  breakdownSection: {
    gap: 8,
    marginBottom: 8,
  },
  breakdownTitle: {
    color: "#facc15",
    fontSize: 13,
    fontWeight: "900",
  },
  breakdownLine: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  structuralBlock: {
    gap: 4,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  structuralLine: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
  },
  leagueBlock: {
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
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
  snapshotHeading: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 10,
    marginBottom: 6,
  },
  snapshotLine: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    lineHeight: 18,
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
