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

function groupTrackedPropsBySlate(trackedProps: any[]) {
  const groups = new Map<string, any[]>();

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "unknown");
    if (!groups.has(slateDate)) groups.set(slateDate, []);
    groups.get(slateDate)!.push(prop);
  }

  return groups;
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

function findReportForSlate(reports: any[], slateDate: string) {
  return (
    reports.find((report) => String(report.slateDate) === slateDate) || null
  );
}

/** Newest official tracked slate that is not yet the completed Lab slate. */
export function computeActiveResultsSlate(
  trackedProps: any[] = [],
  reports: any[] = []
): ActiveResultsSlate | null {
  const rotation = computeSlateRotation(reports);
  const groups = groupTrackedPropsBySlate(trackedProps);
  const slateDates = [...groups.keys()]
    .filter((date) => date !== "unknown")
    .sort((a, b) => b.localeCompare(a));

  for (const slateDate of slateDates) {
    const props = groups.get(slateDate) || [];
    if (!props.length) continue;

    const report = findReportForSlate(reports, slateDate);
    const complete = isCompletedSlate(report);

    if (complete && slateDate === rotation.currentLabSlateDate) {
      continue;
    }

    if (!complete) {
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
  }

  const newestWithProps = slateDates.find((date) => (groups.get(date) || []).length > 0);
  if (!newestWithProps) return null;

  const props = groups.get(newestWithProps) || [];
  const report = findReportForSlate(reports, newestWithProps);
  const summary = buildSlateSummary(props);

  if (
    newestWithProps === rotation.currentLabSlateDate &&
    isCompletedSlate(report)
  ) {
    return null;
  }

  const leagues = [
    ...new Set(props.map((prop) => prop.league).filter(Boolean)),
  ] as string[];

  return {
    slateDate: newestWithProps,
    props,
    report,
    rotation,
    isComplete: summary.pending === 0 && summary.failed === 0 && summary.graded > 0,
    summary,
    leagues,
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
