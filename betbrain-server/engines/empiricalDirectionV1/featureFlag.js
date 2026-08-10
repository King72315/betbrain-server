/**
 * Direction feature flag — kept outside EMPIRICAL_SAFE_PROP_V2 calibration hash files.
 *
 * Control-plane V1: Direction always chooses a side (PRIMARY | BEST_GUESS).
 * Closed-gate NO_BET→block-Official is retired from production architecture switching.
 */
import {
  OFFICIAL_BOARD_MIN,
  OFFICIAL_BOARD_MAX,
  getOfficialBoardSizePolicy as getControlPlaneBoardSizePolicy,
} from "../courtEdgeControlPlaneV1/contract.js";

export const EMPIRICAL_DIRECTION_V1 =
  String(process.env.EMPIRICAL_DIRECTION_V1 || "true").toLowerCase() !==
  "false";

export function isEmpiricalDirectionV1Enabled(options = {}) {
  if (options.empiricalDirectionV1 === false) return false;
  if (options.empiricalDirectionV1 === true) return true;
  return EMPIRICAL_DIRECTION_V1;
}

/** @deprecated Control-plane V1 always uses educated-guess. Always false. */
export const DIRECTION_NO_BET_BLOCKS_OFFICIAL = false;

/** @deprecated Always false — NO_BET has zero Official membership authority. */
export function isDirectionNoBetBlockingOfficial(_options = {}) {
  return false;
}

export { OFFICIAL_BOARD_MIN, OFFICIAL_BOARD_MAX };

export function getOfficialBoardSizePolicy(_options = {}) {
  return getControlPlaneBoardSizePolicy();
}
