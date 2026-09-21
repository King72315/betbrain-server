/**
 * Durable Official PTS freeze. Render disk wipes cannot remint a hydrated card.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { shouldBlockOfficialPtsPublication } from "../engines/courtEdgePtsHistoryGateV1.js";
import { isShadowPropMarket, normalizePropMarket } from "../engines/courtEdgeEraV1.js";
import {
  DURABLE_KEYS,
  durableGet,
  syncKeyToDurableFireAndForget,
  writeDurableMirrorSync,
} from "./courtEdgeDurableStoreV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "courtedge-official-pts-v1.json");
const BUNDLES_DIR = path.join(ROOT, "active-bundles");

function emptyStore() {
  return { slates: {}, durable: true, version: "courtedge-official-pts-durable-v1" };
}

function readLocal() {
  if (!fs.existsSync(FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed?.slates ? parsed : { ...emptyStore(), slates: {} };
  } catch {
    return emptyStore();
  }
}

function writeLocal(store) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, FILE);
}

function isPtsCard(p = {}) {
  const market = normalizePropMarket(p.propType || p.stat || p.market);
  return market === "POINTS" && !isShadowPropMarket(market);
}

export function officialPtsCardsFromBoard(board = {}) {
  const pools = [
    board.bestSixDisplayTodayWNBA,
    board.topOfficialProps,
    board.topWNBAOfficialProps,
    board.topProps,
    board.selectedPropsTodayWNBA,
    ...(board.games || []).flatMap((g) => g.picks || []),
  ];
  const seen = new Set();
  const cards = [];
  for (const pool of pools) {
    for (const p of pool || []) {
      if (!p || p.officialSelected !== true) continue;
      if (!isPtsCard(p)) continue;
      if (shouldBlockOfficialPtsPublication(p)) continue;
      const id = `${p.player}|${p.line}|${p.side}`;
      if (seen.has(id)) continue;
      seen.add(id);
      cards.push({
        player: p.player || p.playerName,
        team: p.team || null,
        opponent: p.opponent || null,
        propType: "POINTS",
        line: p.line,
        side: p.side || p.pick,
        projection: p.projection,
        last5: Array.isArray(p.last5) ? p.last5.slice(0, 5) : [],
        last5Average: p.last5Average ?? null,
        seasonAverage: p.seasonAverage ?? null,
        probability: p.probability ?? p.modelWinProbability ?? null,
        risk: p.risk || null,
        officialSelected: true,
        slateDate: p.slateDate || p.canonicalSlateDateCT || board.slateDateCT,
      });
    }
  }
  return cards;
}

export function computeOfficialPtsFreezeHash(slateDateCT, cards = []) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        slateDateCT,
        rows: cards.map((c) => [
          c.player,
          c.line,
          c.side,
          c.projection,
          c.last5Average,
          c.seasonAverage,
        ]),
      })
    )
    .digest("hex");
}

function persistBoth(store) {
  writeLocal(store);
  try {
    writeDurableMirrorSync(DURABLE_KEYS.OFFICIAL_PTS, store);
  } catch {
    /* mirror best-effort */
  }
  syncKeyToDurableFireAndForget(DURABLE_KEYS.OFFICIAL_PTS, store, { recordVersion: 1 });
}

function writeBundle(date, slate) {
  try {
    const dir = path.join(BUNDLES_DIR, date);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "official-pts.json"), JSON.stringify(slate, null, 2));
  } catch {
    /* ignore */
  }
}

export function persistOfficialPtsFreeze({
  slateDateCT,
  board = {},
  gamesStarted = false,
} = {}) {
  const date = String(slateDateCT || "").slice(0, 10);
  if (!date) return { ok: false, reason: "NO_DATE" };
  const cards = officialPtsCardsFromBoard(board);
  const store = readLocal();
  const existing = store.slates[date];
  if (existing?.frozen === true && existing.gamesStarted === true) {
    persistBoth(store);
    return { ok: true, reused: true, slate: existing };
  }
  if (!cards.length) {
    return { ok: false, reason: "NO_HYDRATED_OFFICIAL_PTS", slate: existing || null };
  }
  if (existing?.frozen === true && !gamesStarted && existing.freezeHash) {
    const nextHash = computeOfficialPtsFreezeHash(date, cards);
    if (nextHash === existing.freezeHash) {
      persistBoth(store);
      return { ok: true, reused: true, slate: existing };
    }
    // Integrity replacement only when no game has started.
  }
  const freezeHash = computeOfficialPtsFreezeHash(date, cards);
  const frozenAt = existing?.frozenAt && existing.gamesStarted ? existing.frozenAt : new Date().toISOString();
  const slate = {
    slateDateCT: date,
    frozen: true,
    freezeHash,
    frozenAt,
    gamesStarted,
    official: true,
    version: "COURTEDGE_PTS_WINNERC_PRODUCTION_V1",
    cards,
    games: (board.games || [])
      .filter((g) => String(g.league || "").toUpperCase() === "WNBA")
      .map((g) => ({
        game: g.game,
        date: g.date,
        isStarted: g.isStarted === true,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
      })),
  };
  store.slates[date] = slate;
  persistBoth(store);
  writeBundle(date, slate);
  return { ok: true, reused: false, slate };
}

export function getOfficialPtsSlate(date) {
  return readLocal().slates[String(date || "")] || null;
}

export function officialPtsBoardOverlay(date) {
  const slate = getOfficialPtsSlate(date);
  if (!slate?.cards?.length) return null;
  return {
    ok: true,
    restoredFromOfficialPtsFreeze: true,
    lastUpdated: slate.frozenAt,
    slateDateCT: slate.slateDateCT,
    freezeHash: slate.freezeHash,
    games: slate.games || [],
    topProps: slate.cards,
    topOfficialProps: slate.cards,
    topWNBAOfficialProps: slate.cards,
    bestSixDisplayTodayWNBA: slate.cards,
    bestSixWNBA: slate.cards,
    selectedPropsTodayWNBA: slate.cards,
  };
}

export async function hydrateOfficialPtsStoreFromDurable() {
  try {
    const remote = await durableGet(DURABLE_KEYS.OFFICIAL_PTS);
    const value = remote?.value || remote;
    const bundled = {};
    try {
      if (fs.existsSync(BUNDLES_DIR)) {
        for (const name of fs.readdirSync(BUNDLES_DIR)) {
          const file = path.join(BUNDLES_DIR, name, "official-pts.json");
          if (!fs.existsSync(file)) continue;
          const slate = JSON.parse(fs.readFileSync(file, "utf8"));
          if (slate?.freezeHash) bundled[name] = slate;
        }
      }
    } catch {
      /* ignore */
    }
    const local = readLocal();
    const merged = {
      ...emptyStore(),
      slates: {
        ...(value?.slates || {}),
        ...bundled,
        ...local.slates,
      },
    };
    writeLocal(merged);
    return { ok: true, dates: Object.keys(merged.slates) };
  } catch {
    return { ok: false, dates: Object.keys(readLocal().slates) };
  }
}
