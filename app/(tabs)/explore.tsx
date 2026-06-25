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
import { groupByDayBucket } from "../../utils/groupByDayBucket";
import { buildLeagueBoardReport } from "../../utils/reportBuilders";

const FILTERS = ["ALL", "NBA", "WNBA"] as const;

type LeagueFilter = (typeof FILTERS)[number];

export default function ExploreScreen() {
  const [games, setGames] = useState<any[]>([]);
  const [topProps, setTopProps] = useState<any[]>([]);
  const [bestSixWNBA, setBestSixWNBA] = useState<any[]>([]);
  const [bestSixNBA, setBestSixNBA] = useState<any[]>([]);
  const [slateSummary, setSlateSummary] = useState<{
    generatedPropCount?: number;
    bestSixLimit?: number;
    controlledBestSixVersion?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>("ALL");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadPicks();
  }, []);

  const filteredGames = useMemo(() => {
    if (leagueFilter === "ALL") return games;
    return games.filter((game) => game.league === leagueFilter);
  }, [games, leagueFilter]);

  const filteredTopProps = useMemo(() => {
    if (leagueFilter === "ALL") return topProps;
    return topProps.filter((pick) => pick.league === leagueFilter);
  }, [topProps, leagueFilter]);

  const filteredBestSix = useMemo(() => {
    const combined = [...bestSixNBA, ...bestSixWNBA];
    if (leagueFilter === "ALL") return combined;
    return combined.filter((pick) => pick.league === leagueFilter);
  }, [bestSixNBA, bestSixWNBA, leagueFilter]);

  const groupedTopProps = useMemo(
    () => groupByDayBucket(filteredTopProps),
    [filteredTopProps]
  );

  const groupedGames = useMemo(
    () => groupByDayBucket(filteredGames),
    [filteredGames]
  );

  const loadPicks = async () => {
    try {
      setLoading(true);

      const data = await fetchSavedPicks();

      setGames(data.games || []);
      setTopProps(data.topProps || []);
      setBestSixWNBA(data.bestSixWNBA || []);
      setBestSixNBA(data.bestSixNBA || []);
      setSlateSummary({
        generatedPropCount: data.generatedPropCount,
        bestSixLimit: data.bestSixLimit,
        controlledBestSixVersion: data.controlledBestSixVersion,
      });
      setLastUpdated(data.lastUpdated || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log("LOAD PICKS ERROR:", err);
      setGames([]);
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
      league: pick.league || game.league,
      gameId: pick.gameId || game.gameId,
      gameDate: pick.gameDate || pick.date || game.date,
      game: pick.game || game.game,
      date: pick.date || game.date,
      dateLabel: pick.dateLabel || game.dateLabel,
      commenceTime: pick.commenceTime || game.commenceTime || game.time,
      startTimeDisplay: pick.startTimeDisplay,
      savedAt: new Date().toISOString(),
    });

    if (saved.ok) {
      Alert.alert("Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

  const renderPickCard = (pick: any, index: number, game: any = {}) => (
    <PropCard
      key={`${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
      pick={pick}
      index={index}
      game={game}
      onSave={() => handleSavePick(pick, game)}
      showSaveHint
    />
  );

  const premiumCount = filteredTopProps.filter(
    (pick) => String(pick.tier || "").toUpperCase() === "PREMIUM"
  ).length;

  const playableCount = filteredGames.reduce((sum, game) => {
    return sum + Number(game.playableCandidateCount || game.picks?.length || 0);
  }, 0);

  const getReportText = () =>
    buildLeagueBoardReport({
      page: "Full Game Board",
      league: leagueFilter === "ALL" ? "NBA + WNBA" : leagueFilter,
      games: filteredGames,
      topProps: filteredTopProps,
      lastUpdated,
      loading,
      premiumCount,
      playableCount,
      leagueFilter,
      dataSource: "GET /picks",
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
          <Text style={styles.title}>CourtEdge</Text>
          <Text style={styles.subtitle}>Full Game Board</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(lastUpdated)}
            </Text>
          )}
          <CopyReportButton getReportText={getReportText} />
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              onPress={() => setLeagueFilter(filter)}
              style={[
                styles.filterButton,
                leagueFilter === filter && styles.activeFilterButton,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  leagueFilter === filter && styles.activeFilterText,
                ]}
              >
                {filter}
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
          <Text style={styles.loadingText}>Loading CourtEdge picks...</Text>
        )}

        <LoadErrorBanner message={loadError} />

        {!loading && !loadError && filteredBestSix.length > 0 && (
          <View style={styles.bestSixSection}>
            <Text style={styles.sectionTitle}>Controlled Best 6 Preview</Text>
            <Text style={styles.sectionSubtext}>
              Results tracking cohort — max 6 per league
              {slateSummary?.generatedPropCount != null
                ? ` · ${slateSummary.generatedPropCount} tracked from Best 6`
                : ""}
            </Text>
            {filteredBestSix.slice(0, 6).map((pick, index) => (
              <View key={`best6-${pick.player}-${index}`} style={styles.bestSixRow}>
                <Text style={styles.bestSixRank}>
                  #{pick.bestSixRank || pick.controlledBestSixRank || index + 1}
                </Text>
                <Text style={styles.bestSixText}>
                  {pick.player} {pick.pick || pick.side} {pick.line} ({pick.league})
                  {pick.riskAfterCeiling ? ` · ${pick.riskAfterCeiling}` : ""}
                  {pick.wnbaTrackingDecision ? ` · ${pick.wnbaTrackingDecision}` : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        {!loading && !loadError && filteredTopProps.length > 0 && (
          <View style={styles.topSection}>
            <Text style={styles.sectionTitle}>🔥 Top CourtEdge Props</Text>
            <Text style={styles.sectionSubtext}>
              Best calculated props across the board
            </Text>

            {groupedTopProps.map((section) => (
              <View key={`top-${section.bucket}`} style={styles.daySection}>
                <Text style={styles.daySectionTitle}>{section.label}</Text>
                {section.items.slice(0, 6).map((pick, index) =>
                  renderPickCard(pick, index)
                )}
              </View>
            ))}
          </View>
        )}

        {!loading && !loadError && filteredGames.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No games loaded yet.</Text>
            <Text style={styles.emptyText}>
              Refresh picks or check backend/API connection.
            </Text>
          </View>
        )}

        {!loading &&
          groupedGames.map((section) => (
            <View key={`games-${section.bucket}`} style={styles.daySection}>
              <Text style={styles.daySectionTitle}>{section.label}</Text>
              {section.items.map((game: any, gameIndex: number) => (
            <View
              key={`${section.bucket}-${game.gameId || game.game}-${gameIndex}`}
              style={styles.gameCard}
            >
              <View style={styles.gameHeaderRow}>
                <View>
                  <Text style={styles.dateLabel}>{game.dateLabel || ""}</Text>
                  <Text style={styles.gameTitle}>{game.game}</Text>
                  <Text style={styles.gameTime}>{formatTime(game.time)}</Text>
                </View>

                <Text style={styles.gameLeagueBadge}>{game.league}</Text>
              </View>

              <View style={styles.gameMetaRow}>
                <Text style={styles.gameMeta}>
                  Candidates: {game.allCandidateCount ?? 0}
                </Text>
                <Text style={styles.gameMeta}>
                  Playable: {game.playableCandidateCount ?? game.picks?.length ?? 0}
                </Text>
              </View>

              <Text style={styles.gameSectionTitle}>Top 4 Points Props</Text>

              {!game.picks || game.picks.length === 0 ? (
                <Text style={styles.noPicksText}>
                  {(game.consensusPropCount ?? game.rawPropCount ?? 0) === 0
                    ? "No player points props available for this game yet."
                    : "No ranked picks available for this game yet."}
                </Text>
              ) : (
                game.picks.map((pick: any, index: number) =>
                  renderPickCard(pick, index, game)
                )
              )}
            </View>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function safeDisplay(value: any) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);

  if (Number.isFinite(n)) {
    return Number(n.toFixed(1)).toString();
  }

  return String(value);
}

function formatTeam(value: any) {
  if (!value) return "—";

  const raw = String(value);

  if (raw.length <= 3) return raw.toUpperCase();

  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .toUpperCase();
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
    borderColor: "#1e293b",
    marginBottom: 16,
  },

  title: {
    color: "#22c55e",
    fontSize: 36,
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

  lastUpdated: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
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
    borderColor: "#22c55e",
    backgroundColor: "#052e16",
  },

  filterText: {
    color: "#94a3b8",
    textAlign: "center",
    fontWeight: "900",
  },

  activeFilterText: {
    color: "#86efac",
  },

  refreshButton: {
    backgroundColor: "#2563eb",
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

  topSection: {
    marginBottom: 22,
  },

  bestSixSection: {
    marginBottom: 18,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },

  bestSixRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },

  bestSixRank: {
    color: "#fbbf24",
    fontWeight: "900",
    fontSize: 13,
    width: 28,
  },

  bestSixText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },

  sectionTitle: {
    color: "#facc15",
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
    borderColor: "#1e3a5f",
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
    color: "#bfdbfe",
    backgroundColor: "#1e3a8a",
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

  pickCard: {
    backgroundColor: "#1e293b",
    padding: 15,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },

  premiumPickCard: {
    borderColor: "#facc15",
    backgroundColor: "#172033",
  },

  pickTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },

  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },

  rankBadge: {
    color: "#e2e8f0",
    backgroundColor: "#334155",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },

  leagueBadge: {
    color: "#bfdbfe",
    backgroundColor: "#1e40af",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },

  tierBadge: {
    color: "#bbf7d0",
    backgroundColor: "#14532d",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },

  premiumBadge: {
    color: "#fef9c3",
    backgroundColor: "#713f12",
  },

  confidenceText: {
    color: "#22c55e",
    fontSize: 24,
    fontWeight: "900",
  },

  playerName: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },

  teamText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 10,
  },

  pickLineBox: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263449",
    marginBottom: 12,
  },

  pickSide: {
    color: "#93c5fd",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },

  projectionText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },

  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
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
    fontSize: 14,
    fontWeight: "900",
  },

  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },

  statText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },

  reasonBox: {
    marginTop: 10,
    backgroundColor: "#052e16",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#166534",
  },

  reasonTitle: {
    color: "#86efac",
    fontWeight: "900",
    marginBottom: 4,
  },

  reasonText: {
    color: "#dcfce7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },

  riskBox: {
    marginTop: 10,
    backgroundColor: "#450a0a",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },

  riskTitle: {
    color: "#fecaca",
    fontWeight: "900",
    marginBottom: 4,
  },

  riskText: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },

  warningText: {
    color: "#fcd34d",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },

  saveHint: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "right",
  },

  emptyCard: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
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