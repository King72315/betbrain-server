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

import {
    fetchWNBAPicks,
    refreshSavedPicks,
    savePick,
} from "../../services/api";

export default function WNBAScreen() {
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

  const loadPicks = async () => {
    try {
      setLoading(true);

      const data = await fetchWNBAPicks();

      setGames(data.games || []);
      setTopProps(data.topProps || []);
      setLastUpdated(data.lastUpdated || null);
    } catch (err) {
      console.log("LOAD WNBA PICKS ERROR:", err);
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
      console.log("REFRESH WNBA PICKS ERROR:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePick = async (pick: any, game: any = {}) => {
    const saved = await savePick({
      ...pick,
      league: "WNBA",
      game: pick.game || game.game,
      gameId: pick.gameId || game.gameId,
      date: pick.date || game.date,
      dateLabel: pick.dateLabel || game.dateLabel,
      commenceTime: pick.commenceTime || game.commenceTime || game.time,
      savedAt: new Date().toISOString(),
    });

    if (saved.ok) {
      Alert.alert("WNBA Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
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
          <Text style={styles.title}>🏀 WNBA Props</Text>
          <Text style={styles.subtitle}>CourtEdge — Powered by BetBrain</Text>
          <Text style={styles.motto}>
            BallDontLie recent form • Odds API market • WNBA thresholds
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
            {loading || refreshing ? "Refreshing..." : "Refresh WNBA Props"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <SummaryBox label="Games" value={games.length} />
          <SummaryBox label="Top Props" value={topProps.length} />
          <SummaryBox label="Premium" value={premiumCount} />
          <SummaryBox label="Playable" value={playableCount} />
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading WNBA props...</Text>
        )}

        {!loading && topProps.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🔥 Top WNBA Props</Text>
            <Text style={styles.sectionSubtext}>
              Best WNBA-only props ranked by confidence, support, risk, data, and market
            </Text>

            {topProps.map((pick, index) => (
              <PropCard
                key={`${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                pick={pick}
                index={index}
                onSave={() => handleSavePick(pick)}
              />
            ))}
          </View>
        )}

        {!loading && games.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No WNBA games loaded.</Text>
            <Text style={styles.emptyText}>
              Refresh picks or check Odds API / BallDontLie connection.
            </Text>
          </View>
        )}

        {!loading &&
          games.map((game, gameIndex) => (
            <View
              key={`${game.gameId || game.game}-${gameIndex}`}
              style={styles.gameCard}
            >
              <View style={styles.gameHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dateLabel}>{game.dateLabel || ""}</Text>
                  <Text style={styles.gameTitle}>{game.game}</Text>
                  <Text style={styles.gameTime}>{formatTime(game.time)}</Text>
                </View>

                <Text style={styles.leaguePill}>WNBA</Text>
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
                  No playable WNBA picks built for this game.
                </Text>
              ) : (
                game.picks.map((pick: any, index: number) => (
                  <PropCard
                    key={`${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                    pick={pick}
                    index={index}
                    onSave={() => handleSavePick(pick, game)}
                  />
                ))
              )}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function PropCard({
  pick,
  index,
  onSave,
}: {
  pick: any;
  index: number;
  onSave: () => void;
}) {
  const tier = String(pick.tier || "WATCHLIST").toUpperCase();
  const confidence = pick.confidence ?? pick.winProbability ?? 0;

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onSave}
      style={[styles.pickCard, tier === "PREMIUM" && styles.premiumPickCard]}
    >
      <View style={styles.pickTopRow}>
        <View style={styles.badgeRow}>
          <Text style={styles.rankBadge}>#{pick.rank || index + 1}</Text>
          <Text style={styles.leagueBadge}>WNBA</Text>
          <Text
            style={[
              styles.tierBadge,
              tier === "PREMIUM" && styles.premiumBadge,
            ]}
          >
            {tier}
          </Text>
        </View>

        <Text style={styles.confidenceText}>{safeDisplay(confidence)}%</Text>
      </View>

      <Text style={styles.playerName}>{pick.player}</Text>
      <Text style={styles.teamText}>
        {formatTeam(pick.team)} vs {formatTeam(pick.opponent)}
      </Text>

      <View style={styles.pickLineBox}>
        <Text style={styles.pickSide}>
          {pick.pick} {pick.line} Points
        </Text>
        <Text style={styles.projectionText}>
          Projection {safeDisplay(pick.projection)} • Edge {safeDisplay(pick.edge)}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <Metric label="Risk" value={pick.riskLabel || "—"} />
        <Metric label="Signal" value={pick.signalStrength || "—"} />
        <Metric label="Support" value={safeDisplay(pick.supportScore)} />
        <Metric
          label="Danger"
          value={safeDisplay(pick.resistanceScore ?? pick.dangerScore)}
        />
        <Metric label="Net Edge" value={safeDisplay(pick.netEdge)} />
        <Metric label="Books" value={safeDisplay(pick.bookCount)} />
        <Metric label="Data" value={`${safeDisplay(pick.dataQuality)}%`} />
        <Metric label="Market" value={`${safeDisplay(pick.marketQuality)}%`} />
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statText}>
          Last 5 Avg: {safeDisplay(pick.last5Average)}
        </Text>
        <Text style={styles.statText}>
          Season Avg: {safeDisplay(pick.seasonAverage)}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Text style={styles.statText}>
          Last 5 Hit: {safeDisplay(pick.last5HitRate)}%
        </Text>
        <Text style={styles.statText}>
          Line Spread: {safeDisplay(pick.lineSpread)}
        </Text>
      </View>

      {pick.reasons?.length > 0 && (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonTitle}>Support</Text>
          {pick.reasons.slice(0, 4).map((reason: string, i: number) => (
            <Text key={`${reason}-${i}`} style={styles.reasonText}>
              ✅ {reason}
            </Text>
          ))}
        </View>
      )}

      {pick.risks?.length > 0 && (
        <View style={styles.riskBox}>
          <Text style={styles.riskTitle}>Danger</Text>
          {pick.risks.slice(0, 3).map((risk: string, i: number) => (
            <Text key={`${risk}-${i}`} style={styles.riskText}>
              ⚠️ {risk}
            </Text>
          ))}
        </View>
      )}

      {pick.marketWarnings?.length > 0 && (
        <Text style={styles.warningText}>
          Market: {pick.marketWarnings.slice(0, 2).join(" • ")}
        </Text>
      )}

      <Text style={styles.saveHint}>Tap card to save WNBA pick</Text>
    </TouchableOpacity>
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

  const raw = String(value).toLowerCase();

  const map: Record<string, string> = {
    atlantadream: "ATLANTA DREAM",
    chicagosky: "CHICAGO SKY",
    connecticutsun: "CONNECTICUT SUN",
    dallaswings: "DALLAS WINGS",
    goldenstatevalkyries: "GOLDEN STATE VALKYRIES",
    indianafever: "INDIANA FEVER",
    lasvegasaces: "LAS VEGAS ACES",
    losangelessparks: "LOS ANGELES SPARKS",
    minnesotalynx: "MINNESOTA LYNX",
    newyorkliberty: "NEW YORK LIBERTY",
    phoenixmercury: "PHOENIX MERCURY",
    seattlestorm: "SEATTLE STORM",
    washingtonmystics: "WASHINGTON MYSTICS",
  };

  if (map[raw]) return map[raw];

  if (raw.length <= 4) return raw.toUpperCase();

  return raw.toUpperCase();
}

function formatTime(value: any) {
  if (!value) return "";

  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);

  return (
    d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " CT"
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
    color: "#f472b6",
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
    backgroundColor: "#be185d",
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

  leaguePill: {
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
    color: "#fce7f3",
    backgroundColor: "#be185d",
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