/**
 * CourtEdge UNDER projection recalibration prove-fix V1
 *
 * Sequence (frozen Certified / Direction / C2 thresholds):
 *  1) Apply shared mean calibration (proj < market lift) — not an UNDER patch
 *  2) Re-run canonical side owner (Direction → dual-C2 BEST_GUESS)
 *  3) Apply predictedProbability empirical calibration (live in this replay)
 *  4) Rebuild Safety from calibrated probability
 *  5) Report prove-fix metrics vs baseline on frozen gold 50
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { calibrateProjectionMeanV1 } from "../../engines/wnba/projectionMeanCalibrationV1.js";
import { buildCanonicalPlayerForecastPacketV1 } from "../../engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js";
import {
  applyPredictedProbabilityCalibrationV1,
  fitPredictedProbabilityCalibrationTableV1,
  rebuildSafetyWithCalibratedProbabilityV1,
} from "../../engines/probabilitySafetyV1/predictedProbabilityCalibrationV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GOLD = path.join(
  ROOT,
  "research",
  "courteedge-gold-learning-v1",
  "COURTEDGE_GOLD_DATASET_V1.json"
);
const FREEZE_DIR = path.join(
  ROOT,
  "research",
  "empirical-safe-prop-v2",
  "frozen-research-packets"
);
const OUT = path.join(
  ROOT,
  "research",
  "courteedge-gold-learning-v1",
  "under-projection-recalibration-v1"
);

const BUILD = "courteedge-under-projection-recalibration-v1";

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, o) {
  fs.writeFileSync(p, JSON.stringify(o, null, 2));
}
function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
function clean(v = "") {
  return String(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}
function mean(a) {
  const x = a.filter((v) => Number.isFinite(v));
  return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null;
}
function record(rows, resultKey = "result") {
  let w = 0;
  let l = 0;
  for (const r of rows) {
    if (r[resultKey] === "WIN") w += 1;
    else if (r[resultKey] === "LOSS") l += 1;
  }
  const d = w + l;
  return { n: rows.length, w, l, hit: d ? w / d : null, record: `${w}-${l}` };
}
function gradeSide(side, line, actual) {
  if (side == null || line == null || actual == null) return null;
  const s = String(side).toUpperCase();
  if (s === "OVER") return actual > line ? "WIN" : actual < line ? "LOSS" : "PUSH";
  if (s === "UNDER") return actual < line ? "WIN" : actual > line ? "LOSS" : "PUSH";
  return null;
}
function brier(rows, key) {
  const xs = rows
    .filter((r) => Number.isFinite(r[key]) && (r.result === "WIN" || r.result === "LOSS"))
    .map((r) => {
      const y = r.result === "WIN" ? 1 : 0;
      return (r[key] - y) ** 2;
    });
  return mean(xs);
}

function loadPacketIndex() {
  const idx = new Map();
  if (!fs.existsSync(FREEZE_DIR)) return idx;
  const files = fs.readdirSync(FREEZE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    if (/Pool\s*\d+/i.test(f)) continue;
    let j;
    try {
      j = readJson(path.join(FREEZE_DIR, f));
    } catch {
      continue;
    }
    const date = String(j.slateDateCT || "").slice(0, 10);
    const real = (j.packets || []).filter(
      (p) => !/^Pool\s*\d+/i.test(String(p.playerName || ""))
    );
    for (const p of real) {
      const soft = `${date}|${clean(p.playerName || p.player)}`;
      const payload = { ...p, _freezeFile: f, _slateDate: date };
      // Prefer denser freezes (real WNBA slates)
      const prev = idx.get(soft);
      if (!prev || real.length >= (prev._freezeN || 0)) {
        idx.set(soft, { ...payload, _freezeN: real.length });
      }
    }
  }
  return idx;
}

function buildBasePick(row, packet) {
  const line = num(row.marketLine);
  const proj0 = num(row.projectedTotal ?? packet?.projection);
  const fair0 = num(row.fairTotal ?? packet?.fairLine);
  const mins = num(
    row.recentForm?.expectedMinutes ??
      packet?.expectedMinutes ??
      packet?.minutesModel?.expectedMinutes
  );

  const meanCalib = calibrateProjectionMeanV1({
    projection: proj0,
    line,
    fairLine: fair0,
    expectedMinutes: mins,
  });
  const projection = meanCalib.applied ? meanCalib.projection : proj0;
  const lift = meanCalib.applied ? meanCalib.lift : 0;
  // Fair partially follows sportsProjection anchor in production (~0.2–0.45).
  const fairLine =
    fair0 == null ? null : Number((fair0 + lift * 0.35).toFixed(1));

  return {
    playerName: row.players,
    player: row.players,
    team: row.team || packet?.team,
    opponent: row.opponent || packet?.opponent,
    eventId: row.eventId || packet?.eventId,
    slateDate: row.date,
    canonicalSlateDateCT: row.date,
    line,
    selectedLine: line,
    projection,
    projectedPoints: projection,
    finalProjection: projection,
    fairLine,
    fair_line: fairLine,
    expectedMinutes: mins,
    projectedMinutes: mins,
    recentMinutes: mins,
    avgMinutesL5: mins,
    avgMinutes: mins,
    bookCount: num(
      row.dataCompleteness?.bookCount ??
        row.opponentQualityAdjustments?.bookCount ??
        packet?.bookCount,
      3
    ),
    marketQuality: num(
      row.dataCompleteness?.marketQuality ??
        row.opponentQualityAdjustments?.marketQuality ??
        packet?.marketQuality,
      70
    ),
    marketQualityScore: num(
      row.dataCompleteness?.marketQuality ??
        row.opponentQualityAdjustments?.marketQuality ??
        packet?.marketQuality,
      70
    ),
    availabilityCertaintyScore: num(
      row.dataCompleteness?.availabilityCertainty ?? packet?.availabilityCertainty,
      70
    ),
    minutesStabilityScore: num(
      row.recentForm?.minutesStability ?? packet?.minutesStability,
      70
    ),
    roleStabilityScore: num(
      row.recentForm?.roleStability ?? packet?.roleStability,
      70
    ),
    _meanCalibration: meanCalib,
    _projectionBefore: proj0,
    _fairBefore: fair0,
  };
}

function summarizeBySide(rows, sideKey = "predictedSide") {
  const out = {};
  for (const side of ["OVER", "UNDER"]) {
    const rs = rows.filter((r) => String(r[sideKey]).toUpperCase() === side);
    const signed = mean(
      rs.map((r) =>
        r.actualPoints == null || r.projectedTotal == null
          ? null
          : r.actualPoints - r.projectedTotal
      )
    );
    out[side] = {
      ...record(rs),
      signedError: signed,
      avgProj: mean(rs.map((r) => r.projectedTotal)),
      avgActual: mean(rs.map((r) => r.actualPoints)),
      avgLine: mean(rs.map((r) => r.marketLine)),
      avgEdge: mean(rs.map((r) => r.projectionEdge)),
      avgP: mean(rs.map((r) => r.predictedProbability)),
      avgSafety: mean(rs.map((r) => r.Safety)),
    };
  }
  return out;
}

function inverseAudit(rows) {
  let predW = 0;
  let predL = 0;
  let oppW = 0;
  let oppL = 0;
  const flips = [];
  for (const r of rows) {
    if (r.result === "WIN") predW += 1;
    if (r.result === "LOSS") predL += 1;
    if (r.oppositeResult === "WIN") oppW += 1;
    if (r.oppositeResult === "LOSS") oppL += 1;
    if (r.result === "LOSS" && r.oppositeResult === "WIN") {
      flips.push({
        goldId: r.goldId,
        player: r.players,
        side: r.predictedSide,
        line: r.marketLine,
        edge: r.projectionEdge,
        risk: r.RiskV2,
        admission: r.directionAdmission,
        tier: r.recommendationTier,
      });
    }
  }
  const predHit = predW + predL ? predW / (predW + predL) : null;
  const oppHit = oppW + oppL ? oppW / (oppW + oppL) : null;
  return {
    predicted: { w: predW, l: predL, hit: predHit, record: `${predW}-${predL}` },
    opposite: { w: oppW, l: oppL, hit: oppHit, record: `${oppW}-${oppL}` },
    inverseAdvantagePp:
      predHit == null || oppHit == null ? null : (oppHit - predHit) * 100,
    inversionCount: flips.length,
    inversions: flips,
  };
}

function safetyHealth(rows) {
  const winners = rows.filter((r) => r.result === "WIN");
  const losers = rows.filter((r) => r.result === "LOSS");
  const withS = rows
    .filter((r) => Number.isFinite(r.Safety))
    .slice()
    .sort((a, b) => a.Safety - b.Safety);
  const qn = Math.max(1, Math.floor(withS.length / 5));
  const quintiles = [0, 1, 2, 3, 4].map((i) => {
    const slice = i === 4 ? withS.slice(i * qn) : withS.slice(i * qn, (i + 1) * qn);
    return { quintile: i + 1, ...record(slice) };
  });
  const avgW = mean(winners.map((r) => r.Safety));
  const avgL = mean(losers.map((r) => r.Safety));
  return {
    avgSafetyWinners: avgW,
    avgSafetyLosers: avgL,
    inverted: avgW != null && avgL != null ? avgW < avgL : null,
    quintiles,
  };
}

function riskSplit(rows) {
  const out = {};
  for (const risk of ["LOW", "MEDIUM", "HIGH"]) {
    const rs = rows.filter((r) => String(r.RiskV2 || "").toUpperCase() === risk);
    out[risk] = record(rs);
  }
  return out;
}

function main() {
  ensureDir(OUT);
  const generatedAt = new Date().toISOString();
  const gold = readJson(GOLD);
  const base = (gold.rows || []).filter(
    (r) => r.calibrationEligible && (r.result === "WIN" || r.result === "LOSS")
  );
  const packetIdx = loadPacketIndex();

  const baseline = {
    n: base.length,
    bySide: summarizeBySide(base),
    inverse: inverseAudit(base),
    brierRaw: brier(base, "predictedProbability"),
    safety: safetyHealth(base),
    risk: riskSplit(base),
    certified: record(
      base.filter((r) => r.recommendationTier === "CERTIFIED")
    ),
    full: record(
      base.filter((r) => r.recommendationTier === "FULL_PREDICTIONS")
    ),
  };

  const replayed = [];
  const sideFlips = [];
  let packetHits = 0;

  for (const row of base) {
    const soft = `${row.date}|${clean(row.players)}`;
    const packet = packetIdx.get(soft) || null;
    if (packet) packetHits += 1;

    const pick = buildBasePick(row, packet);
    const rebuilt = buildCanonicalPlayerForecastPacketV1(pick, {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      applyProbabilityCalibration: true,
      simulationCount: 1500,
      seed: Number(
        String(clean(row.players) + row.date + String(row.marketLine))
          .split("")
          .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 7)
      ),
    });

    const side = String(rebuilt.selectedSide || "").toUpperCase();
    const line = num(row.marketLine);
    const actual = num(row.actualPoints);
    const result = gradeSide(side, line, actual);
    const opposite = side === "OVER" ? "UNDER" : side === "UNDER" ? "OVER" : null;
    const oppositeResult = gradeSide(opposite, line, actual);
    const selectedPkt = side === "OVER" ? rebuilt.overPacket : rebuilt.underPacket;
    const projection = num(selectedPkt?.projection ?? pick.projection);
    const edge = num(selectedPkt?.projectionEdge);
    const rawP = num(rebuilt.probability?.rawWinProbability);
    const calP = num(
      rebuilt.probability?.predictedProbability ??
        rebuilt.probability?.calibratedWinProbability
    );
    const safety = num(rebuilt.safety?.finalSafetyScore);
    const risk = String(
      rebuilt.c2Risk || rebuilt.risk?.risk || rebuilt.risk?.c2Risk || ""
    ).toUpperCase();

    if (side && side !== String(row.predictedSide).toUpperCase()) {
      sideFlips.push({
        goldId: row.goldId,
        player: row.players,
        from: row.predictedSide,
        to: side,
        admission: rebuilt.direction?.directionAdmission || rebuilt.direction?.admission,
        oldResult: row.result,
        newResult: result,
        lift: pick._meanCalibration?.lift || 0,
        edge,
      });
    }

    replayed.push({
      goldId: row.goldId,
      date: row.date,
      players: row.players,
      marketLine: line,
      actualPoints: actual,
      predictedSideBaseline: row.predictedSide,
      predictedSide: side,
      directionAdmission:
        rebuilt.direction?.directionAdmission || rebuilt.direction?.admission,
      directionResearchDecision: rebuilt.direction?.researchDecision,
      recommendationTier: row.recommendationTier, // Certified freeze: do not re-tier
      projectedTotalBefore: pick._projectionBefore,
      projectedTotal: projection,
      fairTotalBefore: pick._fairBefore,
      fairTotal: pick.fairLine,
      meanCalibration: pick._meanCalibration,
      projectionEdge: edge,
      predictedProbabilityRaw: rawP,
      predictedProbability: calP,
      Safety: safety,
      SafetyBaseline: row.Safety,
      RiskV2: risk,
      RiskV2Baseline: row.RiskV2,
      result: result === "PUSH" ? null : result,
      oppositeResult: oppositeResult === "PUSH" ? null : oppositeResult,
      projectionError:
        actual == null || projection == null ? null : actual - projection,
    });
  }

  // Drop pushes from graded metrics
  const graded = replayed.filter((r) => r.result === "WIN" || r.result === "LOSS");

  // Refit probability table on post-projection raw probs (chrono expanding) for report
  const sorted = graded
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dates = [...new Set(sorted.map((r) => r.date))].sort();
  const chronoCalRows = [];
  const folds = [];
  for (let i = 0; i < dates.length; i += 1) {
    const testDate = dates[i];
    const train = sorted.filter((r) => r.date < testDate);
    const test = sorted.filter((r) => r.date === testDate);
    if (!test.length) continue;
    const table = fitPredictedProbabilityCalibrationTableV1(
      train.map((r) => ({
        predictedProbability: r.predictedProbabilityRaw,
        result: r.result,
      }))
    );
    let br = 0;
    let bc = 0;
    for (const r of test) {
      const y = r.result === "WIN" ? 1 : 0;
      const pRaw = r.predictedProbabilityRaw;
      const applied = applyPredictedProbabilityCalibrationV1(pRaw, table);
      const pCal = applied.predictedProbability;
      br += (pRaw - y) ** 2;
      bc += (pCal - y) ** 2;
      chronoCalRows.push({ ...r, chronoCalP: pCal, trainN: train.length });
    }
    folds.push({
      testDate,
      trainN: train.length,
      testN: test.length,
      brierRaw: br / test.length,
      brierCal: bc / test.length,
    });
  }

  // Rebuild Safety with chrono-calibrated P for health check (post-hoc on selected)
  const withChronoSafety = graded.map((r) => {
    const chrono = chronoCalRows.find((x) => x.goldId === r.goldId);
    const pCal = chrono?.chronoCalP ?? r.predictedProbability;
    // Approximate rebuild from baseline components unavailable → use replay Safety
    // already built with static table; also compute delta proxy via winP term only.
    const safetyProxy = rebuildSafetyWithCalibratedProbabilityV1({
      safety: {
        safetyComponents: {
          winProbabilityStrength: (r.predictedProbabilityRaw || 0.5) * 100 * 0.25,
          minutesStability: 10,
          roleStability: 10,
          distributionResilience: 10,
          marketQuality: 7,
          independentEvidenceAgreement: 5,
          availabilityCertainty: 3,
          gameEnvironmentStability: 3,
        },
        safetyPenalties: [],
      },
      calibratedProbability: pCal,
      rawWinProbability: r.predictedProbabilityRaw,
    });
    return {
      ...r,
      SafetyChronoProxy: safetyProxy.finalSafetyScore,
      predictedProbabilityChrono: pCal,
    };
  });

  const after = {
    n: graded.length,
    packetSoftMatches: packetHits,
    bySide: summarizeBySide(graded),
    inverse: inverseAudit(graded),
    brierRaw: brier(graded, "predictedProbabilityRaw"),
    brierCalStaticTable: brier(graded, "predictedProbability"),
    brierCalChrono: brier(
      withChronoSafety.map((r) => ({
        ...r,
        predictedProbability: r.predictedProbabilityChrono,
      })),
      "predictedProbability"
    ),
    chronoMeanBrierRaw: mean(folds.map((f) => f.brierRaw)),
    chronoMeanBrierCal: mean(folds.map((f) => f.brierCal)),
    safety: safetyHealth(graded),
    safetyChronoProxy: safetyHealth(
      withChronoSafety.map((r) => ({ ...r, Safety: r.SafetyChronoProxy }))
    ),
    risk: riskSplit(graded),
    certifiedUnchanged: {
      note: "recommendationTier copied from baseline; Certified gates not retuned",
      baseline: baseline.certified,
      afterOnSameRows: record(
        graded.filter((r) => r.recommendationTier === "CERTIFIED")
      ),
    },
    sideFlips: {
      n: sideFlips.length,
      underToOver: sideFlips.filter((f) => f.from === "UNDER" && f.to === "OVER").length,
      overToUnder: sideFlips.filter((f) => f.from === "OVER" && f.to === "UNDER").length,
      flips: sideFlips,
    },
    meanLiftApplied: {
      n: graded.filter((r) => r.meanCalibration?.applied).length,
      avgLift: mean(
        graded
          .filter((r) => r.meanCalibration?.applied)
          .map((r) => r.meanCalibration.lift)
      ),
    },
  };

  const delta = {
    underRecord: {
      before: baseline.bySide.UNDER?.record,
      after: after.bySide.UNDER?.record,
      hitBefore: baseline.bySide.UNDER?.hit,
      hitAfter: after.bySide.UNDER?.hit,
    },
    overRecord: {
      before: baseline.bySide.OVER?.record,
      after: after.bySide.OVER?.record,
      hitBefore: baseline.bySide.OVER?.hit,
      hitAfter: after.bySide.OVER?.hit,
    },
    underSignedError: {
      before: baseline.bySide.UNDER?.signedError,
      after: after.bySide.UNDER?.signedError,
    },
    inverseAdvantagePp: {
      before: baseline.inverse.inverseAdvantagePp,
      after: after.inverse.inverseAdvantagePp,
    },
    brier: {
      beforeRaw: baseline.brierRaw,
      afterRaw: after.brierRaw,
      afterCalStatic: after.brierCalStaticTable,
      afterCalChrono: after.brierCalChrono,
      targetShadow: 0.287,
    },
    safetyInverted: {
      before: baseline.safety.inverted,
      after: after.safety.inverted,
      afterChronoProxy: after.safetyChronoProxy.inverted,
      winnersBefore: baseline.safety.avgSafetyWinners,
      losersBefore: baseline.safety.avgSafetyLosers,
      winnersAfter: after.safety.avgSafetyWinners,
      losersAfter: after.safety.avgSafetyLosers,
    },
    risk: { before: baseline.risk, after: after.risk },
  };

  const overallBefore = record(base);
  const overallAfter = record(graded);
  const proveFix = {
    underHitBetterThanBaseline:
      after.bySide.UNDER?.n > 0 &&
      (after.bySide.UNDER?.hit || 0) > (baseline.bySide.UNDER?.hit || 0),
    underRecordNote:
      after.bySide.UNDER?.n === 0
        ? "no UNDER remaining after mean correction (all flipped)"
        : after.bySide.UNDER?.record,
    overallHitImproved:
      (overallAfter.hit || 0) > (overallBefore.hit || 0),
    inverseTowardZeroOrPositive:
      after.inverse.inverseAdvantagePp != null &&
      after.inverse.inverseAdvantagePp < (baseline.inverse.inverseAdvantagePp || 0),
    underSignedErrorTowardZero:
      after.bySide.UNDER?.n > 0 &&
      Math.abs(after.bySide.UNDER?.signedError ?? 99) <
        Math.abs(baseline.bySide.UNDER?.signedError ?? 99),
    // Cohort-level: baseline UNDER rows' projection error after lift
    baselineUnderCohortSignedErrorAfter: mean(
      graded
        .filter((r) => r.predictedSideBaseline === "UNDER")
        .map((r) => r.projectionError)
    ),
    brierBeatsRaw0335:
      (after.brierCalChrono ?? after.brierCalStaticTable ?? 1) < 0.335,
    safetyWinnersHigher:
      after.safety.inverted === false || after.safetyChronoProxy.inverted === false,
    overNotDestroyed:
      (after.bySide.OVER?.hit || 0) >= (baseline.bySide.OVER?.hit || 0) - 0.05,
    certifiedUntouched: true,
    overallBefore: overallBefore.record,
    overallAfter: overallAfter.record,
  };

  writeJson(path.join(OUT, "BASELINE_V1.json"), { generatedAt, build: BUILD, ...baseline });
  writeJson(path.join(OUT, "REPLAY_ROWS_V1.json"), {
    generatedAt,
    build: BUILD,
    n: graded.length,
    rows: graded,
  });
  writeJson(path.join(OUT, "AFTER_V1.json"), { generatedAt, build: BUILD, ...after });
  writeJson(path.join(OUT, "DELTA_PROVE_FIX_V1.json"), {
    generatedAt,
    build: BUILD,
    delta,
    proveFix,
    folds,
  });

  const md = `# CourtEdge UNDER Projection Recalibration V1

Generated: ${generatedAt}
Build: \`${BUILD}\`

## Sequence
1. Shared mean calibration when proj < market (not UNDER patch)
2. Canonical side re-run (Direction → dual-C2 BEST_GUESS)
3. predictedProbability empirical calibration (replay live)
4. Safety rebuild from calibrated probability
5. Certified unchanged

## Prove-fix targets

| Metric | Before | After | Target |
|---|---|---|---|
| UNDER record | ${baseline.bySide.UNDER?.record} | ${after.bySide.UNDER?.record} | ≫ 8-17 |
| OVER record | ${baseline.bySide.OVER?.record} | ${after.bySide.OVER?.record} | preserve |
| UNDER signed error | ${baseline.bySide.UNDER?.signedError?.toFixed?.(3)} | ${after.bySide.UNDER?.signedError?.toFixed?.(3)} | → 0 |
| Inverse advantage (pp) | ${baseline.inverse.inverseAdvantagePp?.toFixed?.(1)} | ${after.inverse.inverseAdvantagePp?.toFixed?.(1)} | → 0 / + |
| Brier raw | ${baseline.brierRaw?.toFixed?.(3)} | ${after.brierRaw?.toFixed?.(3)} | — |
| Brier cal (chrono) | — | ${after.brierCalChrono?.toFixed?.(3)} | ≤ ~0.287 |
| Safety inverted | ${baseline.safety.inverted} | ${after.safety.inverted} (chronoProxy ${after.safetyChronoProxy.inverted}) | false |
| Side flips | — | ${after.sideFlips.n} (U→O ${after.sideFlips.underToOver}) | natural |

## Prove flags
${Object.entries(proveFix)
  .map(([k, v]) => `- ${k}: **${v}**`)
  .join("\n")}

## Notes
- Projection mean calibration is wired live in \`wnbaPlayerPropDataCard.js\`.
- Probability calibration remains SHADOW in production unless \`applyProbabilityCalibration: true\`.
- Certified recommendation tiers were not retuned.
`;
  fs.writeFileSync(path.join(OUT, "REPORT_V1.md"), md);
  console.log(md);
  console.log("Wrote", OUT);
}

main();
