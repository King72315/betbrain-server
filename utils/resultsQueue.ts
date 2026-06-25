import { formatTeam } from "../components/PropCard";
import { getPickSlateDate } from "./historyArchive";
import {
  computeSlateRotation,
  getBlockingActiveResultsSlateDate,
  getReportPending,
  getTodayLocalDate,
  hasUnresolvedGradingProps,
  isCompletedSlate,
  isFutureSlateDate,
  isOnOrAfterCleanDataCutoff,
  isPriorSlateStillActive,
  PRIOR_SLATE_STILL_ACTIVE_LABEL,
  slateHasUnresolvedProps,
  type SlateRotation,
} from "./slateRotation";

export { PRIOR_SLATE_STILL_ACTIVE_LABEL, isPriorSlateStillActive };

export const RESULTS_FILTERS = [
  "All",
  "Pending",
  "Graded",
  "Awaiting stats",
  "NBA",
  "WNBA",
] as const;

export type ResultsFilter = (typeof RESULTS_FILTERS)[number];

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

/** Derive slate date for Results grouping (matches backend CT slate when possible). */
export function getResultsPropSlateDate(prop: any): string {
  const direct = getPickSlateDate(prop);
  if (direct !== "unknown") return direct;

  const commence = prop.commenceTime || prop.time;
  if (commence) {
    const parsed = new Date(commence);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    }
  }

  return "unknown";
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
  const trackingType = String(prop.trackingType || prop.recordType || "").toUpperCase();
  return trackingType === "TEST";
}

export function isReaderOfficialDemotedProp(prop: any = {}): boolean {
  return prop.readerOfficialDemoted === true;
}

export function isReaderUncertainTestProp(prop: any = {}): boolean {
  return isTestTrackingProp(prop) && !isReaderOfficialDemotedProp(prop);
}

export function isOfficialTrackingProp(prop: any = {}): boolean {
  const trackingType = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (trackingType === "TEST" || trackingType === "NO_BET") return false;
  if (trackingType === "OFFICIAL") return true;
  if (prop.excludedFromOfficialRecord === true) return false;
  if (prop.preV1Shadow === true || prop.excludedFromV1OfficialRecord === true) return false;
  return true;
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

/** User-facing summary from the last resolve check — avoids raw backend counts in UI. */
export function computePendingCheckSummary(
  lastResolveSummary: any | null,
  visibleSlates: ActiveResultsSlate[] = []
): PendingCheckSummary | null {
  if (!lastResolveSummary) return null;

  const accuracy = computeAccuracySummary(visibleSlates);

  return {
    checked: lastResolveSummary.gradeable ?? 0,
    graded: lastResolveSummary.gradedCount ?? 0,
    stillPending: lastResolveSummary.stillPending ?? 0,
    awaitingStats: accuracy.awaitingStats,
  };
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
        ? "All props graded — slate complete. Moved to Lab."
        : "All props graded. Lab report build pending."
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


/** Active Results slate: locked ACTIVE unresolved first, then today when unblocked. */
export function pickActiveResultsSlateDate(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate(),
  lockedSlates: any[] = []
): string | null {
  const blockingSlate = getBlockingActiveResultsSlateDate(
    trackedProps,
    lockedSlates,
    reports,
    today
  );
  if (blockingSlate) return blockingSlate;

  const hasTodayProps = trackedProps.some((prop) => {
    const slateDate = getResultsPropSlateDate(prop);
    return (
      slateDate === today &&
      isOnOrAfterCleanDataCutoff(slateDate) &&
      prop.homeStaged !== true
    );
  });

  return hasTodayProps ? today : null;
}

/** Active Results slate for the current locked/unresolved queue. */
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
  const rotation = computeSlateRotation(reports, lockedSlates);
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

export function filterResultsProps(props: any[], filter: ResultsFilter) {
  if (filter === "All") return props;
  if (filter === "NBA") return props.filter((prop) => prop.league === "NBA");
  if (filter === "WNBA") return props.filter((prop) => prop.league === "WNBA");
  if (filter === "Pending") {
    return props.filter((prop) => getTrackedPropStatus(prop) === "Pending");
  }
  if (filter === "Graded") {
    return props.filter((prop) =>
      ["Win", "Loss", "Push"].includes(getTrackedPropStatus(prop))
    );
  }
  if (filter === "Awaiting stats") {
    return props.filter((prop) => getTrackedPropStatus(prop) === "Awaiting stats");
  }

  return props;
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

/** User-facing message after Check Pending Results — UI only, no grading side effects. */
export function pickResolveCheckMessage(input: ResolveCheckMessageInput): ResolveCheckStatus {
  const { beforeVisible, afterVisible, afterRotation, gradedCount, awaitingStatsCount } =
    input;

  const beforeDates = new Set(beforeVisible.map((slate) => slate.slateDate));
  const afterDates = new Set(afterVisible.map((slate) => slate.slateDate));
  const labDate = afterRotation.currentLabSlateDate;
  const afterAccuracy = computeAccuracySummary(afterVisible);
  const awaitingStats = awaitingStatsCount ?? afterAccuracy.awaitingStats;

  if (labDate && beforeDates.has(labDate) && !afterDates.has(labDate)) {
    if (isSlatePromotedToLab(labDate, afterRotation)) {
      return {
        message: "This slate has already been moved to the Lab.",
        type: "warning",
      };
    }
    return {
      message: "All props graded. Lab report build pending.",
      type: "info",
    };
  }

  if (beforeVisible.length === 0 && labDate) {
    return {
      message: "This slate has already been moved to the Lab.",
      type: "info",
    };
  }

  if (gradedCount > 0) {
    const noun = gradedCount === 1 ? "prop" : "props";
    return {
      message: `${gradedCount} ${noun} graded.`,
      type: "success",
    };
  }

  if (awaitingStats > 0) {
    return {
      message: "Awaiting stats from source.",
      type: "info",
    };
  }

  if (
    afterAccuracy.total > 0 &&
    afterAccuracy.pending === 0 &&
    afterAccuracy.awaitingStats === 0
  ) {
    return {
      message: "All props already graded.",
      type: "info",
    };
  }

  return {
    message: "No new final scores yet.",
    type: "info",
  };
}
