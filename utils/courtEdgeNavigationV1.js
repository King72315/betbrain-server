/**
 * CourtEdge bottom-navigation contract V1.
 * Source of truth for product tabs (kept separate from expo-router UI).
 */
export const COURTEDGE_BOTTOM_TAB_TITLES_V1 = Object.freeze([
  "Home",
  "Results",
  "Lab",
  "History",
]);

export const COURTEDGE_BOTTOM_TAB_ROUTE_NAMES_V1 = Object.freeze([
  "index",
  "results",
  "prop-lab",
  "history",
]);

export const COURTEDGE_FORBIDDEN_BOTTOM_TAB_TITLES_V1 = Object.freeze([
  "WNBA",
  "Tennis",
  "TENNIS",
  "NBA",
]);

export const COURTEDGE_FORBIDDEN_BOTTOM_TAB_ROUTES_V1 = Object.freeze([
  "wnba",
  "tennis-results",
  "nba",
]);

export const COURTEDGE_HOME_LEAGUE_SELECTORS_V1 = Object.freeze(["NBA", "WNBA"]);

export const COURTEDGE_HOME_DATE_SELECTORS_V1 = Object.freeze([
  "Today",
  "Tomorrow",
]);

export const COURTEDGE_HOME_PROP_FILTERS_V1 = Object.freeze([
  "ALL",
  "POINTS",
  "REBOUNDS",
  "ASSISTS",
]);

export function assertCourtEdgeBottomNavContractV1(visibleTabs = []) {
  const titles = (visibleTabs || []).map((t) =>
    String(t.title || t.name || t).trim()
  );
  const forbidden = COURTEDGE_FORBIDDEN_BOTTOM_TAB_TITLES_V1.filter((t) =>
    titles.some((x) => x.toUpperCase() === String(t).toUpperCase())
  );
  const missing = COURTEDGE_BOTTOM_TAB_TITLES_V1.filter(
    (t) => !titles.some((x) => x.toUpperCase() === String(t).toUpperCase())
  );
  return {
    ok: forbidden.length === 0 && missing.length === 0,
    titles,
    forbidden,
    missing,
    expected: [...COURTEDGE_BOTTOM_TAB_TITLES_V1],
  };
}
