import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { TRACKING } from "../engines/wnba/winnersV1/constants.js";
import {
  DURABLE_KEYS,
  durableGet,
  syncKeyToDurableFireAndForget,
  writeDurableMirrorSync,
} from "./courtEdgeDurableStoreV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "wnba-winners-v1.json");
const PRODUCTION_FREEZES = path.join(ROOT, "data", "wnba-winners-production-freezes-v1.json");
const BUNDLES_DIR = path.join(ROOT, "active-bundles");

function emptyStore() {
  return { slates: {}, durable: true, version: "courtedge-wnba-winners-durable-v1" };
}

function readLocal() {
  if (!fs.existsSync(FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return parsed?.slates ? parsed : { ...emptyStore(), ...parsed, slates: parsed.slates || {} };
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

function compactFreeze(slate) {
  return {
    slateDateCT: slate.slateDateCT,
    freezeHash: slate.freezeHash,
    frozenAt: slate.frozenAt || slate.persistedAt,
    frozen: true,
    version: slate.version,
    productionMode: slate.productionMode,
    officialPromotion: slate.officialPromotion,
    modelVersion: slate.version,
    games: (slate.fullSlate || []).map((r) => ({
      winnerPredictionId: r.winnerPredictionId,
      eventId: r.eventId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      homeName: r.homeName,
      awayName: r.awayName,
      selectedWinnerId: r.selectedWinnerId,
      selectedWinnerName: r.selectedWinnerName,
      selectedProbability: r.selectedProbability,
      pHome: r.pHome,
      pAway: r.pAway,
      winnerRank: r.winnerRank,
      winnerTrackingType: r.winnerTrackingType,
      modelVersion: r.modelVersion,
      productionOwner: r.productionOwner,
      components: r.featureSnapshot?.components || null,
      pdBaselinePick: r.featureSnapshot?.pdBaselinePick || null,
      pdBaselineProbability: r.featureSnapshot?.pdBaselineProbability || null,
      marketP:
        r.selectedWinnerId === r.homeTeam
          ? r.marketSnapshot?.noVigHome
          : r.marketSnapshot?.noVigAway,
      homeMoneyline: r.marketSnapshot?.homeMoneyline ?? null,
      awayMoneyline: r.marketSnapshot?.awayMoneyline ?? null,
      winnerStatus: r.winnerStatus || "PENDING",
      actualHomeScore: r.actualHomeScore ?? null,
      actualAwayScore: r.actualAwayScore ?? null,
    })),
  };
}

export function computeWinnerFreezeHash(slate) {
  const rows = (slate.fullSlate || []).map((r) => [
    r.winnerPredictionId,
    r.selectedWinnerId,
    r.selectedProbability,
    r.modelVersion,
    r.pHome,
    r.pAway,
  ]);
  return crypto.createHash("sha256").update(JSON.stringify({
    slateDateCT: slate.slateDateCT,
    version: slate.version,
    rows,
  })).digest("hex");
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isProductionFreeze(slate) {
  return (
    slate?.frozen === true &&
    slate?.productionMode !== "TEST_ONLY" &&
    String(slate?.slateDateCT || "").startsWith("20") &&
    !String(slate?.slateDateCT || "").startsWith("2099")
  );
}

function writeProductionFreezeSnapshot(slate) {
  if (!isProductionFreeze(slate)) return;
  const store = readJsonSafe(PRODUCTION_FREEZES, emptyStore());
  store.slates = store.slates || {};
  store.slates[slate.slateDateCT] = {
    ...slate,
    compact: slate.compact || compactFreeze(slate),
  };
  writeLocalTo(PRODUCTION_FREEZES, store);
  try {
    const dir = path.join(BUNDLES_DIR, slate.slateDateCT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "wnba-winners.json"),
      JSON.stringify(store.slates[slate.slateDateCT], null, 2)
    );
  } catch {
    /* bundle write is best-effort */
  }
}

function writeLocalTo(file, store) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

function loadBundledProductionFreezes() {
  const bundled = {};
  const fromFile = readJsonSafe(PRODUCTION_FREEZES, { slates: {} });
  for (const [date, slate] of Object.entries(fromFile.slates || {})) {
    if (isProductionFreeze(slate) || slate?.freezeHash) bundled[date] = slate;
  }
  try {
    if (fs.existsSync(BUNDLES_DIR)) {
      for (const name of fs.readdirSync(BUNDLES_DIR)) {
        const candidate = path.join(BUNDLES_DIR, name, "wnba-winners.json");
        const slate = readJsonSafe(candidate, null);
        if (slate?.freezeHash && (slate.fullSlate || slate.compact || slate.games)) {
          bundled[name] = slate.slateDateCT ? slate : { ...slate, slateDateCT: name };
        }
      }
    }
  } catch {
    /* ignore bundle scan */
  }
  return bundled;
}

function persistBoth(store) {
  writeLocal(store);
  try {
    writeDurableMirrorSync(DURABLE_KEYS.WNBA_WINNERS, store);
  } catch {
    /* mirror is best-effort; local write already succeeded */
  }
  syncKeyToDurableFireAndForget(DURABLE_KEYS.WNBA_WINNERS, store, { recordVersion: 1 });
}

export function persistWinnerSlate(slate) {
  const store = readLocal();
  const date = slate.slateDateCT;
  const existing = store.slates[date];
  if (existing?.frozen === true) {
    persistBoth(store);
    writeProductionFreezeSnapshot(existing);
    return { ok: true, frozen: true, reused: true, slate: existing };
  }
  if (!(slate?.fullSlate || []).length) {
    return { ok: false, frozen: false, reused: false, reason: "EMPTY_SLATE_NOT_FROZEN", slate };
  }
  const freezeHash = computeWinnerFreezeHash(slate);
  const frozenAt = slate.frozenAt || new Date().toISOString();
  store.slates[date] = {
    ...slate,
    frozen: true,
    freezeHash,
    frozenAt,
    persistedAt: new Date().toISOString(),
    compact: compactFreeze({ ...slate, freezeHash, frozenAt }),
  };
  persistBoth(store);
  writeProductionFreezeSnapshot(store.slates[date]);
  return { ok: true, frozen: true, reused: false, slate: store.slates[date] };
}

function hydrateSlateShape(slate) {
  if (!slate) return null;
  if (Array.isArray(slate.fullSlate) && slate.fullSlate.length) return slate;
  const games = slate.compact?.games || slate.games || [];
  if (!games.length) return slate;
  return { ...slate, fullSlate: games };
}

export function getWinnerSlate(date) {
  const store = readLocal();
  const key = String(date || "");
  const local = hydrateSlateShape(store.slates[key]);
  if (local?.frozen) return local;
  const bundled = loadBundledProductionFreezes()[key];
  return hydrateSlateShape(bundled) || local || null;
}

export async function hydrateWinnerStoreFromDurable() {
  const bundled = loadBundledProductionFreezes();
  let remoteSlates = {};
  try {
    const remote = await durableGet(DURABLE_KEYS.WNBA_WINNERS);
    const value = remote?.value || remote;
    remoteSlates = value?.slates || {};
  } catch {
    /* local + bundled remain authority if durable read fails */
  }
  const local = readLocal();
  const merged = {
    ...emptyStore(),
    ...local,
    slates: {
      ...remoteSlates,
      ...bundled,
      ...local.slates,
    },
  };
  // Frozen production dates always win over empty/test overlays.
  for (const [date, slate] of Object.entries({ ...bundled, ...remoteSlates, ...local.slates })) {
    if (isProductionFreeze(slate)) merged.slates[date] = slate;
  }
  writeLocal(merged);
  return { ok: true, dates: Object.keys(merged.slates) };
}

export async function restoreWinnerSlateAfterRestart(date) {
  const local = getWinnerSlate(date);
  if (local?.frozen) return local;
  await hydrateWinnerStoreFromDurable();
  return getWinnerSlate(date);
}

export function officialWinnersForResults(date) {
  const slate = getWinnerSlate(date);
  if (!slate) return [];
  const rows = slate.fullSlate || slate.compact?.games || [];
  return rows.filter((r) => r.winnerTrackingType === TRACKING.OFFICIAL || r.officialPromotion !== false);
}

export function labWinnerSlate(date) {
  return getWinnerSlate(date);
}

export { compactFreeze };
