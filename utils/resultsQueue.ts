import { formatTeam } from "../components/PropCard";
import { getPickSlateDate } from "./historyArchive";
import {
  computeSlateRotation,
  isCompletedSlate,
  type SlateRotation,
} from "./slateRotation";

export const RESULTS_FILTERS = [
  "All",
  "Pending",
  "Graded",
  "Failed",
  "NBA",
  "WNBA",
] as const;

export type ResultsFilter = (typeof RESULTS_FILTERS)[number];

export type TrackedPropStatus = "Win" | "Loss" | "Push" | "Pending" | "Failed";

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

export function getTrackedPropStatus(prop: any): TrackedPropStatus {
  const raw = String(prop.status || "pending").toLowerCase();

  if (raw === "win") return "Win";
  if (raw === "loss") return "Loss";
  if (raw === "push") return "Push";

  if (raw === "pending" && prop.pendingReason) {
    return "Failed";
  }

  return "Pending";
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

function groupTrackedPropsBySlate(trackedProps: any[]) {
  const groups = new Map<string, any[]>();

  for (const prop of trackedProps) {
    const slateDate = getResultsPropSlateDate(prop);
    if (!groups.has(slateDate)) groups.set(slateDate, []);
    groups.get(slateDate)!.push(prop);
  }

  return groups;
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

function buildSlateSummary(props: any[]) {
  const wins = props.filter((prop) => getTrackedPropStatus(prop) === "Win").length;
  const losses = props.filter((prop) => getTrackedPropStatus(prop) === "Loss").length;
  const pushes = props.filter((prop) => getTrackedPropStatus(prop) === "Push").length;
  const pending = props.filter((prop) => getTrackedPropStatus(prop) === "Pending").length;
  const failed = props.filter((prop) => getTrackedPropStatus(prop) === "Failed").length;
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


/** Newest official tracked slate that is not yet the completed Lab slate. */
export function computeActiveResultsSlate(
  trackedProps: any[] = [],
  reports: any[] = []
): ActiveResultsSlate | null {
  const visible = computeVisibleResultsSlates(trackedProps, reports);
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
    isComplete: summary.pending === 0 && summary.failed === 0 && summary.graded > 0,
    summary,
    leagues,
  };
}

/** In-progress slates visible in Results (today + tomorrow, excluding current Lab slate). */
export function computeVisibleResultsSlates(
  trackedProps: any[] = [],
  reports: any[] = []
): ActiveResultsSlate[] {
  const rotation = computeSlateRotation(reports);
  const groups = groupTrackedPropsBySlate(trackedProps);
  const slateDates = [...groups.keys()]
    .filter((date) => date !== "unknown")
    .sort((a, b) => a.localeCompare(b));

  const visible: ActiveResultsSlate[] = [];

  for (const slateDate of slateDates) {
    const props = groups.get(slateDate) || [];
    if (!props.length) continue;

    const report =
      reports.find((item) => String(item.slateDate) === slateDate) || null;
    const complete = isCompletedSlate(report);

    if (complete && slateDate === rotation.currentLabSlateDate) {
      continue;
    }

    if (complete) {
      continue;
    }

    visible.push(buildActiveResultsSlate(slateDate, props, reports, rotation));
  }

  return visible;
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
  if (filter === "Failed") {
    return props.filter((prop) => getTrackedPropStatus(prop) === "Failed");
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
