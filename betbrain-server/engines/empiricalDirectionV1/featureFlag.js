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
