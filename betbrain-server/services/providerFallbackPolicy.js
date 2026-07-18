/**
 * Explicit CourtEdge provider fallback policy.
 * Verified 2026-07-18 entitlement probe:
 * - Odds: WNBA events + player_points OK; NBA offseason empty
 * - BDL: WNBA teams/players/stats/injuries OK; team_season_averages 404
 * - SportsData: NBA fantasy OK; WNBA scores/stats 401; NBA TeamSeasonStats 401
 * - ESPN: grading fallback only
 */

export const PROVIDER_FALLBACK_POLICY_VERSION = "provider-fallback-policy-v1";

export const PROVIDER_FALLBACK_POLICY = {
  version: PROVIDER_FALLBACK_POLICY_VERSION,
  probedAt: "2026-07-18",
  markets: {
    priority: ["the-odds-api"],
    rules: [
      "Odds API is market authority for lines, prices, books, commence times",
      "Never fabricate a player prop line",
      "Opening line uses internal snapshot when Odds historical opening is not entitled",
    ],
  },
  playerForm: {
    priority: ["balldontlie", "sportsdata-nba-only"],
    rules: [
      "WNBA player form: BDL primary",
      "NBA player form: BDL preferred; SportsData fantasy as secondary when authorized",
      "Do not use SportsData WNBA player stats (401 unauthorized)",
    ],
  },
  teamDefensePace: {
    priority: ["bdl-wnba-games-proxy", "unavailable"],
    rules: [
      "BDL team_season_averages: 404 — do not enable",
      "SportsData WNBA team stats: 401 — do not enable",
      "Use BDL recent final games points-allowed proxy with status CALCULATED / UNAVAILABLE",
      "Missing defense is null + UNAVAILABLE — never fake defenseScore 50 as evidence",
      "Pace from game totals is GAME_TOTAL_PROXY only",
    ],
  },
  availability: {
    priority: ["balldontlie-injuries", "unavailable"],
    rules: [
      "Feed success + no injury row = ACTIVE (not source missing)",
      "Feed failure = explicit UNAVAILABLE/ERROR",
      "SportsData WNBA injuries unauthorized — do not enable",
    ],
  },
  grading: {
    priority: ["balldontlie", "sportsdata-nba", "espn", "pending"],
    rules: [
      "Primary box score: BDL",
      "SportsData NBA when entitled",
      "ESPN last-resort grading fallback",
      "Never silent-merge conflicting actuals",
    ],
  },
  schedule: {
    priority: ["the-odds-api", "balldontlie"],
    rules: [
      "Odds remains market/schedule authority for prop boards",
      "SportsData schedule fallback disabled until WNBA entitlement returns 200",
    ],
  },
  sportsDataWnbaGeneration: {
    enabled: false,
    reason: "Entitlement probe returned 401 for WNBA scores/Teams and related paths",
  },
  bdlTeamSeasonAverages: {
    enabled: false,
    reason: "Entitlement probe returned 404 Route not found for team_season_averages",
  },
};

export function resolveSourceConflict({
  field,
  selected,
  alternate,
  selectedValue,
  alternateValue,
  rule = "prefer_selected",
} = {}) {
  const discrepancy =
    selectedValue !== alternateValue &&
    selectedValue != null &&
    alternateValue != null;

  return {
    field,
    selectedSource: selected,
    alternateSource: alternate || null,
    selectedValue,
    alternateValue: alternate ?? null,
    discrepancy: Boolean(discrepancy),
    resolutionRule: rule,
    sourceTimestamp: new Date().toISOString(),
  };
}
