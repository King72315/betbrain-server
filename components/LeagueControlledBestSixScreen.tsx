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
  buildLeagueBestSixBoard,
  countCandidatesByEligibility,
  formatDateViewLabel,
  HOME_DATE_VIEW,
  resolveLeaguePicksPayload,
  shouldShowScoutMode,
} from "../utils/controlledBestSixDisplay";
import { groupByDayBucket } from "../utils/groupByDayBucket";
import { buildLeagueControlledBestSixReport } from "../utils/reportBuilders";
import { getTodayLocalDate } from "../utils/slateRotation";
import { formatSlateMessageDate } from "../utils/slateMessages";

type DateView = "today" | "tomorrow" | "full_board";

const EXPLORE_DATE_VIEWS: { key: DateView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "full_board", label: "Full Board" },
];

type LeagueControlledBestSixScreenProps = {
  league: SupportedLeague;
  variant?: "home" | "explore";
};

export default function LeagueControlledBestSixScreen({
  league,
  variant = "explore",
}: LeagueControlledBestSixScreenProps) {
  const theme = LEAGUE_THEME[league];
  const isHome = variant === "home";
  const [games, setGames] = useState<any[]>([]);
  const [bestSix, setBestSix] = useState<any[]>([]);
  const [bestSixDisplay, setBestSixDisplay] = useState<any[]>([]);
  const [topProps, setTopProps] = useState<any[]>([]);
  const [slateSummary, setSlateSummary] = useState<{
    bestSixLimit?: number;
    controlledBestSixVersion?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateView, setDateView] = useState<DateView>(isHome ? HOME_DATE_VIEW : "today");
  const [showFullBoard, setShowFullBoard] = useState(false);

  useEffect(() => {
    loadPicks();
  }, [league]);

  const todayLabel = useMemo(() => formatSlateMessageDate(getTodayLocalDate()), []);
  const effectiveDateView = isHome ? HOME_DATE_VIEW : dateView;

  const board = useMemo(
    () =>
      buildLeagueBestSixBoard({
        league,
        bestSix,
        bestSixDisplay,
        topProps,
        games,
        dateView: effectiveDateView,
        bestSixLimit: slateSummary?.bestSixLimit ?? BEST_SIX_LIMIT,
      }),
    [league, bestSix, bestSixDisplay, topProps, games, effectiveDateView, slateSummary]
  );

  const groupedGames = useMemo(() => {
    const sections = groupByDayBucket(games);
    if (isHome) {
      return sections.filter((section) => section.bucket === "TOMORROW");
    }
    return sections;
  }, [games, isHome]);

  const scoutVisible = !isHome && shouldShowScoutMode(effectiveDateView, showFullBoard);

  const loadPicks = async () => {
    try {
      setLoading(true);
      const data = await fetchSavedPicks();
      const payload = resolveLeaguePicksPayload(data, league);
      setGames(payload.games);
      setBestSix(payload.bestSix);
      setBestSixDisplay(payload.bestSixDisplay);
      setTopProps(payload.topProps);
      setSlateSummary({
        bestSixLimit: data.bestSixLimit ?? BEST_SIX_LIMIT,
        controlledBestSixVersion: data.controlledBestSixVersion,
      });
      setLastUpdated(data.lastUpdated || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log(`LOAD ${league} PROPS ERROR:`, err);
      setGames([]);
      setBestSix([]);
      setBestSixDisplay([]);
      setTopProps([]);
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const runRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshSavedPicks();
      await loadPicks();
    } catch (err) {
      console.log("REFRESH ERROR:", err);
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePick = async (pick: any, game: any = {}) => {
    const saved = await savePick({
      ...pick,
      league,
      gameId: pick.gameId || game.gameId,
      gameDate: pick.gameDate || pick.date || game.date,
      game: pick.game || game.game,
      date: pick.date || game.date,
      dateLabel: pick.dateLabel || game.dateLabel,
      commenceTime: pick.commenceTime || game.commenceTime || game.time,
      startTimeDisplay: pick.startTimeDisplay,
      savedAt: new Date().toISOString(),
    });

    const slateDate = String(
      pick.gameDate || pick.date || game.date || getTodayLocalDate()
    ).slice(0, 10);

    if (saved.ok) {
      Alert.alert(
        "Pick Saved",
        `${formatSlateMessageDate(slateDate)} slate: ${pick.player} ${pick.pick || pick.side} ${pick.line}`
      );
    } else {
      Alert.alert(
        "Save Failed",
        saved.message || `Could not save pick for ${formatSlateMessageDate(slateDate)} slate.`
      );
    }
  };

  const handleDateViewChange = (view: DateView) => {
    setDateView(view);
    setShowFullBoard(view === "full_board");
  };

  const getReportText = () =>
    buildLeagueControlledBestSixReport({
      league,
      bestSixCards: board.bestSixCards,
      summary: board.summary,
      lastUpdated,
      loading,
      dateView: effectiveDateView,
      includeFullBoard: scoutVisible,
      games,
    });

  const { bestSixCards, summary } = board;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={runRefresh} />
        }
      >
        <View style={[styles.header, { borderColor: theme.headerBorder }]}>
          <Text style={[styles.title, { color: theme.titleColor }]}>
            {isHome ? "CourtEdge" : `${league} Props`}
          </Text>
          <Text style={styles.subtitle}>
            {isHome ? `Tomorrow — ${league} Controlled Best 6` : "Controlled Best 6"}
          </Text>
          <Text style={styles.dateLine}>Date: {todayLabel}</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>
          {lastUpdated ? (
            <Text style={styles.lastUpdated}>Last updated: {formatTime(lastUpdated)}</Text>
          ) : null}
          {slateSummary?.controlledBestSixVersion ? (
            <Text style={styles.versionLine}>Engine: {slateSummary.controlledBestSixVersion}</Text>
          ) : null}
          <CopyReportButton getReportText={getReportText} />
        </View>

        {!isHome ? (
          <View style={styles.filterRow}>
            {EXPLORE_DATE_VIEWS.map((view) => (
              <TouchableOpacity
                key={view.key}
                onPress={() => handleDateViewChange(view.key)}
                style={[
                  styles.filterButton,
                  dateView === view.key && {
                    borderColor: theme.activeFilterBorder,
                    backgroundColor: theme.activeFilterBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    dateView === view.key && { color: theme.activeFilterText },
                  ]}
                >
                  {view.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.homeTomorrowBanner}>
            <Text style={styles.homeTomorrowTitle}>Tomorrow — {league}</Text>
            <Text style={styles.homeTomorrowSubtext}>
              Top 2 also on Top tab · Rollover → Results → Lab → History
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={runRefresh}
          style={[styles.refreshButton, { backgroundColor: theme.refreshBg }]}
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

        {!loading && !loadError ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {formatDateViewLabel(effectiveDateView)} Summary
            </Text>
            <View style={styles.summaryRow}>
              <SummaryMetric
                label="Controlled Best 6"
                value={`${summary.controlledBestSixTotal}/${summary.bestSixLimit}`}
              />
              <SummaryMetric
                label="Results Track"
                value={`${summary.controlledBestSixTrack ?? summary.controlledBestSix}/${summary.bestSixLimit}`}
              />
              <SummaryMetric
                label="Top Picks"
                value={`${summary.topPicks}/${summary.topPickLimit}`}
              />
              <SummaryMetric label="Board Candidates" value={summary.boardCandidates} />
              <SummaryMetric label="Board Track" value={summary.boardTrack ?? summary.track ?? 0} />
              <SummaryMetric label="Board Only" value={summary.boardOnly} />
              <SummaryMetric label="No Bet" value={summary.noBet} />
            </View>
          </View>
        ) : null}

        {!loading && !loadError && bestSixCards.length > 0 ? (
          <View style={styles.bestSixSection}>
            <Text style={[styles.sectionTitle, { color: theme.sectionTitle }]}>
              {isHome ? `Tomorrow — ${league} Best 6` : "Controlled Best 6"}
            </Text>
            <Text style={styles.sectionSubtext}>
              Top {summary.bestSixLimit} board ranks · TRACK-only → Results (
              {summary.controlledBestSixTrack ?? summary.controlledBestSix} admitted)
            </Text>
            {bestSixCards.map((pick, index) => (
              <PropCard
                key={`best6-${league}-${pick.player}-${pick.line}-${index}`}
                pick={pick}
                index={index}
                onSave={() => handleSavePick(pick)}
                showSaveHint
                variant="bestSix"
              />
            ))}
          </View>
        ) : null}

        {!loading && !loadError && bestSixCards.length === 0 && effectiveDateView !== "full_board" ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No {league} Controlled Best 6 for {formatDateViewLabel(effectiveDateView)}.
            </Text>
            <Text style={styles.emptyText}>
              {isHome
                ? "Refresh picks to generate tomorrow's slate."
                : "Refresh picks or switch to Full Board for scout mode."}
            </Text>
          </View>
        ) : null}

        {!isHome && !loading && !loadError && effectiveDateView !== "full_board" ? (
          <TouchableOpacity onPress={() => setShowFullBoard((value) => !value)} style={styles.scoutToggle}>
            <Text style={styles.scoutToggleText}>
              {showFullBoard ? "Hide Full Board" : "Show Full Board"}
            </Text>
            <Text style={styles.scoutToggleHint}>Scout Mode — all candidates & ledgers</Text>
          </TouchableOpacity>
        ) : null}

        {!loading && !loadError && scoutVisible ? (
          <View style={styles.scoutSection}>
            <Text style={styles.scoutTitle}>Scout Mode — Full Board</Text>
            <Text style={styles.scoutSubtext}>
              All {league} candidates, game boards, and expanded prop ledgers
            </Text>
            {groupedGames.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No {league} games loaded.</Text>
              </View>
            ) : (
              groupedGames.map((section) => (
                <View key={`games-${section.bucket}`} style={styles.daySection}>
                  <Text style={styles.daySectionTitle}>{section.label}</Text>
                  {section.items.map((game: any, gameIndex: number) => (
                    <View
                      key={`${section.bucket}-${game.gameId || game.game}-${gameIndex}`}
                      style={[styles.gameCard, { borderColor: theme.gameCardBorder }]}
                    >
                      <View style={styles.gameHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dateLabel}>{game.dateLabel || ""}</Text>
                          <Text style={styles.gameTitle}>{game.game}</Text>
                          <Text style={styles.gameTime}>{formatTime(game.time)}</Text>
                        </View>
                        <Text
                          style={[
                            styles.gameLeagueBadge,
                            { color: theme.leagueBadgeText, backgroundColor: theme.leagueBadgeBg },
                          ]}
                        >
                          {league}
                        </Text>
                      </View>
                      <View style={styles.gameMetaRow}>
                        {(() => {
                          const pool = game.allGeneratedCandidates || game.picks || [];
                          const counts = countCandidatesByEligibility(pool);
                          return (
                            <>
                              <Text style={styles.gameMeta}>
                                Candidates: {game.allCandidateCount ?? pool.length}
                              </Text>
                              <Text style={styles.gameMeta}>Track: {counts.track}</Text>
                              <Text style={styles.gameMeta}>Board Only: {counts.boardOnly}</Text>
                            </>
                          );
                        })()}
                      </View>
                      <Text style={styles.gameSectionTitle}>All Candidates</Text>
                      {(game.allGeneratedCandidates || game.picks || []).map(
                        (pick: any, index: number) => (
                          <PropCard
                            key={`scout-${pick.player}-${pick.line}-${index}`}
                            pick={pick}
                            index={index}
                            game={game}
                            onSave={() => handleSavePick(pick, game)}
                            showSaveHint
                          />
                        )
                      )}
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        ) : null}
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
  header: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  title: { fontSize: 34, fontWeight: "900" },
  subtitle: { color: "#e2e8f0", fontSize: 18, fontWeight: "800", marginTop: 2 },
  dateLine: { color: "#fbbf24", fontSize: 14, fontWeight: "800", marginTop: 8 },
  motto: { color: "#94a3b8", fontSize: 13, fontWeight: "700", marginTop: 10 },
  lastUpdated: { color: "#64748b", fontSize: 12, fontWeight: "700", marginTop: 12 },
  versionLine: { color: "#64748b", fontSize: 11, fontWeight: "700", marginTop: 4 },
  homeTomorrowBanner: {
    backgroundColor: "#052e16",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#166534",
    padding: 14,
    marginBottom: 14,
  },
  homeTomorrowTitle: { color: "#86efac", fontSize: 18, fontWeight: "900" },
  homeTomorrowSubtext: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 18,
  },
  filterRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  filterButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },
  filterText: { color: "#94a3b8", textAlign: "center", fontWeight: "900", fontSize: 12 },
  refreshButton: { paddingVertical: 14, borderRadius: 16, marginBottom: 20 },
  refreshText: { color: "white", fontWeight: "900", fontSize: 16, textAlign: "center" },
  loadingText: { color: "white", fontSize: 18, fontWeight: "800" },
  summaryCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
    marginBottom: 16,
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
  scoutToggle: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 16,
  },
  scoutToggleText: { color: "#93c5fd", fontSize: 16, fontWeight: "900", textAlign: "center" },
  scoutToggleHint: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
  },
  scoutSection: { marginTop: 4, marginBottom: 18 },
  scoutTitle: { color: "#fbbf24", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  scoutSubtext: { color: "#94a3b8", fontSize: 13, fontWeight: "700", marginBottom: 14 },
  daySection: { marginBottom: 18 },
  daySectionTitle: { color: "#fbbf24", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  gameCard: {
    backgroundColor: "#0f172a",
    padding: 16,
    borderRadius: 22,
    marginBottom: 18,
    borderWidth: 1,
  },
  gameHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  dateLabel: { color: "#fbbf24", fontSize: 13, fontWeight: "900", marginBottom: 4 },
  gameTitle: { color: "white", fontSize: 22, fontWeight: "900", marginBottom: 4 },
  gameTime: { color: "#94a3b8", fontSize: 13, fontWeight: "700" },
  gameLeagueBadge: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "900",
    alignSelf: "flex-start",
  },
  gameMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  gameMeta: { color: "#94a3b8", fontSize: 12, fontWeight: "800" },
  gameSectionTitle: { color: "#4ade80", fontSize: 17, fontWeight: "900", marginBottom: 10 },
  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  emptyTitle: { color: "white", fontSize: 18, fontWeight: "900", marginBottom: 6 },
  emptyText: { color: "#94a3b8", fontSize: 13, fontWeight: "700" },
});
