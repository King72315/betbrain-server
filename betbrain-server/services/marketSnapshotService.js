/**
 * Market line snapshots — identity MUST include propType/stat.
 * event + player + propType (+ gameId) — never player-only fallback.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  normalizePropTypeV1,
  propTypeStatLabel,
} from "../engines/wnba/propTypeV1.js";

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

/**
 * Canonical snapshot market label from propType and/or legacy stat.
 * Identity: POINTS | REBOUNDS | ASSISTS → Points | Rebounds | Assists
 */
export function resolveSnapshotStatLabel({
  propType = null,
  stat = null,
} = {}) {
  const fromProp = normalizePropTypeV1(propType);
  if (fromProp) return propTypeStatLabel(fromProp);
  const fromStat = normalizePropTypeV1(stat);
  if (fromStat) return propTypeStatLabel(fromStat);
  // Never invent Points for multistat identity — caller must supply propType/stat.
  return null;
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
  propType = null,
  snapshotTime = new Date().toISOString(),
} = {}) {
  const statLabel = resolveSnapshotStatLabel({ propType, stat });
  const stamp = String(snapshotTime).replace(/[^0-9]/g, "").slice(0, 14);
  return [
    clean(league),
    clean(gameDate),
    clean(player),
    clean(statLabel),
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
  propType = null,
  gameId = "",
} = {}) {
  const statLabel = resolveSnapshotStatLabel({ propType, stat });
  return [
    clean(league),
    clean(gameDate),
    clean(player),
    clean(statLabel),
    clean(gameId),
  ]
    .filter(Boolean)
    .join("|");
}

/**
 * Opening line lookup — REQUIRES propType/stat identity.
 * Never falls back to player+date alone (cross-stat contamination).
 */
export function getOpeningLine({
  league = "",
  gameDate = "",
  player = "",
  stat = "Points",
  propType = null,
  gameId = "",
} = {}) {
  const key = buildSnapshotKey({
    league,
    gameDate,
    player,
    stat,
    propType,
    gameId,
  });
  const keyNoGame = buildSnapshotKey({
    league,
    gameDate,
    player,
    stat,
    propType,
  });
  const snapshots = readSnapshots();

  const match =
    snapshots.find((s) => buildSnapshotKey(s) === key) ||
    snapshots.find(
      (s) => buildSnapshotKey({ ...s, gameId: "" }) === keyNoGame
    );

  if (!match) return null;

  return {
    openingLine: num(match.openingLine ?? match.bookLine ?? match.currentLine),
    snapshotId: match.snapshotId,
    snapshotTime: match.snapshotTime,
    currentLine: num(match.currentLine ?? match.bookLine),
    propType: normalizePropTypeV1(match.propType || match.stat) || null,
    stat: resolveSnapshotStatLabel({
      propType: match.propType,
      stat: match.stat,
    }),
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
  propType = null,
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
  const statLabel = resolveSnapshotStatLabel({ propType, stat });
  const propTypeCanon = normalizePropTypeV1(propType || statLabel);
  if (!statLabel || !propTypeCanon) {
    return {
      ok: false,
      skipped: true,
      reason: "MISSING_PROPTYPE_IDENTITY",
      message: "Market snapshot refused — propType/stat required (no Points default)",
    };
  }
  const key = buildSnapshotKey({
    league,
    gameDate,
    player,
    stat: statLabel,
    propType: propTypeCanon,
    gameId,
  });
  const currentLine = num(bookLine);

  const existingIndex = snapshots.findIndex(
    (s) => buildSnapshotKey(s) === key
  );

  const snapshotId = generateSnapshotId({
    league,
    gameDate,
    player,
    stat: statLabel,
    propType: propTypeCanon,
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
      stat: statLabel,
      propType: propTypeCanon,
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
    stat: statLabel,
    propType: propTypeCanon,
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

export { buildSnapshotKey };
