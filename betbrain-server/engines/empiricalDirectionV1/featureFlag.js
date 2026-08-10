/**
 * Direction feature flag — kept outside EMPIRICAL_SAFE_PROP_V2 calibration hash files.
 */
export const EMPIRICAL_DIRECTION_V1 =
  String(process.env.EMPIRICAL_DIRECTION_V1 || "true").toLowerCase() !==
  "false";

export function isEmpiricalDirectionV1Enabled(options = {}) {
  if (options.empiricalDirectionV1 === false) return false;
  if (options.empiricalDirectionV1 === true) return true;
  return EMPIRICAL_DIRECTION_V1;
}

/**
 * Product policy: Direction still chooses OVER/UNDER when confident, but a
 * Direction NO BET no longer empties Official. Every market still gets a side
 * (educated guess), then Official keeps only the safest 2–6.
 *
 * Set COURTEDGE_DIRECTION_NO_BET_BLOCKS_OFFICIAL=true to restore closed-gate.
 */
export const DIRECTION_NO_BET_BLOCKS_OFFICIAL =
  String(
    process.env.COURTEDGE_DIRECTION_NO_BET_BLOCKS_OFFICIAL || "false"
  ).toLowerCase() === "true";

export function isDirectionNoBetBlockingOfficial(options = {}) {
  if (options.directionNoBetBlocksOfficial === true) return true;
  if (options.directionNoBetBlocksOfficial === false) return false;
  return DIRECTION_NO_BET_BLOCKS_OFFICIAL;
}

/** Official board size: educated-guess pool → keep only safest 2–6. */
export const OFFICIAL_BOARD_MIN = Math.max(
  0,
  Number(process.env.COURTEDGE_OFFICIAL_BOARD_MIN || 2) || 2
);
export const OFFICIAL_BOARD_MAX = Math.max(
  OFFICIAL_BOARD_MIN,
  Number(process.env.COURTEDGE_OFFICIAL_BOARD_MAX || 6) || 6
);

export function getOfficialBoardSizePolicy(options = {}) {
  const min = Number.isFinite(options.officialBoardMin)
    ? options.officialBoardMin
    : OFFICIAL_BOARD_MIN;
  const max = Number.isFinite(options.officialBoardMax)
    ? options.officialBoardMax
    : OFFICIAL_BOARD_MAX;
  return {
    min: Math.max(0, min),
    max: Math.max(Math.max(0, min), max),
    policy: "SAFEST_TOP_N_EDUCATED_GUESS",
  };
}
