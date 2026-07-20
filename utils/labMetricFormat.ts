/**
 * CourtEdge Lab metric presentation helpers.
 * Formats MetricAvailability (or raw numbers) — never emits null/—%/N/A%.
 */

export type MetricAvailability =
  | { available: true; value: number; reason?: null }
  | {
      available: false;
      value: null;
      reason?: string | null;
      display?: string;
      label?: string;
      note?: string | null;
    }
  | null
  | undefined;

function isAvailabilityObject(raw: unknown): raw is {
  available: boolean;
  value?: number | null;
  reason?: string | null;
  display?: string;
  label?: string;
} {
  return Boolean(raw && typeof raw === "object" && "available" in (raw as object));
}

export function formatLabMetric(
  raw: MetricAvailability | number | string | null | undefined,
  opts: { suffix?: string; digits?: number | null; unavailableLabel?: string } = {}
): string {
  const unavailableLabel = opts.unavailableLabel ?? "N/A";
  const suffix = opts.suffix ?? "";

  if (isAvailabilityObject(raw)) {
    if (raw.available === true && raw.value != null && Number.isFinite(Number(raw.value))) {
      const n = Number(raw.value);
      const text =
        opts.digits != null && Number.isFinite(opts.digits)
          ? n.toFixed(opts.digits)
          : String(n);
      return `${text}${suffix}`;
    }
    if (raw.display && raw.display !== "null" && raw.display !== "undefined") {
      return raw.display;
    }
    return unavailableLabel;
  }

  if (raw === null || raw === undefined || raw === "") return unavailableLabel;
  if (typeof raw === "string") {
    if (raw === "null" || raw === "undefined" || raw === "NaN") return unavailableLabel;
    return raw;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return unavailableLabel;
  const text =
    opts.digits != null && Number.isFinite(opts.digits) ? n.toFixed(opts.digits) : String(n);
  return `${text}${suffix}`;
}

export function formatLabPct(
  raw: MetricAvailability | number | null | undefined,
  unavailableLabel = "N/A"
): string {
  return formatLabMetric(raw, { suffix: "%", unavailableLabel });
}

export function formatLabClv(
  raw: MetricAvailability | number | null | undefined,
  unavailableLabel = "N/A"
): string {
  return formatLabMetric(raw, { digits: 1, unavailableLabel });
}

export function formatLabNum(
  raw: MetricAvailability | number | null | undefined,
  digits = 1,
  unavailableLabel = "N/A"
): string {
  return formatLabMetric(raw, { digits, unavailableLabel });
}

export function formatEngineCovDir(card: {
  coverage?: MetricAvailability;
  coveragePct?: number | null;
  directionalAccuracyMetric?: MetricAvailability;
  directionalAccuracy?: number | null;
  noEligibleEvidence?: boolean;
  instrumentedEligibleCount?: number;
} | null | undefined): string {
  if (!card) return "cov N/A · dir N/A";
  if (
    card.noEligibleEvidence ||
    (card.instrumentedEligibleCount != null && card.instrumentedEligibleCount === 0)
  ) {
    return "cov N/A · dir N/A";
  }
  const cov = formatLabPct(card.coverage ?? card.coveragePct ?? null);
  const dir = formatLabPct(
    card.directionalAccuracyMetric ?? card.directionalAccuracy ?? null
  );
  return `cov ${cov} · dir ${dir}`;
}

export function formatWinRateDelta(delta: any): { line: string; note?: string } {
  if (!delta) {
    return {
      line: "Win rate Δ: N/A",
      note: "Comparison available after 3 compatible completed slates.",
    };
  }
  if (delta.available === false || delta.difference == null) {
    return {
      line: "Win rate Δ: N/A",
      note:
        delta.note ||
        "Comparison available after 3 compatible completed slates.",
    };
  }
  const prev = formatLabNum(delta.previous, 1);
  const cur = formatLabNum(delta.current, 1);
  const display = delta.display || formatLabNum(delta.difference, 3);
  return {
    line: `Win rate Δ: prev ${prev} → cur ${cur} (${display})`,
  };
}

/** True when a consumer string would leak raw null/undefined/NaN/—%. */
export function containsRawUnavailableLeak(text: string): boolean {
  if (!text) return false;
  return (
    /\bnull\b/i.test(text) ||
    /\bundefined\b/i.test(text) ||
    /\bNaN\b/.test(text) ||
    /—%/.test(text) ||
    /N\/A%/.test(text) ||
    /\bInfinity\b/.test(text)
  );
}
