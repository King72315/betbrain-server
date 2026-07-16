/**
 * Same-snapshot before/after replay for Reader/Gate Over alignment.
 * Uses frozen July 16 picks JSON; re-evaluates gate with current floors.
 *
 * Usage: node scripts/replayReaderGateAlign0716.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  resolveWnbaGapFloors,
  WNBA_FULL_OVER_GAP_FLOOR,
  WNBA_LIMITED_OVER_GAP_FLOOR,
  WNBA_UNDER_GAP_FLOOR,
  WNBA_READER_MEANINGFUL_OVER_GAP,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(__dirname, "..", ".tmp-jul16-picks-live.json");

/** Frozen baseline floors (pre-alignment live behavior). */
const OLD_FULL_OVER_FLOOR = 4.0;

function num(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER")) return "OVER";
  if (raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function projectionGap(pick) {
  const side = normalizeSide(pick.side || pick.pick || pick.currentEngineSide);
  const proj = num(pick.projection ?? pick.wnbaDataCard?.projection?.projection);
  const line = num(pick.line ?? pick.wnbaDataCard?.bookLine);
  if (proj == null || line == null || !side) return null;
  return side === "UNDER" ? line - proj : proj - line;
}

function readerLabelFromGap(side, gap) {
  if (gap == null) return "UNKNOWN";
  if (gap >= 4) return "STRONG_GAP";
  if (side === "OVER" && gap >= WNBA_READER_MEANINGFUL_OVER_GAP) return "MEANINGFUL";
  if (gap >= 2.5) return "MODERATE_LEGACY";
  if (gap <= 1) return "WEAK";
  return "MIXED";
}

function oldReaderLabel(side, gap) {
  if (gap == null) return "UNKNOWN";
  if (gap >= 4) return "STRONG_GAP";
  if (gap >= 2.5) return "MEANINGFUL_LEGACY";
  if (gap <= 1) return "WEAK";
  return "MIXED";
}

function loadBestSix() {
  let raw = fs.readFileSync(SNAPSHOT, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const j = JSON.parse(raw);
  return {
    meta: { serverBuild: j.serverBuild, lastUpdated: j.lastUpdated },
    bestSix: j.bestSixDisplayWNBA || j.bestSixWNBA || [],
    top: j.topPropsWNBA || j.topTwoWNBA || [],
  };
}

function simulateNatural(pick, { useNewFloors }) {
  const side = normalizeSide(pick.side || pick.pick);
  const gap = projectionGap(pick);
  const card = pick.wnbaDataCard || {};
  const dataMode = String(pick.dataMode || card.dataMode || "").toUpperCase();
  const volatility = card.minutesVolatility || pick.minutesVolatility || "stable";

  // Old live path always applied LIMITED Over floor (4.0) even for FULL+stable.
  let floor;
  let reasonCode;
  if (side === "UNDER") {
    floor = WNBA_UNDER_GAP_FLOOR;
    reasonCode = "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR";
  } else if (!useNewFloors) {
    floor = OLD_FULL_OVER_FLOOR;
    reasonCode =
      dataMode.includes("FULL")
        ? "OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR"
        : "OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR";
  } else {
    const resolved = resolveWnbaGapFloors({
      side,
      dataMode,
      volatility,
      projectionGap: gap,
    });
    floor = resolved.gapFloor;
    reasonCode = resolved.reasonCode;
  }

  const storedNatural = String(
    pick.naturalDecision ||
      pick.decisionIntelligence?.naturalDecision ||
      pick.decisionIntelligence?.originalGateEligibility ||
      ""
  ).toUpperCase();
  const storedReason = String(
    pick.wnbaTrackingReason || pick.decisionIntelligence?.gateReason || ""
  );
  const solelyGapReject =
    storedNatural !== "TRACK" && storedReason.includes("GAP_BELOW");

  let naturalDecision;
  let gateReason;
  if (useNewFloors) {
    // Re-run live gate with current code (new floors + thinGap alignment).
    const gate = evaluateWnbaTrackingGateV2(pick);
    naturalDecision = gate.wnbaTrackingDecision;
    gateReason = gate.wnbaTrackingReason || (gate.trackingWarnings || []).join("|");
    floor = gate.keyMetrics?.gapFloorApplied ?? floor;
  } else if (solelyGapReject && gap != null && gap >= floor) {
    // Would have passed gap floor under old constants only if gap >= 4.
    naturalDecision = "TRACK";
    gateReason = "SIMULATED_PASS";
  } else if (solelyGapReject) {
    naturalDecision = storedNatural || "BOARD_ONLY";
    gateReason = storedReason;
  } else {
    // Preserve non-gap rejections (danger stack, etc.) and stored natural.
    naturalDecision = storedNatural || "BOARD_ONLY";
    gateReason = storedReason;
  }

  const promotedNeeded = String(naturalDecision).toUpperCase() !== "TRACK";
  const readerMeaningful =
    side === "OVER" && gap != null && gap >= (useNewFloors ? WNBA_READER_MEANINGFUL_OVER_GAP : 2.5);
  const disagreement =
    readerMeaningful &&
    String(naturalDecision).toUpperCase() !== "TRACK" &&
    String(gateReason).includes("GAP_BELOW");

  return {
    player: pick.player,
    side,
    line: pick.line,
    projection: pick.projection ?? card.projection?.projection,
    gap,
    floor,
    reasonCode,
    readerLabel: useNewFloors
      ? readerLabelFromGap(side, gap)
      : oldReaderLabel(side, gap),
    naturalDecision,
    gateReason,
    promotedNeeded,
    disagreement,
    topStatus: Boolean(pick.isTopPick || pick.topPickRank != null),
    rank: pick.controlledBestSixRank || pick.bestSixRank || null,
  };
}

const { meta, bestSix, top } = loadBestSix();
const before = bestSix.map((p) => simulateNatural(p, { useNewFloors: false }));
const after = bestSix.map((p) => simulateNatural(p, { useNewFloors: true }));

function metrics(rows) {
  const n = rows.length;
  const naturalTrack = rows.filter((r) => r.naturalDecision === "TRACK").length;
  const boardOnly = rows.filter((r) => r.naturalDecision === "BOARD_ONLY").length;
  const promoted = rows.filter((r) => r.promotedNeeded).length;
  const disagree = rows.filter((r) => r.disagreement).length;
  const overs = rows.filter((r) => r.side === "OVER").length;
  const unders = rows.filter((r) => r.side === "UNDER").length;
  return {
    candidateCount: n,
    naturalTrackCount: naturalTrack,
    boardOnlyCount: boardOnly,
    promotedCount: promoted,
    overrideRate: n ? Number((promoted / n).toFixed(3)) : 0,
    readerGateDisagreementCount: disagree,
    overUnder: `${overs}/${unders}`,
  };
}

console.log(
  JSON.stringify(
    {
      snapshot: meta,
      constants: {
        WNBA_FULL_OVER_GAP_FLOOR,
        WNBA_LIMITED_OVER_GAP_FLOOR,
        WNBA_UNDER_GAP_FLOOR,
        WNBA_READER_MEANINGFUL_OVER_GAP,
        OLD_LIVE_FULL_OVER_EFFECTIVE: OLD_FULL_OVER_FLOOR,
      },
      before: metrics(before),
      after: metrics(after),
    },
    null,
    2
  )
);

console.log("\n=== BEFORE / AFTER CANDIDATE TABLE ===");
for (let i = 0; i < bestSix.length; i++) {
  const b = before[i];
  const a = after[i];
  const changeReasons = [];
  if (b.naturalDecision !== a.naturalDecision) {
    changeReasons.push(`natural ${b.naturalDecision}→${a.naturalDecision}`);
  }
  if (b.floor !== a.floor) changeReasons.push(`floor ${b.floor}→${a.floor}`);
  if (b.readerLabel !== a.readerLabel) {
    changeReasons.push(`reader ${b.readerLabel}→${a.readerLabel}`);
  }
  if (b.promotedNeeded !== a.promotedNeeded) {
    changeReasons.push(
      `promo ${b.promotedNeeded ? "yes" : "no"}→${a.promotedNeeded ? "yes" : "no"}`
    );
  }
  console.log(
    [
      a.player,
      `proj=${a.projection}`,
      `gap=${a.gap}`,
      `oldNat=${b.naturalDecision}`,
      `newNat=${a.naturalDecision}`,
      `oldFloor=${b.floor}`,
      `newFloor=${a.floor}`,
      `oldReader=${b.readerLabel}`,
      `newReader=${a.readerLabel}`,
      `oldPromo=${b.promotedNeeded}`,
      `newPromo=${a.promotedNeeded}`,
      `reason=${changeReasons.join("; ") || "unchanged"}`,
    ].join(" | ")
  );
}

console.log("\n=== TOP SNAPSHOT (unchanged membership expected) ===");
console.log(
  (top || []).slice(0, 2).map((p) => ({
    player: p.player,
    side: normalizeSide(p.side || p.pick),
    gap: projectionGap(p),
  }))
);
