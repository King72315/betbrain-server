/**
 * Freeze EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 and produce the exact
 * prospective-style scorecard the scientific review asked for.
 *
 * NO Calibration 3. NO threshold retuning.
 * historicalProviderCalls (Odds) = 0
 */
process.env.EMPIRICAL_SAFE_PROP_V2 = "true";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateSideForecastPacketV1 } from "../../engines/probabilitySafetyV1/index.js";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  RELIABILITY_LOGISTIC_V2,
  RISK_THRESHOLDS_V2,
  TRUST_SCORE_WEIGHTS_V2,
  RELIABILITY_MODEL_VERSION,
  PATHWAY_MODEL_VERSION,
  TRUST_SCORE_VERSION,
  MEMBERSHIP_VERSION_V2,
} from "../../engines/empiricalSafePropV2/versions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT = path.join(SERVER, "research", "empirical-safe-prop-v2", "calibration-2-freeze");
const EXPORTS = path.join(SERVER, "research", "empirical-safe-prop-v2", "exports");
fs.mkdirSync(OUT, { recursive: true });

const LOCKED_FILES = [
  "engines/empiricalSafePropV2/versions.js",
  "engines/empiricalSafePropV2/reliabilityModelV2.js",
  "engines/empiricalSafePropV2/trustScoreV2.js",
  "engines/empiricalSafePropV2/safePathwayEngineV2.js",
  "engines/empiricalSafePropV2/explanationsV2.js",
  "engines/empiricalSafePropV2/slateRelativeStrengthV1.js",
  "engines/empiricalSafePropV2/researchPacketPersistenceV2.js",
  "engines/empiricalSafePropV2/index.js",
  "engines/topProps/courtEdgeFeatureFlagsV1.js",
];

function readJson(p, fb = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sideNorm(s) {
  const u = String(s || "").toUpperCase();
  if (u.startsWith("OVER")) return "OVER";
  if (u.startsWith("UNDER")) return "UNDER";
  return null;
}

function cleanName(n) {
  return String(n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function fileSha(rel) {
  const abs = path.join(SERVER, rel);
  const buf = fs.readFileSync(abs);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Signed margin to line from selected side's perspective (positive = covered). */
function sideMargin(side, line, actual) {
  if (actual == null || line == null || !side) return null;
  if (side === "OVER") return actual - line;
  if (side === "UNDER") return line - actual;
  return null;
}

function summarize(rows) {
  let W = 0,
    L = 0,
    P = 0;
  const margins = [];
  for (const r of rows) {
    const g = String(r.result || "").toUpperCase();
    if (g === "WIN" || g === "W") W++;
    else if (g === "LOSS" || g === "L") L++;
    else if (g === "PUSH" || g === "P") P++;
    if (r.margin != null && Number.isFinite(r.margin)) margins.push(r.margin);
  }
  const nDecided = W + L;
  const avgMargin = margins.length
    ? margins.reduce((a, b) => a + b, 0) / margins.length
    : null;
  return {
    count: rows.length,
    W,
    L,
    P,
    wl: `${W}-${L}`,
    winPct: nDecided ? W / nDecided : null,
    avgMargin,
  };
}

function toPick(r) {
  const side = sideNorm(r.side || r.pick || r.selectedSide);
  const projection = num(
    r.projection ?? r.projectedPoints ?? r.originalProjection
  );
  const fairLine = num(r.fairLine ?? r.originalFairLine ?? projection);
  const mins = num(r.avgMinutesL5 ?? r.expectedMinutes ?? r.recentMinutes);
  return {
    playerName: r.playerName || r.player,
    player: r.playerName || r.player,
    team: r.team,
    opponent: r.opponent,
    league: r.league || "WNBA",
    line: num(r.line),
    side,
    pick: side,
    projection,
    fairLine,
    avgMinutesL5: mins,
    expectedMinutes: mins,
    recentMinutes: mins,
    bookCount: num(r.bookCount),
    marketQualityScore: num(r.marketQuality ?? r.marketQualityScore),
    availabilityStatus: r.availabilityStatus || "ACTIVE",
    isStarter: r.isStarter,
    slateDate: r.slateDateCT || r.slateDate || r.date,
    avgPointsL5: num(r.avgPointsL5 ?? r.seasonAverage),
    avgPoints: num(r.avgPoints),
    expectedFGA: num(r.expectedFGA ?? r.avgFGA),
  };
}

function replay(r, v2) {
  const pick = toPick(r);
  if (!pick.side || pick.line == null || pick.projection == null) return null;
  const seed =
    Math.abs(
      [...String(pick.playerName) + String(pick.line)].reduce(
        (h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0,
        0
      )
    ) || 42;
  const pkt = evaluateSideForecastPacketV1(pick, {
    empiricalSafePropV2: v2,
    simulationCount: 1500,
    seed,
  });
  const actual = num(r.actualPoints ?? r.actual ?? r.actualStat);
  const result = String(r.result || r.grade || "")
    .toUpperCase()
    .replace(/^W$/, "WIN")
    .replace(/^L$/, "LOSS")
    .replace(/^P$/, "PUSH");
  return {
    playerName: pick.playerName,
    side: pick.side,
    line: pick.line,
    projection: pick.projection,
    slateDate: pick.slateDate,
    actualPoints: actual,
    result,
    margin: sideMargin(pick.side, pick.line, actual),
    risk: pkt.risk?.risk,
    reliability: pkt.risk?.reliabilityProbability ?? null,
    trust: pkt.risk?.trustScore ?? null,
    safety: pkt.safety?.finalSafetyScore ?? null,
    rawP: pkt.rawWinProbability,
    pathway: pkt.risk?.safePathway ?? null,
  };
}

function loadExpanded() {
  const expanded = readJson(
    path.join(EXPORTS, "COURTEDGE_EMPIRICAL_SAFE_PROP_MODEL_READY_V2_EXPANDED.json"),
    null
  );
  if (expanded?.records?.length) return expanded.records;
  // fallback rebuild path
  const base = readJson(
    path.join(EXPORTS, "COURTEDGE_EMPIRICAL_SAFE_PROP_MODEL_READY_V2.json"),
    { records: [] }
  ).records;
  const recovered = readJson(
    path.join(EXPORTS, "COURTEDGE_RECOVERED_REJECTED_GRADED_V2.json"),
    { records: [] }
  ).records;
  const seen = new Set();
  const out = [];
  for (const r of [...base, ...recovered]) {
    if (r.contaminated || r.prospectiveHoldout) continue;
    const d = r.slateDateCT || r.slateDate;
    if (d === "2026-08-05" || d === "2026-08-07") continue;
    const res = String(r.result || "").toUpperCase();
    if (res !== "WIN" && res !== "LOSS" && res !== "W" && res !== "L") continue;
    if (num(r.originalProjection ?? r.projection) == null) continue;
    const key = `${d}|${cleanName(r.playerName || r.player)}|${sideNorm(r.selectedSide || r.side)}|${num(r.line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function loadAug7OfficialCandidates() {
  const slate = readJson(
    path.join(
      SERVER,
      "research",
      "empirical-safe-prop-v2",
      "finder-v2",
      "COURTEDGE_AUG7_FINDER_V2_SLATE.json"
    ),
    null
  );
  return slate?.official || [];
}

function main() {
  const freezeId = EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE;
  if (freezeId !== "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2") {
    throw new Error(`Expected EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2, got ${freezeId}`);
  }

  // ── Lock manifest ───────────────────────────────────────────────────
  const hashes = {};
  for (const f of LOCKED_FILES) hashes[f] = fileSha(f);
  const freezeManifest = {
    freezeId: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    frozenAt: new Date().toISOString(),
    status: "FROZEN_FOR_PROSPECTIVE_COLLECTION",
    noCalibration3: true,
    noMondayMorningQuarterbacking: true,
    locked: {
      reliabilityCoefficients: RELIABILITY_LOGISTIC_V2,
      reliabilityModelVersion: RELIABILITY_MODEL_VERSION,
      trustFormulaWeights: TRUST_SCORE_WEIGHTS_V2,
      trustModelVersion: TRUST_SCORE_VERSION,
      riskThresholds: RISK_THRESHOLDS_V2,
      pathwayModelVersion: PATHWAY_MODEL_VERSION,
      membershipVersion: MEMBERSHIP_VERSION_V2,
      notes: {
        LOW: "selective second stage among recognized candidates",
        MEDIUM: "recognition / serious consideration",
        HIGH: "pass / protect",
        missingness: "missing features skipped in logistic; not imputed as 0",
        marketTreatment: "soft — bookCount/marketQuality alone cannot force HIGH",
        conflictTreatment: "caps in LOW/MEDIUM stages; not sole hard veto",
      },
    },
    fileHashesSha256: hashes,
    productionDefault: "OFF until prospective separation confirmed",
    nextScientificFocus: "MEDIUM recognition recall (do not weaken LOW)",
  };
  fs.writeFileSync(
    path.join(OUT, "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_FREEZE.json"),
    JSON.stringify(freezeManifest, null, 2)
  );

  // ── Replay expanded 171-set ─────────────────────────────────────────
  const records = loadExpanded();
  const rows = [];
  for (const r of records) {
    const v1 = replay(r, false);
    const v2 = replay(r, true);
    if (!v2) continue;
    rows.push({
      ...v2,
      v1Risk: v1?.risk || "HIGH",
      v2Risk: v2.risk,
      result: v2.result,
      margin: v2.margin,
    });
  }

  const byV2 = {
    LOW: rows.filter((r) => r.v2Risk === "LOW"),
    MEDIUM: rows.filter((r) => r.v2Risk === "MEDIUM"),
    HIGH: rows.filter((r) => r.v2Risk === "HIGH"),
  };
  const riskTable = {
    LOW: summarize(byV2.LOW),
    MEDIUM: summarize(byV2.MEDIUM),
    HIGH: summarize(byV2.HIGH),
  };

  const v1High = rows.filter((r) => r.v1Risk === "HIGH");
  const transition = {
    "V1_HIGH→V2_LOW": summarize(v1High.filter((r) => r.v2Risk === "LOW")),
    "V1_HIGH→V2_MEDIUM": summarize(v1High.filter((r) => r.v2Risk === "MEDIUM")),
    "V1_HIGH→V2_HIGH": summarize(v1High.filter((r) => r.v2Risk === "HIGH")),
  };

  // ── Chronological OOS: early dates train-context, late dates holdout ─
  // Coefficients are already frozen — this is evaluation-only split.
  const dates = [...new Set(rows.map((r) => r.slateDate).filter(Boolean))].sort();
  // Holdout = last ~40% of unique slate dates
  const cutIdx = Math.max(1, Math.floor(dates.length * 0.6));
  const trainDates = new Set(dates.slice(0, cutIdx));
  const testDates = new Set(dates.slice(cutIdx));
  const trainRows = rows.filter((r) => trainDates.has(r.slateDate));
  const testRows = rows.filter((r) => testDates.has(r.slateDate));

  function bandTable(subset) {
    return {
      LOW: summarize(subset.filter((r) => r.v2Risk === "LOW")),
      MEDIUM: summarize(subset.filter((r) => r.v2Risk === "MEDIUM")),
      HIGH: summarize(subset.filter((r) => r.v2Risk === "HIGH")),
      n: subset.length,
    };
  }

  // Walk-forward by slate: for each date, score using frozen model (already frozen)
  const byDate = {};
  for (const d of dates) {
    const subset = rows.filter((r) => r.slateDate === d);
    byDate[d] = bandTable(subset);
  }

  // Separation check
  function separationOk(table) {
    const low = table.LOW.winPct;
    const med = table.MEDIUM.winPct;
    const high = table.HIGH.winPct;
    return {
      lowStrongest:
        low != null &&
        (med == null || low >= med) &&
        (high == null || low > high),
      mediumAboveHigh: med != null && high != null ? med > high : null,
      mediumPositiveVsCoin: med != null ? med > 0.5 : null,
      highWeakest:
        high != null &&
        (med == null || high <= med) &&
        (low == null || high < low),
      ordering: { LOW: low, MEDIUM: med, HIGH: high },
    };
  }

  const aug7Official = loadAug7OfficialCandidates().map((o) => ({
    player: o.player,
    side: o.side,
    line: o.line,
    risk: o.risk,
    reliability: o.reliabilityProbability,
    trust: o.trustScore,
    pathway: o.safePathway,
    result: "PENDING",
    margin: null,
  }));

  const prospectiveLedger = {
    freezeId: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    slateDate: "2026-08-07",
    note: "Prospective collection — do not retune on these results until sample accumulates.",
    official: aug7Official,
    emptyTemplate: {
      riskTable: {
        LOW: { count: null, "W-L": null, "Win %": null, "Avg margin": null },
        MEDIUM: { count: null, "W-L": null, "Win %": null, "Avg margin": null },
        HIGH: { count: null, "W-L": null, "Win %": null, "Avg margin": null },
      },
      v1HighTransitions: {
        "V1 HIGH → V2 LOW": {
          count: null,
          wins: null,
          losses: null,
          winRate: null,
          avgMargin: null,
        },
        "V1 HIGH → V2 MEDIUM": {
          count: null,
          wins: null,
          losses: null,
          winRate: null,
          avgMargin: null,
        },
        "V1 HIGH → V2 HIGH": {
          count: null,
          wins: null,
          losses: null,
          winRate: null,
          avgMargin: null,
        },
      },
    },
  };

  const scorecard = {
    freezeId: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    historicalProviderCalls: 0,
    sampleN: rows.length,
    dates,
    riskTableExpanded171: riskTable,
    v1HighTransitions: transition,
    chronologicalOos: {
      trainDates: [...trainDates],
      testDates: [...testDates],
      train: bandTable(trainRows),
      test: bandTable(testRows),
      trainSeparation: separationOk(bandTable(trainRows)),
      testSeparation: separationOk(bandTable(testRows)),
    },
    fullSampleSeparation: separationOk(riskTable),
    byDate,
    philosophy: {
      prediction: "finds the side",
      reliability: "recognizes good predictions",
      LOW: "elite subset",
      MEDIUM: "worthwhile, not elite — next scientific focus AFTER freeze collection",
      HIGH: "protects from the rest",
    },
    productionReadyGate: {
      requires:
        "LOW clearly strongest; MEDIUM positive but below LOW; HIGH clearly weakest — preferably on chronological OOS",
      fullSample: separationOk(riskTable),
      chronologicalTest: separationOk(bandTable(testRows)),
    },
  };

  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_CALIBRATION_2_SCORECARD.json"),
    JSON.stringify(scorecard, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_CALIBRATION_2_ROW_LEVEL.json"),
    JSON.stringify({ freezeId, count: rows.length, rows }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_AUG7_PROSPECTIVE_LEDGER.json"),
    JSON.stringify(prospectiveLedger, null, 2)
  );

  // Human tables
  function fmtPct(x) {
    return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
  }
  function fmtM(x) {
    return x == null ? "—" : x.toFixed(2);
  }
  function rowLine(name, s) {
    return `| ${name} | ${s.count} | ${s.wl} | ${fmtPct(s.winPct)} | ${fmtM(s.avgMargin)} |`;
  }

  const md = `# EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 — FREEZE + SCORECARD

**Freeze ID:** \`EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2\`  
**Status:** FROZEN FOR PROSPECTIVE COLLECTION — no Calibration 3, no retuning  
**Odds historicalProviderCalls:** 0  
**Sample:** ${rows.length} graded (expanded model-ready)

## Locked

- Reliability coefficients (\`${RELIABILITY_MODEL_VERSION}\`)
- Trust formula (\`${TRUST_SCORE_VERSION}\`)
- LOW logic / MEDIUM logic / Pathways
- Conflict treatment / Missingness treatment / Market treatment

Manifest: \`EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_FREEZE.json\` (file SHA-256 hashes)

---

## Expanded ${rows.length}-set — risk bands

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
${rowLine("LOW", riskTable.LOW)}
${rowLine("MEDIUM", riskTable.MEDIUM)}
${rowLine("HIGH", riskTable.HIGH)}

**Separation (full sample):** LOW strongest=${scorecard.fullSampleSeparation.lowStrongest}; MEDIUM > HIGH=${scorecard.fullSampleSeparation.mediumAboveHigh}; HIGH weakest=${scorecard.fullSampleSeparation.highWeakest}

---

## V1 HIGH → V2 transitions (the population V1 could not understand)

| Transition | Count | Wins | Losses | Win rate | Avg margin |
|------------|------:|-----:|-------:|---------:|-----------:|
| V1 HIGH → V2 LOW | ${transition["V1_HIGH→V2_LOW"].count} | ${transition["V1_HIGH→V2_LOW"].W} | ${transition["V1_HIGH→V2_LOW"].L} | ${fmtPct(transition["V1_HIGH→V2_LOW"].winPct)} | ${fmtM(transition["V1_HIGH→V2_LOW"].avgMargin)} |
| V1 HIGH → V2 MEDIUM | ${transition["V1_HIGH→V2_MEDIUM"].count} | ${transition["V1_HIGH→V2_MEDIUM"].W} | ${transition["V1_HIGH→V2_MEDIUM"].L} | ${fmtPct(transition["V1_HIGH→V2_MEDIUM"].winPct)} | ${fmtM(transition["V1_HIGH→V2_MEDIUM"].avgMargin)} |
| V1 HIGH → V2 HIGH | ${transition["V1_HIGH→V2_HIGH"].count} | ${transition["V1_HIGH→V2_HIGH"].W} | ${transition["V1_HIGH→V2_HIGH"].L} | ${fmtPct(transition["V1_HIGH→V2_HIGH"].winPct)} | ${fmtM(transition["V1_HIGH→V2_HIGH"].avgMargin)} |

---

## Chronological out-of-sample

Train dates: ${[...trainDates].join(", ")}  
Test dates: ${[...testDates].join(", ")}

### Train

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
${rowLine("LOW", scorecard.chronologicalOos.train.LOW)}
${rowLine("MEDIUM", scorecard.chronologicalOos.train.MEDIUM)}
${rowLine("HIGH", scorecard.chronologicalOos.train.HIGH)}

### Test (untouched later slates)

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
${rowLine("LOW", scorecard.chronologicalOos.test.LOW)}
${rowLine("MEDIUM", scorecard.chronologicalOos.test.MEDIUM)}
${rowLine("HIGH", scorecard.chronologicalOos.test.HIGH)}

**Test separation:** LOW strongest=${scorecard.chronologicalOos.testSeparation.lowStrongest}; MEDIUM > HIGH=${scorecard.chronologicalOos.testSeparation.mediumAboveHigh}; ordering=${JSON.stringify(scorecard.chronologicalOos.testSeparation.ordering)}

---

## Philosophy (frozen)

Prediction finds the side → Reliability recognizes good predictions → LOW = elite → MEDIUM = worthwhile not elite → HIGH = protect.

**Next scientific focus after prospective collection:** MEDIUM recognition recall — without weakening LOW.

**Production:** remains OFF until prospective results confirm the separation on live nights.
`;

  fs.writeFileSync(path.join(OUT, "COURTEDGE_CALIBRATION_2_FREEZE_SCORECARD.md"), md);
  fs.writeFileSync(
    path.join(SERVER, "COURTEDGE_CALIBRATION_2_FREEZE_SCORECARD.md"),
    md
  );

  console.log(JSON.stringify({
    freezeId,
    sampleN: rows.length,
    riskTable,
    transition,
    trainDates: [...trainDates],
    testDates: [...testDates],
    testSeparation: scorecard.chronologicalOos.testSeparation,
    fullSampleSeparation: scorecard.fullSampleSeparation,
    out: OUT,
  }, null, 2));
}

main();
