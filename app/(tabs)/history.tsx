import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import CopyReportButton from "../../components/CopyReportButton";
import PropCard, {
  ResultMarginText,
  formatTime,
  safeDisplay,
} from "../../components/PropCard";
import { checkPendingResults, fetchPickHistory } from "../../services/api";
import { buildResultsReport } from "../../utils/reportBuilders";

const RISK_GROUPS = ["Low Risk", "Medium Risk", "High Risk"] as const;

export default function History() {
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingPending, setCheckingPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastCheckResponse, setLastCheckResponse] = useState<any>(null);
  const loadIdRef = useRef(0);

  const applyPicks = (nextPicks: any[], loadId: number) => {
    if (loadId !== loadIdRef.current) return;
    if (Array.isArray(nextPicks)) {
      setPicks(nextPicks);
    }
  };

  const loadHistoryPicks = async (
    resolvedPicks: any[] | null = null,
    loadId = loadIdRef.current
  ) => {
    const data = await fetchPickHistory();

    if (data.ok && Array.isArray(data.picks)) {
      applyPicks(data.picks, loadId);
      return data.picks;
    }

    if (Array.isArray(resolvedPicks) && resolvedPicks.length) {
      applyPicks(resolvedPicks, loadId);
      return resolvedPicks;
    }

    return null;
  };

  const loadHistory = async (forceCheck = false) => {
    const loadId = ++loadIdRef.current;

    try {
      setLoading(true);
      const checked = await checkPendingResults({ force: forceCheck });
      setLastCheckResponse(checked);
      const resolvedPicks =
        checked.ok && Array.isArray(checked.picks) ? checked.picks : null;
      await loadHistoryPicks(resolvedPicks, loadId);
      setLoadError(null);
    } catch (err) {
      console.log("LOAD HISTORY ERROR:", err);
      setLoadError(String(err));
    } finally {
      if (loadId === loadIdRef.current) {
        setLoading(false);
      }
    }
  };

  const refreshHistory = async () => {
    const loadId = ++loadIdRef.current;

    try {
      setRefreshing(true);
      const checked = await checkPendingResults({ force: true });
      setLastCheckResponse(checked);
      const resolvedPicks =
        checked.ok && Array.isArray(checked.picks) ? checked.picks : null;
      await loadHistoryPicks(resolvedPicks, loadId);
    } catch (err) {
      console.log("REFRESH HISTORY ERROR:", err);
      setLoadError(String(err));
    } finally {
      if (loadId === loadIdRef.current) {
        setRefreshing(false);
      }
    }
  };

  const handleCheckPendingResults = async () => {
    const loadId = ++loadIdRef.current;

    try {
      setCheckingPending(true);
      const checked = await checkPendingResults({
        force: true,
        requireLikelyFinished: true,
      });
      setLastCheckResponse(checked);
      const resolvedPicks =
        checked.ok && Array.isArray(checked.picks) ? checked.picks : null;
      await loadHistoryPicks(resolvedPicks, loadId);
    } catch (err) {
      console.log("CHECK PENDING RESULTS ERROR:", err);
      setLoadError(String(err));
    } finally {
      if (loadId === loadIdRef.current) {
        setCheckingPending(false);
      }
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadHistory(false);
    }, [])
  );

  const gradedPicks = useMemo(() => {
    return picks
      .filter((pick) => ["Win", "Loss", "Push"].includes(getStatus(pick)))
      .sort((a, b) => {
        const aTime = new Date(
          a.resolvedAt || a.gradedAt || a.completedDate || a.updatedAt || 0
        ).getTime();

        const bTime = new Date(
          b.resolvedAt || b.gradedAt || b.completedDate || b.updatedAt || 0
        ).getTime();

        return bTime - aTime;
      });
  }, [picks]);

  const pendingCount = picks.filter((pick) => getStatus(pick) === "Pending").length;

  const overall = useMemo(() => buildRecord(gradedPicks), [gradedPicks]);

  const premiumRecord = useMemo(() => {
    return buildRecord(
      gradedPicks.filter(
        (pick) => String(pick.tier || "").toUpperCase() === "PREMIUM"
      )
    );
  }, [gradedPicks]);

  const nbaRecord = useMemo(() => {
    return buildRecord(gradedPicks.filter((pick) => pick.league === "NBA"));
  }, [gradedPicks]);

  const wnbaRecord = useMemo(() => {
    return buildRecord(gradedPicks.filter((pick) => pick.league === "WNBA"));
  }, [gradedPicks]);

  const confidenceBuckets = useMemo(() => {
    const buckets: Record<string, any[]> = {};

    for (const pick of gradedPicks) {
      const bucket = getConfidenceBucket(pick);
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(pick);
    }

    return Object.entries(buckets)
      .map(([bucket, bucketPicks]) => ({
        bucket,
        ...buildRecord(bucketPicks),
      }))
      .sort((a, b) => bucketSortValue(b.bucket) - bucketSortValue(a.bucket));
  }, [gradedPicks]);

  const groupedByRisk = useMemo(() => {
    const groups: Record<string, any[]> = {
      "Low Risk": [],
      "Medium Risk": [],
      "High Risk": [],
      Unknown: [],
    };

    for (const pick of picks) {
      const bucket = normalizeRiskLabel(pick.riskLabel);
      groups[bucket].push(pick);
    }

    return groups;
  }, [picks]);

  const riskSummaries = useMemo(() => {
    return RISK_GROUPS.map((label) => ({
      label,
      ...buildRiskRecord(groupedByRisk[label] || [], picks),
    }));
  }, [groupedByRisk, picks]);

  const getReportText = () =>
    buildResultsReport({
      picks,
      overall,
      pendingCount,
      premiumRecord,
      nbaRecord,
      wnbaRecord,
      confidenceBuckets,
      riskSummaries,
      gradedPicks,
      loading,
      lastCheckResponse,
      error: loadError,
    });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshHistory} />
        }
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>📈 Results History</Text>
          <Text style={styles.subtitle}>CourtEdge Calibration Center</Text>
          <Text style={styles.motto}>
            Every result tightens the next confidence score.
          </Text>
          <CopyReportButton getReportText={getReportText} />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Overall Performance</Text>

          <View style={styles.recordGrid}>
            <SummaryBox label="Graded" value={overall.total} color="#f8fafc" />
            <SummaryBox label="Wins" value={overall.wins} color="#22c55e" />
            <SummaryBox label="Losses" value={overall.losses} color="#ef4444" />
            <SummaryBox label="Pushes" value={overall.pushes} color="#facc15" />
            <SummaryBox label="Win Rate" value={`${overall.winRate}%`} color="#38bdf8" />
            <SummaryBox
              label="Net Units"
              value={`${overall.netUnits > 0 ? "+" : ""}${overall.netUnits}`}
              color={overall.netUnits >= 0 ? "#22c55e" : "#ef4444"}
            />
          </View>

          <Text style={styles.pendingText}>Pending Picks: {pendingCount}</Text>

          <TouchableOpacity
            onPress={handleCheckPendingResults}
            style={styles.checkButton}
            disabled={checkingPending || loading || refreshing}
          >
            <Text style={styles.checkButtonText}>
              {checkingPending ? "Checking..." : "Check Pending Results"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Premium Mission</Text>
          <BreakdownRow title="Premium" record={premiumRecord} />
          <BreakdownRow title="NBA" record={nbaRecord} />
          <BreakdownRow title="WNBA" record={wnbaRecord} />
        </View>

        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Confidence Buckets</Text>

          {confidenceBuckets.length === 0 ? (
            <Text style={styles.emptySmall}>No confidence bucket data yet.</Text>
          ) : (
            confidenceBuckets.map((bucket) => (
              <BreakdownRow
                key={bucket.bucket}
                title={bucket.bucket}
                record={bucket}
              />
            ))
          )}
        </View>

        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Results By Risk</Text>

          {riskSummaries.map((group) => (
            <View key={group.label} style={styles.riskGroupCard}>
              <Text style={styles.riskGroupTitle}>{group.label}</Text>
              <Text style={styles.riskGroupSummary}>
                Total {group.total} • W {group.wins} • L {group.losses} • P{" "}
                {group.pushes} • Hit {group.hitRate}% • Pending {group.pending}
              </Text>
              <Text style={styles.riskGroupSummary}>
                Avg Win Margin {safeDisplay(group.avgWinMargin)} • Avg Loss Margin{" "}
                {safeDisplay(group.avgLossMargin)}
              </Text>
              <Text style={styles.riskGroupSummary}>
                Best Win {formatMargin(group.biggestWinMargin)} • Worst Loss{" "}
                {formatMargin(group.biggestLossMargin)}
              </Text>

              {group.picks.length === 0 ? (
                <Text style={styles.emptySmall}>No picks in this risk bucket.</Text>
              ) : (
                group.picks
                  .sort((a, b) => getRiskSortValue(b) - getRiskSortValue(a))
                  .map((pick, index) => (
                    <View
                      key={`${group.label}-${pick.id || pick.pickKey || pick.player}-${index}`}
                      style={[
                        styles.card,
                        getStatus(pick) === "Win" && styles.winCard,
                        getStatus(pick) === "Loss" && styles.lossCard,
                        getStatus(pick) === "Push" && styles.pushCard,
                      ]}
                    >
                      <PropCard pick={pick} index={index} />
                      <View style={styles.resultBox}>
                        <Text style={styles.pickText}>
                          {pick.side || pick.pick} {safeDisplay(pick.line ?? pick.sportsbookLine)}{" "}
                          {pick.stat || "Points"}
                        </Text>
                        <ResultMarginText pick={pick} />
                      </View>
                    </View>
                  ))
              )}
            </View>
          ))}
        </View>

        {loading && (
          <Text style={styles.loadingText}>Loading results history...</Text>
        )}

        {!loading && gradedPicks.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No completed picks yet.</Text>
            <Text style={styles.emptyText}>
              Saved picks will appear here after CourtEdge grades them.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function normalizeRiskLabel(value: any) {
  const label = String(value || "").toLowerCase();

  if (label.includes("low")) return "Low Risk";
  if (label.includes("medium")) return "Medium Risk";
  if (label.includes("high")) return "High Risk";

  return "Unknown";
}

function buildRiskRecord(groupPicks: any[], allPicks: any[]) {
  const graded = groupPicks.filter((pick) =>
    ["Win", "Loss", "Push"].includes(getStatus(pick))
  );
  const pending = groupPicks.filter((pick) => getStatus(pick) === "Pending").length;
  const wins = graded.filter((pick) => getStatus(pick) === "Win");
  const losses = graded.filter((pick) => getStatus(pick) === "Loss");
  const pushes = graded.filter((pick) => getStatus(pick) === "Push");

  const winMargins = wins
    .map((pick) => Number(pick.resultMargin ?? pick.margin))
    .filter(Number.isFinite);
  const lossMargins = losses
    .map((pick) => Number(pick.resultMargin ?? pick.margin))
    .filter(Number.isFinite);

  const avgWinMargin = winMargins.length
    ? winMargins.reduce((sum, value) => sum + value, 0) / winMargins.length
    : 0;
  const avgLossMargin = lossMargins.length
    ? lossMargins.reduce((sum, value) => sum + value, 0) / lossMargins.length
    : 0;

  return {
    picks: groupPicks,
    total: groupPicks.length,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    pending,
    hitRate:
      wins.length + losses.length > 0
        ? Math.round((wins.length / (wins.length + losses.length)) * 100)
        : 0,
    avgWinMargin,
    avgLossMargin,
    biggestWinMargin: winMargins.length ? Math.max(...winMargins) : 0,
    biggestLossMargin: lossMargins.length ? Math.min(...lossMargins) : 0,
  };
}

function getRiskSortValue(pick: any) {
  const status = getStatus(pick);
  const margin = Math.abs(Number(pick.resultMargin ?? pick.margin ?? 0));

  if (status === "Win") return 1000 + margin;
  if (status === "Loss") return 500 + margin;
  if (status === "Push") return 100;

  return 0;
}

function formatMargin(value: any) {
  const n = Number(value);

  if (!Number.isFinite(n) || n === 0) return "—";

  return `${n > 0 ? "+" : ""}${safeDisplay(n)}`;
}

function SummaryBox({
  label,
  value,
  color,
}: {
  label: string;
  value: any;
  color: string;
}) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

function BreakdownRow({ title, record }: { title: string; record: any }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownTitle}>{title}</Text>
      <Text style={styles.breakdownText}>
        {record.wins}-{record.losses}
        {record.pushes ? `-${record.pushes}` : ""} • {record.winRate}% •{" "}
        {record.netUnits > 0 ? "+" : ""}
        {record.netUnits}u
      </Text>
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

function buildRecord(list: any[]) {
  const wins = list.filter((pick) => getStatus(pick) === "Win").length;
  const losses = list.filter((pick) => getStatus(pick) === "Loss").length;
  const pushes = list.filter((pick) => getStatus(pick) === "Push").length;
  const total = wins + losses + pushes;
  const graded = wins + losses;
  const winRate = graded ? Math.round((wins / graded) * 100) : 0;
  const netUnits = wins - losses;

  return {
    wins,
    losses,
    pushes,
    total,
    graded,
    winRate,
    netUnits,
  };
}

function getStatus(pick: any) {
  const raw = String(pick.status || "pending").toLowerCase();

  if (raw === "win") return "Win";
  if (raw === "loss") return "Loss";
  if (raw === "push") return "Push";

  return "Pending";
}

function getActual(pick: any) {
  const status = String(pick.status || "pending").toLowerCase();

  if (status === "pending") {
    return null;
  }

  return (
    pick.actualPoints ??
    pick.finalPoints ??
    pick.actualStat ??
    pick.resultMeta?.points ??
    null
  );
}

function getConfidenceBucket(pick: any) {
  if (pick.confidenceBucket) return String(pick.confidenceBucket);

  const confidence = Number(pick.confidence ?? pick.winProbability ?? 0);

  if (confidence >= 85) return "85+";
  if (confidence >= 80) return "80-84";
  if (confidence >= 75) return "75-79";
  if (confidence >= 70) return "70-74";
  if (confidence >= 60) return "60-69";

  return "Under 60";
}

function bucketSortValue(bucket: string) {
  if (bucket.includes("85")) return 85;
  if (bucket.includes("80")) return 80;
  if (bucket.includes("75")) return 75;
  if (bucket.includes("70")) return 70;
  if (bucket.includes("60")) return 60;

  return 0;
}

function getStatusStyle(status: string) {
  if (status === "Win") {
    return {
      backgroundColor: "#14532d",
      color: "#bbf7d0",
    };
  }

  if (status === "Loss") {
    return {
      backgroundColor: "#7f1d1d",
      color: "#fecaca",
    };
  }

  if (status === "Push") {
    return {
      backgroundColor: "#713f12",
      color: "#fef9c3",
    };
  }

  return {
    backgroundColor: "#1e3a8a",
    color: "#bfdbfe",
  };
}

function formatDateLabel(value: any) {
  if (!value) return "Unknown Date";

  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);

  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },

  container: {
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
    color: "#22c55e",
    fontSize: 32,
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

  summaryCard: {
    backgroundColor: "#111827",
    padding: 15,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#22c55e",
  },

  summaryTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 12,
  },

  recordGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
    fontSize: 20,
    fontWeight: "900",
  },

  pendingText: {
    color: "#93c5fd",
    marginTop: 12,
    fontSize: 13,
    fontWeight: "800",
  },

  checkButton: {
    marginTop: 12,
    backgroundColor: "#1d4ed8",
    borderRadius: 12,
    paddingVertical: 12,
  },

  checkButtonText: {
    color: "#dbeafe",
    fontWeight: "900",
    textAlign: "center",
    fontSize: 14,
  },

  breakdownCard: {
    backgroundColor: "#111827",
    padding: 15,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },

  sectionTitle: {
    color: "#facc15",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 10,
  },

  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },

  breakdownTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "900",
    flex: 1,
  },

  breakdownText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "800",
  },

  emptySmall: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
  },

  riskGroupCard: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },

  riskGroupTitle: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },

  riskGroupSummary: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },

  resultBox: {
    paddingHorizontal: 12,
    paddingBottom: 12,
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

  dateGroup: {
    marginTop: 4,
  },

  date: {
    color: "#eab308",
    fontSize: 18,
    marginTop: 15,
    marginBottom: 10,
    fontWeight: "900",
  },

  card: {
    backgroundColor: "#1e293b",
    padding: 15,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },

  winCard: {
    borderColor: "#166534",
  },

  lossCard: {
    borderColor: "#7f1d1d",
  },

  pushCard: {
    borderColor: "#713f12",
  },

  premiumCard: {
    borderColor: "#facc15",
  },

  cardTopRow: {
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

  statusBadge: {
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },

  player: {
    color: "white",
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 4,
  },

  text: {
    color: "#cbd5e1",
    marginTop: 3,
    fontSize: 13,
    fontWeight: "700",
  },

  conf: {
    color: "#22c55e",
    fontSize: 22,
    fontWeight: "900",
  },

  pickBox: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263449",
    marginTop: 10,
    marginBottom: 10,
  },

  pickText: {
    color: "#93c5fd",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },

  metricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
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

  dateText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 10,
  },
});