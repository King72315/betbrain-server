/**
 * Per-stat betting + model-quality ledgers for POINTS / REBOUNDS / ASSISTS.
 *
 * Betting ledgers for REB/AST start empty until real sportsbook freezes grade.
 * Synthetic historical diagnostics must NEVER mix into betting ledgers.
 */
import { normalizePropTypeV1 } from "./propTypeV1.js";

export const PROP_TYPE_LEDGERS_V1_BUILD = "courteedge-prop-type-ledgers-v1";

export const EMPTY_BETTING_RECORD = Object.freeze({
  W: 0,
  L: 0,
  P: 0,
  n: 0,
  hitRate: null,
});

export function emptyTierLedgersV1() {
  return {
    Full: { ...EMPTY_BETTING_RECORD },
    BestAvailable: { ...EMPTY_BETTING_RECORD },
    Certified: { ...EMPTY_BETTING_RECORD },
  };
}

export function buildPropTypeLedgersSnapshotV1({
  modelQuality = {},
  bettingByPropType = {},
} = {}) {
  const mk = (pt) => ({
    propType: pt,
    betting: bettingByPropType[pt] || emptyTierLedgersV1(),
    modelQuality: modelQuality[pt] || {
      n: 0,
      mae: null,
      signedBias: null,
      rmse: null,
      note: pt === "POINTS" ? "see gold learning" : "await historical calib",
    },
  });
  return {
    build: PROP_TYPE_LEDGERS_V1_BUILD,
    combined: {
      note: "Combined ledger remains; per-stat broken out below",
    },
    byPropType: {
      POINTS: mk("POINTS"),
      REBOUNDS: mk("REBOUNDS"),
      ASSISTS: mk("ASSISTS"),
    },
    rules: [
      "Never populate REB/AST betting ledgers from SYNTHETIC_DIRECTION_DIAGNOSTIC",
      "Prospective sportsbook freezes only",
      "Model-quality ledgers are independent of betting W-L",
    ],
  };
}

export function resolveDisplayPropTypeFilterV1(filter = "ALL") {
  const f = String(filter || "ALL").toUpperCase();
  if (f === "POINTS" || f === "REBOUNDS" || f === "ASSISTS") return f;
  return "ALL";
}

/**
 * Presentation-only filter. Does not alter Official membership.
 */
export function filterPicksByPropTypePresentationV1(picks = [], filter = "ALL") {
  const f = resolveDisplayPropTypeFilterV1(filter);
  if (f === "ALL") return Array.isArray(picks) ? picks : [];
  return (picks || []).filter((p) => {
    const pt = normalizePropTypeV1(p.propType || p.canonicalPropType || p.stat);
    return pt === f;
  });
}
