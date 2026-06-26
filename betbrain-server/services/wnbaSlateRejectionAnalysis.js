/**
 * WNBA slate rejection chain — explains why candidates fail Best 6 selection.
 */
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { evaluateWnbaTrackingEligibility } from "../engines/wnba/wnbaResultsQualityGate.js";
import {
  applyDecisionIntelligenceToPick,
  evaluatePropDecisionIntelligenceV1,
} from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  applySideRescueToPick,
  evaluateSideRescue,
} from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import { isWnbaQualityGatePick } from "../engines/wnba/wnbaGateInputs.js";
import { isNoBetPick } from "../engines/topProps/topPropSelectionAudit.js";
import {
  selectControlledBestSix,
} from "../engines/topProps/controlledBestSixSelector.js";

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function resolveTrackEligibility(pick = {}) {
  return String(
    pick.decisionIntelligence?.trackEligibility ||
      pick.trackingEligibility ||
      pick.wnbaTrackingDecision ||
      "UNKNOWN"
  ).toUpperCase();
}

export function analyzeCandidateRejectionChain(pick = {}) {
  const chain = {
    player: pick.player || "",
    team: pick.team || "",
    opponent: pick.opponent || "",
    line: pick.line,
    side: normalizeSide(pick.side || pick.pick),
    league: pick.league || "WNBA",
    stages: [],
    finalOutcome: "UNKNOWN",
    blockingStage: null,
  };

  const dataIntegrity = pick.dataIntegrity || pick.wnbaDataCard?.dataIntegrity;
  const dataRecovery = pick.dataRecovery || pick.wnbaDataCard?.dataRecovery;

  if (dataIntegrity) {
    chain.stages.push({
      stage: "dataIntegrity",
      overall: dataIntegrity.overall,
      score: dataIntegrity.score,
      issues: (dataIntegrity.issues || []).map((i) => ({
        key: i.key,
        status: i.status,
        message: i.message,
      })),
      dataRecovery: dataRecovery
        ? {
            attempted: dataRecovery.attempted,
            fixableFailuresFound: dataRecovery.fixableFailuresFound,
            fixableFailuresResolved: dataRecovery.fixableFailuresResolved,
            trueUnavailableFields: dataRecovery.trueUnavailableFields,
            wouldConfirmWeakSlate:
              dataRecovery.fixableFailuresFound === 0 &&
              (dataIntegrity.issues || []).length > 0,
          }
        : null,
    });
    if (dataIntegrity.overall === "BAD") {
      chain.blockingStage = chain.blockingStage || "dataIntegrity";
    }
  }

  const reader = pick.wnbaReader || readWnbaProp(pick.wnbaDataCard || pick);
  chain.stages.push({
    stage: "reader",
    decision: reader.decision,
    finalSide: reader.finalSide || null,
    reasonCodes: reader.reasonCodes || [],
    disagrees: reader.disagrees || [],
  });
  if (reader.decision === "NO_BET" || !reader.finalSide) {
    chain.blockingStage = chain.blockingStage || "reader";
    chain.finalOutcome = "NO_BET";
  }

  const gate = evaluateWnbaTrackingEligibility(pick, pick.wnbaDataCard, reader);
  chain.stages.push({
    stage: "trackingGate",
    trackingEligibility: gate.trackingEligibility,
    blockReasons: gate.trackingBlockReasons || [],
    qualityGateScore: gate.qualityGateScore,
  });
  if (gate.trackingEligibility === "NO_BET") {
    chain.blockingStage = chain.blockingStage || "trackingGate";
    chain.finalOutcome = "NO_BET";
  } else if (gate.trackingEligibility === "BOARD_ONLY") {
    chain.finalOutcome = chain.finalOutcome === "UNKNOWN" ? "BOARD_ONLY" : chain.finalOutcome;
    if (!chain.blockingStage) chain.blockingStage = "trackingGate";
  }

  const di = evaluatePropDecisionIntelligenceV1(pick, { gate, dataCard: pick.wnbaDataCard, reader });
  chain.stages.push({
    stage: "decisionIntelligence",
    trackEligibility: di.trackEligibility,
    bestSixEligibility: di.bestSixEligibility,
    trueRisk: di.trueRisk,
    simpleExplanation: di.simpleExplanation,
    riskDebts: (di.riskDebts || []).map((d) => d.code),
  });
  if (di.trackEligibility !== "TRACK" || di.bestSixEligibility !== true) {
    chain.blockingStage = chain.blockingStage || "decisionIntelligence";
    if (di.trackEligibility === "BOARD_ONLY") chain.finalOutcome = "BOARD_ONLY";
    else if (di.trackEligibility === "NO_BET") chain.finalOutcome = "NO_BET";
  }

  const sideRescue = evaluateSideRescue(pick, {
    decisionIntelligence: di,
    gate,
    dataCard: pick.wnbaDataCard,
    reader,
    originalSide: pick.initialSide || pick.side,
  });
  chain.stages.push({
    stage: "sideRescue",
    action: sideRescue.action,
    finalSide: sideRescue.finalSide,
    explanation: sideRescue.explanation,
  });
  if (sideRescue.action === "BOARD_ONLY" || sideRescue.action === "NO_BET") {
    chain.blockingStage = chain.blockingStage || "sideRescue";
    chain.finalOutcome = sideRescue.action;
  }

  if (pick.noPlay) {
    chain.blockingStage = chain.blockingStage || "noPlay";
    chain.finalOutcome = "NO_PLAY";
  }
  if (isNoBetPick(pick)) {
    chain.blockingStage = chain.blockingStage || "noBet";
    chain.finalOutcome = "NO_BET";
  }
  if (!isWnbaQualityGatePick(pick)) {
    chain.blockingStage = chain.blockingStage || "qualityGateInputs";
    chain.finalOutcome = chain.finalOutcome === "UNKNOWN" ? "MISSING_GATE_INPUTS" : chain.finalOutcome;
  }

  if (!chain.blockingStage && di.bestSixEligibility === true && di.trackEligibility === "TRACK") {
    chain.finalOutcome = "BEST_SIX_ELIGIBLE";
  } else if (chain.finalOutcome === "UNKNOWN") {
    chain.finalOutcome = resolveTrackEligibility({ decisionIntelligence: di });
  }

  return chain;
}

export function summarizeSlateRejectionAnalysis(candidates = [], bestSix = []) {
  const bestSixKeys = new Set(
    bestSix.map((p) =>
      [
        String(p.player || "").toLowerCase(),
        String(p.team || "").toLowerCase(),
        String(p.line ?? ""),
      ].join("|")
    )
  );

  const chains = candidates.map(analyzeCandidateRejectionChain);
  const boardCandidates = chains.filter(
    (c) => c.finalOutcome !== "NO_BET" && c.finalOutcome !== "NO_PLAY"
  );
  const boardOnly = chains.filter((c) => c.finalOutcome === "BOARD_ONLY");
  const noBet = chains.filter((c) => c.finalOutcome === "NO_BET");
  const bestSixEligible = chains.filter((c) => c.finalOutcome === "BEST_SIX_ELIGIBLE");

  const blockingByStage = {};
  for (const chain of chains) {
    if (chain.blockingStage) {
      blockingByStage[chain.blockingStage] =
        Number(blockingByStage[chain.blockingStage] || 0) + 1;
    }
  }

  let fixableFailuresFound = 0;
  let fixableFailuresResolved = 0;
  let trueUnavailableCount = 0;
  for (const pick of candidates) {
    const dr = pick.dataRecovery || pick.wnbaDataCard?.dataRecovery;
    if (dr) {
      fixableFailuresFound += Number(dr.fixableFailuresFound || 0);
      fixableFailuresResolved += Number(dr.fixableFailuresResolved || 0);
      trueUnavailableCount += (dr.trueUnavailableFields || []).length;
    }
  }

  return {
    candidateCount: candidates.length,
    boardCandidates: boardCandidates.length,
    bestSixEligible: bestSixEligible.length,
    bestSixSelected: bestSix.length,
    boardOnly: boardOnly.length,
    noBet: noBet.length,
    blockingByStage,
    fixableFailuresFound,
    fixableFailuresResolved,
    trueUnavailableCount,
    dataBlindVsWeakSlate:
      fixableFailuresFound > fixableFailuresResolved
        ? "DATA_BLIND"
        : fixableFailuresFound === 0 && boardOnly.length >= boardCandidates.length * 0.5
          ? "WEAK_SLATE"
          : "MIXED",
    chains,
    bestSixKeys: [...bestSixKeys],
  };
}

export function buildSlateRejectionAnalysisFromProps(generatedProps = [], options = {}) {
  const league = String(options.league || "WNBA").toUpperCase();
  const slateDate = String(options.slateDate || "").trim();

  let candidates = generatedProps.filter(
    (p) => String(p.league || "").toUpperCase() === league
  );
  if (slateDate) {
    candidates = candidates.filter(
      (p) =>
        String(p.slateDate || p.gameDate || "").startsWith(slateDate) ||
        String(p.dayBucket || "").toUpperCase() === "TODAY"
    );
  }

  const { bestSix = [] } = selectControlledBestSix(candidates, league, options);
  const wnbaBestSix = bestSix;

  return summarizeSlateRejectionAnalysis(candidates, wnbaBestSix);
}
