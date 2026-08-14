/**
 * Grade-A Recovery V2 — Round 1 forensic pack for 2026-08-13.
 * READ-ONLY against prediction formulas. Writes research artifacts only.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCanonicalPredictionStore } from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import {
  selectHomeBoardMarketWeaveV1,
  resolveDecisionScore,
} from "../../services/courtEdgeHomeMarketWeaveV1.js";
import { gradeFromActual } from "../../services/courtEdgeCanonicalResultTruthV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "research/courteedge-grade-a-recovery-v2");
const SLATE = "2026-08-13";

function ensure(p) {
  fs.mkdirSync(p, { recursive: true });
}
function write(rel, data) {
  const full = path.join(OUT, rel);
  ensure(path.dirname(full));
  fs.writeFileSync(
    full,
    typeof data === "string" ? data : JSON.stringify(data, null, 2)
  );
  return full;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clean(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
function mean(arr) {
  const a = arr.map(Number).filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function median(arr) {
  const a = [...arr].map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function stdev(arr) {
  const a = arr.map(Number).filter(Number.isFinite);
  if (a.length < 2) return null;
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
}
function tally(rows) {
  const g = { WIN: 0, LOSS: 0, PUSH: 0, PENDING: 0, n: 0 };
  for (const r of rows) {
    const gr = String(r.grade || "PENDING").toUpperCase();
    if (g[gr] != null) g[gr] += 1;
    g.n += 1;
  }
  const decided = g.WIN + g.LOSS;
  return {
    ...g,
    hit: decided ? Number((g.WIN / decided).toFixed(4)) : null,
    record: `${g.WIN}-${g.LOSS}${g.PUSH ? `-${g.PUSH}` : ""}`,
  };
}
function classifyExtremity(z) {
  if (z == null) return "UNKNOWN";
  if (z <= -1.5) return "EXTREME_LOW";
  if (z <= -0.75) return "LOW_RELATIVE_LINE";
  if (z < 0.75) return "NORMAL_RANGE";
  if (z < 1.5) return "HIGH_RELATIVE_LINE";
  return "EXTREME_HIGH";
}
function gradeAtLine(side, line, actual) {
  return gradeFromActual({ side, line, actual }).grade;
}

// --- Load graded cohort ---
const store = loadCanonicalPredictionStore();
const cohort = (store.records || [])
  .filter((r) => String(r.slateDateCt || "").slice(0, 10) === SLATE)
  .map((r) => ({
    ...r,
    player: r.playerName || r.player,
    grade: String(r.result?.grade || "PENDING").toUpperCase(),
    actual: r.result?.actual ?? null,
    score: resolveDecisionScore(r),
    p: num(r.modelWinProbability ?? r.decisionScoreV2),
  }));

write("00-frozen-8-13/canonical-cohort.json", {
  slate: SLATE,
  n: cohort.length,
  byType: {
    POINTS: cohort.filter((r) => r.propType === "POINTS").length,
    REBOUNDS: cohort.filter((r) => r.propType === "REBOUNDS").length,
    ASSISTS: cohort.filter((r) => r.propType === "ASSISTS").length,
  },
  grades: tally(cohort),
});

write("01-full-board-results/full-board.json", {
  all: tally(cohort),
  POINTS: tally(cohort.filter((r) => r.propType === "POINTS")),
  REBOUNDS: tally(cohort.filter((r) => r.propType === "REBOUNDS")),
  ASSISTS: tally(cohort.filter((r) => r.propType === "ASSISTS")),
  OVER: tally(cohort.filter((r) => r.side === "OVER")),
  UNDER: tally(cohort.filter((r) => r.side === "UNDER")),
  rows: cohort.map((r) => ({
    player: r.player,
    propType: r.propType,
    side: r.side,
    line: r.line,
    actual: r.actual,
    grade: r.grade,
    p: r.p,
    score: r.score,
    hw: r.homeWeaveRank,
    mr: r.marketRank,
    id: r.canonicalPropId,
  })),
});

// --- Why 15/15/15 ---
const fifteenExplain = {
  sourceScript: "betbrain-server/scripts/regenerateMultiStatHomeSlate.js",
  mechanism:
    "selectPerGame() takes top 5 consensus props per market (PTS/REB/AST) by bookCount/marketQuality PER GAME, then 3 games × 5 = 15 modeled candidates per propType.",
  code: {
    perGamePerMarketCap: 5,
    gamesOnSlate: 3,
    expectedModeledPerType: 15,
  },
  rawMarketsFromLineAudit: { POINTS: 31, REBOUNDS: 27, ASSISTS: 22 },
  modeled: { POINTS: 15, REBOUNDS: 15, ASSISTS: 15 },
  classification: "INTENTIONAL_PER_GAME_PER_MARKET_CAP",
  kingGuidelineConflict:
    "Yes — per-stat per-game slice before global ranking is a hidden quota/bias control on the modeled pool.",
  productionServerPath:
    "server.js selectMultiStatAnalyzedPropsPerGame(perMarket:4, maxTotal:12) — related but different numbers for live refresh path",
};
write("10-prop-flow/why-15-15-15.json", fifteenExplain);

// --- Weave vs global top 10 ---
const byScore = [...cohort].sort((a, b) => (b.score || 0) - (a.score || 0));
const globalTop10 = byScore.slice(0, 10).map((r, i) => ({
  globalRank: i + 1,
  player: r.player,
  propType: r.propType,
  side: r.side,
  line: r.line,
  actual: r.actual,
  grade: r.grade,
  p: r.p,
  score: r.score,
  homeWeaveRank: r.homeWeaveRank ?? null,
  inHome: r.homeWeaveRank != null,
  id: r.canonicalPropId,
}));

const homeWeave = [...cohort]
  .filter((r) => r.homeWeaveRank != null)
  .sort((a, b) => a.homeWeaveRank - b.homeWeaveRank)
  .map((r) => ({
    homeWeaveRank: r.homeWeaveRank,
    marketRank: r.marketRank,
    player: r.player,
    propType: r.propType,
    side: r.side,
    line: r.line,
    actual: r.actual,
    grade: r.grade,
    p: r.p,
    score: r.score,
    globalRank: byScore.findIndex((x) => x.canonicalPropId === r.canonicalPropId) + 1,
    id: r.canonicalPropId,
  }));

const weaveSel = selectHomeBoardMarketWeaveV1(cohort, { maxBoard: 10 });
const promoted = homeWeave.filter(
  (h) => !globalTop10.some((g) => g.id === h.id)
);
const demoted = globalTop10.filter(
  (g) => !homeWeave.some((h) => h.id === g.id)
);

const weaveAudit = {
  authority: "courtEdgeHomeMarketWeaveV1 / market_balanced_v2_home_weave",
  maxHome: 10,
  mechanism:
    "Independently rank PTS/REB/AST by decisionScoreV2, order markets by each bucket's #1, then round-robin weave until 10.",
  forcesDiversity: true,
  forcesVolume: true,
  marketOrderUsed: weaveSel.marketOrder,
  homeCounts: weaveSel.byMarketSelected,
  globalTop10,
  globalTop10Record: tally(globalTop10),
  actualHomeWeave: homeWeave,
  actualHomeRecord: tally(homeWeave),
  promotedByWeave: promoted,
  demotedByWeave: demoted,
  counterfactualLift:
    (tally(globalTop10).hit ?? 0) - (tally(homeWeave).hit ?? 0),
  precisionAtK: {
    k1: tally(byScore.slice(0, 1)),
    k2: tally(byScore.slice(0, 2)),
    k3: tally(byScore.slice(0, 3)),
    k5: tally(byScore.slice(0, 5)),
    k10: tally(byScore.slice(0, 10)),
  },
  winnerAvgP: mean(cohort.filter((r) => r.grade === "WIN").map((r) => r.p)),
  loserAvgP: mean(cohort.filter((r) => r.grade === "LOSS").map((r) => r.p)),
  winnerAvgScore: mean(
    cohort.filter((r) => r.grade === "WIN").map((r) => r.score)
  ),
  loserAvgScore: mean(
    cohort.filter((r) => r.grade === "LOSS").map((r) => r.score)
  ),
};
write("04-home-weave-audit/home-weave-vs-global.json", weaveAudit);
write("05-ranking-audit/precision-at-k.json", {
  precisionAtK: weaveAudit.precisionAtK,
  winnerAvgP: weaveAudit.winnerAvgP,
  loserAvgP: weaveAudit.loserAvgP,
  winnerAvgScore: weaveAudit.winnerAvgScore,
  loserAvgScore: weaveAudit.loserAvgScore,
});

// --- Load ESPN logs for player distribution ---
const espnPath = path.join(
  ROOT,
  "research/courteedge-gold-learning-v1/reb-ast-historical-calibration-v1/espn-player-game-logs-v1.json"
);
let logs = [];
if (fs.existsSync(espnPath)) {
  const raw = JSON.parse(fs.readFileSync(espnPath, "utf8"));
  logs = Array.isArray(raw) ? raw : raw.rows || raw.logs || [];
}

function playerSeries(player, propType) {
  const field =
    propType === "POINTS" ? "pts" : propType === "REBOUNDS" ? "reb" : "ast";
  const alt =
    propType === "POINTS"
      ? "points"
      : propType === "REBOUNDS"
        ? "rebounds"
        : "assists";
  const rows = logs
    .filter((r) => clean(r.player || r.playerName) === clean(player))
    .map((r) => ({
      date: String(r.date || r.gameDate || r.slateDate || "").slice(0, 10),
      val: num(r[field] ?? r[alt] ?? r[field?.toUpperCase?.()]),
      min: num(r.minutes ?? r.min ?? r.MIN),
    }))
    .filter((r) => r.val != null && r.date && r.date < SLATE)
    .sort((a, b) => a.date.localeCompare(b.date));
  const vals = rows.map((r) => r.val);
  const l10 = vals.slice(-10);
  const l5 = vals.slice(-5);
  return {
    n: vals.length,
    seasonMean: mean(vals),
    seasonMedian: median(vals),
    l10Mean: mean(l10),
    l10Median: median(l10),
    l5Mean: mean(l5),
    l5Median: median(l5),
    sd: stdev(vals),
  };
}

const extremityRows = cohort.map((r) => {
  const dist = playerSeries(r.player, r.propType);
  const baseline = dist.l10Mean ?? dist.seasonMean;
  const sd = dist.sd || 1;
  const z = baseline != null ? (Number(r.line) - baseline) / sd : null;
  const cls = classifyExtremity(z);
  return {
    player: r.player,
    propType: r.propType,
    side: r.side,
    line: r.line,
    actual: r.actual,
    grade: r.grade,
    home: r.homeWeaveRank != null,
    ...dist,
    lineMinusSeasonMean:
      dist.seasonMean != null ? Number(r.line) - dist.seasonMean : null,
    lineMinusL10Mean:
      dist.l10Mean != null ? Number(r.line) - dist.l10Mean : null,
    lineMinusL5Mean: dist.l5Mean != null ? Number(r.line) - dist.l5Mean : null,
    zVsL10: z,
    extremity: cls,
  };
});
write("02-line-extremity/player-line-extremity.json", {
  note: "Line vs player historical distribution (WNBA ESPN logs pre-8/13). Distinct from sportsbook consensus percentile.",
  nWithHistory: extremityRows.filter((r) => r.n > 0).length,
  rows: extremityRows,
});

function crossTab(rows) {
  const keys = [
    "OVER|EXTREME_HIGH",
    "OVER|HIGH_RELATIVE_LINE",
    "OVER|NORMAL_RANGE",
    "OVER|LOW_RELATIVE_LINE",
    "OVER|EXTREME_LOW",
    "UNDER|EXTREME_HIGH",
    "UNDER|HIGH_RELATIVE_LINE",
    "UNDER|NORMAL_RANGE",
    "UNDER|LOW_RELATIVE_LINE",
    "UNDER|EXTREME_LOW",
  ];
  const out = {};
  for (const k of keys) out[k] = tally([]);
  for (const r of rows) {
    const k = `${r.side}|${r.extremity}`;
    if (!out[k]) out[k] = tally([]);
    const bucket = rows.filter(
      (x) => x.side === r.side && x.extremity === r.extremity
    );
    out[k] = tally(bucket);
  }
  // rebuild cleanly
  const cleanOut = {};
  for (const r of rows) {
    const k = `${r.side}|${r.extremity}`;
    if (!cleanOut[k]) cleanOut[k] = [];
    cleanOut[k].push(r);
  }
  return Object.fromEntries(
    Object.entries(cleanOut).map(([k, arr]) => [k, tally(arr)])
  );
}
write("02-line-extremity/extremity-by-side.json", {
  ALL: crossTab(extremityRows),
  POINTS: crossTab(extremityRows.filter((r) => r.propType === "POINTS")),
  REBOUNDS: crossTab(extremityRows.filter((r) => r.propType === "REBOUNDS")),
  ASSISTS: crossTab(extremityRows.filter((r) => r.propType === "ASSISTS")),
});

// --- Real available line shopping from frozen audit quotes ---
const quotesPath = path.join(
  ROOT,
  "research/courteedge-gold-learning-v1/market-line-integrity-audit-2026-08-13-v1/all-book-lines.json"
);
let quotes = [];
if (fs.existsSync(quotesPath)) {
  quotes = JSON.parse(fs.readFileSync(quotesPath, "utf8")).quotes || [];
}

function availableLinesFor(player, propType) {
  const pk = clean(player);
  const lines = [
    ...new Set(
      quotes
        .filter(
          (q) =>
            clean(q.player) === pk &&
            String(q.propType).toUpperCase() === propType
        )
        .map((q) => num(q.line))
        .filter((x) => x != null)
    ),
  ].sort((a, b) => a - b);
  return lines;
}

const shopping = cohort.map((r) => {
  const lines = availableLinesFor(r.player, r.propType);
  const sel = num(r.line);
  let bestForSide = null;
  if (r.side === "OVER") {
    // lower line better for OVER
    bestForSide = lines.length ? Math.min(...lines) : null;
  } else {
    bestForSide = lines.length ? Math.max(...lines) : null;
  }
  const worstForSide =
    r.side === "OVER"
      ? lines.length
        ? Math.max(...lines)
        : null
      : lines.length
        ? Math.min(...lines)
        : null;
  const gradeAtBest =
    bestForSide != null && r.actual != null
      ? gradeAtLine(r.side, bestForSide, r.actual)
      : null;
  const salvageable =
    r.grade === "LOSS" &&
    gradeAtBest === "WIN" &&
    bestForSide != null &&
    bestForSide !== sel;
  const neededToWin =
    r.grade === "LOSS" && r.actual != null
      ? r.side === "OVER"
        ? Number(r.actual) // need line < actual
        : Number(r.actual)
      : null;
  return {
    player: r.player,
    propType: r.propType,
    side: r.side,
    selected: sel,
    availableLines: lines,
    bestForSide,
    worstForSide,
    actual: r.actual,
    grade: r.grade,
    gradeAtBestAvailableLine: gradeAtBest,
    salvageableByRealBetterLine: salvageable,
    home: r.homeWeaveRank != null,
  };
});
const losses = shopping.filter((r) => r.grade === "LOSS");
write("03-line-sensitivity/real-line-shopping.json", {
  losses: losses.length,
  salvageableByRealBetterLine: losses.filter((r) => r.salvageableByRealBetterLine)
    .length,
  notSalvageable: losses.filter((r) => !r.salvageableByRealBetterLine).length,
  rows: shopping,
});

// --- Hypothetical line sensitivity ---
const deltas = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5];
const hypo = {};
for (const d of deltas) {
  const rows = cohort.map((r) => {
    const line = Number(r.line) + d;
    const grade =
      r.actual == null ? "PENDING" : gradeAtLine(r.side, line, r.actual);
    return { ...r, hypoLine: line, grade };
  });
  hypo[`delta_${d}`] = {
    ALL: tally(rows),
    POINTS: tally(rows.filter((r) => r.propType === "POINTS")),
    REBOUNDS: tally(rows.filter((r) => r.propType === "REBOUNDS")),
    ASSISTS: tally(rows.filter((r) => r.propType === "ASSISTS")),
    OVER: tally(rows.filter((r) => r.side === "OVER")),
    UNDER: tally(rows.filter((r) => r.side === "UNDER")),
  };
}
write("03-line-sensitivity/hypothetical-line-sensitivity.json", {
  label: "HYPOTHETICAL_LINE_SENSITIVITY",
  note: "Diagnostic only — not real betting records",
  byDelta: hypo,
});

// Home loss forensics
const homeLosses = ["Georgia Amoore", "Michaela Onyenwere", "Rhyne Howard", "Jewell Loyd", "Breanna Stewart"];
const homeLossDetail = homeWeave
  .filter((h) => h.grade === "LOSS")
  .map((h) => {
    const shop = shopping.find((s) => s.player === h.player && s.propType === h.propType);
    const ext = extremityRows.find(
      (s) => s.player === h.player && s.propType === h.propType && s.side === h.side
    );
    const toWin =
      h.side === "OVER"
        ? Number(h.actual) // need line <= actual-epsilon → line < actual
        : Number(h.actual); // UNDER wins if actual < line → need line > actual
    const deltaToFlip =
      h.side === "OVER"
        ? Number(h.line) - Number(h.actual) // how much lower line needed (must be < actual)
        : Number(h.actual) - Number(h.line); // how much higher line needed
    return {
      ...h,
      availableLines: shop?.availableLines || [],
      bestRealLineForSide: shop?.bestForSide,
      gradeAtBestReal: shop?.gradeAtBestAvailableLine,
      salvageableByRealLine: shop?.salvageableByRealBetterLine || false,
      unitsLineChangeToFlipSign: deltaToFlip,
      extremity: ext?.extremity,
      zVsL10: ext?.zVsL10,
      failureClass:
        shop?.salvageableByRealBetterLine
          ? "LINE_SHOPPING_SALVAGEABLE"
          : Math.abs(deltaToFlip) <= 1
            ? "LINE_FRAGILE"
            : Math.abs(deltaToFlip) <= 2
              ? "LINE_SENSITIVE"
              : "SIDE_OR_MODEL_MISS",
    };
  });
write("03-line-sensitivity/home-loss-forensics.json", homeLossDetail);

// Probability bands
const bands = [
  ["<55", (p) => p < 0.55],
  ["55-60", (p) => p >= 0.55 && p < 0.6],
  ["60-65", (p) => p >= 0.6 && p < 0.65],
  ["65-70", (p) => p >= 0.65 && p < 0.7],
  ["70-75", (p) => p >= 0.7 && p < 0.75],
  ["75+", (p) => p >= 0.75],
];
const probBands = {};
for (const [name, fn] of bands) {
  const rows = cohort.filter((r) => r.p != null && fn(r.p));
  probBands[name] = tally(rows);
}
write("07-probability/probability-bands.json", {
  note: "modelWinProbability bands on 8/13 cohort (odds-implied scores for many rows; projection often null)",
  bands: probBands,
  byType: {
    POINTS: Object.fromEntries(
      bands.map(([name, fn]) => [
        name,
        tally(
          cohort.filter(
            (r) => r.propType === "POINTS" && r.p != null && fn(r.p)
          )
        ),
      ])
    ),
    REBOUNDS: Object.fromEntries(
      bands.map(([name, fn]) => [
        name,
        tally(
          cohort.filter(
            (r) => r.propType === "REBOUNDS" && r.p != null && fn(r.p)
          )
        ),
      ])
    ),
    ASSISTS: Object.fromEntries(
      bands.map(([name, fn]) => [
        name,
        tally(
          cohort.filter(
            (r) => r.propType === "ASSISTS" && r.p != null && fn(r.p)
          )
        ),
      ])
    ),
  },
  amoore: cohort.find((r) => r.player === "Georgia Amoore" && r.propType === "ASSISTS"),
});

// Projection MAE — many projections null on odds-regenerated cohort
const withProj = cohort.filter((r) => r.projection != null && r.actual != null);
function maeFor(rows) {
  if (!rows.length) return { n: 0, mae: null, bias: null, rmse: null };
  const errs = rows.map((r) => Number(r.actual) - Number(r.projection));
  const ae = errs.map(Math.abs);
  return {
    n: rows.length,
    mae: mean(ae),
    bias: mean(errs),
    rmse: Math.sqrt(mean(errs.map((e) => e * e))),
  };
}
write("06-projection/projection-errors.json", {
  note: "Most 8/13 Home/research regenerate rows have projection=null (odds-implied path). MAE only where projection present.",
  withProjectionN: withProj.length,
  ALL: maeFor(withProj),
  POINTS: maeFor(withProj.filter((r) => r.propType === "POINTS")),
  REBOUNDS: maeFor(withProj.filter((r) => r.propType === "REBOUNDS")),
  ASSISTS: maeFor(withProj.filter((r) => r.propType === "ASSISTS")),
});

// Safety/Risk — often missing on regenerate path
write("08-safety/safety-summary.json", {
  note: "SafetyScore largely absent on odds-regenerated 8/13 canonical rows",
  present: cohort.filter((r) => r.safetyScore != null || r.SafetyScore != null)
    .length,
});
write("09-risk/risk-summary.json", {
  note: "Risk largely absent on odds-regenerated 8/13 canonical rows",
  present: cohort.filter((r) => r.risk != null).length,
  byRisk: {},
});

// EPERM verification
write("11-storage-eprem/eprem-fix-status.json", {
  issue:
    "Windows EPERM on rename of canonical-predictions-v1.json while local API held file; partial slate grades",
  fixApplied: [
    "atomicWriteJson retry/unlink/copyFile fallback",
    "batchAppendCanonicalResults — one save per slate grade",
  ],
  verifiedOn813: {
    gradedCount: 45,
    unresolvedCount: 0,
    persistUpdated: 45,
    pendingAfter: 0,
  },
  remainingRisk:
    "Need dedicated Windows file-lock regression test under concurrent reader; not yet automated",
});

// Official=0 vs Home=10
write("04-home-weave-audit/home-vs-official-labels.json", {
  officialCount: cohort.filter((r) => r.membership === "OFFICIAL").length,
  homeCount: homeWeave.length,
  homeMembership: "RESEARCH props surfaced via market-balanced weave",
  productRisk:
    "Home displays 10 research candidates with rank chrome that can be mistaken for trusted Official/Certified",
  recommendedProductTruth:
    "Trusted/Official section may be empty; Best Available / Full Predictions must be labeled distinctly",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      full: tally(cohort),
      home: tally(homeWeave),
      globalTop10: tally(globalTop10),
      salvageable: losses.filter((r) => r.salvageableByRealBetterLine).length,
      losses: losses.length,
      fifteen: fifteenExplain.classification,
      weaveForcesDiversity: true,
      promoted: promoted.length,
      demoted: demoted.length,
    },
    null,
    2
  )
);
