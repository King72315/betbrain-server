/**
 * courteedge-clear-side-strong-edge-membership-path-v1
 *
 * Acceptance tests 1–15 + Aug 5 raw-market dry run helpers.
 * Usage: node scripts/testClearSideStrongEdgeMembershipPathV1.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectTeamSidePair,
  selectControlledBestBoard,
  CONTROLLED_BEST_BOARD_BUILD,
  MEMBERSHIP_EDGE_FLOOR,
  MEMBERSHIP_REJECT,
  evaluateOfficialMembershipQuality,
  collectSoftPenalties,
  buildDualSideCandidates,
  scoreSideCandidate,
} from "../engines/topProps/controlledBestBoardV2.js";
import {
  MEMBERSHIP_QUALITY_BUILD,
  PREFERRED_GAP_FLOOR,
  MINIMUM_MEMBERSHIP_EDGE,
  PREFERRED_EDGE,
} from "../engines/topProps/controlledBoardMembershipQualityV1.js";
import {
  auditBestPropScore,
  resolveProjectionSanity,
  resolveProjectionSanityLevel,
} from "../engines/topProps/bestSixSelectionIntegrityV1.js";
import { CALIBRATION_WEIGHTS } from "../engines/topProps/directionalCalibrationV1.js";
import { CANONICAL_BOARD_BUILD } from "../engines/topProps/controlledBestBoardCanonicalV3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];
const results = {};

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results[name] = "PASS";
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    results[name] = `FAIL: ${err.message}`;
    failures.push({ name, err });
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

function strongOver(extra = {}) {
  return {
    player: "PlumLike",
    team: "LasVegasAces",
    opponent: "ConnecticutSun",
    league: "WNBA",
    side: "OVER",
    pick: "Over",
    line: 16.5,
    projection: 21.6,
    fairLine: 21.7,
    bestPropScore: 72,
    confidence: 62,
    naturalDecision: "BOARD_ONLY",
    commenceTime: "2026-08-05T23:00:00Z",
    gameId: "g-strong",
    providerEventId: "g-strong",
    slateDate: "2026-08-05",
    canonicalSlateDate: "2026-08-05",
    bookCount: 4,
    roleStability: "STABLE",
    blowoutRisk: 20,
    confirmedActive: true,
    originalModelSide: "OVER",
    ...extra,
  };
}

function strongUnder(extra = {}) {
  return {
    player: "HowardLike",
    team: "AtlantaDream",
    opponent: "IndianaFever",
    league: "WNBA",
    side: "UNDER",
    pick: "Under",
    line: 17.5,
    projection: 12.9,
    fairLine: 12.3,
    bestPropScore: 70,
    confidence: 60,
    naturalDecision: "TRACK",
    commenceTime: "2026-08-05T23:00:00Z",
    gameId: "g-strong",
    providerEventId: "g-strong",
    slateDate: "2026-08-05",
    canonicalSlateDate: "2026-08-05",
    bookCount: 4,
    roleStability: "STABLE",
    blowoutRisk: 25,
    confirmedActive: true,
    expectedFGA: 12,
    originalModelSide: "UNDER",
    last5Average: 12.5,
    seasonAverage: 13.0,
    last5HitRate: 70,
    ...extra,
  };
}

test("Build tags", () => {
  assert.equal(
    MEMBERSHIP_QUALITY_BUILD,
    "courteedge-clear-side-strong-edge-membership-path-v1"
  );
  assert.equal(CONTROLLED_BEST_BOARD_BUILD, MEMBERSHIP_QUALITY_BUILD);
  assert.equal(CANONICAL_BOARD_BUILD, MEMBERSHIP_QUALITY_BUILD);
  assert.equal(MINIMUM_MEMBERSHIP_EDGE, 1.5);
  assert.equal(PREFERRED_EDGE, 3.0);
  assert.equal(MEMBERSHIP_EDGE_FLOOR, 1.5);
  assert.equal(PREFERRED_GAP_FLOOR, 3.0);
});

test("Test 1 — Strong edge with soft legacy LAST_VALID remains eligible", () => {
  const q = evaluateOfficialMembershipQuality(
    strongOver({ teamSideTier: "TEAM_SIDE_LAST_VALID" }),
    "OVER"
  );
  assert.equal(q.ok, true);
  assert.ok(!q.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));
});

test("Test 2 — Weak last-valid filler rejected by evidence", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      ...strongOver({
        projection: 17.1,
        fairLine: 17.0,
        teamSideTier: "TEAM_SIDE_LAST_VALID",
        flipFirstAction: "BOTH_SIDES_WEAK",
      }),
    },
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR) ||
      q.reasons.includes(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK)
  );
});

test("Test 3 — NO_BET rejected regardless of edge/tier", () => {
  const q = evaluateOfficialMembershipQuality(
    strongOver({ naturalDecision: "NO_BET", teamSideTier: "TEAM_SIDE_PRIMARY" }),
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes(MEMBERSHIP_REJECT.NATURAL_NO_BET));
});

test("Test 4 — Universal score compression repaired (missing ≠ low; strong can exceed 50)", () => {
  const missing = auditBestPropScore({ player: "X" });
  assert.equal(missing.present, false);
  assert.equal(missing.belowFiftyFloor, false);

  const softMissing = collectSoftPenalties({ line: 16.5, projection: 21 }, "OVER");
  assert.ok(!softMissing.penalties.includes("LOW_BEST_PROP_SCORE"));

  const strong = auditBestPropScore({ bestPropScore: 72 });
  assert.equal(strong.belowFiftyFloor, false);
  assert.ok(strong.raw > 50);

  const inflated = auditBestPropScore({ pickScore: 497 });
  assert.equal(inflated.scale, "INFLATED_BOARD_SCALE");
  assert.equal(inflated.belowFiftyFloor, false);

  const genuinelyLow = auditBestPropScore({ bestPropScore: 40 });
  assert.equal(genuinelyLow.belowFiftyFloor, true);
});

test("Test 5 — Projection sanity not WEAK when packet aligns", () => {
  const pick = {
    ...strongOver(),
    courtEdgeEngineSignalsV1: {
      engines: {
        projectionSanity: {
          reason: "Projection not supported by usage share. Gap vs last-10: 2.1.",
          confidenceAdjustment: -3,
          rawValues: {
            projectionQualityStatus: "MIXED",
            projectionQualityScore: 67,
            supportedByUsage: false,
          },
        },
      },
    },
  };
  const level = resolveProjectionSanityLevel(pick, "OVER");
  assert.notEqual(level.level, "WEAK");
  const soft = collectSoftPenalties(pick, "OVER");
  assert.ok(!soft.penalties.includes("PROJECTION_SANITY_WEAK"));
  const legacy = resolveProjectionSanity(pick);
  assert.equal(legacy.questionsUsage, true); // advisory may still be true
  assert.equal(legacy.isWeak, false);
});

test("Test 6 — Under sign handling", () => {
  const pick = strongUnder({ projection: 14.5, line: 17.5, fairLine: 14.0 });
  const scored = scoreSideCandidate(pick, "UNDER");
  assert.ok(scored.edge >= 3);
  const level = resolveProjectionSanityLevel(pick, "UNDER");
  assert.equal(level.directionalAligned, true);
  assert.notEqual(level.level, "WEAK");
});

test("Test 7 — Dual-side isolation", () => {
  const dual = buildDualSideCandidates(
    {
      ...strongOver({
        projection: 21.6,
        line: 16.5,
        fairLine: 21.7,
        courtEdgeEngineSignalsV1: {
          engines: {
            projectionSanity: {
              reason: "Projection not supported by usage share.",
              confidenceAdjustment: -3,
              rawValues: {
                projectionQualityStatus: "MIXED",
                projectionQualityScore: 55,
                supportedByUsage: false,
              },
            },
          },
        },
      }),
    },
    { requestedSlateDate: "2026-08-05" }
  );
  assert.ok(dual.valid);
  assert.ok(dual.over);
  assert.ok(dual.under);
  // Over packet aligned → not WEAK; Under conflicts with high projection → WEAK
  assert.notEqual(dual.over.projectionSanityLevel, "WEAK");
  assert.equal(dual.under.projectionSanityLevel, "WEAK");
  assert.ok(dual.over.officialMembershipEligible === true);
  assert.ok(dual.under.officialMembershipEligible === false);
});

test("Test 8 — Valid flip required for opposite side", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      ...strongOver({
        projection: 15.3,
        line: 14.5,
        fairLine: 14.2,
        originalModelSide: "UNDER",
        flipFirstAction: "BOTH_SIDES_WEAK",
        sideEvidenceClass: "UNCERTAINTY",
      }),
    },
    "OVER",
    { underEdge: 0.8 }
  );
  assert.equal(q.ok, false);
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP) ||
      q.reasons.includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR) ||
      q.reasons.includes(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK)
  );
});

test("Test 9 — August 4 regression (four fillers stay rejected)", () => {
  const snap = JSON.parse(
    fs.readFileSync(path.join(ROOT, "slate-snapshots", "2026-08-04.json"), "utf8")
  );
  const byPlayer = Object.fromEntries((snap.props || []).map((p) => [p.player, p]));
  const mabreyQ = evaluateOfficialMembershipQuality(
    {
      ...byPlayer["Marina Mabrey"],
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      confirmedActive: false,
      availability: "Day-To-Day",
    },
    "OVER"
  );
  const gabbyQ = evaluateOfficialMembershipQuality(
    {
      ...byPlayer["Gabby Williams"],
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      originalModelSide: "UNDER",
      flipFirstAction: "BOTH_SIDES_WEAK",
      sideEvidenceClass: "UNCERTAINTY",
    },
    "OVER",
    { underEdge: -0.8 }
  );
  const allemandQ = evaluateOfficialMembershipQuality(
    {
      ...byPlayer["Julie Allemand"],
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision: "NO_BET",
      expectedFGA: 4,
      killReasons: ["LOW_VOLUME_OVER_TRAP"],
    },
    "UNDER"
  );
  const burtonQ = evaluateOfficialMembershipQuality(
    {
      ...byPlayer["Veronica Burton"],
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      flipFirstAction:
        byPlayer["Veronica Burton"].flipFirstAction || "BOTH_SIDES_WEAK",
    },
    "UNDER"
  );
  assert.equal(mabreyQ.ok, false);
  assert.equal(gabbyQ.ok, false);
  assert.equal(allemandQ.ok, false);
  assert.equal(burtonQ.ok, false);
  assert.ok(!mabreyQ.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));
  assert.ok(!burtonQ.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));
});

test("Test 10 — Dallas–Washington sub-1.5 edges stay empty", () => {
  const picks = [
    {
      player: "DAL-Thin",
      team: "DallasWings",
      opponent: "WashingtonMystics",
      league: "WNBA",
      line: 14.5,
      projection: 15.0,
      fairLine: 14.9,
      bestPropScore: 55,
      naturalDecision: "BOARD_ONLY",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "dal-was",
      providerEventId: "dal-was",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "OVER",
      confirmedActive: true,
      blowoutRisk: 30,
    },
    {
      player: "WAS-Thin",
      team: "DallasWings",
      opponent: "WashingtonMystics",
      league: "WNBA",
      line: 12.5,
      projection: 12.0,
      fairLine: 12.1,
      bestPropScore: 52,
      naturalDecision: "BOARD_ONLY",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "dal-was",
      providerEventId: "dal-was",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "UNDER",
      confirmedActive: true,
      expectedFGA: 10,
      last5Average: 12,
      seasonAverage: 12,
    },
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.selected.length, 0);
});

test("Test 11 — Strong synthetic board can form", () => {
  const picks = [
    strongOver({
      player: "StarO",
      team: "TeamA",
      opponent: "TeamB",
      gameId: "syn1",
      providerEventId: "syn1",
      naturalDecision: "TRACK",
    }),
    strongUnder({
      player: "StarU",
      team: "TeamA",
      opponent: "TeamB",
      gameId: "syn1",
      providerEventId: "syn1",
    }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selected.length >= 1);
  assert.ok(r.selected.every((p) => (p.sideEdge ?? 0) >= 1.5));
});

test("Test 12 — No forced fill on empty slots", () => {
  const r = selectTeamSidePair(
    [
      {
        player: "OnlyGarbage",
        team: "TX",
        opponent: "TY",
        league: "WNBA",
        line: 20.5,
        projection: 20.8,
        fairLine: 20.7,
        bestPropScore: 40,
        naturalDecision: "NO_BET",
        commenceTime: "2026-08-05T23:00:00Z",
        gameId: "empty1",
        providerEventId: "empty1",
        slateDate: "2026-08-05",
        canonicalSlateDate: "2026-08-05",
        bookCount: 2,
        originalModelSide: "OVER",
        blowoutRisk: 80,
        availability: "Questionable",
      },
    ],
    { requestedSlateDate: "2026-08-05" }
  );
  assert.equal(r.selected.length, 0);
  assert.ok(r.debug.emptyOver);
  assert.ok(r.debug.emptyUnder);
});

test("Test 13 — Home/Results equality", () => {
  const picks = [
    strongOver({
      player: "HO",
      team: "H",
      opponent: "A",
      gameId: "hr1",
      providerEventId: "hr1",
      naturalDecision: "TRACK",
    }),
    strongUnder({
      player: "HU",
      team: "H",
      opponent: "A",
      gameId: "hr1",
      providerEventId: "hr1",
    }),
  ];
  const board = selectControlledBestBoard(picks, {
    requestedSlateDate: "2026-08-05",
  });
  assert.equal(board.selectedProps.length, board.board.length);
  assert.equal(board.officialMembership.length, board.board.length);
  assert.ok(board.board.every((p) => p.resultsAdmissionEligible === true));
});

test("Test 14 — No Top / Best 6 / Lab / cap", () => {
  const board = selectControlledBestBoard(
    [
      strongOver({
        player: "A1",
        team: "T1",
        opponent: "T2",
        gameId: "n1",
        providerEventId: "n1",
        naturalDecision: "TRACK",
      }),
      strongUnder({
        player: "A2",
        team: "T1",
        opponent: "T2",
        gameId: "n1",
        providerEventId: "n1",
      }),
    ],
    { requestedSlateDate: "2026-08-05" }
  );
  assert.equal(board.topProps?.length ?? 0, 0);
  assert.equal(board.bestSixOverall?.length ?? 0, 0);
  assert.equal(board.audit?.bestSixRemoved, true);
  assert.ok(board.lab == null || board.lab === false || (Array.isArray(board.lab) && board.lab.length === 0));
  assert.equal(board.audit?.noFixedMinimumBoardCount, true);
  assert.equal(board.audit?.allowEmptyOfficialBoard, true);
  // bestSix may alias Official board — must not be a separate capped Top-6 surface
  if (Array.isArray(board.bestSix)) {
    assert.equal(board.bestSix.length, board.board.length);
  }
});

test("Test 15 — Historical Aug 4 snapshot unchanged", () => {
  const snapPath = path.join(ROOT, "slate-snapshots", "2026-08-04.json");
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  assert.equal(snap.propCount, 4);
  assert.equal(snap.lockedAt, "2026-08-04T03:03:13.952Z");
  assert.deepEqual(
    (snap.props || []).map((p) => p.player).sort(),
    ["Gabby Williams", "Julie Allemand", "Marina Mabrey", "Veronica Burton"].sort()
  );
});

test("Calibration weights unchanged", () => {
  assert.equal(CALIBRATION_WEIGHTS.OVER_PROJECTION_EDGE_FACTOR, 0.85);
  assert.equal(CALIBRATION_WEIGHTS.UNDER_PROJECTION_EDGE_FACTOR, 1.03);
  assert.equal(CALIBRATION_WEIGHTS.MAX_ABS_SCORE_DELTA, 22);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
