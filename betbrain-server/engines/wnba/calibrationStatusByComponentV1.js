/**
 * Component-level calibration status for POINTS / REBOUNDS / ASSISTS.
 *
 * Replaces coarse CALIBRATION_DEVELOPING with explicit subcomponent stamps.
 * marketEdge stays DEVELOPING for REB/AST until prospective sportsbook freezes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizePropTypeV1 } from "./propTypeV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CALIBRATION_STATUS_BY_COMPONENT_V1_BUILD =
  "courteedge-calibration-status-by-component-v1";

/** @typedef {"ACTIVE"|"INITIAL_CALIBRATED"|"DEVELOPING"|"INSUFFICIENT_DATA"} CalibLevel */

/**
 * Default statuses after historical REB/AST calibration V1.
 * Do not claim ACTIVE for marketEdge without prospective book outcomes.
 */
export const DEFAULT_CALIBRATION_BY_PROP_TYPE_V1 = Object.freeze({
  POINTS: Object.freeze({
    projection: "ACTIVE",
    residualDistribution: "ACTIVE",
    safety: "ACTIVE",
    risk: "ACTIVE",
    probability: "ACTIVE",
    marketEdge: "ACTIVE",
    officialRankScoreStatus: "CALIBRATED",
  }),
  REBOUNDS: Object.freeze({
    projection: "ACTIVE",
    residualDistribution: "ACTIVE",
    safety: "INITIAL_CALIBRATED",
    risk: "INITIAL_CALIBRATED",
    probability: "INITIAL_CALIBRATED",
    marketEdge: "DEVELOPING",
    officialRankScoreStatus: "INITIAL_CALIBRATED",
  }),
  ASSISTS: Object.freeze({
    projection: "ACTIVE",
    residualDistribution: "ACTIVE",
    safety: "INITIAL_CALIBRATED",
    risk: "INITIAL_CALIBRATED",
    probability: "INITIAL_CALIBRATED",
    marketEdge: "DEVELOPING",
    officialRankScoreStatus: "INITIAL_CALIBRATED",
  }),
});

let _overlay = null;

try {
  const overlayPath = path.resolve(
    __dirname,
    "../../research/courteedge-gold-learning-v1/reb-ast-historical-calibration-v1/calibration-status-overlay.json"
  );
  if (fs.existsSync(overlayPath)) {
    const raw = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
    if (raw?.overlay) _overlay = raw.overlay;
  }
} catch {
  /* optional artifact */
}

export function setCalibrationStatusOverlayV1(overlay) {
  _overlay = overlay && typeof overlay === "object" ? overlay : null;
}

export function getCalibrationStatusForPropTypeV1(propType = "POINTS") {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  const base =
    DEFAULT_CALIBRATION_BY_PROP_TYPE_V1[pt] ||
    DEFAULT_CALIBRATION_BY_PROP_TYPE_V1.POINTS;
  const over = _overlay?.[pt] || {};
  return {
    build: CALIBRATION_STATUS_BY_COMPONENT_V1_BUILD,
    propType: pt,
    calibration: {
      projection: over.projection || base.projection,
      residualDistribution:
        over.residualDistribution || base.residualDistribution,
      safety: over.safety || base.safety,
      risk: over.risk || base.risk,
      probability: over.probability || base.probability,
      marketEdge: over.marketEdge || base.marketEdge,
    },
    officialRankScoreStatus:
      over.officialRankScoreStatus || base.officialRankScoreStatus,
  };
}

/**
 * Collapse component map → legacy single string for rank stamp.
 */
export function collapseOfficialRankScoreStatusV1(propType = "POINTS") {
  const { officialRankScoreStatus, calibration } =
    getCalibrationStatusForPropTypeV1(propType);
  if (officialRankScoreStatus) return officialRankScoreStatus;
  const pt = normalizePropTypeV1(propType) || "POINTS";
  if (pt === "POINTS") return "CALIBRATED";
  const ok = ["ACTIVE", "INITIAL_CALIBRATED"];
  if (
    ok.includes(calibration.projection) &&
    ok.includes(calibration.residualDistribution) &&
    ok.includes(calibration.probability)
  ) {
    return "INITIAL_CALIBRATED";
  }
  return "CALIBRATION_DEVELOPING";
}
