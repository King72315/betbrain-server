export type SlateSnapshotEntry = {
  result: string;
  player: string;
  league: string;
  team: string;
  opponent: string;
  side: string;
  line: number | string | null;
  stat: string;
  actual: number | string | null;
  margin: number | null;
  topPickRank: number | null;
  bestSixRank: number | null;
  trackingType: string | null;
  readerOfficialDemoted: boolean;
  trackedKey: string | null;
  isTopPick: boolean;
  formattedLine: string;
};

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return raw;
}

export function formatSnapshotLine(entry: Partial<SlateSnapshotEntry> = {}) {
  const result = String(entry.result || "").toUpperCase();
  const player = entry.player || "Unknown";
  const side = normalizeSide(entry.side || "");
  const line = entry.line ?? "—";
  const stat = entry.stat || "Points";
  const actual = entry.actual ?? "—";
  const margin = entry.margin;
  const marginText =
    margin !== null && margin !== undefined
      ? `${Number(margin) >= 0 ? "+" : ""}${Number(margin).toFixed(1)}`
      : "—";

  return `[${result}] ${player} ${side} ${line} ${stat} — actual ${actual}, margin ${marginText}`;
}

function buildEntry(prop: any = {}): SlateSnapshotEntry {
  const status = String(prop.status || prop.result || "").toLowerCase();
  const margin = num(prop.resultMargin ?? prop.margin);

  return {
    result: status.toUpperCase(),
    player: prop.player || "",
    league: String(prop.league || "").toUpperCase(),
    team: prop.team || "",
    opponent: prop.opponent || "",
    side: normalizeSide(prop.side || prop.pick || prop.lockedSide),
    line: prop.line ?? prop.officialLine ?? prop.pickLine ?? null,
    stat: prop.stat || "Points",
    actual: prop.actualStat ?? prop.actual ?? null,
    margin,
    topPickRank: prop.topPickRank ?? prop.topPropRank ?? null,
    bestSixRank: prop.bestSixRank ?? prop.controlledBestSixRank ?? prop.leagueBestSixRank ?? null,
    trackingType: prop.trackingType || prop.recordType || null,
    readerOfficialDemoted: prop.readerOfficialDemoted === true,
    trackedKey: prop.trackedKey || prop.trackedId || null,
    isTopPick: Boolean(prop.topPickRank || prop.topPropRank || prop.topPickLabel),
    formattedLine: "",
  };
}

export function buildSlateResultsSnapshot(props: any[] = [], options: { slateDate?: string } = {}) {
  const slateDate = options.slateDate ? String(options.slateDate) : null;
  const scoped = props.filter((prop) => {
    if (!slateDate) return true;
    return String(prop.slateDate || "") === slateDate;
  });

  const graded = scoped.filter((prop) => isResolvedStatus(prop.status || prop.result));
  const wins = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "win")
    .map(buildEntry)
    .sort((a, b) => Number(b.margin ?? 0) - Number(a.margin ?? 0));
  const losses = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "loss")
    .map(buildEntry)
    .sort((a, b) => Number(a.margin ?? 0) - Number(b.margin ?? 0));
  const pushes = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "push")
    .map(buildEntry);

  const winningProps = wins.map((entry) => ({
    ...entry,
    formattedLine: formatSnapshotLine(entry),
  }));
  const losingProps = losses.map((entry) => ({
    ...entry,
    formattedLine: formatSnapshotLine(entry),
  }));

  return {
    title: "Slate Results Snapshot",
    slateDate: slateDate || scoped[0]?.slateDate || null,
    snapshotMissing: graded.length === 0,
    winsCount: wins.length,
    lossesCount: losses.length,
    pushesCount: pushes.length,
    gradedCount: graded.length,
    totalTracked: scoped.length,
    winningProps,
    losingProps,
    pushProps: pushes.map((entry) => ({
      ...entry,
      formattedLine: formatSnapshotLine(entry),
    })),
    biggestWins: winningProps.slice(0, 3),
    biggestMisses: losingProps.slice(0, 3),
    record: {
      wins: wins.length,
      losses: losses.length,
      pushes: pushes.length,
      winRate:
        wins.length + losses.length > 0
          ? Number(((wins.length / (wins.length + losses.length)) * 100).toFixed(1))
          : null,
    },
  };
}
