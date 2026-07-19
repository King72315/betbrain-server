/**
 * CourtEdge analysis cache V1 — batch/cache keys for logs, matchups, injuries, markets.
 * Keys include league, player/team/opponent IDs, season, slate date, line, engine build,
 * evidence schema, and decision packet version.
 */

const store = new Map();
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export const ANALYSIS_CACHE_VERSION = "courtEdgeAnalysisCacheV1";

export function buildAnalysisCacheKey(parts = {}) {
  return [
    ANALYSIS_CACHE_VERSION,
    String(parts.league || "").toUpperCase(),
    String(parts.playerId || parts.canonicalPlayerId || ""),
    String(parts.teamId || parts.canonicalTeamId || ""),
    String(parts.opponentId || ""),
    String(parts.season || ""),
    String(parts.slateDate || ""),
    String(parts.line ?? ""),
    String(parts.engineBuild || ""),
    String(parts.evidenceSchema || ""),
    String(parts.decisionPacketVersion || ""),
    String(parts.bucket || "generic"),
  ].join("|");
}

export function cacheGet(key) {
  const row = store.get(key);
  if (!row) return null;
  if (row.expiresAt && Date.now() > row.expiresAt) {
    store.delete(key);
    return null;
  }
  return row.value;
}

export function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    cachedAt: new Date().toISOString(),
  });
  return value;
}

export function cacheWrap(key, producer, ttlMs = DEFAULT_TTL_MS) {
  const hit = cacheGet(key);
  if (hit !== null && hit !== undefined) return hit;
  const value = typeof producer === "function" ? producer() : producer;
  return cacheSet(key, value, ttlMs);
}

export function clearAnalysisCache() {
  store.clear();
}

export function analysisCacheStats() {
  return { size: store.size, version: ANALYSIS_CACHE_VERSION };
}
