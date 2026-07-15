/**
 * Durable Player Profile cache keyed by playerId/season.
 * Regenerable from game logs; stores adaptive confidence learning state.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { num, clamp, round } from "./playerIntelligenceUtils.js";
import {
  buildPlayerIntelligenceProfile,
  PLAYER_INTELLIGENCE_VERSION,
} from "./playerIntelligenceEngineV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "player-intelligence-cache-v1.json"
);

const memoryCache = new Map();

function cacheKey(playerId, season = "current") {
  return `${String(playerId || "unknown")}|${String(season || "current")}`;
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return { version: PLAYER_INTELLIGENCE_VERSION, profiles: {} };
    }
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      version: raw.version || PLAYER_INTELLIGENCE_VERSION,
      profiles: raw.profiles || {},
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return { version: PLAYER_INTELLIGENCE_VERSION, profiles: {} };
  }
}

function writeStore(store) {
  const payload = {
    ...store,
    version: PLAYER_INTELLIGENCE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, STORE_FILE);
  return payload;
}

export function getStoredPlayerProfile(playerId, season = "current") {
  const key = cacheKey(playerId, season);
  if (memoryCache.has(key)) return memoryCache.get(key);
  const store = readStore();
  const row = store.profiles[key] || null;
  if (row) memoryCache.set(key, row);
  return row;
}

export function savePlayerProfile(profile = {}, season = "current") {
  if (!profile?.playerId) return profile;
  const key = cacheKey(profile.playerId, season || profile.season || "current");
  const store = readStore();
  const entry = {
    ...profile,
    storedAt: new Date().toISOString(),
  };
  store.profiles[key] = entry;
  writeStore(store);
  memoryCache.set(key, entry);
  return entry;
}

/**
 * Build or refresh profile from game logs, blending stored adaptive confidence.
 */
export function getOrBuildPlayerIntelligenceProfile(input = {}, options = {}) {
  const playerId = input.playerId || null;
  const season = input.season || options.season || "current";
  const prior = playerId ? getStoredPlayerProfile(playerId, season) : null;

  const profile = buildPlayerIntelligenceProfile({
    ...input,
    season,
    priorStore: prior,
  });

  if (options.persist !== false && playerId) {
    savePlayerProfile(profile, season);
  }

  return profile;
}

/**
 * After graded props, nudge stored profile confidence / learning rate.
 * High-error volatile profiles harden penalties; stable accurate ones stabilize confidence.
 */
export function updateAdaptiveProfileFromGrade({
  playerId,
  season = "current",
  projectionError = null,
  profileSnapshot = null,
} = {}) {
  if (!playerId) return null;
  const key = cacheKey(playerId, season);
  const store = readStore();
  const existing = store.profiles[key] || profileSnapshot || null;
  if (!existing) return null;

  const err = num(projectionError);
  const learningRate = num(existing.profileLearningRate, 0.5) ?? 0.5;
  let confidence = num(existing.profileConfidence, 50) ?? 50;
  let volatilityIndex = num(existing.volatilityIndex, 50) ?? 50;

  // More games → confidence drifts toward stability (adaptive hardening)
  const games = (num(existing.gradedSampleSize, 0) ?? 0) + 1;
  const harden = clamp(games / (games + 8), 0.05, 0.6);

  if (err !== null) {
    const absErr = Math.abs(err);
    if (absErr >= 6) {
      confidence = confidence - learningRate * 4;
      volatilityIndex = clamp(volatilityIndex + learningRate * 6, 0, 100);
    } else if (absErr <= 2.5) {
      confidence = confidence + (1 - learningRate) * 3 + harden * 2;
      volatilityIndex = clamp(volatilityIndex - harden * 4, 0, 100);
    }
  }

  // As sample accumulates, learning rate decays (profile becomes more stable)
  const nextLearningRate = round(
    clamp(learningRate * (1 - harden * 0.35) + 0.15 * (1 - harden), 0.15, 0.95),
    3
  );

  const updated = {
    ...existing,
    profileConfidence: clamp(Math.round(confidence), 0, 100),
    profileLearningRate: nextLearningRate,
    volatilityIndex: Math.round(volatilityIndex),
    gradedSampleSize: games,
    lastGradeAt: new Date().toISOString(),
    lastProjectionError: err,
  };

  store.profiles[key] = updated;
  writeStore(store);
  memoryCache.set(key, updated);
  return updated;
}

export function clearPlayerIntelligenceMemoryCache() {
  memoryCache.clear();
}

export function getPlayerIntelligenceStorePath() {
  return STORE_FILE;
}
