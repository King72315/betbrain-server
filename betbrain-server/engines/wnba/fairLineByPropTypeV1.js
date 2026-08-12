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
    const base = blend(recent, season, 0.6);
    const anchorWeight = sportsProjection > 0 ? 0.35 : 0;
    let fairLine =
      sportsProjection > 0 && base > 0
        ? base * (1 - anchorWeight) + sportsProjection * anchorWeight
        : sportsProjection > 0
          ? sportsProjection
          : base;
    fairLine = Number(Math.max(0, fairLine).toFixed(1));
    return {
      fairLine,
      fairLineEdge: Number((fairLine - bookLine).toFixed(1)),
      fairLineQuality: clamp(
        (season > 0 ? 40 : 0) + (recent > 0 ? 40 : 0) + (sportsProjection > 0 ? 20 : 0),
        0,
        100
      ),
      fairLineReasons: [
        `REBOUNDS fair from season/recent RPG blend (${base.toFixed(1)})`,
        sportsProjection > 0
          ? `Projection anchor ${sportsProjection}`
          : "No projection anchor",
      ],
      fairLineRiskReasons: [],
      propType: "REBOUNDS",
      fairLineSource: "REBOUNDS_RATE_BLEND",
      sharedInputs: ["minutes", "availability", "pace"],
      independentInputs: ["seasonRPG", "recentRPG", "reboundRate", "competition"],
    };
  }

  // ASSISTS
  const seasonA = num(playerState.seasonAssists);
  const recentA = num(playerState.recentAssists);
  const baseA = blend(recentA, seasonA, 0.6);
  const anchorW = sportsProjection > 0 ? 0.35 : 0;
  let fairA =
    sportsProjection > 0 && baseA > 0
      ? baseA * (1 - anchorW) + sportsProjection * anchorW
      : sportsProjection > 0
        ? sportsProjection
        : baseA;
  fairA = Number(Math.max(0, fairA).toFixed(1));
  return {
    fairLine: fairA,
    fairLineEdge: Number((fairA - bookLine).toFixed(1)),
    fairLineQuality: clamp(
      (seasonA > 0 ? 40 : 0) + (recentA > 0 ? 40 : 0) + (sportsProjection > 0 ? 20 : 0),
      0,
      100
    ),
    fairLineReasons: [
      `ASSISTS fair from season/recent APG blend (${baseA.toFixed(1)})`,
      sportsProjection > 0
        ? `Projection anchor ${sportsProjection}`
        : "No projection anchor",
    ],
    fairLineRiskReasons: [],
    propType: "ASSISTS",
    fairLineSource: "ASSISTS_RATE_BLEND",
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
