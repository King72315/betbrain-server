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
  gameId = "",
} = {}) {
  return [
    clean(league),
    clean(gameDate),
    clean(player),
    clean(stat),
    clean(gameId),
  ]
    .filter(Boolean)
    .join("|");
}

export function getOpeningLine({
  league = "",
  gameDate = "",
  player = "",
  stat = "Points",
  gameId = "",
} = {}) {
  const key = buildSnapshotKey({ league, gameDate, player, stat, gameId });
  const keyNoGame = buildSnapshotKey({ league, gameDate, player, stat });
  const snapshots = readSnapshots();

  const match =
    snapshots.find((s) => buildSnapshotKey(s) === key) ||
    snapshots.find((s) => buildSnapshotKey({ ...s, gameId: "" }) === keyNoGame) ||
    snapshots.find(
      (s) =>
        clean(s.player) === clean(player) &&
        clean(s.gameDate) === clean(gameDate) &&
        clean(s.league) === clean(league)
    );

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
  gameId = "",
  seedOpeningLine = null,
  snapshotTime = new Date().toISOString(),
} = {}) {
  const snapshots = readSnapshots();
  const key = buildSnapshotKey({ league, gameDate, player, stat, gameId });
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
    // Never overwrite a previously captured opening line.
    const preservedOpening = num(
      existing.openingLine ?? existing.bookLine ?? seedOpeningLine ?? currentLine
    );
    const updated = {
      ...existing,
      snapshotTime,
      gameId: existing.gameId || gameId || "",
      currentLine,
      bookLine: currentLine,
      bookCount: num(bookCount),
      marketQuality: num(marketQuality),
      lineSpread: num(lineSpread),
      overOdds,
      underOdds,
      openingLine: preservedOpening,
      lineMovement: Number((currentLine - preservedOpening).toFixed(1)),
    };

    snapshots[existingIndex] = updated;
    writeSnapshots(snapshots);

    return updated;
  }

  const openingLine = num(seedOpeningLine ?? currentLine);
  const snapshot = {
    snapshotId,
    snapshotTime,
    league,
    gameDate,
    commenceTime,
    player,
    team,
    opponent,
    gameId: gameId || "",
    stat,
    bookLine: currentLine,
    currentLine,
    openingLine,
    lineMovement: Number((currentLine - openingLine).toFixed(1)),
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
