import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  fetchTrackedAnalytics,
  fetchTrackedProps,
  resolveTrackedProps,
} from "../../services/api";

function formatRecord(record: {
  wins?: number;
  losses?: number;
  pushes?: number;
  accuracy?: number;
}) {
  const wins = record.wins || 0;
  const losses = record.losses || 0;
  const pushes = record.pushes || 0;
  const accuracy = record.accuracy ?? 0;

  return `${wins}-${losses}-${pushes} (${accuracy}%)`;
}

export default function PropLab() {
  const [props, setProps] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (forceResolve = false) => {
    try {
      setLoading(true);

      if (forceResolve) {
        await resolveTrackedProps({ requireLikelyFinished: false });
      }

      const [propsData, analyticsData] = await Promise.all([
        fetchTrackedProps(),
        fetchTrackedAnalytics(),
      ]);

      setProps(propsData.props || []);
      setAnalytics(analyticsData.analytics || null);
    } catch (err) {
      console.log("LOAD PROP LAB ERROR:", err);
      setProps([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async () => {
    try {
      setRefreshing(true);
      await resolveTrackedProps({ requireLikelyFinished: true });

      const [propsData, analyticsData] = await Promise.all([
        fetchTrackedProps(),
        fetchTrackedAnalytics(),
      ]);

      setProps(propsData.props || []);
      setAnalytics(analyticsData.analytics || null);
    } catch (err) {
      console.log("REFRESH PROP LAB ERROR:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData(false);
    }, [])
  );

  const pendingCount = useMemo(() => {
    return props.filter(
      (item) => String(item.status || "pending").toLowerCase() === "pending"
    ).length;
  }, [props]);

  const gradedCount = useMemo(() => {
    return props.filter((item) =>
      ["win", "loss", "push"].includes(String(item.status || "").toLowerCase())
    ).length;
  }, [props]);

  const topBuckets = useMemo(() => {
    const byTier = analytics?.byTier || {};
    return Object.entries(byTier)
      .map(([bucket, stats]: [string, any]) => ({
        bucket,
        ...stats,
      }))
      .sort((a, b) => (b.graded || 0) - (a.graded || 0))
      .slice(0, 4);
  }, [analytics]);

  const sideComparison = analytics?.overall?.sideComparison || {};
  const auditMatch = analytics?.overall?.auditSideMatch || { match: 0, mismatch: 0 };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshData} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>Prop Lab</Text>
          <Text style={styles.subtitle}>Auto-Tracked Props (Research)</Text>
          <Text style={styles.note}>
            Every display pick from refresh is tracked here. Saved Picks are separate.
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Tracking Summary</Text>
          <Text style={styles.summaryLine}>Total tracked: {props.length}</Text>
          <Text style={styles.summaryLine}>Pending: {pendingCount}</Text>
          <Text style={styles.summaryLine}>Graded: {gradedCount}</Text>
          {loading ? <Text style={styles.muted}>Loading...</Text> : null}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Engine vs Fair Line Shadow</Text>
          <Text style={styles.summaryLine}>
            Current engine:{" "}
            {formatRecord(analytics?.overall?.currentEngine || {})}
          </Text>
          <Text style={styles.summaryLine}>
            Fair line shadow:{" "}
            {formatRecord(analytics?.overall?.fairLineShadow || {})}
          </Text>
          <Text style={styles.summaryLine}>
            Side match: {auditMatch.match || 0} | mismatch:{" "}
            {auditMatch.mismatch || 0}
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Side Comparison Outcomes</Text>
          {Object.keys(sideComparison).length === 0 ? (
            <Text style={styles.muted}>No graded comparisons yet.</Text>
          ) : (
            Object.entries(sideComparison).map(([key, count]) => (
              <Text key={key} style={styles.summaryLine}>
                {key}: {String(count)}
              </Text>
            ))
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Top Tier Buckets</Text>
          {topBuckets.length === 0 ? (
            <Text style={styles.muted}>No bucket data yet.</Text>
          ) : (
            topBuckets.map((bucket) => (
              <Text key={bucket.bucket} style={styles.summaryLine}>
                {bucket.bucket}: {bucket.wins || 0}-{bucket.losses || 0} graded{" "}
                {bucket.graded || 0}
              </Text>
            ))
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Recent Tracked Props</Text>
          {props.slice(0, 12).map((item) => (
            <View key={item.trackedId || item.trackedKey} style={styles.propRow}>
              <Text style={styles.propTitle}>
                {item.player} {item.currentEngineSide} {item.line} ({item.league})
              </Text>
              <Text style={styles.propMeta}>
                Fair: {item.fairLineSide || "NONE"} | Tier: {item.tier || "—"} |{" "}
                {String(item.status || "pending").toUpperCase()}
              </Text>
              {item.sideComparison ? (
                <Text style={styles.propMeta}>Compare: {item.sideComparison}</Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  title: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 4,
    fontWeight: "700",
  },
  note: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  summaryCard: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    gap: 6,
  },
  summaryTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  summaryLine: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "600",
  },
  muted: {
    color: "#64748b",
    fontSize: 12,
  },
  propRow: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
    marginTop: 8,
    gap: 2,
  },
  propTitle: {
    color: "#f1f5f9",
    fontSize: 13,
    fontWeight: "700",
  },
  propMeta: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
  },
});
