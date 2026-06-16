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

function isResolvedPickStatus(status = "pending") {
  return ["win", "loss", "push"].includes(String(status || "pending").toLowerCase());
}

function nullableStat(value) {
  return value === null || value === undefined || value === "" ? null : num(value);
}

function resolvePickStatField(pick = {}, existing = {}, fields = []) {
  const status = String(pick.status || existing?.status || "pending").toLowerCase();

  if (!isResolvedPickStatus(status)) {
    const hasExplicitNull = fields.some(
      (field) => pick[field] === null || pick[field] === undefined
    );

    if (hasExplicitNull) {
      const raw = fields.reduce(
        (found, field) => (found !== undefined ? found : pick[field]),
        undefined
      );

      return raw === null || raw === undefined ? null : nullableStat(raw);
    }

    return null;
  }

  const raw = fields.reduce((found, field) => {
    if (found !== null && found !== undefined) return found;
    if (pick[field] !== null && pick[field] !== undefined) return pick[field];
    if (existing?.[field] !== null && existing?.[field] !== undefined) {
      return existing[field];
    }
    return found;
  }, null);

  return nullableStat(raw);
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

function getMarketQualityBucket(marketQuality = 0) {
  const value = num(marketQuality);

  if (value >= 80) return "80+";
  if (value >= 65) return "65-79";
  if (value >= 50) return "50-64";

  return "Under 50";
}

function getBookCountBucket(bookCount = 0) {
  const value = num(bookCount);

  if (value >= 8) return "8+";
  if (value >= 5) return "5-7";
  if (value >= 3) return "3-4";
  if (value >= 1) return "1-2";

  return "0";
}

function getSignalBucket(signalStrength = "") {
  const signal = String(signalStrength || "").toUpperCase();

  if (signal === "STRONG") return "STRONG";
  if (signal === "MODERATE") return "MODERATE";
  if (signal === "WEAK") return "WEAK";

  return "UNKNOWN";
}

function getStartTimeDisplay(pick = {}) {
  if (pick.startTimeDisplay) return pick.startTimeDisplay;

  const source =
    pick.commenceTime || pick.time || pick.gameDate || pick.date || null;

  if (!source) return "";

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) return String(source);

  return (
    parsed.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " CT"
  );
}

function getGameDate(pick = {}) {
  const source =
    pick.gameDate ||
    pick.date ||
    pick.commenceTime ||
    pick.time ||
    pick.createdAt ||
    null;

  if (!source) return "";

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
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

  const side = pick.side || pick.pick || existing?.side || existing?.pick || "";
  const price = num(
    pick.odds ?? pick.price ?? existing?.odds ?? existing?.price
  );

  const normalized = {
    ...existing,
    ...pick,

    id: existing?.id || pick.id || getPickKey(pick),
    pickKey: existing?.pickKey || pick.pickKey || getPickKey(pick),

    league: pick.league || existing?.league || "",
    gameId: pick.gameId || existing?.gameId || "",
    gameDate: getGameDate({ ...existing, ...pick }),
    commenceTime:
      pick.commenceTime || existing?.commenceTime || pick.time || existing?.time || "",
    startTimeDisplay: getStartTimeDisplay({ ...existing, ...pick }),

    player: pick.player || existing?.player || "",
    playerId: pick.playerId || existing?.playerId || "",
    team: pick.team || existing?.team || "",
    opponent: pick.opponent || existing?.opponent || "",
    game: pick.game || existing?.game || "",
    date: pick.date || existing?.date || getGameDate({ ...existing, ...pick }),
    dateLabel: pick.dateLabel || existing?.dateLabel || "",

    stat: pick.stat || existing?.stat || "Points",
    side,
    pick: side,
    line: num(pick.line ?? pick.sportsbookLine ?? existing?.line),
    sportsbookLine: num(
      pick.sportsbookLine ?? pick.line ?? existing?.sportsbookLine
    ),
    odds: price,
    price,

    bookCount: num(pick.bookCount ?? existing?.bookCount),
    marketQuality: num(pick.marketQuality ?? existing?.marketQuality),
    lineSpread: num(pick.lineSpread ?? existing?.lineSpread),

    confidence,
    winProbability: confidence,
    rawConfidenceBeforeReliability: num(
      pick.rawConfidenceBeforeReliability ??
        existing?.rawConfidenceBeforeReliability
    ),
    evidenceReliability: num(
      pick.evidenceReliability ?? existing?.evidenceReliability
    ),
    dangerPressure: num(pick.dangerPressure ?? existing?.dangerPressure),
    confidenceAdjustmentReasons:
      pick.confidenceAdjustmentReasons ||
      existing?.confidenceAdjustmentReasons ||
      [],

    tier: pick.tier || existing?.tier || "WATCHLIST",
    tierReasons: pick.tierReasons || existing?.tierReasons || [],
    strength: pick.strength || existing?.strength || "",
    riskLabel: pick.riskLabel || existing?.riskLabel || "",
    signalStrength: pick.signalStrength || existing?.signalStrength || "",

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
    dataCoverage: num(pick.dataCoverage ?? existing?.dataCoverage),
    opportunityScore: num(pick.opportunityScore ?? existing?.opportunityScore),

    chosenRisk: num(pick.chosenRisk ?? existing?.chosenRisk),
    riskGap: num(pick.riskGap ?? existing?.riskGap),

    dataQuality: num(pick.dataQuality ?? existing?.dataQuality),

    projection: num(pick.projection ?? existing?.projection),
    edge: num(pick.edge ?? existing?.edge),
    seasonAverage: num(pick.seasonAverage ?? existing?.seasonAverage),
    last5Average: num(pick.last5Average ?? existing?.last5Average),
    last5HitRate: num(pick.last5HitRate ?? existing?.last5HitRate),
    minutesAverage: num(
      pick.minutesAverage ??
        pick.recentMinutes ??
        existing?.minutesAverage
    ),
    fgaAverage: num(pick.fgaAverage ?? pick.recentFGA ?? existing?.fgaAverage),
    ftaAverage: num(pick.ftaAverage ?? pick.recentFTA ?? existing?.ftaAverage),
    sportsProjection: num(
      pick.sportsProjection ?? existing?.sportsProjection
    ),

    snapshotId: pick.snapshotId || existing?.snapshotId || "",
    snapshotTime: pick.snapshotTime || existing?.snapshotTime || "",
    openingLine: num(
      pick.openingLine ?? existing?.openingLine ?? pick.line
    ),
    currentLine: num(
      pick.currentLine ?? existing?.currentLine ?? pick.line
    ),

    dataMode:
      pick.dataMode ||
      existing?.dataMode ||
      pick.playerState?.dataMode ||
      "",
    playerState: pick.playerState || existing?.playerState || null,
    roleChange: pick.roleChange || existing?.roleChange || null,

    fairLine: num(pick.fairLine ?? existing?.fairLine),
    bookLine: num(pick.bookLine ?? existing?.bookLine ?? pick.line),
    fairLineEdge: num(pick.fairLineEdge ?? existing?.fairLineEdge),
    fairLineSide: pick.fairLineSide || existing?.fairLineSide || "NONE",
    fairLineQuality: num(pick.fairLineQuality ?? existing?.fairLineQuality),
    fairLineConfidence: num(
      pick.fairLineConfidence ?? existing?.fairLineConfidence
    ),
    expectedMinutes: num(pick.expectedMinutes ?? existing?.expectedMinutes),
    expectedFGA: num(pick.expectedFGA ?? existing?.expectedFGA),
    expectedFTA: num(pick.expectedFTA ?? existing?.expectedFTA),
    pointsPerFGA: num(pick.pointsPerFGA ?? existing?.pointsPerFGA),
    ftPercent: num(pick.ftPercent ?? existing?.ftPercent),
    baseVolumePoints: num(
      pick.baseVolumePoints ?? existing?.baseVolumePoints
    ),
    projectionAnchor:
      pick.projectionAnchor ?? existing?.projectionAnchor ?? null,
    fairLineReasons: pick.fairLineReasons || existing?.fairLineReasons || [],
    fairLineRiskReasons:
      pick.fairLineRiskReasons || existing?.fairLineRiskReasons || [],
    auditOldSide: pick.auditOldSide || existing?.auditOldSide || "",
    auditSideMatch:
      pick.auditSideMatch ?? existing?.auditSideMatch ?? false,

    boosts: pick.boosts || existing?.boosts || pick.reasons || [],
    penalties: pick.penalties || existing?.penalties || pick.risks || [],
    warnings:
      pick.warnings ||
      existing?.warnings ||
      pick.marketWarnings ||
      pick.riskWarnings ||
      [],

    reasons: pick.reasons || existing?.reasons || [],
    risks: pick.risks || existing?.risks || [],
    marketWarnings: pick.marketWarnings || existing?.marketWarnings || [],
    riskWarnings: pick.riskWarnings || existing?.riskWarnings || [],

    status: String(pick.status || existing?.status || "pending").toLowerCase(),

    createdAt: existing?.createdAt || pick.createdAt || pick.savedAt || now,
    updatedAt: now,
    savedAt: existing?.savedAt || pick.savedAt || existing?.createdAt || now,

    resolvedAt: pick.resolvedAt || existing?.resolvedAt || null,
    gradedAt: pick.gradedAt || existing?.gradedAt || null,

    result: resolvePickStatField(pick, existing, ["result", "actualStat", "actualPoints"]),
    actualStat: resolvePickStatField(pick, existing, [
      "actualStat",
      "actualPoints",
      "finalPoints",
    ]),
    actualPoints: resolvePickStatField(pick, existing, [
      "actualPoints",
      "actualStat",
      "finalPoints",
    ]),
    finalPoints: resolvePickStatField(pick, existing, [
      "finalPoints",
      "actualPoints",
      "actualStat",
    ]),
    resultMargin: num(
      pick.resultMargin ?? pick.margin ?? existing?.resultMargin ?? existing?.margin
    ),
    margin: num(pick.margin ?? pick.resultMargin ?? existing?.margin),
    pendingReason: pick.pendingReason ?? existing?.pendingReason ?? null,
  };

  normalized.confidenceBucket = getConfidenceBucket(normalized.confidence);
  normalized.marketQualityBucket = getMarketQualityBucket(
    normalized.marketQuality
  );
  normalized.bookCountBucket = getBookCountBucket(normalized.bookCount);
  normalized.signalBucket = getSignalBucket(normalized.signalStrength);

  if (!normalized.startTimeDisplay) {
    normalized.startTimeDisplay = getStartTimeDisplay(normalized);
  }

  if (!normalized.gameDate) {
    normalized.gameDate = getGameDate(normalized);
  }

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
    byTeam: {},
    byMarketQualityBucket: {},
    byBookCountBucket: {},
    bySignalStrength: {},
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
    updateBucket(analytics.byTeam, pick.team || "UNKNOWN", status);
    updateBucket(
      analytics.byMarketQualityBucket,
      pick.marketQualityBucket ||
        getMarketQualityBucket(pick.marketQuality),
      status
    );
    updateBucket(
      analytics.byBookCountBucket,
      pick.bookCountBucket || getBookCountBucket(pick.bookCount),
      status
    );
    updateBucket(
      analytics.bySignalStrength,
      pick.signalBucket || getSignalBucket(pick.signalStrength),
      status
    );
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

export function deletePick(id) {
  const picks = readJSON(HISTORY_FILE, []);
  const targetId = String(id || "");

  if (!targetId) return { ok: false, message: "Missing pick id" };

  const nextPicks = picks.filter(
    (pick) => String(pick.id) !== targetId && String(pick.pickKey) !== targetId
  );

  if (nextPicks.length === picks.length) {
    return { ok: false, message: "Pick not found" };
  }

  writeJSON(HISTORY_FILE, nextPicks.map((pick) => normalizePick(pick)));
  persistCalibration(nextPicks);

  return { ok: true, message: "Pick deleted", picks: nextPicks };
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