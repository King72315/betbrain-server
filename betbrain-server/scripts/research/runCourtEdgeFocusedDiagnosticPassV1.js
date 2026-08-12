/**
 * CourtEdge Focused Diagnostic Pass V1
 *
 * FREEZE: no Certified rewrite, no Direction/C2 threshold retune,
 * no second side/risk/probability authority.
 *
 * Diagnostics only (+ optional probability calibration table under existing authority):
 * 1) Side-selection inversion autopsy
 * 2) Safety component autopsy
 * 3) Chronological probability recalibration
 * 4) Projection bias by side/profile
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "research", "courteedge-gold-learning-v1", "focused-diagnostic-v1");
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

const DIAG_BUILD = "courteedge-focused-diagnostic-pass-v1";
const FREEZE_NOTICE = Object.freeze({
  certified: "UNCHANGED",
  directionFreeze: "EMPIRICAL_DIRECTION_V1_PRODUCTION_1",
  c2Freeze: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
  architecture: "single-authority preserved",
  prospectiveCollection: "CONTINUE",
});

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
function record(rows) {
  let w = 0,
    l = 0;
  for (const r of rows) {
    if (r.result === "WIN") w += 1;
    else if (r.result === "LOSS") l += 1;
  }
  const d = w + l;
  return { n: rows.length, w, l, hit: d ? w / d : null, record: `${w}-${l}` };
}

function goldKey(r) {
  return `${r.date}|${clean(r.players)}|${r.predictedSide}|${r.marketLine}`;
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
    for (const p of j.packets || []) {
      if (/^Pool\s*\d+/i.test(String(p.playerName || ""))) continue;
      const side = String(p.selectedSide || p.side || "").toUpperCase();
      const key = `${date}|${clean(p.playerName || p.player)}|${side}|${p.line}`;
      const soft = `${date}|${clean(p.playerName || p.player)}`;
      const payload = { ...p, _freezeFile: f, _slateDate: date };
      // prefer denser / later
      if (!idx.has(key) || (j.packets?.length || 0) >= 10) idx.set(key, payload);
      if (!idx.has(soft)) idx.set(soft, payload);
    }
  }
  return idx;
}

function enrichWithPacket(row, packetIdx) {
  const exact = packetIdx.get(goldKey(row));
  const soft = packetIdx.get(`${row.date}|${clean(row.players)}`);
  const p = exact || soft;
  if (!p) return { ...row, _packet: null };

  const selected =
    String(row.predictedSide).toUpperCase() === "OVER" ? p.overPacket : p.underPacket;
  const opposite =
    String(row.predictedSide).toUpperCase() === "OVER" ? p.underPacket : p.overPacket;

  const safetyComponents =
    selected?.safety?.safetyComponents ||
    p.safety?.safetyComponents ||
    selected?.safetyComponents ||
    null;

  return {
    ...row,
    _packet: p,
    safetyComponents,
    selectedSafety: num(selected?.safety?.finalSafetyScore ?? row.Safety),
    oppositeSafety: num(opposite?.safety?.finalSafetyScore),
    selectedRawP: num(selected?.rawWinProbability ?? row.predictedProbability),
    oppositeRawP: num(opposite?.rawWinProbability),
    selectedEdge: num(selected?.projectionEdge ?? row.projectionEdge),
    oppositeEdge: num(opposite?.projectionEdge),
    selectedRel: num(
      selected?.reliabilityProbability ?? row.Reliability
    ),
    oppositeRel: num(opposite?.reliabilityProbability),
    selectedRisk: String(selected?.risk?.risk || row.RiskV2 || "").toUpperCase(),
    oppositeRisk: String(opposite?.risk?.risk || "").toUpperCase(),
    conflictIndex: num(
      row.opponentQualityAdjustments?.conflictIndex ?? selected?.conflict?.conflictIndex
    ),
    minutesStability: num(row.recentForm?.minutesStability),
    roleStability: num(row.recentForm?.roleStability),
    expectedMinutes: num(row.recentForm?.expectedMinutes),
    bookCount: num(row.dataCompleteness?.bookCount),
    marketQuality: num(row.dataCompleteness?.marketQuality),
    admission: row.directionAdmission || p.directionAdmission || null,
    researchDecision:
      row.sideSearchOutput?.directionResearchDecision ||
      p.directionResearchDecision ||
      null,
  };
}

function sideInversionAudit(rows) {
  const inv = rows.filter((r) => r.result === "LOSS" && r.oppositeResult === "WIN");
  const ok = rows.filter((r) => r.result === "WIN");
  const groups = {};
  const bump = (map, key, row) => {
    if (!map[key]) map[key] = { n: 0, rows: [] };
    map[key].n += 1;
    if (map[key].rows.length < 8) {
      map[key].rows.push({
        player: row.players,
        date: row.date,
        side: row.predictedSide,
        line: row.marketLine,
        actual: row.actualPoints,
        p: row.predictedProbability,
        risk: row.RiskV2,
        adm: row.admission,
        research: row.researchDecision,
        edge: row.selectedEdge,
        oppEdge: row.oppositeEdge,
        safety: row.Safety,
        falseExt: row.falseExtensionAnalog,
        archetype: row.primaryArchetype,
        tier: row.recommendationTier,
      });
    }
  };

  for (const r of inv) {
    bump(groups, `side:${r.predictedSide}`, r);
    bump(groups, `risk:${r.RiskV2}`, r);
    bump(groups, `adm:${r.admission || "NULL"}`, r);
    bump(groups, `research:${r.researchDecision || "NULL"}`, r);
    bump(groups, `tier:${r.recommendationTier}`, r);
    bump(groups, `archetype:${r.primaryArchetype || "NONE"}`, r);
    bump(groups, `falseExt:${r.falseExtensionAnalog}`, r);
    const edgeBand =
      r.selectedEdge == null
        ? "NA"
        : Math.abs(r.selectedEdge) < 1.5
          ? "edge<1.5"
          : Math.abs(r.selectedEdge) < 3
            ? "edge1.5-3"
            : "edge>=3";
    bump(groups, edgeBand, r);
    const pBand =
      r.predictedProbability == null
        ? "NA"
        : r.predictedProbability >= 0.75
          ? "p>=75"
          : r.predictedProbability >= 0.65
            ? "p65-75"
            : "p<65";
    bump(groups, pBand, r);
    // Would safer opposite C2 tier have flipped?
    const riskRank = (x) =>
      x === "LOW" ? 0 : x === "MEDIUM" ? 1 : x === "HIGH" ? 2 : 3;
    if (
      r.oppositeRisk &&
      riskRank(r.oppositeRisk) < riskRank(r.selectedRisk)
    ) {
      bump(groups, "opposite_had_safer_c2_tier", r);
    }
    if (
      Number.isFinite(r.oppositeRawP) &&
      Number.isFinite(r.selectedRawP) &&
      r.oppositeRawP > r.selectedRawP
    ) {
      bump(groups, "opposite_had_higher_rawP", r);
    }
    if (
      Number.isFinite(r.oppositeSafety) &&
      Number.isFinite(r.selectedSafety) &&
      r.oppositeSafety > r.selectedSafety
    ) {
      bump(groups, "opposite_had_higher_safety", r);
    }
  }

  const sorted = Object.entries(groups)
    .map(([k, v]) => ({ key: k, n: v.n, shareOfInversions: v.n / inv.length, samples: v.rows }))
    .sort((a, b) => b.n - a.n);

  // Side × admission contingency
  const contingency = {};
  for (const r of rows) {
    const k = `${r.predictedSide}|${r.admission || "NULL"}|${r.researchDecision || "NULL"}`;
    if (!contingency[k]) contingency[k] = { w: 0, l: 0, inv: 0 };
    if (r.result === "WIN") contingency[k].w += 1;
    if (r.result === "LOSS") contingency[k].l += 1;
    if (r.result === "LOSS" && r.oppositeResult === "WIN") contingency[k].inv += 1;
  }

  return {
    overall: {
      predicted: record(rows),
      opposite: record(rows.map((r) => ({ ...r, result: r.oppositeResult }))),
      inversionCount: inv.length,
      inversionRate: inv.length / rows.length,
    },
    inversionDrivers: sorted,
    contingency,
    winsVsInversions: {
      winProfile: {
        avgP: mean(ok.map((r) => r.predictedProbability)),
        avgEdge: mean(ok.map((r) => r.selectedEdge)),
        avgSafety: mean(ok.map((r) => r.Safety)),
        overShare: ok.filter((r) => r.predictedSide === "OVER").length / (ok.length || 1),
        bestGuessShare:
          ok.filter((r) => r.admission === "BEST_GUESS").length / (ok.length || 1),
      },
      inversionProfile: {
        avgP: mean(inv.map((r) => r.predictedProbability)),
        avgEdge: mean(inv.map((r) => r.selectedEdge)),
        avgSafety: mean(inv.map((r) => r.Safety)),
        overShare: inv.filter((r) => r.predictedSide === "OVER").length / (inv.length || 1),
        bestGuessShare:
          inv.filter((r) => r.admission === "BEST_GUESS").length / (inv.length || 1),
      },
    },
  };
}

function safetyAutopsy(rows) {
  const winners = rows.filter((r) => r.result === "WIN");
  const losers = rows.filter((r) => r.result === "LOSS");

  const componentKeys = new Set();
  for (const r of rows) {
    const c = r.safetyComponents;
    if (c && typeof c === "object") {
      for (const k of Object.keys(c)) componentKeys.add(k);
    }
  }

  // Proxy components always available even if packet safetyComponents missing
  const proxies = [
    ["Safety", (r) => r.Safety],
    ["Reliability", (r) => r.Reliability],
    ["Trust", (r) => r.Trust],
    ["predictedProbability", (r) => r.predictedProbability],
    ["absEdge", (r) => (r.selectedEdge == null ? null : Math.abs(r.selectedEdge))],
    ["conflictIndex", (r) => r.conflictIndex],
    ["minutesStability", (r) => r.minutesStability],
    ["roleStability", (r) => r.roleStability],
    ["expectedMinutes", (r) => r.expectedMinutes],
    ["bookCount", (r) => r.bookCount],
    ["marketQuality", (r) => r.marketQuality],
    ["majorFailurePathCount", (r) => num(r.dataCompleteness?.majorFailurePathCount, 0)],
  ];

  for (const k of componentKeys) {
    proxies.push([`safety.${k}`, (r) => num(r.safetyComponents?.[k])]);
  }

  const componentDelta = proxies.map(([name, fn]) => {
    const w = mean(winners.map(fn));
    const l = mean(losers.map(fn));
    return {
      component: name,
      avgWinner: w,
      avgLoser: l,
      deltaWinnerMinusLoser: w != null && l != null ? w - l : null,
      inverted: w != null && l != null ? w < l : null,
    };
  });

  componentDelta.sort(
    (a, b) =>
      (a.deltaWinnerMinusLoser ?? 0) - (b.deltaWinnerMinusLoser ?? 0)
  );

  // Safety quintiles vs hit rate
  const withS = rows
    .filter((r) => Number.isFinite(r.Safety))
    .slice()
    .sort((a, b) => a.Safety - b.Safety);
  const qn = Math.max(1, Math.floor(withS.length / 5));
  const quintiles = [0, 1, 2, 3, 4].map((i) => {
    const slice =
      i === 4 ? withS.slice(i * qn) : withS.slice(i * qn, (i + 1) * qn);
    return {
      quintile: i + 1,
      safetyMin: slice[0]?.Safety ?? null,
      safetyMax: slice[slice.length - 1]?.Safety ?? null,
      ...record(slice),
    };
  });

  return {
    avgSafetyWinners: mean(winners.map((r) => r.Safety)),
    avgSafetyLosers: mean(losers.map((r) => r.Safety)),
    inverted: mean(winners.map((r) => r.Safety)) < mean(losers.map((r) => r.Safety)),
    componentDelta,
    worstInvertedComponents: componentDelta.filter((c) => c.inverted).slice(0, 12),
    quintiles,
    packetsWithSafetyComponents: rows.filter((r) => r.safetyComponents).length,
    note:
      "If safety.* components are sparse, proxy features show which correlates are upside-down.",
  };
}

function chronologicalProbabilityCalibration(rows) {
  const sorted = rows
    .filter((r) => Number.isFinite(r.predictedProbability))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Expanding-window isotonic-like bin calibration: train on past dates, apply to next
  const dates = [...new Set(sorted.map((r) => r.date))].sort();
  const folds = [];
  const calibrated = [];

  for (let i = 0; i < dates.length; i += 1) {
    const testDate = dates[i];
    const train = sorted.filter((r) => r.date < testDate);
    const test = sorted.filter((r) => r.date === testDate);
    if (!test.length) continue;

    // Build empirical reliability map on train using fixed bands
    const bands = [
      [0, 0.55],
      [0.55, 0.6],
      [0.6, 0.65],
      [0.65, 0.7],
      [0.7, 0.75],
      [0.75, 1.01],
    ];
    const table = bands.map(([lo, hi]) => {
      const rs = train.filter(
        (r) => r.predictedProbability >= lo && r.predictedProbability < hi
      );
      const hit = record(rs).hit;
      return {
        lo,
        hi,
        n: rs.length,
        empiricalHit: hit,
        // shrinkage toward 0.5 when tiny
        calibrated:
          hit == null
            ? (lo + hi) / 2
            : (hit * rs.length + 0.5 * 8) / (rs.length + 8),
      };
    });

    const apply = (p) => {
      const b = table.find((x) => p >= x.lo && p < x.hi) || table[table.length - 1];
      return b.calibrated;
    };

    let brierRaw = 0;
    let brierCal = 0;
    for (const r of test) {
      const y = r.result === "WIN" ? 1 : 0;
      const pRaw = r.predictedProbability;
      const pCal = apply(pRaw);
      brierRaw += (pRaw - y) ** 2;
      brierCal += (pCal - y) ** 2;
      calibrated.push({
        ...r,
        predictedProbabilityRaw: pRaw,
        predictedProbabilityCalibrated: pCal,
        trainN: train.length,
      });
    }
    folds.push({
      testDate,
      trainN: train.length,
      testN: test.length,
      brierRaw: brierRaw / test.length,
      brierCal: brierCal / test.length,
      table,
    });
  }

  // Final calibration table fit on all data (for prospective application), with note
  const bands = [
    [0, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.75],
    [0.75, 1.01],
  ];
  const finalTable = bands.map(([lo, hi]) => {
    const rs = sorted.filter(
      (r) => r.predictedProbability >= lo && r.predictedProbability < hi
    );
    const hit = record(rs).hit;
    return {
      lo,
      hi,
      n: rs.length,
      empiricalHit: hit,
      calibrated:
        hit == null
          ? (lo + hi) / 2
          : (hit * rs.length + 0.5 * 8) / (rs.length + 8),
      overconfidence:
        hit != null ? (lo + hi) / 2 - hit : null,
    };
  });

  const brier = (arr, key) => {
    if (!arr.length) return null;
    return mean(
      arr.map((r) => {
        const y = r.result === "WIN" ? 1 : 0;
        return (r[key] - y) ** 2;
      })
    );
  };

  return {
    method:
      "chronological expanding-window band calibration + Laplace shrinkage toward 0.5",
    folds,
    chronoMeanBrierRaw: mean(folds.map((f) => f.brierRaw)),
    chronoMeanBrierCal: mean(folds.map((f) => f.brierCal)),
    fullSampleBrierRaw: brier(
      calibrated.map((r) => ({
        ...r,
        predictedProbability: r.predictedProbabilityRaw,
      })),
      "predictedProbability"
    ),
    fullSampleBrierCal: brier(
      calibrated.map((r) => ({
        ...r,
        predictedProbability: r.predictedProbabilityCalibrated,
      })),
      "predictedProbability"
    ),
    finalCalibrationTable: finalTable,
    applicationNote:
      "Shadow/authority-preserving: replace mapping under predictedProbability; do not add confidenceV3. Certified unchanged.",
    calibratedRowsPath: "PROBABILITY_CALIBRATED_ROWS_V1.json",
    calibratedRows: calibrated,
  };
}

function projectionBiasAudit(rows) {
  const signed = (rs) => mean(rs.map((r) => r.projectionError));
  const mae = (rs) =>
    mean(rs.map((r) => (r.projectionError == null ? null : Math.abs(r.projectionError))));

  const by = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return Object.fromEntries(
      [...m.entries()].map(([k, rs]) => [
        k,
        {
          n: rs.length,
          signedError: signed(rs),
          mae: mae(rs),
          ...record(rs),
          avgLine: mean(rs.map((r) => r.marketLine)),
          avgProj: mean(rs.map((r) => r.projectedTotal)),
          avgActual: mean(rs.map((r) => r.actualPoints)),
        },
      ])
    );
  };

  // Player-level bias where n>=2
  const byPlayer = by((r) => r.players);
  const playerBias = Object.entries(byPlayer)
    .map(([player, v]) => ({ player, ...v }))
    .filter((v) => v.n >= 2)
    .sort(
      (a, b) => Math.abs(b.signedError || 0) - Math.abs(a.signedError || 0)
    );

  return {
    overall: {
      n: rows.length,
      signedError: signed(rows),
      mae: mae(rows),
    },
    bySide: by((r) => r.predictedSide),
    byRisk: by((r) => r.RiskV2 || "NA"),
    byAdmission: by((r) => r.admission || "NULL"),
    byLineBucket: by((r) => {
      const line = r.marketLine;
      if (line == null) return "NA";
      if (line < 10) return "line<10";
      if (line < 15) return "line10-15";
      if (line < 20) return "line15-20";
      return "line>=20";
    }),
    byMinutes: by((r) => {
      const m = r.expectedMinutes;
      if (m == null) return "minsNA";
      if (m < 22) return "mins<22";
      if (m < 28) return "mins22-28";
      return "mins>=28";
    }),
    byFalseExt: by((r) => (r.falseExtensionAnalog ? "FEXT" : "NOFEXT")),
    playerBiasTop: playerBias.slice(0, 15),
  };
}

function main() {
  ensureDir(OUT);
  const generatedAt = new Date().toISOString();
  writeJson(path.join(OUT, "FREEZE_NOTICE_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    ...FREEZE_NOTICE,
  });

  const gold = readJson(GOLD);
  const base = (gold.rows || []).filter(
    (r) => r.calibrationEligible && (r.result === "WIN" || r.result === "LOSS")
  );
  const packetIdx = loadPacketIndex();
  const rows = base.map((r) => enrichWithPacket(r, packetIdx));

  const side = sideInversionAudit(rows);
  writeJson(path.join(OUT, "DIAG1_SIDE_SELECTION_INVERSION_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    n: rows.length,
    ...side,
  });

  const safety = safetyAutopsy(rows);
  writeJson(path.join(OUT, "DIAG2_SAFETY_COMPONENT_AUTOPSY_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    n: rows.length,
    ...safety,
  });

  const prob = chronologicalProbabilityCalibration(rows);
  writeJson(path.join(OUT, "DIAG3_PROBABILITY_CHRONO_CALIBRATION_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    method: prob.method,
    folds: prob.folds,
    chronoMeanBrierRaw: prob.chronoMeanBrierRaw,
    chronoMeanBrierCal: prob.chronoMeanBrierCal,
    fullSampleBrierRaw: prob.fullSampleBrierRaw,
    fullSampleBrierCal: prob.fullSampleBrierCal,
    finalCalibrationTable: prob.finalCalibrationTable,
    applicationNote: prob.applicationNote,
  });
  writeJson(path.join(OUT, "PROBABILITY_CALIBRATED_ROWS_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    authority: "predictedProbability (recalibrated mapping only)",
    certifiedUnchanged: true,
    rows: prob.calibratedRows.map((r) => ({
      goldId: r.goldId,
      date: r.date,
      player: r.players,
      side: r.predictedSide,
      result: r.result,
      predictedProbabilityRaw: r.predictedProbabilityRaw,
      predictedProbabilityCalibrated: r.predictedProbabilityCalibrated,
      trainN: r.trainN,
    })),
  });
  // Persist prospective calibration table (shadow) — not wired into production engine
  writeJson(path.join(OUT, "PROBABILITY_CALIBRATION_TABLE_SHADOW_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    status: "SHADOW_NOT_WIRED_TO_PRODUCTION",
    certifiedUnchanged: true,
    table: prob.finalCalibrationTable,
    note: "Load table in a later PR under existing predictedProbability owner after review.",
  });

  const proj = projectionBiasAudit(rows);
  writeJson(path.join(OUT, "DIAG4_PROJECTION_BIAS_V1.json"), {
    generatedAt,
    diagBuild: DIAG_BUILD,
    ...proj,
  });

  const master = {
    generatedAt,
    diagBuild: DIAG_BUILD,
    freeze: FREEZE_NOTICE,
    n: rows.length,
    diagnosis: {
      sideSelection: {
        predicted: side.overall.predicted,
        opposite: side.overall.opposite,
        inversionRate: side.overall.inversionRate,
        topDrivers: side.inversionDrivers.slice(0, 10).map((d) => ({
          key: d.key,
          n: d.n,
          share: d.shareOfInversions,
        })),
      },
      safety: {
        avgSafetyWinners: safety.avgSafetyWinners,
        avgSafetyLosers: safety.avgSafetyLosers,
        inverted: safety.inverted,
        worstInvertedComponents: safety.worstInvertedComponents.slice(0, 8),
      },
      probability: {
        chronoMeanBrierRaw: prob.chronoMeanBrierRaw,
        chronoMeanBrierCal: prob.chronoMeanBrierCal,
        finalTable: prob.finalCalibrationTable,
      },
      projection: {
        overall: proj.overall,
        bySide: proj.bySide,
        byLineBucket: proj.byLineBucket,
      },
    },
    concentrateNext: [
      "Side-selection directional bias (see inversion drivers)",
      "Safety rebuild from inverted components",
      "Apply shadow probability calibration under existing authority",
      "Projection bias by side/line/minutes",
      "Do NOT change Certified yet — keep collecting prospectively",
    ],
  };
  writeJson(path.join(OUT, "MASTER_FOCUSED_DIAGNOSTIC_V1.json"), master);

  const md = `# CourtEdge Focused Diagnostic Pass V1

Generated: ${generatedAt}

## Freeze
- Certified: UNCHANGED
- Direction / C2 freezes: untouched
- Prospective collection: CONTINUE

## N
Calibration-eligible graded rows: **${rows.length}**

## 1) Side-selection inversion
Predicted: ${side.overall.predicted.record} (hit ${((side.overall.predicted.hit || 0) * 100).toFixed(1)}%)
Opposite: ${side.overall.opposite.record} (hit ${((side.overall.opposite.hit || 0) * 100).toFixed(1)}%)
Inversions (LOSS where opposite WIN): **${side.overall.inversionCount}** (${((side.overall.inversionRate || 0) * 100).toFixed(1)}%)

Top drivers:
${side.inversionDrivers
  .slice(0, 12)
  .map(
    (d) =>
      `- ${d.key}: ${d.n} (${((d.shareOfInversions || 0) * 100).toFixed(0)}% of inversions)`
  )
  .join("\n")}

## 2) Safety autopsy
Avg Safety winners: ${safety.avgSafetyWinners?.toFixed?.(2)}
Avg Safety losers: ${safety.avgSafetyLosers?.toFixed?.(2)}
Inverted: **${safety.inverted}**

Worst inverted components (winner avg < loser avg):
${safety.worstInvertedComponents
  .slice(0, 10)
  .map(
    (c) =>
      `- ${c.component}: W ${c.avgWinner?.toFixed?.(3)} vs L ${c.avgLoser?.toFixed?.(3)} (Δ ${c.deltaWinnerMinusLoser?.toFixed?.(3)})`
  )
  .join("\n")}

## 3) Probability chrono calibration
Chrono mean Brier raw → cal: ${prob.chronoMeanBrierRaw?.toFixed?.(4)} → ${prob.chronoMeanBrierCal?.toFixed?.(4)}
Shadow table written (NOT wired to production). Certified unchanged.

## 4) Projection bias
Overall signed error: ${proj.overall.signedError?.toFixed?.(3)} (positive = under-projected)
By side: ${JSON.stringify(proj.bySide)}

## Next
Keep collecting prospectively. Recalibrate Safety + probability mapping. Do not change Certified yet.
`;
  fs.writeFileSync(path.join(OUT, "REPORT_FOCUSED_DIAGNOSTIC_V1.md"), md);
  console.log(JSON.stringify(master, null, 2));
  console.log("\nWrote", OUT);
}

main();
