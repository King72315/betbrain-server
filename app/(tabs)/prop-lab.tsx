/**
 * CourtEdge Prop Lab V2 — consumer learning/calibration screen.
 * Consumes authoritative courtEdgeLabV2 payload (same as copy report).
 * Analysis-only UI — no pick classification labels, no weight writes.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "expo-router";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  buildDailySlateReports,
  fetchCourtEdgeLabV2,
  fetchDailySlateReports,
  resolveTrackedProps,
} from "../../services/api";
import CopyReportButton from "../../components/CopyReportButton";
import { buildPropLabV2Report } from "../../utils/reportBuilders";

type LabFilters = {
  league: "ALL" | "NBA" | "WNBA";
  side: "ALL" | "OVER" | "UNDER";
  risk: "ALL" | "LOW" | "MEDIUM" | "HIGH";
  top: "ALL" | "TOP" | "NON_TOP";
  result: "ALL" | "win" | "loss" | "push";
  engine: string;
};

const DEFAULT_FILTERS: LabFilters = {
  league: "ALL",
  side: "ALL",
  risk: "ALL",
  top: "ALL",
  result: "ALL",
  engine: "ALL",
};

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value}%`;
}

function formatNum(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function formatRecord(stats: any) {
  if (!stats) return "—";
  const rate =
    stats.winRate !== null && stats.winRate !== undefined ? ` (${stats.winRate}%)` : "";
  return `${stats.wins ?? 0}-${stats.losses ?? 0}-${stats.pushes ?? 0}${rate}`;
}

function formatSlateLabel(slateDate: string) {
  if (!slateDate) return "Unknown slate";
  const d = new Date(`${slateDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return slateDate;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

function SectionCard({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <Text style={styles.sectionTitle}>
          {open ? "▾ " : "▸ "}
          {title}
        </Text>
      </TouchableOpacity>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active ? styles.chipActive : null]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function DeltaLine({ label, delta }: { label: string; delta: any }) {
  if (!delta) {
    return <MetricRow label={label} value="N/A" />;
  }
  const display =
    delta.display ||
    delta.label ||
    (delta.difference === null || delta.difference === undefined
      ? delta.direction === "pending"
        ? "pending"
        : "N/A"
      : `${delta.difference > 0 ? "+" : ""}${delta.difference}`);
  const prev =
    delta.previous === null || delta.previous === undefined
      ? "N/A"
      : formatNum(delta.previous);
  const cur =
    delta.current === null || delta.current === undefined
      ? delta.direction === "pending"
        ? "pending"
        : "N/A"
      : formatNum(delta.current);
  return (
    <MetricRow
      label={label}
      value={`Prev ${prev} → Cur ${cur} (${display})`}
    />
  );
}

export default function PropLabScreen() {
  const [labV2, setLabV2] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LabFilters>(DEFAULT_FILTERS);
  const [expandedPacket, setExpandedPacket] = useState<string | null>(null);
  const [rawPage, setRawPage] = useState(1);
  const [selectedBlock, setSelectedBlock] = useState<"active" | "previous">("active");

  const load = useCallback(async (opts?: { refreshGrades?: boolean }) => {
    setError(null);
    try {
      if (opts?.refreshGrades) {
        setBuilding(true);
        await resolveTrackedProps({ requireLikelyFinished: true });
        await buildDailySlateReports({ forceRebuild: true });
      }
      const list = await fetchDailySlateReports();
      const slateDate = list.currentLabSlateDate || null;
      const labRes = await fetchCourtEdgeLabV2({
        slateDate: slateDate || undefined,
        page: rawPage,
        pageSize: 50,
      });
      if (!labRes.ok || !labRes.labV2) {
        // Fallback: labV2 embedded on daily reports response
        if (list.labV2) {
          setLabV2(list.labV2);
        } else {
          setError(labRes.error || labRes.message || "Lab V2 unavailable");
          setLabV2(null);
        }
      } else {
        setLabV2(labRes.labV2);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load Prop Lab");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setBuilding(false);
    }
  }, [rawPage]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const filteredResults = useMemo(() => {
    const rows = labV2?.officialBestSixResults || [];
    return rows.filter((row: any) => {
      if (filters.league !== "ALL" && row.league !== filters.league) return false;
      if (filters.side !== "ALL" && row.finalSide !== filters.side) return false;
      if (filters.risk !== "ALL" && row.risk !== filters.risk) return false;
      if (filters.top === "TOP" && !row.isTopPick) return false;
      if (filters.top === "NON_TOP" && row.isTopPick) return false;
      if (filters.result !== "ALL" && row.result !== filters.result) return false;
      return true;
    });
  }, [labV2, filters]);

  const filteredRawRows = useMemo(() => {
    const rows = labV2?.rawSignalExplorer?.rows || [];
    return rows.filter((row: any) => {
      if (filters.league !== "ALL" && row.league !== filters.league) return false;
      if (filters.side !== "ALL" && row.side !== filters.side) return false;
      if (filters.risk !== "ALL" && row.risk !== filters.risk) return false;
      if (filters.top === "TOP" && !row.isTopPick) return false;
      if (filters.top === "NON_TOP" && row.isTopPick) return false;
      if (filters.result !== "ALL" && row.result !== filters.result) return false;
      if (filters.engine !== "ALL" && row.engine !== filters.engine) return false;
      return true;
    });
  }, [labV2, filters]);

  const current = labV2?.currentSlate;
  const activeBlock = labV2?.activeThreeSlateBlock;
  const previousBlock = labV2?.previousThreeSlateBlock;
  const comparison = labV2?.threeSlateComparison;
  const engines = labV2?.engineScorecards || {};
  const engineKeys = Object.keys(engines);

  const reportText = useMemo(
    () =>
      buildPropLabV2Report({
        labV2,
        loading,
        building,
        refreshing,
        error,
      }),
    [labV2, loading, building, refreshing, error]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load({ refreshGrades: true });
            }}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pageTitle}>Prop Lab</Text>
            <Text style={styles.pageSub}>
              CourtEdge Lab V2 · analysis only · three-slate calibration
            </Text>
          </View>
          <CopyReportButton
            getReportText={() => reportText}
            slateDate={current?.slateDate || null}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {loading ? <Text style={styles.muted}>Loading Lab V2…</Text> : null}
        {building ? <Text style={styles.muted}>Refreshing grades & rebuilding Lab…</Text> : null}

        {/* Filters */}
        <SectionCard title="Filters" defaultOpen={false}>
          <Text style={styles.filterLabel}>League</Text>
          <View style={styles.chipRow}>
            {(["ALL", "NBA", "WNBA"] as const).map((v) => (
              <Chip
                key={v}
                label={v}
                active={filters.league === v}
                onPress={() => setFilters((f) => ({ ...f, league: v }))}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>Side</Text>
          <View style={styles.chipRow}>
            {(["ALL", "OVER", "UNDER"] as const).map((v) => (
              <Chip
                key={v}
                label={v}
                active={filters.side === v}
                onPress={() => setFilters((f) => ({ ...f, side: v }))}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>Risk</Text>
          <View style={styles.chipRow}>
            {(["ALL", "LOW", "MEDIUM", "HIGH"] as const).map((v) => (
              <Chip
                key={v}
                label={v}
                active={filters.risk === v}
                onPress={() => setFilters((f) => ({ ...f, risk: v }))}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>Top</Text>
          <View style={styles.chipRow}>
            {(["ALL", "TOP", "NON_TOP"] as const).map((v) => (
              <Chip
                key={v}
                label={v === "NON_TOP" ? "Non-Top" : v === "TOP" ? "Top" : "All"}
                active={filters.top === v}
                onPress={() => setFilters((f) => ({ ...f, top: v }))}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>Result</Text>
          <View style={styles.chipRow}>
            {(["ALL", "win", "loss", "push"] as const).map((v) => (
              <Chip
                key={v}
                label={v}
                active={filters.result === v}
                onPress={() => setFilters((f) => ({ ...f, result: v }))}
              />
            ))}
          </View>
          <Text style={styles.filterLabel}>Engine</Text>
          <View style={styles.chipRow}>
            <Chip
              label="ALL"
              active={filters.engine === "ALL"}
              onPress={() => setFilters((f) => ({ ...f, engine: "ALL" }))}
            />
            {engineKeys.slice(0, 11).map((key) => (
              <Chip
                key={key}
                label={engines[key]?.label || key}
                active={filters.engine === key}
                onPress={() => setFilters((f) => ({ ...f, engine: key }))}
              />
            ))}
          </View>
        </SectionCard>

        {/* 1. Current Completed Slate Summary */}
        <SectionCard title="1. Current Completed Slate Summary">
          {!current ? (
            <Text style={styles.muted}>No completed official slate yet.</Text>
          ) : (
            <>
              <MetricRow label="Slate" value={formatSlateLabel(current.slateDate)} />
              <MetricRow
                label="Instrumentation"
                value={
                  current.instrumented
                    ? "Instrumented (sealed engine signals)"
                    : current.thinOfficial
                      ? "Legacy / thin official (not six-prop)"
                      : current.uninstrumented || current.legacy
                        ? "Legacy / uninstrumented (no sealed engine signals)"
                        : "—"
                }
              />
              <MetricRow
                label="Evidence coverage"
                value={
                  current.evidenceCoverage == null
                    ? "N/A"
                    : `${current.evidenceCoverage}%`
                }
              />
              <MetricRow
                label="Official size"
                value={
                  current.sixProp
                    ? "Six-prop"
                    : current.thinOfficial
                      ? `Thin (${current.totalProps ?? 0})`
                      : String(current.totalProps ?? 0)
                }
              />
              <MetricRow
                label="Leagues"
                value={(current.leagueCoverage || []).join(", ") || "—"}
              />
              <MetricRow label="Official props" value={String(current.totalProps ?? 0)} />
              <MetricRow label="Graded / Pending" value={`${current.graded ?? 0} / ${current.pending ?? 0}`} />
              <MetricRow label="W-L-P" value={formatRecord(current)} />
              <MetricRow label="Win rate" value={formatPct(current.winRate)} />
              <MetricRow label="Avg margin" value={formatNum(current.avgResultMargin ?? current.avgMargin)} />
              <MetricRow label="Avg proj error" value={formatNum(current.avgProjectionError)} />
              <MetricRow label="Avg |proj error|" value={formatNum(current.avgAbsProjectionError)} />
              <MetricRow label="Avg CLV" value={formatNum(current.avgClv)} />
              <MetricRow label="Top picks" value={formatRecord(current.topPickRecord)} />
              <MetricRow label="Over" value={formatRecord(current.overRecord)} />
              <MetricRow label="Under" value={formatRecord(current.underRecord)} />
              <MetricRow label="NBA" value={formatRecord(current.nbaRecord)} />
              <MetricRow label="WNBA" value={formatRecord(current.wnbaRecord)} />
            </>
          )}
        </SectionCard>

        {/* 2. Three-Slate Improvement Block */}
        <SectionCard title="2. Three-Slate Improvement Block">
          <View style={styles.chipRow}>
            <Chip
              label="Active block"
              active={selectedBlock === "active"}
              onPress={() => setSelectedBlock("active")}
            />
            <Chip
              label="Previous block"
              active={selectedBlock === "previous"}
              onPress={() => setSelectedBlock("previous")}
            />
          </View>

          {selectedBlock === "active" ? (
            !activeBlock ? (
              <Text style={styles.muted}>
                No active six-prop learning block yet. Waiting for the next sealed
                six-prop official slate (thin/legacy eras stay historical).
              </Text>
            ) : (
              <>
                <MetricRow
                  label="Progress"
                  value={`${activeBlock.progress || `${activeBlock.slateCount}/3`}${
                    activeBlock.slateCount === 3 ? " — Block Complete" : ""
                  }`}
                />
                <MetricRow
                  label="Dates"
                  value={(activeBlock.slateDates || []).map(formatSlateLabel).join(" · ") || "—"}
                />
                <MetricRow
                  label="Block instrumentation"
                  value={
                    activeBlock.instrumented
                      ? "Instrumented"
                      : activeBlock.uninstrumented || activeBlock.legacy
                        ? "Legacy / uninstrumented (engine scoreboard segregated)"
                        : "—"
                  }
                />
                <MetricRow label="Combined W-L-P" value={formatRecord(activeBlock)} />
                <MetricRow label="Win rate" value={formatPct(activeBlock.winRate)} />
                <MetricRow label="Avg |proj error|" value={formatNum(activeBlock.avgAbsProjectionError)} />
                <MetricRow label="Avg CLV" value={formatNum(activeBlock.avgClv)} />
                {(activeBlock.perSlate || []).map((s: any) => (
                  <MetricRow
                    key={s.slateDate}
                    label={`${formatSlateLabel(s.slateDate)}${
                      s.uninstrumented || s.legacy ? " · legacy" : ""
                    }${s.thinOfficial ? " · thin" : ""}${s.sixProp ? " · 6-prop" : ""}`}
                    value={formatRecord(s)}
                  />
                ))}
              </>
            )
          ) : !previousBlock ? (
            <Text style={styles.muted}>No previous frozen three-slate block yet.</Text>
          ) : (
            <>
              <MetricRow
                label="Dates"
                value={(previousBlock.slateDates || []).map(formatSlateLabel).join(" · ") || "—"}
              />
              <MetricRow
                label="Block instrumentation"
                value={
                  previousBlock.instrumented
                    ? "Instrumented"
                    : previousBlock.uninstrumented || previousBlock.legacy
                      ? "Legacy / uninstrumented (historical)"
                      : "—"
                }
              />
              <MetricRow label="Combined W-L-P" value={formatRecord(previousBlock)} />
              <MetricRow label="Win rate" value={formatPct(previousBlock.winRate)} />
              <MetricRow label="Avg |proj error|" value={formatNum(previousBlock.avgAbsProjectionError)} />
              <MetricRow label="Avg CLV" value={formatNum(previousBlock.avgClv)} />
            </>
          )}

          {comparison?.metrics ? (
            <>
              <Text style={styles.subhead}>Improvement comparison</Text>
              <DeltaLine label="Win rate" delta={comparison.metrics.winRate} />
              <DeltaLine label="Avg margin" delta={comparison.metrics.avgMargin} />
              <DeltaLine label="|Proj error|" delta={comparison.metrics.avgAbsProjectionError} />
              <DeltaLine label="CLV" delta={comparison.metrics.avgClv} />
              <DeltaLine label="WNBA win rate" delta={comparison.wnba?.winRate} />
              <DeltaLine label="NBA win rate" delta={comparison.nba?.winRate} />
            </>
          ) : (
            <Text style={styles.muted}>
              {comparison?.notes?.[0] || "Comparison available after a prior frozen block exists."}
            </Text>
          )}
        </SectionCard>

        {/* 3. Official Best 6 Results */}
        <SectionCard title="3. Official Best 6 Results">
          {!filteredResults.length ? (
            <Text style={styles.muted}>No official Best 6 props for this slate.</Text>
          ) : (
            filteredResults.map((row: any) => (
              <View key={row.officialPropId || `${row.player}-${row.bestSixRank}`} style={styles.propCard}>
                <Text style={styles.propTitle}>
                  B6 #{row.bestSixRank || "—"}
                  {row.isTopPick ? " · TOP" : ""} · {row.player}
                </Text>
                <Text style={styles.propMeta}>
                  {row.matchup} · {row.finalSide} {formatNum(row.sealedLine, 1)} · {String(row.result || "").toUpperCase()}
                </Text>
                <MetricRow label="Actual / margin" value={`${formatNum(row.actualPoints)} / ${formatNum(row.resultMargin)}`} />
                <MetricRow label="Conf / risk" value={`${formatNum(row.confidence, 0)}% / ${row.risk || "—"}`} />
                <MetricRow
                  label="Conf/risk source"
                  value={row.confidenceRiskSource || "—"}
                />
                <MetricRow label="Proj / fair / err" value={`${formatNum(row.projection)} / ${formatNum(row.fairLine)} / ${formatNum(row.projectionError)}`} />
                <MetricRow label="Open → close / CLV" value={`${formatNum(row.openingLine)} → ${formatNum(row.closingLine)} / ${formatNum(row.clv)}`} />
                <MetricRow label="Organic → final" value={`${row.originalModelSide || "—"} → ${row.finalCourtEdgeSide || "—"}`} />
                <MetricRow
                  label="Same-team"
                  value={row.sameTeamArbitration?.forced ? "Forced" : "Organic"}
                />
                <MetricRow label="Diagnosis" value={String(row.diagnosisSummary || "—")} />
                <MetricRow
                  label="Engine signals"
                  value={
                    row.engineSignalsAvailable
                      ? "Sealed"
                      : row.uninstrumented || row.legacy
                        ? "Unavailable (legacy / uninstrumented)"
                        : "Unavailable (legacy)"
                  }
                />
              </View>
            ))
          )}
        </SectionCard>

        {/* 4. Per-Prop Learning Packets */}
        <SectionCard title="4. Per-Prop Learning Packets" defaultOpen={false}>
          {(labV2?.perPropPackets || []).map((packet: any) => {
            const id = packet.officialPropId || packet.player;
            const open = expandedPacket === id;
            return (
              <View key={id} style={styles.propCard}>
                <TouchableOpacity onPress={() => setExpandedPacket(open ? null : id)}>
                  <Text style={styles.propTitle}>
                    {open ? "▾" : "▸"} {packet.player} ({packet.league})
                  </Text>
                </TouchableOpacity>
                {open ? (
                  <>
                    <Text style={styles.subhead}>Layer 1 — Freeze</Text>
                    <MetricRow label="Side / line" value={`${packet.layers?.freeze?.side} ${formatNum(packet.layers?.freeze?.sealedLine)}`} />
                    <MetricRow label="B6 / Top" value={`#${packet.layers?.freeze?.bestSixRank || "—"} / ${packet.layers?.freeze?.topPickRank || "—"}`} />
                    <MetricRow label="Organic → final" value={`${packet.layers?.freeze?.originalModelSide} → ${packet.layers?.freeze?.finalSide}`} />
                    <MetricRow label="Proj / fair" value={`${formatNum(packet.layers?.freeze?.projection)} / ${formatNum(packet.layers?.freeze?.fairLine)}`} />
                    <MetricRow label="Conf / risk" value={`${formatNum(packet.layers?.freeze?.confidence, 0)}% / ${packet.layers?.freeze?.risk || "—"}`} />

                    <Text style={styles.subhead}>Layer 2 — Pregame Engine Evidence</Text>
                    {!packet.layers?.pregameEngineEvidence?.signalsAvailable ? (
                      <Text style={styles.muted}>
                        Expansion signals unavailable
                        {packet.layers?.pregameEngineEvidence?.unavailableReason
                          ? ` (${packet.layers.pregameEngineEvidence.unavailableReason})`
                          : ""}
                      </Text>
                    ) : null}
                    {Object.entries(packet.layers?.pregameEngineEvidence?.engines || {}).map(
                      ([key, eng]: [string, any]) => (
                        <View key={key} style={styles.engineRow}>
                          <Text style={styles.engineName}>{eng.label || key}</Text>
                          <Text style={styles.propMeta}>
                            {eng.available
                              ? `avail · norm ${formatNum(eng.normalizedSignal, 2)} · conf ${formatNum(eng.confidenceAdjustment, 2)} · ${eng.directionalAttribution?.kind || "—"}`
                              : `unavailable${eng.unavailableReason ? ` · ${eng.unavailableReason}` : ""}`}
                          </Text>
                        </View>
                      )
                    )}

                    <Text style={styles.subhead}>Layer 3 — Decision Path</Text>
                    <MetricRow label="Flip-First" value={String(packet.layers?.decisionPath?.flipFirstAction || "—")} />
                    <MetricRow label="Side Rescue" value={String(packet.layers?.decisionPath?.sideRescueAction || "—")} />
                    <MetricRow
                      label="Same-team"
                      value={packet.layers?.decisionPath?.sameTeamArbitration?.forced ? "Forced" : "Organic"}
                    />
                    <MetricRow
                      label="Final side"
                      value={String(packet.layers?.decisionPath?.finalCourtEdgeSide || "—")}
                    />

                    <Text style={styles.subhead}>Layer 4 — Postgame Truth</Text>
                    <MetricRow label="Actual" value={formatNum(packet.layers?.postgameTruth?.actualPoints)} />
                    <MetricRow label="Result / margin" value={`${packet.layers?.postgameTruth?.result || "—"} / ${formatNum(packet.layers?.postgameTruth?.resultMargin)}`} />
                    <MetricRow label="Proj error / CLV" value={`${formatNum(packet.layers?.postgameTruth?.projectionError)} / ${formatNum(packet.layers?.postgameTruth?.clv)}`} />

                    <Text style={styles.subhead}>Layer 5 — Diagnosis</Text>
                    <MetricRow label="Primary" value={String(packet.layers?.diagnosis?.primaryCause || "—")} />
                    <MetricRow
                      label="Helped"
                      value={(packet.layers?.diagnosis?.enginesHelped || []).join(", ") || "—"}
                    />
                    <MetricRow
                      label="Hurt"
                      value={(packet.layers?.diagnosis?.enginesHurt || []).join(", ") || "—"}
                    />
                  </>
                ) : null}
              </View>
            );
          })}
        </SectionCard>

        {/* 5. Engine Expansion Scoreboard */}
        <SectionCard title="5. Engine Expansion Scoreboard">
          <Text style={styles.muted}>
            Directional/calibration metrics use sealed instrumented props only.
            Legacy / uninstrumented slates are excluded from scoreboard math.
          </Text>
          {engineKeys.map((key) => {
            const card = engines[key];
            const cur = card?.currentSlate || {};
            return (
              <View key={key} style={styles.engineRow}>
                <Text style={styles.engineName}>{card?.label || key}</Text>
                <MetricRow
                  label="Coverage"
                  value={`${cur.availableCount ?? 0} avail / ${cur.unavailableCount ?? 0} unavail (${formatPct(cur.coveragePct)})`}
                />
                <MetricRow
                  label="Directional"
                  value={`${cur.directionalCorrect ?? 0}/${cur.directionalOpportunities ?? 0} (${formatPct(cur.directionalAccuracy)}) · H/U/N ${cur.helped}/${cur.hurt}/${cur.neutral}`}
                />
                <MetricRow
                  label="Calibration"
                  value={`H/U/N ${cur.calibrationHelped}/${cur.calibrationHurt}/${cur.calibrationNeutral}`}
                />
                <DeltaLine label="Block Δ accuracy" delta={card?.change?.directionalAccuracy} />
              </View>
            );
          })}
        </SectionCard>

        {/* 6. Decision-Path Accuracy */}
        <SectionCard title="6. Decision-Path Accuracy" defaultOpen={false}>
          {(["currentSlate", "activeThreeSlateBlock"] as const).map((scope) => {
            const path = labV2?.decisionPathAnalysis?.[scope];
            if (!path) return null;
            return (
              <View key={scope}>
                <Text style={styles.subhead}>{scope === "currentSlate" ? "Current slate" : "Active block"}</Text>
                <MetricRow label="Reader kept" value={formatRecord(path.reader?.kept)} />
                <MetricRow label="Reader changed" value={formatRecord(path.reader?.laterChanged)} />
                <MetricRow label="Flip-First flips" value={`${formatRecord(path.flipFirst?.flip)} · correct ${path.flipFirst?.correctFlips ?? 0} / incorrect ${path.flipFirst?.incorrectFlips ?? 0}`} />
                <MetricRow label="Side Rescue flips" value={`${formatRecord(path.sideRescue?.flip)} · correct ${path.sideRescue?.correctRescues ?? 0} / incorrect ${path.sideRescue?.incorrectRescues ?? 0}`} />
                <MetricRow label="Same-team forced" value={formatRecord(path.sameTeamArbitration?.combinedForced)} />
              </View>
            );
          })}
        </SectionCard>

        {/* 7. Projection Calibration */}
        <SectionCard title="7. Projection and Fair-Line Calibration" defaultOpen={false}>
          {(["currentSlate", "activeThreeSlateBlock"] as const).map((scope) => {
            const cal = labV2?.projectionCalibration?.[scope];
            if (!cal) return null;
            return (
              <View key={scope}>
                <Text style={styles.subhead}>{scope === "currentSlate" ? "Current slate" : "Active block"}</Text>
                <MetricRow label="Overall |err|" value={formatNum(cal.overall?.absoluteProjectionError)} />
                <MetricRow label="NBA |err|" value={formatNum(cal.byLeague?.NBA?.absoluteProjectionError)} />
                <MetricRow label="WNBA |err|" value={formatNum(cal.byLeague?.WNBA?.absoluteProjectionError)} />
                <MetricRow label="Over bias" value={formatNum(cal.bySide?.OVER?.signedProjectionError)} />
                <MetricRow label="Under bias" value={formatNum(cal.bySide?.UNDER?.signedProjectionError)} />
              </View>
            );
          })}
        </SectionCard>

        {/* 8. Confidence and Risk Honesty */}
        <SectionCard title="8. Confidence and Risk Honesty" defaultOpen={false}>
          <Text style={styles.subhead}>Confidence buckets</Text>
          {Object.entries(labV2?.confidenceCalibration?.currentSlate?.buckets || {}).map(
            ([key, bucket]: [string, any]) => (
              <MetricRow
                key={key}
                label={key}
                value={`${formatRecord(bucket)} · gap ${formatNum(bucket.calibrationGap, 1)}`}
              />
            )
          )}
          <Text style={styles.subhead}>Risk</Text>
          {Object.entries(labV2?.riskCalibration?.currentSlate?.buckets || {}).map(
            ([key, bucket]: [string, any]) => (
              <MetricRow key={key} label={key} value={formatRecord(bucket)} />
            )
          )}
          <MetricRow
            label="Same-team forced"
            value={formatRecord(labV2?.confidenceCalibration?.currentSlate?.sameTeamForced)}
          />
        </SectionCard>

        {/* 9. Market and Line */}
        <SectionCard title="9. Market and Line Performance" defaultOpen={false}>
          <MetricRow
            label="Avg CLV"
            value={formatNum(labV2?.marketLineAnalysis?.currentSlate?.avgClv)}
          />
          <MetricRow
            label="Favorable sealed"
            value={formatRecord(labV2?.marketLineAnalysis?.currentSlate?.favorableSealedLine)}
          />
          <MetricRow
            label="Unfavorable sealed"
            value={formatRecord(labV2?.marketLineAnalysis?.currentSlate?.unfavorableSealedLine)}
          />
        </SectionCard>

        {/* 10. Role / Volume / Dist / Vol */}
        <SectionCard title="10. Role / Volume / Distribution / Volatility" defaultOpen={false}>
          <Text style={styles.muted}>
            {labV2?.roleVolumeAnalysis?.currentSlate?.note ||
              "Scored via sealed expansion engines when available."}
          </Text>
          {(["roleVelocity", "distribution", "volatility", "teammateImpact"] as const).map(
            (key) => {
              const card =
                labV2?.roleVolumeAnalysis?.currentSlate?.engineCoverage?.[key] ||
                engines[key]?.currentSlate;
              return (
                <MetricRow
                  key={key}
                  label={engines[key]?.label || key}
                  value={`cov ${formatPct(card?.coveragePct)} · dir ${formatPct(card?.directionalAccuracy)}`}
                />
              );
            }
          )}
        </SectionCard>

        {/* 11. Opponent and Game Context */}
        <SectionCard title="11. Opponent and Game Context" defaultOpen={false}>
          <Text style={styles.muted}>
            {labV2?.opponentGameContextAnalysis?.currentSlate?.note || ""}
          </Text>
          {(["defensiveArchetype", "pacePossession", "restFatigue"] as const).map((key) => {
            const card =
              labV2?.opponentGameContextAnalysis?.currentSlate?.[key] ||
              engines[key]?.currentSlate;
            return (
              <MetricRow
                key={key}
                label={engines[key]?.label || key}
                value={`cov ${formatPct(card?.coveragePct)} · dir ${formatPct(card?.directionalAccuracy)}`}
              />
            );
          })}
        </SectionCard>

        {/* 12. Miss and Win Diagnosis */}
        <SectionCard title="12. Miss and Win Diagnosis" defaultOpen={false}>
          <MetricRow
            label="Wins"
            value={formatRecord(labV2?.outcomeDiagnosis?.currentSlate?.wins)}
          />
          <MetricRow
            label="Losses"
            value={formatRecord(labV2?.outcomeDiagnosis?.currentSlate?.losses)}
          />
          <Text style={styles.subhead}>Miss types</Text>
          {Object.entries(labV2?.outcomeDiagnosis?.currentSlate?.missTypeCounts || {}).map(
            ([key, count]) => (
              <MetricRow key={key} label={key} value={String(count)} />
            )
          )}
        </SectionCard>

        {/* 13. Adjustment Review */}
        <SectionCard title="13. Adjustment Review (manual only)" defaultOpen={false}>
          <Text style={styles.muted}>
            {labV2?.adjustmentReview?.note ||
              "Recommendations are for human review only. Lab does not modify live weights."}
          </Text>
          <MetricRow
            label="Writes live weights"
            value={labV2?.adjustmentReview?.writesLiveWeights ? "YES" : "NO"}
          />
          <MetricRow
            label="Calibration Feedback Engine"
            value={labV2?.adjustmentReview?.calibrationFeedbackEngine ? "YES" : "NO"}
          />
          {(labV2?.adjustmentReview?.suggestions || []).map((s: any, idx: number) => (
            <View key={`${s.engine}-${idx}`} style={styles.propCard}>
              <Text style={styles.propTitle}>{s.label || s.engine}</Text>
              <MetricRow label="Suggestion" value={String(s.suggestedAdjustmentType)} />
              <MetricRow
                label="Perf"
                value={`Prev ${formatNum(s.previousPerformance)} → Cur ${formatNum(s.currentPerformance)} (${s.difference > 0 ? "+" : ""}${formatNum(s.difference)})`}
              />
              <MetricRow label="Auto-apply" value={s.appliesAutomatically ? "YES" : "NO"} />
            </View>
          ))}
          {!labV2?.adjustmentReview?.suggestions?.length ? (
            <Text style={styles.muted}>No adjustment candidates above threshold.</Text>
          ) : null}
        </SectionCard>

        {/* 14. Raw Signal Explorer */}
        <SectionCard title="14. Raw Signal Explorer" defaultOpen={false}>
          <MetricRow
            label="Rows"
            value={`${filteredRawRows.length} shown · ${labV2?.rawSignalExplorer?.totalRows ?? 0} total`}
          />
          <View style={styles.chipRow}>
            <Chip
              label="Prev page"
              active={false}
              onPress={() => setRawPage((p) => Math.max(1, p - 1))}
            />
            <Chip label={`Page ${rawPage}`} active onPress={() => load()} />
            <Chip
              label="Next page"
              active={false}
              onPress={() => setRawPage((p) => p + 1)}
            />
          </View>
          {filteredRawRows.map((row: any, idx: number) => (
            <View
              key={`${row.officialPropId}-${row.engine}-${idx}`}
              style={styles.engineRow}
            >
              <Text style={styles.engineName}>
                {row.player} · {row.engineLabel || row.engine}
              </Text>
              <Text style={styles.propMeta}>
                {row.available ? "available" : `unavailable${row.unavailableReason ? ` (${row.unavailableReason})` : ""}`}
                {` · ${row.result || "—"} · margin ${formatNum(row.resultMargin)}`}
              </Text>
            </View>
          ))}
        </SectionCard>

        {/* 15. All-Time Context */}
        <SectionCard title="15. All-Time Context" defaultOpen={false}>
          <MetricRow label="Graded" value={String(labV2?.allTimeContext?.graded ?? 0)} />
          <MetricRow label="W-L-P" value={formatRecord(labV2?.allTimeContext)} />
          <MetricRow
            label="Instrumented / legacy"
            value={`${labV2?.allTimeContext?.instrumentedRecordCount ?? 0} / ${labV2?.allTimeContext?.legacyRecordCount ?? 0}`}
          />
          <MetricRow label="NBA" value={formatRecord(labV2?.allTimeContext?.nba)} />
          <MetricRow label="WNBA" value={formatRecord(labV2?.allTimeContext?.wnba)} />
          <MetricRow label="Over" value={formatRecord(labV2?.allTimeContext?.over)} />
          <MetricRow label="Under" value={formatRecord(labV2?.allTimeContext?.under)} />
          <MetricRow label="Same-team forced" value={formatRecord(labV2?.allTimeContext?.sameTeamForced)} />
          <MetricRow label="Avg |proj err|" value={formatNum(labV2?.allTimeContext?.avgAbsProjectionError)} />
          <MetricRow label="Avg CLV" value={formatNum(labV2?.allTimeContext?.avgClv)} />
          <Text style={styles.subhead}>By build / evidence era</Text>
          {Object.entries(labV2?.allTimeContext?.byBuildVersion || {}).map(
            ([build, stats]: [string, any]) => (
              <MetricRow
                key={`build-${build}`}
                label={`Build ${build}`}
                value={`${formatRecord(stats)} · instr ${stats.instrumentedCount ?? 0}`}
              />
            )
          )}
          {Object.entries(labV2?.allTimeContext?.byEvidenceSchema || {}).map(
            ([schema, stats]: [string, any]) => (
              <MetricRow
                key={`schema-${schema}`}
                label={`Evidence ${schema}`}
                value={formatRecord(stats)}
              />
            )
          )}
          {Object.entries(labV2?.allTimeContext?.byDecisionPacketVersion || {}).map(
            ([ver, stats]: [string, any]) => (
              <MetricRow
                key={`pkt-${ver}`}
                label={`Packet ${ver}`}
                value={formatRecord(stats)}
              />
            )
          )}
        </SectionCard>

        <Text style={styles.footer}>
          Build {labV2?.buildVersion || "—"} · analysis-only · no live weight writes
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1220" },
  content: { padding: 16, paddingBottom: 48 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12, gap: 12 },
  pageTitle: { color: "#f8fafc", fontSize: 24, fontWeight: "700" },
  pageSub: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  sectionCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  sectionTitle: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" },
  sectionBody: { marginTop: 10 },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 6,
  },
  metricLabel: { color: "#94a3b8", flex: 1, fontSize: 13 },
  metricValue: { color: "#f1f5f9", flex: 1.4, fontSize: 13, textAlign: "right" },
  muted: { color: "#64748b", fontSize: 13, marginBottom: 6 },
  errorText: { color: "#f87171", marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: "#1d4ed8", borderColor: "#1d4ed8" },
  chipText: { color: "#cbd5e1", fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  filterLabel: { color: "#64748b", fontSize: 11, marginBottom: 4, marginTop: 4 },
  propCard: {
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingTop: 10,
    marginTop: 8,
  },
  propTitle: { color: "#f8fafc", fontWeight: "600", marginBottom: 4 },
  propMeta: { color: "#94a3b8", fontSize: 12, marginBottom: 6 },
  subhead: {
    color: "#cbd5e1",
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
    fontSize: 13,
  },
  engineRow: {
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingTop: 8,
    marginTop: 6,
  },
  engineName: { color: "#e2e8f0", fontWeight: "600", marginBottom: 4, fontSize: 13 },
  footer: { color: "#475569", fontSize: 11, textAlign: "center", marginTop: 8 },
});
