/**
 * Lab deep-learning display helpers (client).
 */

export type MeasuredField = {
  value?: number | null;
  unavailable?: boolean;
  reason?: string | null;
};

export function formatMeasuredValue(
  field: MeasuredField | number | null | undefined,
  suffix = ""
): string {
  if (field == null) return "unavailable";
  if (typeof field === "object" && "unavailable" in field) {
    if (!field.unavailable && field.value != null) return `${field.value}${suffix}`;
    return field.reason ? `unavailable (${field.reason})` : "unavailable";
  }
  if (typeof field === "number" && Number.isFinite(field)) return `${field}${suffix}`;
  return "unavailable";
}

export function formatModuleList(list: string[] | undefined): string {
  if (!list?.length) return "—";
  return list.join(", ");
}

export const LAB_AGGREGATE_DIMENSION_LABELS: Record<string, string> = {
  side: "Over / Under",
  pool: "Top 2 vs Best 6",
  risk: "True risk",
  confidence_bucket: "Confidence",
  projection_gap: "Projection gap",
  player_profile: "Player profile",
  role_stability: "Role stability",
  minutes_stability: "Minutes stability",
  scoring_volatility: "Scoring volatility",
  role_trend: "Role trend",
  book_count: "Book count",
  market_quality: "Market quality",
  same_team_opportunity: "Same-team opportunity",
  flip_first: "Flip-First",
  side_rescue: "Side Rescue",
  gate: "Gate decision",
  gate_reason: "Gate reason",
  miss_type: "Miss type",
  data_mode: "Data mode",
  minutes_delta: "Expected vs actual minutes",
  fga_delta: "Expected vs actual FGA",
  clv_bucket: "CLV",
  opponent_defense_signal: "Opponent defense",
  recent_form_signal: "Recent form",
  season_form_signal: "Season form",
  risk_debt: "Risk debt",
  risk_repair: "Risk repair",
};
