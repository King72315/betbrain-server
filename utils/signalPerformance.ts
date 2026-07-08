export type SignalImpactStatus = "helped" | "hurt" | "neutral";

export type SignalPerformanceRow = {
  signalCategory: string;
  value: string;
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  record: string;
  winRate: number | null;
  avgMargin: number | null;
  avgConfidence: number | null;
  decided: number;
  smallSample: boolean;
  smallSampleNote?: string | null;
  impactStatus: SignalImpactStatus;
  impactReason?: string;
  rawRecords?: Array<Record<string, unknown>>;
};

export type SignalPerformanceTable = {
  version?: string;
  slateDate?: string | null;
  propCount?: number;
  rowCount?: number;
  rows?: SignalPerformanceRow[];
  summary?: {
    helped?: SignalPerformanceRow[];
    hurt?: SignalPerformanceRow[];
    neutral?: SignalPerformanceRow[];
    smallSampleCount?: number;
  };
  byCategory?: Record<string, SignalPerformanceRow[]>;
  thresholds?: Record<string, number>;
};

export type ThreeSlateGroup = {
  groupId: string;
  groupIndex: number;
  slateDates: string[];
  slateCount: number;
  incomplete?: boolean;
  totalProps: number;
  record: string;
  winRate: number | null;
  avgMargin: number | null;
  wins: number;
  losses: number;
  pushes: number;
  riskBucketBreakdown?: Record<string, { record?: string; winRate?: number | null }>;
  sideBreakdown?: Record<string, { record?: string; winRate?: number | null }>;
  topSignalHelpers?: Array<{ signal: string; record: string; winRate: number | null; avgMargin: number | null; smallSample?: boolean }>;
  topSignalHurters?: Array<{ signal: string; record: string; winRate: number | null; avgMargin: number | null; smallSample?: boolean }>;
  neutralSignals?: Array<{ signal: string; record: string; winRate: number | null; avgMargin: number | null; smallSample?: boolean }>;
  comparison?: {
    hasPrevious: boolean;
    winRateDelta?: number | null;
    avgMarginDelta?: number | null;
    notes?: string[];
  };
};

export type HistoryThreeSlateGroups = {
  version?: string;
  groupCount?: number;
  completeGroupCount?: number;
  archivedSlateCount?: number;
  groups?: ThreeSlateGroup[];
};

export function getImpactStatusColor(status: SignalImpactStatus): string {
  if (status === "helped") return "#22c55e";
  if (status === "hurt") return "#ef4444";
  return "#94a3b8";
}

export function formatImpactLabel(status: SignalImpactStatus): string {
  if (status === "helped") return "HELPED";
  if (status === "hurt") return "HURT";
  return "NEUTRAL";
}

export function formatSignalRecord(row: Pick<SignalPerformanceRow, "record" | "winRate" | "avgMargin" | "smallSample">): string {
  const wr = row.winRate !== null && row.winRate !== undefined ? `${row.winRate}%` : "—";
  const margin =
    row.avgMargin !== null && row.avgMargin !== undefined
      ? `${row.avgMargin >= 0 ? "+" : ""}${row.avgMargin}`
      : "—";
  const sample = row.smallSample ? " • small sample" : "";
  return `${row.record} (${wr}) • margin ${margin}${sample}`;
}

export function groupRowsByCategory(rows: SignalPerformanceRow[] = []): Record<string, SignalPerformanceRow[]> {
  return rows.reduce<Record<string, SignalPerformanceRow[]>>((acc, row) => {
    const key = row.signalCategory || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

export function getSignalPerformanceFromReport(report: any): SignalPerformanceTable | null {
  return report?.signalPerformance || report?.sections?.X || null;
}
