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

import PropCard, { formatTime } from "../../components/PropCard";
import CopyReportButton from "../../components/CopyReportButton";
import LoadErrorBanner from "../../components/LoadErrorBanner";
import {
  fetchSavedPicks,
  refreshSavedPicks,
  savePick,
} from "../../services/api";
import { formatApiLoadError } from "../../utils/apiLoadError";
import {
  BEST_SIX_LIMIT,
  buildTopPickBadgeMap,
  buildWnbaControlledSummary,
  enrichBestSixForDisplay,
  filterBestSixByDateView,
  formatDateViewLabel,
  shouldShowScoutMode,
} from "../../utils/controlledBestSixDisplay";
import { groupByDayBucket } from "../../utils/groupByDayBucket";
import { buildWnbaControlledBestSixReport } from "../../utils/reportBuilders";
import { getTodayLocalDate } from "../../utils/slateRotation";
import { formatSlateMessageDate } from "../../utils/slateMessages";

type DateView = "today" | "tomorrow" | "full_board";

const DATE_VIEWS: { key: DateView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "full_board", label: "Full Board" },
];

export default function ExploreScreen() {
  const [wnbaGames, setWnbaGames] = useState<any[]>([]);
  const [bestSixWNBA, setBestSixWNBA] = useState<any[]>([]);
  const [topWNBAProps, setTopWNBAProps] = useState<any[]>([]);
  const [slateSummary, setSlateSummary] = useState<{
    bestSixLimit?: number;
    controlledBestSixVersion?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateView, setDateView] = useState<DateView>("today");
  const [showFullBoard, setShowFullBoard] = useState(false);

  useEffect(() => {
    loadPicks();
  }, []);

  const todayLabel = useMemo(() => formatSlateMessageDate(getTodayLocalDate()), []);

  const topPickBadgeMap = useMemo(
    () => buildTopPickBadgeMap(topWNBAProps),
    [topWNBAProps]
  );

  const summary = useMemo(
    () =>
      buildWnbaControlledSummary({
        bestSixWNBA,
        topWNBAProps,
        wnbaGames,
        dateView,
        bestSixLimit: slateSummary?.bestSixLimit ?? BEST_SIX_LIMIT,
      }),
    [bestSixWNBA, topWNBAProps, wnbaGames, dateView, slateSummary]
  );

  const bestSixCards = useMemo(() => {
    const filtered = filterBestSixByDateView(bestSixWNBA, dateView);
    return filtered.map((pick, index) =>
      enrichBestSixForDisplay(pick, topPickBadgeMap, index)
    );
  }, [bestSixWNBA, dateView, topPickBadgeMap]);

  const groupedGames = useMemo(() => groupByDayBucket(wnbaGames), [wnbaGames]);

  const scoutVisible = shouldShowScoutMode(dateView, showFullBoard);

  const loadPicks = async () => {
    try {
      setLoading(true);

      const data = await fetchSavedPicks();

      const games =
        data.wnbaGames?.length > 0
          ? data.wnbaGames
          : (data.games || []).filter((g: any) => g.league === "WNBA");

      setWnbaGames(games);
      setBestSixWNBA(data.bestSixWNBA || []);
      setTopWNBAProps(data.topWNBAProps || []);
      setSlateSummary({
        bestSixLimit: data.bestSixLimit ?? BEST_SIX_LIMIT,
        controlledBestSixVersion: data.controlledBestSixVersion,
      });
      setLastUpdated(data.lastUpdated || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log("LOAD WNBA PROPS ERROR:", err);
      setWnbaGames([]);
      setBestSixWNBA([]);
      setTopWNBAProps([]);
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
      league: "WNBA",
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
    if (view === "full_board") {
      setShowFullBoard(true);
    } else {
      setShowFullBoard(false);
    }
  };

  const getReportText = () =>
    buildWnbaControlledBestSixReport({
      bestSixCards,
      summary,
      lastUpdated,
      loading,
      dateView,
      includeFullBoard: scoutVisible,
      games: wnbaGames,
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
        <View style={styles.header}>
          <Text style={styles.title}>WNBA Props</Text>
          <Text style={styles.subtitle}>Controlled Best 6</Text>
          <Text style={styles.dateLine}>Date: {todayLabel}</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(lastUpdated)}
            </Text>
          )}
          {slateSummary?.controlledBestSixVersion ? (
            <Text style={styles.versionLine}>
              Engine: {slateSummary.controlledBestSixVersion}
            </Text>
          ) : null}
          <CopyReportButton getReportText={getReportText} />
        </View>

        <View style={styles.filterRow}>
          {DATE_VIEWS.map((view) => (
            <TouchableOpacity
              key={view.key}
              onPress={() => handleDateViewChange(view.key)}
              style={[
                styles.filterButton,
                dateView === view.key && styles.activeFilterButton,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  dateView === view.key && styles.activeFilterText,
                ]}
              >
                {view.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={runRefresh}
          style={styles.refreshButton}
          disabled={refreshing || loading}
        >
          <Text style={styles.refreshText}>
            {refreshing || loading ? "Refreshing..." : "Refresh Picks"}
          </Text>
        </TouchableOpacity>

        {loading && (
          <Text style={styles.loadingText}>Loading Controlled Best 6...</Text>
        )}

        <LoadErrorBanner message={loadError} />

        {!loading && !loadError && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {formatDateViewLabel(dateView)} Summary
            </Text>
            <View style={styles.summaryRow}>
              <SummaryMetric
                label="Controlled Best 6"
                value={`${summary.controlledBestSixTotal}/${summary.bestSixLimit}`}
              />
              <SummaryMetric
                label="Top Picks"
                value={`${summary.topPicks}/${summary.topPickLimit}`}
              />
              <SummaryMetric
                label="Board Candidates"
                value={summary.boardCandidates}
              />
              <SummaryMetric label="Board Only" value={summary.boardOnly} />
              <SummaryMetric label="No Bet" value={summary.noBet} />
            </View>
          </View>
        )}

        {!loading && !loadError && bestSixCards.length > 0 && (
          <View style={styles.bestSixSection}>
            <Text style={styles.sectionTitle}>Controlled Best 6</Text>
            <Text style={styles.sectionSubtext}>
              Max {summary.bestSixLimit} TRACK props · Top #1/#2 badges inline
            </Text>
            {bestSixCards.map((pick, index) => (
              <PropCard
                key={`best6-${pick.player}-${pick.line}-${index}`}
                pick={pick}
                index={index}
                onSave={() => handleSavePick(pick)}
                showSaveHint
                variant="bestSix"
              />
            ))}
          </View>
        )}

        {!loading && !loadError && bestSixCards.length === 0 && dateView !== "full_board" && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No Controlled Best 6 for {formatDateViewLabel(dateView)}.
            </Text>
            <Text style={styles.emptyText}>
              Refresh picks or switch to Full Board for scout mode.
            </Text>
          </View>
        )}

        {!loading && !loadError && dateView !== "full_board" && (
          <TouchableOpacity
            onPress={() => setShowFullBoard((value) => !value)}
            style={styles.scoutToggle}
          >
            <Text style={styles.scoutToggleText}>
              {showFullBoard ? "Hide Full Board" : "Show Full Board"}
            </Text>
            <Text style={styles.scoutToggleHint}>Scout Mode — all candidates & ledgers</Text>
          </TouchableOpacity>
        )}

        {!loading && !loadError && scoutVisible && (
          <View style={styles.scoutSection}>
            <Text style={styles.scoutTitle}>Scout Mode — Full Board</Text>
            <Text style={styles.scoutSubtext}>
              All WNBA candidates, game boards, and expanded prop ledgers
            </Text>

            {groupedGames.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No WNBA games loaded.</Text>
                <Text style={styles.emptyText}>
                  Refresh picks or check backend connection.
                </Text>
              </View>
            ) : (
              groupedGames.map((section) => (
                <View key={`games-${section.bucket}`} style={styles.daySection}>
                  <Text style={styles.daySectionTitle}>{section.label}</Text>
                  {section.items.map((game: any, gameIndex: number) => (
                    <View
                      key={`${section.bucket}-${game.gameId || game.game}-${gameIndex}`}
                      style={styles.gameCard}
                    >
                      <View style={styles.gameHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.dateLabel}>{game.dateLabel || ""}</Text>
                          <Text style={styles.gameTitle}>{game.game}</Text>
                          <Text style={styles.gameTime}>{formatTime(game.time)}</Text>
                        </View>
                        <Text style={styles.gameLeagueBadge}>WNBA</Text>
                      </View>

                      <View style={styles.gameMetaRow}>
                        <Text style={styles.gameMeta}>
                          Candidates:{" "}
                          {game.allCandidateCount ??
                            game.allGeneratedCandidates?.length ??
                            0}
                        </Text>
                        <Text style={styles.gameMeta}>
                          Track:{" "}
                          {(game.allGeneratedCandidates || game.picks || []).filter(
                            (p: any) =>
                              (p.decisionIntelligence?.trackEligibility ||
                                p.trackingEligibility ||
                                p.wnbaTrackingDecision) === "TRACK"
                          ).length}
                        </Text>
                        <Text style={styles.gameMeta}>
                          Board Only:{" "}
                          {(game.allGeneratedCandidates || game.picks || []).filter(
                            (p: any) =>
                              (p.decisionIntelligence?.trackEligibility ||
                                p.trackingEligibility ||
                                p.wnbaTrackingDecision) === "BOARD_ONLY"
                          ).length}
                        </Text>
                        <Text style={styles.gameMeta}>
                          No Bet:{" "}
                          {(game.allGeneratedCandidates || game.picks || []).filter(
                            (p: any) =>
                              (p.decisionIntelligence?.trackEligibility ||
                                p.trackingEligibility ||
                                p.wnbaTrackingDecision) === "NO_BET"
                          ).length}
                        </Text>
                      </View>

                      <Text style={styles.gameSectionTitle}>All Candidates</Text>

                      {!game.allGeneratedCandidates?.length && !game.picks?.length ? (
                        <Text style={styles.noPicksText}>No candidates for this game.</Text>
                      ) : (
                        (game.allGeneratedCandidates || game.picks || []).map(
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
                        )
                      )}
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        )}
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
  header: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#831843",
    marginBottom: 16,
  },
  title: {
    color: "#f472b6",
    fontSize: 34,
    fontWeight: "900",
  },
  subtitle: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  dateLine: {
    color: "#fbbf24",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 8,
  },
  motto: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
  },
  lastUpdated: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
  },
  versionLine: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  filterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
  },
  activeFilterButton: {
    borderColor: "#f472b6",
    backgroundColor: "#500724",
  },
  filterText: {
    color: "#94a3b8",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 12,
  },
  activeFilterText: {
    color: "#fbcfe8",
  },
  refreshButton: {
    backgroundColor: "#be185d",
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  refreshText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },
  loadingText: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },
  summaryCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
    marginBottom: 16,
  },
  summaryTitle: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
    fontSize: 16,
    fontWeight: "900",
  },
  bestSixSection: {
    marginBottom: 18,
  },
  sectionTitle: {
    color: "#f472b6",
    fontSize: 21,
    fontWeight: "900",
    marginBottom: 4,
  },
  sectionSubtext: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 12,
  },
  scoutToggle: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 16,
  },
  scoutToggleText: {
    color: "#93c5fd",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  scoutToggleHint: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
  },
  scoutSection: {
    marginTop: 4,
    marginBottom: 18,
  },
  scoutTitle: {
    color: "#fbbf24",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  scoutSubtext: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 14,
  },
  daySection: {
    marginBottom: 18,
  },
  daySectionTitle: {
    color: "#fbbf24",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 10,
  },
  gameCard: {
    backgroundColor: "#0f172a",
    padding: 16,
    borderRadius: 22,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#831843",
  },
  gameHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  dateLabel: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 4,
  },
  gameTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 4,
  },
  gameTime: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
  },
  gameLeagueBadge: {
    color: "#fce7f3",
    backgroundColor: "#be185d",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "900",
    alignSelf: "flex-start",
  },
  gameMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  gameMeta: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
  },
  gameSectionTitle: {
    color: "#4ade80",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 10,
  },
  noPicksText: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
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
});