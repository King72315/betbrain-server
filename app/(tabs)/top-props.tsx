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

const TOP_PROP_LIMIT = 2;

type DisplayCard = {
  pick: any;
  playType: "Official" | "Test";
};

export default function TopPropsScreen() {
  const [topProps, setTopProps] = useState<any[]>([]);
  const [topOfficialProps, setTopOfficialProps] = useState<any[]>([]);
  const [topTestProps, setTopTestProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadTopProps();
  }, []);

  const visibleOfficialProps = useMemo(() => {
    const props = topOfficialProps.length
      ? topOfficialProps
      : topProps.filter((pick) => pick.officialEligible !== false);
    return props.slice(0, TOP_PROP_LIMIT);
  }, [topOfficialProps, topProps]);

  const visibleTestProps = useMemo(() => {
    const remaining = Math.max(0, TOP_PROP_LIMIT - visibleOfficialProps.length);
    const props = topTestProps.length
      ? topTestProps
      : topProps.filter((pick) => pick.officialEligible === false);
    return props.slice(0, remaining);
  }, [topTestProps, topProps, visibleOfficialProps.length]);

  const displayCards = useMemo<DisplayCard[]>(() => {
    const cards: DisplayCard[] = visibleOfficialProps.map((pick) => ({
      pick,
      playType: "Official" as const,
    }));
    for (const pick of visibleTestProps) {
      cards.push({ pick, playType: "Test" });
    }
    return cards.slice(0, TOP_PROP_LIMIT);
  }, [visibleOfficialProps, visibleTestProps]);

  const loadTopProps = async () => {
    try {
      setLoading(true);

      const data = await fetchTopProps();

      setTopProps(data.topProps || []);
      setTopOfficialProps(data.topOfficialProps || []);
      setTopTestProps(data.topTestProps || []);
      setLastUpdated(data.lastUpdated || null);
      setLoadError(formatApiLoadError(data));
    } catch (err) {
      console.log("LOAD TOP PROPS ERROR:", err);
      setTopProps([]);
      setTopOfficialProps([]);
      setTopTestProps([]);
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

    if (saved.ok) {
      Alert.alert("Pick Saved", `${pick.player} ${pick.pick} ${pick.line}`);
    } else {
      Alert.alert("Save Failed", saved.message || "Could not save pick.");
    }
  };

  const getReportText = () =>
    buildTopPropsReport({
      cards: displayCards,
      lastUpdated,
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
          <CopyReportButton
            getReportText={getReportText}
            label="Copy Top Props"
          />
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading top props...</Text>
        )}

        <LoadErrorBanner message={loadError} />

        {!loading && !loadError && displayCards.length === 0 && (
          <Text style={styles.emptyText}>No top props available.</Text>
        )}

        {!loading &&
          displayCards.map(({ pick, playType }, index) => (
            <PropCard
              key={`${playType}-${pick.player}-${pick.team}-${pick.line}-${pick.pick}-${index}`}
              pick={pick}
              index={index}
              playType={playType}
              compact
              onSave={() => handleSavePick(pick)}
              showSaveHint
            />
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
  },
});
