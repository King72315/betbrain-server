import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOTS_FILE = path.join(__dirname, "..", "line-snapshots.json");

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ensureSnapshotsFile() {
  if (!fs.existsSync(SNAPSHOTS_FILE)) {
    fs.writeFileSync(SNAPSHOTS_FILE, "[]");
  }
}

function readSnapshots() {
  ensureSnapshotsFile();
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots = []) {
  ensureSnapshotsFile();
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2));
}

export function generateSnapshotId({
  league = "",
  gameDate = "",
  player = "",
  stat = "Points",
  snapshotTime = new Date().toISOString(),
} = {}) {
  const stamp = String(snapshotTime).replace(/[^0-9]/g, "").slice(0, 14);
  return [
    clean(league),
    clean(gameDate),
    clean(player),
    clean(stat),
    stamp || Date.now(),
  ]
    .filter(Boolean)
    .join("-");
}

function buildSnapshotKey({
  league = "",
  gameDate = "",
  player = "",
  stat = "Points",
} = {}) {
  return [clean(league), clean(gameDate), clean(player), clean(stat)]
    .filter(Boolean)
    .join("|");
}

export function getOpeningLine({
  league = "",
  gameDate = "",
  player = "",
  stat = "Points",
} = {}) {
  const key = buildSnapshotKey({ league, gameDate, player, stat });
  const snapshots = readSnapshots();

  const match = snapshots.find((s) => buildSnapshotKey(s) === key);

  if (!match) return null;

  return {
    openingLine: num(match.openingLine ?? match.bookLine ?? match.currentLine),
    snapshotId: match.snapshotId,
    snapshotTime: match.snapshotTime,
    currentLine: num(match.currentLine ?? match.bookLine),
  };
}

export function appendMarketSnapshot({
  league = "",
  gameDate = "",
  commenceTime = "",
  player = "",
  team = "",
  opponent = "",
  stat = "Points",
  bookLine = 0,
  bookCount = 0,
  marketQuality = 0,
  lineSpread = 0,
  overOdds = null,
  underOdds = null,
  snapshotTime = new Date().toISOString(),
} = {}) {
  const snapshots = readSnapshots();
  const key = buildSnapshotKey({ league, gameDate, player, stat });
  const currentLine = num(bookLine);

  const existingIndex = snapshots.findIndex(
    (s) => buildSnapshotKey(s) === key
  );

  const snapshotId = generateSnapshotId({
    league,
    gameDate,
    player,
    stat,
    snapshotTime,
  });

  if (existingIndex >= 0) {
    const existing = snapshots[existingIndex];
    const updated = {
      ...existing,
      snapshotTime,
      currentLine,
      bookLine: currentLine,
      bookCount: num(bookCount),
      marketQuality: num(marketQuality),
      lineSpread: num(lineSpread),
      overOdds,
      underOdds,
      openingLine: num(existing.openingLine ?? existing.bookLine ?? currentLine),
    };

    snapshots[existingIndex] = updated;
    writeSnapshots(snapshots);

    return updated;
  }

  const snapshot = {
    snapshotId,
    snapshotTime,
    league,
    gameDate,
    commenceTime,
    player,
    team,
    opponent,
    stat,
    bookLine: currentLine,
    currentLine,
    openingLine: currentLine,
    bookCount: num(bookCount),
    marketQuality: num(marketQuality),
    lineSpread: num(lineSpread),
    overOdds,
    underOdds,
  };

  snapshots.push(snapshot);
  writeSnapshots(snapshots);

  return snapshot;
}
