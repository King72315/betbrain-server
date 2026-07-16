import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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

import CopyReportButton from "../../components/CopyReportButton";
import PropCard, { ResultMarginText, safeDisplay } from "../../components/PropCard";
import {
  fetchDailySlateReports,
  fetchHistoryArchives,
  fetchPickHistory,
  fetchTrackedProps,
  resetHistoryArchives,
} from "../../services/api";
import {
  HISTORY_FILTERS,
  buildHistoryEntries,
  filterHistoryEntries,
  formatRecordLine,
  formatSlateDateLabel,
  getPickStatus,
  type HistoryEntry,
  type HistoryFilter,
} from "../../utils/historyArchive";
import {
  HISTORY_RETENTION_DAYS,
  applyHistoryRetentionFilters,
  clearHistoryDisplay,
  loadHistoryDisplayClear,
  type HistoryDisplayClear,
} from "../../utils/historyRetention";
import { buildHistoryReport } from "../../utils/reportBuilders";
import { computeSlateRotation, filterValidDailyReports } from "../../utils/slateRotation";
import {
  formatSignalRecord,
  type HistoryThreeSlateGroups,
  type ThreeSlateGroup,
} from "../../utils/signalPerformance";

function TypeBadge({ type, archiveLabel }: { type: HistoryEntry["type"]; archiveLabel?: string | null }) {
  const isSaved = type === "saved-picks";
  return (
    <View style={[styles.typeBadge, isSaved ? styles.typeSaved : styles.typeOfficial]}>
      <Text style={styles.typeBadgeText}>
        {isSaved ? "SAVED PICKS" : archiveLabel || "ARCHIVED LAB"}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || "").toUpperCase();
  const isFinal =
    normalized === "FINAL" || normalized === "GRADED" || normalized === "COMPLETE";
  const isReportOnly = normalized === "REPORT BUILT";

  return (
    <View
      style={[
        styles.statusBadge,
        isFinal ? styles.statusFinal : isReportOnly ? styles.statusReportOnly : styles.statusProgress,
      ]}
    >
      <Text style={styles.statusBadgeText}>{normalized.replace(/_/g, " ")}</Text>
    </View>
  );
}

function HistoryEntryCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gradedPicks = entry.picks.filter((pick) =>
    ["Win", "Loss", "Push"].includes(getPickStatus(pick))
  );

  const engine = entry.hasGradedPerformance
    ? entry.reportSummary?.engineScorecard || entry.reportSummary?.sections?.G
    : null;
  const lesson = entry.hasGradedPerformance
    ? entry.reportSummary?.slateLesson || entry.reportSummary?.sections?.J
    : null;
  const showPerformance = entry.hasGradedPerformance;

  return (
    <View style={styles.entryCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
        <View style={styles.entryHeader}>
          <View style={styles.entryHeaderLeft}>
            <Text style={styles.entryDate}>{formatSlateDateLabel(entry.slateDate)}</Text>
            <Text style={styles.entryLeague}>
              {(entry.leagues || []).join(" • ") || "—"}
            </Text>
          </View>
          <Text style={styles.expandHint}>{expanded ? "▲" : "▼"}</Text>
        </View>

        <View style={styles.entryBadgeRow}>
          <TypeBadge type={entry.type} archiveLabel={entry.archiveLabel} />
          <StatusBadge status={entry.status} />
        </View>

        <Text
          style={[
            styles.entryRecord,
            !showPerformance && entry.emptyLabel ? styles.entryEmptyLabel : null,
          ]}
        >
          {formatRecordLine(entry)}
        </Text>
        <Text style={styles.entryMeta}>
          {showPerformance
            ? `Graded ${entry.graded}/${entry.total}${entry.pending > 0 ? ` • Pending ${entry.pending}` : ""}`
            : `Tracked: ${entry.total}${entry.pending > 0 ? ` • Pending ${entry.pending}` : ""}`}
        </Text>

        {entry.topLesson && showPerformance ? (
          <Text style={styles.entryLesson} numberOfLines={expanded ? undefined : 2}>
            Lesson: {entry.topLesson}
          </Text>
        ) : null}
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.entryDetails}>
          {!showPerformance && entry.emptyLabel ? (
            <Text
              style={[
                styles.emptyArchiveNote,
                entry.metadataOnly ? styles.emptyArchiveError : null,
              ]}
            >
              {entry.emptyLabel}
            </Text>
          ) : null}

          {lesson ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailTitle}>Slate Lesson</Text>
              {lesson.headline ? (
                <Text style={styles.lessonHeadline}>{lesson.headline}</Text>
              ) : null}
              {lesson.body ? <Text style={styles.lessonBody}>{lesson.body}</Text> : null}
              {(lesson.bullets || []).map((bullet: string, index: number) => (
                <Text key={index} style={styles.lessonBullet}>
                  • {bullet}
                </Text>
              ))}
            </View>
          ) : null}

          {engine?.engines?.length ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailTitle}>Engine Scorecard</Text>
              {engine.engines.slice(0, 4).map((item: any) => (
                <Text key={item.engine} style={styles.engineLine}>
                  {item.engine}: {item.record} ({item.winRate ?? "—"}%) — {item.status}
                </Text>
              ))}
            </View>
          ) : null}

          {gradedPicks.length > 0 ? (
            <View style={styles.detailBlock}>
              <Text style={styles.detailTitle}>
                {entry.type === "saved-picks" ? "Graded Picks" : "Official Props"}
              </Text>
              {gradedPicks.map((pick, index) => (
                <View
                  key={`${entry.id}-${pick.id || pick.pickKey || pick.player}-${index}`}
                  style={[
                    styles.pickCard,
                    getPickStatus(pick) === "Win" && styles.winCard,
                    getPickStatus(pick) === "Loss" && styles.lossCard,
                    getPickStatus(pick) === "Push" && styles.pushCard,
                  ]}
                >
                  <PropCard pick={pick} index={index} />
                  <View style={styles.pickMeta}>
                    <Text style={styles.pickLine}>
                      {pick.side || pick.pick} {safeDisplay(pick.line ?? pick.sportsbookLine)}{" "}
                      {pick.stat || "Points"} — {getPickStatus(pick)}
                    </Text>
                    <ResultMarginText pick={pick} />
                    <Text style={styles.pickDetail}>
                      Conf {safeDisplay(pick.confidence ?? pick.winProbability)}% • Risk{" "}
                      {pick.riskLabel || "—"} • Tier{" "}
                      {String(pick.tier || "WATCHLIST").toUpperCase()}
                    </Text>
                    {pick.bookCount !== undefined ? (
                      <Text style={styles.pickDetail}>Books: {safeDisplay(pick.bookCount)}</Text>
                    ) : null}
                    {pick.dataMode ? (
                      <Text style={styles.pickDetail}>Data Mode: {pick.dataMode}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptySmall}>No graded pick detail on this archive entry.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function History() {
  const [trackedProps, setTrackedProps] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [archives, setArchives] = useState<any[]>([]);
  const [rotationMeta, setRotationMeta] = useState<{
    currentLabSlateDate: string | null;
    historySlateDates: string[];
  }>({
    currentLabSlateDate: null,
    historySlateDates: [],
  });
  const [filter, setFilter] = useState<HistoryFilter>("All");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayClear, setDisplayClear] = useState<HistoryDisplayClear | null>(null);
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [historyThreeSlateGroups, setHistoryThreeSlateGroups] =
    useState<HistoryThreeSlateGroups | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadHistoryDisplayClear().then(setDisplayClear);
  }, []);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const [pickData, reportData, archiveData, trackedData] = await Promise.all([
        fetchPickHistory(),
        fetchDailySlateReports(),
        fetchHistoryArchives(),
        fetchTrackedProps(),
      ]);

      setPicks(pickData.picks || []);
      setReports(filterValidDailyReports(reportData.reports || []));
      setArchives(archiveData.archives || []);
      setTrackedProps(trackedData.props || []);
      setRotationMeta({
        currentLabSlateDate: reportData.currentLabSlateDate || null,
        historySlateDates: reportData.historySlateDates || [],
      });
      setHistoryThreeSlateGroups(
        archiveData.historyThreeSlateGroups || reportData.historyThreeSlateGroups || null
      );
      setLoadError(null);
    } catch (err) {
      console.log("LOAD HISTORY ERROR:", err);
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const refreshHistory = async () => {
    try {
      setRefreshing(true);
      const [pickData, reportData, archiveData, trackedData] = await Promise.all([
        fetchPickHistory(),
        fetchDailySlateReports(),
        fetchHistoryArchives(),
        fetchTrackedProps(),
      ]);

      setPicks(pickData.picks || []);
      setReports(filterValidDailyReports(reportData.reports || []));
      setArchives(archiveData.archives || []);
      setTrackedProps(trackedData.props || []);
      setRotationMeta({
        currentLabSlateDate: reportData.currentLabSlateDate || null,
        historySlateDates: reportData.historySlateDates || [],
      });
      setHistoryThreeSlateGroups(
        archiveData.historyThreeSlateGroups || reportData.historyThreeSlateGroups || null
      );
    } catch (err) {
      console.log("REFRESH HISTORY ERROR:", err);
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  const rotation = useMemo(() => {
    const base = computeSlateRotation(reports, { archives, trackedProps });
    return {
      ...base,
      currentLabSlateDate:
        rotationMeta.currentLabSlateDate ?? base.currentLabSlateDate,
      historySlateDates:
        rotationMeta.historySlateDates.length > 0
          ? rotationMeta.historySlateDates
          : base.historySlateDates,
    };
  }, [reports, archives, trackedProps, rotationMeta]);

  const entries = useMemo(
    () =>
      buildHistoryEntries(picks, reports, trackedProps, archives, {
        historySlateDates: rotation.historySlateDates,
        currentLabSlateDate: rotation.currentLabSlateDate,
      }),
    [picks, reports, trackedProps, archives, rotation.historySlateDates, rotation.currentLabSlateDate]
  );

  const retainedEntries = useMemo(
    () =>
      applyHistoryRetentionFilters(entries, {
        currentLabSlateDate: rotation.currentLabSlateDate,
        displayClear,
      }),
    [entries, rotation.currentLabSlateDate, displayClear]
  );

  const filteredEntries = useMemo(
    () => filterHistoryEntries(retainedEntries, filter),
    [retainedEntries, filter]
  );

  const summary = useMemo(() => {
    const performanceEntries = filteredEntries.filter((entry) => entry.hasGradedPerformance);
    const wins = performanceEntries.reduce((sum, entry) => sum + entry.wins, 0);
    const losses = performanceEntries.reduce((sum, entry) => sum + entry.losses, 0);
    const pushes = performanceEntries.reduce((sum, entry) => sum + entry.pushes, 0);
    const pending = filteredEntries.reduce((sum, entry) => sum + entry.pending, 0);
    const decided = wins + losses;
    const winRate = decided > 0 ? Math.round((wins / decided) * 100) : 0;

    return {
      slates: filteredEntries.length,
      performanceSlates: performanceEntries.length,
      wins,
      losses,
      pushes,
      pending,
      winRate,
      netUnits: wins - losses,
    };
  }, [filteredEntries]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => ({
      ...current,
      [id]: !current[id],
    }));
  };

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const threeSlateGroups = historyThreeSlateGroups?.groups || [];

  const getReportText = () =>
    buildHistoryReport({
      entries: retainedEntries,
      filteredEntries,
      filter,
      loading,
      error: loadError,
      retentionDays: HISTORY_RETENTION_DAYS,
      displayCleared: Boolean(displayClear),
      currentLabSlateDate: rotation.currentLabSlateDate,
    });

  const handleClearHistory = () => {
    Alert.alert(
      "Clear archived History?",
      "This hides archived entries on this device only. Active Results, current Lab, and backend learning data are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Display",
          style: "destructive",
          onPress: async () => {
            try {
              setClearing(true);
              const payload = await clearHistoryDisplay(retainedEntries);
              setDisplayClear(payload);
            } finally {
              setClearing(false);
            }
          },
        },
      ]
    );
  };

  const handleResetHistory = () => {
    Alert.alert(
      "Reset server History archives?",
      "Backs up, clears corrupted history archives, rebuilds ARCHIVED slates (e.g. 06/21), and unsticks Lab rotation. Tracked props and active Results (07/07) are preserved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset History",
          style: "destructive",
          onPress: async () => {
            try {
              setResetting(true);
              const response = await resetHistoryArchives({ confirm: true });
              if (!response.ok) {
                Alert.alert(
                  "History reset failed",
                  response.message ||
                    "Server reset requires admin access. Run `node scripts/resetHistoryArchives.js` on Render shell."
                );
                return;
              }

              setDisplayClear(null);
              await loadHistory();
              Alert.alert(
                "History reset complete",
                `Rebuilt archives: ${(response.result?.after?.historySlateDates || []).join(", ") || "none"}. Lab: ${response.result?.after?.currentLabSlateDate || "empty"}.`
              );
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshHistory} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>📚 History</Text>
          <Text style={styles.subtitle}>CourtEdge Archive Center</Text>
          <Text style={styles.motto}>
            Archived Lab slates (ARCHIVED phase only) and graded saved picks — read-only.
            Server reset rebuilds archives; Clear Display hides entries on this device only.
          </Text>
          <CopyReportButton getReportText={getReportText} label="Copy History Report" />
          <TouchableOpacity
            style={[styles.resetBtn, resetting && styles.clearBtnDisabled]}
            onPress={handleResetHistory}
            disabled={resetting || loading}
          >
            <Text style={styles.resetBtnText}>
              {resetting ? "Resetting..." : "Reset Server History"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.clearBtn, clearing && styles.clearBtnDisabled]}
            onPress={handleClearHistory}
            disabled={clearing || loading || retainedEntries.length === 0}
          >
            <Text style={styles.clearBtnText}>
              {clearing ? "Clearing..." : "Clear History Display"}
            </Text>
          </TouchableOpacity>
          {displayClear ? (
            <Text style={styles.clearNote}>
              Display cleared {formatSlateDateLabel(displayClear.clearedAt.slice(0, 10))}.
              Backend data unchanged.
            </Text>
          ) : null}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Archive Summary</Text>
          <View style={styles.recordGrid}>
            <SummaryBox label="Slates" value={summary.slates} color="#f8fafc" />
            <SummaryBox label="Wins" value={summary.wins} color="#22c55e" />
            <SummaryBox label="Losses" value={summary.losses} color="#ef4444" />
            <SummaryBox label="Pushes" value={summary.pushes} color="#facc15" />
            <SummaryBox label="Win Rate" value={`${summary.winRate}%`} color="#38bdf8" />
            <SummaryBox
              label="Net Units"
              value={`${summary.netUnits > 0 ? "+" : ""}${summary.netUnits}`}
              color={summary.netUnits >= 0 ? "#22c55e" : "#ef4444"}
            />
          </View>
          <Text style={styles.pendingText}>
            Pending across visible slates: {summary.pending}
            {summary.performanceSlates < summary.slates
              ? ` • Performance archive: ${summary.performanceSlates}/${summary.slates}`
              : ""}
            {entries.length > retainedEntries.length
              ? ` • Hidden by clear: ${entries.length - retainedEntries.length}`
              : ""}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {HISTORY_FILTERS.map((item) => (
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

        {threeSlateGroups.length > 0 ? (
          <View style={styles.groupsSection}>
            <Text style={styles.groupsSectionTitle}>3-Slate Signal Learning Blocks</Text>
            <Text style={styles.groupsSectionSubtitle}>
              Evaluate signal performance every 3 completed archived slates — not daily.
            </Text>
            {threeSlateGroups.map((group) => (
              <ThreeSlateGroupCard
                key={group.groupId}
                group={group}
                expanded={Boolean(expandedGroupIds[group.groupId])}
                onToggle={() => toggleGroupExpanded(group.groupId)}
              />
            ))}
          </View>
        ) : null}

        {loading ? <Text style={styles.loadingText}>Loading archive...</Text> : null}

        {!loading && filteredEntries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No archived entries visible.</Text>
            <Text style={styles.emptyText}>
              {rotation.historySlateDates.length > 0
                ? `Server archived slates: ${rotation.historySlateDates.join(", ")}. Tap Reset Server History if Lab is stuck or entries fail to load.`
                : `Graded saved picks and rotated Lab slates appear here after archiving. Use Reset Server History if rotation is stuck on an old Lab slate.`}{" "}
              Current Lab
              {rotation.currentLabSlateDate
                ? ` (${rotation.currentLabSlateDate})`
                : " is empty"}{" "}
              — not shown here.
            </Text>
            {loadError ? (
              <Text style={styles.emptyArchiveError}>Load error: {loadError}</Text>
            ) : null}
          </View>
        ) : null}

        {filteredEntries.map((entry) => (
          <HistoryEntryCard
            key={entry.id}
            entry={entry}
            expanded={Boolean(expandedIds[entry.id])}
            onToggle={() => toggleExpanded(entry.id)}
          />
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

function ThreeSlateGroupCard({
  group,
  expanded,
  onToggle,
}: {
  group: ThreeSlateGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
        <View style={styles.entryHeader}>
          <View style={styles.entryHeaderLeft}>
            <Text style={styles.groupTitle}>
              3-Slate Block {group.groupIndex + 1}
              {group.incomplete ? " (in progress)" : ""}
            </Text>
            <Text style={styles.groupDates}>
              {(group.slateDates || []).map(formatSlateDateLabel).join(" • ")}
            </Text>
          </View>
          <Text style={styles.expandHint}>{expanded ? "▲" : "▼"}</Text>
        </View>
        <Text style={styles.entryRecord}>
          {group.record}
          {group.winRate !== null && group.winRate !== undefined ? ` (${group.winRate}%)` : ""}
          {group.avgMargin !== null && group.avgMargin !== undefined
            ? ` • margin ${group.avgMargin >= 0 ? "+" : ""}${group.avgMargin}`
            : ""}
        </Text>
        <Text style={styles.entryMeta}>
          {group.totalProps} props across {group.slateCount} slate(s)
        </Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.groupExpanded}>
          <Text style={styles.groupSectionTitle}>Risk buckets</Text>
          {Object.entries(group.riskBucketBreakdown || {}).map(([bucket, stats]) => (
            <Text key={bucket} style={styles.groupLine}>
              {bucket}: {stats.record || "—"}
              {stats.winRate !== null && stats.winRate !== undefined ? ` (${stats.winRate}%)` : ""}
            </Text>
          ))}

          <Text style={styles.groupSectionTitle}>Over / Under</Text>
          {Object.entries(group.sideBreakdown || {}).map(([side, stats]) => (
            <Text key={side} style={styles.groupLine}>
              {side}: {stats.record || "—"}
              {stats.winRate !== null && stats.winRate !== undefined ? ` (${stats.winRate}%)` : ""}
            </Text>
          ))}

          <Text style={[styles.groupSectionTitle, { color: "#22c55e" }]}>Top helpers</Text>
          {(group.topSignalHelpers || []).length === 0 ? (
            <Text style={styles.groupLineMuted}>None flagged.</Text>
          ) : (
            (group.topSignalHelpers || []).map((item, index) => (
              <Text key={`helper-${index}`} style={styles.groupLine}>
                {item.signal}: {item.record}
                {item.winRate !== null && item.winRate !== undefined ? ` (${item.winRate}%)` : ""}
                {item.smallSample ? " • small sample" : ""}
              </Text>
            ))
          )}

          <Text style={[styles.groupSectionTitle, { color: "#ef4444" }]}>Top hurters</Text>
          {(group.topSignalHurters || []).length === 0 ? (
            <Text style={styles.groupLineMuted}>None flagged.</Text>
          ) : (
            (group.topSignalHurters || []).map((item, index) => (
              <Text key={`hurt-${index}`} style={styles.groupLine}>
                {item.signal}: {item.record}
                {item.winRate !== null && item.winRate !== undefined ? ` (${item.winRate}%)` : ""}
                {item.smallSample ? " • small sample" : ""}
              </Text>
            ))
          )}

          <Text style={styles.groupSectionTitle}>Neutral / noisy</Text>
          {(group.neutralSignals || []).slice(0, 4).map((item, index) => (
            <Text key={`neutral-${index}`} style={styles.groupLineMuted}>
              {item.signal}: {formatSignalRecord(item as any)}
            </Text>
          ))}

          {(group as any).learningBlock?.notes?.length ? (
            <>
              <Text style={styles.groupSectionTitle}>3-slate learning</Text>
              {(group as any).learningBlock.notes.map((note: string, index: number) => (
                <Text key={`learn-${index}`} style={styles.groupNote}>
                  • {note}
                </Text>
              ))}
              {(group as any).learningBlock.recommendation ? (
                <Text style={styles.groupLineMuted}>
                  {(group as any).learningBlock.recommendation}
                </Text>
              ) : null}
            </>
          ) : null}

          {group.comparison?.notes?.length ? (
            <>
              <Text style={styles.groupSectionTitle}>vs prior block</Text>
              {group.comparison.notes.map((note, index) => (
                <Text key={`note-${index}`} style={styles.groupNote}>
                  • {note}
                </Text>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
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
  clearBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#450a0a",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },
  resetBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#1e3a5f",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#2563eb",
  },
  resetBtnText: {
    color: "#bfdbfe",
    fontSize: 13,
    fontWeight: "900",
  },
  clearBtnDisabled: {
    opacity: 0.6,
  },
  clearBtnText: {
    color: "#fecaca",
    fontSize: 13,
    fontWeight: "900",
  },
  clearNote: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
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
  pendingText: {
    color: "#93c5fd",
    marginTop: 12,
    fontSize: 13,
    fontWeight: "800",
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
  entryCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  entryHeaderLeft: {
    flex: 1,
  },
  entryDate: {
    color: "#facc15",
    fontSize: 18,
    fontWeight: "900",
  },
  entryLeague: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  expandHint: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "900",
  },
  entryBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typeSaved: {
    backgroundColor: "#1e3a8a",
  },
  typeOfficial: {
    backgroundColor: "#4c1d95",
  },
  typeBadgeText: {
    color: "#e2e8f0",
    fontSize: 10,
    fontWeight: "900",
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusFinal: {
    backgroundColor: "#14532d",
  },
  statusProgress: {
    backgroundColor: "#713f12",
  },
  statusReportOnly: {
    backgroundColor: "#334155",
  },
  statusBadgeText: {
    color: "#f8fafc",
    fontSize: 10,
    fontWeight: "900",
  },
  entryRecord: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 10,
  },
  entryEmptyLabel: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "800",
  },
  entryMeta: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  entryLesson: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
  },
  entryDetails: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 12,
  },
  detailBlock: {
    marginBottom: 14,
  },
  detailTitle: {
    color: "#facc15",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },
  lessonHeadline: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 4,
  },
  lessonBody: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  lessonBullet: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  engineLine: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  pickCard: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    marginBottom: 10,
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
  pushCard: {
    borderColor: "#713f12",
  },
  pickMeta: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  pickLine: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 4,
  },
  pickDetail: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  emptySmall: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyArchiveNote: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 10,
  },
  emptyArchiveError: {
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 8,
  },
  groupsSection: {
    marginBottom: 16,
  },
  groupsSectionTitle: {
    color: "#38bdf8",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  groupsSectionSubtitle: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
  },
  groupCard: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e40af",
  },
  groupTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
  },
  groupDates: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  groupExpanded: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  groupSectionTitle: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 8,
    marginBottom: 4,
  },
  groupLine: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
  groupLineMuted: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
  groupNote: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
});
