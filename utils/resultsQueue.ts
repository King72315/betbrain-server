import { formatTeam } from "../components/PropCard";
import { getPickSlateDate } from "./historyArchive";
import { inferTrackingType } from "./labTrackingInference";
import {
  formatSlateMessageDate,
  formatSlateMovedToLabMessage,
} from "./slateMessages";
import {
  computeSlateRotation,
  getBlockingActiveResultsSlateDate,
  getReportPending,
  getResultsPropSlateDate,
  getTodayLocalDate,
  hasUnresolvedGradingProps,
  isCompletedSlate,
  isFutureSlateDate,
  isOnOrAfterCleanDataCutoff,
  isPriorSlateStillActive,
  isTodayResultsCohortOpen,
  formatPriorSlateStillActiveLabel,
  pickActiveResultsSlateDate,
  PRIOR_SLATE_STILL_ACTIVE_LABEL,
  slateHasUnresolvedProps,
  type SlateRotation,
} from "./slateRotation";

export { getResultsPropSlateDate, pickActiveResultsSlateDate, isTodayResultsCohortOpen } from "./slateRotation";

export {
  PRIOR_SLATE_STILL_ACTIVE_LABEL,
  isPriorSlateStillActive,
  formatPriorSlateStillActiveLabel,
};

export const RESULTS_LEAGUE_TABS = ["All", "NBA", "WNBA"] as const;
export const RESULTS_STATUS_FILTERS = [
  "All",
  "Pending",
  "Graded",
  "Awaiting stats",
] as const;

/** Combined chip list (legacy). Prefer RESULTS_LEAGUE_TABS + RESULTS_STATUS_FILTERS. */
export const RESULTS_FILTERS = [
  ...RESULTS_STATUS_FILTERS,
  "NBA",
  "WNBA",
] as const;

export type ResultsLeagueTab = (typeof RESULTS_LEAGUE_TABS)[number];
export type ResultsStatusFilter = (typeof RESULTS_STATUS_FILTERS)[number];
export type ResultsFilter = (typeof RESULTS_FILTERS)[number];

const TENNIS_LEAGUE_TOKENS = new Set([
  "TENNIS",
  "ATP",
  "WTA",
  "TENNISEDGE",
  "TENNIS_EDGE",
]);

export function isTennisTrackedProp(prop: any): boolean {
  const league = String(prop?.league || prop?.sport || "").toUpperCase().trim();
  if (TENNIS_LEAGUE_TOKENS.has(league)) return true;
  if (league.includes("TENNIS")) return true;
  const product = String(prop?.product || prop?.edge || "").toUpperCase();
  return product.includes("TENNIS");
}

export function filterTennisTrackedProps(props: any[]): any[] {
  return (Array.isArray(props) ? props : []).filter(isTennisTrackedProp);
}

export function filterCourtEdgeTrackedProps(props: any[]): any[] {
  return (Array.isArray(props) ? props : []).filter((prop) => !isTennisTrackedProp(prop));
}

export type TrackedPropStatus = "Win" | "Loss" | "Push" | "Pending" | "Awaiting stats";

export type ResultsGameStateGroup = "graded" | "awaitingStats" | "livePending";

export const AWAITING_STATS_LABEL =
  "Final game — awaiting official player stats";

export type ActiveResultsSlate = {
  slateDate: string;
  props: any[];
  report: any | null;
  rotation: SlateRotation;
  isComplete: boolean;
  summary: {
    total: number;
    graded: number;
    pending: number;
    failed: number;
    wins: number;
    losses: number;
    pushes: number;
  };
  leagues: string[];
};

function isAwaitingOfficialStats(prop: any): boolean {
  const resolveDebug = prop.resolveDebug || {};
  const pendingReason = String(prop.pendingReason || "").toLowerCase();

  if (
    resolveDebug.gameFinal === true &&
    pendingReason.includes("final player stats unavailable")
  ) {
    return true;
  }

  if (resolveDebug.gameFinal === true) {
    return true;
  }

  if (pendingReason.includes("awaiting official player stat")) {
    return true;
  }

  if (
    pendingReason.includes("awaiting stats") &&
    !pendingReason.includes("game not final")
  ) {
    return true;
  }

  return false;
}

function isGameNotFinal(prop: any): boolean {
  const resolveDebug = prop.resolveDebug || {};
  const pendingReason = String(prop.pendingReason || "").toLowerCase();

  if (resolveDebug.gameFinal === false) return true;
  if (resolveDebug.blockedByGameNotFinal || resolveDebug.blockedByLiveGame) {
    return true;
  }
  if (pendingReason.includes("game not final")) return true;

  return false;
}

export function getTrackedPropStatus(prop: any): TrackedPropStatus {
  const raw = String(prop.status || "pending").toLowerCase();

  if (raw === "win" || raw === "loss" || raw === "push") {
    const resolveDebug = prop.resolveDebug || {};
    if (resolveDebug.gameFinal === false) {
      return "Pending";
    }
    return raw === "win" ? "Win" : raw === "loss" ? "Loss" : "Push";
  }

  if (isAwaitingOfficialStats(prop)) {
    return "Awaiting stats";
  }

  return "Pending";
}

export function getResultsPropGameState(prop: any): ResultsGameStateGroup {
  const raw = String(prop.status || "pending").toLowerCase();
  const resolveDebug = prop.resolveDebug || {};

  if (["win", "loss", "push"].includes(raw)) {
    if (resolveDebug.gameFinal === false) {
      return "livePending";
    }
    return "graded";
  }

  if (isAwaitingOfficialStats(prop)) {
    return "awaitingStats";
  }

  if (isGameNotFinal(prop)) {
    return "livePending";
  }

  return "livePending";
}

export function groupResultsPropsByGameState(props: any[] = []) {
  const groups = {
    graded: [] as any[],
    awaitingStats: [] as any[],
    livePending: [] as any[],
  };

  for (const prop of props) {
    groups[getResultsPropGameState(prop)].push(prop);
  }

  return groups;
}

export function groupResultsPropsByGame(props: any[] = []) {
  const groups = new Map<string, any[]>();

  for (const prop of props) {
    const game = formatTrackedPropGameLabel(prop);
    if (!groups.has(game)) groups.set(game, []);
    groups.get(game)!.push(prop);
  }

  return groups;
}

export function formatResultsAwaitingStatsReason(prop: any): string {
  if (getTrackedPropStatus(prop) !== "Awaiting stats") return "";
  return prop.pendingReason || AWAITING_STATS_LABEL;
}

export function formatTrackedPropGameLabel(prop: any): string {
  const team = prop.team || prop.playerState?.team || "";
  const opponent = prop.opponent || prop.playerState?.opponent || "";
  const direct = prop.game || prop.gameLabel;

  if (direct) return String(direct);
  if (team && opponent) {
    return `${formatTeam(team)} vs ${formatTeam(opponent)}`;
  }

  return "—";
}

export function computeAggregateResultsSummary(slates: ActiveResultsSlate[]) {
  return slates.reduce(
    (acc, slate) => ({
      total: acc.total + (slate.summary?.total ?? 0),
      graded: acc.graded + (slate.summary?.graded ?? 0),
      pending: acc.pending + (slate.summary?.pending ?? 0),
      failed: acc.failed + (slate.summary?.failed ?? 0),
      wins: acc.wins + (slate.summary?.wins ?? 0),
      losses: acc.losses + (slate.summary?.losses ?? 0),
      pushes: acc.pushes + (slate.summary?.pushes ?? 0),
    }),
    {
      total: 0,
      graded: 0,
      pending: 0,
      failed: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
    }
  );
}

export type AccuracySummary = {
  total: number;
  graded: number;
  pending: number;
  awaitingStats: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  winRateLabel: string;
};

export function isTestTrackingProp(prop: any = {}): boolean {
  return inferTrackingType(prop) === "TEST";
}

export function isReaderOfficialDemotedProp(prop: any = {}): boolean {
  return prop.readerOfficialDemoted === true;
}

export function isReaderUncertainTestProp(prop: any = {}): boolean {
  return isTestTrackingProp(prop) && !isReaderOfficialDemotedProp(prop);
}

export function isOfficialTrackingProp(prop: any = {}): boolean {
  return inferTrackingType(prop) === "OFFICIAL";
}

export function splitResultsPropsByTrackingType(props: any[] = []) {
  const official: any[] = [];
  const readerOfficialDemoted: any[] = [];
  const readerUncertainTest: any[] = [];

  for (const prop of props) {
    if (isOfficialTrackingProp(prop)) {
      official.push(prop);
    } else if (isReaderOfficialDemotedProp(prop)) {
      readerOfficialDemoted.push(prop);
    } else if (isTestTrackingProp(prop)) {
      readerUncertainTest.push(prop);
    }
  }

  return {
    official,
    test: [...readerOfficialDemoted, ...readerUncertainTest],
    readerOfficialDemoted,
    readerUncertainTest,
  };
}

export function summarizeTrackingTypeCounts(props: any[] = []) {
  const { official, readerOfficialDemoted, readerUncertainTest, test } =
    splitResultsPropsByTrackingType(props);
  return {
    total: props.length,
    official: official.length,
    test: test.length,
    readerOfficialDemoted: readerOfficialDemoted.length,
    readerUncertainTest: readerUncertainTest.length,
  };
}

export function computeTrackingTypeRecord(
  props: any[] = [],
  getStatus: (prop: any) => TrackedPropStatus = getTrackedPropStatus
) {
  const wins = props.filter((prop) => getStatus(prop) === "Win").length;
  const losses = props.filter((prop) => getStatus(prop) === "Loss").length;
  const pushes = props.filter((prop) => getStatus(prop) === "Push").length;
  const pending = props.filter((prop) => getStatus(prop) === "Pending").length;
  const awaitingStats = props.filter((prop) => getStatus(prop) === "Awaiting stats").length;
  const decided = wins + losses;
  const winRate = decided > 0 ? Math.round((wins / decided) * 100) : null;

  return {
    total: props.length,
    wins,
    losses,
    pushes,
    pending,
    awaitingStats,
    graded: wins + losses + pushes,
    winRate,
  };
}

export function computeContradictionPerformance(props: any[] = []) {
  const buckets = new Map<string, { wins: number; losses: number; pushes: number; total: number }>();

  for (const prop of props) {
    if (!isTestTrackingProp(prop)) continue;
    const contradictions = Array.isArray(prop.contradictions) ? prop.contradictions : [];
    const status = getTrackedPropStatus(prop);
    if (!["Win", "Loss", "Push"].includes(status)) continue;

    for (const item of contradictions) {
      const key = item.type || item.message || "unknown";
      if (!buckets.has(key)) {
        buckets.set(key, { wins: 0, losses: 0, pushes: 0, total: 0 });
      }
      const bucket = buckets.get(key)!;
      bucket.total += 1;
      if (status === "Win") bucket.wins += 1;
      else if (status === "Loss") bucket.losses += 1;
      else bucket.pushes += 1;
    }
  }

  return Object.fromEntries(buckets.entries());
}

function buildSlateSummaryForProps(props: any[]) {
  const wins = props.filter((prop) => getTrackedPropStatus(prop) === "Win").length;
  const losses = props.filter((prop) => getTrackedPropStatus(prop) === "Loss").length;
  const pushes = props.filter((prop) => getTrackedPropStatus(prop) === "Push").length;
  const pending = props.filter((prop) => getTrackedPropStatus(prop) === "Pending").length;
  const failed = props.filter((prop) => getTrackedPropStatus(prop) === "Awaiting stats").length;
  const graded = wins + losses + pushes;

  return {
    total: props.length,
    graded,
    pending,
    failed,
    wins,
    losses,
    pushes,
  };
}

/** Aggregate accuracy stats from visible Results queue slates. */
export function computeAccuracySummary(
  visibleSlates: ActiveResultsSlate[] = [],
  options?: { recordType?: "official" | "test" | "all" }
): AccuracySummary {
  const recordType = options?.recordType || "all";
  const allProps = visibleSlates.flatMap((slate) => slate.props || []);
  const props =
    recordType === "official"
      ? allProps.filter(isOfficialTrackingProp)
      : recordType === "test"
        ? allProps.filter(isTestTrackingProp)
        : allProps;

  const agg = buildSlateSummaryForProps(props);
  const decided = agg.wins + agg.losses;
  const winRate =
    decided > 0 ? Math.round((agg.wins / decided) * 100) : null;

  return {
    total: agg.total,
    graded: agg.graded,
    pending: agg.pending,
    awaitingStats: agg.failed,
    wins: agg.wins,
    losses: agg.losses,
    pushes: agg.pushes,
    winRate,
    winRateLabel: winRate !== null ? `${winRate}%` : "—",
  };
}

export type PendingCheckSummary = {
  checked: number;
  graded: number;
  stillPending: number;
  awaitingStats: number;
};

/** User-facing summary from the last resolve check — scoped to the active Results slate. */
export function computePendingCheckSummary(
  lastResolveSummary: any | null,
  visibleSlates: ActiveResultsSlate[] = []
): PendingCheckSummary | null {
  if (!lastResolveSummary) return null;

  const accuracy = computeAccuracySummary(visibleSlates);
  const activeGraded =
    lastResolveSummary.activeSlateGradedCount ?? lastResolveSummary.gradedCount ?? 0;

  return {
    checked: accuracy.total,
    graded: activeGraded,
    stillPending: accuracy.pending,
    awaitingStats: accuracy.awaitingStats,
  };
}

/** Count props newly graded on one slate between before/after resolve snapshots. */
export function countNewlyGradedPropsOnSlate(
  afterProps: any[] = [],
  beforeProps: any[] = [],
  slateDate: string | null | undefined
): number {
  if (!slateDate) return 0;

  const beforeStatusByKey = new Map<string, TrackedPropStatus>();
  for (const prop of beforeProps) {
    if (getResultsPropSlateDate(prop) !== slateDate) continue;
    const key = String(prop.id || prop.trackedId || prop.trackedKey || prop.player || "");
    beforeStatusByKey.set(key, getTrackedPropStatus(prop));
  }

  let count = 0;
  for (const prop of afterProps) {
    if (getResultsPropSlateDate(prop) !== slateDate) continue;
    const key = String(prop.id || prop.trackedId || prop.trackedKey || prop.player || "");
    const beforeStatus = beforeStatusByKey.get(key) || "Pending";
    const afterStatus = getTrackedPropStatus(prop);
    const wasOpen = beforeStatus === "Pending" || beforeStatus === "Awaiting stats";
    const isGraded = afterStatus === "Win" || afterStatus === "Loss" || afterStatus === "Push";
    if (wasOpen && isGraded) count += 1;
  }

  return count;
}

/** Plain-English takeaways from accuracy counts for the Results dashboard. */
export function buildKeyTakeaways(
  summary: AccuracySummary,
  options?: {
    slateDate?: string | null;
    rotation?: { currentLabSlateDate?: string | null; allReports?: any[] } | null;
    reports?: any[];
  }
): string[] {
  if (summary.total === 0) {
    return ["No tracked props for today yet. Refresh the board to generate today's props."];
  }

  const bullets: string[] = [];

  if (summary.graded > 0) {
    bullets.push(
      `${summary.graded} of ${summary.total} props graded — record ${summary.wins}-${summary.losses}-${summary.pushes} (${summary.winRateLabel} win rate, pushes excluded).`
    );
  } else {
    bullets.push(`${summary.total} props tracked; none graded yet.`);
  }

  if (summary.pending > 0) {
    bullets.push(
      `${summary.pending} prop${summary.pending === 1 ? "" : "s"} still waiting on final scores.`
    );
  }

  if (summary.awaitingStats > 0) {
    bullets.push(
      `${summary.awaitingStats} prop${summary.awaitingStats === 1 ? "" : "s"} awaiting stats from source.`
    );
  }

  if (
    summary.graded > 0 &&
    summary.pending === 0 &&
    summary.awaitingStats === 0 &&
    summary.graded === summary.total
  ) {
    const slateDate = options?.slateDate || null;
    const promoted =
      slateDate &&
      isSlatePromotedToLab(slateDate, options?.rotation || null, options?.reports);

    bullets.push(
      promoted
        ? `${formatSlateMessageDate(slateDate)} slate complete — moved to Lab.`
        : `${formatSlateMessageDate(slateDate)} slate: all props graded. Lab report build pending.`
    );
  }

  return bullets;
}

function buildSlateSummary(props: any[]) {
  const wins = props.filter((prop) => getTrackedPropStatus(prop) === "Win").length;
  const losses = props.filter((prop) => getTrackedPropStatus(prop) === "Loss").length;
  const pushes = props.filter((prop) => getTrackedPropStatus(prop) === "Push").length;
  const pending = props.filter((prop) => getTrackedPropStatus(prop) === "Pending").length;
  const failed = props.filter((prop) => getTrackedPropStatus(prop) === "Awaiting stats").length;
  const graded = wins + losses + pushes;

  return {
    total: props.length,
    graded,
    pending,
    failed,
    wins,
    losses,
    pushes,
  };
}


/** Active Results slate: locked ACTIVE unresolved first, then today when cohort still open. */
export function computeActiveResultsSlate(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate(),
  lockedSlates: any[] = []
): ActiveResultsSlate | null {
  const visible = computeVisibleResultsSlates(
    trackedProps,
    reports,
    today,
    lockedSlates
  );
  return visible[0] || null;
}

function buildActiveResultsSlate(
  slateDate: string,
  props: any[],
  reports: any[],
  rotation: SlateRotation
): ActiveResultsSlate {
  const report =
    reports.find((item) => String(item.slateDate) === slateDate) || null;
  const summary = buildSlateSummary(props);
  const leagues = [
    ...new Set(props.map((prop) => prop.league).filter(Boolean)),
  ] as string[];

  return {
    slateDate,
    props,
    report,
    rotation,
    isComplete:
      summary.pending === 0 &&
      summary.failed === 0 &&
      summary.graded > 0 &&
      !slateHasUnresolvedProps(props),
    summary,
    leagues,
  };
}

/** Active locked Results slate — holds unresolved slate across CT midnight. */
export function computeVisibleResultsSlates(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate(),
  lockedSlates: any[] = []
): ActiveResultsSlate[] {
  const rotation = computeSlateRotation(reports, {
    lockedSlates,
    trackedProps,
    today,
  });
  const activeSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );
  if (!activeSlateDate) return [];

  const slateProps = trackedProps.filter(
    (prop) => getResultsPropSlateDate(prop) === activeSlateDate
  );

  if (!slateProps.length) return [];

  return [
    buildActiveResultsSlate(activeSlateDate, slateProps, reports, rotation),
  ];
}

export function countStagedHomeProps(
  trackedProps: any[] = [],
  today: string = getTodayLocalDate()
): { slateDate: string | null; count: number } {
  const staged = trackedProps.filter((prop) => prop.homeStaged === true);
  if (!staged.length) return { slateDate: null, count: 0 };

  const dates = [
    ...new Set(
      staged
        .map((prop) => String(prop.slateDate || ""))
        .filter((date) => date && isOnOrAfterCleanDataCutoff(date))
    ),
  ].sort();

  const latest = dates[dates.length - 1] || null;
  const count = latest
    ? staged.filter((prop) => String(prop.slateDate || "") === latest).length
    : staged.length;

  return { slateDate: latest, count };
}

export function summarizeActiveResultsSlate(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate(),
  lockedSlates: any[] = []
) {
  const activeSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );
  const props = activeSlateDate
    ? trackedProps.filter(
        (prop) => getResultsPropSlateDate(prop) === activeSlateDate
      )
    : [];

  const pending = props.filter(
    (prop) => getTrackedPropStatus(prop) === "Pending"
  ).length;
  const awaitingStats = props.filter(
    (prop) => getTrackedPropStatus(prop) === "Awaiting stats"
  ).length;
  const graded = props.filter((prop) =>
    ["Win", "Loss", "Push"].includes(getTrackedPropStatus(prop))
  ).length;

  const lockEntry = lockedSlates.find(
    (entry) => String(entry.slateDate) === activeSlateDate
  );
  const trackingCounts = summarizeTrackingTypeCounts(props);

  return {
    activeSlateDate,
    propCount: props.length,
    officialCount: trackingCounts.official,
    testCount: trackingCounts.test,
    readerOfficialDemotedCount: trackingCounts.readerOfficialDemoted,
    readerUncertainTestCount: trackingCounts.readerUncertainTest,
    pending,
    awaitingStats,
    graded,
    locked: Boolean(lockEntry),
    phase: lockEntry?.phase || null,
    canPromoteToLab:
      props.length > 0 &&
      !hasUnresolvedGradingProps(props) &&
      !slateHasUnresolvedProps(props),
  };
}

export function filterResultsPropsByLeague(
  props: any[],
  league: ResultsLeagueTab | ResultsFilter
) {
  if (league === "NBA") {
    return props.filter((prop) => String(prop.league || "").toUpperCase() === "NBA");
  }
  if (league === "WNBA") {
    return props.filter((prop) => String(prop.league || "").toUpperCase() === "WNBA");
  }
  return props;
}

export function filterResultsPropsByStatus(
  props: any[],
  status: ResultsStatusFilter | ResultsFilter
) {
  if (status === "Pending") {
    return props.filter((prop) => getTrackedPropStatus(prop) === "Pending");
  }
  if (status === "Graded") {
    return props.filter((prop) =>
      ["Win", "Loss", "Push"].includes(getTrackedPropStatus(prop))
    );
  }
  if (status === "Awaiting stats") {
    return props.filter((prop) => getTrackedPropStatus(prop) === "Awaiting stats");
  }
  return props;
}

export function filterResultsProps(
  props: any[],
  filter: ResultsFilter,
  statusFilter: ResultsStatusFilter = "All"
) {
  // Legacy single-chip mode: NBA/WNBA/status are mutually exclusive.
  if (filter === "NBA" || filter === "WNBA") {
    return filterResultsPropsByStatus(
      filterResultsPropsByLeague(props, filter),
      statusFilter
    );
  }
  if (
    filter === "Pending" ||
    filter === "Graded" ||
    filter === "Awaiting stats"
  ) {
    return filterResultsPropsByStatus(props, filter);
  }
  return filterResultsPropsByStatus(
    filterResultsPropsByLeague(props, "All"),
    statusFilter
  );
}

export function filterResultsPropsCompound(
  props: any[],
  league: ResultsLeagueTab,
  status: ResultsStatusFilter
) {
  return filterResultsPropsByStatus(
    filterResultsPropsByLeague(props, league),
    status
  );
}

export function formatResultsSlateLabel(slateDate: string) {
  if (!slateDate || slateDate === "unknown") return "Unknown Slate";
  const d = new Date(`${slateDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return slateDate;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
}

export type ResolveCheckMessageInput = {
  beforeVisible: ActiveResultsSlate[];
  afterVisible: ActiveResultsSlate[];
  afterRotation: SlateRotation;
  gradedCount: number;
  awaitingStatsCount?: number;
  activeResultsSlateDate?: string | null;
  gradedCountForActiveSlate?: number;
};

export function isSlatePromotedToLab(
  slateDate: string | null | undefined,
  rotation: { currentLabSlateDate?: string | null; allReports?: any[] } | null,
  reports?: any[]
): boolean {
  if (!slateDate) return false;
  if (rotation?.currentLabSlateDate !== slateDate) return false;

  const reportList = reports || rotation?.allReports || [];
  const report =
    reportList.find((item) => String(item.slateDate) === slateDate) || null;

  return Boolean(report && isCompletedSlate(report) && getReportPending(report) === 0);
}

export type ResolveCheckStatusType = "success" | "info" | "warning" | "error";

export type ResolveCheckStatus = {
  message: string;
  type: ResolveCheckStatusType;
};

/** User-facing message after Check Pending Results — scoped to activeResultsSlateDate only. */
export function pickResolveCheckMessage(input: ResolveCheckMessageInput): ResolveCheckStatus {
  const {
    beforeVisible,
    afterVisible,
    afterRotation,
    gradedCount,
    awaitingStatsCount,
    activeResultsSlateDate,
    gradedCountForActiveSlate,
  } = input;

  const activeDate =
    activeResultsSlateDate ||
    afterRotation.activeResultsSlateDate ||
    beforeVisible[0]?.slateDate ||
    afterVisible[0]?.slateDate ||
    null;
  const dateLabel = formatSlateMessageDate(activeDate);

  const activeAfter = activeDate
    ? afterVisible.find((slate) => slate.slateDate === activeDate) || null
    : afterVisible[0] || null;
  const activeBefore = activeDate
    ? beforeVisible.find((slate) => slate.slateDate === activeDate) || null
    : beforeVisible[0] || null;

  const scopedSlates =
    activeAfter ? [activeAfter] : activeDate ? [] : afterVisible;
  const afterAccuracy = computeAccuracySummary(scopedSlates);
  const awaitingStats = awaitingStatsCount ?? afterAccuracy.awaitingStats;
  const pending = afterAccuracy.pending;
  const gradedOnCheck =
    gradedCountForActiveSlate ??
    (activeDate ? Math.min(gradedCount, afterAccuracy.graded) : gradedCount);

  const labDate = afterRotation.currentLabSlateDate;

  if (
    activeDate &&
    labDate === activeDate &&
    activeBefore &&
    !activeAfter &&
    isSlatePromotedToLab(labDate, afterRotation)
  ) {
    return {
      message: formatSlateMovedToLabMessage(labDate),
      type: "warning",
    };
  }

  if (
    activeDate &&
    labDate === activeDate &&
    activeBefore &&
    !activeAfter &&
    !isSlatePromotedToLab(labDate, afterRotation)
  ) {
    return {
      message: `${dateLabel} slate: all props graded. Lab report build pending.`,
      type: "info",
    };
  }

  if (!activeDate) {
    return {
      message: "No active Results slate to check.",
      type: "info",
    };
  }

  if (gradedOnCheck > 0) {
    const pendingSuffix =
      pending > 0 ? `, ${pending} still pending` : "";
    const awaitingSuffix =
      awaitingStats > 0 ? `, ${awaitingStats} awaiting stats` : "";
    return {
      message: `${dateLabel} slate checked: ${gradedOnCheck} graded${pendingSuffix}${awaitingSuffix}.`,
      type: "success",
    };
  }

  if (pending > 0 || awaitingStats > 0) {
    const openCount = pending + awaitingStats;
    return {
      message: `${dateLabel} slate checked: 0 graded, ${openCount} still pending.`,
      type: "info",
    };
  }

  if (afterAccuracy.total > 0 && pending === 0 && awaitingStats === 0) {
    return {
      message: `${dateLabel} slate checked: all ${afterAccuracy.graded} props already graded.`,
      type: "info",
    };
  }

  return {
    message: `${dateLabel} slate: no new final scores yet.`,
    type: "info",
  };
}
