/**
 * Home presentation-only propType filter.
 * Does NOT alter Official membership — display subset only.
 */

export const PROP_TYPE_DISPLAY_FILTERS = Object.freeze([
  { key: "ALL", label: "ALL" },
  { key: "POINTS", label: "POINTS" },
  { key: "REBOUNDS", label: "REBOUNDS" },
  { key: "ASSISTS", label: "ASSISTS" },
]);

export function resolveDisplayPropTypeFilter(filter = "ALL") {
  const f = String(filter || "ALL").toUpperCase();
  if (f === "POINTS" || f === "REBOUNDS" || f === "ASSISTS") return f;
  return "ALL";
}

export function normalizePickPropType(pick = {}) {
  const raw = String(
    pick.propType || pick.canonicalPropType || pick.stat || "POINTS"
  ).toUpperCase();
  if (raw.includes("REBOUND")) return "REBOUNDS";
  if (raw.includes("ASSIST")) return "ASSISTS";
  if (raw.includes("POINT")) return "POINTS";
  return "POINTS";
}

export function filterPicksByPropTypePresentation(picks = [], filter = "ALL") {
  const f = resolveDisplayPropTypeFilter(filter);
  if (f === "ALL") return Array.isArray(picks) ? picks : [];
  return (picks || []).filter((p) => normalizePickPropType(p) === f);
}
