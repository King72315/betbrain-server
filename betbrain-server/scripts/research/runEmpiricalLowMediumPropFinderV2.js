/**
 * Empirical Low & Medium Prop Finder V2 — full historical + Aug7 runner.
 * historicalProviderCalls = 0
 * Freeze: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_1
 */
process.env.EMPIRICAL_SAFE_PROP_V2 = "true";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildCanonicalPlayerForecastPacketV1,
  evaluateSideForecastPacketV1,
  selectOfficialBoardFromProbabilitySafetyV1,
} from "../../engines/probabilitySafetyV1/index.js";
import {
  classifyRiskEmpiricalV2,
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  annotateSlateRelativeStrengthV1,
} from "../../engines/empiricalSafePropV2/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT = path.join(SERVER, "research", "empirical-safe-prop-v2");
const EXPORTS = path.join(OUT, "exports");
const FINDER_OUT = path.join(OUT, "finder-v2");
fs.mkdirSync(EXPORTS, { recursive: true });
fs.mkdirSync(FINDER_OUT, { recursive: true });

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

function wl(rows) {
  let W = 0,
    L = 0,
    P = 0;
  for (const r of rows) {
    const g = String(r.result || r.grade || "").toUpperCase();
    if (g === "WIN" || g === "W") W++;
    else if (g === "LOSS" || g === "L") L++;
    else if (g === "PUSH" || g === "P") P++;
  }
  const n = W + L;
  return { W, L, P, n: W + L + P, winRate: n ? W / n : null };
}

function detector(rows, isQualified) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const r of rows) {
    const win = String(r.result || "").toUpperCase() === "WIN";
    const q = isQualified(r);
    if (q && win) tp++;
    else if (q && !win) fp++;
    else if (!q && !win) tn++;
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const coverage = rows.length ? (tp + fp) / rows.length : null;
  const fnr = recall == null ? null : 1 - recall;
  return { tp, fp, tn, fn, precision, recall, fnr, coverage };
}

function classifyV1FromRecord(r) {
  // Prefer stored V1 risk; else recompute via evaluate with V2 off
  if (r.v1Risk) return r.v1Risk;
  if (r.riskV1) return r.riskV1;
  if (r.trueRiskV1) return r.trueRiskV1;
  return null;
}

function toPick(r) {
  const side = sideNorm(r.side || r.pick || r.selectedSide);
  const projection = num(
    r.projection ?? r.projectedPoints ?? r.originalProjection
  );
  const fairLine = num(
    r.fairLine ?? r.originalFairLine ?? projection
  );
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

function loadModelReady() {
  const p = path.join(EXPORTS, "COURTEDGE_EMPIRICAL_SAFE_PROP_MODEL_READY_V2.json");
  const j = readJson(p, { records: [] });
  const base = (j.records || []).filter((r) => {
    const d = r.slateDateCT || r.slateDate || r.date;
    if (d === "2026-08-05" || r.contaminated) return false;
    if (d === "2026-08-07" || r.prospectiveHoldout) return false;
    const res = String(r.result || r.grade || "").toUpperCase();
    return res === "WIN" || res === "LOSS" || res === "W" || res === "L";
  });

  // Merge recovered rejected graded pools (home-day / freezes / Jul19 / Jul21 / Aug3)
  const recovered = readJson(
    path.join(EXPORTS, "COURTEDGE_RECOVERED_REJECTED_GRADED_V2.json"),
    { records: [] }
  );
  const seen = new Set(
    base.map(
      (r) =>
        `${r.slateDateCT || r.slateDate}|${cleanName(r.playerName || r.player)}|${sideNorm(r.selectedSide || r.side)}|${num(r.line)}`
    )
  );
  const extras = [];
  for (const r of recovered.records || []) {
    if (r.contaminated || r.prospectiveHoldout) continue;
    if (r.originalProjection == null) continue;
    const res = String(r.result || "").toUpperCase();
    if (res !== "WIN" && res !== "LOSS") continue;
    const key = `${r.slateDateCT}|${cleanName(r.playerName)}|${r.selectedSide}|${num(r.line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      ...r,
      counterfactualGrade: true,
      sourceTrustClass: r.actualJoinSource === "ESPN_BOXSCORE" ? "B" : "B",
      recoveryPass: "rejected-pool-ingest-v2.1",
    });
  }

  // Persist expanded model-ready for audit
  const expanded = [...base, ...extras];
  fs.writeFileSync(
    path.join(EXPORTS, "COURTEDGE_EMPIRICAL_SAFE_PROP_MODEL_READY_V2_EXPANDED.json"),
    JSON.stringify(
      {
        build: EMPIRICAL_SAFE_PROP_V2_BUILD,
        recoveryPass: "rejected-pool-ingest-v2.1",
        baseCount: base.length,
        recoveredAdded: extras.length,
        count: expanded.length,
        records: expanded,
      },
      null,
      2
    )
  );
  console.log("modelReady base", base.length, "+recovered", extras.length, "=", expanded.length);
  return expanded;
}

function loadAug7RawCandidates() {
  const p = path.join(SERVER, "_ps_aug7_refresh_raw.json");
  const raw = readJson(p, null);
  if (!raw) return [];
  const out = [];
  const games = raw.games || raw.boardCache?.games || [];
  for (const g of games) {
    for (const c of g.allGeneratedCandidates || []) {
      out.push({
        slateDateCT: "2026-08-07",
        playerName: c.playerName || c.player,
        team: c.team,
        opponent: c.opponent,
        selectedSide: sideNorm(c.side || c.pick),
        line: num(c.line),
        originalProjection: num(c.projection),
        originalFairLine: num(c.fairLine),
        bookCount: num(c.bookCount),
        avgMinutesL5: num(c.recentMinutes ?? c.avgMinutesL5),
        expectedFGA: num(c.expectedFGA ?? c.avgFGA),
        avgPointsL5: num(c.last5Average),
        avgPoints: num(c.seasonAverage),
        availabilityStatus: c.availabilityStatus || "ACTIVE",
        isStarter: c.isStarter,
        result: "PENDING",
        prospectiveHoldout: true,
      });
    }
  }
  return out;
}

function replayOne(r, v2) {
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
  return {
    playerName: pick.playerName,
    side: pick.side,
    line: pick.line,
    projection: pick.projection,
    slateDate: pick.slateDate,
    result: r.result || r.grade,
    risk: pkt.risk?.risk,
    reliabilityProbability: pkt.risk?.reliabilityProbability ?? null,
    trustScore: pkt.risk?.trustScore ?? null,
    SafetyScore: pkt.safety?.finalSafetyScore ?? null,
    rawWinProbability: pkt.rawWinProbability,
    safePathway: pkt.risk?.safePathway ?? null,
    pathwayScore: pkt.risk?.pathwayScore ?? null,
    reasons: pkt.risk?.officialRejectionReasons || [],
    whyNotLow: pkt.risk?.whyNotLow || [],
    softFlags: pkt.risk?.softFlags || [],
    explanation: pkt.risk?.explanation || null,
    minutesStability: pkt.minutes?.minutesStabilityScore ?? null,
    roleStability: pkt.role?.roleStabilityScore ?? null,
  };
}

function main() {
  console.log("FINDER V2", EMPIRICAL_SAFE_PROP_V2_BUILD, EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE);
  const modelReady = loadModelReady();
  console.log("modelReady", modelReady.length);

  const rows = [];
  for (const r of modelReady) {
    const v1 =
      replayOne(r, false) ||
      ({
        risk: classifyV1FromRecord(r) || r.trueRisk || "HIGH",
        playerName: r.playerName || r.player,
        side: sideNorm(r.side || r.pick),
        line: num(r.line),
        result: r.result || r.grade,
      });
    const v2 = replayOne(r, true);
    if (!v2) continue;
    rows.push({
      ...r,
      playerName: v2.playerName,
      side: v2.side,
      line: v2.line,
      result: String(v2.result || r.result || r.grade || "").toUpperCase().replace(/^W$/, "WIN").replace(/^L$/, "LOSS"),
      slateDate: v2.slateDate || r.slateDate,
      v1Risk: v1.risk,
      v2Risk: v2.risk,
      v2Reliability: v2.reliabilityProbability,
      v2Trust: v2.trustScore,
      v2Safety: v2.SafetyScore,
      v2RawP: v2.rawWinProbability,
      v2Pathway: v2.safePathway,
      v2Reasons: v2.reasons,
    });
  }

  const byRisk = (key, risk) => rows.filter((r) => r[key] === risk);
  const v1Low = wl(byRisk("v1Risk", "LOW"));
  const v1Med = wl(byRisk("v1Risk", "MEDIUM"));
  const v1High = wl(byRisk("v1Risk", "HIGH"));
  const v2Low = wl(byRisk("v2Risk", "LOW"));
  const v2Med = wl(byRisk("v2Risk", "MEDIUM"));
  const v2High = wl(byRisk("v2Risk", "HIGH"));

  const v1Det = detector(rows, (r) => r.v1Risk === "LOW" || r.v1Risk === "MEDIUM");
  const v2Det = detector(rows, (r) => r.v2Risk === "LOW" || r.v2Risk === "MEDIUM");

  // Rescue analysis
  const v1HighWinners = rows.filter(
    (r) => r.v1Risk === "HIGH" && r.result === "WIN"
  );
  const v1HighLosers = rows.filter(
    (r) => r.v1Risk === "HIGH" && r.result === "LOSS"
  );
  const winnerRescued = v1HighWinners.filter(
    (r) => r.v2Risk === "LOW" || r.v2Risk === "MEDIUM"
  );
  const loserRescued = v1HighLosers.filter(
    (r) => r.v2Risk === "LOW" || r.v2Risk === "MEDIUM"
  );
  const winnerRescueRate = v1HighWinners.length
    ? winnerRescued.length / v1HighWinners.length
    : null;
  const loserRescueRate = v1HighLosers.length
    ? loserRescued.length / v1HighLosers.length
    : null;
  const winnerRescuedLow = v1HighWinners.filter((r) => r.v2Risk === "LOW");
  const loserRescuedLow = v1HighLosers.filter((r) => r.v2Risk === "LOW");
  const winnerRescueLowRate = v1HighWinners.length
    ? winnerRescuedLow.length / v1HighWinners.length
    : null;
  const loserRescueLowRate = v1HighLosers.length
    ? loserRescuedLow.length / v1HighLosers.length
    : null;
  const rescueSeparation =
    winnerRescueRate != null && loserRescueRate != null
      ? winnerRescueRate - loserRescueRate
      : null;

  const baselineWR = wl(rows).winRate;
  const v2Qual = rows.filter((r) => r.v2Risk === "LOW" || r.v2Risk === "MEDIUM");
  const v2QualWR = wl(v2Qual).winRate;
  const safePropRecognitionLift =
    baselineWR != null && v2QualWR != null ? v2QualWR - baselineWR : null;
  const lowLift =
    baselineWR != null && v2Low.winRate != null ? v2Low.winRate - baselineWR : null;
  const medLift =
    baselineWR != null && v2Med.winRate != null ? v2Med.winRate - baselineWR : null;

  // Pathway breakdown
  const pathwayStats = {};
  for (const r of rows) {
    const pw = r.v2Pathway || "NONE";
    if (!pathwayStats[pw]) pathwayStats[pw] = [];
    pathwayStats[pw].push(r);
  }
  const pathways = Object.fromEntries(
    Object.entries(pathwayStats).map(([k, arr]) => {
      const s = wl(arr);
      return [
        k,
        {
          n: arr.length,
          ...s,
          smallSample: arr.length < 8,
        },
      ];
    })
  );

  // Class distribution
  const classDist = {
    LOW: rows.filter((r) => r.v2Risk === "LOW").length / Math.max(1, rows.length),
    MEDIUM: rows.filter((r) => r.v2Risk === "MEDIUM").length / Math.max(1, rows.length),
    HIGH: rows.filter((r) => r.v2Risk === "HIGH").length / Math.max(1, rows.length),
  };

  // Aug7 same-packet from preserved raw board freeze
  const aug7Source = loadAug7RawCandidates();
  const focusNames = [
    "leilalacan",
    "lacan",
    "aliyahboston",
    "boston",
    "marinamabrey",
    "mabrey",
    "olivianelsonododa",
    "nelsonododa",
    "veronicaburton",
    "burton",
    "mariaconde",
    "conde",
  ];

  const aug7Rows = [];
  for (const r of aug7Source) {
    const pick = toPick(r);
    if (!pick.side || pick.line == null || pick.projection == null) continue;
    const seed =
      Math.abs(
        [...String(pick.playerName) + String(pick.line)].reduce(
          (h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0,
          0
        )
      ) || 7;
    const v1 = evaluateSideForecastPacketV1(pick, {
      empiricalSafePropV2: false,
      simulationCount: 1500,
      seed,
    });
    const v2 = evaluateSideForecastPacketV1(pick, {
      empiricalSafePropV2: true,
      simulationCount: 1500,
      seed,
    });
    const cn = cleanName(pick.playerName);
    aug7Rows.push({
      playerName: pick.playerName,
      side: pick.side,
      line: pick.line,
      projection: pick.projection,
      fairLine: pick.fairLine,
      bookCount: pick.bookCount,
      avgMinutesL5: pick.avgMinutesL5,
      v1Risk: v1.risk?.risk,
      v2Risk: v2.risk?.risk,
      v1Safety: v1.safety?.finalSafetyScore,
      v2Reliability: v2.risk?.reliabilityProbability,
      v2Trust: v2.risk?.trustScore,
      v2Safety: v2.safety?.finalSafetyScore,
      rawProbability: v2.rawWinProbability,
      pathway: v2.risk?.safePathway,
      pathwayEvidence: v2.risk?.pathwayEvidence,
      whyNotLow: v2.risk?.whyNotLow,
      v1Reasons: v1.risk?.failedLowReasons || v1.risk?.officialRejectionReasons || [],
      v2Reasons: v2.risk?.officialRejectionReasons || [],
      explanation: v2.risk?.explanation?.plainLanguage || null,
      changed: v1.risk?.risk !== v2.risk?.risk,
      focus: focusNames.some((f) => cn.includes(f) || f.includes(cn)),
      sourcePick: pick,
    });
  }

  const rankedAug7 = annotateSlateRelativeStrengthV1(
    aug7Rows.map((r) => ({
      ...r,
      reliabilityProbability: r.v2Reliability,
      trustScore: r.v2Trust,
      SafetyScore: r.v2Safety,
      rawWinProbability: r.rawProbability,
    }))
  );

  const board = selectOfficialBoardFromProbabilitySafetyV1(
    rankedAug7.map((r) => r.sourcePick),
    {
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-07",
      simulationCount: 1500,
      seed: 7,
    }
  );

  const official = (board.selectedProps || []).map((p, i) => ({
    rank: i + 1,
    player: p.playerName || p.player,
    game: p.game || `${p.team} vs ${p.opponent}`,
    side: p.side || p.pick,
    line: p.line,
    risk: p.trueRisk,
    rawWinProbability: p.rawWinProbability,
    reliabilityProbability: p.reliabilityProbability,
    trustScore: p.trustScore,
    SafetyScore: p.safetyScore ?? p.SafetyScore,
    projection: p.projection,
    fairLine: p.fairLine,
    projectionEdge: p.projectionEdge,
    expectedMinutes: p.expectedMinutes,
    minutesStability: p.minutesStabilityScore,
    roleStability: p.roleStabilityScore,
    marketQuality: p.marketQualityScore,
    bookCount: p.bookCount,
    conflict: p.conflictIndex,
    failurePaths: p.failurePaths,
    safePathway: p.safePathway,
    slateReliabilityRank: p.slateReliabilityRank,
    slatePercentile: p.slatePercentile,
    why: p.riskExplanation?.plainLanguage || null,
    whyNotLow: p.whyNotLow,
  }));

  // Near-LOW if empty
  const nearLow = rankedAug7
    .filter((r) => r.v2Risk === "HIGH")
    .sort((a, b) => (b.v2Reliability || 0) - (a.v2Reliability || 0))
    .slice(0, 5)
    .map((r) => ({
      player: r.playerName,
      side: r.side,
      line: r.line,
      reliability: r.v2Reliability,
      trust: r.v2Trust,
      safety: r.v2Safety,
      pathway: r.pathway,
      reasonsHigh: r.v2Reasons,
      whyNotLow: r.whyNotLow,
    }));

  const topHigh = rankedAug7
    .filter((r) => r.v2Risk === "HIGH")
    .sort((a, b) => (b.v2Reliability || 0) - (a.v2Reliability || 0))
    .slice(0, 10)
    .map((r) => ({
      player: r.playerName,
      side: r.side,
      line: r.line,
      reliability: r.v2Reliability,
      trust: r.v2Trust,
      safety: r.v2Safety,
      mainReasonHigh: (r.v2Reasons || [])[0] || "reliability_or_pathway",
    }));

  const focusReport = rankedAug7.filter((r) => r.focus);

  const summary = {
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    productionFreeze: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
    historicalProviderCalls: 0,
    sample: {
      modelReadyGraded: rows.length,
      baselineWinRate: baselineWR,
    },
    v1: { LOW: v1Low, MEDIUM: v1Med, HIGH: v1High, detector: v1Det },
    v2: {
      LOW: v2Low,
      MEDIUM: v2Med,
      HIGH: v2High,
      detector: v2Det,
      classDistribution: classDist,
    },
    rescue: {
      v1HighWinners: v1HighWinners.length,
      winnerRescued: winnerRescued.length,
      winnerRescueRate,
      v1HighLosers: v1HighLosers.length,
      loserRescued: loserRescued.length,
      loserRescueRate,
      rescueSeparation,
      winnerRescuedLow: winnerRescuedLow.length,
      loserRescuedLow: loserRescuedLow.length,
      winnerRescueLowRate,
      loserRescueLowRate,
      targetShapeNote:
        "Prefer winnerRescue ~75-85% with loserRescue ~20-35% (examples, not hard gates). LOW should be far more selective than MEDIUM recognition.",
      winnerRescueDetails: winnerRescued.slice(0, 40).map((r) => ({
        player: r.playerName,
        side: r.side,
        line: r.line,
        date: r.slateDate,
        v2Risk: r.v2Risk,
        reliability: r.v2Reliability,
        trust: r.v2Trust,
        pathway: r.v2Pathway,
      })),
    },
    lift: {
      safePropRecognitionLift,
      lowLift,
      medLift,
    },
    pathways,
    aug7: {
      candidateCount: rankedAug7.length,
      changed: rankedAug7.filter((r) => r.changed).length,
      focus: focusReport,
      LOW: rankedAug7.filter((r) => r.v2Risk === "LOW").length,
      MEDIUM: rankedAug7.filter((r) => r.v2Risk === "MEDIUM").length,
      HIGH: rankedAug7.filter((r) => r.v2Risk === "HIGH").length,
      officialCount: official.length,
      official,
      nearLowIfEmpty: official.length === 0 ? nearLow : null,
      topHigh,
      allRows: rankedAug7,
    },
    acceptance: {
      giantAndGateReplaced: true,
      winnerRescueExceedsLoser:
        winnerRescueRate != null &&
        loserRescueRate != null &&
        winnerRescueRate > loserRescueRate,
      rescueSeparationWidened:
        rescueSeparation != null && rescueSeparation >= 0.25,
      loserRescueNotOverTrusting:
        loserRescueRate == null || loserRescueRate <= 0.4,
      lowMoreSelectiveThanPrior:
        classDist.LOW <= 0.45 && classDist.HIGH >= 0.25,
      recallImproved: (v2Det.recall || 0) > (v1Det.recall || 0) + 0.05,
      precisionOk: (v2Det.precision || 0) >= 0.55,
      lowPositive: v2Low.n === 0 || (v2Low.winRate || 0) >= 0.6,
      productionDefaultOff: true,
      productionFreeze: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
      status: "CALIBRATION_2_NOT_PRODUCTION",
    },
  };

  fs.writeFileSync(
    path.join(FINDER_OUT, "_finder_v2_summary.json"),
    JSON.stringify(summary, null, 2)
  );
  fs.writeFileSync(
    path.join(FINDER_OUT, "COURTEDGE_AUG7_FINDER_V2_SLATE.json"),
    JSON.stringify(
      {
        build: EMPIRICAL_SAFE_PROP_V2_BUILD,
        freeze: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
        official,
        topHigh,
        nearLow: summary.aug7.nearLowIfEmpty,
        allCandidates: rankedAug7,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(EXPORTS, "COURTEDGE_AUG7_V1_VS_V2_REPLAY.json"),
    JSON.stringify({ count: rankedAug7.length, rows: rankedAug7 }, null, 2)
  );

  console.log(JSON.stringify({
    sample: summary.sample,
    v1: summary.v1,
    v2: summary.v2,
    rescue: {
      winnerRescueRate,
      loserRescueRate,
      winnerRescued: winnerRescued.length,
      loserRescued: loserRescued.length,
    },
    lift: summary.lift,
    aug7: {
      LOW: summary.aug7.LOW,
      MEDIUM: summary.aug7.MEDIUM,
      HIGH: summary.aug7.HIGH,
      official: official.length,
      changed: summary.aug7.changed,
      focus: focusReport.map((f) => ({
        player: f.playerName,
        side: f.side,
        line: f.line,
        v1: f.v1Risk,
        v2: f.v2Risk,
        rel: f.v2Reliability,
        trust: f.v2Trust,
        pathway: f.pathway,
      })),
    },
    acceptance: summary.acceptance,
  }, null, 2));
}

main();
