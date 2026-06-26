/**
 * Analyze WNBA slate rejection chain — explains 0/6 Best 6 snapshots.
 * Usage: node betbrain-server/scripts/analyzeWnbaSlate0626.js [slateDate]
 */
import {
  analyzeCandidateRejectionChain,
  buildSlateRejectionAnalysisFromProps,
  summarizeSlateRejectionAnalysis,
} from "../services/wnbaSlateRejectionAnalysis.js";

const slateDate = process.argv[2] || "2026-06-26";

function makeFixtureCandidates() {
  return [
    {
      player: "Dearica Hamby",
      team: "lasvegasaces",
      opponent: "seattlestorm",
      line: 18.5,
      side: "Over",
      pick: "Over",
      league: "WNBA",
      slateDate,
      bookCount: 4,
      wnbaReader: { decision: "OFFICIAL", finalSide: "OVER", reasonCodes: [] },
      wnbaDataCard: {
        dataIntegrity: { overall: "PARTIAL", score: 72, issues: [{ key: "matchup", status: "MISSING" }] },
        dataRecovery: { fixableFailuresFound: 1, fixableFailuresResolved: 0, attempted: true },
      },
      decisionIntelligence: {
        trackEligibility: "BOARD_ONLY",
        bestSixEligibility: false,
        trueRisk: "ELEVATED",
        simpleExplanation: "Thin edge with elevated risk debt",
      },
    },
    {
      player: "A'ja Wilson",
      team: "lasvegasaces",
      opponent: "seattlestorm",
      line: 26.5,
      side: "Under",
      pick: "Under",
      league: "WNBA",
      slateDate,
      bookCount: 5,
      wnbaReader: { decision: "OFFICIAL", finalSide: "UNDER" },
      wnbaDataCard: {
        dataIntegrity: { overall: "GOOD", score: 88, issues: [] },
        dataRecovery: { fixableFailuresFound: 0, fixableFailuresResolved: 0, attempted: false },
      },
      sideRescue: { action: "BOARD_ONLY", explanation: "Side rescue blocked flip" },
    },
    {
      player: "Natasha Mack",
      team: "phoenixmercury",
      opponent: "indianafever",
      line: 8.5,
      side: "Under",
      pick: "Under",
      league: "WNBA",
      slateDate,
      bookCount: 4,
      wnbaReader: { decision: "NO_BET", reasonCodes: ["low_volume_over_trap"] },
      wnbaDataCard: {
        dataIntegrity: { overall: "PARTIAL", score: 68, issues: [] },
      },
    },
  ];
}

function printChain(chain) {
  console.log(`\n--- ${chain.player} (${chain.side} ${chain.line}) ---`);
  console.log(`  Final: ${chain.finalOutcome} | Blocking: ${chain.blockingStage || "none"}`);
  for (const stage of chain.stages) {
    const detail =
      stage.stage === "dataIntegrity"
        ? `overall=${stage.overall} score=${stage.score} issues=${stage.issues.length}`
        : stage.stage === "reader"
          ? `decision=${stage.decision} side=${stage.finalSide}`
          : stage.stage === "trackingGate"
            ? `eligibility=${stage.trackingEligibility}`
            : stage.stage === "decisionIntelligence"
              ? `track=${stage.trackEligibility} best6=${stage.bestSixEligibility} risk=${stage.trueRisk}`
              : stage.stage === "sideRescue"
                ? `action=${stage.action}`
                : JSON.stringify(stage);
    console.log(`  ${stage.stage}: ${detail}`);
  }
}

function main() {
  console.log(`WNBA Slate Rejection Analysis — ${slateDate}`);
  console.log("=".repeat(60));

  const fixtures = makeFixtureCandidates();
  const summary = summarizeSlateRejectionAnalysis(fixtures, []);
  const fixtureAnalysis = buildSlateRejectionAnalysisFromProps(fixtures, {
    slateDate,
    league: "WNBA",
  });

  console.log("\nFixture snapshot (simulated 6/26 pattern):");
  console.log(`  Board Candidates: ${summary.boardCandidates}`);
  console.log(`  Best 6 Eligible:  ${summary.bestSixEligible}`);
  console.log(`  Best 6 Selected:  ${summary.bestSixSelected}`);
  console.log(`  Board Only:       ${summary.boardOnly}`);
  console.log(`  No Bet:           ${summary.noBet}`);
  console.log(`  Fixable found:    ${summary.fixableFailuresFound}`);
  console.log(`  Fixable resolved: ${summary.fixableFailuresResolved}`);
  console.log(`  True unavailable: ${summary.trueUnavailableCount}`);
  console.log(`  Verdict:          ${summary.dataBlindVsWeakSlate}`);
  console.log(`  Blocking stages:  ${JSON.stringify(summary.blockingByStage)}`);

  console.log("\nControlled Best 6 re-run on fixtures:");
  console.log(`  Best 6 selected: ${fixtureAnalysis.bestSixSelected}`);

  for (const chain of summary.chains) {
    printChain(chain);
  }

  console.log("\nInterpretation:");
  if (summary.bestSixSelected === 0 && summary.fixableFailuresFound > summary.fixableFailuresResolved) {
    console.log("  0/6 is partially DATA-BLIND — fixable lookup/cache failures remain.");
  } else if (summary.bestSixSelected === 0 && summary.boardOnly >= summary.boardCandidates * 0.5) {
    console.log("  0/6 is primarily WEAK SLATE — candidates exist but DI/Side Rescue block Best 6.");
  } else {
    console.log("  0/6 is MIXED — review per-candidate chains above.");
  }
}

main();
