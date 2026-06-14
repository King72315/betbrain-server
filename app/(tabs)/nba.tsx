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
import {
    fetchNBAPicks,
    refreshSavedPicks,
    savePick,
} from "../../services/api";
import { groupByDayBucket } from "../../utils/groupByDayBucket";

export default function NBAScreen() {
  const [games, setGames] = useState<any[]>([]);
  const [topProps, setTopProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    loadPicks();
  }, []);

  const premiumCount = useMemo(() => {
    return topProps.filter(
      (pick) => String(pick.tier || "").toUpperCase() === "PREMIUM"
    ).length;
  }, [topProps]);

  const playableCount = useMemo(() => {
    return games.reduce((sum, game) => {
      return sum + Number(game.playableCandidateCount || game.picks?.length || 0);
    }, 0);
  }, [games]);

  const groupedGames = useMemo(() => groupByDayBucket(games), [games]);
  const groupedTopProps = useMemo(() => groupByDayBucket(topProps), [topProps]);

  const loadPicks = async () => {
    try {
      setLoading(true);

      const data = await fetchNBAPicks();

      setGames(data.games || []);
      setTopProps(data.topProps || []);
      setLastUpdated(data.lastUpdated || null);
    } catch (err) {
      console.log("LOAD NBA PICKS ERROR:", err);
      setGames([]);
      setTopProps([]);
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
      console.log("REFRESH NBA PICKS ERROR:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePick = async (pick: any, game: any = {}) => {
    const saved = await savePick({
      ...pick,
      league: "NBA",
      game: pick.game || game.game,
      gameId: pick.gameId || game.gameId,
      date: pick.date || game.date,
      dateLabel: pick.dateLabel || game.dateLabel,
      commenceTime: pick.commenceTime || game.commenceTime || game.time,
      savedAt: new Date().toISOString(),
    });

    if (saved.ok) {
      Alert.alert("NBA Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

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
          <Text style={styles.title}>🏀 NBA Props</Text>
          <Text style={styles.subtitle}>CourtEdge — Powered by BetBrain</Text>
          <Text style={styles.motto}>
            SportsData projections • Rotation context • Market quality
          </Text>

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(lastUpdated)}
            </Text>
          )}
        </View>

        <TouchableOpacity
          onPress={runRefresh}
          style={styles.refreshButton}
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshText}>
            {loading || refreshing ? "Refreshing..." : "Refresh NBA Props"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <SummaryBox label="Games" value={games.length} />
          <SummaryBox label="Top Props" value={topProps.length} />
          <SummaryBox label="Premium" value={premiumCount} />
          <SummaryBox label="Playable" value={playableCount} />
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading NBA props...</Text>
        )}

        {!loading && topProps.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔥 Top NBA Props</Text>
            <Text style={styles.sectionSubtext}>
              Best NBA-only props ranked by confidence, support, risk, data, and market
            </Text>

            {groupedTopProps.map((section) => (
              <View key={`top-${section.bucket}`} style={styles.daySection}>
                <Text style={styles.daySectionTitle}>{section.label}</Text>
                {section.items.map((pick, index) => (
                  <PropCard
                    key={`${section.bucket}-${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                    pick={pick}
                    index={index}
                    onSave={() => handleSavePick(pick)}
                    showSaveHint
                  />
                ))}
              </View>
            ))}
          </View>
        )}

        {!loading && games.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No NBA games loaded.</Text>
            <Text style={styles.emptyText}>
              This may be normal if there are no NBA games or no player point props available.
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
                <View style={{ flex: 1 }}>
                  <Text style={styles.dateLabel}>{game.dateLabel || ""}</Text>
                  <Text style={styles.gameTitle}>{game.game}</Text>
                  <Text style={styles.gameTime}>{formatTime(game.time)}</Text>
                </View>

                <Text style={styles.leaguePill}>NBA</Text>
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
                game.picks.map((pick: any, index: number) => (
                  <PropCard
                    key={`${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                    pick={pick}
                    index={index}
                    game={game}
                    onSave={() => handleSavePick(pick, game)}
                    showSaveHint
                  />
                ))
              )}
            </View>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryBox({ label, value }: { label: string; value: any }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
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

  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 16,
  },

  title: {
    color: "#60a5fa",
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

  refreshButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 14,
  },

  refreshText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  },

  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
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
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "900",
  },

  loadingText: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },

  section: {
    marginBottom: 22,
  },

  sectionTitle: {
    color: "#60a5fa",
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

  leaguePill: {
    color: "#bfdbfe",
    backgroundColor: "#1e40af",
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