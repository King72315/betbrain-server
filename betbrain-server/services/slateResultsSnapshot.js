/**
 * Shared slate results snapshot builder — graded props only, reference-based.
 */

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return raw;
}

function formatSnapshotLine(entry = {}) {
  const result = String(entry.result || entry.status || "").toUpperCase();
  const player = entry.player || "Unknown";
  const side = normalizeSide(entry.side || entry.pick);
  const line = entry.line ?? "—";
  const stat = entry.stat || "Points";
  const actual = entry.actual ?? entry.actualStat ?? "—";
  const margin = entry.margin ?? entry.resultMargin;
  const marginText =
    margin !== null && margin !== undefined
      ? `${Number(margin) >= 0 ? "+" : ""}${Number(margin).toFixed(1)}`
      : "—";

  return `[${result}] ${player} ${side} ${line} ${stat} — actual ${actual}, margin ${marginText}`;
}

function buildSnapshotEntry(prop = {}) {
  const status = String(prop.status || prop.result || "").toLowerCase();
  const margin = num(prop.resultMargin ?? prop.margin);

  return {
    result: status.toUpperCase(),
    player: prop.player || "",
    league: String(prop.league || "").toUpperCase(),
    team: prop.team || "",
    opponent: prop.opponent || "",
    side: normalizeSide(prop.side || prop.pick || prop.lockedSide),
    line: prop.line ?? prop.officialLine ?? prop.pickLine,
    stat: prop.stat || "Points",
    actual: prop.actualStat ?? prop.actual ?? null,
    margin,
    topPickRank: prop.topPickRank ?? prop.topPropRank ?? null,
    bestSixRank: prop.bestSixRank ?? prop.controlledBestSixRank ?? prop.leagueBestSixRank ?? null,
    trackingType: prop.trackingType || prop.recordType || null,
    readerOfficialDemoted: prop.readerOfficialDemoted === true,
    trackedKey: prop.trackedKey || prop.trackedId || null,
    isTopPick: Boolean(prop.topPickRank || prop.topPropRank),
    formattedLine: "",
  };
}

function enrichWithFormatted(entries = []) {
  return entries.map((entry) => ({
    ...entry,
    formattedLine: formatSnapshotLine(entry),
  }));
}

export function buildSlateResultsSnapshot(props = [], options = {}) {
  const slateDate = options.slateDate ? String(options.slateDate) : null;
  const scoped = (Array.isArray(props) ? props : []).filter((prop) => {
    if (!slateDate) return true;
    return String(prop.slateDate || "") === slateDate;
  });

  const graded = scoped.filter((prop) => isResolvedStatus(prop.status || prop.result));
  const wins = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "win")
    .map(buildSnapshotEntry)
    .sort((a, b) => Number(b.margin ?? 0) - Number(a.margin ?? 0));

  const losses = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "loss")
    .map(buildSnapshotEntry)
    .sort((a, b) => Number(a.margin ?? 0) - Number(b.margin ?? 0));

  const pushes = graded
    .filter((prop) => String(prop.status || prop.result).toLowerCase() === "push")
    .map(buildSnapshotEntry);

  const winningProps = enrichWithFormatted(wins);
  const losingProps = enrichWithFormatted(losses);
  const pushProps = enrichWithFormatted(pushes);

  const snapshotMissing = graded.length === 0;

  return {
    title: "Slate Results Snapshot",
    slateDate: slateDate || scoped[0]?.slateDate || null,
    snapshotMissing,
    message: snapshotMissing
      ? options.missingMessage || "No graded props yet — snapshot appears after grading."
      : null,
    winsCount: wins.length,
    lossesCount: losses.length,
    pushesCount: pushes.length,
    gradedCount: graded.length,
    totalTracked: scoped.length,
    winningProps,
    losingProps,
    pushProps,
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
    generatedAt: new Date().toISOString(),
  };
}

export { formatSnapshotLine, buildSnapshotEntry };
