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
  return { ok: true, frozen: true, reused: false, slate: store.slates[date] };
}

export function getWinnerSlate(date) {
  const store = readLocal();
  return store.slates[String(date || "")] || null;
}

export async function hydrateWinnerStoreFromDurable() {
  try {
    const remote = await durableGet(DURABLE_KEYS.WNBA_WINNERS);
    const value = remote?.value || remote;
    if (value?.slates && Object.keys(value.slates).length) {
      const local = readLocal();
      const merged = { ...emptyStore(), ...local, slates: { ...value.slates, ...local.slates } };
      writeLocal(merged);
      return { ok: true, dates: Object.keys(merged.slates) };
    }
  } catch {
    /* local file remains authority if durable read fails */
  }
  return { ok: false, dates: Object.keys(readLocal().slates || {}) };
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
  return (slate.fullSlate || []).filter((r) => r.winnerTrackingType === TRACKING.OFFICIAL);
}

export function labWinnerSlate(date) {
  return getWinnerSlate(date);
}

export { compactFreeze };
