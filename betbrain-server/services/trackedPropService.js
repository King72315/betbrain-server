import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  fetchFinalPlayerStats,
  getPickDate,
  gradePointsPick,
  isPickGameStarted,
  isPickLikelyFinished,
  resolvePlayerStatForPick,
} from "./resultService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRACKED_FILE = path.join(__dirname, "..", "tracked-props.json");
const BACKUP_FILE = path.join(
  __dirname,
  "..",
  "tracked-props-backup-before-sprint3a.json"
);
const PHASE2_BACKUP_FILE = path.join(
  __dirname,
  "..",
  "tracked-props-backup-before-phase2.json"
);

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

function ensureTrackedFile() {
  if (!fs.existsSync(TRACKED_FILE)) {
    writeJSON(TRACKED_FILE, []);
    return;
  }

  const existing = readJSON(TRACKED_FILE, []);

  if (Array.isArray(existing) && existing.length > 0 && !fs.existsSync(BACKUP_FILE)) {
    writeJSON(BACKUP_FILE, existing);
  }
}

ensureTrackedFile();

function backfillTrackedPropPhase2Fields() {
  const tracked = readJSON(TRACKED_FILE, []);
  if (!Array.isArray(tracked) || tracked.length === 0) return tracked;

  if (!fs.existsSync(PHASE2_BACKUP_FILE)) {
    writeJSON(PHASE2_BACKUP_FILE, tracked);
  }

  let changed = false;

  const next = tracked.map((item) => {
    const commenceTime = item.commenceTime || "";
    const slateDate = item.slateDate || getSlateDateCT(commenceTime);
    const gameLabel = item.gameLabel || item.game || "";
    const supportDangerGap = num(item.supportDangerGap ?? item.netEdge);
    const needsSnapshot =
      !item.signalSnapshot ||
      !item.signalSnapshot.last5Signal ||
      item.signalSnapshot.tier !== undefined;

    const patch = {};

    if (!item.slateDate && slateDate) {
      patch.slateDate = slateDate;
      changed = true;
    }

    if (!item.gameLabel && gameLabel) {
      patch.gameLabel = gameLabel;
      changed = true;
    }

    if (item.supportDangerGap === undefined || item.supportDangerGap === null) {
      patch.supportDangerGap = supportDangerGap;
      patch.supportDangerGapBucket = getSupportDangerGapBucket(supportDangerGap);
      changed = true;
    }

    if (needsSnapshot) {
      patch.signalSnapshot = buildSignalSnapshot(item, {
        ...item,
        ...patch,
        supportDangerGap,
      });
      changed = true;
    }

    if (!item.projection && item.fairLine) {
      patch.projection = num(item.fairLine);
      changed = true;
    }

    if (Object.keys(patch).length === 0) return item;

    return { ...item, ...patch };
  });

  if (changed) {
    writeJSON(TRACKED_FILE, next);
  }

  return next;
}

backfillTrackedPropPhase2Fields();

function getGameDate(pick = {}) {
  const source =
    pick.gameDate ||
    pick.date ||
    pick.commenceTime ||
    pick.time ||
    null;

  if (!source) return "";

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

export function getSlateDateCT(commenceTime) {
  const source = commenceTime || "";

  if (!source) return "";

  const parsed = new Date(source);

  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}

export function isOfficialTrackablePick(pick = {}) {
  if (!pick?.player) return false;
  if (pick.noPlay) return false;
  if (pick.isStarted) return false;
  if (pick.trustable === false) return false;

  const tier = String(pick.tier || "").toUpperCase();
  if (tier === "LEAN") return false;
  if (tier === "WATCHLIST") return false;

  return true;
}

function normalizeEngineSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "Over";
  if (raw === "UNDER" || raw === "U") return "Under";
  return "";
}

function normalizeFairSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER") return "OVER";
  if (raw === "UNDER") return "UNDER";
  return "NONE";
}

export function getTrackedPropKey(pick = {}) {
  const currentEngineSide = normalizeEngineSide(pick.side || pick.pick);
  const line = num(pick.line ?? pick.sportsbookLine);

  return [
    pick.league || "",
    getGameDate(pick),
    pick.player || "",
    pick.team || "",
    pick.opponent || "",
    pick.stat || "Points",
    line,
    currentEngineSide,
  ]
    .map(clean)
    .join("-");
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

function getFairLineEdgeBucket(edge = 0) {
  const value = num(edge);
  const abs = Math.abs(value);
  if (abs >= 4) return "4+";
  if (abs >= 2.5) return "2.5-3.9";
  if (abs >= 1.5) return "1.5-2.4";
  return "Under 1.5";
}

function getSupportDangerGapBucket(gap = 0) {
  const value = num(gap);
  if (value >= 20) return "20+";
  if (value >= 10) return "10-19";
  if (value >= 5) return "5-9";
  return "Under 5";
}

function getProjectionEdgeBucket(projection, line) {
  const proj = num(projection);
  const bookLine = num(line);
  if (!proj || !bookLine) return "not enough data";
  const edge = Math.abs(proj - bookLine);
  if (edge >= 4) return "4+";
  if (edge >= 2.5) return "2.5-3.9";
  if (edge >= 1.5) return "1.5-2.4";
  return "Under 1.5";
}

function sideSupportsValue(side = "", value = 0, line = 0, threshold = 1) {
  const sideNorm = normalizeEngineSide(side);
  if (!sideNorm || !Number.isFinite(value) || !Number.isFinite(line)) {
    return "not enough data";
  }
  if (sideNorm === "Over") {
    if (value > line + threshold) return "supports_side";
    if (value < line - threshold) return "opposes_side";
    return "neutral";
  }
  if (value < line - threshold) return "supports_side";
  if (value > line + threshold) return "opposes_side";
  return "neutral";
}

function textMatches(list = [], pattern) {
  return list.some((item) => pattern.test(String(item || "")));
}

function buildSignalSnapshot(pick = {}, fields = {}) {
  const ps = pick.playerState || {};
  const side = pick.side || pick.pick || fields.currentEngineSide || "";
  const line = num(pick.line ?? pick.sportsbookLine ?? fields.line);
  const supportReasons = [
    ...(pick.support || pick.supportReasons || fields.supportReasons || []),
  ];
  const dangerReasons = [
    ...(pick.resistance || pick.dangerReasons || fields.dangerReasons || []),
  ];
  const warningReasons = [
    ...(pick.warnings || pick.warningReasons || fields.warningReasons || []),
  ];
  const roleChange = pick.roleChange || fields.roleChange || {};
  const projection =
    pick.projection ??
    pick.sportsProjection ??
    ps.sportsProjection ??
    fields.projection ??
    null;
  const supportDangerGap = num(
    pick.supportDangerGap ?? pick.netEdge ?? fields.supportDangerGap ?? fields.netEdge
  );
  const confidence = num(
    pick.confidence ?? pick.winProbability ?? fields.confidence
  );

  let last5Signal = "not enough data";
  const last5Avg = num(pick.last5Average ?? ps.recentPoints);
  if (last5Avg && line) {
    last5Signal = sideSupportsValue(side, last5Avg, line);
  } else if (textMatches(supportReasons, /recent|last 5|last five/i)) {
    last5Signal = "supports_side";
  } else if (textMatches(dangerReasons, /recent|last 5|last five/i)) {
    last5Signal = "opposes_side";
  }

  let seasonAverageSignal = "not enough data";
  const seasonAvg = num(pick.seasonAverage ?? ps.seasonPoints);
  if (seasonAvg && line) {
    seasonAverageSignal = sideSupportsValue(side, seasonAvg, line);
  } else if (textMatches(supportReasons, /season average|season scoring/i)) {
    seasonAverageSignal = "supports_side";
  }

  let h2hSignal = "not enough data";
  const flags = ps.dataAvailabilityFlags || {};
  const matchupAvg = pick.matchupAverage ?? ps.matchupAverage;
  if (matchupAvg !== null && matchupAvg !== undefined && line) {
    h2hSignal = sideSupportsValue(side, num(matchupAvg), line);
  } else if (flags.hasMatchupHistory === false) {
    h2hSignal = "not enough data";
  } else if (textMatches(supportReasons, /h2h|head.to.head|matchup history/i)) {
    h2hSignal = "supports_side";
  } else if (textMatches(dangerReasons, /h2h|head.to.head|matchup history/i)) {
    h2hSignal = "opposes_side";
  }

  let opponentDefenseSignal = "not enough data";
  if (
    textMatches(supportReasons, /opponent|defense|matchup/i) &&
    !textMatches(dangerReasons, /opponent|defense|matchup/i)
  ) {
    opponentDefenseSignal = "supportive";
  } else if (textMatches(dangerReasons, /opponent|defense|matchup/i)) {
    opponentDefenseSignal = "resistance";
  } else if (pick.opponentMatchup?.resistanceSignal) {
    opponentDefenseSignal = String(pick.opponentMatchup.resistanceSignal);
  }

  let usageMinutesSignal = "not enough data";
  const expectedMinutes = num(pick.expectedMinutes ?? fields.expectedMinutes);
  const seasonMinutes = num(ps.seasonMinutes);
  const recentMinutes = num(ps.recentMinutes);
  if (expectedMinutes && seasonMinutes) {
    if (expectedMinutes >= seasonMinutes + 2) usageMinutesSignal = "minutes_up";
    else if (expectedMinutes <= seasonMinutes - 2) usageMinutesSignal = "minutes_down";
    else usageMinutesSignal = "stable";
  } else if (roleChange.recentMinutesTrend) {
    usageMinutesSignal = String(roleChange.recentMinutesTrend).toLowerCase();
  } else if (recentMinutes && seasonMinutes) {
    if (recentMinutes >= seasonMinutes + 2) usageMinutesSignal = "minutes_up";
    else if (recentMinutes <= seasonMinutes - 2) usageMinutesSignal = "minutes_down";
    else usageMinutesSignal = "stable";
  }

  let injuryAvailabilitySignal = "not enough data";
  if (
    textMatches(dangerReasons, /injury|questionable|limited|availability/i) ||
    textMatches(warningReasons, /injury|questionable|limited/i)
  ) {
    injuryAvailabilitySignal = "availability_risk";
  } else if (roleChange.teammateOutBoost) {
    injuryAvailabilitySignal = "teammate_out_boost";
  } else if (textMatches(supportReasons, /minutes are playable|availability/i)) {
    injuryAvailabilitySignal = "clear";
  }

  let homeAwaySignal = "not enough data";
  if (textMatches(supportReasons, /home floor|home game|at home/i)) {
    homeAwaySignal = "home_support";
  } else if (textMatches(dangerReasons, /road|away|travel/i)) {
    homeAwaySignal = "away_risk";
  }

  let restTravelSignal = "not enough data";
  if (textMatches(dangerReasons, /back.to.back|rest|travel|fatigue/i)) {
    restTravelSignal = "rest_travel_risk";
  } else if (textMatches(supportReasons, /rest|fresh/i)) {
    restTravelSignal = "rest_support";
  }

  let paceSignal = "not enough data";
  if (textMatches(supportReasons, /pace|tempo|fast/i)) {
    paceSignal = "pace_support";
  } else if (textMatches(dangerReasons, /slow pace|pace/i)) {
    paceSignal = "pace_risk";
  }

  let marketSignal = "not enough data";
  const bookCount = num(pick.bookCount ?? fields.bookCount);
  const marketQuality = num(pick.marketQuality ?? fields.marketQuality);
  if (bookCount >= 5 && marketQuality >= 65) marketSignal = "strong_market";
  else if (bookCount >= 3 && marketQuality >= 50) marketSignal = "adequate_market";
  else if (bookCount > 0 || marketQuality > 0) marketSignal = "weak_market";

  return {
    last5Signal,
    seasonAverageSignal,
    h2hSignal,
    opponentDefenseSignal,
    usageMinutesSignal,
    injuryAvailabilitySignal,
    homeAwaySignal,
    restTravelSignal,
    paceSignal,
    marketSignal,
    supportDangerGapBucket: getSupportDangerGapBucket(supportDangerGap),
    confidenceBucket: getConfidenceBucket(confidence),
    projectionEdgeBucket: getProjectionEdgeBucket(projection, line),
    tier: pick.tier || fields.tier || "",
    signalStrength: pick.signalStrength || fields.signalStrength || "",
    riskLabel: pick.riskLabel || fields.riskLabel || "",
    fairLineSide: normalizeFairSide(pick.fairLineSide ?? fields.fairLineSide),
    auditSideMatch: Boolean(pick.auditSideMatch ?? fields.auditSideMatch),
  };
}

function getRoleChangeScoreBucket(score = 0) {
  const value = num(score);
  if (value >= 80) return "80+";
  if (value >= 65) return "65-79";
  if (value >= 50) return "50-64";
  return "Under 50";
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function mapPickToTrackedFields(pick = {}) {
  const currentEngineSide = normalizeEngineSide(pick.side || pick.pick);
  const fairLineSide = normalizeFairSide(pick.fairLineSide);
  const commenceTime = pick.commenceTime || pick.time || "";
  const supportScore = num(pick.supportScore);
  const resistanceScore = num(pick.resistanceScore ?? pick.dangerScore);
  const netEdge = num(pick.netEdge ?? pick.gap);
  const ps = pick.playerState || {};
  const projection =
    pick.projection ??
    pick.sportsProjection ??
    ps.sportsProjection ??
    null;

  const baseFields = {
    source: "AUTO_TRACKED",
    league: pick.league || "",
    gameId: pick.gameId || pick.game || "",
    gameLabel: pick.game || pick.gameLabel || "",
    gameDate: getGameDate(pick),
    slateDate: pick.slateDate || getSlateDateCT(commenceTime),
    commenceTime,
    startTimeDisplay: pick.startTimeDisplay || "",
    dayBucket: pick.dayBucket || pick.dateLabel || "",
    player: pick.player || "",
    playerId: pick.playerId || pick.playerState?.playerId || "",
    team: pick.team || "",
    opponent: pick.opponent || "",
    stat: pick.stat || "Points",
    line: num(pick.line ?? pick.sportsbookLine),
    currentEngineSide,
    fairLineSide,
    auditSideMatch: Boolean(pick.auditSideMatch),
    confidence: num(pick.confidence ?? pick.winProbability),
    riskLabel: pick.riskLabel || "",
    tier: pick.tier || "",
    signalStrength: pick.signalStrength || "",
    supportScore,
    resistanceScore,
    netEdge,
    supportDangerGap: num(pick.supportDangerGap ?? netEdge),
    projection: projection !== null ? num(projection) : null,
    last5Average: num(pick.last5Average ?? ps.recentPoints) || null,
    seasonAverage: num(pick.seasonAverage ?? ps.seasonPoints) || null,
    matchupAverage:
      pick.matchupAverage ?? ps.matchupAverage ?? null,
    dataCoverage: num(pick.dataCoverage),
    dataQuality: num(pick.dataQuality),
    evidenceReliability: num(pick.evidenceReliability),
    dangerPressure: num(pick.dangerPressure),
    bookCount: num(pick.bookCount),
    marketQuality: num(pick.marketQuality),
    lineSpread: num(pick.lineSpread),
    overOdds: num(pick.overOdds),
    underOdds: num(pick.underOdds),
    playerState: pick.playerState || null,
    roleChange: pick.roleChange || null,
    dataMode: pick.dataMode || pick.playerState?.dataMode || "",
    fairLine: num(pick.fairLine),
    fairLineEdge: num(pick.fairLineEdge),
    fairLineQuality: num(pick.fairLineQuality),
    fairLineConfidence: num(pick.fairLineConfidence),
    expectedMinutes: num(pick.expectedMinutes),
    expectedFGA: num(pick.expectedFGA),
    expectedFTA: num(pick.expectedFTA),
    pointsPerFGA: num(pick.pointsPerFGA),
    ftPercent: num(pick.ftPercent),
    supportReasons: pick.support || pick.reasons || [],
    dangerReasons: pick.resistance || pick.risks || [],
    warningReasons: pick.warnings || pick.marketWarnings || pick.riskWarnings || [],
    confidenceAdjustmentReasons: pick.confidenceAdjustmentReasons || [],
    tierReasons: pick.tierReasons || [],
    fairLineReasons: pick.fairLineReasons || [],
    fairLineRiskReasons: pick.fairLineRiskReasons || [],
    rank: num(pick.rank),
    pickScore: num(pick.pickScore),
    roleChangeScore: num(pick.roleChange?.roleChangeScore),
    confidenceBucket: getConfidenceBucket(pick.confidence ?? pick.winProbability),
    marketQualityBucket: getMarketQualityBucket(pick.marketQuality),
    bookCountBucket: getBookCountBucket(pick.bookCount),
    fairLineEdgeBucket: getFairLineEdgeBucket(pick.fairLineEdge),
    supportDangerGapBucket: getSupportDangerGapBucket(
      pick.supportDangerGap ?? netEdge
    ),
    roleChangeScoreBucket: getRoleChangeScoreBucket(
      pick.roleChange?.roleChangeScore
    ),
  };

  return {
    ...baseFields,
    signalSnapshot: buildSignalSnapshot(pick, baseFields),
  };
}

function buildSideComparison({
  fairLineSide = "NONE",
  currentEngineResult = null,
  fairLineShadowResult = null,
  auditSideMatch = false,
} = {}) {
  if (fairLineSide === "NONE") {
    return "FAIR_NONE";
  }

  if (!currentEngineResult || !fairLineShadowResult) {
    return auditSideMatch ? "MATCH" : null;
  }

  const currentWon = currentEngineResult === "win";
  const fairWon = fairLineShadowResult === "win";
  const currentLost = currentEngineResult === "loss";
  const fairLost = fairLineShadowResult === "loss";

  if (currentWon && fairWon) return "BOTH_WON";
  if (currentLost && fairLost) return "BOTH_LOST";
  if (currentWon && fairLost) return "CURRENT_WON_FAIR_LOST";
  if (currentLost && fairWon) return "FAIR_WON_CURRENT_LOST";

  if (auditSideMatch) return "MATCH";

  return null;
}

function gradeEngineSide(tracked, statResult, side) {
  const graded = gradePointsPick(
    {
      ...tracked,
      side,
      pick: side,
      line: tracked.line,
      league: tracked.league,
      player: tracked.player,
      team: tracked.team,
    },
    statResult
  );

  return {
    result: graded.status,
    won: graded.status === "win",
    margin: num(graded.resultMargin ?? graded.margin),
    actualStat: num(graded.actualStat ?? graded.actualPoints),
    pendingReason: graded.pendingReason || null,
  };
}

function gradeTrackedProp(tracked, statResult, options = {}) {
  if (!statResult) {
    return {
      ...tracked,
      status: "pending",
      pendingReason:
        options.pendingReason ||
        tracked.pendingReason ||
        "No exact game stat match found for pick date and league",
      actualStat: null,
      result: null,
      resultMargin: null,
      sideComparison: buildSideComparison({
        fairLineSide: tracked.fairLineSide,
        auditSideMatch: tracked.auditSideMatch,
      }),
    };
  }

  const current = gradeEngineSide(tracked, statResult, tracked.currentEngineSide);

  let fairShadow = {
    result: null,
    won: false,
    margin: 0,
  };

  if (tracked.fairLineSide === "OVER" || tracked.fairLineSide === "UNDER") {
    const shadowSide =
      tracked.fairLineSide === "OVER" ? "Over" : "Under";
    fairShadow = gradeEngineSide(tracked, statResult, shadowSide);
  }

  const gradedAt = new Date().toISOString();
  const sideComparison = buildSideComparison({
    fairLineSide: tracked.fairLineSide,
    currentEngineResult: current.result,
    fairLineShadowResult: fairShadow.result,
    auditSideMatch: tracked.auditSideMatch,
  });

  return {
    ...tracked,
    status: current.result || "pending",
    actualStat: current.actualStat,
    result: current.actualStat,
    resultMargin: current.margin,
    gradedAt,
    resolvedAt: gradedAt,
    pendingReason: current.pendingReason,
    currentEngineResult: current.result,
    currentEngineWon: current.won,
    currentEngineMargin: current.margin,
    fairLineShadowResult: fairShadow.result,
    fairLineShadowWon: fairShadow.won,
    fairLineShadowMargin: fairShadow.margin,
    sideComparison,
  };
}

function normalizeTrackedProp(pick = {}, existing = null) {
  const now = new Date().toISOString();
  const fields = mapPickToTrackedFields(pick);
  const trackedKey = getTrackedPropKey(pick);

  return {
    ...existing,
    ...fields,
    trackedId: existing?.trackedId || trackedKey,
    trackedKey,
    generatedAt: existing?.generatedAt || now,
    lastSeenAt: now,
    timesSeen: existing ? num(existing.timesSeen) : 1,
    status: existing?.status || "pending",
    actualStat: existing?.actualStat ?? null,
    result: existing?.result ?? null,
    resultMargin: existing?.resultMargin ?? null,
    gradedAt: existing?.gradedAt ?? null,
    pendingReason: existing?.pendingReason ?? null,
    currentEngineResult: existing?.currentEngineResult ?? null,
    currentEngineWon: existing?.currentEngineWon ?? null,
    currentEngineMargin: existing?.currentEngineMargin ?? null,
    fairLineShadowResult: existing?.fairLineShadowResult ?? null,
    fairLineShadowWon: existing?.fairLineShadowWon ?? null,
    fairLineShadowMargin: existing?.fairLineShadowMargin ?? null,
    sideComparison:
      existing?.sideComparison ??
      buildSideComparison({
        fairLineSide: fields.fairLineSide,
        auditSideMatch: fields.auditSideMatch,
      }),
  };
}

export function addTrackedProps(picks = []) {
  const incoming = (Array.isArray(picks) ? picks : [picks]).filter(
    isOfficialTrackablePick
  );
  const tracked = readJSON(TRACKED_FILE, []);
  const indexByKey = new Map(
    tracked.map((item, index) => [item.trackedKey || getTrackedPropKey(item), index])
  );

  for (const pick of incoming) {
    if (!pick?.player) continue;

    const trackedKey = getTrackedPropKey(pick);
    const existingIndex = indexByKey.get(trackedKey);

    if (existingIndex !== undefined) {
      const existing = tracked[existingIndex];
      tracked[existingIndex] = normalizeTrackedProp(pick, {
        ...existing,
        timesSeen: num(existing.timesSeen) + 1,
      });
    } else {
      const normalized = normalizeTrackedProp(pick);
      normalized.timesSeen = 1;
      indexByKey.set(trackedKey, tracked.length);
      tracked.push(normalized);
    }
  }

  writeJSON(TRACKED_FILE, tracked);
  return tracked;
}

export function getTrackedProps() {
  return readJSON(TRACKED_FILE, []);
}

export function deleteTrackedProp(id) {
  const targetId = String(id || "");
  if (!targetId) return { ok: false, message: "Missing tracked prop id" };

  const tracked = readJSON(TRACKED_FILE, []);
  const next = tracked.filter(
    (item) =>
      String(item.trackedId) !== targetId &&
      String(item.trackedKey) !== targetId
  );

  if (next.length === tracked.length) {
    return { ok: false, message: "Tracked prop not found" };
  }

  writeJSON(TRACKED_FILE, next);
  return { ok: true, message: "Tracked prop deleted", props: next };
}

export function clearTrackedProps() {
  const existing = readJSON(TRACKED_FILE, []);

  if (existing.length > 0 && !fs.existsSync(BACKUP_FILE)) {
    writeJSON(BACKUP_FILE, existing);
  }

  writeJSON(TRACKED_FILE, []);
  return { ok: true, message: "Tracked props cleared", props: [] };
}

export async function resolveTrackedProps(options = {}) {
  const requireLikelyFinished = Boolean(options.requireLikelyFinished);
  const isReadyToGrade = requireLikelyFinished
    ? isPickLikelyFinished
    : isPickGameStarted;

  const tracked = getTrackedProps();
  const pending = tracked.filter(
    (item) => !isResolvedStatus(item.status)
  );
  const gradeable = pending.filter((item) => isReadyToGrade(item));

  const statsCache = new Map();

  for (const item of gradeable) {
    const pickDate = getPickDate(item);
    const league = String(item.league || "NBA").toUpperCase();
    const cacheKey = `${league}:${pickDate || "unknown"}`;

    if (!statsCache.has(cacheKey)) {
      const stats = await fetchFinalPlayerStats(
        pickDate ? new Date(`${pickDate}T12:00:00Z`) : new Date(),
        { league }
      );
      statsCache.set(cacheKey, stats);
    }
  }

  let gradedCount = 0;
  let skippedNotReady = 0;
  let stillPending = 0;

  const updated = [];

  for (const item of tracked) {
    if (isResolvedStatus(item.status)) {
      updated.push(item);
      continue;
    }

    if (!isReadyToGrade(item)) {
      skippedNotReady += 1;
      updated.push(item);
      continue;
    }

    const pickDate = getPickDate(item);
    const league = String(item.league || "NBA").toUpperCase();
    const cacheKey = `${league}:${pickDate || "unknown"}`;
    const playerStats = statsCache.get(cacheKey) || [];

    const { statResult, pendingReason } = await resolvePlayerStatForPick(
      item,
      playerStats
    );
    const graded = gradeTrackedProp(item, statResult, { pendingReason });

    if (isResolvedStatus(graded.status)) {
      gradedCount += 1;
    } else {
      stillPending += 1;
    }

    updated.push(graded);
  }

  writeJSON(TRACKED_FILE, updated);

  return {
    props: updated,
    summary: {
      pendingTotal: pending.length,
      gradeable: gradeable.length,
      gradedCount,
      skippedNotReady,
      stillPending,
      requireLikelyFinished,
    },
  };
}

function updateBucket(bucket = {}, key = "UNKNOWN", field = "total", amount = 1) {
  if (!bucket[key]) {
    bucket[key] = {
      total: 0,
      pending: 0,
      graded: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      accuracy: 0,
      shadowWins: 0,
      shadowLosses: 0,
      shadowAccuracy: 0,
    };
  }

  bucket[key][field] = num(bucket[key][field]) + amount;
  return bucket;
}

function finalizeBucket(bucket = {}) {
  for (const key of Object.keys(bucket)) {
    const gradedTotal = bucket[key].wins + bucket[key].losses;
    bucket[key].accuracy =
      gradedTotal > 0
        ? Number(((bucket[key].wins / gradedTotal) * 100).toFixed(1))
        : 0;

    const shadowGraded = bucket[key].shadowWins + bucket[key].shadowLosses;
    bucket[key].shadowAccuracy =
      shadowGraded > 0
        ? Number(((bucket[key].shadowWins / shadowGraded) * 100).toFixed(1))
        : 0;
  }

  return bucket;
}

export function buildTrackedPropAnalytics(props = getTrackedProps()) {
  const analytics = {
    overall: {
      total: props.length,
      pending: 0,
      graded: 0,
      currentEngine: { wins: 0, losses: 0, pushes: 0, accuracy: 0 },
      fairLineShadow: { wins: 0, losses: 0, pushes: 0, accuracy: 0 },
      sideComparison: {},
      auditSideMatch: { match: 0, mismatch: 0 },
    },
    byCurrentEngineSide: {},
    byFairLineSide: {},
    byAuditSideMatch: {},
    byRiskLabel: {},
    byTier: {},
    byLeague: {},
    byDataMode: {},
    byMarketQualityBucket: {},
    byBookCountBucket: {},
    byFairLineEdgeBucket: {},
    byRoleChangeScoreBucket: {},
    byConfidenceBucket: {},
    byPlayer: {},
    byTeam: {},
    bySideComparison: {},
    engineVsShadow: {
      currentEngineBetter: 0,
      fairLineBetter: 0,
      bothWon: 0,
      bothLost: 0,
      tied: 0,
    },
  };

  for (const prop of props) {
    const status = String(prop.status || "pending").toLowerCase();
    const resolved = isResolvedStatus(status);

    if (!resolved) {
      analytics.overall.pending += 1;
    } else {
      analytics.overall.graded += 1;

      if (status === "win") analytics.overall.currentEngine.wins += 1;
      if (status === "loss") analytics.overall.currentEngine.losses += 1;
      if (status === "push") analytics.overall.currentEngine.pushes += 1;

      const shadow = String(prop.fairLineShadowResult || "").toLowerCase();
      if (shadow === "win") analytics.overall.fairLineShadow.wins += 1;
      if (shadow === "loss") analytics.overall.fairLineShadow.losses += 1;
      if (shadow === "push") analytics.overall.fairLineShadow.pushes += 1;
    }

    if (prop.auditSideMatch) {
      analytics.overall.auditSideMatch.match += 1;
    } else if (prop.fairLineSide !== "NONE") {
      analytics.overall.auditSideMatch.mismatch += 1;
    }

    const comparison = prop.sideComparison || "UNKNOWN";
    analytics.overall.sideComparison[comparison] =
      num(analytics.overall.sideComparison[comparison]) + 1;
    updateBucket(analytics.bySideComparison, comparison, "total", 1);

    if (resolved) {
      updateBucket(analytics.bySideComparison, comparison, "graded", 1);
      if (status === "win") {
        updateBucket(analytics.bySideComparison, comparison, "wins", 1);
      }
      if (status === "loss") {
        updateBucket(analytics.bySideComparison, comparison, "losses", 1);
      }
      if (prop.fairLineShadowResult === "win") {
        updateBucket(analytics.bySideComparison, comparison, "shadowWins", 1);
      }
      if (prop.fairLineShadowResult === "loss") {
        updateBucket(analytics.bySideComparison, comparison, "shadowLosses", 1);
      }

      const currentWon = prop.currentEngineWon === true;
      const fairWon = prop.fairLineShadowWon === true;
      const currentLost = prop.currentEngineResult === "loss";
      const fairLost = prop.fairLineShadowResult === "loss";

      if (currentWon && !fairWon) analytics.engineVsShadow.currentEngineBetter += 1;
      else if (fairWon && !currentWon) analytics.engineVsShadow.fairLineBetter += 1;
      else if (currentWon && fairWon) analytics.engineVsShadow.bothWon += 1;
      else if (currentLost && fairLost) analytics.engineVsShadow.bothLost += 1;
      else analytics.engineVsShadow.tied += 1;
    }

    const bucketFields = [
      ["byCurrentEngineSide", prop.currentEngineSide || "UNKNOWN"],
      ["byFairLineSide", prop.fairLineSide || "NONE"],
      [
        "byAuditSideMatch",
        prop.auditSideMatch ? "MATCH" : prop.fairLineSide === "NONE" ? "FAIR_NONE" : "MISMATCH",
      ],
      ["byRiskLabel", prop.riskLabel || "UNKNOWN"],
      ["byTier", prop.tier || "UNKNOWN"],
      ["byLeague", prop.league || "UNKNOWN"],
      ["byDataMode", prop.dataMode || "UNKNOWN"],
      ["byMarketQualityBucket", prop.marketQualityBucket || getMarketQualityBucket(prop.marketQuality)],
      ["byBookCountBucket", prop.bookCountBucket || getBookCountBucket(prop.bookCount)],
      ["byFairLineEdgeBucket", prop.fairLineEdgeBucket || getFairLineEdgeBucket(prop.fairLineEdge)],
      [
        "byRoleChangeScoreBucket",
        prop.roleChangeScoreBucket ||
          getRoleChangeScoreBucket(prop.roleChangeScore),
      ],
      [
        "byConfidenceBucket",
        prop.confidenceBucket || getConfidenceBucket(prop.confidence),
      ],
      ["byPlayer", prop.player || "UNKNOWN"],
      ["byTeam", prop.team || "UNKNOWN"],
    ];

    for (const [bucketName, key] of bucketFields) {
      updateBucket(analytics[bucketName], key, "total", 1);
      if (!resolved) {
        updateBucket(analytics[bucketName], key, "pending", 1);
        continue;
      }

      updateBucket(analytics[bucketName], key, "graded", 1);
      if (status === "win") updateBucket(analytics[bucketName], key, "wins", 1);
      if (status === "loss") updateBucket(analytics[bucketName], key, "losses", 1);
      if (status === "push") updateBucket(analytics[bucketName], key, "pushes", 1);
      if (prop.fairLineShadowResult === "win") {
        updateBucket(analytics[bucketName], key, "shadowWins", 1);
      }
      if (prop.fairLineShadowResult === "loss") {
        updateBucket(analytics[bucketName], key, "shadowLosses", 1);
      }
    }
  }

  const currentGraded =
    analytics.overall.currentEngine.wins + analytics.overall.currentEngine.losses;
  analytics.overall.currentEngine.accuracy =
    currentGraded > 0
      ? Number(
          (
            (analytics.overall.currentEngine.wins / currentGraded) *
            100
          ).toFixed(1)
        )
      : 0;

  const shadowGraded =
    analytics.overall.fairLineShadow.wins +
    analytics.overall.fairLineShadow.losses;
  analytics.overall.fairLineShadow.accuracy =
    shadowGraded > 0
      ? Number(
          (
            (analytics.overall.fairLineShadow.wins / shadowGraded) *
            100
          ).toFixed(1)
        )
      : 0;

  for (const bucketName of [
    "byCurrentEngineSide",
    "byFairLineSide",
    "byAuditSideMatch",
    "byRiskLabel",
    "byTier",
    "byLeague",
    "byDataMode",
    "byMarketQualityBucket",
    "byBookCountBucket",
    "byFairLineEdgeBucket",
    "byRoleChangeScoreBucket",
    "byConfidenceBucket",
    "byPlayer",
    "byTeam",
    "bySideComparison",
  ]) {
    analytics[bucketName] = finalizeBucket(analytics[bucketName]);
  }

  analytics.updatedAt = new Date().toISOString();
  return analytics;
}
