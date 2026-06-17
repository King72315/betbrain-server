import { formatTime, safeDisplay } from "../components/PropCard";
import { getApiBaseUrl, getBackendMode } from "../services/api";
import { buildPageReport, bulletList, joinLines } from "./copyReport";

function getPickStatus(pick: any) {
  const raw = String(pick.status || "pending").toLowerCase();
  if (raw === "win") return "Win";
  if (raw === "loss") return "Loss";
  if (raw === "push") return "Push";
  return "Pending";
}

function getActualResult(pick: any) {
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

function formatPropReportLine(pick: any, index = 0) {
  const side = pick.side || pick.pick || "—";
  const line = pick.line ?? pick.sportsbookLine;
  const stat = pick.stat || "Points";
  const league = pick.league || "—";
  const team = pick.team || "—";
  const opponent = pick.opponent || "—";
  const game =
    pick.game || `${team} vs ${opponent}`;
  const confidence = pick.confidence ?? pick.winProbability ?? "—";
  const support = safeDisplay(pick.supportScore);
  const danger = safeDisplay(pick.resistanceScore ?? pick.dangerScore);
  const gap = safeDisplay(pick.supportDangerGap ?? pick.netEdge);
  const reasons = [
    ...(pick.reasons || pick.boosts || []).slice(0, 3),
    ...(pick.matchupNotes ? [pick.matchupNotes] : []),
  ].filter(Boolean);

  return joinLines([
    `[${index + 1}] ${pick.player || "Unknown"} (${league})`,
    `  Game: ${game} | Team/Opp: ${team} vs ${opponent}`,
    `  Prop: ${side} ${safeDisplay(line)} ${stat}`,
    `  Confidence: ${safeDisplay(confidence)}% | Risk: ${pick.riskLabel || "—"} | Tier: ${String(pick.tier || "WATCHLIST").toUpperCase()}`,
    `  Projection: ${safeDisplay(pick.projection)} | Fair Line: ${safeDisplay(pick.fairLine)} | Edge: ${safeDisplay(pick.edge)} | Fair Edge: ${safeDisplay(pick.fairLineEdge)}`,
    `  Support: ${support} | Danger: ${danger} | Gap/Net: ${gap}`,
    `  Books: ${safeDisplay(pick.bookCount)} | Market: ${safeDisplay(pick.marketQuality)}% | Data: ${safeDisplay(pick.dataQuality)}%`,
    reasons.length ? `  Top Reasons: ${reasons.join(" | ")}` : null,
    pick.warnings?.length ? `  Warnings: ${pick.warnings.slice(0, 2).join(" | ")}` : null,
    pick.dataMode ? `  Data Mode: ${pick.dataMode}` : null,
  ]);
}

function formatGameBoardLines(games: any[], leagueLabel: string) {
  if (!games.length) return "No games loaded.";

  return games
    .map((game, gameIndex) => {
      const picks = game.picks || [];
      const emptyMessage =
        !picks.length &&
        ((game.consensusPropCount ?? game.rawPropCount ?? 0) === 0
          ? "No player points props available for this game yet."
          : "No ranked picks available for this game yet.");

      const pickLines =
        picks.length > 0
          ? picks
              .map((pick: any, index: number) =>
                formatPropReportLine({ ...pick, league: pick.league || leagueLabel }, index)
              )
              .join("\n")
          : `  ${emptyMessage}`;

      return joinLines([
        `Game ${gameIndex + 1}: ${game.game || "Unknown"} (${game.dateLabel || game.date || "—"})`,
        `  Time: ${formatTime(game.time || game.commenceTime) || "—"}`,
        `  Candidates: ${game.allCandidateCount ?? 0} | Playable: ${game.playableCandidateCount ?? picks.length}`,
        `  Props shown: ${picks.length}`,
        pickLines,
      ]);
    })
    .join("\n\n");
}

function buildRecordSummary(record: {
  wins: number;
  losses: number;
  pushes: number;
  total?: number;
  winRate?: number;
  netUnits?: number;
}) {
  const total = record.total ?? record.wins + record.losses + record.pushes;
  const winRate =
    record.winRate ??
    (record.wins + record.losses > 0
      ? Math.round((record.wins / (record.wins + record.losses)) * 100)
      : 0);
  const netUnits = record.netUnits ?? record.wins - record.losses;

  return `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""} (${winRate}%, ${netUnits > 0 ? "+" : ""}${netUnits}u) — graded ${total}`;
}

export function buildHomeReport() {
  return buildPageReport({
    page: "Home",
    dataSource: "Static navigation shell",
    visibleSummary: joinLines([
      "CourtEdge home dashboard with links to Main Board and Tracking sections.",
      "Main Board: Top Props, NBA Props, WNBA Props, Full Game Board.",
      "Tracking: Saved Picks, Results History, Settings.",
    ]),
    mainData: joinLines([
      "Navigation targets:",
      "- /top-props — Top Props",
      "- /nba — NBA Props",
      "- /wnba — WNBA Props",
      "- /explore — Full Game Board",
      "- /view-picks — Saved Picks",
      "- /history — Results History",
      "- /prop-lab — Prop Lab",
      "- /settings — Settings",
      "",
      "Mission footer: Premium props only. Low volume. High trust.",
    ]),
    debugNotes: "Home does not fetch live prop data; open a board page for pick-level debugging.",
  });
}

export function buildTopPropsReport(input: {
  visibleProps: any[];
  leagueFilter: string;
  lastUpdated: string | null;
  loading: boolean;
  premiumCount: number;
  topPropsCount: number;
  topNBACount: number;
  topWNBACount: number;
  error?: string | null;
}) {
  const propLines = input.visibleProps.map((pick, index) =>
    formatPropReportLine(pick, index)
  );

  return buildPageReport({
    page: "Top Props / Picks",
    leagueFilter: input.leagueFilter,
    lastUpdated: input.lastUpdated,
    dataSource: "GET /top-props",
    extraContext: {
      "Total Props (visible)": input.visibleProps.length,
      "Total ALL/NBA/WNBA": `${input.topPropsCount}/${input.topNBACount}/${input.topWNBACount}`,
      Premium: input.premiumCount,
      Loading: input.loading,
    },
    visibleSummary: joinLines([
      `Filter: ${input.leagueFilter}`,
      `Props visible: ${input.visibleProps.length}`,
      `Premium visible: ${input.premiumCount}`,
      input.lastUpdated ? `Last updated: ${formatTime(input.lastUpdated)}` : "Last updated: —",
    ]),
    mainData: propLines.length ? propLines.join("\n\n") : "No props currently visible.",
    warnings:
      !input.loading && input.visibleProps.length === 0
        ? "No top props available. Refresh picks or check backend/API connection."
        : undefined,
    errors: input.error || undefined,
    debugNotes: "Each prop includes confidence, risk, tier, projection/fair line/edge, support/danger, books/market quality, and top reasons.",
  });
}

export function buildLeagueBoardReport(input: {
  page: "NBA Props" | "WNBA Props" | "Full Game Board";
  league: string;
  games: any[];
  topProps: any[];
  lastUpdated: string | null;
  loading: boolean;
  premiumCount: number;
  playableCount: number;
  leagueFilter?: string;
  error?: string | null;
  dataSource: string;
}) {
  const propsPerGame = input.games.map(
    (game) => `${game.game || "Unknown"}: ${(game.picks || []).length} props shown`
  );

  const missingDataNotes: string[] = [];
  for (const game of input.games) {
    if (!game.picks?.length) {
      missingDataNotes.push(
        `${game.game || "Unknown"} — ${
          (game.consensusPropCount ?? game.rawPropCount ?? 0) === 0
            ? "No player points props available"
            : "No ranked picks available"
        }`
      );
    }
  }

  return buildPageReport({
    page: input.page,
    leagueFilter: input.leagueFilter || input.league,
    lastUpdated: input.lastUpdated,
    dataSource: input.dataSource,
    extraContext: {
      Games: input.games.length,
      "Top Props": input.topProps.length,
      Premium: input.premiumCount,
      Playable: input.playableCount,
      Loading: input.loading,
    },
    visibleSummary: joinLines([
      `Games shown: ${input.games.length}`,
      `Top props section: ${input.topProps.length}`,
      `Premium top props: ${input.premiumCount}`,
      `Total playable candidates: ${input.playableCount}`,
      input.lastUpdated ? `Last updated: ${formatTime(input.lastUpdated)}` : null,
    ]),
    mainData: joinLines([
      input.topProps.length
        ? `--- Top ${input.league} Props ---\n${input.topProps
            .map((pick, index) => formatPropReportLine(pick, index))
            .join("\n\n")}`
        : null,
      input.games.length
        ? `--- Game Board ---\n${formatGameBoardLines(input.games, input.league)}`
        : null,
      propsPerGame.length
        ? `\nProps per game:\n${bulletList(propsPerGame)}`
        : null,
    ]),
    warnings: joinLines([
      !input.loading && input.games.length === 0
        ? `No ${input.league} games loaded.`
        : null,
      missingDataNotes.length
        ? `Missing/empty game data:\n${bulletList(missingDataNotes.slice(0, 12))}`
        : null,
    ]) || undefined,
    errors: input.error || undefined,
    debugNotes:
      input.page === "NBA Props"
        ? "NBA board uses SportsData projections and rotation context."
        : input.page === "WNBA Props"
          ? "WNBA board uses BallDontLie recent form and Odds API market lines."
          : "Full Game Board combines NBA + WNBA with ALL/NBA/WNBA filter.",
  });
}

export function buildSavedPicksReport(input: {
  picks: any[];
  filter: string;
  stats: {
    wins: number;
    losses: number;
    pushes: number;
    pending: number;
    winRate: number;
    netUnits: number;
    streakLabel: string;
  };
  loading: boolean;
  filteredPicks: any[];
  error?: string | null;
}) {
  const pickLines = input.picks.map((pick, index) => {
    const status = getPickStatus(pick);
    const actual = getActualResult(pick);

    return joinLines([
      `[${index + 1}] ${pick.player || "Unknown"} (${pick.league || "—"})`,
      `  Game: ${pick.game || "—"}`,
      `  Pick: ${pick.side || pick.pick || "—"} ${safeDisplay(pick.line ?? pick.sportsbookLine)} ${pick.stat || "Points"}`,
      `  Confidence: ${safeDisplay(pick.confidence ?? pick.winProbability)}% | Risk: ${pick.riskLabel || "—"} | Tier: ${String(pick.tier || "WATCHLIST").toUpperCase()}`,
      `  Status: ${status}${actual !== null && actual !== undefined ? ` | Actual: ${safeDisplay(actual)}` : ""}`,
      `  Saved At: ${formatTime(pick.createdAt || pick.savedAt) || "—"}`,
      pick.pendingReason ? `  Pending Reason: ${pick.pendingReason}` : null,
      pick.resolvedAt || pick.gradedAt
        ? `  Graded At: ${formatTime(pick.resolvedAt || pick.gradedAt)}`
        : null,
    ]);
  });

  return buildPageReport({
    page: "Saved Picks",
    leagueFilter: input.filter,
    dataSource: "GET /pick-history + POST /resolve-picks",
    extraContext: {
      "Total Saved": input.picks.length,
      Pending: input.stats.pending,
      Wins: input.stats.wins,
      Losses: input.stats.losses,
      Pushes: input.stats.pushes,
      "Filter View Count": input.filteredPicks.length,
      Loading: input.loading,
    },
    visibleSummary: joinLines([
      `Record: ${input.stats.wins}-${input.stats.losses}${input.stats.pushes ? `-${input.stats.pushes}` : ""}`,
      `Pending: ${input.stats.pending} | Win Rate: ${input.stats.winRate}% | Net Units: ${input.stats.netUnits > 0 ? "+" : ""}${input.stats.netUnits}`,
      `Streak: ${input.stats.streakLabel}`,
      `Active filter: ${input.filter}`,
    ]),
    mainData: pickLines.length ? pickLines.join("\n\n") : "No saved picks.",
    warnings: joinLines([
      !input.loading && input.picks.length === 0
        ? "No saved picks yet."
        : null,
      !input.loading && input.picks.length > 0 && input.stats.pending === 0
        ? "No pending picks — graded picks are in Results History."
        : null,
    ]) || undefined,
    errors: input.error || undefined,
  });
}

export function buildResultsReport(input: {
  picks: any[];
  overall: any;
  pendingCount: number;
  premiumRecord: any;
  nbaRecord: any;
  wnbaRecord: any;
  confidenceBuckets: any[];
  riskSummaries: any[];
  gradedPicks: any[];
  loading: boolean;
  lastCheckResponse?: any;
  error?: string | null;
}) {
  const gradedLines = input.gradedPicks.slice(0, 40).map((pick, index) => {
    const status = getPickStatus(pick);
    const actual = getActualResult(pick);

    return joinLines([
      `[${index + 1}] ${pick.player || "Unknown"} (${pick.league || "—"}) — ${status}`,
      `  ${pick.side || pick.pick || "—"} ${safeDisplay(pick.line ?? pick.sportsbookLine)} ${pick.stat || "Points"}`,
      `  Game: ${pick.game || "—"}`,
      `  Confidence: ${safeDisplay(pick.confidence ?? pick.winProbability)}% | Risk: ${pick.riskLabel || "—"}`,
      actual !== null && actual !== undefined ? `  Actual: ${safeDisplay(actual)}` : null,
      pick.resultMargin !== undefined || pick.margin !== undefined
        ? `  Margin: ${safeDisplay(pick.resultMargin ?? pick.margin)}`
        : null,
    ]);
  });

  const confidenceLines = input.confidenceBuckets.map(
    (bucket) => `${bucket.bucket}: ${buildRecordSummary(bucket)}`
  );

  const riskLines = input.riskSummaries.map(
    (group) =>
      `${group.label}: Total ${group.total} | W ${group.wins} | L ${group.losses} | P ${group.pushes} | Hit ${group.hitRate}% | Pending ${group.pending}`
  );

  const checkLines = input.lastCheckResponse
    ? joinLines([
        `ok: ${input.lastCheckResponse.ok ?? "—"}`,
        input.lastCheckResponse.message
          ? `message: ${input.lastCheckResponse.message}`
          : null,
        input.lastCheckResponse.error ? `error: ${input.lastCheckResponse.error}` : null,
        Array.isArray(input.lastCheckResponse.picks)
          ? `picks returned: ${input.lastCheckResponse.picks.length}`
          : null,
      ])
    : "No Check Pending Results response captured this session.";

  return buildPageReport({
    page: "Results History",
    dataSource: "GET /pick-history + POST /check-pending-results",
    extraContext: {
      "Total Picks Loaded": input.picks.length,
      "Graded Picks": input.gradedPicks.length,
      Pending: input.pendingCount,
      Loading: input.loading,
    },
    visibleSummary: joinLines([
      `Overall: ${buildRecordSummary(input.overall)}`,
      `Pending picks: ${input.pendingCount}`,
      `Premium: ${buildRecordSummary(input.premiumRecord)}`,
      `NBA: ${buildRecordSummary(input.nbaRecord)}`,
      `WNBA: ${buildRecordSummary(input.wnbaRecord)}`,
    ]),
    mainData: joinLines([
      "--- Confidence Buckets ---",
      confidenceLines.length ? bulletList(confidenceLines) : "No confidence bucket data yet.",
      "",
      "--- Risk Buckets ---",
      riskLines.length ? bulletList(riskLines) : "No risk bucket data yet.",
      "",
      "--- Graded Pick History (recent) ---",
      gradedLines.length ? gradedLines.join("\n\n") : "No completed picks yet.",
      "",
      "--- Check Pending Results (last response) ---",
      checkLines,
    ]),
    warnings:
      !input.loading && input.gradedPicks.length === 0
        ? "No completed picks yet. Saved picks appear here after CourtEdge grades them."
        : undefined,
    errors: input.error || undefined,
  });
}

export function buildPropLabReport(input: {
  reports: any[];
  selectedSlate: string | null;
  report: any;
  analytics: any;
  loading: boolean;
  building: boolean;
  refreshing: boolean;
  error?: string | null;
}) {
  const sectionA = input.report?.sections?.A;
  const sectionB = input.report?.sections?.B;
  const sectionC = input.report?.sections?.C;
  const sectionD = input.report?.sections?.D;
  const sectionE = input.report?.sections?.E;
  const sectionF = input.report?.sections?.F;
  const engineScorecard = input.report?.engineScorecard || input.report?.sections?.G;
  const mistakeBreakdown = input.report?.mistakeBreakdown || input.report?.sections?.H;
  const calibrationRules = input.report?.calibrationRules || input.report?.sections?.I;
  const slateLesson = input.report?.slateLesson || input.report?.sections?.J;
  const status = sectionA?.reportStatus || input.report?.status || "—";

  const engineLines = (engineScorecard?.engines || []).map(
    (engine: any) =>
      `${engine.engine}: ${engine.record} (${engine.winRate ?? "—"}%) • n=${engine.sampleSize} • avg margin ${safeDisplay(engine.avgMargin)} • ${engine.status}${engine.earlySignal ? " • early signal" : ""} — ${engine.lesson}`
  );

  const mistakeCategoryLines = Object.values(mistakeBreakdown?.categories || {})
    .filter((cat: any) => cat.count > 0)
    .map(
      (cat: any) =>
        `${cat.label}: ${cat.count} (${cat.pct}%)`
    );

  const mistakeDetailLines = (mistakeBreakdown?.losses || []).map(
    (loss: any, index: number) =>
      `[${index + 1}] ${loss.player} — ${loss.side} ${loss.line} | ${loss.label}: ${loss.explanation}`
  );

  const calibrationRuleLines = (calibrationRules?.rules || []).map(
    (rule: any) => `[${String(rule.priority).toUpperCase()}] ${rule.rule} — ${rule.reason}`
  );

  const slateLessonLines = slateLesson
    ? [
        slateLesson.headline,
        slateLesson.body,
        ...(slateLesson.bullets || []).map((b: string) => `• ${b}`),
      ].filter(Boolean)
    : [];

  const riskBucketLines = sectionB?.buckets
    ? Object.entries(sectionB.buckets).map(
        ([bucket, stats]: [string, any]) =>
          `${bucket}: ${stats.total} props • ${stats.wins}-${stats.losses}-${stats.pushes} (${stats.winRate}%) • pending ${stats.pending} • avg conf ${safeDisplay(stats.avgConfidence)} • edge ${safeDisplay(stats.avgFairLineEdge)} • gap ${safeDisplay(stats.avgSupportDangerGap)}`
      )
    : [];

  const signalLines: string[] = [];
  if (sectionD?.groups) {
    for (const [groupName, groups] of Object.entries(sectionD.groups)) {
      for (const [key, perf] of Object.entries(groups as Record<string, any>)) {
        signalLines.push(
          `${groupName}/${key}: ${perf.sample || 0} props • ${perf.wins}-${perf.losses}-${perf.pushes} (${perf.winRate}%)${perf.needsMoreData ? " • small sample" : ""}`
        );
      }
    }
  }

  const lossLines = (sectionE?.losses || []).map(
    (loss: any, index: number) =>
      `[${index + 1}] ${loss.player} — ${loss.side} ${loss.line} | ${loss.game} | actual ${loss.actualStat ?? "—"} | ${loss.missType}: ${loss.explanation}`
  );

  const recLines = [
    ...(sectionF?.signalsToTrustMore || []).map((item: string) => `Trust more: ${item}`),
    ...(sectionF?.signalsToTrustLess || []).map((item: string) => `Trust less: ${item}`),
    ...(sectionF?.riskBucketNotes || []).map((note: string) => `Risk note: ${note}`),
    ...(sectionF?.projectionNotes || []).map((note: string) => `Projection note: ${note}`),
    sectionF?.nextAdjustment ? `Next adjustment: ${sectionF.nextAdjustment}` : null,
    sectionF?.note ? `Note: ${sectionF.note}` : null,
  ].filter(Boolean) as string[];

  const analyticsOverall = input.analytics?.overall;
  const backendUrl = getApiBaseUrl();
  const backendMode = getBackendMode();

  return buildPageReport({
    page: "Prop Lab",
    leagueFilter: selectedSlateLabel(input.selectedSlate),
    lastUpdated: input.report?.updatedAt || input.report?.builtAt || null,
    dataSource: "GET /daily-slate-reports, /tracked-analytics",
    extraContext: {
      "Selected Slate": input.selectedSlate || "—",
      "Report Status": status,
      "Reports Available": input.reports.length,
      "Backend URL": backendUrl,
      "Backend Mode": backendMode,
      Loading: input.loading,
      Building: input.building,
      Refreshing: input.refreshing,
    },
    visibleSummary: joinLines([
      `Slate: ${selectedSlateLabel(input.selectedSlate)}`,
      `Report status: ${String(status).toUpperCase()}`,
      sectionA
        ? `Official props: ${sectionA.totalOfficialProps || 0} | Graded/Pending: ${sectionA.graded}/${sectionA.pending}`
        : null,
      sectionA
        ? `Slate record: ${sectionA.wins}-${sectionA.losses}-${sectionA.pushes} (${sectionA.overallWinRate}%)`
        : null,
      slateLesson?.headline || null,
      analyticsOverall?.currentEngine
        ? `All-time tracked engine: ${analyticsOverall.currentEngine.wins}-${analyticsOverall.currentEngine.losses}-${analyticsOverall.currentEngine.pushes} (${analyticsOverall.currentEngine.accuracy}%)`
        : null,
    ]),
    mainData: joinLines([
      sectionA
        ? `Daily Slate Report\nLeagues: ${(sectionA.leagues || []).join(", ") || "—"}`
        : "No slate report loaded.",
      slateLessonLines.length
        ? `\nSlate Lesson\n${slateLessonLines.join("\n")}`
        : null,
      engineLines.length
        ? `\nEngine Scorecard\n${bulletList(engineLines)}`
        : null,
      mistakeCategoryLines.length
        ? `\nMistake Breakdown\n${bulletList(mistakeCategoryLines)}`
        : null,
      mistakeDetailLines.length
        ? `\nMistake Details\n${mistakeDetailLines.join("\n")}`
        : null,
      calibrationRuleLines.length
        ? `\nCalibration Rules\n${bulletList(calibrationRuleLines)}`
        : null,
      sectionC
        ? `\nProjection / Fair Line Accuracy\nSample: ${sectionC.sample || 0} | Proj side win rate: ${sectionC.projectionSideWinRate ?? "—"}% | Avg projected/fair/actual/error: ${safeDisplay(sectionC.avgProjected)}/${safeDisplay(sectionC.avgFairLine)}/${safeDisplay(sectionC.avgActual)}/${safeDisplay(sectionC.avgError)} | Bias: ${sectionC.bias || "—"}`
        : null,
      riskBucketLines.length
        ? `\nRisk Bucket Breakdown\n${bulletList(riskBucketLines)}`
        : null,
      signalLines.length
        ? `\nEngine / Signal Performance (Detail)\n${bulletList(signalLines.slice(0, 30))}`
        : null,
      lossLines.length
        ? `\nLoss / Miss Type Report (Legacy)\n${lossLines.join("\n")}`
        : null,
      recLines.length
        ? `\nLegacy Calibration Recommendations\n${bulletList(recLines)}`
        : null,
      analyticsOverall
        ? `\nTracked Props Summary\nTotal tracked: ${analyticsOverall.total || 0} | Fair line shadow: ${
            analyticsOverall.fairLineShadow
              ? `${analyticsOverall.fairLineShadow.wins}-${analyticsOverall.fairLineShadow.losses}-${analyticsOverall.fairLineShadow.pushes} (${analyticsOverall.fairLineShadow.accuracy}%)`
              : "—"
          }`
        : null,
      input.reports.length
        ? `\nDaily Report Metadata\n${input.reports
            .slice(0, 8)
            .map(
              (item) =>
                `${item.slateDate}: status ${item.status || item.reportStatus || "—"} • props ${item.totalOfficialProps ?? "—"} • ${item.wins ?? 0}-${item.losses ?? 0}-${item.pushes ?? 0}`
            )
            .join("\n")}`
        : null,
      `\nBackend URL: ${backendUrl}`,
      `Backend Mode: ${backendMode}`,
    ]),
    warnings:
      !input.loading && !input.report
        ? "No slate reports yet. Build/refresh report after tracked props grade."
        : sectionA?.pending
          ? `${sectionA.pending} prop(s) still pending — report updates when all grade.`
          : undefined,
    errors: input.error || undefined,
    debugNotes: `Backend: ${backendUrl} (${backendMode})`,
  });
}

function selectedSlateLabel(slateDate: string | null) {
  if (!slateDate) return "—";
  const d = new Date(`${slateDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return slateDate;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

export function buildSettingsReport(input: {
  health: any;
  checking: boolean;
  refreshing: boolean;
  resolving: boolean;
  error?: string | null;
}) {
  const config = input.health?.config || {};

  return buildPageReport({
    page: "Settings",
    dataSource: "GET /health + manual testing tools",
    extraContext: {
      "Backend Online": input.health?.ok ? "yes" : "no",
      Checking: input.checking,
      Refreshing: input.refreshing,
      Resolving: input.resolving,
    },
    visibleSummary: joinLines([
      `API URL: ${getApiBaseUrl()}`,
      `Backend Mode: ${getBackendMode()}`,
      `Status: ${input.checking ? "Checking..." : input.health?.ok ? "Online" : "Offline"}`,
      input.health?.message || input.health?.error
        ? `Health message: ${input.health.message || input.health.error}`
        : null,
    ]),
    mainData: joinLines([
      "--- Loaded Keys (server-side flags only) ---",
      `SportsData: ${config.sportsKeyLoaded || "Unknown"}`,
      `Odds API: ${config.oddsKeyLoaded || "Unknown"}`,
      `BallDontLie: ${config.ballKeyLoaded || "Unknown"}`,
      "",
      "--- CourtEdge Rules ---",
      `Top Prop Limit: ${config.topPropLimit ?? "—"}`,
      `Premium Minimum: ${config.premiumConfidenceMin ?? "—"}%`,
      `Watchlist Minimum: ${config.watchlistConfidenceMin ?? "—"}%`,
      `NBA Enabled: ${config.nbaEnabled ?? "—"}`,
      `WNBA Enabled: ${config.wnbaEnabled ?? "—"}`,
      `Timezone: ${config.timezone || "—"}`,
    ]),
    warnings: !input.health?.ok && !input.checking ? "Backend health check failed or not yet run." : undefined,
    errors: input.error || undefined,
    debugNotes: "No API keys are included — only safe backend URL and loaded-key flags.",
  });
}
