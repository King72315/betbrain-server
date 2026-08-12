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

export function normalizePickPropType(pickOrRaw = {}) {
  const raw = String(
    typeof pickOrRaw === "string"
      ? pickOrRaw
      : pickOrRaw?.propType ||
          pickOrRaw?.canonicalPropType ||
          pickOrRaw?.stat ||
          "POINTS"
  ).toUpperCase();
  if (raw.includes("REBOUND")) return "REBOUNDS";
  if (raw.includes("ASSIST")) return "ASSISTS";
  if (raw.includes("POINT")) return "POINTS";
  return "POINTS";
}

/** Consumer-facing stat label: POINTS | REBOUNDS | ASSISTS */
export function resolvePickStatLabel(pick = {}) {
  return normalizePickPropType(pick);
}

export function propTypeShortWord(propType = "POINTS") {
  const p = normalizePickPropType(propType);
  if (p === "REBOUNDS") return "reb";
  if (p === "ASSISTS") return "ast";
  return "pts";
}

export function filterPicksByPropTypePresentation(picks = [], filter = "ALL") {
  const f = resolveDisplayPropTypeFilter(filter);
  if (f === "ALL") return Array.isArray(picks) ? picks : [];
  return (picks || []).filter((p) => normalizePickPropType(p) === f);
}
