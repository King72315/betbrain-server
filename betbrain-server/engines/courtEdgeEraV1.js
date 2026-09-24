/**
 * CourtEdge production era boundary.
 * New slates on/after 2026-09-21: PTS Official + Winner-C production; REB/AST shadow.
 * Historical freezes before this date are not reminted.
 */
export const COURTEDGE_ERA_START_CT = "2026-09-21";
export const COURTEDGE_REB_AST_PRODUCTION_START_CT = "2026-09-22";
export const COURTEDGE_PTS_WINNERC_PRODUCTION_V1 = "COURTEDGE_PTS_WINNERC_PRODUCTION_V1";
export const COURTEDGE_REB_SHADOW_V1 = "COURTEDGE_REB_SHADOW_V1";
export const COURTEDGE_AST_SHADOW_V1 = "COURTEDGE_AST_SHADOW_V1";
export const COURTEDGE_REB_PRODUCTION_V1 = "COURTEDGE_REB_PRODUCTION_V1";
export const COURTEDGE_AST_PRODUCTION_V1 = "COURTEDGE_AST_PRODUCTION_V1";
export const COURTEDGE_WINNER_C_PRODUCTION_V1 = "COURTEDGE_WINNER_C_PRODUCTION_V1";
export const COURTEDGE_WINNER_V1_FORENSIC = "courtedge-wnba-winner-model-v1";
export const COURTEDGE_PRODUCTION_PERFORMANCE_ERA = "COURTEDGE_PRODUCTION_PTS_WINNERC_ERA_V1";
export const COURTEDGE_SHADOW_PERFORMANCE_ERA = "COURTEDGE_SHADOW_REB_AST_ERA_V1";
export const COURTEDGE_WINNER_SCOPE = "WNBA_ONLY";

export function isCourtEdgePtsWinnerCEra(slateDateCT) {
  const d = String(slateDateCT || "");
  return d >= COURTEDGE_ERA_START_CT;
}

export function isRebAstProductionEra(slateDateCT) {
  const d = String(slateDateCT || "");
  return d >= COURTEDGE_REB_AST_PRODUCTION_START_CT;
}

export function isRebAstShadowOnly(slateDateCT) {
  return isCourtEdgePtsWinnerCEra(slateDateCT) && !isRebAstProductionEra(slateDateCT);
}

export function normalizePropMarket(value = "") {
  const s = String(value || "").toUpperCase();
  if (s.includes("REB")) return "REBOUNDS";
  if (s.includes("AST") || s.includes("ASSIST")) return "ASSISTS";
  if (s.includes("PT") || s.includes("POINT")) return "POINTS";
  return s || "UNKNOWN";
}

export function isShadowPropMarket(value = "") {
  const m = normalizePropMarket(value);
  return m === "REBOUNDS" || m === "ASSISTS";
}
