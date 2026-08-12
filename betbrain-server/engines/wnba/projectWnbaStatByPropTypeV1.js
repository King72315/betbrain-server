/**
 * Dispatch stat-specific projection by propType.
 * POINTS → projectWnbaPoints (+ mean calibration handled by data card)
 * REBOUNDS → projectWnbaRebounds
 * ASSISTS → projectWnbaAssists
 */
import { projectWnbaPoints } from "./wnbaProjectionEngine.js";
import { projectWnbaRebounds } from "./wnbaReboundsProjectionEngine.js";
import { projectWnbaAssists } from "./wnbaAssistsProjectionEngine.js";
import { normalizePropTypeV1 } from "./propTypeV1.js";

export function projectWnbaStatByPropTypeV1(propType, input = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  if (pt === "REBOUNDS") {
    const r = projectWnbaRebounds(input);
    return {
      ...r,
      projection: r.projection,
      expectedMinutes: r.expectedMinutes,
      propType: "REBOUNDS",
    };
  }
  if (pt === "ASSISTS") {
    const r = projectWnbaAssists(input);
    return {
      ...r,
      projection: r.projection,
      expectedMinutes: r.expectedMinutes,
      propType: "ASSISTS",
    };
  }
  const r = projectWnbaPoints(input);
  return {
    ...r,
    propType: "POINTS",
  };
}
