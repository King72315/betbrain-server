import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config(); // also allow process cwd / platform env to override

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const CONFIG = {
  PORT: process.env.PORT || 3000,

  SPORTS_KEY: process.env.SPORTS_KEY || "",
  ODDS_KEY: process.env.ODDS_KEY || "",
  BALLDONTLIE_KEY: process.env.BALLDONTLIE_KEY || "",

  CACHE_MINUTES: num(process.env.CACHE_MINUTES, 30),

  TOP_PROP_LIMIT: num(process.env.TOP_PROP_LIMIT, 2),
  NBA_TOP_PROP_LIMIT: num(process.env.NBA_TOP_PROP_LIMIT, 2),
  WNBA_TOP_PROP_LIMIT: num(process.env.WNBA_TOP_PROP_LIMIT, 2),
  TOP_PROP_COMBINED_LIMIT: num(
    process.env.TOP_PROP_COMBINED_LIMIT,
    num(process.env.NBA_TOP_PROP_LIMIT, 2) + num(process.env.WNBA_TOP_PROP_LIMIT, 2)
  ),

  TIMEZONE: process.env.TIMEZONE || "America/Chicago",

  PREMIUM_CONFIDENCE_MIN: num(process.env.PREMIUM_CONFIDENCE_MIN, 75),
  WATCHLIST_CONFIDENCE_MIN: num(process.env.WATCHLIST_CONFIDENCE_MIN, 60),

  MIN_BOOK_COUNT: num(process.env.MIN_BOOK_COUNT, 2),
  PREMIUM_MIN_BOOK_COUNT: num(process.env.PREMIUM_MIN_BOOK_COUNT, 4),

  MIN_DATA_QUALITY: num(process.env.MIN_DATA_QUALITY, 45),
  PREMIUM_MIN_DATA_QUALITY: num(process.env.PREMIUM_MIN_DATA_QUALITY, 65),

  MIN_MARKET_QUALITY: num(process.env.MIN_MARKET_QUALITY, 40),
  PREMIUM_MIN_MARKET_QUALITY: num(process.env.PREMIUM_MIN_MARKET_QUALITY, 60),

  NBA_ENABLED: process.env.NBA_ENABLED !== "false",
  WNBA_ENABLED: process.env.WNBA_ENABLED !== "false",

  WNBA_SHADOW_RECALIBRATION:
    process.env.WNBA_SHADOW_RECALIBRATION === "true" ||
    process.env.COURTEDGE_WNBA_SHADOW === "true",

  COURTEDGE_WNBA_V1: process.env.COURTEDGE_WNBA_V1 !== "false",

  COURTEDGE_WNBA_V2: process.env.COURTEDGE_WNBA_V2 !== "false",

  /** Attach courtEdgePlayerEvidenceV1 to generated props (additive; safe default ON). */
  COURTEDGE_EVIDENCE_V1_ENABLED:
    process.env.COURTEDGE_EVIDENCE_V1_ENABLED !== "false",

  /** Honest WNBA defense/pace from BDL games proxy — no fake defenseScore 50 (safe default ON). */
  COURTEDGE_WNBA_DEFENSE_V2_ENABLED:
    process.env.COURTEDGE_WNBA_DEFENSE_V2_ENABLED !== "false",

  /**
   * SportsData as WNBA generation secondary — KEEP OFF until live entitlement is 200.
   * Probe 2026-07-18: WNBA scores/Teams returned 401.
   */
  COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED:
    process.env.COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED === "true",

  /**
   * Projection weight recalibration — KEEP OFF until historical replay reviewed.
   * Does not change live weights while false.
   */
  COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED:
    process.env.COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED === "true",

  NODE_ENV: process.env.NODE_ENV || "development",
};

export function checkConfig() {
  return {
    sportsKeyLoaded: CONFIG.SPORTS_KEY ? "YES" : "NO",
    oddsKeyLoaded: CONFIG.ODDS_KEY ? "YES" : "NO",
    ballKeyLoaded: CONFIG.BALLDONTLIE_KEY ? "YES" : "NO",

    cacheMinutes: CONFIG.CACHE_MINUTES,
    topPropLimit: CONFIG.TOP_PROP_LIMIT,
    nbaTopPropLimit: CONFIG.NBA_TOP_PROP_LIMIT,
    wnbaTopPropLimit: CONFIG.WNBA_TOP_PROP_LIMIT,
    topPropCombinedLimit: CONFIG.TOP_PROP_COMBINED_LIMIT,
    timezone: CONFIG.TIMEZONE,

    premiumConfidenceMin: CONFIG.PREMIUM_CONFIDENCE_MIN,
    watchlistConfidenceMin: CONFIG.WATCHLIST_CONFIDENCE_MIN,

    minBookCount: CONFIG.MIN_BOOK_COUNT,
    premiumMinBookCount: CONFIG.PREMIUM_MIN_BOOK_COUNT,

    minDataQuality: CONFIG.MIN_DATA_QUALITY,
    premiumMinDataQuality: CONFIG.PREMIUM_MIN_DATA_QUALITY,

    minMarketQuality: CONFIG.MIN_MARKET_QUALITY,
    premiumMinMarketQuality: CONFIG.PREMIUM_MIN_MARKET_QUALITY,

    nbaEnabled: CONFIG.NBA_ENABLED,
    wnbaEnabled: CONFIG.WNBA_ENABLED,
    wnbaShadowRecalibration: CONFIG.WNBA_SHADOW_RECALIBRATION,
    courteEdgeWnbaV1: CONFIG.COURTEDGE_WNBA_V1,
    courteEdgeWnbaV2: CONFIG.COURTEDGE_WNBA_V2,
    courteEdgeEvidenceV1: CONFIG.COURTEDGE_EVIDENCE_V1_ENABLED,
    courteEdgeWnbaDefenseV2: CONFIG.COURTEDGE_WNBA_DEFENSE_V2_ENABLED,
    courteEdgeWnbaSportsDataSecondary:
      CONFIG.COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED,
    courteEdgeProjectionCalibrationV2:
      CONFIG.COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED,

    environment: CONFIG.NODE_ENV,
  };
}