import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import PropCard from "../../components/PropCard";
import CopyReportButton from "../../components/CopyReportButton";
import LoadErrorBanner from "../../components/LoadErrorBanner";
import {
  fetchTopProps,
  refreshSavedPicks,
  savePick,
} from "../../services/api";
import { formatApiLoadError } from "../../utils/apiLoadError";
import { buildTopPropsReport } from "../../utils/reportBuilders";
import {
  TOP_DATE_VIEW,
  filterPicksByDateView,
} from "../../utils/controlledBestSixDisplay";
import { getTodayLocalDate } from "../../utils/slateRotation";
import { formatSlateMessageDate } from "../../utils/slateMessages";

type DisplayCard = {
  pick: any;
  playType: "Official" | "Test";
};

function resolvePlayType(pick: any): "Official" | "Test" {
  if (pick.officialEligible === false) return "Test";
  return "Official";
}

function enrichPickForDisplay(pick: any, index: number, league: "NBA" | "WNBA") {
  const rank = pick.leagueRank || pick.topPropRank || index + 1;
  return {
    ...pick,
    league,
    topPropRank: rank,
    topPickRank: rank,
    topPickLabel: pick.topPickLabel || `Top ${league} #${rank}`,
  };
}

export default function TopPropsScreen() {
  const [topNBAProps, setTopNBAProps] = useState<any[]>([]);
  const [topWNBAProps, setTopWNBAProps] = useState<any[]>([]);
  const [topPropsSource, setTopPropsSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadTopProps();
  }, []);

  const nbaCards = useMemo<DisplayCard[]>(() => {
    return filterPicksByDateView(topNBAProps, TOP_DATE_VIEW).map((pick, index) => ({
      pick: enrichPickForDisplay(pick, index, "NBA"),
      playType: resolvePlayType(pick),
    }));
  }, [topNBAProps]);

  const wnbaCards = useMemo<DisplayCard[]>(() => {
    return filterPicksByDateView(topWNBAProps, TOP_DATE_VIEW).map((pick, index) => ({
      pick: enrichPickForDisplay(pick, index, "WNBA"),
      playType: resolvePlayType(pick),
    }));
  }, [topWNBAProps]);

  const loadTopProps = async () => {
    try {
      setLoading(true);

      const data = await fetchTopProps();

      setTopNBAProps(data.topNBAProps || []);
      setTopWNBAProps(data.topWNBAProps || []);
      setTopPropsSource(data.topPropsSource || null);
      setLastUpdated(data.lastUpdated || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log("LOAD TOP PROPS ERROR:", err);
      setTopNBAProps([]);
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

    const slateDate = String(pick.gameDate || pick.date || getTodayLocalDate()).slice(0, 10);

    if (saved.ok) {
      Alert.alert(
        "Pick Saved",
        `${formatSlateMessageDate(slateDate)} slate: ${pick.player} ${pick.pick} ${pick.line}`
      );
    } else {
      Alert.alert(
        "Save Failed",
        saved.message || `Could not save pick for ${formatSlateMessageDate(slateDate)} slate.`
      );
    }
  };

  const getReportText = () =>
    buildTopPropsReport({
      nbaCards,
      wnbaCards,
      lastUpdated,
    });

  const renderSection = (
    title: string,
    cards: DisplayCard[],
    emptyMessage: string,
    sectionKey: string
  ) => (
    <View style={styles.sectionCard} key={sectionKey}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!loading && !loadError && cards.length === 0 ? (
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      ) : null}
      {!loading &&
        cards.map(({ pick, playType }, index) => (
          <PropCard
            key={`${sectionKey}-${playType}-${pick.player}-${pick.team}-${pick.line}-${index}`}
            pick={pick}
            index={index}
            playType={playType}
            compact
            onSave={() => handleSavePick(pick)}
            showSaveHint
          />
        ))}
    </View>
  );

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
          <Text style={styles.title}>Top Props</Text>
          <Text style={styles.subtitle}>Tomorrow — Best 2 per league</Text>
          {topPropsSource === "CONTROLLED_BEST_SIX" ? (
            <Text style={styles.sourceLine}>Selected from controlled Best 6</Text>
          ) : null}
          <CopyReportButton
            getReportText={getReportText}
            label="Copy Top Props"
          />
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading top props...</Text>
        )}

        <LoadErrorBanner message={loadError} />

        {!loading && !loadError ? (
          <>
            {renderSection(
              "Best 2 NBA Props",
              nbaCards,
              "No NBA props for tomorrow.",
              "nba"
            )}
            {renderSection(
              "Best 2 WNBA Props",
              wnbaCards,
              "No WNBA props for tomorrow.",
              "wnba"
            )}
          </>
        ) : null}
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
    color: "#86efac",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 4,
  },

  sourceLine: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },

  sectionCard: {
    marginBottom: 20,
  },

  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 12,
  },

  loadingText: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
  },

  emptyText: {
    color: "#94a3b8",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
});
