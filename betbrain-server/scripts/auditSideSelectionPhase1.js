/**
 * Phase 1 audit — tracking population, reader side ratios, Side Rescue usefulness.
 * Usage: node betbrain-server/scripts/auditSideSelectionPhase1.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TRACKING_MODE } from "../services/trackedPropService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return "";
}

function countSides(props = []) {
  const counts = { OVER: 0, UNDER: 0, OTHER: 0 };
  for (const p of props) {
    const side = normalizeSide(p.side || p.pick || p.currentEngineSide);
    if (side === "OVER" || side === "UNDER") counts[side] += 1;
    else counts.OTHER += 1;
  }
  return counts;
}

function wlp(props = [], sideFilter = null) {
  const filtered = sideFilter
    ? props.filter((p) => normalizeSide(p.side || p.pick || p.currentEngineSide) === sideFilter)
    : props;
  const graded = filtered.filter((p) => ["win", "loss", "push"].includes(String(p.status || "").toLowerCase()));
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  return { wins, losses, pushes, graded: graded.length };
}

function auditSlate(props = [], slateDate = "unknown") {
  const readerOver = props.filter((p) => normalizeSide(p.wnbaReader?.finalSide || p.readerSide) === "OVER").length;
  const readerUnder = props.filter((p) => normalizeSide(p.wnbaReader?.finalSide || p.readerSide) === "UNDER").length;
  const postFlipOver = props.filter((p) => {
    const side = normalizeSide(p.flipFirstDecision?.finalSide || p.side || p.pick);
    return side === "OVER";
  }).length;
  const postFlipUnder = props.filter((p) => {
    const side = normalizeSide(p.flipFirstDecision?.finalSide || p.side || p.pick);
    return side === "UNDER";
  }).length;
  const board = countSides(props);
  const bestSix = countSides(props.filter((p) => p.controlledBestSixDisplay || p.bestSixRank));
  const overWlp = wlp(props, "OVER");
  const underWlp = wlp(props, "UNDER");

  return {
    slateDate,
    propCount: props.length,
    readerOverCount: readerOver,
    readerUnderCount: readerUnder,
    postFlipOverCount: postFlipOver,
    postFlipUnderCount: postFlipUnder,
    finalBoardOverCount: board.OVER,
    finalBoardUnderCount: board.UNDER,
    bestSixOverCount: bestSix.OVER,
    bestSixUnderCount: bestSix.UNDER,
    overWLP: overWlp,
    underWLP: underWlp,
  };
}

function auditSideRescue(props = []) {
  let review = 0;
  let kept = 0;
  let changed = 0;
  let reversedFlipFirst = 0;
  let noEffect = 0;
  let beneficial = 0;
  let harmful = 0;
  let missed = 0;

  for (const p of props) {
    const sr = p.sideRescue || {};
    const action = String(sr.action || p.sideRescueAction || "").toUpperCase();
    if (!action || action === "NONE" || action === "PASS") {
      noEffect += 1;
      continue;
    }
    review += 1;
    if (action === "FLIP_SIDE") {
      changed += 1;
      const ff = p.flipFirstDecision || {};
      if (ff.flipRecommended && normalizeSide(ff.finalSide) !== normalizeSide(sr.finalSide)) {
        reversedFlipFirst += 1;
      }
      const status = String(p.status || "").toLowerCase();
      if (status === "win") beneficial += 1;
      if (status === "loss") harmful += 1;
    } else {
      kept += 1;
      const status = String(p.status || "").toLowerCase();
      if (status === "loss") {
        const actual = Number(p.actualStat);
        const line = Number(p.line);
        const side = normalizeSide(p.side || p.pick);
        if (actual && line) {
          const oppWin =
            (side === "OVER" && actual < line) || (side === "UNDER" && actual > line);
          if (oppWin) missed += 1;
        }
      }
    }
  }

  return {
    sideRescueReviewCount: review,
    sideRescueKeptOriginalCount: kept,
    sideRescueChangedSideCount: changed,
    sideRescueReversedFlipFirstCount: reversedFlipFirst,
    sideRescueNoEffectCount: noEffect,
    beneficialFlips: beneficial,
    harmfulFlips: harmful,
    missedBeneficialFlips: missed,
  };
}

function auditTrackingPopulation(bundleProps = [], trackedProps = []) {
  const displayBestSix = bundleProps.filter((p) => p.controlledBestSixDisplay || p.bestSixRank);
  const naturalTrack = bundleProps.filter((p) => {
    const el = String(
      p.decisionIntelligence?.originalGateEligibility ||
        p.naturalDecision ||
        p.decisionIntelligence?.trackEligibility ||
        ""
    ).toUpperCase();
    return el === "TRACK";
  });
  const promoted = bundleProps.filter((p) => p.decisionIntelligence?.bestSixPromoted || p.bestSixQualityFlags?.length);

  return {
    trackingMode: TRACKING_MODE,
    generatedCandidateCount: bundleProps.length,
    displayBestSixCount: displayBestSix.length || Math.min(6, bundleProps.length),
    naturalTrackCount: naturalTrack.length,
    promotedTrackCount: promoted.length,
    persistedResultsCount: trackedProps.length,
    persistedPropIds: trackedProps.map((p) => p.trackedId || `${p.player}-${p.line}-${p.side}`),
  };
}

const bundleDir = path.join(SERVER_ROOT, "active-bundles", "2026-07-08");
const tracked = readJson(path.join(bundleDir, "tracked-props.json"), []);
const snapshot = readJson(path.join(bundleDir, "slate-snapshot.json"), {});
const bundleProps = snapshot.props || tracked;

const tracking = auditTrackingPopulation(bundleProps, tracked);
const slateAudit = auditSlate(bundleProps, "2026-07-08");
const sideRescue = auditSideRescue(bundleProps);

const historyArchive = readJson(path.join(SERVER_ROOT, "history-archive", "2026-06-21.json"), []);
const historyProps = Array.isArray(historyArchive) ? historyArchive : historyArchive?.props || [];
const historyAudit = historyProps.length ? auditSlate(historyProps, "2026-06-21") : null;
const historySideRescue = historyProps.length ? auditSideRescue(historyProps) : null;

const report = {
  auditedAt: new Date().toISOString(),
  phase: "PHASE_1_AUDIT",
  trackingPopulation: tracking,
  slateAudits: [slateAudit, historyAudit].filter(Boolean),
  sideRescueSummary: sideRescue,
  historySideRescue: historySideRescue,
  biasAssessment:
    "Reader Over-heavy bias visible when readerOverCount >> readerUnderCount before flip-first; " +
    "post-flip and Best 6 ratios show whether bias persists through later stages.",
};

console.log(JSON.stringify(report, null, 2));
