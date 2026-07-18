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

import PropCard, { formatTime } from "./PropCard";
import CopyReportButton from "./CopyReportButton";
import LoadErrorBanner from "./LoadErrorBanner";
import { LEAGUE_THEME, type SupportedLeague } from "./leagueBestSixTheme";
import {
  fetchSavedPicks,
  refreshSavedPicks,
  savePick,
} from "../services/api";
import { formatApiLoadError } from "../utils/apiLoadError";
import {
  BEST_SIX_LIMIT,
  HOME_DATE_VIEW,
  HOME_SECONDARY_DATE_VIEW,
  SUPPORTED_LEAGUES,
  buildHomeControlledBestSixReportText,
  buildLeagueBestSixBoard,
  formatDateViewLabel,
  resolveHomeControlledDateView,
  resolveLeaguePicksPayload,
} from "../utils/controlledBestSixDisplay";
import { getTodayLocalDate } from "../utils/slateRotation";
import { formatSlateMessageDate } from "../utils/slateMessages";

type HomeDateView = "today" | "tomorrow";

const HOME_DATE_TABS: { key: HomeDateView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
];

function LeagueDateSection({
  league,
  dateView,
  board,
  loading,
  loadError,
  onSavePick,
  alternateLeagueHasProps = false,
}: {
  league: SupportedLeague;
  dateView: HomeDateView;
  board: ReturnType<typeof buildLeagueBestSixBoard>;
  loading: boolean;
  loadError: string | null;
  onSavePick: (pick: any, league: SupportedLeague) => void;
  alternateLeagueHasProps?: boolean;
}) {
  const theme = LEAGUE_THEME[league];
  const { bestSixCards, summary } = board;
  const viewLabel = formatDateViewLabel(dateView);

  return (
    <View style={styles.leagueSection}>
      <View style={[styles.leagueHeader, { borderColor: theme.headerBorder }]}>
        <Text style={[styles.leagueTitle, { color: theme.titleColor }]}>
          {league} -- {viewLabel}
        </Text>
        <Text style={styles.leagueSubtext}>
          Controlled Best 6 · Top 2 on Top tab · All 6 → Results
        </Text>
      </View>

      {!loading && !loadError ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{viewLabel} Summary</Text>
          <View style={styles.summaryRow}>
            <SummaryMetric
              label="Best 6"
              value={`${summary.controlledBestSixTotal}/${summary.bestSixLimit}`}
            />
            <SummaryMetric
              label="Results Tracked"
              value={`${summary.controlledBestSixTrack ?? summary.controlledBestSix}/${summary.bestSixLimit}`}
            />
            <SummaryMetric
              label="Top Picks"
              value={`${summary.topPicks}/${summary.topPickLimit}`}
            />
            <SummaryMetric label="Candidates" value={summary.boardCandidates} />
            <SummaryMetric
              label="Natural Track"
              value={summary.boardTrack ?? summary.track ?? 0}
            />
          </View>
        </View>
      ) : null}

      {!loading && !loadError && bestSixCards.length > 0 ? (
        <View style={styles.bestSixSection}>
          <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>
            {viewLabel} -- {league} Best 6
          </Text>
          <Text style={styles.sectionSubtext}>
            Top {summary.bestSixLimit} board ranks · All Best 6 tracked in Results (
            {summary.controlledBestSixTrack ?? summary.controlledBestSix} tracked)
          </Text>
          {bestSixCards.map((pick, index) => (
            <PropCard
              key={`home-${league}-${dateView}-${pick.player}-${pick.line}-${index}`}
              pick={pick}
              index={index}
              onSave={() => onSavePick(pick, league)}
              showSaveHint
              variant="bestSix"
            />
          ))}
        </View>
      ) : null}

      {!loading && !loadError && bestSixCards.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            No {league} Controlled Best 6 for {viewLabel}.
          </Text>
          <Text style={styles.emptyText}>
            {alternateLeagueHasProps
              ? `No ${league} lines for ${viewLabel.toLowerCase()}. Switch league tab or date.`
              : dateView === "today"
                ? "Refresh picks to generate today's slate, or check Tomorrow."
                : "Refresh picks to generate tomorrow's slate, or check Today."}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function buildBoardForView(
  picksData: any,
  league: SupportedLeague,
  dateView: HomeDateView,
  bestSixLimit: number
) {
  if (!picksData) {
    return buildLeagueBestSixBoard({ league, dateView, bestSixLimit });
  }
  const payload = resolveLeaguePicksPayload(picksData, league);
  return buildLeagueBestSixBoard({
    league,
    bestSix: payload.bestSix,
    bestSixDisplay: payload.bestSixDisplay,
    bestSixDisplayToday: payload.bestSixDisplayToday,
    topProps: payload.topProps,
    games: payload.games,
    dateView,
    bestSixLimit,
  });
}

export default function HomeControlledBestSixScreen() {
  const [activeLeague, setActiveLeague] = useState<SupportedLeague>("WNBA");
  const [dateView, setDateView] = useState<HomeDateView>(
    resolveHomeControlledDateView() as HomeDateView
  );
  const [picksData, setPicksData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  // Core slate loads anonymously -- no login / token required (GET /picks).
  const loadPicks = useCallback(async (mode: "full" | "quiet" = "full") => {
    try {
      if (mode === "full") setLoading(true);
      const data = await fetchSavedPicks();
      setPicksData(data);
      setLoadError(formatApiLoadError(data));
      hasLoadedRef.current = true;
    } catch (err) {
      console.log("LOAD HOME PROPS ERROR:", err);
      if (mode === "full") setPicksData(null);
      setLoadError(String(err));
    } finally {
      if (mode === "full") setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPicks(hasLoadedRef.current ? "quiet" : "full");
    }, [loadPicks])
  );

  const handleDateViewChange = (next: HomeDateView) => {
    setDateView(next);
    // Soft re-read so Today/Tomorrow boards stay fresh without a login wall.
    void loadPicks("quiet");
  };

  const runRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshSavedPicks();
      await loadPicks("full");
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const bestSixLimit = picksData?.bestSixLimit ?? BEST_SIX_LIMIT;

  const boardsByView = useMemo(() => {
    const views: HomeDateView[] = ["today", "tomorrow"];
    const out: Record<
      HomeDateView,
      Record<SupportedLeague, ReturnType<typeof buildLeagueBestSixBoard>>
    > = {
      today: {
        WNBA: buildBoardForView(picksData, "WNBA", "today", bestSixLimit),
        NBA: buildBoardForView(picksData, "NBA", "today", bestSixLimit),
      },
      tomorrow: {
        WNBA: buildBoardForView(picksData, "WNBA", "tomorrow", bestSixLimit),
        NBA: buildBoardForView(picksData, "NBA", "tomorrow", bestSixLimit),
      },
    };
    void views;
    return out;
  }, [picksData, bestSixLimit]);

  const boards = boardsByView[dateView];
  const todayLabel = useMemo(() => formatSlateMessageDate(getTodayLocalDate()), []);
  const activeTheme = LEAGUE_THEME[activeLeague];
  const viewLabel = formatDateViewLabel(dateView);

  const handleSavePick = async (pick: any, league: SupportedLeague) => {
    const saved = await savePick({
      ...pick,
      league,
      gameDate: pick.gameDate || pick.date,
      commenceTime: pick.commenceTime || pick.time,
      startTimeDisplay: pick.startTimeDisplay,
      savedAt: new Date().toISOString(),
    });

    const slateDate = String(pick.gameDate || pick.date || getTodayLocalDate()).slice(0, 10);

    if (saved.ok) {
      Alert.alert(
        "Pick Saved",
        `${formatSlateMessageDate(slateDate)} slate: ${pick.player} ${pick.pick || pick.side} ${pick.line}`
      );
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

  const getReportText = () =>
    buildHomeControlledBestSixReportText({
      dateView,
      lastUpdated: picksData?.lastUpdated || null,
      loading,
      wnbaToday: {
        bestSixCards: boardsByView.today.WNBA.bestSixCards,
        summary: boardsByView.today.WNBA.summary,
        games: resolveLeaguePicksPayload(picksData || {}, "WNBA").games,
        dateView: "today",
      },
      wnbaTomorrow: {
        bestSixCards: boardsByView.tomorrow.WNBA.bestSixCards,
        summary: boardsByView.tomorrow.WNBA.summary,
        games: resolveLeaguePicksPayload(picksData || {}, "WNBA").games,
        dateView: "tomorrow",
      },
      nbaToday: {
        bestSixCards: boardsByView.today.NBA.bestSixCards,
        summary: boardsByView.today.NBA.summary,
        games: resolveLeaguePicksPayload(picksData || {}, "NBA").games,
        dateView: "today",
      },
      nbaTomorrow: {
        bestSixCards: boardsByView.tomorrow.NBA.bestSixCards,
        summary: boardsByView.tomorrow.NBA.summary,
        games: resolveLeaguePicksPayload(picksData || {}, "NBA").games,
        dateView: "tomorrow",
      },
    });

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
          <Text style={styles.brand}>CourtEdge</Text>
          <Text style={styles.powered}>Powered by BetBrain</Text>
          <Text style={styles.motto}>We Don&apos;t Guess. We Calculate. We Cash.</Text>
          <Text style={styles.dateLine}>Date: {todayLabel}</Text>
          {picksData?.lastUpdated ? (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(picksData.lastUpdated)}
            </Text>
          ) : null}
          {picksData?.controlledBestSixVersion ? (
            <Text style={styles.versionLine}>Engine: {picksData.controlledBestSixVersion}</Text>
          ) : null}
          <CopyReportButton getReportText={getReportText} />
        </View>

        <View style={styles.leagueTabRow}>
          {SUPPORTED_LEAGUES.map((league) => {
            const theme = LEAGUE_THEME[league as SupportedLeague];
            const isActive = activeLeague === league;
            return (
              <TouchableOpacity
                key={league}
                onPress={() => setActiveLeague(league as SupportedLeague)}
                style={[
                  styles.leagueTabButton,
                  isActive && {
                    borderColor: theme.activeFilterBorder,
                    backgroundColor: theme.activeFilterBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.leagueTabText,
                    isActive && { color: theme.activeFilterText },
                  ]}
                >
                  {league}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.dateTabRow}>
          {HOME_DATE_TABS.map((tab) => {
            const isActive = dateView === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => handleDateViewChange(tab.key)}
                style={[
                  styles.dateTabButton,
                  isActive && {
                    borderColor: activeTheme.activeFilterBorder,
                    backgroundColor: activeTheme.activeFilterBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateTabText,
                    isActive && { color: activeTheme.activeFilterText },
                  ]}
                >
                  {tab.label}
                  {tab.key === HOME_DATE_VIEW ? " · live" : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.homeDateBanner}>
          <Text style={styles.homeDateTitle}>
            {viewLabel} -- {activeLeague}
          </Text>
          <Text style={styles.homeDateSubtext}>
            Controlled Best 6 for {activeLeague} · Switch Today / Tomorrow above · Top 2 on Top tab
            ({formatDateViewLabel(HOME_SECONDARY_DATE_VIEW)} look-ahead) · Rollover → Results → Lab →
            History
          </Text>
        </View>

        <TouchableOpacity
          onPress={runRefresh}
          style={[styles.refreshButton, { backgroundColor: activeTheme.refreshBg }]}
          disabled={refreshing || loading}
        >
          <Text style={styles.refreshText}>
            {refreshing || loading ? "Refreshing..." : "Refresh Picks"}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <Text style={styles.loadingText}>Loading Controlled Best 6...</Text>
        ) : null}

        <LoadErrorBanner message={loadError} />

        <LeagueDateSection
          key={`${activeLeague}-${dateView}`}
          league={activeLeague}
          dateView={dateView}
          board={boards[activeLeague]}
          loading={loading}
          loadError={loadError}
          onSavePick={handleSavePick}
          alternateLeagueHasProps={
            activeLeague === "NBA"
              ? boards.WNBA.bestSixCards.length > 0
              : boards.NBA.bestSixCards.length > 0
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryMetric({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 16, paddingBottom: 36 },
  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#166534",
    marginBottom: 16,
  },
  brand: { fontSize: 38, color: "#22c55e", fontWeight: "900" },
  powered: { color: "#94a3b8", fontSize: 15, fontWeight: "700", marginTop: 2 },
  motto: { color: "#e2e8f0", fontSize: 15, fontWeight: "700", marginTop: 14, lineHeight: 22 },
  dateLine: { color: "#fbbf24", fontSize: 14, fontWeight: "800", marginTop: 10 },
  lastUpdated: { color: "#64748b", fontSize: 12, fontWeight: "700", marginTop: 12 },
  versionLine: { color: "#64748b", fontSize: 11, fontWeight: "700", marginTop: 4 },
  leagueTabRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  leagueTabButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },
  leagueTabText: { color: "#94a3b8", textAlign: "center", fontWeight: "900", fontSize: 14 },
  dateTabRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  dateTabButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },
  dateTabText: { color: "#94a3b8", textAlign: "center", fontWeight: "900", fontSize: 13 },
  homeDateBanner: {
    backgroundColor: "#052e16",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#166534",
    padding: 14,
    marginBottom: 14,
  },
  homeDateTitle: { color: "#86efac", fontSize: 18, fontWeight: "900" },
  homeDateSubtext: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 18,
  },
  refreshButton: {
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  refreshText: { color: "white", fontWeight: "900", fontSize: 16, textAlign: "center" },
  loadingText: { color: "white", fontSize: 18, fontWeight: "800", marginBottom: 12 },
  leagueSection: { marginBottom: 28 },
  leagueHeader: {
    backgroundColor: "#0f172a",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  leagueTitle: { fontSize: 24, fontWeight: "900" },
  leagueSubtext: { color: "#94a3b8", fontSize: 13, fontWeight: "700", marginTop: 4 },
  summaryCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
    marginBottom: 12,
  },
  summaryTitle: { color: "#93c5fd", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricBox: {
    width: "48%",
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#263449",
  },
  metricLabel: { color: "#64748b", fontSize: 11, fontWeight: "900", marginBottom: 4 },
  metricValue: { color: "#f8fafc", fontSize: 16, fontWeight: "900" },
  bestSixSection: { marginBottom: 18 },
  sectionTitle: { fontSize: 21, fontWeight: "900", marginBottom: 4 },
  sectionSubtext: { color: "#94a3b8", fontSize: 13, fontWeight: "700", marginBottom: 12 },
  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  emptyTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "900", marginBottom: 8 },
  emptyText: { color: "#94a3b8", fontSize: 13, fontWeight: "700", lineHeight: 20 },
});
