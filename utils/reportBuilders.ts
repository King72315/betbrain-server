import { formatTime, safeDisplay } from "../components/PropCard";
import { getApiBaseUrl, getBackendMode } from "../services/api";
import { buildPageReport, bulletList, joinLines } from "./copyReport";
import { formatPointStrengthLedgerBlock } from "./pointStrengthLedger";
import {
  formatRecordLine,
  formatSlateDateLabel,
  getPickStatus,
  type HistoryEntry,
  type HistoryFilter,
} from "./historyArchive";
import { type SlateRotation } from "./slateRotation";
import {
  type ActiveResultsSlate,
  buildKeyTakeaways,
  computeAccuracySummary,
  computePendingCheckSummary,
  formatTrackedPropGameLabel,
  getTrackedPropStatus,
  groupResultsPropsByGame,
  groupResultsPropsByGameState,
  AWAITING_STATS_LABEL,
} from "./resultsQueue";
import { filterCompletedDailyReports, getTodayLocalDate, isOnOrAfterCleanDataCutoff } from "./slateRotation";

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
    formatPointStrengthLedgerBlock(pick)
      ? `  Point Strength Ledger:\n${formatPointStrengthLedgerBlock(pick)}`
      : null,
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
      "Tracking: Saved Picks, Results, Lab, History, Settings.",
    ]),
    mainData: joinLines([
      "Navigation targets:",
      "- /top-props — Top Props",
      "- /nba — NBA Props",
      "- /wnba — WNBA Props",
      "- /explore — Full Game Board",
      "- /view-picks — Saved Picks",
      "- /results — Results (official grading queue)",
      "- /history — History (archived Lab slates)",
      "- /prop-lab — Prop Lab",
      "- /settings — Settings",
      "",
      "Mission footer: Premium props only. Low volume. High trust.",
    ]),
    debugNotes: "Home does not fetch live prop data; open a board page for pick-level debugging.",
  });
}

function formatTopPropSnapshotLine(
  pick: any,
  playType: "Official" | "Test",
  index: number
) {
  const side = pick.side || pick.pick || "—";
  const line = pick.line ?? pick.sportsbookLine;
  const stat = pick.stat || "Points";
  const league = pick.league || "—";
  const team = pick.team || "—";
  const opponent = pick.opponent || "—";
  const rank = pick.topPickRank || pick.leagueRank || pick.rank || index + 1;
  const rankLabel = pick.topPickLabel || `Top ${league} #${rank}`;
  const confidence = pick.confidence ?? pick.winProbability ?? "—";
  const bestPropScore = pick.bestPropScore ?? pick.finalBestPropScore;
  const whySide = pick.whySide || pick.wnbaReader?.supports || pick.support || [];
  const topReasons = [
    ...whySide.slice(0, 3),
    ...(pick.reasons || pick.boosts || []).slice(0, 3),
  ].filter(Boolean);
  const missingWarnings =
    pick.missingDataWarnings ||
    (pick.wnbaDataCard?.dataMissingFlags || [])
      .filter((f: any) => f.missing)
      .map((f: any) => f.note || f.key);

  return joinLines([
    `[${rankLabel}] ${pick.player || "Unknown"} (${league}) — ${playType}`,
    `  ${team} vs ${opponent}`,
    `  Prop: ${side} ${safeDisplay(line)} ${stat}`,
    `  Confidence: ${safeDisplay(confidence)}% | Best Prop Score: ${safeDisplay(bestPropScore)}`,
    `  Projection: ${safeDisplay(pick.projection)} | Fair Line: ${safeDisplay(pick.fairLine)}`,
    topReasons.length
      ? `  Top Reasons: ${topReasons.slice(0, 3).join(" | ")}`
      : null,
    missingWarnings?.length
      ? `  Missing Data: ${missingWarnings.join(", ")}`
      : null,
  ]);
}

export function buildTopPropsReport(input: {
  nbaCards: { pick: any; playType: "Official" | "Test" }[];
  wnbaCards: { pick: any; playType: "Official" | "Test" }[];
  lastUpdated: string | null;
}) {
  const generatedAt = input.lastUpdated
    ? formatTime(input.lastUpdated)
    : formatTime(new Date().toISOString());

  const nbaLines = input.nbaCards.map((card, index) =>
    formatTopPropSnapshotLine(card.pick, card.playType, index)
  );
  const wnbaLines = input.wnbaCards.map((card, index) =>
    formatTopPropSnapshotLine(card.pick, card.playType, index)
  );

  return joinLines([
    "Top Props — CourtEdge",
    `Generated: ${generatedAt || "—"}`,
    "",
    "--- Best 2 NBA Props ---",
    nbaLines.length ? nbaLines.join("\n\n") : "No NBA props available.",
    "",
    "--- Best 2 WNBA Props ---",
    wnbaLines.length ? wnbaLines.join("\n\n") : "No WNBA props available.",
  ]);
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
        ? "No pending picks — graded saved picks remain in this tab."
        : null,
    ]) || undefined,
    errors: input.error || undefined,
  });
}

function formatHistoryPickLine(pick: any, index: number) {
  const status = getPickStatus(pick);
  const actual =
    pick.actualPoints ??
    pick.finalPoints ??
    pick.actualStat ??
    pick.resultMeta?.points ??
    null;
  const officialLine = pick.officialLine ?? pick.line ?? pick.sportsbookLine;
  const latestLine = pick.latestLine ?? pick.currentLine ?? officialLine;

  return joinLines([
    `[${index + 1}] ${pick.player || "Unknown"} (${pick.league || "—"}) — ${status}`,
    `  ${pick.side || pick.pick || pick.currentEngineSide || "—"} ${safeDisplay(officialLine)} ${pick.stat || "Points"}`,
    latestLine !== undefined &&
    officialLine !== undefined &&
    Number(latestLine) !== Number(officialLine)
      ? `  Line: official ${safeDisplay(officialLine)} → latest ${safeDisplay(latestLine)}`
      : null,
    `  Confidence: ${safeDisplay(pick.confidence ?? pick.winProbability)}% | Risk: ${pick.riskLabel || "—"} | Tier: ${String(pick.tier || "WATCHLIST").toUpperCase()}`,
    actual !== null && actual !== undefined ? `  Actual: ${safeDisplay(actual)}` : null,
    pick.resultMargin !== undefined || pick.margin !== undefined
      ? `  Margin: ${safeDisplay(pick.resultMargin ?? pick.margin)}`
      : null,
    pick.pendingReason ? `  Pending reason: ${pick.pendingReason}` : null,
    pick.bookCount !== undefined ? `  Books: ${safeDisplay(pick.bookCount)}` : null,
    pick.dataMode ? `  Data Mode: ${pick.dataMode}` : null,
    pick.gameLabel || pick.game ? `  Game: ${pick.gameLabel || pick.game}` : null,
  ]);
}

export function buildHistoryReport(input: {
  entries: HistoryEntry[];
  filteredEntries: HistoryEntry[];
  filter: HistoryFilter;
  loading: boolean;
  error?: string | null;
  retentionDays?: number;
  displayCleared?: boolean;
  currentLabSlateDate?: string | null;
}) {
  const cleanFilteredEntries = input.filteredEntries.filter((entry) =>
    isOnOrAfterCleanDataCutoff(entry.slateDate)
  );
  const summaryLines = cleanFilteredEntries.map((entry) => {
    const typeLabel =
      entry.type === "saved-picks"
        ? "Saved Picks"
        : entry.archiveLabel || "Archived Lab Slate";
    const performance = entry.hasGradedPerformance
      ? `${formatRecordLine(entry)} | ${entry.status} | pending ${entry.pending}`
      : `${entry.emptyLabel || "No completed official props yet"} | ${entry.status}`;
    return `${formatSlateDateLabel(entry.slateDate)} | ${typeLabel} | ${(entry.leagues || []).join("/") || "—"} | ${performance}${entry.topLesson ? ` | Lesson: ${entry.topLesson}` : ""}`;
  });

  const detailBlocks = cleanFilteredEntries.slice(0, 12).map((entry) => {
    const header = joinLines([
      `--- ${formatSlateDateLabel(entry.slateDate)} (${entry.type === "saved-picks" ? "Saved Picks" : entry.archiveLabel || "Archived Lab Slate"}) ---`,
      `Leagues: ${(entry.leagues || []).join(", ") || "—"}`,
      entry.hasGradedPerformance
        ? `Record: ${formatRecordLine(entry)}`
        : `Archive Note: ${entry.emptyLabel || "No completed official props yet"}`,
      entry.hasGradedPerformance
        ? `Status: ${entry.status} | Graded: ${entry.graded}/${entry.total} | Pending: ${entry.pending}`
        : `Status: ${entry.status} | Official props tracked: ${entry.total} | Graded: 0`,
      entry.topLesson ? `Top Lesson: ${entry.topLesson}` : null,
    ]);

    if (!entry.hasGradedPerformance) {
      const bundleLines = (entry.picks || [])
        .slice(0, 50)
        .map((pick, index) => formatHistoryPickLine(pick, index));
      return joinLines([
        header,
        bundleLines.length ? `\nTracked Props:\n${bundleLines.join("\n\n")}` : null,
      ]);
    }

    const pickLines = (entry.picks || [])
      .slice(0, 50)
      .map((pick, index) => formatHistoryPickLine(pick, index));

    const engine = entry.reportSummary?.engineScorecard || entry.reportSummary?.sections?.G;
    const engineLines = (engine?.engines || [])
      .slice(0, 6)
      .map(
        (item: any) =>
          `${item.engine}: ${item.record} (${item.winRate ?? "—"}%) — ${item.status} — ${item.lesson}`
      );

    const lesson = entry.reportSummary?.slateLesson || entry.reportSummary?.sections?.J;
    const lessonLines = lesson
      ? [
          lesson.headline,
          lesson.body,
          ...(lesson.bullets || []).map((bullet: string) => `• ${bullet}`),
        ].filter(Boolean)
      : [];

    return joinLines([
      header,
      pickLines.length ? `\nPicks:\n${pickLines.join("\n\n")}` : null,
      lessonLines.length ? `\nSlate Lesson:\n${lessonLines.join("\n")}` : null,
      engineLines.length ? `\nEngine Scorecard:\n${bulletList(engineLines)}` : null,
    ]);
  });

  return buildPageReport({
    page: "History",
    leagueFilter: input.filter,
    dataSource: "GET /saved-picks, /daily-slate-reports, /tracked-props, /history-archives (read-only)",
    extraContext: {
      "Archive Entries": input.entries.length,
      "Visible After Filter": input.filteredEntries.length,
      "Backend URL": getApiBaseUrl(),
      "Backend Mode": getBackendMode(),
      Loading: input.loading,
    },
    visibleSummary: joinLines([
      `Filter: ${input.filter}`,
      `Archived entries visible: ${input.filteredEntries.length}`,
      `Performance archive entries: ${input.filteredEntries.filter((entry) => entry.hasGradedPerformance).length}`,
      `Total archive entries loaded: ${input.entries.length}`,
      input.retentionDays
        ? `Retention: last ${input.retentionDays} days (display filter only)`
        : null,
      input.currentLabSlateDate
        ? `Current Lab slate excluded: ${input.currentLabSlateDate}`
        : null,
      input.displayCleared ? "History display cleared locally on this device." : null,
    ]),
    mainData: joinLines([
      "--- Archive Index ---",
      summaryLines.length ? bulletList(summaryLines) : "No archived entries yet.",
      "",
      "--- Expanded Archive Details (up to 12) ---",
      detailBlocks.length ? detailBlocks.join("\n\n") : "No detail blocks to show.",
      "",
      `Backend URL: ${getApiBaseUrl()}`,
      `Backend Mode: ${getBackendMode()}`,
    ]),
    warnings:
      !input.loading && input.entries.length === 0
        ? "No archived entries yet. Saved picks appear after grading; older completed Lab slates appear when replaced by a newer completed slate."
        : undefined,
    errors: input.error || undefined,
    debugNotes:
      "Read-only archive view. Current Lab slate stays in Prop Lab. 7-day display filter and Clear History are local-only — backend data is never deleted.",
  });
}

export function buildResultsReport(input: {
  visibleSlates: ActiveResultsSlate[];
  filteredSlates: ActiveResultsSlate[];
  filter: string;
  loading: boolean;
  refreshing: boolean;
  lastResolveSummary?: any;
  resolveCheckMessage?: string | null;
  error?: string | null;
}) {
  const accuracy = computeAccuracySummary(input.visibleSlates, { recordType: "all" });
  const officialAccuracy = computeAccuracySummary(input.visibleSlates, {
    recordType: "official",
  });
  const testAccuracy = computeAccuracySummary(input.visibleSlates, { recordType: "test" });
  const pendingCheck = computePendingCheckSummary(
    input.lastResolveSummary,
    input.visibleSlates
  );
  const takeaways = buildKeyTakeaways(accuracy);
  const todayLocalDate = getTodayLocalDate();
  const activeSlateDate = input.visibleSlates[0]?.slateDate || todayLocalDate;

  const formatResultPropLine = (prop: any, index: number) => {
    const status = getTrackedPropStatus(prop);
    const actual = prop.actualStat ?? prop.actualPoints ?? prop.finalPoints ?? null;

    return joinLines([
      `[${index + 1}] ${prop.player || "Unknown"} (${prop.league || "—"}) — ${status.toUpperCase()}`,
      `  ${prop.currentEngineSide || prop.side || "—"} ${safeDisplay(prop.line)} ${prop.stat || "Points"}`,
      `  Game: ${formatTrackedPropGameLabel(prop)}`,
      `  Confidence: ${safeDisplay(prop.confidence)}% | Risk: ${prop.riskLabel || "—"} | Tier: ${String(prop.tier || "—").toUpperCase()}`,
      actual !== null && actual !== undefined ? `  Actual: ${safeDisplay(actual)}` : null,
      prop.resultMargin !== undefined ? `  Margin: ${safeDisplay(prop.resultMargin)}` : null,
      prop.pendingReason ? `  Pending Reason: ${prop.pendingReason}` : null,
    ]);
  };

  const slateSections = input.filteredSlates.map((slate) => {
    const slateProps = slate.props.slice(0, 40);
    const gameState = groupResultsPropsByGameState(slateProps);

    const formatGameStateBlock = (
      title: string,
      props: any[],
      note?: string
    ) => {
      if (!props.length) return null;
      const byGame = groupResultsPropsByGame(props);
      const lines: string[] = [`--- ${title} ---`];
      if (note) lines.push(note);
      for (const [game, gameProps] of byGame.entries()) {
        lines.push(`Game: ${game}`);
        gameProps.forEach((prop, index) => {
          lines.push(formatResultPropLine(prop, index));
        });
      }
      return lines.join("\n");
    };

    return joinLines([
      `--- Active Slate: ${slate.slateDate} ---`,
      `Current Results Slate: ${activeSlateDate}`,
      `Total Tracked Props: ${slate.summary?.total ?? slateProps.length}`,
      `Official Props: ${officialAccuracy.total} | Test / Learning Props: ${testAccuracy.total}`,
      `Graded: ${slate.summary?.graded ?? 0} | Pending: ${slate.summary?.pending ?? 0} | Awaiting Stats: ${slate.summary?.failed ?? 0}`,
      slate.summary?.graded
        ? `Record: ${slate.summary.wins}-${slate.summary.losses}-${slate.summary.pushes}`
        : null,
      formatGameStateBlock("Graded", gameState.graded),
      formatGameStateBlock(
        "Final — Awaiting Stats",
        gameState.awaitingStats,
        AWAITING_STATS_LABEL
      ),
      formatGameStateBlock("Game Not Final — Live / Upcoming", gameState.livePending),
      !slateProps.length ? "No tracked props in this view." : null,
    ]);
  });

  const accuracyBlock = joinLines([
    "--- Accuracy Summary ---",
    `Today (CT): ${todayLocalDate}`,
    `Results rule: today's tracked props only`,
    `Total Tracked: ${accuracy.total}`,
    `Official Props: ${officialAccuracy.total}`,
    `Test / Learning Props: ${testAccuracy.total}`,
    `Graded: ${accuracy.graded}`,
    `Pending: ${accuracy.pending}`,
    `Awaiting Stats: ${accuracy.awaitingStats}`,
    `Wins: ${accuracy.wins} | Losses: ${accuracy.losses} | Pushes: ${accuracy.pushes}`,
    `Win Rate: ${accuracy.winRateLabel} (pushes excluded)`,
  ]);

  const pendingCheckBlock = pendingCheck
    ? joinLines([
        "--- Pending Check Summary ---",
        `Checked: ${pendingCheck.checked}`,
        `Graded: ${pendingCheck.graded}`,
        `Still Pending: ${pendingCheck.stillPending}`,
        `Awaiting Stats: ${pendingCheck.awaitingStats}`,
        input.resolveCheckMessage ? `Last check message: ${input.resolveCheckMessage}` : null,
      ])
    : input.resolveCheckMessage
      ? joinLines([
          "--- Pending Check Summary ---",
          `Last check message: ${input.resolveCheckMessage}`,
        ])
      : null;

  const takeawaysBlock = takeaways.length
    ? joinLines(["--- Key Takeaways ---", ...takeaways.map((line) => `• ${line}`)])
    : null;

  const debugNotes =
    "Results shows today's tracked props only (America/Chicago). Stale unresolved slates are excluded from Results and surfaced in backend diagnostics. Completed slates move to Lab; archived slates appear in History.";

  return buildPageReport({
    page: "Results",
    leagueFilter: input.filter,
    dataSource: "GET /tracked-props + POST /resolve-tracked-props",
    extraContext: {
      "Active Slates": input.visibleSlates.length,
      "Total Tracked Props": accuracy.total,
      "Official Props": officialAccuracy.total,
      "Test / Learning Props": testAccuracy.total,
      Pending: accuracy.pending,
      "Awaiting Stats": accuracy.awaitingStats,
      Graded: accuracy.graded,
      Loading: input.loading,
      Refreshing: input.refreshing,
    },
    visibleSummary: joinLines([
      `Today (CT): ${todayLocalDate}`,
      `Results rule: today's tracked props only`,
      input.visibleSlates.length
        ? `Today's queue: ${accuracy.total} props`
        : "No tracked props for today yet.",
      accuracy.total
        ? `Total Tracked: ${accuracy.total} | Official: ${officialAccuracy.total} | Test: ${testAccuracy.total} | Graded: ${accuracy.graded} | Pending: ${accuracy.pending} | Awaiting Stats: ${accuracy.awaitingStats}`
        : null,
      accuracy.graded
        ? `Record: ${accuracy.wins}-${accuracy.losses}-${accuracy.pushes} | Win Rate: ${accuracy.winRateLabel}`
        : null,
      `Filter: ${input.filter}`,
    ]),
    mainData: joinLines([
      accuracyBlock,
      "",
      pendingCheckBlock,
      pendingCheckBlock ? "" : null,
      takeawaysBlock,
      takeawaysBlock ? "" : null,
      input.visibleSlates.length
        ? "--- Today's Slate Details ---"
        : "--- No tracked props for today ---",
      slateSections.length
        ? slateSections.join("\n\n")
        : "No tracked props for today yet.",
    ]),
    warnings: joinLines([
      !input.loading && input.visibleSlates.length === 0
        ? "No tracked props for today yet. Refresh the board to generate today's props."
        : null,
    ]) || undefined,
    errors: input.error || undefined,
    debugNotes,
  });
}

function formatLeagueSplitRecord(leagueData: any) {
  if (!leagueData?.record) return "—";
  const { wins, losses, pushes, winRate } = leagueData.record;
  return `${wins}-${losses}-${pushes} (${winRate ?? "—"}%) • ${leagueData.propCount ?? 0} props`;
}

function formatLeagueTierPerf(perf: any) {
  if (!perf || !perf.sample) return "—";
  return `${perf.wins}-${perf.losses}-${perf.pushes} (${perf.winRate ?? "—"}%) • n=${perf.sample}`;
}

function buildLeagueSplitReportLines(leagueSplit: any, leagueCalibration: any) {
  const lines: string[] = [];
  const byLeague = leagueSplit?.byLeague || {};
  const structural =
    leagueSplit?.structuralNotes || leagueCalibration?.structuralNotes || null;

  if (structural) {
    lines.push("WNBA structural gaps (pick pipeline — not calibration pool):");
    lines.push(`• availability gate: ${structural.availabilityGate || "—"}`);
    lines.push(`• defense score: ${structural.defenseScore || "—"}`);
    lines.push(`• primary stat source: ${structural.primaryStatSource || "—"}`);
  }

  for (const league of ["NBA", "WNBA"]) {
    const slate = byLeague[league];
    const allTime = leagueCalibration?.[league];
    lines.push(`\n${league} — slate record: ${slate ? formatLeagueSplitRecord(slate) : "—"}`);
    lines.push(
      `${league} PREMIUM (slate): ${slate ? formatLeagueTierPerf(slate.premium) : "—"}`
    );
    lines.push(
      `${league} PLAYABLE (slate): ${slate ? formatLeagueTierPerf(slate.playable) : "—"}`
    );
    if (allTime) {
      lines.push(
        `${league} all-time tracked: ${allTime.wins}-${allTime.losses}-${allTime.pushes} (${allTime.accuracy ?? "—"}%) • PREMIUM ${allTime.premium?.wins ?? 0}-${allTime.premium?.losses ?? 0}-${allTime.premium?.pushes ?? 0} (${allTime.premium?.accuracy ?? "—"}%)`
      );
    }
    if (slate?.riskBuckets) {
      const riskLines = Object.entries(slate.riskBuckets)
        .filter(([, stats]: [string, any]) => (stats.total || 0) > 0)
        .map(
          ([bucket, stats]: [string, any]) =>
            `${bucket}: ${stats.wins}-${stats.losses}-${stats.pushes} (${stats.winRate ?? "—"}%)`
        );
      if (riskLines.length) {
        lines.push(`${league} risk buckets: ${riskLines.join(" | ")}`);
      }
    }
  }

  if (leagueSplit?.note) {
    lines.push(`\nNote: ${leagueSplit.note}`);
  }

  return lines;
}

export function buildPropLabReport(input: {
  reports: any[];
  rotation: SlateRotation;
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
  const leagueSplit = input.report?.leagueSplit || input.report?.sections?.L;
  const status = sectionA?.reportStatus || input.report?.status || "—";
  const currentLabSlateDate = input.rotation.currentLabSlateDate;

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
  const leagueCalibration = input.analytics?.leagueCalibration;
  const leagueSplitLines = buildLeagueSplitReportLines(leagueSplit, leagueCalibration);
  const backendUrl = getApiBaseUrl();
  const backendMode = getBackendMode();
  const validCompletedReports = filterCompletedDailyReports(
    (input.reports || []).filter((report) =>
      isOnOrAfterCleanDataCutoff(report?.slateDate)
    )
  );
  const reportsAvailable = validCompletedReports.length;
  const hasLabSlate = Boolean(currentLabSlateDate && input.report);
  const allTimeRecord = hasLabSlate && analyticsOverall?.currentEngine
    ? `${analyticsOverall.currentEngine.wins}-${analyticsOverall.currentEngine.losses}-${analyticsOverall.currentEngine.pushes} (${analyticsOverall.currentEngine.accuracy}%)`
    : "—";
  const trackedTotal = hasLabSlate ? analyticsOverall?.total || 0 : 0;
  const fairLineShadowRecord = hasLabSlate && analyticsOverall?.fairLineShadow
    ? `${analyticsOverall.fairLineShadow.wins}-${analyticsOverall.fairLineShadow.losses}-${analyticsOverall.fairLineShadow.pushes} (${analyticsOverall.fairLineShadow.accuracy}%)`
    : "—";

  return buildPageReport({
    page: "Prop Lab",
    leagueFilter: selectedSlateLabel(currentLabSlateDate),
    lastUpdated: input.report?.updatedAt || input.report?.builtAt || null,
    dataSource: "GET /daily-slate-reports, /tracked-analytics",
    extraContext: {
      "Current Lab Slate": currentLabSlateDate || "—",
      "History Slates": input.rotation.historySlates.length,
      "Active / In-Progress": 0,
      "Report Status": hasLabSlate ? status : "—",
      "Reports Available": reportsAvailable,
      "Backend URL": backendUrl,
      "Backend Mode": backendMode,
      Loading: input.loading,
      Building: input.building,
      Refreshing: input.refreshing,
    },
    visibleSummary: joinLines([
      currentLabSlateDate
        ? `Current Lab Slate: ${selectedSlateLabel(currentLabSlateDate)}`
        : "No completed Lab slate yet. Current active slate remains in Results.",
      hasLabSlate ? `Report status: ${String(status).toUpperCase()}` : null,
      sectionA
        ? `Official props: ${sectionA.totalOfficialProps || 0} | Graded/Pending: ${sectionA.graded}/${sectionA.pending}`
        : null,
      sectionA
        ? `Slate record (pooled): ${sectionA.wins}-${sectionA.losses}-${sectionA.pushes} (${sectionA.overallWinRate}%)`
        : null,
      leagueSplit?.byLeague?.NBA
        ? `NBA slate record: ${formatLeagueSplitRecord(leagueSplit.byLeague.NBA)}`
        : null,
      leagueSplit?.byLeague?.WNBA
        ? `WNBA slate record: ${formatLeagueSplitRecord(leagueSplit.byLeague.WNBA)}`
        : null,
      leagueSplit?.byLeague?.NBA?.premium
        ? `NBA PREMIUM (slate): ${formatLeagueTierPerf(leagueSplit.byLeague.NBA.premium)}`
        : null,
      leagueSplit?.byLeague?.WNBA?.premium
        ? `WNBA PREMIUM (slate): ${formatLeagueTierPerf(leagueSplit.byLeague.WNBA.premium)}`
        : null,
      slateLesson?.headline || null,
      input.rotation.historySlates.length
        ? `Archived in History: ${input.rotation.historySlates.length} older completed slate(s)`
        : null,
      analyticsOverall?.currentEngine && hasLabSlate
        ? `All-time tracked engine: ${allTimeRecord}`
        : hasLabSlate
          ? null
          : "All-time tracked engine: —",
    ]),
    mainData: joinLines([
      currentLabSlateDate
        ? `Current Lab Slate (${selectedSlateLabel(currentLabSlateDate)})\nThis slate remains in Lab until the next completed slate replaces it.`
        : "No completed Lab slate yet. Current active slate remains in Results.",
      sectionA
        ? `Daily Slate Report\nLeagues: ${(sectionA.leagues || []).join(", ") || "—"}`
        : null,
      leagueSplitLines.length
        ? `\nLeague-Split Calibration\n${leagueSplitLines.join("\n")}`
        : null,
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
      hasLabSlate
        ? `\nTracked Props Summary\nTotal tracked: ${trackedTotal} | Fair line shadow: ${fairLineShadowRecord}`
        : `\nTracked Props Summary\nTotal tracked: 0 | Fair line shadow: —`,
      input.rotation.historySlates.length
        ? `\nHistory Rotation\n${input.rotation.historySlates
            .slice(0, 8)
            .map(
              (item) =>
                `${item.slateDate}: archived • ${item.sections?.A?.wins ?? 0}-${item.sections?.A?.losses ?? 0}-${item.sections?.A?.pushes ?? 0}`
            )
            .join("\n")}` 
        : null,
      `\nBackend URL: ${backendUrl}`,
      `Backend Mode: ${backendMode}`,
    ]),
    warnings:
      !input.loading && !input.report
        ? "Waiting for completed slate. In-progress slates remain in Results until all props grade and report is final."
        : sectionA?.pending
          ? `${sectionA.pending} prop(s) still pending — report updates when all grade.`
          : undefined,
    errors: input.error || undefined,
    debugNotes: hasLabSlate
      ? `Lab rotation: current=${currentLabSlateDate || "none"} | history=${input.rotation.historySlates.length} | active=${input.rotation.activeResults.length}. Backend: ${backendUrl} (${backendMode})`
      : `Lab rotation: no completed slate. Active slates remain in Results. Backend: ${backendUrl} (${backendMode})`,
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
