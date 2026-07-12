/**
 * Generate before/after side-selection traces for report deliverables.
 */
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import {
  buildCanonicalDecisionBundle,
  finalizeCanonicalDecision,
} from "../engines/decisionIntelligence/sideSelectionTrustV1.js";

function card(overrides = {}) {
  return {
    playerId: "1",
    bookLine: 16.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL_DATA",
    minutesVolatility: "stable",
    season: { points: 18, minutes: 30, fga: 11, ptsPerFGA: 1.05, fta: 4 },
    last5: { points: 21, minutes: 32, fga: 12, ptsPerFGA: 1.1, fta: 5, games: 5 },
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 21.4, expectedMinutes: 32, expectedFGA: 12 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 65 },
    dataMissingFlags: [],
    opponentDefense: { score: 62, proxyUsed: false },
    gameEnvironment: { impliedTeamTotal: 82, total: 164 },
    ...overrides,
  };
}

function trace(name, pickInput) {
  const c = card(pickInput.card || {});
  const reader = readWnbaProp(c);
  let pick = finalizeCanonicalDecision({
    player: name,
    line: c.bookLine,
    side: pickInput.side || "Over",
    pick: pickInput.side || "Over",
    league: "WNBA",
    projection: c.projection.projection,
    wnbaDataCard: c,
    wnbaReader: reader,
    initialSide: reader.finalSide,
    readerSide: reader.finalSide,
    ...pickInput.pickOverrides,
  });
  const ff = evaluateFlipFirstSideSelection(pick, {
    reader,
    dataCard: c,
    originalSide: reader.finalSide,
    decisionDataIntelligence: pick.decisionDataIntelligence,
  });
  pick = finalizeCanonicalDecision({
    ...pick,
    flipFirstDecision: ff,
    flipFirstAction: ff.action,
    side: ff.finalSide === "UNDER" ? "Under" : "Over",
  });
  const bundle = buildCanonicalDecisionBundle(pick);
  return {
    player: name,
    line: c.bookLine,
    readerSide: bundle.readerSide,
    flipFirstAction: bundle.flipFirstAction,
    finalSide: bundle.finalSide,
    naturalDecision: bundle.naturalDecision,
    stageDecisionTrace: bundle.stageDecisionTrace,
    sideEvidence: bundle.sideEvidence,
    thinGapReview: ff.thinGapTriggeredReview,
    flipMarginUsed: ff.flipMarginUsed,
  };
}

const traces = {
  jackieYoungOver165: trace("Jackie Young", {
    card: { bookLine: 16.5, projection: { projection: 21.4, expectedMinutes: 32, expectedFGA: 12 } },
    side: "Over",
  }),
  malongaUnder165: trace("Dominique Malonga", {
    card: {
      bookLine: 16.5,
      projection: { projection: 12.4, expectedMinutes: 22, expectedFGA: 7 },
      last5: { points: 11, minutes: 22, fga: 7, games: 5 },
    },
    side: "Under",
  }),
  thinGapBothSidesWeak: trace("Thin Gap Case", {
    card: {
      bookLine: 18.5,
      projection: { projection: 16.8, expectedMinutes: 33, expectedFGA: 14 },
      last5: { points: 15.2, minutes: 33, fga: 14.2, games: 5 },
      minutesVolatility: "volatile",
      fairLine: { fairLineSide: "UNDER", fairLineEdge: 1.6, fairLineQuality: 90 },
    },
    side: "Under",
    pickOverrides: {
      volumeDangerGates: { gates: ["volatile_minutes"] },
      dangerGateStack: ["volatileMinutes", "thinGap"],
    },
  }),
  successfulFlip: (() => {
    const c = card({
      bookLine: 19.5,
      projection: { projection: 17.2, expectedMinutes: 29, expectedFGA: 7 },
      last5: { points: 15, minutes: 29, fga: 7, games: 5 },
      season: { points: 16, minutes: 30, fga: 8 },
      fairLine: { fairLineSide: "UNDER", fairLineEdge: 3.8, fairLineQuality: 75 },
      roleTrend: "down",
    });
    const reader = readWnbaProp(c);
    const ddi = {
      roleStability: { status: "BAD", sideImpact: "OVER", reasons: ["Efficiency-only scoring"] },
      usageShare: { sideImpact: "UNDER", score: 80, reasons: ["FGA share down"] },
      marketIntelligence: { marketWarning: true, sideImpact: "UNDER", reasons: ["Line moved up"] },
      projectionQuality: { status: "WEAK", sideImpact: "UNDER", score: 40 },
    };
    const ff = evaluateFlipFirstSideSelection(
      {
        side: "Over",
        line: 19.5,
        projection: 17.2,
        wnbaDataCard: c,
        wnbaReader: reader,
        volumeDangerGates: { gates: ["efficiency_only_scoring"] },
      },
      { reader, dataCard: c, originalSide: "OVER", decisionDataIntelligence: ddi }
    );
    const pick = finalizeCanonicalDecision({
      player: "Efficiency Flip Case",
      line: 19.5,
      side: "Under",
      pick: "Under",
      league: "WNBA",
      readerSide: "OVER",
      flipFirstDecision: ff,
      flipFirstAction: ff.action,
      wnbaDataCard: c,
      wnbaReader: reader,
    });
    const bundle = buildCanonicalDecisionBundle(pick);
    return {
      player: "Efficiency Flip Case",
      line: 19.5,
      readerSide: "OVER",
      flipFirstAction: ff.action,
      finalSide: bundle.finalSide,
      stageDecisionTrace: bundle.stageDecisionTrace,
      before: { side: "OVER", readerScore: reader.overCase?.rawScore },
      after: { side: ff.finalSide, oppositeScore: ff.oppositeSideScore, flipMarginUsed: ff.flipMarginUsed },
    };
  })(),
};

console.log(JSON.stringify(traces, null, 2));
