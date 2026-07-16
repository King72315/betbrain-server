/**
 * Lab measured-field helpers — missing postgame inputs are unavailable, never fake zero.
 */

function isFiniteNum(value) {
  const n = Number(value);
  return Number.isFinite(n);
}

/**
 * @returns {{ value: number|null, unavailable: boolean, reason: string|null }}
 */
export function labMeasuredField(value, reason = "not_reported") {
  if (value === null || value === undefined || value === "") {
    return { value: null, unavailable: true, reason };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { value: null, unavailable: true, reason: reason || "invalid_value" };
  }
  return { value: n, unavailable: false, reason: null };
}

/** Flat numeric read for math — null when unavailable. */
export function readMeasuredValue(field) {
  if (field == null) return null;
  if (typeof field === "object" && "unavailable" in field) {
    return field.unavailable ? null : field.value;
  }
  return isFiniteNum(field) ? Number(field) : null;
}

export function formatMeasuredField(field, suffix = "") {
  if (field == null) return "—";
  if (typeof field === "object" && "unavailable" in field) {
    if (!field.unavailable && field.value != null) {
      return `${field.value}${suffix}`;
    }
    return field.reason ? `unavailable (${field.reason})` : "unavailable";
  }
  if (isFiniteNum(field)) return `${field}${suffix}`;
  return "—";
}
