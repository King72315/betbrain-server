export type InferredTrackingType = "OFFICIAL" | "TEST" | "NO_BET";

function hasExplicitTrackingType(prop: any = {}): boolean {
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  return explicit === "OFFICIAL" || explicit === "TEST" || explicit === "NO_BET";
}

/** Infer OFFICIAL vs TEST when trackingType is missing (legacy slates). */
export function inferTrackingType(prop: any = {}): InferredTrackingType {
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return "OFFICIAL";
  if (explicit === "TEST") return "TEST";
  if (explicit === "NO_BET") return "NO_BET";

  if (prop.excludedFromOfficialRecord === true) return "TEST";
  if (prop.preV1Shadow === true || prop.excludedFromV1OfficialRecord === true) {
    return "TEST";
  }

  const tier = String(prop.tier || "").toUpperCase();
  if (tier === "LEAN" || tier === "WATCHLIST") return "TEST";
  if (tier === "PREMIUM" || tier === "OFFICIAL") return "OFFICIAL";
  if (prop.officialEligible === true) return "OFFICIAL";

  return "TEST";
}

export function isLegacyInferredTestProp(prop: any = {}): boolean {
  return !hasExplicitTrackingType(prop) && inferTrackingType(prop) === "TEST";
}

export function isLegacyLeanProp(prop: any = {}): boolean {
  return (
    isLegacyInferredTestProp(prop) && String(prop.tier || "").toUpperCase() === "LEAN"
  );
}

export function isLegacyWatchlistProp(prop: any = {}): boolean {
  return (
    isLegacyInferredTestProp(prop) &&
    String(prop.tier || "").toUpperCase() === "WATCHLIST"
  );
}

export type LabSlateTrackingSummary = {
  totalProps: number;
  officialProps: number;
  testWatchlistProps: number;
  legacyLeanProps: number;
  legacyWatchlistProps: number;
  graded: number;
  pending: number;
};

function bucketCount(sectionA: any, bucketKey: string): number {
  const bucket = sectionA?.tierLabBuckets?.[bucketKey];
  if (!bucket) return 0;
  return Number(bucket.propCount ?? bucket.sample ?? 0);
}

/** Lab summary — prefers live props; falls back to report section A / tier buckets. */
export function computeLabSlateTrackingSummary(
  props: any[] = [],
  reportSectionA?: any
): LabSlateTrackingSummary {
  const graded = Number(reportSectionA?.graded ?? 0);
  const pending = Number(reportSectionA?.pending ?? 0);

  if (props.length > 0) {
    const officialProps = props.filter((p) => inferTrackingType(p) === "OFFICIAL");
    const testWatchlistProps = props.filter((p) => inferTrackingType(p) === "TEST");
    return {
      totalProps: props.length,
      officialProps: officialProps.length,
      testWatchlistProps: testWatchlistProps.length,
      legacyLeanProps: props.filter(isLegacyLeanProp).length,
      legacyWatchlistProps: props.filter(isLegacyWatchlistProp).length,
      graded,
      pending,
    };
  }

  const totalProps =
    graded + pending ||
    Number(reportSectionA?.totalTrackedProps ?? 0) ||
    graded;

  const legacyLeanProps = bucketCount(reportSectionA, "LEAN/TESTING");
  const legacyWatchlistProps = bucketCount(reportSectionA, "WATCHLIST");
  const officialFromBuckets = bucketCount(reportSectionA, "OFFICIAL");
  const officialProps =
    officialFromBuckets > 0
      ? officialFromBuckets
      : Number(
          reportSectionA?.officialPropsCount ??
            reportSectionA?.trackingCalibration?.officialCount ??
            0
        );
  const inferredOfficial = legacyLeanProps > 0 || legacyWatchlistProps > 0 ? 0 : officialProps;
  const testWatchlistProps = Math.max(0, totalProps - inferredOfficial);

  return {
    totalProps,
    officialProps: inferredOfficial,
    testWatchlistProps: legacyLeanProps > 0 ? legacyLeanProps : testWatchlistProps,
    legacyLeanProps,
    legacyWatchlistProps,
    graded,
    pending,
  };
}

export function formatLabTrackingSummaryLine(summary: LabSlateTrackingSummary): string {
  const parts = [
    `Total Props: ${summary.totalProps}`,
    `Official Props: ${summary.officialProps}`,
    `Test / Watchlist Props: ${summary.testWatchlistProps}`,
  ];
  if (summary.legacyLeanProps > 0) {
    parts.push(`Legacy LEAN Props: ${summary.legacyLeanProps}`);
  }
  if (summary.graded > 0 || summary.pending > 0) {
    parts.push(`Graded/Pending: ${summary.graded}/${summary.pending}`);
  }
  return parts.join(" | ");
}
