/**
 * Stat-specific fair lines for POINTS / REBOUNDS / ASSISTS.
 * Do not reuse Points FGA/FTA parameters for REB/AST.
 */
import { buildFairLine } from "../fairLineEngine.js";
import { normalizePropTypeV1 } from "./propTypeV1.js";

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function blend(recent = 0, season = 0, w = 0.55) {
  if (recent > 0 && season > 0) return recent * w + season * (1 - w);
  if (recent > 0) return recent;
  if (season > 0) return season;
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
  const sportsProjection = num(
    projection ?? playerState.sportsProjection ?? playerState.projection
  );

  if (pt === "REBOUNDS") {
    const season = num(playerState.seasonRebounds);
    const recent = num(playerState.recentRebounds);
    // Fair line: season RPG only (or light recent). Projection engine owns
    // recent-rate × minutes. This avoids near-1.0 projection/fair aliasing.
    let fairLine =
      season > 0
        ? season
        : recent > 0
          ? recent
          : sportsProjection > 0
            ? sportsProjection
            : 0;
    if (season > 0 && recent > 0) {
      fairLine = season * 0.85 + recent * 0.15;
    }
    fairLine = Number(Math.max(0, fairLine).toFixed(1));
    return {
      fairLine,
      fairLineEdge: Number((fairLine - bookLine).toFixed(1)),
      fairLineQuality: clamp(
        (season > 0 ? 50 : 0) + (recent > 0 ? 30 : 0) + (sportsProjection > 0 ? 20 : 0),
        0,
        100
      ),
      fairLineReasons: [
        `REBOUNDS fair from season RPG (${Number(season || 0).toFixed(1)}) with light recent mix`,
        sportsProjection > 0
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

  // ASSISTS — season APG fair; projection owns recent assist-rate × minutes
  const seasonA = num(playerState.seasonAssists);
  const recentA = num(playerState.recentAssists);
  let fairA =
    seasonA > 0
      ? seasonA
      : recentA > 0
        ? recentA
        : sportsProjection > 0
          ? sportsProjection
          : 0;
  if (seasonA > 0 && recentA > 0) {
    fairA = seasonA * 0.85 + recentA * 0.15;
  }
  fairA = Number(Math.max(0, fairA).toFixed(1));
  return {
    fairLine: fairA,
    fairLineEdge: Number((fairA - bookLine).toFixed(1)),
    fairLineQuality: clamp(
      (seasonA > 0 ? 50 : 0) + (recentA > 0 ? 30 : 0) + (sportsProjection > 0 ? 20 : 0),
      0,
      100
    ),
    fairLineReasons: [
      `ASSISTS fair from season APG (${Number(seasonA || 0).toFixed(1)}) with light recent mix`,
      sportsProjection > 0
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
