/**
 * Read-only WNBA Over/Under side-symmetry audit (no live mutation).
 * Usage: node betbrain-server/scripts/auditWnbaSideSymmetryV1.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import {
  buildPlayerRoleProfile,
  buildPlayerProfileCalibration,
} from "../engines/playerRoleProfileV1.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import { evaluateSideRescue } from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import {
  evaluateDecisionDataIntelligence,
  applyDecisionDataIntelligenceToPick,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(
  __dirname,
  "fixtures/player-role-profile-wnba-2026-07-14-snapshot.json"
);

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normSide(v) {
  const s = String(v || "").toUpperCase();
  if (s.startsWith("OVER") || s === "O") return "OVER";
  if (s.startsWith("UNDER") || s === "U") return "UNDER";
  return null;
}

function countSides(items, getSide) {
  const c = { OVER: 0, UNDER: 0, NONE: 0 };
  for (const item of items) {
    const side = getSide(item);
    if (side === "OVER") c.OVER += 1;
    else if (side === "UNDER") c.UNDER += 1;
    else c.NONE += 1;
  }
  return c;
}

function fmt(c) {
  return `${c.OVER}O/${c.UNDER}U${c.NONE ? ` (+${c.NONE} none)` : ""}`;
}

function seasonFromCandidate(p) {
  const card = p.wnbaDataCard || {};
  const seasonPts = num(p.seasonAverage ?? card.season?.points, 12);
  const recentPts = num(p.last5Average ?? card.last5?.points, seasonPts);
  const recentMin = num(p.recentMinutes ?? card.last5?.minutes, 24);
  const recentFga = num(p.recentFGA ?? card.last5?.fga, 10);
  const recentFta = num(p.recentFTA ?? card.last5?.fta, 2);
  // Infer season minutes/fga when missing: shrink recent by role delta fraction.
  const role = p.roleChange || {};
  const seasonMin = num(
    card.season?.minutes,
    Math.max(12, recentMin - num(role.expectedMinutesDelta))
  );
  const seasonFga = num(
    card.season?.fga,
    Math.max(4, recentFga - num(role.expectedFGADelta))
  );
  const seasonFta = num(
    card.season?.fta,
    Math.max(0.5, recentFta - num(role.expectedFTADelta))
  );
  return {
    seasonMinutes: seasonMin,
    recentMinutes: recentMin,
    seasonFGA: seasonFga,
    recentFGA: recentFga,
    seasonFTA: seasonFta,
    recentFTA: recentFta,
    seasonPoints: seasonPts,
    recentPoints: recentPts,
    roleChange: role,
  };
}

function rebuildProjection(p, { applyProfile = true } = {}) {
  const inputs = seasonFromCandidate(p);
  const baseline = projectWnbaPoints({ ...inputs, profileCalibration: null });
  if (!applyProfile) {
    return {
      applyProfile: false,
      ...baseline,
      inputs,
    };
  }
  const profile = buildPlayerRoleProfile({
    last5: Array.from({ length: 5 }, () => ({
      points: inputs.recentPoints,
      minutes: inputs.recentMinutes,
      fga: inputs.recentFGA,
      fta: inputs.recentFTA,
    })),
    seasonGames: [],
    seasonMinutes: inputs.seasonMinutes,
    seasonFga: inputs.seasonFGA,
    seasonFta: inputs.seasonFTA,
    seasonPoints: inputs.seasonPoints,
    expectedMinutes: baseline.expectedMinutes,
    expectedFga: baseline.expectedFGA,
    expectedFta: baseline.expectedFTA,
    bookCount: num(p.bookCount, 1),
    roleChange: inputs.roleChange,
    gamesPlayed: 20,
  });
  const calibration = buildPlayerProfileCalibration(profile, {
    side: normSide(p.side) || "OVER",
  });
  const calibrated = projectWnbaPoints({
    ...inputs,
    profileCalibration: calibration,
  });
  return {
    applyProfile: true,
    profile,
    calibration,
    ...calibrated,
    inputs,
    baselineProjection: baseline.projection,
  };
}

function buildSyntheticCard(p, projection) {
  const inputs = seasonFromCandidate(p);
  return {
    playerId: p.player || "x",
    bookLine: num(p.line),
    dataMode: "WNBA_FULL_DATA",
    dataConfidenceScore: 62,
    projection: { projection },
    last5: {
      minutes: inputs.recentMinutes,
      fga: inputs.recentFGA,
      fta: inputs.recentFTA,
      points: inputs.recentPoints,
      ptsPerFGA: inputs.recentFGA > 0 ? inputs.recentPoints / inputs.recentFGA : 1.1,
    },
    season: {
      minutes: inputs.seasonMinutes,
      fga: inputs.seasonFGA,
      fta: inputs.seasonFTA,
      points: inputs.seasonPoints,
      ptsPerFGA: inputs.seasonFGA > 0 ? inputs.seasonPoints / inputs.seasonFGA : 1.05,
    },
    fairLine: {
      fairLine: projection,
      fairLineEdge: projection - num(p.line),
      fairLineQuality: 50,
    },
    injuryAvailability: { blocksPlay: false },
    minutesVolatility: "stable",
    dataMissingFlags: [],
  };
}

function auditCandidate(p, { applyProfile = true } = {}) {
  const rebuilt = rebuildProjection(p, { applyProfile });
  const projection = rebuilt.projection;
  const line = num(p.line);
  const gap = Number((projection - line).toFixed(2));
  const card = buildSyntheticCard(p, projection);
  const reader = readWnbaProp(card);
  const pickBase = {
    player: p.player,
    side: reader.finalSide === "UNDER" ? "Under" : "Over",
    pick: reader.finalSide === "UNDER" ? "Under" : "Over",
    line,
    projection,
    league: "WNBA",
    bookCount: num(p.bookCount, 1),
    wnbaDataCard: card,
    wnbaReader: reader,
    roleChange: p.roleChange,
    initialSide: reader.finalSide,
    confidence: 72,
    dataConfidence: card.dataConfidenceScore,
    directionalConfidence: 72,
    decisionIntelligence: {
      trueRisk: p.decisionIntelligence?.trueRisk || "MEDIUM",
      trackEligibility: p.trackingEligibility || "BOARD_ONLY",
      riskDebts: [
        {
          code: "THIN_EDGE",
          severity: "MEDIUM",
          reason: "audit trigger",
          side: reader.finalSide || "OVER",
        },
      ],
    },
  };

  const ddiPick = applyDecisionDataIntelligenceToPick(pickBase, {
    dataCard: card,
    reader,
    originalSide: reader.finalSide,
  });
  const flip = ddiPick.decisionDataIntelligence?.flipFirstDecision ||
    evaluateFlipFirstSideSelection(ddiPick, {
      dataCard: card,
      reader,
      originalSide: reader.finalSide,
    });
  const sideRescue = evaluateSideRescue(ddiPick, {
    dataCard: card,
    reader,
    originalSide: reader.finalSide,
    decisionIntelligence: ddiPick.decisionIntelligence,
  });

  const comps = rebuilt.projectionComponents || {};
  const remainder = comps.remainder ?? null;
  return {
    player: p.player,
    line,
    snapProjection: num(p.projection),
    rebuiltProjection: projection,
    gap,
    projectionAboveLine: gap > 0,
    applyProfile,
    profileDirection: rebuilt.profile?.roleDirection || null,
    profileStability: rebuilt.profile?.roleStability || null,
    profileDelta: rebuilt.profileProjectionDelta ?? 0,
    projectionComponents: comps,
    componentsReconcileOk:
      remainder == null || Math.abs(num(remainder)) <= 0.15,
    readerFinalSide: reader.finalSide,
    overScore: reader.overCase?.score,
    underScore: reader.underCase?.score,
    overPre: reader.overCase?.preGapPenaltyScore,
    underPre: reader.underCase?.preGapPenaltyScore,
    overEligible: reader.overCase && !reader.overCase.blocked,
    underEligible: reader.underCase && !reader.underCase.blocked,
    flipAction: flip.action,
    flipOriginalScore: flip.originalSideScore,
    flipOppositeScore: flip.oppositeSideScore,
    sideRescueAction: sideRescue.action,
    sideRescueOriginal: sideRescue.originalSideScore,
    sideRescueOpposite: sideRescue.oppositeSideScore,
    dataConfidence: ddiPick.dataConfidence,
    directionalConfidence: ddiPick.directionalConfidence,
    finalConfidence: ddiPick.finalConfidence,
    confidenceInfluenceAdjustment: ddiPick.confidenceInfluenceAdjustment,
    trueRisk: p.decisionIntelligence?.trueRisk || null,
    trackingEligibility: p.trackingEligibility,
  };
}

function stageCounts(rows) {
  return {
    projAbove: rows.filter((r) => r.projectionAboveLine).length,
    projBelow: rows.filter((r) => !r.projectionAboveLine && r.gap !== 0).length,
    reader: countSides(rows, (r) => r.readerFinalSide),
    flipKeepLike: rows.filter((r) =>
      ["KEPT_ORIGINAL", "CHECK_UNDER", "CHECK_OVER", "BOTH_SIDES_WEAK"].includes(
        r.flipAction
      )
    ).length,
    flipFlippedUnder: rows.filter((r) => r.flipAction === "FLIPPED_TO_UNDER").length,
    flipFlippedOver: rows.filter((r) => r.flipAction === "FLIPPED_TO_OVER").length,
    bothSidesWeak: rows.filter((r) => r.flipAction === "BOTH_SIDES_WEAK").length,
    sideRescueKeep: rows.filter((r) => r.sideRescueAction === "KEEP_ORIGINAL").length,
    sideRescueFlip: rows.filter((r) => r.sideRescueAction === "FLIP_SIDE").length,
    avgConf: Number(
      (
        rows.reduce((s, r) => s + num(r.finalConfidence), 0) / Math.max(1, rows.length)
      ).toFixed(1)
    ),
    avgOppositeRescue: Number(
      (
        rows.reduce((s, r) => s + num(r.sideRescueOpposite), 0) /
        Math.max(1, rows.length)
      ).toFixed(1)
    ),
    avgGap: Number(
      (rows.reduce((s, r) => s + num(r.gap), 0) / Math.max(1, rows.length)).toFixed(2)
    ),
  };
}

function loadFrozenSlates() {
  const slates = [];
  if (fs.existsSync(FIXTURE)) {
    slates.push({
      name: "jul14-role-profile-snapshot",
      data: JSON.parse(fs.readFileSync(FIXTURE, "utf8")),
    });
  }
  const extraDirs = [
    path.join(ROOT, ".tmp-six-props-export.json"),
    path.join(ROOT, ".tmp-six-props-all.json"),
  ];
  for (const f of extraDirs) {
    if (!fs.existsSync(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      slates.push({ name: path.basename(f), data });
    } catch {
      /* skip */
    }
  }
  return slates;
}

function candidatesFromSlate(data) {
  if (Array.isArray(data.candidates) && data.candidates.length) return data.candidates;
  if (Array.isArray(data.players) && data.players.length) return data.players;
  if (Array.isArray(data.props) && data.props.length) return data.props;
  if (Array.isArray(data.bestSix) && data.bestSix.length) return data.bestSix;
  if (Array.isArray(data)) return data;
  return [];
}

function runFourPass(candidates) {
  const passes = [
    { key: "current_or_fixed_profile_OFF", applyProfile: false },
    { key: "current_or_fixed_profile_ON", applyProfile: true },
  ];
  // After fix, both are fixed engine; off/on is profile only.
  const out = {};
  for (const pass of passes) {
    const rows = candidates.map((c) => auditCandidate(c, pass));
    out[pass.key] = {
      stage: stageCounts(rows),
      players: rows,
    };
  }
  return out;
}

function syntheticMirrorCorpus() {
  const mk = (gap) => {
    const line = 15.5;
    const projection = line + gap;
    return {
      player: `Mirror gap ${gap}`,
      line,
      projection,
      seasonAverage: line,
      last5Average: line + gap * 0.4,
      recentMinutes: 28,
      recentFGA: 11,
      recentFTA: 3,
      bookCount: 2,
      roleChange: {},
      trackingEligibility: "BOARD_ONLY",
      decisionIntelligence: { trueRisk: "MEDIUM" },
      wnbaDataCard: {
        fairLine: {
          fairLine: projection,
          fairLineEdge: gap,
          fairLineQuality: 55,
          fairLineSide: gap >= 0 ? "OVER" : "UNDER",
        },
      },
    };
  };
  // Direct reader mirror (auditCandidate rebuild path uses volume-first).
  return {
    plus5: auditCandidate(mk(5), { applyProfile: false }),
    minus5: auditCandidate(mk(-5), { applyProfile: false }),
  };
}

function main() {
  const slates = loadFrozenSlates();
  const report = {
    generatedAt: new Date().toISOString(),
    serverBuildIntent: "courteedge-wnba-side-symmetry-over-bias-fix-v1",
    fixturePath: FIXTURE,
    slateCount: slates.length,
    slates: [],
    mirrored: syntheticMirrorCorpus(),
    findings: [],
  };

  for (const slate of slates) {
    const candidates = candidatesFromSlate(slate.data).slice(0, 12);
    if (!candidates.length) continue;
    const four = runFourPass(candidates);
    const off = four.current_or_fixed_profile_OFF;
    const on = four.current_or_fixed_profile_ON;
    report.slates.push({
      name: slate.name,
      slateDate: slate.data.slateDate || null,
      candidateCount: candidates.length,
      profileOff: off.stage,
      profileOn: on.stage,
      playersProfileOn: on.players,
      playersProfileOff: off.players,
    });
  }

  const jul = report.slates.find((s) => s.name.includes("jul14"));
  if (jul) {
    const zeros = (jul.playersProfileOn || []).filter(
      (p) => num(p.sideRescueOpposite) === 0
    );
    report.findings.push({
      code: "JUL14_OPPOSITE_UNDER_SCORES",
      detail: `${zeros.length}/${jul.playersProfileOn.length} opposite Side Rescue scores at 0 after fix`,
      avgOpposite: jul.profileOn.avgOppositeRescue,
      avgGap: jul.profileOn.avgGap,
      reader: fmt(jul.profileOn.reader),
      avgConf: jul.profileOn.avgConf,
    });
    report.findings.push({
      code: "CONCENTRATION_STAGE",
      detail:
        jul.profileOn.avgGap > 2
          ? "Directional concentration begins at projection (avg gap > 2) before Reader"
          : "Projection gaps moderate — inspect Reader/Flip-First next",
    });
  }

  const { plus5, minus5 } = report.mirrored;
  report.findings.push({
    code: "MIRRORED_GAP_SYMMETRY",
    plus5Side: plus5.readerFinalSide,
    minus5Side: minus5.readerFinalSide,
    plus5Over: plus5.overScore,
    minus5Under: minus5.underScore,
    symmetric:
      plus5.readerFinalSide === "OVER" &&
      minus5.readerFinalSide === "UNDER" &&
      Math.abs(num(plus5.overScore) - num(minus5.underScore)) <= 3,
  });

  const outPath = path.join(
    __dirname,
    "../COURTEDGE_WNBA_SIDE_SYMMETRY_AUDIT_V1.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("Wrote", outPath);
  console.log(JSON.stringify({ findings: report.findings, mirrored: report.mirrored, slateSummary: report.slates.map((s) => ({ name: s.name, off: s.profileOff, on: s.profileOn })) }, null, 2));
}

main();
