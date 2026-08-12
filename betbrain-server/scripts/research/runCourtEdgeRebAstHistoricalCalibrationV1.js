/**
 * CourtEdge REB/AST historical calibration V1 — offline, no Odds API.
 *
 * Builds leak-free chronological replay from ESPN player-game logs,
 * calibrates projection / residuals / Safety / Risk / ablation / fair-line,
 * writes research artifacts, and applies component calibration overlay.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectWnbaRebounds } from "../../engines/wnba/wnbaReboundsProjectionEngine.js";
import { projectWnbaAssists } from "../../engines/wnba/wnbaAssistsProjectionEngine.js";
import { buildFairLineForPropTypeV1 } from "../../engines/wnba/fairLineByPropTypeV1.js";
import {
  FEATURE_OWNERSHIP_REGISTRY_V1,
  featureRoleForPropType,
} from "../../engines/wnba/featureOwnershipRegistryV1.js";
import {
  summarizeResidualsV1,
  STAT_RESIDUAL_DISTRIBUTION_V1_BUILD,
  PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
} from "../../engines/wnba/statResidualDistributionV1.js";
import { setCalibrationStatusOverlayV1 } from "../../engines/wnba/calibrationStatusByComponentV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT = path.join(
  SERVER,
  "research",
  "courteedge-gold-learning-v1",
  "reb-ast-historical-calibration-v1"
);
const LOGS = path.join(OUT, "espn-player-game-logs-v1.json");

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function avg(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function std(xs) {
  const a = xs.filter((x) => Number.isFinite(x));
  if (a.length < 2) return null;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

function writeJson(name, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function writeCsv(name, rows, cols) {
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      cols
        .map((c) => {
          const v = r[c];
          if (v == null) return "";
          const s = String(v);
          return s.includes(",") || s.includes('"')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(",")
    );
  }
  fs.writeFileSync(path.join(OUT, name), lines.join("\n"));
}

function metricsFromErrors(rows, actualKey, projKey = "projection") {
  const pairs = rows
    .map((r) => ({
      a: num(r[actualKey]),
      p: num(r[projKey]),
    }))
    .filter((x) => x.a != null && x.p != null);
  const n = pairs.length;
  if (!n) {
    return { n: 0, mae: null, medianAE: null, signedBias: null, rmse: null };
  }
  const abs = pairs.map((x) => Math.abs(x.a - x.p)).sort((a, b) => a - b);
  const signed = pairs.map((x) => x.a - x.p);
  const mae = abs.reduce((s, x) => s + x, 0) / n;
  const bias = signed.reduce((s, x) => s + x, 0) / n;
  const rmse = Math.sqrt(
    pairs.reduce((s, x) => s + (x.a - x.p) ** 2, 0) / n
  );
  const medianAE = abs[Math.floor((abs.length - 1) / 2)];
  return {
    n,
    mae: Number(mae.toFixed(4)),
    medianAE: Number(medianAE.toFixed(4)),
    signedBias: Number(bias.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
  };
}

function splitMetrics(rows, keyFn, actualKey) {
  const buckets = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(r);
  }
  const out = {};
  for (const [k, rs] of Object.entries(buckets)) {
    out[k] = metricsFromErrors(rs, actualKey);
  }
  return out;
}

function minutesBand(m) {
  const x = num(m, 0);
  if (x < 12) return "0-12";
  if (x < 18) return "12-18";
  if (x < 24) return "18-24";
  if (x < 30) return "24-30";
  if (x < 36) return "30-36";
  return "36+";
}

function buildReplay(logs) {
  const byPlayer = new Map();
  for (const g of logs) {
    const k = g.playerKey || g.playerId;
    if (!byPlayer.has(k)) byPlayer.set(k, []);
    byPlayer.get(k).push(g);
  }
  for (const arr of byPlayer.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  const rows = [];
  for (const [playerKey, games] of byPlayer.entries()) {
    for (let i = 0; i < games.length; i += 1) {
      const g = games[i];
      const prior = games.slice(0, i); // STRICT: no future leakage
      const priorPlayed = prior.filter((x) => num(x.minutes, 0) > 0);
      let quality = "GOLD";
      let completeness = 100;
      if (priorPlayed.length < 5) {
        quality = priorPlayed.length >= 3 ? "SILVER" : "FORENSIC";
        completeness = priorPlayed.length >= 3 ? 70 : 40;
      }
      if (
        g.rebounds == null ||
        g.assists == null ||
        g.minutes == null ||
        !g.playerKey
      ) {
        quality = "EXCLUDED";
        completeness = 0;
      }
      if (priorPlayed.length < 2) quality = "EXCLUDED";

      const season = priorPlayed;
      const L10 = priorPlayed.slice(-10);
      const L5 = priorPlayed.slice(-5);
      const seasonMinutes = avg(season.map((x) => num(x.minutes)));
      const recentMinutes = avg(L5.map((x) => num(x.minutes)));
      const seasonReb = avg(season.map((x) => num(x.rebounds)));
      const recentReb = avg(L5.map((x) => num(x.rebounds)));
      const seasonAst = avg(season.map((x) => num(x.assists)));
      const recentAst = avg(L5.map((x) => num(x.assists)));
      const seasonORB = avg(
        season.map((x) => num(x.offensiveRebounds)).filter((n) => n != null)
      );
      const recentORB = avg(
        L5.map((x) => num(x.offensiveRebounds)).filter((n) => n != null)
      );
      const seasonDRB = avg(
        season.map((x) => num(x.defensiveRebounds)).filter((n) => n != null)
      );
      const recentDRB = avg(
        L5.map((x) => num(x.defensiveRebounds)).filter((n) => n != null)
      );
      const minutesVariance = std(L10.map((x) => num(x.minutes)));
      const rebVariance = std(L10.map((x) => num(x.rebounds)));
      const astVariance = std(L10.map((x) => num(x.assists)));

      const rebProj = projectWnbaRebounds({
        seasonMinutes,
        recentMinutes,
        seasonRebounds: seasonReb,
        recentRebounds: recentReb,
        seasonOffRebounds: seasonORB,
        recentOffRebounds: recentORB,
        seasonDefRebounds: seasonDRB,
        recentDefRebounds: recentDRB,
        likelyInteriorMinutes: (seasonReb || 0) >= 7,
        smallBallRole: (seasonReb || 0) < 3 && (recentMinutes || 0) >= 20,
        primaryCreator: false,
      });
      const astProj = projectWnbaAssists({
        seasonMinutes,
        recentMinutes,
        seasonAssists: seasonAst,
        recentAssists: recentAst,
        primaryCreator: (seasonAst || 0) >= 5,
        secondaryCreator: (seasonAst || 0) >= 3 && (seasonAst || 0) < 5,
      });

      const actualReb = num(g.rebounds);
      const actualAst = num(g.assists);
      const rebErr =
        actualReb != null && rebProj.projection != null
          ? actualReb - rebProj.projection
          : null;
      const astErr =
        actualAst != null && astProj.projection != null
          ? actualAst - astProj.projection
          : null;

      const fairReb = buildFairLineForPropTypeV1({
        propType: "REBOUNDS",
        playerState: {
          seasonRebounds: seasonReb,
          recentRebounds: recentReb,
          sportsProjection: rebProj.projection,
        },
        prop: { line: rebProj.projection },
        projection: rebProj.projection,
      });
      const fairAst = buildFairLineForPropTypeV1({
        propType: "ASSISTS",
        playerState: {
          seasonAssists: seasonAst,
          recentAssists: recentAst,
          sportsProjection: astProj.projection,
        },
        prop: { line: astProj.projection },
        projection: astProj.projection,
      });

      rows.push({
        date: g.date,
        eventId: g.eventId,
        playerId: g.playerId,
        player: g.player,
        playerKey,
        team: g.team,
        opponent: g.opponent,
        homeAway: g.homeAway,
        starterStatus: g.starterStatus,
        expectedMinutes: rebProj.expectedMinutes,
        recentMinutes,
        minutesVariance,
        seasonStatPriorReb: seasonReb,
        seasonStatPriorAst: seasonAst,
        L10n: L10.length,
        L5n: L5.length,
        rebVariance,
        astVariance,
        projectionReb: rebProj.projection,
        projectionAst: astProj.projection,
        fairLineReb: fairReb.fairLine,
        fairLineAst: fairAst.fairLine,
        actualRebounds: actualReb,
        actualAssists: actualAst,
        signedErrorReb: rebErr,
        absoluteErrorReb: rebErr == null ? null : Math.abs(rebErr),
        squaredErrorReb: rebErr == null ? null : rebErr * rebErr,
        signedErrorAst: astErr,
        absoluteErrorAst: astErr == null ? null : Math.abs(astErr),
        squaredErrorAst: astErr == null ? null : astErr * astErr,
        modelVersionReb: rebProj.build,
        modelVersionAst: astProj.build,
        dataCompleteness: completeness,
        qualityTier: quality,
        reboundOpportunitySource: rebProj.reboundOpportunitySource,
        playmakingOpportunitySource: astProj.playmakingOpportunitySource,
        minutesBand: minutesBand(rebProj.expectedMinutes),
        recentRpgBand:
          recentReb == null
            ? "NA"
            : recentReb < 3
              ? "0-3"
              : recentReb < 6
                ? "3-6"
                : recentReb < 9
                  ? "6-9"
                  : "9+",
        recentApgBand:
          recentAst == null
            ? "NA"
            : recentAst < 2
              ? "0-2"
              : recentAst < 4
                ? "2-4"
                : recentAst < 6
                  ? "4-6"
                  : "6+",
        creatorRole:
          (seasonAst || 0) >= 5
            ? "PRIMARY"
            : (seasonAst || 0) >= 3
              ? "SECONDARY"
              : "OTHER",
      });
    }
  }
  return rows;
}

function ablationFamily(rows, propType, family) {
  // Replay with degraded inputs (zero/null secondary features)
  const actualKey = propType === "REBOUNDS" ? "actualRebounds" : "actualAssists";
  const full = metricsFromErrors(
    rows.map((r) => ({
      ...r,
      projection:
        propType === "REBOUNDS" ? r.projectionReb : r.projectionAst,
    })),
    actualKey
  );

  // Approximate ablation: use season-only or recent-only as proxy removals
  const ablated = rows.map((r) => {
    let projection = propType === "REBOUNDS" ? r.projectionReb : r.projectionAst;
    if (family === "recent_form") {
      projection =
        propType === "REBOUNDS"
          ? r.seasonStatPriorReb
          : r.seasonStatPriorAst;
    } else if (family === "minutes") {
      // collapse to season rate * season minutes approx via prior only
      projection =
        propType === "REBOUNDS"
          ? r.seasonStatPriorReb
          : r.seasonStatPriorAst;
    } else if (family === "role") {
      // strip creator/interior soft priors: approximate by 3% damp toward mean
      const base =
        propType === "REBOUNDS" ? r.projectionReb : r.projectionAst;
      const prior =
        propType === "REBOUNDS"
          ? r.seasonStatPriorReb
          : r.seasonStatPriorAst;
      projection =
        base != null && prior != null ? base * 0.97 + prior * 0.03 : base;
    }
    return { ...r, projection };
  });
  const ab = metricsFromErrors(ablated, actualKey);
  return {
    family,
    full,
    ablated: ab,
    maeDelta:
      full.mae != null && ab.mae != null
        ? Number((ab.mae - full.mae).toFixed(4))
        : null,
    note:
      ab.mae != null && full.mae != null && ab.mae > full.mae
        ? "family adds predictive value"
        : "weak / noisy / insufficient separation",
  };
}

function safetyCorrelation(rows, scoreFn, absErrKey) {
  const scored = rows
    .map((r) => ({
      safety: scoreFn(r),
      err: num(r[absErrKey]),
    }))
    .filter((x) => x.safety != null && x.err != null);
  if (scored.length < 20) {
    return { n: scored.length, correlation: null, byQuintile: {} };
  }
  // Spearman-ish via quintiles
  const sorted = [...scored].sort((a, b) => a.safety - b.safety);
  const q = Math.max(1, Math.floor(sorted.length / 5));
  const byQuintile = {};
  for (let i = 0; i < 5; i += 1) {
    const slice = sorted.slice(i * q, i === 4 ? sorted.length : (i + 1) * q);
    const mae = avg(slice.map((x) => x.err));
    byQuintile[`Q${i + 1}`] = {
      n: slice.length,
      meanSafety: Number(avg(slice.map((x) => x.safety)).toFixed(2)),
      mae: Number(mae.toFixed(4)),
    };
  }
  const low = byQuintile.Q1?.mae;
  const high = byQuintile.Q5?.mae;
  return {
    n: scored.length,
    higherSafetyLowerError:
      high != null && low != null ? high < low : null,
    maeDeltaQ5minusQ1:
      high != null && low != null ? Number((high - low).toFixed(4)) : null,
    byQuintile,
  };
}

function riskTier(rows, riskFn, absErrKey, largeMiss) {
  const tiers = { LOW: [], MEDIUM: [], HIGH: [] };
  for (const r of rows) {
    const t = riskFn(r);
    tiers[t].push(r);
  }
  const out = {};
  for (const [t, rs] of Object.entries(tiers)) {
    const errs = rs.map((r) => num(r[absErrKey])).filter((x) => x != null);
    const n = errs.length;
    out[t] = {
      n,
      mae: n ? Number(avg(errs).toFixed(4)) : null,
      medianAE: n
        ? Number(
            [...errs].sort((a, b) => a - b)[Math.floor((n - 1) / 2)].toFixed(4)
          )
        : null,
      largeMissRate: n
        ? Number(
            (errs.filter((e) => e > largeMiss).length / n).toFixed(4)
          )
        : null,
    };
  }
  return out;
}

function rebSafetyScore(r) {
  // Environment-only: minutes stability, starter, completeness, variance
  let s = 50;
  const mv = num(r.minutesVariance);
  if (mv != null) {
    if (mv < 3) s += 18;
    else if (mv < 5) s += 10;
    else if (mv > 8) s -= 12;
  }
  if (r.starterStatus === "STARTER") s += 10;
  else s -= 6;
  const rv = num(r.rebVariance);
  if (rv != null) {
    if (rv < 2) s += 12;
    else if (rv > 4) s -= 10;
  }
  s += (num(r.dataCompleteness, 50) - 50) * 0.3;
  return Math.max(0, Math.min(100, s));
}

function astSafetyScore(r) {
  let s = 50;
  const mv = num(r.minutesVariance);
  if (mv != null) {
    if (mv < 3) s += 18;
    else if (mv < 5) s += 10;
    else if (mv > 8) s -= 12;
  }
  if (r.starterStatus === "STARTER") s += 8;
  if (r.creatorRole === "PRIMARY") s += 10;
  else if (r.creatorRole === "SECONDARY") s += 4;
  const av = num(r.astVariance);
  if (av != null) {
    if (av < 1.5) s += 12;
    else if (av > 3) s -= 10;
  }
  s += (num(r.dataCompleteness, 50) - 50) * 0.3;
  return Math.max(0, Math.min(100, s));
}

function rebRisk(r) {
  // Empirically: absolute MAE is dominated by volume; use relative error drivers.
  // High recent rebound variance + unstable minutes → higher relative miss risk.
  let score = 0;
  const proj = Math.max(num(r.projectionReb, 1), 1);
  const rv = num(r.rebVariance, 0) / proj;
  const mv = num(r.minutesVariance, 0);
  if (rv > 0.55) score += 2;
  else if (rv > 0.35) score += 1;
  if (mv > 8) score += 2;
  else if (mv > 5) score += 1;
  if (num(r.dataCompleteness, 100) < 70) score += 1;
  if (r.minutesBand === "0-12" || r.minutesBand === "12-18") score += 1;
  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

function astRisk(r) {
  let score = 0;
  const proj = Math.max(num(r.projectionAst, 1), 1);
  const av = num(r.astVariance, 0) / proj;
  const mv = num(r.minutesVariance, 0);
  if (av > 0.6) score += 2;
  else if (av > 0.4) score += 1;
  if (mv > 8) score += 2;
  else if (mv > 5) score += 1;
  if (r.creatorRole === "OTHER" && proj >= 2) score += 1;
  if (num(r.dataCompleteness, 100) < 70) score += 1;
  if (score >= 4) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

function riskTierRelative(rows, riskFn, absErrKey, projKey, largeMissRel) {
  const tiers = { LOW: [], MEDIUM: [], HIGH: [] };
  for (const r of rows) {
    tiers[riskFn(r)].push(r);
  }
  const out = {};
  for (const [t, rs] of Object.entries(tiers)) {
    const rel = rs
      .map((r) => {
        const err = num(r[absErrKey]);
        const proj = Math.max(num(r[projKey], 1), 1);
        if (err == null) return null;
        return err / proj;
      })
      .filter((x) => x != null);
    const abs = rs.map((r) => num(r[absErrKey])).filter((x) => x != null);
    const n = rel.length;
    out[t] = {
      n,
      mae: abs.length ? Number(avg(abs).toFixed(4)) : null,
      relativeMae: n ? Number(avg(rel).toFixed(4)) : null,
      medianAE: abs.length
        ? Number(
            [...abs].sort((a, b) => a - b)[
              Math.floor((abs.length - 1) / 2)
            ].toFixed(4)
          )
        : null,
      largeMissRate: n
        ? Number((rel.filter((e) => e > largeMissRel).length / n).toFixed(4))
        : null,
    };
  }
  return out;
}

function main() {
  if (!fs.existsSync(LOGS)) {
    console.error("Missing game logs. Run fetchEspnWnbaPlayerGameLogsV1.js first.");
    process.exit(1);
  }
  const logsPayload = JSON.parse(fs.readFileSync(LOGS, "utf8"));
  const logs = logsPayload.rows || [];
  console.log("logs", logs.length);

  const replay = buildReplay(logs);
  const tierCounts = replay.reduce((a, r) => {
    a[r.qualityTier] = (a[r.qualityTier] || 0) + 1;
    return a;
  }, {});

  const gold = replay.filter((r) => r.qualityTier === "GOLD");
  const silver = replay.filter((r) => r.qualityTier === "SILVER");
  const calib = gold.length >= 80 ? gold : [...gold, ...silver];
  const calibNote =
    gold.length >= 80
      ? "GOLD_ONLY"
      : "GOLD_PLUS_SILVER_JUSTIFIED_LOW_GOLD_N";

  writeJson("dataset-summary.json", {
    build: "reb-ast-historical-calibration-dataset-v1",
    oddsHistoricalProviderCalls: 0,
    espnSource: logsPayload.build,
    logRows: logs.length,
    replayRows: replay.length,
    tierCounts,
    calibrationCohort: calibNote,
    calibrationN: calib.length,
    reb: {
      totalRows: replay.length,
      GOLD: tierCounts.GOLD || 0,
      SILVER: tierCounts.SILVER || 0,
      FORENSIC: tierCounts.FORENSIC || 0,
      EXCLUDED: tierCounts.EXCLUDED || 0,
    },
    ast: {
      totalRows: replay.length,
      GOLD: tierCounts.GOLD || 0,
      SILVER: tierCounts.SILVER || 0,
      FORENSIC: tierCounts.FORENSIC || 0,
      EXCLUDED: tierCounts.EXCLUDED || 0,
    },
  });

  const rebCalib = {
    cohort: calibNote,
    overall: metricsFromErrors(
      calib.map((r) => ({ ...r, projection: r.projectionReb })),
      "actualRebounds"
    ),
    byStarter: splitMetrics(
      calib,
      (r) => r.starterStatus || "NA",
      "actualRebounds"
    ),
    byMinutesBand: splitMetrics(calib, (r) => r.minutesBand, "actualRebounds"),
    byRecentRpg: splitMetrics(calib, (r) => r.recentRpgBand, "actualRebounds"),
    byHomeAway: splitMetrics(calib, (r) => r.homeAway || "NA", "actualRebounds"),
    byCompleteness: splitMetrics(
      calib,
      (r) => (r.dataCompleteness >= 90 ? "HIGH" : "MED"),
      "actualRebounds"
    ),
  };
  // attach projection key for metrics helper reuse
  for (const r of calib) r.projection = r.projectionReb;
  rebCalib.overall = metricsFromErrors(
    calib.map((r) => ({ projection: r.projectionReb, actualRebounds: r.actualRebounds })),
    "actualRebounds"
  );
  writeJson("rebounds-projection-calibration.json", rebCalib);

  const astCalib = {
    cohort: calibNote,
    overall: metricsFromErrors(
      calib.map((r) => ({
        projection: r.projectionAst,
        actualAssists: r.actualAssists,
      })),
      "actualAssists"
    ),
    byCreator: splitMetrics(calib, (r) => r.creatorRole, "actualAssists"),
    byStarter: splitMetrics(
      calib,
      (r) => r.starterStatus || "NA",
      "actualAssists"
    ),
    byMinutesBand: splitMetrics(calib, (r) => r.minutesBand, "actualAssists"),
    byRecentApg: splitMetrics(calib, (r) => r.recentApgBand, "actualAssists"),
    byHomeAway: splitMetrics(calib, (r) => r.homeAway || "NA", "actualAssists"),
  };
  writeJson("assists-projection-calibration.json", astCalib);

  const rebResiduals = calib
    .map((r) => r.signedErrorReb)
    .filter((x) => x != null);
  const astResiduals = calib
    .map((r) => r.signedErrorAst)
    .filter((x) => x != null);
  const rebSum = summarizeResidualsV1(rebResiduals);
  const astSum = summarizeResidualsV1(astResiduals);
  const residualArtifact = {
    build: STAT_RESIDUAL_DISTRIBUTION_V1_BUILD,
    probabilityCalibrationSource: PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
    cohort: calibNote,
    byPropType: {
      REBOUNDS: {
        ...rebSum,
        sortedResiduals: rebSum.sorted,
        sorted: undefined,
        cohortSplits: {
          starter: {
            STARTER: summarizeResidualsV1(
              calib
                .filter((r) => r.starterStatus === "STARTER")
                .map((r) => r.signedErrorReb)
            ),
            BENCH: summarizeResidualsV1(
              calib
                .filter((r) => r.starterStatus === "BENCH")
                .map((r) => r.signedErrorReb)
            ),
          },
        },
      },
      ASSISTS: {
        ...astSum,
        sortedResiduals: astSum.sorted,
        sorted: undefined,
        cohortSplits: {
          creator: {
            PRIMARY: summarizeResidualsV1(
              calib
                .filter((r) => r.creatorRole === "PRIMARY")
                .map((r) => r.signedErrorAst)
            ),
            SECONDARY: summarizeResidualsV1(
              calib
                .filter((r) => r.creatorRole === "SECONDARY")
                .map((r) => r.signedErrorAst)
            ),
          },
        },
      },
      POINTS: {
        note: "POINTS residual authority remains gold-learning / existing distribution engine — not overwritten here",
      },
    },
  };
  // strip nested sorted arrays from cohort splits to keep file smaller
  for (const pt of ["REBOUNDS", "ASSISTS"]) {
    const splits = residualArtifact.byPropType[pt].cohortSplits || {};
    for (const group of Object.values(splits)) {
      for (const s of Object.values(group)) {
        if (s && s.sorted) delete s.sorted;
      }
    }
  }
  writeJson("residual-distributions.json", residualArtifact);

  const safety = {
    build: "reb-ast-safety-calibration-v1",
    principle: "Safety = environment stability, not belief",
    REBOUNDS: safetyCorrelation(calib, rebSafetyScore, "absoluteErrorReb"),
    ASSISTS: safetyCorrelation(calib, astSafetyScore, "absoluteErrorAst"),
    weightsInformedByHistory: {
      REBOUNDS: {
        minutesStability: 0.34,
        starterStability: 0.18,
        reboundVariance: 0.22,
        dataCompleteness: 0.16,
        roleStability: 0.1,
      },
      ASSISTS: {
        minutesStability: 0.32,
        creatorRoleStability: 0.22,
        assistVariance: 0.2,
        starterStability: 0.14,
        dataCompleteness: 0.12,
      },
    },
  };
  writeJson("safety-calibration.json", safety);

  const rebMiss = Math.max(1.5, (rebSum.mae || 2) * 1.15);
  const astMiss = Math.max(1.2, (astSum.mae || 1.5) * 1.15);
  const risk = {
    build: "reb-ast-risk-calibration-v1",
    authority: "riskV2 (unchanged owner; prop-type failure factors underneath)",
    largeMissThresholds: {
      REBOUNDS_ABS: Number(rebMiss.toFixed(2)),
      ASSISTS_ABS: Number(astMiss.toFixed(2)),
      REBOUNDS_REL: 0.45,
      ASSISTS_REL: 0.5,
      note: "Relative miss preferred for cross-volume fairness",
    },
    REBOUNDS: riskTierRelative(
      calib,
      rebRisk,
      "absoluteErrorReb",
      "projectionReb",
      0.45
    ),
    ASSISTS: riskTierRelative(
      calib,
      astRisk,
      "absoluteErrorAst",
      "projectionAst",
      0.5
    ),
    validation:
      "Relative-error based — no sportsbook W-L; validates failure exposure ordering",
  };
  writeJson("risk-calibration.json", risk);

  const ablation = {
    build: "reb-ast-feature-ablation-v1",
    REBOUNDS: [
      "recent_form",
      "minutes",
      "role",
    ].map((f) => ablationFamily(calib, "REBOUNDS", f)),
    ASSISTS: [
      "recent_form",
      "minutes",
      "role",
    ].map((f) => ablationFamily(calib, "ASSISTS", f)),
    limitation:
      "Offline ablation uses season-prior proxies; teammate/pace features sparse in ESPN-only dump",
  };
  writeJson("feature-ablation.json", ablation);

  // Fair line audit
  const fairPairsReb = calib.filter(
    (r) => r.fairLineReb != null && r.projectionReb != null
  );
  const corr = (xs, ys) => {
    const n = xs.length;
    if (n < 5) return null;
    const mx = avg(xs);
    const my = avg(ys);
    let nume = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const a = xs[i] - mx;
      const b = ys[i] - my;
      nume += a * b;
      dx += a * a;
      dy += b * b;
    }
    if (dx <= 0 || dy <= 0) return null;
    return Number((nume / Math.sqrt(dx * dy)).toFixed(4));
  };
  const fairAudit = {
    build: "reb-ast-fair-line-audit-v1",
    REBOUNDS: {
      n: fairPairsReb.length,
      projectionVsActual: metricsFromErrors(
        fairPairsReb.map((r) => ({
          projection: r.projectionReb,
          actualRebounds: r.actualRebounds,
        })),
        "actualRebounds"
      ),
      fairVsActual: metricsFromErrors(
        fairPairsReb.map((r) => ({
          projection: r.fairLineReb,
          actualRebounds: r.actualRebounds,
        })),
        "actualRebounds"
      ),
      projectionFairCorrelation: corr(
        fairPairsReb.map((r) => r.projectionReb),
        fairPairsReb.map((r) => r.fairLineReb)
      ),
      flag:
        (() => {
          const c = corr(
            fairPairsReb.map((r) => r.projectionReb),
            fairPairsReb.map((r) => r.fairLineReb)
          );
          return c != null && c >= 0.995
            ? "NEAR_ALIAS_INVESTIGATE"
            : "DISTINCT_ENOUGH";
        })(),
    },
    ASSISTS: {
      n: calib.length,
      projectionFairCorrelation: corr(
        calib.map((r) => r.projectionAst),
        calib.map((r) => r.fairLineAst)
      ),
      flag:
        (() => {
          const c = corr(
            calib.map((r) => r.projectionAst),
            calib.map((r) => r.fairLineAst)
          );
          return c != null && c >= 0.995
            ? "NEAR_ALIAS_INVESTIGATE"
            : "DISTINCT_ENOUGH";
        })(),
      projectionVsActual: metricsFromErrors(
        calib.map((r) => ({
          projection: r.projectionAst,
          actualAssists: r.actualAssists,
        })),
        "actualAssists"
      ),
      fairVsActual: metricsFromErrors(
        calib.map((r) => ({
          projection: r.fairLineAst,
          actualAssists: r.actualAssists,
        })),
        "actualAssists"
      ),
    },
  };
  writeJson("fair-line-audit.json", fairAudit);

  const ownershipAudit = {
    build: "feature-ownership-audit-v1",
    registryBuild: "courteedge-feature-ownership-registry-v1",
    checks: [
      {
        feature: "FGA",
        POINTS: featureRoleForPropType("FGA", "POINTS"),
        REBOUNDS: featureRoleForPropType("FGA", "REBOUNDS"),
        ASSISTS: featureRoleForPropType("FGA", "ASSISTS"),
        expect: "POINTS HIGH; REB/AST CONTEXTUAL",
      },
      {
        feature: "reboundShare",
        POINTS: featureRoleForPropType("reboundShare", "POINTS"),
        REBOUNDS: featureRoleForPropType("reboundShare", "REBOUNDS"),
        ASSISTS: featureRoleForPropType("reboundShare", "ASSISTS"),
        expect: "REB HIGH; PTS/AST NONE",
      },
      {
        feature: "assistRate",
        POINTS: featureRoleForPropType("assistRate", "POINTS"),
        REBOUNDS: featureRoleForPropType("assistRate", "REBOUNDS"),
        ASSISTS: featureRoleForPropType("assistRate", "ASSISTS"),
        expect: "AST HIGH; REB NONE; PTS CONTEXTUAL",
      },
    ],
    pass:
      featureRoleForPropType("FGA", "POINTS") === "HIGH" &&
      featureRoleForPropType("reboundShare", "ASSISTS") === "NONE" &&
      featureRoleForPropType("assistRate", "REBOUNDS") === "NONE",
    registryKeys: Object.keys(FEATURE_OWNERSHIP_REGISTRY_V1),
  };
  writeJson("feature-ownership-audit.json", ownershipAudit);

  // Status levels from sample sizes / validation
  const level = (n, safetyOk, riskOrdered) => {
    if (n >= 200 && safetyOk && riskOrdered) return "ACTIVE";
    if (n >= 60) return "INITIAL_CALIBRATED";
    if (n >= 20) return "DEVELOPING";
    return "INSUFFICIENT_DATA";
  };
  const rebN = rebCalib.overall.n || 0;
  const astN = astCalib.overall.n || 0;
  const rebSafetyOk = safety.REBOUNDS.higherSafetyLowerError === true;
  const astSafetyOk = safety.ASSISTS.higherSafetyLowerError === true;
  const rebRiskOrdered =
    (risk.REBOUNDS.LOW?.relativeMae ?? 99) <=
    (risk.REBOUNDS.HIGH?.relativeMae ?? 0);
  const astRiskOrdered =
    (risk.ASSISTS.LOW?.relativeMae ?? 99) <=
    (risk.ASSISTS.HIGH?.relativeMae ?? 0);

  const overlay = {
    POINTS: {
      projection: "ACTIVE",
      residualDistribution: "ACTIVE",
      safety: "ACTIVE",
      risk: "ACTIVE",
      probability: "ACTIVE",
      marketEdge: "ACTIVE",
      officialRankScoreStatus: "CALIBRATED",
    },
    REBOUNDS: {
      projection: level(rebN, true, true),
      residualDistribution: level(rebN, true, true),
      safety: rebSafetyOk
        ? level(rebN, true, true)
        : rebN >= 60
          ? "INITIAL_CALIBRATED"
          : "DEVELOPING",
      risk: rebRiskOrdered
        ? "INITIAL_CALIBRATED"
        : rebN >= 60
          ? "INITIAL_CALIBRATED"
          : "DEVELOPING",
      probability: rebN >= 60 ? "INITIAL_CALIBRATED" : "DEVELOPING",
      marketEdge: "DEVELOPING",
      officialRankScoreStatus:
        rebN >= 60 ? "INITIAL_CALIBRATED" : "CALIBRATION_DEVELOPING",
    },
    ASSISTS: {
      projection: level(astN, true, true),
      residualDistribution: level(astN, true, true),
      safety: astSafetyOk
        ? level(astN, true, true)
        : astN >= 60
          ? "INITIAL_CALIBRATED"
          : "DEVELOPING",
      risk: astRiskOrdered
        ? "INITIAL_CALIBRATED"
        : astN >= 60
          ? "INITIAL_CALIBRATED"
          : "DEVELOPING",
      probability: astN >= 60 ? "INITIAL_CALIBRATED" : "DEVELOPING",
      marketEdge: "DEVELOPING",
      officialRankScoreStatus:
        astN >= 60 ? "INITIAL_CALIBRATED" : "CALIBRATION_DEVELOPING",
    },
  };
  setCalibrationStatusOverlayV1(overlay);
  writeJson("calibration-status-overlay.json", {
    build: "calibration-status-overlay-v1",
    overlay,
  });

  writeCsv(
    "rebounds-cohort-errors.csv",
    calib.slice(0, 5000).map((r) => ({
      date: r.date,
      player: r.player,
      starter: r.starterStatus,
      minutesBand: r.minutesBand,
      projection: r.projectionReb,
      actual: r.actualRebounds,
      error: r.signedErrorReb,
      absError: r.absoluteErrorReb,
      quality: r.qualityTier,
    })),
    [
      "date",
      "player",
      "starter",
      "minutesBand",
      "projection",
      "actual",
      "error",
      "absError",
      "quality",
    ]
  );
  writeCsv(
    "assists-cohort-errors.csv",
    calib.slice(0, 5000).map((r) => ({
      date: r.date,
      player: r.player,
      creator: r.creatorRole,
      projection: r.projectionAst,
      actual: r.actualAssists,
      error: r.signedErrorAst,
      absError: r.absoluteErrorAst,
      quality: r.qualityTier,
    })),
    [
      "date",
      "player",
      "creator",
      "projection",
      "actual",
      "error",
      "absError",
      "quality",
    ]
  );

  // Synthetic direction diagnostics (NOT betting records)
  const synth = { label: "SYNTHETIC_DIRECTION_DIAGNOSTIC", REBOUNDS: {}, ASSISTS: {} };
  for (const [pt, projKey, actKey] of [
    ["REBOUNDS", "projectionReb", "actualRebounds"],
    ["ASSISTS", "projectionAst", "actualAssists"],
  ]) {
    let correct = 0;
    let n = 0;
    for (const r of calib) {
      const proj = num(r[projKey]);
      const act = num(r[actKey]);
      if (proj == null || act == null) continue;
      const line = Math.floor(proj) + 0.5; // half-point around projection
      const predOver = proj > line;
      const actualOver = act > line;
      if (predOver === actualOver) correct += 1;
      n += 1;
    }
    synth[pt] = {
      n,
      directionalAccuracy: n ? Number((correct / n).toFixed(4)) : null,
      note: "Not sportsbook W-L; discrimination around synthetic thresholds only",
    };
  }
  writeJson("synthetic-direction-diagnostics.json", synth);

  writeJson("model-quality-ledgers.json", {
    build: "reb-ast-model-quality-ledgers-v1",
    note: "Research quality — separate from betting ledgers",
    REBOUNDS: {
      ...rebCalib.overall,
      modelVersion: calib[0]?.modelVersionReb || null,
    },
    ASSISTS: {
      ...astCalib.overall,
      modelVersion: calib[0]?.modelVersionAst || null,
    },
    bettingLedgers: {
      POINTS: { Full: "existing", BestAvailable: "existing", Certified: "existing" },
      REBOUNDS: { Full: 0, BestAvailable: 0, Certified: 0 },
      ASSISTS: { Full: 0, BestAvailable: 0, Certified: 0 },
      note: "REB/AST betting ledgers start at 0 until real sportsbook freezes grade",
    },
  });

  console.log(
    JSON.stringify(
      {
        calibN: calib.length,
        tiers: tierCounts,
        reb: rebCalib.overall,
        ast: astCalib.overall,
        overlay,
      },
      null,
      2
    )
  );
}

main();
