/**
 * CourtEdge Small-Sample Directional Calibration V1
 * Build: courteedge-small-sample-directional-calibration-v1
 *
 * Modest Over/Under score adjustments from corrected Jul 29 / Jul 30 / Aug 3 evidence.
 * Structure, membership, lifecycle, and hard gates are untouched.
 * Baseline scores preserved read-only; calibrated scores drive live selection.
 */

export const DIRECTIONAL_CALIBRATION_VERSION =
  "courteedge-small-sample-directional-calibration-v1";
export const DIRECTIONAL_CALIBRATION_BUILD =
  "courteedge-small-sample-directional-calibration-v1";

/** Bounded weight deltas vs pre-calibration V2 formula. */
export const CALIBRATION_WEIGHTS = Object.freeze({
  // Over: projection edge *6 reduced 15% → effective *5.1 when applying edge delta
  OVER_PROJECTION_EDGE_FACTOR: 0.85,
  OVER_FAIR_LINE_FACTOR: 1.1,
  OVER_L5_AVG_BONUS_SCALE: 1.1,
  OVER_SEASON_AVG_BONUS_SCALE: 1.08,
  OVER_L5_HIT_SCALE: 1.1,
  // Under
  UNDER_PROJECTION_EDGE_FACTOR: 1.03,
  UNDER_FAIR_LINE_FACTOR: 1.05,
  UNDER_SEASON_AVG_SCALE: 1.1,
  UNDER_L5_HIT_SCALE: 1.1,
  // Caps
  MAX_CONFIDENCE_DELTA: 8,
  MAX_BLOWOUT_DIRECTIONAL: 2,
  MAX_ABS_SCORE_DELTA: 22,
});

export const AGREEMENT_BONUS = Object.freeze({
  3: 4,
  4: 7,
  5: 10,
});

function num(v, f = null) {
  if (v == null || v === "") return f;
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}

function normSide(side = "") {
  const u = String(side || "").toUpperCase();
  if (u.startsWith("OVER")) return "OVER";
  if (u.startsWith("UNDER")) return "UNDER";
  return null;
}

function hitRateFraction(raw) {
  const n = num(raw);
  if (n == null) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * Extract directional feature packet from a prop (verified fields only).
 */
export function extractDirectionalFeatures(pick = {}, side = "OVER") {
  const s = normSide(side) || "OVER";
  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const projection = num(pick.projection ?? pick.projectedPoints ?? pick.finalProjection);
  const fair = num(pick.fairLine ?? pick.fairValueLine);
  const l5 = num(pick.last5Average ?? pick.playerState?.recentPoints);
  const season = num(pick.seasonAverage ?? pick.playerState?.seasonPoints);
  // Prefer organic side hit rate when available; else last5HitRate of selected side packet
  const l5Hit = hitRateFraction(
    pick.last5HitRate ??
      pick.playerState?.last5HitRate ??
      pick.homeDetailedAnalysisV1?.recent?.l5HitRate
  );

  const projEdge =
    line != null && projection != null
      ? s === "OVER"
        ? projection - line
        : line - projection
      : null;
  const fairEdge =
    line != null && fair != null
      ? s === "OVER"
        ? fair - line
        : line - fair
      : null;
  const l5Edge =
    line != null && l5 != null ? (s === "OVER" ? l5 - line : line - l5) : null;
  const seasonEdge =
    line != null && season != null
      ? s === "OVER"
        ? season - line
        : line - season
      : null;

  const dir = (edge, eps = 0.15) => {
    if (edge == null) return null;
    if (edge > eps) return s;
    if (edge < -eps) return s === "OVER" ? "UNDER" : "OVER";
    return "NEUTRAL";
  };

  let hitDir = null;
  if (l5Hit != null) {
    if (l5Hit >= 0.6) hitDir = s;
    else if (l5Hit < 0.4) hitDir = s === "OVER" ? "UNDER" : "OVER";
    else hitDir = "NEUTRAL";
  }

  const fga = num(
    pick.recentFGA ??
      pick.playerState?.recentFGA ??
      pick.seasonFGA ??
      pick.playerState?.seasonFGA
  );
  const fta = num(
    pick.recentFTA ??
      pick.playerState?.recentFTA ??
      pick.seasonFTA ??
      pick.playerState?.seasonFTA
  );
  const minutes = num(
    pick.expectedMinutes ??
      pick.playerState?.recentMinutes ??
      pick.seasonMinutes ??
      pick.playerState?.seasonMinutes
  );
  const usage = num(pick.usage ?? pick.playerState?.usage ?? pick.usageRate);
  const spread = num(
    pick.spread ??
      pick.gameSpread ??
      pick.marketIntelligence?.spread ??
      pick.homeDetailedAnalysisV1?.opponent?.spread
  );
  const roleStable =
    String(
      pick.roleStability ||
        pick.decisionIntelligence?.roleStability ||
        pick.homeDetailedAnalysisV1?.role?.stability ||
        ""
    ).toUpperCase() === "STABLE" ||
    num(pick.roleStabilityScore ?? pick.minutesStabilityScore, 0) >= 60;

  const minutesDeclineEvidence =
    pick.blowoutMinutesDecline === true ||
    pick.minutesDeclineInBlowouts === true ||
    String(pick.blowoutMinutesEvidence || "").length > 0;

  return {
    side: s,
    line,
    projection,
    fair,
    l5,
    season,
    l5Hit,
    projEdge,
    fairEdge,
    l5Edge,
    seasonEdge,
    projDir: dir(projEdge),
    fairDir: dir(fairEdge),
    l5Dir: dir(l5Edge, 0.25),
    seasonDir: dir(seasonEdge, 0.25),
    hitDir,
    fga,
    fta,
    minutes,
    usage,
    spread,
    roleStable,
    minutesDeclineEvidence,
    bookCount: num(
      pick.bookCount ?? pick.books ?? pick.marketIntelligence?.bookCount,
      1
    ),
  };
}

function countAligned(features, side) {
  const signals = [
    features.projDir,
    features.fairDir,
    features.l5Dir,
    features.seasonDir,
    features.hitDir,
  ];
  const present = signals.filter((d) => d != null);
  const aligned = present.filter((d) => d === side);
  const coverage = present.length / 5;
  return { aligned: aligned.length, present: present.length, coverage };
}

/**
 * Apply calibration to a finalized sideScore from scoreSideCandidate.
 * Does not empty slots or flip sides.
 */
export function applyDirectionalCalibration({
  pick = {},
  side = "OVER",
  baselineSideScore = 0,
  baselineConfidence = 55,
  baselineTrueRisk = "MEDIUM",
  baselineEdge = null,
} = {}) {
  const s = normSide(side) || "OVER";
  const f = extractDirectionalFeatures(pick, s);
  const W = CALIBRATION_WEIGHTS;
  const differences = [];
  let delta = 0;
  let confDelta = 0;
  let riskBump = 0;

  // --- Projection edge power ---
  if (f.projEdge != null) {
    const baseEdgePts = f.projEdge * 6;
    const factor = s === "OVER" ? W.OVER_PROJECTION_EDGE_FACTOR : W.UNDER_PROJECTION_EDGE_FACTOR;
    const adj = baseEdgePts * (factor - 1);
    delta += adj;
    differences.push({
      feature: "projection_edge",
      delta: Number(adj.toFixed(2)),
      detail: `factor=${factor} edge=${f.projEdge.toFixed(2)}`,
    });
  }

  // --- Fair line ---
  if (f.fairEdge != null && f.line != null) {
    const agrees = f.fairDir === s;
    const opposes = f.fairDir && f.fairDir !== "NEUTRAL" && f.fairDir !== s;
    const factor = s === "OVER" ? W.OVER_FAIR_LINE_FACTOR : W.UNDER_FAIR_LINE_FACTOR;
    if (s === "OVER") {
      if (agrees && f.projDir === "OVER") {
        const bonus = 8 * (factor - 1); // was +8 agree
        delta += bonus;
        differences.push({
          feature: "fair_line_agreement_boost",
          delta: Number(bonus.toFixed(2)),
          detail: "projection+fair agree Over",
        });
      } else if (opposes && f.projDir === "OVER") {
        delta -= 4;
        confDelta -= 3;
        differences.push({
          feature: "proj_fair_conflict",
          delta: -4,
          detail: "projection Over / fair opposes",
        });
      } else if (agrees) {
        const bonus = 8 * (factor - 1) * 0.5;
        delta += bonus;
        differences.push({
          feature: "fair_line_partial",
          delta: Number(bonus.toFixed(2)),
          detail: "fair agrees without full proj stack",
        });
      }
    } else {
      // Under fair modest +5%
      if (agrees) {
        const bonus = 8 * (factor - 1);
        delta += bonus;
        differences.push({
          feature: "fair_line_under_boost",
          delta: Number(bonus.toFixed(2)),
          detail: "fair supports Under",
        });
      }
    }
  }

  // --- L5 / season averages (new bounded directional adds; were not in V2 base) ---
  if (f.l5Edge != null) {
    const scale = s === "OVER" ? W.OVER_L5_AVG_BONUS_SCALE : 1.0;
    const raw = Math.max(-6, Math.min(8, f.l5Edge * 2));
    const add = s === "OVER" ? raw * scale : raw; // Under season gets dedicated boost below
    if (s === "OVER") {
      delta += add;
      differences.push({
        feature: "l5_avg_vs_line",
        delta: Number(add.toFixed(2)),
        detail: `l5Edge=${f.l5Edge.toFixed(2)}`,
      });
    } else if (f.l5Dir === s) {
      delta += Math.abs(raw) * 0.5;
      differences.push({
        feature: "l5_avg_vs_line_under",
        delta: Number((Math.abs(raw) * 0.5).toFixed(2)),
        detail: `l5Edge=${f.l5Edge.toFixed(2)}`,
      });
    } else if (f.l5Dir && f.l5Dir !== "NEUTRAL") {
      delta -= 3;
      differences.push({ feature: "l5_avg_opposes_under", delta: -3, detail: "" });
    }
  }

  if (f.seasonEdge != null) {
    const scale = s === "OVER" ? W.OVER_SEASON_AVG_BONUS_SCALE : W.UNDER_SEASON_AVG_SCALE;
    if (s === "OVER") {
      const raw = Math.max(-5, Math.min(6, f.seasonEdge * 1.5));
      const add = raw * scale;
      delta += add;
      differences.push({
        feature: "season_avg_vs_line",
        delta: Number(add.toFixed(2)),
        detail: `seasonEdge=${f.seasonEdge.toFixed(2)}`,
      });
    } else {
      // Direction preserved: below line supports Under
      const supports = f.seasonDir === "UNDER";
      const opposes = f.seasonDir === "OVER";
      if (supports) {
        const add = Math.min(8, Math.abs(f.seasonEdge) * 2) * scale;
        delta += add;
        differences.push({
          feature: "season_avg_supports_under",
          delta: Number(add.toFixed(2)),
          detail: `seasonEdge=${f.seasonEdge.toFixed(2)}`,
        });
      } else if (opposes) {
        const pen = Math.min(10, Math.abs(f.seasonEdge) * 2) * scale;
        delta -= pen;
        differences.push({
          feature: "season_avg_opposes_under",
          delta: Number((-pen).toFixed(2)),
          detail: `seasonEdge=${f.seasonEdge.toFixed(2)}`,
        });
      }
    }
  }

  // --- Hit rate ---
  if (f.l5Hit != null) {
    const scale = s === "OVER" ? W.OVER_L5_HIT_SCALE : W.UNDER_L5_HIT_SCALE;
    const base =
      f.l5Hit >= 0.8 ? 7 : f.l5Hit >= 0.6 ? 3.5 : f.l5Hit >= 0.4 ? 0 : -5;
    const add = base * scale;
    delta += add;
    differences.push({
      feature: "l5_hit_rate",
      delta: Number(add.toFixed(2)),
      detail: `hit=${(f.l5Hit * 100).toFixed(0)}%`,
    });
    if (f.l5Hit >= 0.6) confDelta += 2;
    if (f.l5Hit < 0.4) confDelta -= 3;
  }

  // --- Multi-signal Over agreement ---
  if (s === "OVER") {
    const { aligned, present, coverage } = countAligned(f, "OVER");
    if (present >= 3 && aligned >= 3) {
      const full = AGREEMENT_BONUS[Math.min(5, aligned)] || 0;
      const bonus = full * coverage;
      delta += bonus;
      confDelta += aligned >= 5 ? 5 : aligned >= 4 ? 3 : 2;
      differences.push({
        feature: "over_multi_signal_agreement",
        delta: Number(bonus.toFixed(2)),
        detail: `${aligned}/${present} aligned coverage=${coverage.toFixed(2)}`,
      });
    }
  }

  // --- Thin Over conflict ---
  if (s === "OVER") {
    let conflicts = 0;
    if (f.projEdge != null && f.projEdge < 1.5) conflicts += 1;
    if (f.fairEdge != null && f.fairEdge < 1.0) conflicts += 1;
    if (f.l5Hit != null && f.l5Hit < 0.6) conflicts += 1;
    if (f.l5Edge != null && f.l5Edge <= 0) conflicts += 1;
    if (conflicts >= 3) {
      const pen = conflicts >= 4 ? -10 : -6;
      delta += pen;
      riskBump += 1;
      confDelta -= 4;
      differences.push({
        feature: "thin_over_conflict",
        delta: pen,
        detail: `conflicts=${conflicts}`,
      });
    }
  }

  // --- Thin Under danger ---
  if (s === "UNDER") {
    const thin = f.projEdge != null && f.projEdge < 1.5;
    const seasonAbove = f.seasonEdge != null && f.seasonEdge < 0; // Under edge negative => season > line
    const l5Above = f.l5Edge != null && f.l5Edge < 0;
    const weakHit = f.l5Hit != null && f.l5Hit < 0.6;
    if (thin && seasonAbove) {
      let pen = -10;
      if (l5Above && weakHit) pen = -18;
      else if (l5Above || weakHit) pen = -15;
      delta += pen;
      riskBump += 2;
      confDelta -= 6;
      differences.push({
        feature: "thin_under_danger",
        delta: pen,
        detail: `thin=${thin} seasonAbove=${seasonAbove} l5Above=${l5Above} weakHit=${weakHit}`,
      });
    }
  }

  // --- Star-usage Under caution ---
  if (s === "UNDER") {
    let volumeFlags = 0;
    if (f.minutes != null && f.minutes >= 30) volumeFlags += 1;
    if (f.fga != null && f.fga >= 12) volumeFlags += 1;
    if (f.fta != null && f.fta >= 4) volumeFlags += 1;
    if (f.usage != null && f.usage >= 22) volumeFlags += 1;
    if (f.season != null && f.line != null && f.season >= f.line + 2) volumeFlags += 1;
    if (volumeFlags >= 2) {
      const pen = volumeFlags >= 4 ? -8 : volumeFlags >= 3 ? -6 : -4;
      delta += pen;
      if (f.projEdge != null && f.projEdge < 2) riskBump += 1;
      differences.push({
        feature: "star_usage_under_caution",
        delta: pen,
        detail: `volumeFlags=${volumeFlags}`,
      });
    }
  }

  // --- Strong volume directional (not generic Under repair) ---
  if (f.fga != null && f.fga >= 12) {
    if (s === "OVER") {
      delta += 2;
      differences.push({ feature: "strong_fga_supports_over", delta: 2, detail: `fga=${f.fga}` });
    } else if (f.projEdge != null && f.projEdge < 1.5) {
      delta -= 3;
      differences.push({
        feature: "strong_fga_opposes_thin_under",
        delta: -3,
        detail: `fga=${f.fga}`,
      });
    }
  }

  // --- Role/minutes as reliability, not Under points ---
  if (f.roleStable) {
    const { aligned, present } = countAligned(f, s);
    if (present >= 3 && aligned >= Math.ceil(present * 0.6)) {
      delta += 2;
      confDelta += 2;
      differences.push({
        feature: "stable_role_reliability",
        delta: 2,
        detail: `reinforces ${s} agreement`,
      });
    } else if (present >= 2) {
      // conflicted — no directional award
      differences.push({
        feature: "stable_role_neutral",
        delta: 0,
        detail: "stable role does not decide direction alone",
      });
    }
  }

  // --- Blowout: max 2 pts and only with minutes evidence ---
  if (f.spread != null && Math.abs(f.spread) >= 10) {
    if (s === "UNDER" && f.minutesDeclineEvidence) {
      const add = Math.min(W.MAX_BLOWOUT_DIRECTIONAL, 2);
      delta += add;
      differences.push({
        feature: "blowout_with_minutes_evidence",
        delta: add,
        detail: `spread=${f.spread}`,
      });
    } else {
      differences.push({
        feature: "blowout_neutral",
        delta: 0,
        detail: "large spread without minutes-decline evidence",
      });
    }
  }

  // Confidence agreement
  if (f.projDir === s && f.fairDir === s) confDelta += 2;
  if (f.l5Dir === s && f.seasonDir === s) confDelta += 2;
  if (f.bookCount != null && f.bookCount <= 1) {
    confDelta -= 3;
    riskBump += 0.5;
  }

  confDelta = Math.max(
    -W.MAX_CONFIDENCE_DELTA,
    Math.min(W.MAX_CONFIDENCE_DELTA, confDelta)
  );

  // Keep total score move modest (small-sample philosophy)
  const uncappedDelta = delta;
  delta = Math.max(-W.MAX_ABS_SCORE_DELTA, Math.min(W.MAX_ABS_SCORE_DELTA, delta));
  if (delta !== uncappedDelta) {
    differences.push({
      feature: "delta_cap",
      delta: Number((delta - uncappedDelta).toFixed(2)),
      detail: `capped from ${uncappedDelta.toFixed(2)} to ${delta}`,
    });
  }

  const calibratedSideScore = Math.max(1, Number((baselineSideScore + delta).toFixed(2)));
  let calibratedConfidence = Math.max(
    30,
    Math.min(95, Math.round(baselineConfidence + confDelta))
  );

  let calibratedTrueRisk = String(baselineTrueRisk || "MEDIUM").toUpperCase();
  if (riskBump >= 2) calibratedTrueRisk = "HIGH";
  else if (riskBump >= 1 && calibratedTrueRisk === "LOW") calibratedTrueRisk = "MEDIUM";

  // High-risk combo labels
  const highRiskReasons = differences
    .filter((d) =>
      [
        "thin_under_danger",
        "thin_over_conflict",
        "star_usage_under_caution",
        "proj_fair_conflict",
      ].includes(d.feature)
    )
    .map((d) => d.feature);
  if (highRiskReasons.length && calibratedTrueRisk !== "HIGH" && riskBump >= 1) {
    calibratedTrueRisk = "HIGH";
  }

  return {
    calibrationVersion: DIRECTIONAL_CALIBRATION_VERSION,
    baselineSideScore: Number(baselineSideScore),
    calibratedSideScore,
    baselineConfidence: Number(baselineConfidence),
    calibratedConfidence,
    baselineTrueRisk: String(baselineTrueRisk || "MEDIUM").toUpperCase(),
    calibratedTrueRisk,
    baselineEdge,
    calibrationDelta: Number(delta.toFixed(2)),
    confidenceDelta: confDelta,
    calibrationDifferences: differences,
    features: f,
    highRiskReasons,
  };
}

/**
 * Stamp a dual-side candidate with baseline + calibrated fields.
 * `teamSideScore` becomes the calibrated score (live selection).
 */
export function stampCalibratedSideCandidate(cand = {}, scored = {}) {
  const side = normSide(cand.side || cand.pick) || "OVER";
  const cal = applyDirectionalCalibration({
    pick: cand,
    side,
    baselineSideScore: scored.sideScore ?? cand.teamSideScore ?? 0,
    baselineConfidence: scored.confidence ?? cand.confidence ?? 55,
    baselineTrueRisk: scored.trueRisk ?? cand.trueRisk ?? "MEDIUM",
    baselineEdge: scored.edge ?? cand.sideEdge ?? null,
  });

  return {
    ...cand,
    baselineTeamSideScore: cal.baselineSideScore,
    baselineOverScore: side === "OVER" ? cal.baselineSideScore : cand.baselineOverScore,
    baselineUnderScore: side === "UNDER" ? cal.baselineSideScore : cand.baselineUnderScore,
    calibratedTeamSideScore: cal.calibratedSideScore,
    calibratedOverScore: side === "OVER" ? cal.calibratedSideScore : cand.calibratedOverScore,
    calibratedUnderScore: side === "UNDER" ? cal.calibratedSideScore : cand.calibratedUnderScore,
    teamSideScore: cal.calibratedSideScore,
    baselineConfidence: cal.baselineConfidence,
    calibratedConfidence: cal.calibratedConfidence,
    confidence: cal.calibratedConfidence,
    baselineTrueRisk: cal.baselineTrueRisk,
    calibratedTrueRisk: cal.calibratedTrueRisk,
    trueRisk: cal.calibratedTrueRisk,
    riskLabel:
      cal.calibratedTrueRisk === "LOW"
        ? "Low Risk"
        : cal.calibratedTrueRisk === "HIGH"
          ? "High Risk"
          : "Medium Risk",
    calibrationDifferences: cal.calibrationDifferences,
    calibrationVersion: cal.calibrationVersion,
    calibrationDelta: cal.calibrationDelta,
    directionalFeatures: cal.features,
    highRiskReasons: cal.highRiskReasons,
  };
}

/**
 * Corrected clean calibration dataset identities (for reports / exclusion lists).
 */
export const CALIBRATION_EXCLUSIONS = Object.freeze([
  {
    id: "Awa Fam Over 9.5",
    reason: "MEMBERSHIP_MUTATION — EXCLUDED_FROM_MODEL_CALIBRATION",
  },
  {
    id: "Alyssa Thomas Over 14.5 (Aug 3 Version A)",
    reason: "LEGACY_SIX_CAP_INJECTION — EXCLUDED_FROM_MODEL_CALIBRATION",
  },
  {
    id: "Aug 1–3 GSV@PHX archive copies",
    reason: "DATE_CONTAMINATED_ARCHIVE — EXCLUDED_FROM_MODEL_CALIBRATION",
  },
]);

export const CALIBRATION_GRADE_CORRECTIONS = Object.freeze([
  {
    slateDate: "2026-07-29",
    player: "Veronica Burton",
    side: "UNDER",
    line: 12.5,
    actual: 15,
    correctGrade: "L",
    note: "stored win was wrong",
  },
  {
    slateDate: "2026-07-29",
    player: "Alyssa Thomas",
    side: "UNDER",
    line: 13.5,
    actual: 25,
    correctGrade: "L",
    note: "stored win was wrong",
  },
]);

export function gradePropCorrect(side, line, actual) {
  const s = normSide(side);
  const a = num(actual);
  const l = num(line);
  if (a == null || l == null || !s) return "PENDING";
  if (a === l) return "P";
  if (s === "OVER") return a > l ? "W" : "L";
  return a < l ? "W" : "L";
}
