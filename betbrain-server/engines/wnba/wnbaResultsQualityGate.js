/**
 * WNBA Results Quality Gate — delegates to Tracking Gate v2 for WNBA candidates.
 * NBA path must not use this module (returns TRACK passthrough).
 */
import {
  WNBA_TRACKING_GATE_VERSION,
  WNBA_LIMITED_UNDER_GAP_FLOOR,
  evaluateWnbaTrackingGateV2,
  applyWnbaTrackingGateV2ToPick,
  buildRetroactiveGateSimulation,
  buildWnbaV2GateReview,
} from "./wnbaTrackingGateV2.js";

export const QUALITY_GATE_VERSION = WNBA_TRACKING_GATE_VERSION;
export { WNBA_LIMITED_UNDER_GAP_FLOOR };

import {
  isWnbaQualityGatePick,
  resolveQualityGateInputs,
} from "./wnbaGateInputs.js";

export { isWnbaQualityGatePick, resolveQualityGateInputs };

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function evaluateWnbaTrackingEligibility(
  pick = {},
  dataCard = null,
  reader = null
) {
  return evaluateWnbaTrackingGateV2(pick, dataCard, reader);
}

export function applyQualityGateToPick(pick = {}, gate = {}) {
  return applyWnbaTrackingGateV2ToPick(pick, gate);
}

export { buildRetroactiveGateSimulation, buildWnbaV2GateReview };

export function buildCandidateQualityAuditEntry(pick = {}, gate = {}, extra = {}) {
  const metrics = gate.keyMetrics || resolveQualityGateInputs(pick).keyMetrics;
  return {
    player: pick.player || "",
    league: pick.league || "WNBA",
    team: pick.team || "",
    opponent: pick.opponent || "",
    side: normalizeSide(pick.side || pick.pick),
    line: pick.line,
    readerDecision:
      pick.readerDecision || pick.wnbaReader?.decision || pick.trackingType || "",
    trackingEligibility: gate.trackingEligibility,
    tracked: extra.tracked === true,
    qualityGateScore: gate.qualityGateScore,
    blockReasons: gate.trackingBlockReasons || [],
    warnings: gate.trackingWarnings || [],
    keyMetrics: gate.keyMetrics || metrics,
    ...extra,
  };
}

export function buildTrackingQualityAudit(candidates = [], cohort = [], options = {}) {
  const bySlate = {};
  const bump = (map, key, field, amount = 1) => {
    if (!map[key]) {
      map[key] = {
        slateDate: key,
        generatedCandidates: 0,
        passedQualityGate: 0,
        trackedProps: 0,
        boardOnlyProps: 0,
        shadowOnlyProps: 0,
        noBetProps: 0,
        blockedProps: 0,
        blockReasons: {},
        warningReasons: {},
        officialCount: 0,
        readerOfficialDemotedCount: 0,
        readerUncertainTestCount: 0,
        candidates: [],
      };
    }
    map[key][field] = Number(map[key][field] || 0) + amount;
  };

  const trackedKeys = new Set(
    (options.tracked || cohort).map(
      (p) => p.trackedKey || `${p.player}|${p.line}|${p.side}`
    )
  );

  for (const rawPick of candidates) {
    const pick = rawPick;
    const slateDate =
      pick.slateDate ||
      options.getSlateDate?.(pick) ||
      String(pick.gameDate || "unknown");
    bump(bySlate, slateDate, "generatedCandidates");

    const gate = evaluateWnbaTrackingEligibility(pick);
    const entry = buildCandidateQualityAuditEntry(pick, gate, {
      slateDate,
      tracked: gate.trackingEligibility === "TRACK",
    });

  if (gate.trackingEligibility === "TRACK") {
      bump(bySlate, slateDate, "passedQualityGate");
      const decision = String(pick.trackingType || pick.recordType || "").toUpperCase();
      if (decision === "OFFICIAL") bump(bySlate, slateDate, "officialCount");
      if (decision === "TEST" && pick.readerOfficialDemoted) {
        bump(bySlate, slateDate, "readerOfficialDemotedCount");
      }
      if (decision === "TEST" && !pick.readerOfficialDemoted) {
        bump(bySlate, slateDate, "readerUncertainTestCount");
      }
    } else if (gate.trackingEligibility === "BOARD_ONLY") {
      bump(bySlate, slateDate, "boardOnlyProps");
    } else if (gate.trackingEligibility === "SHADOW_ONLY") {
      bump(bySlate, slateDate, "shadowOnlyProps");
    } else {
      bump(bySlate, slateDate, "noBetProps");
      bump(bySlate, slateDate, "blockedProps");
    }

    for (const reason of gate.trackingBlockReasons || []) {
      const slate = bySlate[slateDate];
      slate.blockReasons[reason] = Number(slate.blockReasons[reason] || 0) + 1;
    }
    for (const warning of gate.trackingWarnings || []) {
      const slate = bySlate[slateDate];
      slate.warningReasons[warning] = Number(slate.warningReasons[warning] || 0) + 1;
    }

    bySlate[slateDate].candidates.push(entry);
  }

  for (const prop of cohort) {
    const slateDate = prop.slateDate || "unknown";
    bump(bySlate, slateDate, "trackedProps");
    const key = prop.trackedKey || `${prop.player}|${prop.line}|${prop.side}`;
    if (trackedKeys.has(key)) {
      const slate = bySlate[slateDate];
      const match = slate?.candidates?.find(
        (c) => c.player === prop.player && String(c.line) === String(prop.line)
      );
      if (match) match.tracked = true;
    }
  }

  return {
    qualityGateVersion: QUALITY_GATE_VERSION,
    topPropsReferenceOnly: true,
    topPropsDidNotControlTracking: true,
    bySlate: Object.values(bySlate).sort((a, b) =>
      String(a.slateDate).localeCompare(String(b.slateDate))
    ),
  };
}

export function buildQualityGatePerformanceFromProps(slateProps = []) {
  const wnba = slateProps.filter((p) => String(p.league).toUpperCase() === "WNBA");
  const tracked = wnba.filter((p) => p.trackingEligibility === "TRACK" || !p.trackingEligibility);
  const boardOnly = wnba.filter((p) => p.trackingEligibility === "BOARD_ONLY");
  const shadowOnly = wnba.filter((p) => p.trackingEligibility === "SHADOW_ONLY");
  const blocked = wnba.filter((p) => p.trackingEligibility === "NO_BET");

  const blockReasons = {};
  const warningReasons = {};
  for (const prop of wnba) {
    for (const reason of prop.trackingBlockReasons || []) {
      blockReasons[reason] = Number(blockReasons[reason] || 0) + 1;
    }
    for (const warning of prop.trackingWarnings || []) {
      warningReasons[warning] = Number(warningReasons[warning] || 0) + 1;
    }
  }

  const avgScore =
    tracked.length > 0
      ? Math.round(
          tracked.reduce((sum, p) => sum + num(p.qualityGateScore, 0), 0) /
            tracked.length
        )
      : null;

  return {
    title: "WNBA Results Quality Gate Performance",
    qualityGateVersion: QUALITY_GATE_VERSION,
    wnbaTrackedCount: tracked.length,
    boardOnlyCount: boardOnly.length,
    shadowOnlyCount: shadowOnly.length,
    blockedCount: blocked.length,
    avgQualityGateScore: avgScore,
    blockReasons,
    warningReasons,
    trackedRecord: null,
  };
}
