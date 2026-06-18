export const HISTORY_FILTERS = [
  "All",
  "NBA",
  "WNBA",
  "Saved Picks",
  "Official Props/Lab",
  "Wins",
  "Losses",
] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export type HistoryEntryType = "saved-picks" | "official-slate";

export type HistoryEntry = {
  id: string;
  type: HistoryEntryType;
  slateDate: string;
  leagues: string[];
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  graded: number;
  total: number;
  winRate: number | null;
  netUnits: number;
  status: string;
  hasGradedPerformance: boolean;
  emptyLabel: string | null;
  topLesson: string | null;
  picks: any[];
  reportSummary: any | null;
};

export function getPickStatus(pick: any) {
  const raw = String(pick.status || "pending").toLowerCase();
  if (raw === "win") return "Win";
  if (raw === "loss") return "Loss";
  if (raw === "push") return "Push";
  return "Pending";
}

export function getPickSlateDate(pick: any) {
  const direct =
    pick.slateDate ||
    pick.gameDate ||
    pick.date ||
    pick.commenceDate ||
    pick.eventDate;

  if (direct) {
    const value = String(direct).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }

  const resolved = pick.resolvedAt || pick.gradedAt || pick.completedDate || pick.updatedAt;
  if (resolved) {
    const d = new Date(resolved);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    }
  }

  return "unknown";
}

function buildRecordFromPicks(picks: any[]) {
  const wins = picks.filter((pick) => getPickStatus(pick) === "Win").length;
  const losses = picks.filter((pick) => getPickStatus(pick) === "Loss").length;
  const pushes = picks.filter((pick) => getPickStatus(pick) === "Push").length;
  const pending = picks.filter((pick) => getPickStatus(pick) === "Pending").length;
  const graded = wins + losses + pushes;
  const decided = wins + losses;
  const winRate = decided > 0 ? Math.round((wins / decided) * 100) : null;

  return {
    wins,
    losses,
    pushes,
    pending,
    graded,
    total: picks.length,
    winRate,
    netUnits: wins - losses,
  };
}

function isCompletedSavedPickGroup(picks: any[]) {
  const graded = picks.filter((pick) =>
    ["Win", "Loss", "Push"].includes(getPickStatus(pick))
  );
  return graded.length > 0;
}

function buildSavedPickEntries(picks: any[]): HistoryEntry[] {
  const groups = new Map<string, any[]>();

  for (const pick of picks) {
    const slateDate = getPickSlateDate(pick);
    const key = slateDate;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pick);
  }

  const entries: HistoryEntry[] = [];

  for (const [slateDate, groupPicks] of groups.entries()) {
    if (!isCompletedSavedPickGroup(groupPicks)) continue;

    const record = buildRecordFromPicks(groupPicks);
    const leagues = [...new Set(groupPicks.map((pick) => pick.league).filter(Boolean))];

    entries.push({
      id: `saved-${slateDate}`,
      type: "saved-picks",
      slateDate,
      leagues: leagues as string[],
      ...record,
      status: record.pending > 0 ? "PARTIAL" : "GRADED",
      hasGradedPerformance: record.graded > 0,
      emptyLabel: null,
      topLesson: null,
      picks: groupPicks.sort((a, b) => {
        const aTime = new Date(
          a.resolvedAt || a.gradedAt || a.updatedAt || 0
        ).getTime();
        const bTime = new Date(
          b.resolvedAt || b.gradedAt || b.updatedAt || 0
        ).getTime();
        return bTime - aTime;
      }),
      reportSummary: null,
    });
  }

  return entries;
}

function getOfficialGradedCount(report: any) {
  const sectionA = report?.sections?.A;
  return Number(sectionA?.graded ?? report?.graded ?? 0);
}

function getOfficialTotalCount(report: any, slateProps: any[]) {
  const sectionA = report?.sections?.A;
  return Number(sectionA?.totalOfficialProps ?? report?.totalOfficialProps ?? slateProps.length);
}

function getOfficialEmptyLabel(report: any, graded: number, total: number) {
  if (graded > 0) return null;
  if (total > 0) return "Report built — no graded official props yet";
  return "No completed official props yet";
}

function buildOfficialSlateEntries(reports: any[], trackedProps: any[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const report of reports) {
    const sectionA = report.sections?.A || report;
    const slateDate = String(report.slateDate || sectionA.slateDate || "unknown");
    const slateProps = trackedProps.filter((prop) => prop.slateDate === slateDate);
    const graded = getOfficialGradedCount(report);
    const total = getOfficialTotalCount(report, slateProps);
    const hasGradedPerformance = graded > 0;
    const emptyLabel = getOfficialEmptyLabel(report, graded, total);
    const slateLesson = hasGradedPerformance
      ? report.slateLesson || report.sections?.J
      : null;

    entries.push({
      id: `official-${slateDate}`,
      type: "official-slate",
      slateDate,
      leagues: (sectionA.leagues || []).length
        ? sectionA.leagues
        : [...new Set(slateProps.map((prop) => prop.league).filter(Boolean))],
      wins: hasGradedPerformance ? Number(sectionA.wins ?? 0) : 0,
      losses: hasGradedPerformance ? Number(sectionA.losses ?? 0) : 0,
      pushes: hasGradedPerformance ? Number(sectionA.pushes ?? 0) : 0,
      pending: Number(sectionA.pending ?? 0),
      graded,
      total,
      winRate:
        hasGradedPerformance &&
        sectionA.overallWinRate !== null &&
        sectionA.overallWinRate !== undefined
          ? Math.round(Number(sectionA.overallWinRate))
          : null,
      netUnits: hasGradedPerformance
        ? Number(sectionA.wins ?? 0) - Number(sectionA.losses ?? 0)
        : 0,
      status: hasGradedPerformance
        ? String(report.status || sectionA.reportStatus || "unknown").toUpperCase()
        : "REPORT BUILT",
      hasGradedPerformance,
      emptyLabel,
      topLesson: slateLesson?.headline || slateLesson?.body || null,
      picks: hasGradedPerformance ? slateProps : [],
      reportSummary: hasGradedPerformance ? report : null,
    });
  }

  return entries;
}

export function buildHistoryEntries(picks: any[], reports: any[], trackedProps: any[]) {
  const entries = [
    ...buildSavedPickEntries(picks),
    ...buildOfficialSlateEntries(reports, trackedProps),
  ];

  return entries.sort((a, b) => {
    if (a.slateDate === "unknown") return 1;
    if (b.slateDate === "unknown") return -1;
    return String(b.slateDate).localeCompare(String(a.slateDate));
  });
}

export function filterHistoryEntries(entries: HistoryEntry[], filter: HistoryFilter) {
  if (filter === "All") return entries;

  if (filter === "NBA") {
    return entries.filter((entry) => entry.leagues.includes("NBA"));
  }

  if (filter === "WNBA") {
    return entries.filter((entry) => entry.leagues.includes("WNBA"));
  }

  if (filter === "Saved Picks") {
    return entries.filter((entry) => entry.type === "saved-picks");
  }

  if (filter === "Official Props/Lab") {
    return entries.filter((entry) => entry.type === "official-slate");
  }

  if (filter === "Wins") {
    return entries.filter((entry) => entry.hasGradedPerformance && entry.netUnits > 0);
  }

  if (filter === "Losses") {
    return entries.filter((entry) => entry.hasGradedPerformance && entry.netUnits < 0);
  }

  return entries;
}

export function formatSlateDateLabel(slateDate: string) {
  if (!slateDate || slateDate === "unknown") return "Unknown Date";
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

export function formatRecordLine(entry: HistoryEntry) {
  if (!entry.hasGradedPerformance && entry.emptyLabel) {
    return entry.emptyLabel;
  }

  const rate = entry.winRate !== null ? ` (${entry.winRate}%)` : "";
  const units = `${entry.netUnits > 0 ? "+" : ""}${entry.netUnits}u`;
  return `${entry.wins}-${entry.losses}-${entry.pushes}${rate} • ${units}`;
}
