/**
 * Stat-specific fair lines for POINTS / REBOUNDS / ASSISTS.
 * Do not reuse Points FGA/FTA parameters for REB/AST.
 * REB/AST: actual 0 RPG/APG is a real average. Do not skip it as missing.
 */
import { buildFairLine } from "../fairLineEngine.js";
import { normalizePropTypeV1 } from "./propTypeV1.js";
import { presentStatNumber } from "./statPresenceV1.js";

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fairFromSeasonRecent(season, recent, sportsProjection) {
  if (season != null && recent != null) return season * 0.85 + recent * 0.15;
  if (season != null) return season;
  if (recent != null) return recent;
  if (sportsProjection != null) return sportsProjection;
  return 0;
}

/**
 * Build fair line for a propType. Points delegates to existing buildFairLine.
 */
export function buildFairLineForPropTypeV1({
  propType = "POINTS",
  playerState = {},
  roleChange = {},
  prop = {},
  projection = null,
} = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";

  if (pt === "POINTS") {
    return {
      ...buildFairLine({ playerState, roleChange, prop }),
      propType: "POINTS",
      fairLineSource: "POINTS_VOLUME_EFFICIENCY",
    };
  }

  const bookLine = num(prop.line ?? playerState.bookLine);
  const sportsProjection = presentStatNumber(
    projection ?? playerState.sportsProjection ?? playerState.projection
  );

  if (pt === "REBOUNDS") {
    const season = presentStatNumber(playerState.seasonRebounds);
    const recent = presentStatNumber(playerState.recentRebounds);
    let fairLine = fairFromSeasonRecent(season, recent, sportsProjection);
    fairLine = Number(Math.max(0, fairLine).toFixed(1));
    return {
      fairLine,
      fairLineEdge: Number((fairLine - bookLine).toFixed(1)),
      fairLineQuality: clamp(
        (season != null ? 50 : 0) +
          (recent != null ? 30 : 0) +
          (sportsProjection != null ? 20 : 0),
        0,
        100
      ),
      fairLineReasons: [
        `REBOUNDS fair from season RPG (${Number(season ?? 0).toFixed(1)}) with light recent mix`,
        sportsProjection != null
          ? `Projection ${sportsProjection} kept separate (not blended as primary)`
          : "No projection",
      ],
      fairLineRiskReasons: [],
      propType: "REBOUNDS",
      fairLineSource: "REBOUNDS_SEASON_PRIMARY_BLEND",
      sharedInputs: ["minutes", "availability", "pace"],
      independentInputs: ["seasonRPG", "recentRPG", "reboundRate", "competition"],
    };
  }

  const seasonA = presentStatNumber(playerState.seasonAssists);
  const recentA = presentStatNumber(playerState.recentAssists);
  let fairA = fairFromSeasonRecent(seasonA, recentA, sportsProjection);
  fairA = Number(Math.max(0, fairA).toFixed(1));
  return {
    fairLine: fairA,
    fairLineEdge: Number((fairA - bookLine).toFixed(1)),
    fairLineQuality: clamp(
      (seasonA != null ? 50 : 0) +
        (recentA != null ? 30 : 0) +
        (sportsProjection != null ? 20 : 0),
      0,
      100
    ),
    fairLineReasons: [
      `ASSISTS fair from season APG (${Number(seasonA ?? 0).toFixed(1)}) with light recent mix`,
      sportsProjection != null
        ? `Projection ${sportsProjection} kept separate (not blended as primary)`
        : "No projection",
    ],
    fairLineRiskReasons: [],
    propType: "ASSISTS",
    fairLineSource: "ASSISTS_SEASON_PRIMARY_BLEND",
    sharedInputs: ["minutes", "availability", "pace", "teammateAvailability"],
    independentInputs: [
      "seasonAPG",
      "recentAPG",
      "assistRate",
      "playmakingRole",
      "teammateFinishing",
    ],
  };
}
