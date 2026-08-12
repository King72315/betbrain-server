/**
 * CourtEdge Safety Environment Rebuild V1
 *
 * Principle: Safety = evidence-environment stability / dependability
 *            NOT model belief strength (that is predictedProbability).
 *
 * 1) Autopsy every Safety component (+ Trust/Reliability/edge/etc.)
 * 2) Rebuild Safety without winProbabilityStrength
 * 3) Revalidate RiskV2 ordering with rebuilt Safety
 * 4) Monitor OVER vs UNDER (no quota)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildPropSafetyEnvironmentV2 } from "../../engines/probabilitySafetyV1/propSafetyEnvironmentV2.js";
import { classifyRiskEmpiricalV2 } from "../../engines/empiricalSafePropV2/reliabilityModelV2.js";
import { calibrateProjectionMeanV1 } from "../../engines/wnba/projectionMeanCalibrationV1.js";
import { buildCanonicalPlayerForecastPacketV1 } from "../../engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js";

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
  "safety-environment-rebuild-v1"
);
const BUILD = "courteedge-safety-environment-rebuild-v1";

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
function record(rows, key = "result") {
  let w = 0;
  let l = 0;
  for (const r of rows) {
    if (r[key] === "WIN") w += 1;
    else if (r[key] === "LOSS") l += 1;
  }
  const d = w + l;
  return { n: rows.length, w, l, hit: d ? w / d : null, record: `${w}-${l}` };
}

/** Pearson correlation of feature vs WIN=1/LOSS=0 */
function corrOutcome(rows, fn) {
  const pairs = rows
    .map((r) => {
      const x = fn(r);
      const y = r.result === "WIN" ? 1 : r.result === "LOSS" ? 0 : null;
      return Number.isFinite(x) && y != null ? [x, y] : null;
    })
    .filter(Boolean);
  if (pairs.length < 5) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let nume = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    nume += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return null;
  return nume / Math.sqrt(dx * dy);
}

function corrPair(rows, fnA, fnB) {
  const pairs = rows
    .map((r) => {
      const a = fnA(r);
      const b = fnB(r);
      return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
    })
    .filter(Boolean);
  if (pairs.length < 5) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let nume = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < pairs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    nume += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return null;
  return nume / Math.sqrt(dx * dy);
}

function loadPacketIndex() {
  const idx = new Map();
  if (!fs.existsSync(FREEZE_DIR)) return idx;
  for (const f of fs.readdirSync(FREEZE_DIR).filter((x) => x.endsWith(".json"))) {
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
      const prev = idx.get(soft);
      if (!prev || real.length >= (prev._freezeN || 0)) {
        idx.set(soft, { ...p, _freezeFile: f, _freezeN: real.length });
      }
    }
  }
  return idx;
}

function enrich(row, packet) {
  const side = String(row.predictedSide || "").toUpperCase();
  const selected =
    side === "OVER" ? packet?.overPacket : side === "UNDER" ? packet?.underPacket : null;
  const comps =
    selected?.safety?.safetyComponents ||
    packet?.safety?.safetyComponents ||
    null;
  return {
    ...row,
    _packet: packet,
    safetyComponents: comps,
    selectedEdge: num(selected?.projectionEdge ?? row.projectionEdge),
    selectedRawP: num(selected?.rawWinProbability ?? row.predictedProbability),
    minutesStability: num(
      row.recentForm?.minutesStability ?? packet?.minutesStability
    ),
    roleStability: num(row.recentForm?.roleStability ?? packet?.roleStability),
    expectedMinutes: num(
      row.recentForm?.expectedMinutes ?? packet?.expectedMinutes
    ),
    bookCount: num(
      row.dataCompleteness?.bookCount ??
        row.opponentQualityAdjustments?.bookCount ??
        packet?.bookCount
    ),
    marketQuality: num(
      row.dataCompleteness?.marketQuality ??
        row.opponentQualityAdjustments?.marketQuality ??
        packet?.marketQuality
    ),
    conflictIndex: num(
      row.opponentQualityAdjustments?.conflictIndex ?? packet?.conflictIndex
    ),
    availabilityCertainty: num(
      row.dataCompleteness?.availabilityCertainty ?? packet?.availabilityCertainty
    ),
    majorFailurePathCount: num(
      packet?.majorFailurePathCount ??
        row.dataCompleteness?.majorFailurePathCount,
      0
    ),
    Reliability: num(row.Reliability ?? packet?.reliabilityProbability),
    Trust: num(row.Trust ?? packet?.trustScore),
    Safety: num(row.Safety ?? packet?.SafetyScore),
  };
}

function decideAction({
  name,
  weight,
  expectedDirection,
  corr,
  delta,
  dupWithP,
  isBelief,
}) {
  // expectedDirection: +1 higher is safer/better, -1 higher is riskier
  const aligned =
    corr == null
      ? null
      : expectedDirection > 0
        ? corr > 0.05
        : expectedDirection < 0
          ? corr < -0.05
          : Math.abs(corr) < 0.05;

  if (isBelief || name === "winProbabilityStrength" || name === "rawWinProbability" || name === "predictedProbability") {
    return {
      action: "REMOVE_FROM_SAFETY",
      rationale:
        "Belief/confidence signal — belongs in predictedProbability, not evidence-environment Safety.",
    };
  }
  if (name === "Trust" || name === "Reliability") {
    return {
      action: "REMOVE_FROM_SAFETY",
      rationale:
        "Separate authorities that already consume Safety + probability. Embedding them makes Safety a second confidence formula.",
    };
  }
  if (name === "absEdge" || name === "projectionEdge" || name === "edge") {
    return {
      action: "REMOVE_FROM_SAFETY",
      rationale:
        "Directional lean / edge magnitude is probability/side strength, not environment stability.",
    };
  }
  if (dupWithP != null && Math.abs(dupWithP) >= 0.55 && (isBelief || weight >= 0.1)) {
    return {
      action: "REMOVE_OR_REDUCE",
      rationale: `Highly correlated with probability (r=${dupWithP.toFixed(2)}); duplicates belief.`,
    };
  }
  if (aligned === false && corr != null && Math.abs(corr) >= 0.08) {
    return {
      action: expectedDirection > 0 && corr < 0 ? "INVERT_OR_REDUCE" : "REDUCE",
      rationale: `Opposite of expected direction vs outcome (r=${corr.toFixed(2)}, ΔW−L=${delta?.toFixed?.(2)}).`,
    };
  }
  if (corr != null && Math.abs(corr) < 0.04) {
    return {
      action: "REDUCE",
      rationale: "Near-zero outcome association on this cohort; keep only if structural.",
    };
  }
  if (aligned === true) {
    return {
      action: "KEEP",
      rationale: `Aligned with evidence-environment role (r=${corr.toFixed(2)}).`,
    };
  }
  return {
    action: "KEEP_WATCH",
    rationale: "Sparse / mixed signal — keep as environment feature with modest weight.",
  };
}

function autopsy(rows) {
  const winners = rows.filter((r) => r.result === "WIN");
  const losers = rows.filter((r) => r.result === "LOSS");

  const features = [
    {
      component: "winProbabilityStrength",
      weight: 0.25,
      expectedDirection: 1,
      fn: (r) => num(r.safetyComponents?.winProbabilityStrength),
      isBelief: true,
      duplicatedElsewhere: "predictedProbability / rawWinProbability (25% of Safety)",
    },
    {
      component: "rawWinProbability",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.selectedRawP ?? r.predictedProbability,
      isBelief: true,
      duplicatedElsewhere: "Safety.winProbabilityStrength, Trust, Reliability logistic",
    },
    {
      component: "predictedProbability",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.predictedProbability,
      isBelief: true,
      duplicatedElsewhere: "same belief channel as rawP",
    },
    {
      component: "minutesStability",
      weight: 0.15,
      expectedDirection: 1,
      fn: (r) =>
        num(r.safetyComponents?.minutesStability) ??
        (num(r.minutesStability) != null ? num(r.minutesStability) * 0.15 : null),
      rawFn: (r) => r.minutesStability,
      isBelief: false,
      duplicatedElsewhere: "Reliability logistic, Trust penalties, Risk floors",
    },
    {
      component: "roleStability",
      weight: 0.15,
      expectedDirection: 1,
      fn: (r) =>
        num(r.safetyComponents?.roleStability) ??
        (num(r.roleStability) != null ? num(r.roleStability) * 0.15 : null),
      rawFn: (r) => r.roleStability,
      isBelief: false,
      duplicatedElsewhere: "Reliability logistic, Risk floors",
    },
    {
      component: "distributionResilience",
      weight: 0.15,
      expectedDirection: 1,
      fn: (r) => num(r.safetyComponents?.distributionResilience),
      isBelief: false,
      duplicatedElsewhere: "volatility / distributionWidth (inverse)",
    },
    {
      component: "marketQuality",
      weight: 0.1,
      expectedDirection: 1,
      fn: (r) =>
        num(r.safetyComponents?.marketQuality) ??
        (num(r.marketQuality) != null ? num(r.marketQuality) * 0.1 : null),
      rawFn: (r) => r.marketQuality,
      isBelief: false,
      duplicatedElsewhere: "Reliability (soft), Trust soft, Risk soft",
    },
    {
      component: "bookCount",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.bookCount,
      isBelief: false,
      duplicatedElsewhere: "Reliability logistic (tiny), Trust book penalties",
    },
    {
      component: "independentEvidenceAgreement",
      weight: 0.1,
      expectedDirection: 1,
      fn: (r) => num(r.safetyComponents?.independentEvidenceAgreement),
      isBelief: false,
      duplicatedElsewhere: "supportingCount — often rises with edge/agreement (belief-adjacent)",
    },
    {
      component: "availabilityCertainty",
      weight: 0.05,
      expectedDirection: 1,
      fn: (r) =>
        num(r.safetyComponents?.availabilityCertainty) ??
        (num(r.availabilityCertainty) != null
          ? num(r.availabilityCertainty) * 0.05
          : null),
      rawFn: (r) => r.availabilityCertainty,
      isBelief: false,
      duplicatedElsewhere: "Safety penalty AVAILABILITY, Risk hard blocks",
    },
    {
      component: "gameEnvironmentStability",
      weight: 0.05,
      expectedDirection: 1,
      fn: (r) => num(r.safetyComponents?.gameEnvironmentStability),
      isBelief: false,
      duplicatedElsewhere: "conflictIndex inverse; also Safety CONFLICT penalty",
    },
    {
      component: "conflictIndex",
      weight: "penalty",
      expectedDirection: -1,
      fn: (r) => r.conflictIndex,
      isBelief: false,
      duplicatedElsewhere: "Safety gameEnvironment + CONFLICT penalty; Risk; Reliability; Trust",
    },
    {
      component: "majorFailurePathCount",
      weight: "penalty",
      expectedDirection: -1,
      fn: (r) => r.majorFailurePathCount,
      isBelief: false,
      duplicatedElsewhere: "Safety MAJOR_FAILURE_PATHS; Risk vetoes; Trust",
    },
    {
      component: "absEdge",
      weight: null,
      expectedDirection: 1,
      fn: (r) => (r.selectedEdge == null ? null : Math.abs(r.selectedEdge)),
      isBelief: true,
      duplicatedElsewhere: "Reliability (strong), Trust projectionEdgeSupport, Risk floors",
    },
    {
      component: "projectionEdge",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.selectedEdge,
      isBelief: true,
      duplicatedElsewhere: "same as absEdge / lean strength",
    },
    {
      component: "Reliability",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.Reliability,
      isBelief: true,
      duplicatedElsewhere: "consumes Safety+rawP+edge — not a Safety input",
    },
    {
      component: "Trust",
      weight: null,
      expectedDirection: 1,
      fn: (r) => r.Trust,
      isBelief: true,
      duplicatedElsewhere: "consumes Reliability+rawP+Safety+edge — not a Safety input",
    },
    {
      component: "Safety (legacy)",
      weight: 1,
      expectedDirection: 1,
      fn: (r) => r.Safety,
      isBelief: false,
      duplicatedElsewhere: "composite under autopsy",
    },
  ];

  const rowsOut = features.map((f) => {
    const wAvg = mean(winners.map(f.fn));
    const lAvg = mean(losers.map(f.fn));
    const delta = wAvg != null && lAvg != null ? wAvg - lAvg : null;
    const c = corrOutcome(rows, f.fn);
    const rawCorr =
      f.rawFn != null ? corrOutcome(rows, f.rawFn) : null;
    const dupWithP = corrPair(
      rows,
      f.fn,
      (r) => r.selectedRawP ?? r.predictedProbability
    );
    const decision = decideAction({
      name: f.component,
      weight: f.weight,
      expectedDirection: f.expectedDirection,
      corr: rawCorr ?? c,
      delta,
      dupWithP,
      isBelief: f.isBelief,
    });
    return {
      component: f.component,
      weight: f.weight,
      expectedDirection:
        f.expectedDirection > 0
          ? "higher → safer / better"
          : f.expectedDirection < 0
            ? "higher → riskier"
            : "neutral",
      avgWinner: wAvg,
      avgLoser: lAvg,
      deltaWinnerMinusLoser: delta,
      corrWithOutcome: c,
      corrRawIfDifferent: rawCorr,
      corrWithProbability: dupWithP,
      independentInformation:
        dupWithP == null
          ? "unknown"
          : Math.abs(dupWithP) < 0.35
            ? "yes_mostly"
            : Math.abs(dupWithP) < 0.55
              ? "partial"
              : "no_mostly_duplicate",
      duplicatedElsewhere: f.duplicatedElsewhere,
      invertedVsExpected:
        c == null
          ? null
          : f.expectedDirection > 0
            ? c < -0.05
            : f.expectedDirection < 0
              ? c > 0.05
              : false,
      action: decision.action,
      rationale: decision.rationale,
    };
  });

  rowsOut.sort(
    (a, b) => (a.deltaWinnerMinusLoser ?? 0) - (b.deltaWinnerMinusLoser ?? 0)
  );
  return rowsOut;
}

function safetyQuintiles(rows, key) {
  const withS = rows
    .filter((r) => Number.isFinite(r[key]))
    .slice()
    .sort((a, b) => a[key] - b[key]);
  const qn = Math.max(1, Math.floor(withS.length / 5));
  return [0, 1, 2, 3, 4].map((i) => {
    const slice = i === 4 ? withS.slice(i * qn) : withS.slice(i * qn, (i + 1) * qn);
    return {
      quintile: i + 1,
      min: slice[0]?.[key] ?? null,
      max: slice[slice.length - 1]?.[key] ?? null,
      ...record(slice),
    };
  });
}

function gradeSide(side, line, actual) {
  if (side == null || line == null || actual == null) return null;
  const s = String(side).toUpperCase();
  if (s === "OVER") return actual > line ? "WIN" : actual < line ? "LOSS" : "PUSH";
  if (s === "UNDER") return actual < line ? "WIN" : actual > line ? "LOSS" : "PUSH";
  return null;
}

function rebuildRows(base, packetIdx) {
  const out = [];
  for (const row of base) {
    const packet = packetIdx.get(`${row.date}|${clean(row.players)}`) || null;
    const line = num(row.marketLine);
    const proj0 = num(row.projectedTotal);
    const fair0 = num(row.fairTotal);
    const mins = num(row.recentForm?.expectedMinutes ?? packet?.expectedMinutes);
    const cal = calibrateProjectionMeanV1({
      projection: proj0,
      line,
      fairLine: fair0,
      expectedMinutes: mins,
    });
    const projection = cal.applied ? cal.projection : proj0;
    const fairLine =
      fair0 == null ? null : Number((fair0 + (cal.lift || 0) * 0.35).toFixed(1));
    const pick = {
      playerName: row.players,
      line,
      selectedLine: line,
      projection,
      projectedPoints: projection,
      finalProjection: projection,
      fairLine,
      expectedMinutes: mins,
      projectedMinutes: mins,
      recentMinutes: mins,
      avgMinutesL5: mins,
      avgMinutes: mins,
      bookCount: num(row.dataCompleteness?.bookCount ?? packet?.bookCount, 3),
      marketQuality: num(
        row.dataCompleteness?.marketQuality ?? packet?.marketQuality,
        70
      ),
      marketQualityScore: num(
        row.dataCompleteness?.marketQuality ?? packet?.marketQuality,
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
      slateDate: row.date,
    };

    // A/B: legacy belief-weighted Safety vs environment Safety (same side owner).
    const legacyPkt = buildCanonicalPlayerForecastPacketV1(pick, {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      applyProbabilityCalibration: false,
      useSafetyEnvironmentV2: false,
      simulationCount: 1200,
      seed: 11,
    });
    const rebuilt = buildCanonicalPlayerForecastPacketV1(pick, {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      applyProbabilityCalibration: false,
      useSafetyEnvironmentV2: true,
      simulationCount: 1200,
      seed: 11,
    });
    const side = String(rebuilt.selectedSide || "").toUpperCase();
    const selected = side === "OVER" ? rebuilt.overPacket : rebuilt.underPacket;
    const legacySelected =
      side === "OVER" ? legacyPkt.overPacket : legacyPkt.underPacket;
    const minutesModel = selected?.minutes || {
      minutesStabilityScore: pick.minutesStabilityScore,
      expectedMinutes: mins,
    };
    const roleModel = selected?.role || {
      roleStabilityScore: pick.roleStabilityScore,
    };
    const marketModel = selected?.market || {
      marketQualityScore: pick.marketQualityScore,
      bookCount: pick.bookCount,
    };
    const availModel = {
      availabilityCertaintyScore:
        num(selected?.availability?.availabilityCertaintyScore) ??
        pick.availabilityCertaintyScore,
    };
    const conflictModel = selected?.conflict || {
      conflictIndex: packet?.conflictIndex ?? 0,
      supportingCount: packet?.supportingEvidenceFamilies?.length ?? 3,
      projectionFairAgreement: selected?.projectionFairAgreement ?? true,
    };
    const failureModel = selected?.failure || {
      majorFailurePathCount: packet?.majorFailurePathCount ?? 0,
    };

    const envSafety = buildPropSafetyEnvironmentV2({
      minutes: minutesModel,
      role: roleModel,
      distribution: selected?.distribution || rebuilt.distribution,
      market: marketModel,
      conflict: conflictModel,
      failure: failureModel,
      availability: availModel,
    });

    const riskV2 = classifyRiskEmpiricalV2({
      pick: { ...pick, side },
      rawWinProbability: selected?.rawWinProbability,
      safety: envSafety,
      minutes: minutesModel,
      role: roleModel,
      market: marketModel,
      conflict: conflictModel,
      failure: failureModel,
      availability: availModel,
      volume: selected?.volume || {},
      distribution: selected?.distribution || {},
    });
    const riskLegacy = classifyRiskEmpiricalV2({
      pick: { ...pick, side },
      rawWinProbability: legacySelected?.rawWinProbability,
      safety: legacySelected?.safety,
      minutes: minutesModel,
      role: roleModel,
      market: marketModel,
      conflict: conflictModel,
      failure: failureModel,
      availability: availModel,
      volume: selected?.volume || {},
      distribution: selected?.distribution || {},
    });

    const actual = num(row.actualPoints);
    const result = gradeSide(side, line, actual);
    const opposite = side === "OVER" ? "UNDER" : "UNDER" === side ? "OVER" : null;
    const oppSide = side === "OVER" ? "UNDER" : "OVER";
    const oppositeResult = gradeSide(oppSide, line, actual);

    out.push({
      goldId: row.goldId,
      date: row.date,
      players: row.players,
      marketLine: line,
      actualPoints: actual,
      predictedSide: side,
      predictedSideBaseline: row.predictedSide,
      result: result === "PUSH" ? null : result,
      oppositeResult: oppositeResult === "PUSH" ? null : oppositeResult,
      predictedProbability: num(selected?.rawWinProbability),
      SafetyLegacy: num(legacySelected?.safety?.finalSafetyScore),
      SafetyEnvV2: envSafety.finalSafetyScore,
      safetyComponentsV2: envSafety.safetyComponents,
      safetyComponentRawsV2: envSafety.safetyComponentRaws,
      safetyPenaltiesV2: envSafety.safetyPenalties,
      RiskV2Legacy: String(riskLegacy.risk || "").toUpperCase(),
      RiskV2Env: String(riskV2.risk || "").toUpperCase(),
      Reliability: num(riskV2.reliabilityProbability),
      Trust: num(riskV2.trustScore),
      recommendationTier: row.recommendationTier,
      projectionEdge: num(selected?.projectionEdge),
    });
  }
  return out.filter((r) => r.result === "WIN" || r.result === "LOSS");
}

function riskMonotonic(rows, riskKey) {
  const order = ["LOW", "MEDIUM", "HIGH"];
  const by = {};
  for (const risk of order) {
    by[risk] = record(rows.filter((r) => r[riskKey] === risk));
  }
  const hits = order.map((r) => by[r].hit).filter((h) => h != null);
  let monotone = true;
  for (let i = 1; i < hits.length; i += 1) {
    if (hits[i] > hits[i - 1] + 0.02) monotone = false; // HIGH should not beat LOW
  }
  // Prefer LOW >= MEDIUM >= HIGH
  const low = by.LOW.hit;
  const med = by.MEDIUM.hit;
  const high = by.HIGH.hit;
  const ordered =
    (low == null || med == null || low + 1e-9 >= med) &&
    (med == null || high == null || med + 1e-9 >= high) &&
    (low == null || high == null || low + 1e-9 >= high);
  return { byRisk: by, monotonePreferred: ordered, note: monotone };
}

function corrSafetyRisk(rows, safetyKey, riskKey) {
  const map = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return corrPair(
    rows,
    (r) => r[safetyKey],
    (r) => map[r[riskKey]]
  );
}

function main() {
  ensureDir(OUT);
  const generatedAt = new Date().toISOString();
  const gold = readJson(GOLD);
  const base = (gold.rows || []).filter(
    (r) => r.calibrationEligible && (r.result === "WIN" || r.result === "LOSS")
  );
  const packetIdx = loadPacketIndex();
  const enriched = base.map((r) =>
    enrich(r, packetIdx.get(`${r.date}|${clean(r.players)}`) || null)
  );

  const componentAutopsy = autopsy(enriched);
  writeJson(path.join(OUT, "COMPONENT_AUTOPSY_V1.json"), {
    generatedAt,
    build: BUILD,
    n: enriched.length,
    principle:
      "Safety = evidence-environment stability, not model belief strength",
    components: componentAutopsy,
  });

  const rebuilt = rebuildRows(base, packetIdx);
  writeJson(path.join(OUT, "REBUILD_ROWS_V1.json"), {
    generatedAt,
    build: BUILD,
    n: rebuilt.length,
    rows: rebuilt,
  });

  const legacyHealth = {
    avgSafetyWinners: mean(
      rebuilt.filter((r) => r.result === "WIN").map((r) => r.SafetyLegacy)
    ),
    avgSafetyLosers: mean(
      rebuilt.filter((r) => r.result === "LOSS").map((r) => r.SafetyLegacy)
    ),
    quintiles: safetyQuintiles(rebuilt, "SafetyLegacy"),
  };
  legacyHealth.inverted =
    legacyHealth.avgSafetyWinners < legacyHealth.avgSafetyLosers;

  const envHealth = {
    avgSafetyWinners: mean(
      rebuilt.filter((r) => r.result === "WIN").map((r) => r.SafetyEnvV2)
    ),
    avgSafetyLosers: mean(
      rebuilt.filter((r) => r.result === "LOSS").map((r) => r.SafetyEnvV2)
    ),
    quintiles: safetyQuintiles(rebuilt, "SafetyEnvV2"),
    corrWithOutcome: corrOutcome(rebuilt, (r) => r.SafetyEnvV2),
    corrWithProbability: corrPair(
      rebuilt,
      (r) => r.SafetyEnvV2,
      (r) => r.predictedProbability
    ),
  };
  envHealth.inverted = envHealth.avgSafetyWinners < envHealth.avgSafetyLosers;

  const riskLegacy = riskMonotonic(rebuilt, "RiskV2Legacy");
  const riskEnv = riskMonotonic(rebuilt, "RiskV2Env");
  const safetyRiskCorrLegacy = corrSafetyRisk(
    rebuilt,
    "SafetyLegacy",
    "RiskV2Legacy"
  );
  const safetyRiskCorrEnv = corrSafetyRisk(rebuilt, "SafetyEnvV2", "RiskV2Env");

  const sideMonitor = {
    OVER: record(rebuilt.filter((r) => r.predictedSide === "OVER")),
    UNDER: record(rebuilt.filter((r) => r.predictedSide === "UNDER")),
    baselineOVER: record(base.filter((r) => r.predictedSide === "OVER")),
    baselineUNDER: record(base.filter((r) => r.predictedSide === "UNDER")),
    note: "No quota / forced balance — monitor only after mean calibration + side re-run",
  };

  const certified = record(
    rebuilt.filter((r) => r.recommendationTier === "CERTIFIED")
  );

  const summary = {
    generatedAt,
    build: BUILD,
    principle: {
      safetyMeans: "How stable/dependable is the evidence environment?",
      safetyDoesNotMean: "How strongly does the model believe the selected side?",
      allowedExample: [
        { predictedProbability: 0.71, Safety: 48, meaning: "strong lean, volatile context" },
        { predictedProbability: 0.59, Safety: 82, meaning: "modest edge, stable situation" },
      ],
    },
    autopsyHighlights: componentAutopsy
      .filter((c) =>
        [
          "winProbabilityStrength",
          "rawWinProbability",
          "minutesStability",
          "roleStability",
          "marketQuality",
          "bookCount",
          "Trust",
          "Reliability",
          "absEdge",
          "conflictIndex",
          "Safety (legacy)",
        ].includes(c.component)
      )
      .map((c) => ({
        component: c.component,
        action: c.action,
        corr: c.corrWithOutcome,
        delta: c.deltaWinnerMinusLoser,
        dupP: c.corrWithProbability,
      })),
    legacySafety: legacyHealth,
    environmentSafetyV2: envHealth,
    riskV2: {
      legacy: riskLegacy,
      afterEnvSafety: riskEnv,
      corrSafetyVsRiskTierLegacy: safetyRiskCorrLegacy,
      corrSafetyVsRiskTierEnv: safetyRiskCorrEnv,
      isJustInverseOfSafety:
        safetyRiskCorrEnv != null && Math.abs(safetyRiskCorrEnv) > 0.85
          ? "SUSPECT_NEAR_INVERSE"
          : "DISTINCT_ENOUGH_TO_MONITOR",
    },
    sideMonitor,
    certifiedUnchanged: { n: certified.n, record: certified.record },
    overall: record(rebuilt),
  };

  writeJson(path.join(OUT, "MASTER_SUMMARY_V1.json"), summary);

  const md = `# Safety Environment Rebuild V1

Generated: ${generatedAt}

## Principle
Safety = **evidence-environment stability**, not model belief strength.

## Legacy Safety
- Winners avg: ${legacyHealth.avgSafetyWinners?.toFixed?.(1)}
- Losers avg: ${legacyHealth.avgSafetyLosers?.toFixed?.(1)}
- Inverted: ${legacyHealth.inverted}

## Environment Safety V2 (no winP)
- Winners avg: ${envHealth.avgSafetyWinners?.toFixed?.(1)}
- Losers avg: ${envHealth.avgSafetyLosers?.toFixed?.(1)}
- Inverted: ${envHealth.inverted}
- corr(outcome): ${envHealth.corrWithOutcome?.toFixed?.(3)}
- corr(probability): ${envHealth.corrWithProbability?.toFixed?.(3)} (want low)

## RiskV2 after env Safety
- LOW: ${riskEnv.byRisk.LOW.record}
- MEDIUM: ${riskEnv.byRisk.MEDIUM.record}
- HIGH: ${riskEnv.byRisk.HIGH.record}
- Preferred LOW≥MED≥HIGH: ${riskEnv.monotonePreferred}
- corr(Safety, RiskTier): ${safetyRiskCorrEnv?.toFixed?.(3)} (${summary.riskV2.isJustInverseOfSafety})

## Side monitor (no quota)
- OVER: ${sideMonitor.OVER.record} (n=${sideMonitor.OVER.n})
- UNDER: ${sideMonitor.UNDER.record} (n=${sideMonitor.UNDER.n})
- Baseline OVER/UNDER: ${sideMonitor.baselineOVER.record} / ${sideMonitor.baselineUNDER.record}

## Component actions (see COMPONENT_AUTOPSY_V1.json)
${componentAutopsy
  .map(
    (c) =>
      `- **${c.component}** [${c.action}] Δ=${c.deltaWinnerMinusLoser?.toFixed?.(2) ?? "na"} r=${c.corrWithOutcome?.toFixed?.(2) ?? "na"} — ${c.rationale}`
  )
  .join("\n")}
`;
  fs.writeFileSync(path.join(OUT, "REPORT_V1.md"), md);
  console.log(md);
  console.log("Wrote", OUT);
}

main();
