import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT || 3000,

  SPORTS_KEY: process.env.SPORTS_KEY || "",
  ODDS_KEY: process.env.ODDS_KEY || "",
  BALLDONTLIE_KEY: process.env.BALLDONTLIE_KEY || "",

  CACHE_MINUTES: 30,
};

export function checkConfig() {
  return {
    sportsKeyLoaded: CONFIG.SPORTS_KEY ? "YES" : "NO",
    oddsKeyLoaded: CONFIG.ODDS_KEY ? "YES" : "NO",
    ballKeyLoaded: CONFIG.BALLDONTLIE_KEY ? "YES" : "NO",
  };
}