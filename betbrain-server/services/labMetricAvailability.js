/**
 * CourtEdge Lab MetricAvailability — measured zero vs unavailable.
 * Math objects keep typed availability; presentation formatters render N/A.
 */

export const METRIC_UNAVAILABLE_REASONS = Object.freeze([
  "UNINSTRUMENTED",
  "INSUFFICIENT_COMPATIBLE_SLATES",
  "MISSING_OPENING_LINE",
  "MISSING_CLOSING_LINE",
  "MISSING_PROJECTION",
  "MISSING_MARKET_SNAPSHOT",
  "LEGACY_SCHEMA",
  "NO_ELIGIBLE_EVIDENCE",
  "NOT_APPLICABLE",
  "INVALID_VALUE",
  "INCOMPATIBLE_BUILD_ERA",
]);

/** @returns {{ available: true, value: number, reason: null }} */
export function measuredMetric(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return unavailableMetric("INVALID_VALUE");
  }
  return { available: true, value: n, reason: null };
}

/** @returns {{ available: false, value: null, reason: string }} */
export function unavailableMetric(reason = "NOT_APPLICABLE") {
  const normalized = METRIC_UNAVAILABLE_REASONS.includes(reason)
    ? reason
    : "NOT_APPLICABLE";
  return { available: false, value: null, reason: normalized };
}

/**
 * Coerce a raw number|null|MetricAvailability into MetricAvailability.
 * Finite numbers (including 0) are measured; null/undefined/NaN are unavailable.
 */
export function asMetricAvailability(raw, reasonIfMissing = "NOT_APPLICABLE") {
  if (raw != null && typeof raw === "object" && "available" in raw) {
    if (raw.available === true && Number.isFinite(Number(raw.value))) {
      return measuredMetric(raw.value);
    }
    return unavailableMetric(raw.reason || reasonIfMissing);
  }
  if (raw === null || raw === undefined || raw === "") {
    return unavailableMetric(reasonIfMissing);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return unavailableMetric(reasonIfMissing);
  }
  return measuredMetric(n);
}

/** Numeric read for math — null when unavailable (never coerce to 0). */
export function readMetricValue(metric) {
  const m = asMetricAvailability(metric);
  return m.available ? m.value : null;
}

export function isMeasuredZero(metric) {
  const m = asMetricAvailability(metric);
  return m.available === true && m.value === 0;
}

/**
 * Presentation boundary — never emits null/undefined/NaN/—%/N/A%/0% when unavailable.
 */
export function formatMetricAvailability(
  metric,
  {
    suffix = "",
    digits = null,
    unavailableLabel = "N/A",
    zeroLabel = null,
  } = {}
) {
  const m = asMetricAvailability(metric);
  if (!m.available) return unavailableLabel;
  let text;
  if (digits != null && Number.isFinite(digits)) {
    text = Number(m.value).toFixed(digits);
  } else {
    text = String(m.value);
  }
  if (m.value === 0 && zeroLabel != null) return zeroLabel;
  return `${text}${suffix}`;
}

export function formatPctMetric(metric, unavailableLabel = "N/A") {
  return formatMetricAvailability(metric, {
    suffix: "%",
    unavailableLabel,
  });
}

export function formatClvMetric(metric, unavailableLabel = "N/A") {
  return formatMetricAvailability(metric, {
    digits: 1,
    unavailableLabel,
  });
}

/**
 * Official three-slate improvement delta — only when both blocks are complete,
 * have graded denominators, and belong to compatible eras.
 */
export function buildCompatibleDeltaMetric(previous, current, options = {}) {
  const {
    previousComplete = false,
    currentComplete = false,
    previousDecided = null,
    currentDecided = null,
    erasCompatible = true,
  } = options;

  if (!erasCompatible) {
    return {
      ...unavailableMetric("INCOMPATIBLE_BUILD_ERA"),
      previous: readMetricValue(previous),
      current: readMetricValue(current),
      difference: null,
      direction: "unavailable",
      display: "N/A",
      label: "N/A",
      note: "Comparison requires compatible build/schema eras.",
    };
  }

  if (!previousComplete || !currentComplete) {
    return {
      ...unavailableMetric("INSUFFICIENT_COMPATIBLE_SLATES"),
      previous: readMetricValue(previous),
      current: readMetricValue(current),
      difference: null,
      direction: "unavailable",
      display: "N/A",
      label: "N/A",
      note: "Comparison available after 3 compatible completed slates.",
    };
  }

  const prevM = asMetricAvailability(previous, "NO_ELIGIBLE_EVIDENCE");
  const curM = asMetricAvailability(current, "NO_ELIGIBLE_EVIDENCE");

  if (
    (previousDecided != null && previousDecided <= 0) ||
    (currentDecided != null && currentDecided <= 0) ||
    !prevM.available ||
    !curM.available
  ) {
    return {
      ...unavailableMetric("NO_ELIGIBLE_EVIDENCE"),
      previous: prevM.available ? prevM.value : null,
      current: curM.available ? curM.value : null,
      difference: null,
      direction: "unavailable",
      display: "N/A",
      label: "N/A",
      note: "Comparison requires valid graded denominators on both blocks.",
    };
  }

  const difference = Number((curM.value - prevM.value).toFixed(3));
  let direction = "flat";
  if (difference > 0) direction = "up";
  if (difference < 0) direction = "down";
  const display = `${difference > 0 ? "+" : ""}${difference}`;
  return {
    available: true,
    value: difference,
    reason: null,
    previous: prevM.value,
    current: curM.value,
    difference,
    direction,
    display,
    label: display,
    note: null,
  };
}

/**
 * Simple two-value delta when completeness is already guaranteed by caller,
 * or for non-official diagnostics. Still never returns bare null display.
 */
export function deltaMetricAvailability(previous, current, reasonIfMissing = "NO_ELIGIBLE_EVIDENCE") {
  const prevM = asMetricAvailability(previous, reasonIfMissing);
  const curM = asMetricAvailability(current, reasonIfMissing);
  if (!curM.available) {
    return {
      ...unavailableMetric(curM.reason || reasonIfMissing),
      previous: prevM.available ? prevM.value : null,
      current: null,
      difference: null,
      direction: prevM.available ? "pending" : "unavailable",
      display: "N/A",
      label: prevM.available ? "pending" : "N/A",
      note: null,
    };
  }
  if (!prevM.available) {
    return {
      ...unavailableMetric(prevM.reason || reasonIfMissing),
      previous: null,
      current: curM.value,
      difference: null,
      direction: "no_previous",
      display: "N/A",
      label: "N/A",
      note: null,
    };
  }
  const difference = Number((curM.value - prevM.value).toFixed(3));
  let direction = "flat";
  if (difference > 0) direction = "up";
  if (difference < 0) direction = "down";
  const display = `${difference > 0 ? "+" : ""}${difference}`;
  return {
    available: true,
    value: difference,
    reason: null,
    previous: prevM.value,
    current: curM.value,
    difference,
    direction,
    display,
    label: display,
    note: null,
  };
}
