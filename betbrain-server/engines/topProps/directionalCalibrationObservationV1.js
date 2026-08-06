/**
 * Observation-window tracking for Small-Sample Directional Calibration V1.
 * Analysis-only baseline vs calibrated live records. No second Official board.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DIRECTIONAL_CALIBRATION_BUILD,
  gradePropCorrect,
} from "./directionalCalibrationV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const TRACK_PATH = path.join(
  ROOT,
  "data",
  "directional-calibration-v1-observation.json"
);

export const OBSERVATION_MIN_SLATES = 3;
export const OBSERVATION_MIN_PROPS = 30;

function num(v, f = null) {
  if (v == null || v === "") return f;
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}

function loadTrack() {
  try {
    if (fs.existsSync(TRACK_PATH)) {
      return JSON.parse(fs.readFileSync(TRACK_PATH, "utf8"));
    }
  } catch {
    /* ignore */
  }
  return {
    calibrationVersion: DIRECTIONAL_CALIBRATION_BUILD,
    startedAt: new Date().toISOString(),
    slates: [],
    totals: {
      props: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
    },
  };
}

function saveTrack(track) {
  const dir = path.dirname(TRACK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TRACK_PATH, JSON.stringify(track, null, 2));
}

function wlp(props) {
  let w = 0;
  let l = 0;
  let p = 0;
  for (const x of props) {
    if (x.grade === "W") w += 1;
    else if (x.grade === "L") l += 1;
    else if (x.grade === "P") p += 1;
  }
  const decided = w + l;
  return {
    w,
    l,
    p,
    record: `${w}-${l}-${p}`,
    winRate: decided > 0 ? Number(((w / decided) * 100).toFixed(1)) : null,
  };
}

/**
 * Build History slate summary comparing baseline analysis vs calibrated live.
 */
export function buildCalibrationSlateSummary(props = [], slateDate = "") {
  const list = Array.isArray(props) ? props : [];
  const graded = list.map((p) => {
    const side = String(p.side || p.pick || "").toUpperCase().startsWith("UNDER")
      ? "UNDER"
      : "OVER";
    const line = num(p.officialLine ?? p.line);
    const actual = num(p.result ?? p.actualPoints);
    const grade = gradePropCorrect(side, line, actual);
    const changed =
      p.calibrationChangedSelectedPlayer === true ||
      p.calibrationChangedTeamPairing === true;
    const multiOver =
      side === "OVER" &&
      Array.isArray(p.calibrationDifferences) &&
      p.calibrationDifferences.some((d) => d.feature === "over_multi_signal_agreement");
    const thinUnder =
      side === "UNDER" &&
      Array.isArray(p.calibrationDifferences) &&
      p.calibrationDifferences.some((d) => d.feature === "thin_under_danger");
    const starUnder =
      side === "UNDER" &&
      Array.isArray(p.calibrationDifferences) &&
      p.calibrationDifferences.some((d) => d.feature === "star_usage_under_caution");
    const fallback =
      Array.isArray(p.highRiskReasons) &&
      p.highRiskReasons.includes("thin_under_danger");
    const risk = String(p.trueRisk || p.riskLabel || "MEDIUM").toUpperCase();
    const proj = num(p.projection ?? p.finalProjection);
    const margin =
      actual != null && line != null
        ? side === "OVER"
          ? actual - line
          : line - actual
        : null;
    const projErr =
      actual != null && proj != null ? Number((actual - proj).toFixed(2)) : null;
    return {
      player: p.player,
      side,
      line,
      actual,
      grade,
      changed,
      multiOver,
      thinUnder,
      starUnder,
      fallback,
      risk,
      margin,
      projErr,
      baselineScore: num(p.baselineTeamSideScore),
      calibratedScore: num(p.calibratedTeamSideScore ?? p.teamSideScore),
    };
  });

  const overs = graded.filter((g) => g.side === "OVER");
  const unders = graded.filter((g) => g.side === "UNDER");
  const byRisk = (r) => graded.filter((g) => g.risk.includes(r));
  const changed = graded.filter((g) => g.changed);
  const bothSystems = graded.filter((g) => !g.changed);

  const live = wlp(graded);
  // Baseline hypothetical uses same membership (analysis-only) — same grades
  // when selection unchanged; changed props counted separately.
  const baselineHypo = wlp(bothSystems);

  const avg = (arr, key) => {
    const vals = arr.map((x) => x[key]).filter((v) => v != null);
    if (!vals.length) return null;
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  };

  return {
    slateDate,
    calibrationVersion: DIRECTIONAL_CALIBRATION_BUILD,
    totalProps: graded.length,
    wlp: live.record,
    overallWinRate: live.winRate,
    overWlp: wlp(overs).record,
    underWlp: wlp(unders).record,
    lowRisk: wlp(byRisk("LOW")).record,
    mediumRisk: wlp(byRisk("MEDIUM")).record,
    highRisk: wlp(byRisk("HIGH")).record,
    baselineHypotheticalRecord: baselineHypo.record,
    calibratedLiveRecord: live.record,
    propsSelectedByBothSystems: bothSystems.length,
    propsChangedByCalibration: changed.length,
    recordOnChangedSelections: wlp(changed).record,
    averageProjectionError: avg(graded, "projErr"),
    averageResultMargin: avg(graded, "margin"),
    multiSignalOverRecord: wlp(graded.filter((g) => g.multiOver)).record,
    thinUnderDangerRecord: wlp(graded.filter((g) => g.thinUnder)).record,
    starUsageUnderRecord: wlp(graded.filter((g) => g.starUnder)).record,
    mandatoryFallbackRecord: wlp(graded.filter((g) => g.fallback)).record,
  };
}

/**
 * Record a completed future slate into the observation window.
 * Does not rewrite historical pre-calibration slates unless explicitly passed.
 */
export function recordCalibrationObservationSlate(slateDate, props = []) {
  const summary = buildCalibrationSlateSummary(props, slateDate);
  const track = loadTrack();
  const idx = track.slates.findIndex((s) => s.slateDate === slateDate);
  if (idx >= 0) track.slates[idx] = summary;
  else track.slates.push(summary);

  track.totals = {
    props: track.slates.reduce((n, s) => n + (s.totalProps || 0), 0),
    wins: 0,
    losses: 0,
    pushes: 0,
  };
  for (const s of track.slates) {
    const [w, l, p] = String(s.wlp || "0-0-0").split("-").map(Number);
    track.totals.wins += w || 0;
    track.totals.losses += l || 0;
    track.totals.pushes += p || 0;
  }
  track.observationWindowComplete =
    track.slates.length >= OBSERVATION_MIN_SLATES &&
    track.totals.props >= OBSERVATION_MIN_PROPS;
  track.updatedAt = new Date().toISOString();
  saveTrack(track);
  return { track, summary };
}

export function getCalibrationObservationStatus() {
  const track = loadTrack();
  return {
    ...track,
    minSlates: OBSERVATION_MIN_SLATES,
    minProps: OBSERVATION_MIN_PROPS,
    performanceReportPath:
      "COURTEDGE_SMALL_SAMPLE_DIRECTIONAL_CALIBRATION_V1_PERFORMANCE_REPORT.md",
  };
}
