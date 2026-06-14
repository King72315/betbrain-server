export type DayBucket = "TODAY" | "TOMORROW" | "LATER" | "";

export const DAY_BUCKET_ORDER: DayBucket[] = [
  "TODAY",
  "TOMORROW",
  "LATER",
];

export const DAY_BUCKET_LABELS: Record<string, string> = {
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  LATER: "Later",
};

export function resolveDayBucket(item: {
  dayBucket?: string;
  dateLabel?: string;
} = {}) {
  const bucket = String(item.dayBucket || "").toUpperCase();

  if (bucket === "TODAY" || bucket === "TOMORROW" || bucket === "LATER") {
    return bucket as DayBucket;
  }

  const label = String(item.dateLabel || "").toLowerCase();

  if (label === "today") return "TODAY";
  if (label === "tomorrow") return "TOMORROW";

  return "LATER";
}

export function groupByDayBucket<T extends { dayBucket?: string; dateLabel?: string }>(
  items: T[] = []
) {
  const groups: Record<string, T[]> = {
    TODAY: [],
    TOMORROW: [],
    LATER: [],
  };

  for (const item of items) {
    const bucket = resolveDayBucket(item);
    groups[bucket || "LATER"].push(item);
  }

  return DAY_BUCKET_ORDER.filter((bucket) => groups[bucket].length > 0).map(
    (bucket) => ({
      bucket,
      label: DAY_BUCKET_LABELS[bucket],
      items: groups[bucket],
    })
  );
}
