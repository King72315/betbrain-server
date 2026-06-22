import dotenv from "dotenv";

dotenv.config();

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

  TOP_PROP_LIMIT: num(process.env.TOP_PROP_LIMIT, 8),

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

  NODE_ENV: process.env.NODE_ENV || "development",
};

export function checkConfig() {
  return {
    sportsKeyLoaded: CONFIG.SPORTS_KEY ? "YES" : "NO",
    oddsKeyLoaded: CONFIG.ODDS_KEY ? "YES" : "NO",
    ballKeyLoaded: CONFIG.BALLDONTLIE_KEY ? "YES" : "NO",

    cacheMinutes: CONFIG.CACHE_MINUTES,
    topPropLimit: CONFIG.TOP_PROP_LIMIT,
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

    environment: CONFIG.NODE_ENV,
  };
}