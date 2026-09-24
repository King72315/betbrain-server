/**
 * Durable official slate. Grading reads this file, never the live /picks board.
 * Terminal grades and frozen side/line cannot be replaced.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { gradeWinner } from "../engines/wnba/winnersV1/winnerLifecycleV1.js";
import { gradePointsPick } from "./resultService.js";
import {
  DURABLE_KEYS,
  syncKeyToDurableFireAndForget,
  writeDurableMirrorSync,
} from "./courtEdgeDurableStoreV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = path.join(ROOT, "data", "courtedge-frozen-slates-v1.json");
const TERMINAL = new Set(["WIN", "LOSS", "PUSH", "VOID"]);
const VERSION = "courtedge-frozen-slate-v1";

let fileOverride = null;

export function configureFrozenSlateFile(file) {
  fileOverride = file || null;
}

function filePath() {
  return fileOverride || DEFAULT_FILE;
}

function emptyStore() {
  return { version: VERSION, slates: {} };
}

function readStore() {
  const file = filePath();
  if (!fs.existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed?.slates ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const file = filePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
  if (!fileOverride) {
    try {
      writeDurableMirrorSync(DURABLE_KEYS.FROZEN_SLATES, store);
    } catch {
      /* local file remains the read source */
    }
    syncKeyToDurableFireAndForget(DURABLE_KEYS.FROZEN_SLATES, store, { recordVersion: 1 });
  }
}

function isTerminal(grade) {
  return TERMINAL.has(String(grade || "").toUpperCase());
}

function rowId(row) {
  return String(row?.predictionId || row?.officialPropId || row?.id || "");
}

function lockFrozen(existing, incoming) {
  if (!existing) return incoming;
  const grade = isTerminal(existing.grade) ? existing.grade : incoming.grade || existing.grade || "PENDING";
  return {
    ...existing,
    ...incoming,
    predictionId: existing.predictionId,
    eventId: existing.eventId || incoming.eventId,
    player: existing.player || incoming.player,
    team: existing.team || incoming.team,
    selectedWinnerName: existing.selectedWinnerName || incoming.selectedWinnerName,
    side: existing.side ?? incoming.side,
    line: existing.line ?? incoming.line,
    officialLine: existing.officialLine ?? existing.line ?? incoming.officialLine ?? incoming.line,
    probability: existing.probability ?? incoming.probability,
    confidence: existing.confidence ?? incoming.confidence,
    risk: existing.risk ?? incoming.risk,
    rank: existing.rank ?? incoming.rank,
    modelVersion: existing.modelVersion || incoming.modelVersion,
    grade,
    gameStatus: isTerminal(grade) ? "FINAL" : incoming.gameStatus || existing.gameStatus || null,
    actualStat: isTerminal(existing.grade) ? existing.actualStat ?? incoming.actualStat : incoming.actualStat ?? existing.actualStat ?? null,
    actualHomeScore: isTerminal(existing.grade) ? existing.actualHomeScore ?? incoming.actualHomeScore : incoming.actualHomeScore ?? existing.actualHomeScore ?? null,
    actualAwayScore: isTerminal(existing.grade) ? existing.actualAwayScore ?? incoming.actualAwayScore : incoming.actualAwayScore ?? existing.actualAwayScore ?? null,
  };
}

function mergeRows(existingRows = [], incomingRows = []) {
  const byId = new Map(existingRows.map((row) => [rowId(row), row]));
  for (const row of incomingRows) {
    const id = rowId(row);
    if (!id) continue;
    byId.set(id, lockFrozen(byId.get(id), { ...row, predictionId: id }));
  }
  return [...byId.values()];
}

export function getFrozenSlate(date) {
  return readStore().slates[String(date || "").slice(0, 10)] || null;
}

export function listFrozenSlates() {
  return Object.values(readStore().slates || {});
}

export function captureFrozenOfficialSlate({
  slateDateCT,
  props = [],
  winners = [],
  meta = {},
} = {}) {
  const date = String(slateDateCT || "").slice(0, 10);
  if (!date) return { ok: false, reason: "NO_DATE" };
  const store = readStore();
  const existing = store.slates[date] || null;
  const nextProps = mergeRows(existing?.props || [], props.map(normalizeProp));
  const nextWinners = mergeRows(existing?.winners || [], winners.map(normalizeWinner));
  if (!nextProps.length && !nextWinners.length && !existing) {
    return { ok: false, reason: "EMPTY_SLATE" };
  }
  const slate = {
    version: VERSION,
    slateDateCT: date,
    freezeId: existing?.freezeId || crypto.randomUUID(),
    freezeHash: existing?.freezeHash || hashSlate(date, nextProps, nextWinners),
    frozenAt: existing?.frozenAt || new Date().toISOString(),
    modelVersion: existing?.modelVersion || meta.modelVersion || "COURTEDGE_PTS_WINNERC_PRODUCTION_V1",
    props: nextProps,
    winners: nextWinners,
    unrecoverable: existing?.unrecoverable || [],
  };
  if (!existing?.freezeHash) slate.freezeHash = hashSlate(date, nextProps, nextWinners);
  store.slates[date] = slate;
  writeStore(store);
  return { ok: true, slate };
}

function hashSlate(date, props, winners) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      date,
      props: props.map((row) => [row.predictionId, row.side, row.line]),
      winners: winners.map((row) => [row.predictionId, row.selectedWinnerName]),
    }))
    .digest("hex");
}

function normalizeProp(row = {}) {
  const line = row.officialLine ?? row.line;
  const id = row.predictionId || row.officialPropId || [
    "WNBA", "PROP", row.slateDateCT || row.canonicalSlateDate || "",
    row.eventId || "", row.player || row.playerName || "", row.propType || row.stat || "POINTS", line, row.side,
  ].join("|");
  return {
    kind: "PROP",
    predictionId: id,
    eventId: row.eventId || null,
    player: row.player || row.playerName || null,
    team: row.team || null,
    opponent: row.opponent || null,
    propType: row.propType || row.stat || "POINTS",
    side: row.side || row.selectedSide || null,
    line,
    officialLine: line,
    probability: row.probability ?? row.selectedProbability ?? null,
    confidence: row.confidence ?? null,
    risk: row.risk || row.riskLabel || null,
    rank: row.rank ?? row.topPickRank ?? null,
    modelVersion: row.modelVersion || row.version || null,
    commenceTime: row.commenceTime || row.startISO || row.startTime || null,
    grade: row.grade || "PENDING",
    gameStatus: row.gameStatus || null,
    actualStat: row.actualStat ?? null,
  };
}

function normalizeWinner(row = {}) {
  const id = row.predictionId || row.winnerPredictionId || row.id;
  return {
    kind: "WINNER",
    predictionId: id,
    eventId: row.eventId || null,
    awayTeam: row.awayTeam || row.awayName || row.participantA || null,
    homeTeam: row.homeTeam || row.homeName || row.participantB || null,
    selectedWinnerName: row.selectedWinnerName || row.selectedWinner || null,
    selectedWinnerId: row.selectedWinnerId || row.selectedWinnerName || row.selectedWinner || null,
    probability: row.probability ?? row.selectedProbability ?? null,
    confidence: row.confidence ?? null,
    risk: row.risk || null,
    rank: row.rank ?? row.winnerRank ?? null,
    modelVersion: row.modelVersion || "COURTEDGE_WINNER_C_PRODUCTION_V1",
    commenceTime: row.commenceTime || row.startISO || row.scheduledStart || null,
    winnerTrackingType: "OFFICIAL",
    grade: row.grade || row.winnerStatus || "PENDING",
    winnerStatus: row.winnerStatus || row.grade || "PENDING",
    gameStatus: row.gameStatus || row.eventStatus || null,
    actualHomeScore: row.actualHomeScore ?? row.homeScore ?? null,
    actualAwayScore: row.actualAwayScore ?? row.awayScore ?? null,
  };
}

export function applyVerifiedFinals(date, { winners = [], props = [] } = {}) {
  const slate = getFrozenSlate(date);
  if (!slate) return { ok: false, reason: "NO_FROZEN_SLATE" };
  const gradedWinners = slate.winners.map((row) => {
    if (isTerminal(row.grade)) return row;
    const found = winners.find((item) => item.eventId === row.eventId || item.predictionId === row.predictionId);
    if (!found || found.homeScore == null || found.awayScore == null) return row;
    const graded = gradeWinner(
      { ...row, selectedWinnerId: row.selectedWinnerId, homeTeam: row.homeTeam },
      found.homeScore,
      found.awayScore
    );
    return lockFrozen(row, {
      ...row,
      grade: graded.winnerStatus,
      winnerStatus: graded.winnerStatus,
      gameStatus: "FINAL",
      actualHomeScore: found.homeScore,
      actualAwayScore: found.awayScore,
    });
  });
  const gradedProps = slate.props.map((row) => {
    if (isTerminal(row.grade)) return row;
    const found = props.find((item) => item.predictionId === row.predictionId || (
      item.player === row.player && item.eventId === row.eventId
    ));
    if (!found) return row;
    const graded = gradePointsPick(
      { ...row, officialLine: row.officialLine ?? row.line, side: row.side },
      found.stat
    );
    if (!graded.grade) return { ...row, pendingReason: graded.pendingReason || row.pendingReason || null };
    return lockFrozen(row, {
      ...row,
      grade: graded.grade,
      gameStatus: "FINAL",
      actualStat: graded.actualStat ?? null,
      line: row.line,
      officialLine: row.officialLine ?? row.line,
      side: row.side,
    });
  });
  const store = readStore();
  store.slates[slate.slateDateCT] = { ...slate, props: gradedProps, winners: gradedWinners };
  writeStore(store);
  return { ok: true, slate: store.slates[slate.slateDateCT] };
}

export function slateRecord(rows = []) {
  const tally = { wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0 };
  for (const row of rows) {
    const grade = String(row.grade || "PENDING").toUpperCase();
    if (grade === "WIN") tally.wins += 1;
    else if (grade === "LOSS") tally.losses += 1;
    else if (grade === "PUSH") tally.pushes += 1;
    else if (grade === "VOID") tally.voids += 1;
    else tally.pending += 1;
  }
  return { ...tally, text: `${tally.wins}-${tally.losses}-${tally.pushes}-${tally.voids}` };
}

export function markUnrecoverable(date, entry) {
  const store = readStore();
  const slate = store.slates[date] || {
    version: VERSION,
    slateDateCT: date,
    freezeId: crypto.randomUUID(),
    freezeHash: null,
    frozenAt: new Date().toISOString(),
    props: [],
    winners: [],
    unrecoverable: [],
  };
  const already = (slate.unrecoverable || []).some((item) => item.reason === entry.reason);
  if (!already) slate.unrecoverable = [...(slate.unrecoverable || []), entry];
  store.slates[date] = slate;
  writeStore(store);
  return slate;
}

/** Verified Sep 23 winner rows already stored in HQ. Props were never frozen. */
export function recoverSep23FrozenSlate() {
  const date = "2026-09-23";
  const winners = [
    {
      predictionId: "WNBA|WINNER|2026-09-23|wnba:espn:401857214|DAL|SEA",
      eventId: "wnba:espn:401857214",
      awayTeam: "Dallas Wings",
      homeTeam: "Seattle Storm",
      selectedWinnerName: "Dallas Wings",
      selectedWinnerId: "Dallas Wings",
      probability: 0.6363,
      confidence: 71,
      risk: "MEDIUM",
      rank: 1,
      commenceTime: "2026-09-24T02:00:00.000Z",
      modelVersion: "COURTEDGE_WINNER_C_PRODUCTION_V1",
    },
    {
      predictionId: "WNBA|WINNER|2026-09-23|wnba:espn:401857213|ATL|NYL",
      eventId: "wnba:espn:401857213",
      awayTeam: "Atlanta Dream",
      homeTeam: "New York Liberty",
      selectedWinnerName: "Atlanta Dream",
      selectedWinnerId: "Atlanta Dream",
      probability: 0.5406,
      confidence: 63,
      risk: "HIGH",
      rank: 2,
      commenceTime: "2026-09-24T00:00:00.000Z",
      modelVersion: "COURTEDGE_WINNER_C_PRODUCTION_V1",
    },
  ];
  const captured = captureFrozenOfficialSlate({ slateDateCT: date, winners });
  const graded = applyVerifiedFinals(date, {
    winners: [
      { eventId: "wnba:espn:401857214", homeScore: 91, awayScore: 103 },
      { eventId: "wnba:espn:401857213", homeScore: 65, awayScore: 83 },
    ],
  });
  const slate = markUnrecoverable(date, {
    reason: "ORIGINAL_OFFICIAL_PROP_PACKET_MISSING",
    slateDateCT: date,
    detail: "No Sep 23 official points freeze, tracked prop, or live board card exists. Predictions were not reminted.",
  });
  return { ok: true, captured: captured.ok, slate };
}

export function propsFromBoard(board = {}, date) {
  const pools = [
    board.topWNBAOfficialProps,
    board.topOfficialProps,
    board.bestSixDisplayTodayWNBA,
    board.selectedPropsTodayWNBA,
  ];
  const seen = new Set();
  const props = [];
  for (const pool of pools) {
    for (const row of pool || []) {
      if (row?.officialSelected !== true) continue;
      const slate = String(row.canonicalSlateDate || row.slateDateCT || row.slateDate || date || "").slice(0, 10);
      if (date && slate && slate !== date) continue;
      const id = row.predictionId || row.officialPropId || `${row.player}|${row.side}|${row.officialLine ?? row.line}`;
      if (seen.has(id)) continue;
      seen.add(id);
      props.push({ ...row, slateDateCT: slate || date });
    }
  }
  return props;
}

export function winnersFromSlate(slate) {
  const rows = slate?.fullSlate || slate?.topWinners || [];
  return rows.filter((row) => row && (row.winnerTrackingType === "OFFICIAL" || row.officialPromotion !== false));
}

function pastStart(row, now) {
  const start = Date.parse(row.commenceTime || "");
  if (!Number.isFinite(start)) return true;
  return start <= now.getTime();
}

async function defaultScoreboard(date) {
  const compact = String(date || "").replace(/-/g, "");
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${compact}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.events || [];
}

export async function reconcilePendingFrozenSlates({ now = new Date(), fetchScoreboard = defaultScoreboard } = {}) {
  const updated = [];
  for (const slate of listFrozenSlates()) {
    const pendingWinners = (slate.winners || []).filter((row) => !isTerminal(row.grade) && pastStart(row, now));
    if (!pendingWinners.length) continue;
    const events = await fetchScoreboard(slate.slateDateCT);
    const byId = new Map();
    for (const event of events || []) {
      const comp = event?.competitions?.[0];
      const done = comp?.status?.type?.completed === true || comp?.status?.type?.state === "post";
      if (!done) continue;
      const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
      const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
      byId.set(String(event.id), { homeScore: Number(home?.score), awayScore: Number(away?.score) });
    }
    const finals = [];
    for (const row of pendingWinners) {
      const hit = byId.get(String(row.eventId || "").replace("wnba:espn:", ""));
      if (!hit || !Number.isFinite(hit.homeScore) || !Number.isFinite(hit.awayScore)) continue;
      finals.push({ eventId: row.eventId, predictionId: row.predictionId, ...hit });
    }
    if (finals.length) updated.push(applyVerifiedFinals(slate.slateDateCT, { winners: finals }));
  }
  return { ok: true, updated: updated.length };
}
