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

import PropCard from "../../components/PropCard";
import CopyReportButton from "../../components/CopyReportButton";
import FilterAuditCard from "../../components/FilterAuditCard";
import LoadErrorBanner from "../../components/LoadErrorBanner";
import {
    fetchTopProps,
    refreshSavedPicks,
    savePick,
} from "../../services/api";
import { type FilterAudit } from "../../utils/filterAudit";
import { formatApiLoadError } from "../../utils/apiLoadError";
import { groupByDayBucket } from "../../utils/groupByDayBucket";
import { buildTopPropsReport } from "../../utils/reportBuilders";

const FILTERS = ["ALL", "NBA", "WNBA"] as const;
const WNBA_SHADOW_UI =
  process.env.EXPO_PUBLIC_WNBA_SHADOW_RECALIBRATION === "true";

type LeagueFilter = (typeof FILTERS)[number];

export default function TopPropsScreen() {
  const [topProps, setTopProps] = useState<any[]>([]);
  const [topOfficialProps, setTopOfficialProps] = useState<any[]>([]);
  const [topTestProps, setTopTestProps] = useState<any[]>([]);
  const [topNBAProps, setTopNBAProps] = useState<any[]>([]);
  const [topWNBAProps, setTopWNBAProps] = useState<any[]>([]);
  const [topWNBAOfficialProps, setTopWNBAOfficialProps] = useState<any[]>([]);
  const [topWNBATestProps, setTopWNBATestProps] = useState<any[]>([]);
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [filterAudit, setFilterAudit] = useState<FilterAudit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadTopProps();
  }, []);

  const visibleProps = useMemo(() => {
    if (leagueFilter === "NBA") return topNBAProps;
    if (leagueFilter === "WNBA") return topWNBAProps;
    return topProps;
  }, [leagueFilter, topProps, topNBAProps, topWNBAProps]);

  const visibleOfficialProps = useMemo(() => {
    if (leagueFilter === "NBA") {
      return topNBAProps.filter((pick) => pick.officialEligible !== false);
    }
    if (leagueFilter === "WNBA") {
      return topWNBAOfficialProps.length
        ? topWNBAOfficialProps
        : topWNBAProps.filter((pick) => pick.officialEligible !== false);
    }
    return topOfficialProps.length
      ? topOfficialProps
      : topProps.filter((pick) => pick.officialEligible !== false);
  }, [
    leagueFilter,
    topOfficialProps,
    topWNBAOfficialProps,
    topNBAProps,
    topWNBAProps,
    topProps,
  ]);

  const visibleTestProps = useMemo(() => {
    if (leagueFilter === "NBA") {
      return topNBAProps.filter((pick) => pick.officialEligible === false);
    }
    if (leagueFilter === "WNBA") {
      return topWNBATestProps.length
        ? topWNBATestProps
        : topWNBAProps.filter((pick) => pick.officialEligible === false);
    }
    return topTestProps.length
      ? topTestProps
      : topProps.filter((pick) => pick.officialEligible === false);
  }, [
    leagueFilter,
    topTestProps,
    topWNBATestProps,
    topNBAProps,
    topWNBAProps,
    topProps,
  ]);

  const groupedOfficialProps = useMemo(
    () => groupByDayBucket(visibleOfficialProps),
    [visibleOfficialProps]
  );

  const groupedTestProps = useMemo(
    () => groupByDayBucket(visibleTestProps),
    [visibleTestProps]
  );

  const loadTopProps = async () => {
    try {
      setLoading(true);

      const data = await fetchTopProps();

      setTopProps(data.topProps || []);
      setTopOfficialProps(data.topOfficialProps || []);
      setTopTestProps(data.topTestProps || []);
      setTopNBAProps(data.topNBAProps || []);
      setTopWNBAProps(data.topWNBAProps || []);
      setTopWNBAOfficialProps(data.topWNBAOfficialProps || []);
      setTopWNBATestProps(data.topWNBATestProps || []);
      setLastUpdated(data.lastUpdated || null);
      setFilterAudit(data.filterAudit || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log("LOAD TOP PROPS ERROR:", err);
      setTopProps([]);
      setTopOfficialProps([]);
      setTopTestProps([]);
      setTopNBAProps([]);
      setTopWNBAProps([]);
      setTopWNBAOfficialProps([]);
      setTopWNBATestProps([]);
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const runRefresh = async () => {
    try {
      setRefreshing(true);
      const refreshed = await refreshSavedPicks();
      setFilterAudit(refreshed.filterAudit || null);
      await loadTopProps();
    } catch (err) {
      console.log("REFRESH TOP PROPS ERROR:", err);
      setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleSavePick = async (pick: any) => {
    const saved = await savePick({
      ...pick,
      league: pick.league || "NBA",
      gameDate: pick.gameDate || pick.date,
      commenceTime: pick.commenceTime || pick.time,
      startTimeDisplay: pick.startTimeDisplay,
      savedAt: new Date().toISOString(),
    });

    if (saved.ok) {
      Alert.alert("Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

  const formatTime = (value: any) => {
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
  };

  const premiumCount = visibleProps.filter(
    (pick) => String(pick.tier || "").toUpperCase() === "PREMIUM"
  ).length;

  const wnbaOfficialCount = visibleOfficialProps.length;

  const showNoOfficialWnba =
    leagueFilter === "WNBA" &&
    !loading &&
    !loadError &&
    wnbaOfficialCount === 0 &&
    visibleTestProps.length > 0;

  const getReportText = () =>
    buildTopPropsReport({
      visibleProps,
      leagueFilter,
      lastUpdated,
      loading,
      premiumCount,
      topPropsCount: topProps.length,
      topNBACount: topNBAProps.length,
      topWNBACount: topWNBAProps.length,
      filterAudit,
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
          <Text style={styles.title}>Best 2 Props</Text>
          <Text style={styles.subtitle}>CourtEdge — Powered by BetBrain</Text>
          <Text style={styles.motto}>
            Top 2 by Best Prop Score — official auto-tracks to Results; test plays are learning-only.
          </Text>
          {WNBA_SHADOW_UI ? (
            <Text style={styles.shadowNote}>
              WNBA shadow recalibration active — badges show shadow tier only, not official.
            </Text>
          ) : null}

          {lastUpdated && (
            <Text style={styles.lastUpdated}>
              Last updated: {formatTime(lastUpdated)}
            </Text>
          )}
          <CopyReportButton getReportText={getReportText} />
        </View>

        <FilterAuditCard audit={filterAudit} />

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
          disabled={loading || refreshing}
        >
          <Text style={styles.refreshText}>
            {loading || refreshing ? "Refreshing..." : "Refresh Top Props"}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Props</Text>
            <Text style={styles.summaryValue}>{visibleProps.length}</Text>
          </View>

          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>Premium</Text>
            <Text style={styles.summaryValue}>{premiumCount}</Text>
          </View>

          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>League</Text>
            <Text style={styles.summaryValue}>{leagueFilter}</Text>
          </View>
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading top props...</Text>
        )}

        <LoadErrorBanner message={loadError} />

        {!loading && !loadError && visibleProps.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No top props available.</Text>
            <Text style={styles.emptyText}>
              Refresh picks or check backend/API connection.
            </Text>
          </View>
        )}

        {showNoOfficialWnba && (
          <View style={styles.noOfficialCard}>
            <Text style={styles.noOfficialTitle}>No Official Plays Found</Text>
            <Text style={styles.noOfficialText}>
              WNBA v2 reader found test/learning plays only — none passed official
              gates for Results auto-tracking. Plays below are learning-only.
            </Text>
          </View>
        )}

        {!loading && visibleOfficialProps.length > 0 && (
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>Official Plays</Text>
            <Text style={styles.sectionHeaderSub}>
              Auto-tracked to Results when eligible
            </Text>
          </View>
        )}

        {!loading &&
          groupedOfficialProps.map((section) => (
            <View key={`official-${section.bucket}`} style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>{section.label}</Text>
              {section.items.map((pick, index) => (
                <PropCard
                  key={`official-${section.bucket}-${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                  pick={pick}
                  index={index}
                  onSave={() => handleSavePick(pick)}
                  showSaveHint
                />
              ))}
            </View>
          ))}

        {!loading && visibleTestProps.length > 0 && (
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionHeaderTitle}>Test / Learning</Text>
            <Text style={styles.sectionHeaderSub}>
              Shadow mode — save optional, not official Results
            </Text>
          </View>
        )}

        {!loading &&
          groupedTestProps.map((section) => (
            <View key={`test-${section.bucket}`} style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>{section.label}</Text>
              {section.items.map((pick, index) => (
                <PropCard
                  key={`test-${section.bucket}-${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
                  pick={pick}
                  index={index}
                  onSave={() => handleSavePick(pick)}
                  showSaveHint
                />
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
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
    color: "#facc15",
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

  shadowNote: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
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
    gap: 10,
    marginBottom: 18,
  },

  summaryBox: {
    flex: 1,
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

  noOfficialCard: {
    backgroundColor: "#1a1424",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#7c3aed",
  },

  noOfficialTitle: {
    color: "#c4b5fd",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
  },

  noOfficialText: {
    color: "#a78bfa",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },

  sectionHeaderBlock: {
    marginTop: 4,
    marginBottom: 10,
  },

  sectionHeaderTitle: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "900",
  },

  sectionHeaderSub: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },

  sectionBlock: {
    marginBottom: 18,
  },

  sectionTitle: {
    color: "#facc15",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 10,
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

  gameText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4,
  },

  timeText: {
    color: "#64748b",
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
});