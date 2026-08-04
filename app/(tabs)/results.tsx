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
  fetchLockedSlates,
  fetchTrackedProps,
  resolveTrackedProps,
} from "../../services/api";
import { buildResultsReport } from "../../utils/reportBuilders";
import {
  RESULTS_LEAGUE_TABS,
  RESULTS_STATUS_FILTERS,
  AWAITING_STATS_LABEL,
  buildKeyTakeaways,
  computeAccuracySummary,
  computePendingCheckSummary,
  computeVisibleResultsSlates,
  filterCourtEdgeTrackedProps,
  filterResultsPropsCompound,
  formatResultsAwaitingStatsReason,
  formatResultsSlateLabel,
  getTrackedPropStatus,
  groupResultsPropsByGame,
  groupResultsPropsByGameState,
  countNewlyGradedPropsOnSlate,
  pickResolveCheckMessage,
  type ResolveCheckStatus,
  splitResultsPropsByTrackingType,
  summarizeTrackingTypeCounts,
  isReaderOfficialDemotedProp,
  isReaderUncertainTestProp,
  isPriorSlateStillActive,
  formatPriorSlateStillActiveLabel,
  summarizeActiveResultsSlate,
  type ResultsLeagueTab,
  type ResultsStatusFilter,
} from "../../utils/resultsQueue";
import { computeSlateRotation, getTodayLocalDate } from "../../utils/slateRotation";
import { formatPropLabelLine, getPropDisplayLabels } from "../../utils/propLabels";
import {
  buildSlateResultsSnapshot,
  type SlateSnapshotEntry,
} from "../../utils/slateResultsSnapshot";

function SnapshotPropLine({ entry }: { entry: SlateSnapshotEntry }) {
  return (
    <View style={styles.snapshotLineRow}>
      <Text style={styles.snapshotLineText}>{entry.formattedLine}</Text>
      <View style={styles.snapshotBadgeRow}>
        {entry.isTopPick ? <Text style={styles.topPickMiniBadge}>TOP</Text> : null}
        {entry.bestSixRank ? (
          <Text style={styles.bestSixMiniBadge}>B6 #{entry.bestSixRank}</Text>
        ) : null}
        {entry.readerOfficialDemoted ? (
          <Text style={styles.demotedMiniBadge}>DEMOTED</Text>
        ) : null}
      </View>
    </View>
  );
}

function CheckStatusPanel({ status }: { status: ResolveCheckStatus }) {
  const panelStyle = [
    styles.checkStatusPanel,
    status.type === "success" && styles.checkStatusSuccess,
    status.type === "info" && styles.checkStatusInfo,
    status.type === "warning" && styles.checkStatusWarning,
    status.type === "error" && styles.checkStatusError,
  ];
  const textStyle = [
    styles.checkStatusText,
    status.type === "success" && styles.checkStatusTextSuccess,
    status.type === "info" && styles.checkStatusTextInfo,
    status.type === "warning" && styles.checkStatusTextWarning,
    status.type === "error" && styles.checkStatusTextError,
  ];

  return (
    <View style={panelStyle}>
      <Text style={textStyle}>{status.message}</Text>
    </View>
  );
}

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

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function ResultsScreen() {
  const [trackedProps, setTrackedProps] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [leagueTab, setLeagueTab] = useState<ResultsLeagueTab>("WNBA");
  const [statusFilter, setStatusFilter] = useState<ResultsStatusFilter>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastResolveSummary, setLastResolveSummary] = useState<any>(null);
  const [checkStatus, setCheckStatus] = useState<ResolveCheckStatus | null>(null);
  const [lockedSlates, setLockedSlates] = useState<any[]>([]);
  const [todayLocalDate, setTodayLocalDate] = useState(() => getTodayLocalDate());
  const [honestEmptyCopy, setHonestEmptyCopy] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [trackedData, reportData, lockedData] = await Promise.all([
        fetchTrackedProps(),
        fetchDailySlateReports(),
        fetchLockedSlates(),
      ]);

      setTrackedProps(trackedData.props || []);
      setHonestEmptyCopy(trackedData.honestEmptyCopy || null);
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
      const beforeVisible = computeVisibleResultsSlates(
        trackedProps,
        reports,
        getTodayLocalDate(),
        lockedSlates
      );
      const activeDateBefore =
        beforeVisible[0]?.slateDate || activeResultsSummary.activeSlateDate;
      setCheckStatus({
        message: activeDateBefore
          ? `Checking ${activeDateBefore} slate pending results...`
          : "Checking pending results...",
        type: "info",
      });

      const resolved = await resolveTrackedProps({ requireLikelyFinished: false });
      const nextTracked = resolved.props?.length ? resolved.props : trackedProps;
      if (resolved.props?.length) {
        setTrackedProps(resolved.props);
      }

      const activeSlateGradedCount = countNewlyGradedPropsOnSlate(
        nextTracked,
        beforeVisible[0]?.props || [],
        activeDateBefore
      );
      setLastResolveSummary({
        ...(resolved.summary || {}),
        activeSlateGradedCount,
      });

      await buildDailySlateReports();
      const reportData = await fetchDailySlateReports();
      const nextReports = reportData.reports || [];
      setReports(nextReports);

      const afterVisible = computeVisibleResultsSlates(
        nextTracked,
        nextReports,
        getTodayLocalDate(),
        lockedSlates
      );
      const afterRotation = computeSlateRotation(nextReports, {
        lockedSlates,
        trackedProps: nextTracked,
      });
      const scopedAfter = activeDateBefore
        ? afterVisible.filter((slate) => slate.slateDate === activeDateBefore)
        : afterVisible;
      const afterAccuracy = computeAccuracySummary(scopedAfter);
      setCheckStatus(
        pickResolveCheckMessage({
          beforeVisible,
          afterVisible,
          afterRotation,
          gradedCount: resolved.summary?.gradedCount ?? 0,
          awaitingStatsCount: afterAccuracy.awaitingStats,
          activeResultsSlateDate: activeDateBefore,
          gradedCountForActiveSlate: activeSlateGradedCount,
        })
      );
    } catch (err) {
      console.log("RESOLVE RESULTS ERROR:", err);
      setCheckStatus({ message: String(err), type: "error" });
    } finally {
      setResolving(false);
    }
  };

  const isSlateLocked = (slateDate: string) =>
    lockedSlates.some((entry) => entry.slateDate === slateDate);

  useFocusEffect(
    useCallback(() => {
      setTodayLocalDate(getTodayLocalDate());
      loadData();
    }, [])
  );

  const courtEdgeTrackedProps = useMemo(
    () => filterCourtEdgeTrackedProps(trackedProps),
    [trackedProps]
  );

  const visibleSlates = useMemo(
    () =>
      computeVisibleResultsSlates(
        courtEdgeTrackedProps,
        reports,
        todayLocalDate,
        lockedSlates
      ),
    [courtEdgeTrackedProps, reports, todayLocalDate, lockedSlates]
  );

  const activeResultsSummary = useMemo(
    () =>
      summarizeActiveResultsSlate(
        courtEdgeTrackedProps,
        reports,
        todayLocalDate,
        lockedSlates
      ),
    [courtEdgeTrackedProps, reports, todayLocalDate, lockedSlates]
  );

  const priorSlateStillActive = isPriorSlateStillActive(
    activeResultsSummary.activeSlateDate,
    todayLocalDate
  );

  const filteredSlates = useMemo(() => {
    return visibleSlates.map((slate) => ({
      ...slate,
      props: filterResultsPropsCompound(slate.props, leagueTab, statusFilter),
    }));
  }, [visibleSlates, leagueTab, statusFilter]);

  const trackingTypeCounts = useMemo(
    () => summarizeTrackingTypeCounts(visibleSlates.flatMap((s) => s.props)),
    [visibleSlates]
  );

  const readerDemotedAccuracy = useMemo(() => {
    const demoted = visibleSlates.flatMap((s) =>
      s.props.filter(isReaderOfficialDemotedProp)
    );
    return computeAccuracySummary(
      [{ slateDate: "all", props: demoted, summary: {}, leagues: [], rotation: {} as any, isComplete: false }],
      { recordType: "all" }
    );
  }, [visibleSlates]);

  const readerUncertainAccuracy = useMemo(() => {
    const uncertain = visibleSlates.flatMap((s) =>
      s.props.filter(isReaderUncertainTestProp)
    );
    return computeAccuracySummary(
      [{ slateDate: "all", props: uncertain, summary: {}, leagues: [], rotation: {} as any, isComplete: false }],
      { recordType: "all" }
    );
  }, [visibleSlates]);

  const accuracySummary = useMemo(
    () => computeAccuracySummary(visibleSlates, { recordType: "official" }),
    [visibleSlates]
  );

  const testAccuracySummary = useMemo(
    () => computeAccuracySummary(visibleSlates, { recordType: "test" }),
    [visibleSlates]
  );

  const trackedSummary = useMemo(
    () => computeAccuracySummary(visibleSlates, { recordType: "all" }),
    [visibleSlates]
  );

  const leagueTrackedCounts = useMemo(() => {
    const props = visibleSlates.flatMap((s) => s.props);
    return {
      nba: props.filter((p) => String(p.league || "").toUpperCase() === "NBA").length,
      wnba: props.filter((p) => String(p.league || "").toUpperCase() === "WNBA").length,
    };
  }, [visibleSlates]);

  const pendingCheckSummary = useMemo(
    () => computePendingCheckSummary(lastResolveSummary, visibleSlates),
    [lastResolveSummary, visibleSlates]
  );

  const slateRotation = useMemo(
    () =>
      computeSlateRotation(reports, {
        lockedSlates,
        trackedProps,
        today: todayLocalDate,
      }),
    [reports, lockedSlates, trackedProps, todayLocalDate]
  );

  const bestSixCapStatus = useMemo(() => {
    const wnba = leagueTrackedCounts.wnba;
    const nba = leagueTrackedCounts.nba;
    const wnbaOver = wnba > 6;
    const nbaOver = nba > 6;
    if (wnbaOver || nbaOver) {
      return `Best 6 cap exceeded — WNBA ${wnba}/6, NBA ${nba}/6 (pre-cap data; next refresh prunes)`;
    }
    return `Best 6 cap OK — WNBA ${wnba}/6, NBA ${nba}/6`;
  }, [leagueTrackedCounts]);

  const slateSnapshot = useMemo(() => {
    const activeDate = activeResultsSummary.activeSlateDate;
    if (!activeDate) return null;
    const props = visibleSlates
      .filter((s) => s.slateDate === activeDate)
      .flatMap((s) => s.props);
    return buildSlateResultsSnapshot(props, { slateDate: activeDate });
  }, [visibleSlates, activeResultsSummary.activeSlateDate]);

  const keyTakeaways = useMemo(
    () =>
      buildKeyTakeaways(accuracySummary, {
        slateDate: activeResultsSummary.activeSlateDate,
        rotation: slateRotation,
        reports,
      }),
    [accuracySummary, activeResultsSummary.activeSlateDate, slateRotation, reports]
  );

  const getReportText = () =>
    buildResultsReport({
      visibleSlates,
      filteredSlates,
      filter: leagueTab === "All" ? statusFilter : `${leagueTab} · ${statusFilter}`,
      loading,
      refreshing,
      lastResolveSummary,
      resolveCheckMessage: checkStatus?.message ?? null,
      error: loadError,
    });

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
          <Text style={styles.subtitle}>Active Slate Grading Queue</Text>
          <Text style={styles.motto}>
            Tracks the full eligible slate cohort. Top Props badges are spotlight references only.
          </Text>
        </View>

        <View style={styles.actionRow}>
          <CopyReportButton
            getReportText={getReportText}
            label="Copy Results Report"
            style={styles.actionRowItem}
            slateDate={activeResultsSummary.activeSlateDate}
          />
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.actionRowItem,
              (refreshing || resolving) && styles.actionBtnDisabled,
            ]}
            onPress={handleResolveAll}
            disabled={loading || refreshing || resolving}
          >
            <Text style={styles.actionBtnText}>
              {resolving ? "Checking..." : "Check Pending Results"}
            </Text>
          </TouchableOpacity>
        </View>

        {checkStatus ? <CheckStatusPanel status={checkStatus} /> : null}

        <View style={styles.dashboardCard}>
          <Text style={styles.dashboardTitle}>Tracked Slate Summary</Text>
          <Text style={styles.currentSlateLabel}>
            {activeResultsSummary.activeSlateDate
              ? `${formatResultsSlateLabel(activeResultsSummary.activeSlateDate)} — ${trackedSummary.total} tracked`
              : `Today (${todayLocalDate}) — no active Results slate`}
          </Text>
          {!activeResultsSummary.activeSlateDate && honestEmptyCopy ? (
            <Text style={styles.cohortNote}>{honestEmptyCopy}</Text>
          ) : null}
          <Text style={styles.trackingBreakdown}>
            Total Tracked Props: {trackedSummary.total}
            {" • "}
            NBA Tracked: {leagueTrackedCounts.nba}
            {" • "}
            WNBA Tracked: {leagueTrackedCounts.wnba}
            {" • "}
            Official: {trackingTypeCounts.official}
            {" • "}
            Test / Learning: {trackingTypeCounts.test}
            {" • "}
            Reader Official Demoted TEST: {trackingTypeCounts.readerOfficialDemoted}
            {" • "}
            Reader Uncertain TEST: {trackingTypeCounts.readerUncertainTest}
          </Text>
          <Text style={styles.cohortNote}>{bestSixCapStatus}</Text>
          <Text style={styles.cohortNote}>
            Controlled Best 6 cohort — up to 6 NBA + 6 WNBA tracked per active slate.
          </Text>
          {accuracySummary.total === 0 && testAccuracySummary.total > 0 ? (
            <Text style={styles.noOfficialNote}>No Official Plays Found</Text>
          ) : null}
          {priorSlateStillActive ? (
            <Text style={styles.priorSlateNote}>
              {formatPriorSlateStillActiveLabel(activeResultsSummary.activeSlateDate)}
            </Text>
          ) : null}
          <View style={styles.accuracyGrid}>
            <SummaryBox label="Total Tracked" value={trackedSummary.total} color="#e2e8f0" />
            <SummaryBox label="Official" value={trackingTypeCounts.official} color="#f8fafc" />
            <SummaryBox label="Test / Learning" value={trackingTypeCounts.test} color="#ddd6fe" />
            <SummaryBox
              label="Demoted TEST"
              value={trackingTypeCounts.readerOfficialDemoted}
              color="#a78bfa"
            />
            <SummaryBox
              label="Uncertain TEST"
              value={trackingTypeCounts.readerUncertainTest}
              color="#c4b5fd"
            />
            <SummaryBox label="Graded" value={trackedSummary.graded} color="#22c55e" />
            <SummaryBox label="Pending" value={trackedSummary.pending} color="#93c5fd" />
            <SummaryBox
              label="Awaiting Stats"
              value={trackedSummary.awaitingStats}
              color="#f97316"
            />
            <SummaryBox label="Record" value={`${accuracySummary.wins}-${accuracySummary.losses}-${accuracySummary.pushes}`} color="#e2e8f0" />
            <SummaryBox label="Win Rate" value={accuracySummary.winRateLabel} color="#e2e8f0" />
          </View>
        </View>

        {slateSnapshot && !slateSnapshot.snapshotMissing ? (
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardTitle}>Slate Results Snapshot</Text>
            <Text style={styles.currentSlateLabel}>
              {slateSnapshot.winsCount}W / {slateSnapshot.lossesCount}L / {slateSnapshot.pushesCount}P graded
            </Text>
            {slateSnapshot.biggestWins.length > 0 ? (
              <>
                <Text style={styles.snapshotSectionLabel}>Biggest Wins</Text>
                {slateSnapshot.biggestWins.map((entry) => (
                  <SnapshotPropLine key={`win-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : null}
            {slateSnapshot.winningProps.length > slateSnapshot.biggestWins.length ? (
              <>
                <Text style={styles.snapshotSectionLabel}>All Winning Props</Text>
                {slateSnapshot.winningProps.map((entry) => (
                  <SnapshotPropLine key={`allwin-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : null}
            {slateSnapshot.biggestMisses.length > 0 ? (
              <>
                <Text style={styles.snapshotSectionLabel}>Biggest Misses</Text>
                {slateSnapshot.biggestMisses.map((entry) => (
                  <SnapshotPropLine key={`loss-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : null}
            {slateSnapshot.losingProps.length > slateSnapshot.biggestMisses.length ? (
              <>
                <Text style={styles.snapshotSectionLabel}>All Losing Props</Text>
                {slateSnapshot.losingProps.map((entry) => (
                  <SnapshotPropLine key={`allloss-${entry.trackedKey || entry.player}`} entry={entry} />
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {(trackingTypeCounts.readerOfficialDemoted > 0 ||
          trackingTypeCounts.readerUncertainTest > 0) ? (
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardTitle}>Test / Learning Detail</Text>
            {trackingTypeCounts.readerOfficialDemoted > 0 ? (
              <Text style={styles.currentSlateLabel}>
                {trackingTypeCounts.readerOfficialDemoted} reader-official-demoted TEST props
              </Text>
            ) : null}
            {trackingTypeCounts.readerUncertainTest > 0 ? (
              <Text style={styles.currentSlateLabel}>
                {trackingTypeCounts.readerUncertainTest} reader-uncertain TEST props — stricter quality gate
              </Text>
            ) : null}
            <View style={styles.accuracyGrid}>
              <SummaryBox
                label="Demoted TEST"
                value={trackingTypeCounts.readerOfficialDemoted}
                color="#a78bfa"
              />
              <SummaryBox
                label="Demoted Graded"
                value={readerDemotedAccuracy.graded}
                color="#22c55e"
              />
              <SummaryBox
                label="Uncertain TEST"
                value={trackingTypeCounts.readerUncertainTest}
                color="#c4b5fd"
              />
              <SummaryBox
                label="Uncertain Graded"
                value={readerUncertainAccuracy.graded}
                color="#22c55e"
              />
            </View>
          </View>
        ) : null}

        {pendingCheckSummary ? (
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardTitle}>Pending Check Summary</Text>
            <View style={styles.pendingCheckGrid}>
              <SummaryBox label="Checked" value={pendingCheckSummary.checked} color="#e2e8f0" />
              <SummaryBox label="Graded" value={pendingCheckSummary.graded} color="#22c55e" />
              <SummaryBox
                label="Still Pending"
                value={pendingCheckSummary.stillPending}
                color="#93c5fd"
              />
              <SummaryBox
                label="Awaiting Stats"
                value={pendingCheckSummary.awaitingStats}
                color="#f97316"
              />
            </View>
          </View>
        ) : null}

        {keyTakeaways.length > 0 ? (
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardTitle}>Key Takeaways</Text>
            {keyTakeaways.map((line) => (
              <Text key={line} style={styles.takeawayLine}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.leagueTabRow}>
          {RESULTS_LEAGUE_TABS.map((tab) => {
            const isActive = leagueTab === tab;
            const accent =
              tab === "WNBA"
                ? { border: "#f472b6", bg: "#500724", text: "#fbcfe8" }
                : tab === "NBA"
                  ? { border: "#60a5fa", bg: "#1e3a8a", text: "#dbeafe" }
                  : { border: "#22c55e", bg: "#14532d", text: "#bbf7d0" };
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setLeagueTab(tab)}
                style={[
                  styles.leagueTabButton,
                  isActive && {
                    borderColor: accent.border,
                    backgroundColor: accent.bg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.leagueTabText,
                    isActive && { color: accent.text },
                  ]}
                >
                  {tab === "All" ? "All Leagues" : tab}
                </Text>
              </TouchableOpacity>
            );
          })}
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

        {loading ? <Text style={styles.loadingText}>Loading grading queue...</Text> : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Backend connection error</Text>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : null}

        {visibleSlates.map((slate) => {
          const slateSummary = slate.summary;
          const slateFiltered =
            filteredSlates.find((item) => item.slateDate === slate.slateDate)?.props ||
            [];
          const {
            official: officialProps,
            readerOfficialDemoted: demotedTestProps,
            readerUncertainTest: uncertainTestProps,
            test: testProps,
          } = splitResultsPropsByTrackingType(slateFiltered);
          const locked = isSlateLocked(slate.slateDate);
          const officialGameStateGroups = groupResultsPropsByGameState(officialProps);

          const renderPropCard = (prop: any, index: number) => {
            const status = getTrackedPropStatus(prop);
            const displayStatus = status.toLowerCase();
            const labels = getPropDisplayLabels(prop);
            const awaitingLabel = formatResultsAwaitingStatsReason(prop);

            return (
              <View
                key={prop.trackedId || prop.trackedKey || `${prop.player}-${index}`}
                style={[
                  styles.propCard,
                  status === "Win" && styles.winCard,
                  status === "Loss" && styles.lossCard,
                  status === "Awaiting stats" && styles.failedCard,
                ]}
              >
                <View style={styles.propHeader}>
                  <StatusBadge status={status} />
                  <Text style={styles.propRank}>#{prop.rank ?? index + 1}</Text>
                </View>
                <View style={styles.labelRow}>
                  {labels.badges.map((badge) => (
                    <View key={`${prop.trackedKey}-${badge}`} style={styles.labelChip}>
                      <Text style={styles.labelChipText}>{badge}</Text>
                    </View>
                  ))}
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
                    {prop.currentEngineSide || prop.side}{" "}
                    {safeDisplay(prop.officialLine ?? prop.line)}{" "}
                    {prop.stat || "Points"} — {status}
                  </Text>
                  {prop.officialLine !== undefined &&
                  prop.latestLine !== undefined &&
                  num(prop.latestLine) !== num(prop.officialLine) ? (
                    <Text style={styles.lineMovement}>
                      Official {safeDisplay(prop.officialLine)} → Latest{" "}
                      {safeDisplay(prop.latestLine)}
                    </Text>
                  ) : null}
                  {Array.isArray(prop.lineHistory) && prop.lineHistory.length > 0 ? (
                    <Text style={styles.propDetail}>
                      Line history:{" "}
                      {prop.lineHistory
                        .slice(-3)
                        .map((move: any) => `${move.from}→${move.to}`)
                        .join(" • ")}
                    </Text>
                  ) : null}
                  <ResultMarginText pick={prop} />
                  <Text style={styles.propDetail}>{formatPropLabelLine(prop)}</Text>
                  {prop.lineMovement ? (
                    <Text style={styles.lineMovement}>
                      Line moved {prop.lineMovement.from} → {prop.lineMovement.to}
                    </Text>
                  ) : null}
                  {awaitingLabel ? (
                    <Text style={styles.pendingReason}>{awaitingLabel}</Text>
                  ) : null}
                  {prop.flippedFromSide || prop.sideRescueFlipped ? (
                    <Text style={styles.flipNote}>
                      Flipped from{" "}
                      {prop.flippedFromSideLabel ||
                        (String(prop.flippedFromSide || prop.initialSide || "")
                          .toUpperCase()
                          .startsWith("O")
                          ? "Over"
                          : "Under")}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          };

          const renderGameStateSection = (
            title: string,
            props: any[],
            note?: string
          ) => {
            if (!props.length) return null;
            const byGame = groupResultsPropsByGame(props);

            return (
              <View style={styles.gameStateSection}>
                <Text style={styles.gameStateTitle}>{title}</Text>
                {note ? <Text style={styles.gameStateNote}>{note}</Text> : null}
                {[...byGame.entries()].map(([game, gameProps]) => (
                  <View key={`${slate.slateDate}-${title}-${game}`} style={styles.gameGroup}>
                    <Text style={styles.gameGroupTitle}>{game}</Text>
                    {gameProps.map((prop, index) => renderPropCard(prop, index))}
                  </View>
                ))}
              </View>
            );
          };

          return (
            <View key={slate.slateDate} style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Slate — {formatResultsSlateLabel(slate.slateDate)}</Text>
              <Text style={styles.slateMeta}>
                {(slate.leagues || []).join(" • ") || "—"} • {slateSummary?.total ?? 0} tracked
                {" • "}
                Official: {summarizeTrackingTypeCounts(slateFiltered).official}
                {" • "}
                Demoted TEST: {summarizeTrackingTypeCounts(slateFiltered).readerOfficialDemoted}
                {" • "}
                Uncertain TEST: {summarizeTrackingTypeCounts(slateFiltered).readerUncertainTest}
                {locked ? " • 🔒 LOCKED" : ""}
              </Text>

              {renderGameStateSection(
                "Official — Graded",
                officialGameStateGroups.graded
              )}
              {renderGameStateSection(
                "Official — Final — Awaiting Stats",
                officialGameStateGroups.awaitingStats,
                AWAITING_STATS_LABEL
              )}
              {renderGameStateSection(
                "Official — Live / Upcoming",
                officialGameStateGroups.livePending
              )}
              {officialProps.length === 0 && testProps.length > 0 ? (
                <Text style={styles.noOfficialNote}>No Official Plays Found</Text>
              ) : null}
              {testProps.length > 0 ? (
                <>
                  {demotedTestProps.length > 0 ? (
                    <>
                      <Text style={styles.testSectionTitle}>
                        Reader Official Demoted — TEST
                      </Text>
                      {renderGameStateSection(
                        "Demoted TEST — Graded",
                        groupResultsPropsByGameState(demotedTestProps).graded
                      )}
                      {renderGameStateSection(
                        "Demoted TEST — Awaiting Stats",
                        groupResultsPropsByGameState(demotedTestProps).awaitingStats,
                        AWAITING_STATS_LABEL
                      )}
                      {renderGameStateSection(
                        "Demoted TEST — Live / Upcoming",
                        groupResultsPropsByGameState(demotedTestProps).livePending
                      )}
                    </>
                  ) : null}
                  {uncertainTestProps.length > 0 ? (
                    <>
                      <Text style={styles.testSectionTitle}>
                        Reader Uncertain — TEST
                      </Text>
                      {renderGameStateSection(
                        "Uncertain TEST — Graded",
                        groupResultsPropsByGameState(uncertainTestProps).graded
                      )}
                      {renderGameStateSection(
                        "Uncertain TEST — Awaiting Stats",
                        groupResultsPropsByGameState(uncertainTestProps).awaitingStats,
                        AWAITING_STATS_LABEL
                      )}
                      {renderGameStateSection(
                        "Uncertain TEST — Live / Upcoming",
                        groupResultsPropsByGameState(uncertainTestProps).livePending
                      )}
                    </>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}

        {!loading && !loadError && visibleSlates.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active Results slate</Text>
            <Text style={styles.emptyText}>
              {activeResultsSummary.activeSlateDate
                ? `Active slate ${formatResultsSlateLabel(activeResultsSummary.activeSlateDate)} has no tracked props yet.`
                : `No active Results cohort for ${formatResultsSlateLabel(todayLocalDate)}. Home Selected/Tracked counts Best 6 board display flags — Results only shows sealed official admission. See Prop Lab for completed slates.`}
              {" "}Legacy tracked props remain stored on the server but hidden from Results.
            </Text>
          </View>
        ) : null}
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
  dashboardCard: {
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 14,
  },
  dashboardTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
  },
  currentSlateLabel: {
    color: "#facc15",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 10,
  },
  trackingBreakdown: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
    lineHeight: 18,
  },
  cohortNote: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 10,
    lineHeight: 16,
  },
  snapshotSectionLabel: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 12,
    marginBottom: 6,
  },
  snapshotLineRow: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  snapshotLineText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  snapshotBadgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  topPickMiniBadge: {
    color: "#fbbf24",
    fontSize: 10,
    fontWeight: "900",
  },
  bestSixMiniBadge: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
  },
  demotedMiniBadge: {
    color: "#a78bfa",
    fontSize: 10,
    fontWeight: "900",
  },
  priorSlateNote: {
    color: "#fdba74",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
    lineHeight: 18,
  },
  noOfficialNote: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
  },
  testSectionTitle: {
    color: "#c4b5fd",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 12,
    marginBottom: 8,
  },
  accuracyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pendingCheckGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  takeawayLine: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 6,
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
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  actionRowItem: {
    flex: 1,
    marginTop: 0,
    marginBottom: 0,
  },
  actionBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: "center",
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 17,
    textAlign: "center",
  },
  checkStatusPanel: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  checkStatusSuccess: {
    backgroundColor: "#14532d",
    borderColor: "#22c55e",
  },
  checkStatusInfo: {
    backgroundColor: "#172554",
    borderColor: "#3b82f6",
  },
  checkStatusWarning: {
    backgroundColor: "#451a03",
    borderColor: "#f59e0b",
  },
  checkStatusError: {
    backgroundColor: "#450a0a",
    borderColor: "#ef4444",
  },
  checkStatusText: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  checkStatusTextSuccess: {
    color: "#bbf7d0",
  },
  checkStatusTextInfo: {
    color: "#bfdbfe",
  },
  checkStatusTextWarning: {
    color: "#fde68a",
  },
  checkStatusTextError: {
    color: "#fecaca",
  },
  filterRow: {
    marginBottom: 14,
  },
  filterContent: {
    gap: 8,
    paddingRight: 8,
  },
  leagueTabRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  leagueTabButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0f172a",
    paddingVertical: 12,
    alignItems: "center",
  },
  leagueTabText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "900",
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
  errorCard: {
    backgroundColor: "#450a0a",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ef4444",
    marginBottom: 14,
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
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
  labelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
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
  lineMovement: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  pendingReason: {
    color: "#fdba74",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  flipNote: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  gameStateSection: {
    marginTop: 12,
    marginBottom: 8,
  },
  gameStateTitle: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 4,
  },
  gameStateNote: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
  },
  gameGroup: {
    marginBottom: 10,
  },
  gameGroupTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  lockBtn: {
    backgroundColor: "#713f12",
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  lockBtnText: {
    color: "#fef3c7",
    fontWeight: "900",
    fontSize: 14,
    textAlign: "center",
  },
});
