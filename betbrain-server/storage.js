import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "pick-history.json");
const ACCURACY_FILE = path.join(__dirname, "player_accuracy.json");
const FILTERED_FILE = path.join(__dirname, "filtered-props.json");
const ANALYTICS_FILE = path.join(__dirname, "pick-analytics.json");

function ensureFile(file, defaultData = []) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
  }
}

ensureFile(HISTORY_FILE, []);
ensureFile(ACCURACY_FILE, {});
ensureFile(FILTERED_FILE, []);
ensureFile(ANALYTICS_FILE, {
  overall: {},
  byLeague: {},
  bySide: {},
  byTier: {},
  byConfidenceBucket: {},
  byRiskLabel: {},
  byPlayer: {},
});

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getConfidenceBucket(confidence = 0) {
  const c = num(confidence);

  if (c >= 80) return "80+";
  if (c >= 75) return "75-79";
  if (c >= 70) return "70-74";
  if (c >= 65) return "65-69";
  if (c >= 60) return "60-64";
  if (c >= 55) return "55-59";

  return "Under 55";
}

function getPickKey(pick = {}) {
  const date =
    pick.date ||
    pick.dateLabel ||
    pick.commenceTime ||
    pick.createdAt ||
    "";

  return [
    pick.league || "",
    pick.gameId || pick.game || "",
    date,
    pick.player || "",
    pick.stat || "Points",
    pick.side || pick.pick || "",
    pick.line || pick.sportsbookLine || "",
  ]
    .map(clean)
    .join("-");
}

function normalizePick(pick = {}, existing = null) {
  const now = new Date().toISOString();

  const confidence = num(
    pick.confidence ??
      pick.winProbability ??
      pick.grading?.confidence ??
      0
  );

  const side = pick.side || pick.pick || "";

  const normalized = {
    ...existing,
    ...pick,

    id: existing?.id || pick.id || getPickKey(pick),
    pickKey: existing?.pickKey || pick.pickKey || getPickKey(pick),

    league: pick.league || existing?.league || "",
    player: pick.player || existing?.player || "",
    team: pick.team || existing?.team || "",
    opponent: pick.opponent || existing?.opponent || "",
    game: pick.game || existing?.game || "",
    gameId: pick.gameId || existing?.gameId || "",

    stat: pick.stat || existing?.stat || "Points",
    side,
    pick: side,
    line: num(pick.line ?? pick.sportsbookLine ?? existing?.line),
    sportsbookLine: num(
      pick.sportsbookLine ?? pick.line ?? existing?.sportsbookLine
    ),

    confidence,
    winProbability: confidence,

    tier: pick.tier || existing?.tier || "WATCHLIST",
    strength: pick.strength || existing?.strength || "",
    riskLabel: pick.riskLabel || existing?.riskLabel || "",

    supportScore: num(pick.supportScore ?? existing?.supportScore),
    resistanceScore: num(
      pick.resistanceScore ??
        pick.dangerScore ??
        existing?.resistanceScore
    ),
    dangerScore: num(
      pick.dangerScore ??
        pick.resistanceScore ??
        existing?.dangerScore
    ),
    netEdge: num(pick.netEdge ?? pick.gap ?? existing?.netEdge),
    gap: num(pick.gap ?? pick.netEdge ?? existing?.gap),

    chosenRisk: num(pick.chosenRisk ?? existing?.chosenRisk),
    riskGap: num(pick.riskGap ?? existing?.riskGap),

    dataQuality: num(pick.dataQuality ?? existing?.dataQuality),
    marketQuality: num(pick.marketQuality ?? existing?.marketQuality),
    bookCount: num(pick.bookCount ?? existing?.bookCount),

    projection: num(pick.projection ?? existing?.projection),
    edge: num(pick.edge ?? existing?.edge),
    seasonAverage: num(pick.seasonAverage ?? existing?.seasonAverage),
    last5Average: num(pick.last5Average ?? existing?.last5Average),
    sportsProjection: num(
      pick.sportsProjection ?? existing?.sportsProjection
    ),

    status: pick.status || existing?.status || "pending",

    createdAt: existing?.createdAt || pick.createdAt || now,
    updatedAt: now,

    resolvedAt: pick.resolvedAt || existing?.resolvedAt || null,

    result: pick.result ?? existing?.result ?? null,
    actualPoints: pick.actualPoints ?? existing?.actualPoints ?? null,
    finalPoints: pick.finalPoints ?? existing?.finalPoints ?? null,
  };

  normalized.confidenceBucket = getConfidenceBucket(normalized.confidence);

  return normalized;
}

function isResolvedPick(pick = {}) {
  return ["win", "loss", "push"].includes(String(pick.status || "").toLowerCase());
}

function updateBucket(bucket = {}, key = "UNKNOWN", status = "pending") {
  if (!bucket[key]) {
    bucket[key] = {
      wins: 0,
      losses: 0,
      pushes: 0,
      total: 0,
      accuracy: 0,
    };
  }

  if (status === "win") bucket[key].wins += 1;
  if (status === "loss") bucket[key].losses += 1;
  if (status === "push") bucket[key].pushes += 1;

  bucket[key].total =
    bucket[key].wins + bucket[key].losses + bucket[key].pushes;

  const gradedTotal = bucket[key].wins + bucket[key].losses;

  bucket[key].accuracy =
    gradedTotal > 0
      ? Number(((bucket[key].wins / gradedTotal) * 100).toFixed(1))
      : 0;

  return bucket;
}

function buildAnalyticsFromHistory(picks = []) {
  const analytics = {
    overall: {
      wins: 0,
      losses: 0,
      pushes: 0,
      total: 0,
      accuracy: 0,
    },
    byLeague: {},
    bySide: {},
    byTier: {},
    byConfidenceBucket: {},
    byRiskLabel: {},
    byPlayer: {},
  };

  for (const pick of picks) {
    if (!isResolvedPick(pick)) continue;

    const status = String(pick.status).toLowerCase();

    if (status === "win") analytics.overall.wins += 1;
    if (status === "loss") analytics.overall.losses += 1;
    if (status === "push") analytics.overall.pushes += 1;

    updateBucket(analytics.byLeague, pick.league || "UNKNOWN", status);
    updateBucket(analytics.bySide, pick.side || pick.pick || "UNKNOWN", status);
    updateBucket(analytics.byTier, pick.tier || "UNKNOWN", status);
    updateBucket(
      analytics.byConfidenceBucket,
      pick.confidenceBucket || getConfidenceBucket(pick.confidence),
      status
    );
    updateBucket(analytics.byRiskLabel, pick.riskLabel || "UNKNOWN", status);
    updateBucket(analytics.byPlayer, pick.player || "UNKNOWN", status);
  }

  analytics.overall.total =
    analytics.overall.wins +
    analytics.overall.losses +
    analytics.overall.pushes;

  const gradedTotal = analytics.overall.wins + analytics.overall.losses;

  analytics.overall.accuracy =
    gradedTotal > 0
      ? Number(((analytics.overall.wins / gradedTotal) * 100).toFixed(1))
      : 0;

  analytics.updatedAt = new Date().toISOString();

  return analytics;
}

function rebuildPlayerAccuracyFromHistory(picks = []) {
  const accuracy = {};

  for (const pick of picks) {
    if (!isResolvedPick(pick)) continue;

    const player = pick.player || "";
    const key = clean(player);

    if (!key) continue;

    if (!accuracy[key]) {
      accuracy[key] = {
        player,
        wins: 0,
        losses: 0,
        pushes: 0,
        total: 0,
        accuracy: 0,
        bySide: {},
        byTier: {},
        byLeague: {},
      };
    }

    const status = String(pick.status).toLowerCase();

    if (status === "win") accuracy[key].wins += 1;
    if (status === "loss") accuracy[key].losses += 1;
    if (status === "push") accuracy[key].pushes += 1;

    updateBucket(accuracy[key].bySide, pick.side || pick.pick || "UNKNOWN", status);
    updateBucket(accuracy[key].byTier, pick.tier || "UNKNOWN", status);
    updateBucket(accuracy[key].byLeague, pick.league || "UNKNOWN", status);

    accuracy[key].total =
      accuracy[key].wins + accuracy[key].losses + accuracy[key].pushes;

    const gradedTotal = accuracy[key].wins + accuracy[key].losses;

    accuracy[key].accuracy =
      gradedTotal > 0
        ? Number(((accuracy[key].wins / gradedTotal) * 100).toFixed(1))
        : 0;
  }

  return accuracy;
}

function persistCalibration(picks = []) {
  const analytics = buildAnalyticsFromHistory(picks);
  const playerAccuracy = rebuildPlayerAccuracyFromHistory(picks);

  writeJSON(ANALYTICS_FILE, analytics);
  writeJSON(ACCURACY_FILE, playerAccuracy);
}

export function savePick(pick) {
  const picks = readJSON(HISTORY_FILE, []);

  const normalized = normalizePick(pick);
  const existingIndex = picks.findIndex(
    (p) => p.pickKey === normalized.pickKey || p.id === normalized.id
  );

  if (existingIndex >= 0) {
    picks[existingIndex] = normalizePick(
      {
        ...picks[existingIndex],
        ...pick,
      },
      picks[existingIndex]
    );
  } else {
    picks.push(normalized);
  }

  writeJSON(HISTORY_FILE, picks);
  persistCalibration(picks);

  return existingIndex >= 0 ? picks[existingIndex] : normalized;
}

export function getSavedPicks() {
  return readJSON(HISTORY_FILE, []);
}

export function getPendingPicks() {
  return getSavedPicks().filter((pick) => {
    const status = String(pick.status || "pending").toLowerCase();
    return status === "pending";
  });
}

export function getResolvedPicks() {
  return getSavedPicks().filter(isResolvedPick);
}

export function savePickHistory(picks) {
  const normalized = (Array.isArray(picks) ? picks : []).map((pick) =>
    normalizePick(pick)
  );

  writeJSON(HISTORY_FILE, normalized);
  persistCalibration(normalized);

  return normalized;
}

export function saveFilteredProp(prop) {
  const props = readJSON(FILTERED_FILE, []);

  props.push({
    ...prop,
    id: prop.id || getPickKey(prop),
    pickKey: prop.pickKey || getPickKey(prop),
    timestamp: new Date().toISOString(),
  });

  writeJSON(FILTERED_FILE, props);

  return props[props.length - 1];
}

export function getFilteredProps() {
  return readJSON(FILTERED_FILE, []);
}

export function updatePlayerAccuracy(player, hit, context = {}) {
  const picks = getSavedPicks();
  const accuracy = readJSON(ACCURACY_FILE, {});
  const key = clean(player);

  if (!key) return accuracy;

  if (!accuracy[key]) {
    accuracy[key] = {
      player,
      wins: 0,
      losses: 0,
      pushes: 0,
      total: 0,
      accuracy: 0,
      bySide: {},
      byTier: {},
      byLeague: {},
    };
  }

  if (hit === true) {
    accuracy[key].wins += 1;
  } else if (hit === false) {
    accuracy[key].losses += 1;
  } else {
    accuracy[key].pushes += 1;
  }

  const status = hit === true ? "win" : hit === false ? "loss" : "push";

  updateBucket(accuracy[key].bySide, context.side || "UNKNOWN", status);
  updateBucket(accuracy[key].byTier, context.tier || "UNKNOWN", status);
  updateBucket(accuracy[key].byLeague, context.league || "UNKNOWN", status);

  accuracy[key].total =
    accuracy[key].wins + accuracy[key].losses + accuracy[key].pushes;

  const gradedTotal = accuracy[key].wins + accuracy[key].losses;

  accuracy[key].accuracy =
    gradedTotal > 0
      ? Number(((accuracy[key].wins / gradedTotal) * 100).toFixed(1))
      : 0;

  writeJSON(ACCURACY_FILE, accuracy);

  const analytics = buildAnalyticsFromHistory(picks);
  writeJSON(ANALYTICS_FILE, analytics);

  return accuracy[key];
}

export function getPlayerAccuracy() {
  return readJSON(ACCURACY_FILE, {});
}

export function getPickAnalytics() {
  const picks = getSavedPicks();
  const currentAnalytics = readJSON(ANALYTICS_FILE, null);

  if (!currentAnalytics) {
    const analytics = buildAnalyticsFromHistory(picks);
    writeJSON(ANALYTICS_FILE, analytics);
    return analytics;
  }

  return currentAnalytics;
}