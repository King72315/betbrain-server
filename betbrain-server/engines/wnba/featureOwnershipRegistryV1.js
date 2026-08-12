/**
 * Feature-ownership registry V1 — prevents cross-stat feature bias.
 *
 * role: HIGH | CONTEXTUAL | NONE
 * source: DIRECT | DERIVED | MISSING
 */
export const FEATURE_OWNERSHIP_REGISTRY_V1_BUILD =
  "courteedge-feature-ownership-registry-v1";

/** @type {Record<string, { POINTS: string, REBOUNDS: string, ASSISTS: string, source: string, notes?: string }>} */
export const FEATURE_OWNERSHIP_REGISTRY_V1 = Object.freeze({
  expectedMinutes: {
    POINTS: "HIGH",
    REBOUNDS: "HIGH",
    ASSISTS: "HIGH",
    source: "DIRECT",
  },
  minutesStability: {
    POINTS: "HIGH",
    REBOUNDS: "HIGH",
    ASSISTS: "HIGH",
    source: "DERIVED",
  },
  seasonPPG: {
    POINTS: "HIGH",
    REBOUNDS: "NONE",
    ASSISTS: "NONE",
    source: "DIRECT",
  },
  seasonRPG: {
    POINTS: "NONE",
    REBOUNDS: "HIGH",
    ASSISTS: "NONE",
    source: "DIRECT",
  },
  seasonAPG: {
    POINTS: "NONE",
    REBOUNDS: "NONE",
    ASSISTS: "HIGH",
    source: "DIRECT",
  },
  FGA: {
    POINTS: "HIGH",
    REBOUNDS: "CONTEXTUAL",
    ASSISTS: "CONTEXTUAL",
    source: "DIRECT",
    notes: "REBOUNDS: missed-shot environment only; ASSISTS: finishing context",
  },
  FTA: {
    POINTS: "HIGH",
    REBOUNDS: "NONE",
    ASSISTS: "NONE",
    source: "DIRECT",
  },
  usageOrShotShare: {
    POINTS: "HIGH",
    REBOUNDS: "NONE",
    ASSISTS: "CONTEXTUAL",
    source: "DERIVED",
  },
  reboundShare: {
    POINTS: "NONE",
    REBOUNDS: "HIGH",
    ASSISTS: "NONE",
    source: "DERIVED",
  },
  reboundRate: {
    POINTS: "NONE",
    REBOUNDS: "HIGH",
    ASSISTS: "NONE",
    source: "DERIVED",
  },
  assistRate: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "NONE",
    ASSISTS: "HIGH",
    source: "DERIVED",
  },
  playmakingRole: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "NONE",
    ASSISTS: "HIGH",
    source: "DERIVED",
  },
  teammateFinishing: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "NONE",
    ASSISTS: "HIGH",
    source: "DERIVED",
  },
  teammateReboundCompetition: {
    POINTS: "NONE",
    REBOUNDS: "HIGH",
    ASSISTS: "NONE",
    source: "DERIVED",
  },
  opponentMissedShotVolume: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "HIGH",
    ASSISTS: "NONE",
    source: "DERIVED",
  },
  pace: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "CONTEXTUAL",
    ASSISTS: "CONTEXTUAL",
    source: "DERIVED",
    notes: "Increases opportunities; never automatic Over",
  },
  spreadBlowout: {
    POINTS: "CONTEXTUAL",
    REBOUNDS: "CONTEXTUAL",
    ASSISTS: "CONTEXTUAL",
    source: "DERIVED",
  },
  availability: {
    POINTS: "HIGH",
    REBOUNDS: "HIGH",
    ASSISTS: "HIGH",
    source: "DIRECT",
  },
  roleStability: {
    POINTS: "HIGH",
    REBOUNDS: "HIGH",
    ASSISTS: "HIGH",
    source: "DERIVED",
  },
});

export function featureRoleForPropType(featureKey, propType) {
  const row = FEATURE_OWNERSHIP_REGISTRY_V1[featureKey];
  if (!row) return "UNKNOWN";
  const pt = String(propType || "POINTS").toUpperCase();
  return row[pt] || "NONE";
}

export function listFeaturesForPropType(propType, minRole = "CONTEXTUAL") {
  const order = { HIGH: 3, CONTEXTUAL: 2, NONE: 1, UNKNOWN: 0 };
  const floor = order[minRole] ?? 2;
  return Object.entries(FEATURE_OWNERSHIP_REGISTRY_V1)
    .map(([feature, row]) => ({
      feature,
      role: featureRoleForPropType(feature, propType),
      source: row.source,
      notes: row.notes || null,
    }))
    .filter((r) => (order[r.role] || 0) >= floor);
}
