/**
 * courteedge-controlled-board-no-last-valid-garbage-v1
 *
 * Aug 4 regression (reconstruct membership — do NOT rewrite sealed slate) +
 * acceptance gates + Aug 5 dry-run.
 *
 * Usage: node scripts/testControlledBoardNoLastValidGarbageV1.js
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
  EMPTY_SLOT_REASONS,
} from "../engines/topProps/controlledBestBoardV2.js";
import {
  MEMBERSHIP_QUALITY_BUILD,
  PREFERRED_GAP_FLOOR,
  resolveOfficialTrackLabel,
} from "../engines/topProps/controlledBoardMembershipQualityV1.js";
import { CALIBRATION_WEIGHTS } from "../engines/topProps/directionalCalibrationV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

function makeStrongPair(team = "TeamA", opp = "TeamB", gameId = "g1") {
  return [
    {
      player: `${team}-Star`,
      team,
      opponent: opp,
      league: "WNBA",
      side: "Over",
      pick: "Over",
      line: 14.5,
      projection: 19.5,
      fairLine: 19,
      bestPropScore: 78,
      confidence: 62,
      naturalDecision: "TRACK",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId,
      providerEventId: gameId,
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 4,
      roleStability: "STABLE",
      blowoutRisk: 20,
      confirmedActive: true,
      originalModelSide: "OVER",
    },
    {
      player: `${team}-Low`,
      team,
      opponent: opp,
      league: "WNBA",
      side: "Under",
      pick: "Under",
      line: 16.5,
      projection: 12.0,
      fairLine: 12.2,
      bestPropScore: 74,
      confidence: 60,
      naturalDecision: "TRACK",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId,
      providerEventId: gameId,
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 4,
      roleStability: "STABLE",
      blowoutRisk: 20,
      confirmedActive: true,
      expectedFGA: 12,
      originalModelSide: "UNDER",
      last5Average: 11.5,
      seasonAverage: 12.1,
      last5HitRate: 70,
    },
  ];
}

// --- Acceptance ---
test("build tag is clear-side-strong-edge-membership-path-v1", () => {
  assert.equal(CONTROLLED_BEST_BOARD_BUILD, MEMBERSHIP_QUALITY_BUILD);
  assert.equal(
    MEMBERSHIP_QUALITY_BUILD,
    "courteedge-clear-side-strong-edge-membership-path-v1"
  );
});

test("1 NO_BET never becomes Official TRACK", () => {
  const picks = [
    {
      player: "NoBetA",
      team: "T1",
      opponent: "T2",
      league: "WNBA",
      line: 12.5,
      projection: 18,
      fairLine: 17.5,
      bestPropScore: 80,
      confidence: 60,
      naturalDecision: "NO_BET",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "nb1",
      providerEventId: "nb1",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "OVER",
      confirmedActive: true,
      blowoutRisk: 10,
    },
    {
      player: "NoBetB",
      team: "T1",
      opponent: "T2",
      league: "WNBA",
      line: 14.5,
      projection: 9,
      fairLine: 9.5,
      bestPropScore: 70,
      confidence: 55,
      naturalDecision: "NO_BET",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "nb1",
      providerEventId: "nb1",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "UNDER",
      confirmedActive: true,
      expectedFGA: 10,
      last5Average: 9,
      seasonAverage: 9.2,
    },
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.selected.length, 0);
  assert.ok(
    (r.debug.membershipRejected || []).some((x) =>
      (x.reasons || []).includes(MEMBERSHIP_REJECT.NATURAL_NO_BET)
    )
  );
  assert.notEqual(resolveOfficialTrackLabel({ naturalDecision: "NO_BET" }), "TRACK");
});

test("2 TEAM_SIDE_LAST_VALID alone does not hard-block strong evidence", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "StrongLegacyTier",
      side: "OVER",
      line: 16.5,
      projection: 21.6,
      fairLine: 21.7,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision: "BOARD_ONLY",
      blowoutRisk: 20,
      confirmedActive: true,
      originalModelSide: "OVER",
      bestPropScore: 72,
    },
    "OVER"
  );
  assert.equal(q.ok, true);
  assert.ok(!q.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));
});

test("2b Weak LAST_VALID filler still rejected by evidence", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "Weak",
      side: "OVER",
      line: 18.5,
      projection: 19.1,
      fairLine: 18.8,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision: "BOARD_ONLY",
      flipFirstAction: "BOTH_SIDES_WEAK",
      blowoutRisk: 20,
      confirmedActive: true,
      originalModelSide: "OVER",
    },
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR) ||
      q.reasons.includes(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK)
  );
  assert.ok(!q.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));
});

test("3 Edge below 1.5 leaves slot empty", () => {
  const picks = [
    {
      player: "ThinO",
      team: "TA",
      opponent: "TB",
      league: "WNBA",
      line: 14.5,
      projection: 15.3, // edge 0.8
      fairLine: 15,
      bestPropScore: 70,
      confidence: 55,
      naturalDecision: "TRACK",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "thin1",
      providerEventId: "thin1",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "OVER",
      confirmedActive: true,
      blowoutRisk: 10,
    },
    {
      player: "ThinU",
      team: "TA",
      opponent: "TB",
      league: "WNBA",
      line: 12.5,
      projection: 11.5, // edge 1.0
      fairLine: 11.4,
      bestPropScore: 68,
      confidence: 54,
      naturalDecision: "TRACK",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "thin1",
      providerEventId: "thin1",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 3,
      originalModelSide: "UNDER",
      confirmedActive: true,
      expectedFGA: 11,
      last5Average: 11,
      seasonAverage: 11.2,
    },
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.selectedOver, null);
  assert.equal(r.selectedUnder, null);
  assert.ok(
    (r.debug.membershipRejected || []).some((x) =>
      (x.reasons || []).includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR)
    )
  );
});

test("4 Blowout risk 75+ blocks unsupported Over", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "Boom",
      side: "OVER",
      line: 18.5,
      projection: 22,
      fairLine: 21,
      naturalDecision: "TRACK",
      blowoutRisk: 77,
      confirmedActive: true,
      originalModelSide: "OVER",
      teamSideTier: "TEAM_SIDE_PRIMARY",
    },
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes(MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK));
});

test("5 Questionable Over blocks until availability confirmation", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "Ques",
      side: "OVER",
      line: 18.5,
      projection: 22,
      fairLine: 21,
      naturalDecision: "TRACK",
      blowoutRisk: 20,
      availability: "Day-To-Day",
      confirmedActive: false,
      originalModelSide: "OVER",
      teamSideTier: "TEAM_SIDE_PRIMARY",
      resistance: ["Questionable availability"],
    },
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK)
  );
});

test("6 Original Under cannot become team Over without valid flip", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "GabbyLike",
      side: "OVER",
      evaluatedSide: "OVER",
      line: 14.5,
      projection: 15.3,
      fairLine: 15,
      naturalDecision: "BOARD_ONLY",
      originalModelSide: "UNDER",
      blowoutRisk: 20,
      confirmedActive: true,
      teamSideTier: "TEAM_SIDE_PRIMARY",
      flipFirstAction: "BOTH_SIDES_WEAK",
      sideEvidenceClass: "UNCERTAINTY",
      support: ["Blowout risk supports under", "Strong defense supports under"],
    },
    "OVER",
    { underEdge: -0.8 }
  );
  assert.equal(q.ok, false);
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP)
  );
});

test("7 Side label and decision narrative must agree (packet mismatch)", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "Mismatch",
      side: "OVER",
      evaluatedSide: "OVER",
      lockedSide: "UNDER",
      teamSlot: "TEAM_BEST_OVER",
      selectedTeamSlot: "TEAM_BEST_OVER",
      controlledBestBoard: true,
      line: 14.5,
      projection: 18,
      fairLine: 17.5,
      naturalDecision: "TRACK",
      originalModelSide: "OVER",
      blowoutRisk: 10,
      confirmedActive: true,
      teamSideTier: "TEAM_SIDE_PRIMARY",
      support: ["Blowout risk supports under"],
    },
    "OVER"
  );
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes(MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH));
});

test("8 Projection above Under line cannot be ignored", () => {
  const q = evaluateOfficialMembershipQuality(
    {
      player: "AllemandLike",
      side: "UNDER",
      line: 6.5,
      projection: 6.6,
      fairLine: 6.4,
      naturalDecision: "NO_BET",
      expectedFGA: 4,
      killReasons: ["LOW_VOLUME_OVER_TRAP"],
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      originalModelSide: "UNDER",
      last5Average: 6.6,
      seasonAverage: 6.6,
    },
    "UNDER"
  );
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes(MEMBERSHIP_REJECT.NATURAL_NO_BET));
  assert.ok(
    q.reasons.includes(MEMBERSHIP_REJECT.UNDER_PROJECTION_ABOVE_LINE) ||
      q.reasons.includes(MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE) ||
      q.reasons.includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR)
  );
});

test("9 Empty slots do not trigger force-fill", () => {
  const picks = [
    {
      player: "OnlyThin",
      team: "TX",
      opponent: "TY",
      league: "WNBA",
      line: 20.5,
      projection: 21.0,
      fairLine: 20.8,
      bestPropScore: 40,
      naturalDecision: "BOARD_ONLY",
      commenceTime: "2026-08-05T23:00:00Z",
      gameId: "ef1",
      providerEventId: "ef1",
      slateDate: "2026-08-05",
      canonicalSlateDate: "2026-08-05",
      bookCount: 2,
      originalModelSide: "OVER",
      blowoutRisk: 80,
      availability: "Questionable",
    },
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.selected.length, 0);
  assert.ok(r.debug.emptyOver);
  assert.ok(r.debug.emptyUnder);
});

test("10-11 Home/Results membership equal; no fixed minimum board count", () => {
  const picks = [
    ...makeStrongPair("Sun", "Wings", "gStrong1"),
    ...makeStrongPair("Wings", "Sun", "gStrong1").map((p) => ({
      ...p,
      team: p.team === "Sun" ? "Wings" : "Sun",
      opponent: p.team === "Sun" ? "Sun" : "Wings",
      player: `Wings-${p.player.split("-")[1]}`,
    })),
  ];
  // Fix team assignments cleanly
  const clean = [
    ...makeStrongPair("Sun", "Wings", "gStrong1"),
    {
      ...makeStrongPair("Wings", "Sun", "gStrong1")[0],
      team: "Wings",
      opponent: "Sun",
      player: "Wings-Star",
    },
    {
      ...makeStrongPair("Wings", "Sun", "gStrong1")[1],
      team: "Wings",
      opponent: "Sun",
      player: "Wings-Low",
    },
  ];
  const board = selectControlledBestBoard(clean, {
    requestedSlateDate: "2026-08-05",
  });
  assert.ok(board.board.length >= 1);
  assert.ok(board.board.length <= 4);
  assert.equal(board.selectedProps.length, board.board.length);
  assert.equal(board.officialMembership.length, board.board.length);
  assert.equal(board.audit.noFixedMinimumBoardCount, true);
  assert.equal(board.audit.allowEmptyOfficialBoard, true);
  // Results admission follows Official membership 1:1
  assert.ok(board.board.every((p) => p.resultsAdmissionEligible === true));
  assert.ok(board.board.every((p) => p.controlledBestBoard === true));
});

test("12 Historical Aug 4 snapshot file unchanged on disk (not rewritten)", () => {
  const snapPath = path.join(ROOT, "slate-snapshots", "2026-08-04.json");
  assert.ok(fs.existsSync(snapPath));
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  assert.equal(snap.propCount, 4);
  assert.equal(snap.phase, "ACTIVE");
  assert.equal(snap.lockedAt, "2026-08-04T03:03:13.952Z");
  const players = (snap.props || []).map((p) => p.player).sort();
  assert.deepEqual(players, [
    "Gabby Williams",
    "Julie Allemand",
    "Marina Mabrey",
    "Veronica Burton",
  ].sort());
});

test("Calibration weights unchanged by this build", () => {
  assert.equal(CALIBRATION_WEIGHTS.OVER_PROJECTION_EDGE_FACTOR, 0.85);
  assert.equal(CALIBRATION_WEIGHTS.UNDER_PROJECTION_EDGE_FACTOR, 1.03);
  assert.equal(CALIBRATION_WEIGHTS.MAX_ABS_SCORE_DELTA, 22);
  assert.equal(PREFERRED_GAP_FLOOR, 3.0);
  assert.equal(MEMBERSHIP_EDGE_FLOOR, 1.5);
});

// --- Aug 4 reconstructed membership ---
test("Aug4 reconstructed Official board — all four reject with exact reasons", () => {
  const snap = JSON.parse(
    fs.readFileSync(path.join(ROOT, "slate-snapshots", "2026-08-04.json"), "utf8")
  );
  const byPlayer = Object.fromEntries(
    (snap.props || []).map((p) => [p.player, p])
  );

  const mabrey = byPlayer["Marina Mabrey"];
  const gabby = byPlayer["Gabby Williams"];
  const allemand = byPlayer["Julie Allemand"];
  const burton = byPlayer["Veronica Burton"];
  assert.ok(mabrey && gabby && allemand && burton);

  const mabreyQ = evaluateOfficialMembershipQuality(
    {
      ...mabrey,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision:
        mabrey.decisionIntelligence?.naturalDecision ||
        mabrey.naturalDecision ||
        "BOARD_ONLY",
      confirmedActive: false,
      availability: "Day-To-Day",
    },
    "OVER"
  );
  console.log("  Mabrey reject:", mabreyQ.reasons.join(", "));
  assert.equal(mabreyQ.ok, false);
  assert.ok(
    mabreyQ.reasons.includes(MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK) ||
      mabreyQ.reasons.includes(MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK)
  );
  assert.ok(!mabreyQ.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));

  const gabbyQ = evaluateOfficialMembershipQuality(
    {
      ...gabby,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      originalModelSide: "UNDER",
      naturalDecision: "BOARD_ONLY",
      flipFirstAction: "BOTH_SIDES_WEAK",
      sideEvidenceClass: "UNCERTAINTY",
      confirmedActive: true,
    },
    "OVER",
    { underEdge: -0.8 }
  );
  console.log("  Gabby reject:", gabbyQ.reasons.join(", "));
  assert.equal(gabbyQ.ok, false);
  assert.ok(
    gabbyQ.reasons.includes(MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP)
  );

  const allemandQ = evaluateOfficialMembershipQuality(
    {
      ...allemand,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision: "NO_BET",
      killReasons: ["LOW_VOLUME_OVER_TRAP"],
      expectedFGA: 4,
    },
    "UNDER"
  );
  console.log("  Allemand reject:", allemandQ.reasons.join(", "));
  assert.equal(allemandQ.ok, false);
  assert.ok(allemandQ.reasons.includes(MEMBERSHIP_REJECT.NATURAL_NO_BET));

  const burtonQ = evaluateOfficialMembershipQuality(
    {
      ...burton,
      teamSideTier: "TEAM_SIDE_LAST_VALID",
      naturalDecision: "BOARD_ONLY",
      // Preserve sealed BOTH_SIDES_WEAK evidence from snapshot
      flipFirstAction: burton.flipFirstAction || "BOTH_SIDES_WEAK",
    },
    "UNDER"
  );
  console.log("  Burton reject:", burtonQ.reasons.join(", "));
  assert.equal(burtonQ.ok, false);
  assert.ok(
    burtonQ.reasons.includes(MEMBERSHIP_REJECT.BOTH_SIDES_WEAK) ||
      burtonQ.reasons.includes(MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR)
  );
  assert.ok(!burtonQ.reasons.includes(MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID));

  // Reconstruct team boards from the four sealed markets — expect blank Official
  const tor = [mabrey, allemand].map((p) => ({
    ...p,
    commenceTime: p.commenceTime || "2026-08-05T02:00:00Z",
    canonicalSlateDate: "2026-08-04",
    slateDate: "2026-08-04",
    confirmedActive: p.player === "Marina Mabrey" ? false : true,
    availability: p.player === "Marina Mabrey" ? "Day-To-Day" : p.availability,
  }));
  const gsv = [gabby, burton].map((p) => ({
    ...p,
    commenceTime: p.commenceTime || "2026-08-05T02:00:00Z",
    canonicalSlateDate: "2026-08-04",
    slateDate: "2026-08-04",
    originalModelSide:
      p.player === "Gabby Williams" ? "UNDER" : p.originalModelSide || p.side,
    flipFirstAction: p.player === "Gabby Williams" ? "BOTH_SIDES_WEAK" : undefined,
    sideEvidenceClass: p.player === "Gabby Williams" ? "UNCERTAINTY" : undefined,
  }));

  const board = selectControlledBestBoard([...tor, ...gsv], {
    requestedSlateDate: "2026-08-04",
  });
  console.log(
    "  Aug4 reconstructed Official count:",
    board.board.length,
    board.board.map((p) => `${p.player} ${p.side}`)
  );
  assert.ok(
    board.board.length === 0,
    `expected blank Official board, got ${board.board.length}`
  );

  console.log(
    JSON.stringify(
      {
        before: {
          home: 4,
          props: [
            "Mabrey OVER 18.5",
            "Burton UNDER 12.5",
            "Gabby OVER 14.5",
            "Allemand UNDER 6.5",
          ],
        },
        after: {
          home: board.board.length,
          props: board.board.map((p) => `${p.player} ${p.side} ${p.line}`),
          emptyOverReasons: board.audit.gameAudits?.flatMap((g) =>
            (g.teams || []).map((t) => t.emptyOver?.reason).filter(Boolean)
          ),
          emptyUnderReasons: board.audit.gameAudits?.flatMap((g) =>
            (g.teams || []).map((t) => t.emptyUnder?.reason).filter(Boolean)
          ),
          rejections: {
            Mabrey: mabreyQ.reasons,
            Gabby: gabbyQ.reasons,
            Allemand: allemandQ.reasons,
            Burton: burtonQ.reasons,
          },
        },
      },
      null,
      2
    )
  );
});

// --- Aug 5 dry run ---
test("Aug5 dry-run membership on sealed snapshot candidates", () => {
  const snapPath = path.join(ROOT, "slate-snapshots", "2026-08-05.json");
  if (!fs.existsSync(snapPath)) {
    console.log("SKIP Aug5 dry-run — snapshot missing");
    return;
  }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const props = snap.props || [];
  assert.ok(props.length > 0);

  // Re-evaluate each sealed prop under new membership rules (future path).
  // Do not rewrite the sealed file.
  const survivors = [];
  const rejected = [];
  for (const p of props) {
    const side = String(p.side || p.pick || "").toUpperCase().startsWith("UNDER")
      ? "UNDER"
      : "OVER";
    const q = evaluateOfficialMembershipQuality(
      {
        ...p,
        // Historical seals used LAST_VALID fills — flag as such when score was soft
        teamSideTier: p.teamSideTier || "TEAM_SIDE_LAST_VALID",
        naturalDecision:
          p.naturalDecision ||
          p.decisionIntelligence?.naturalDecision ||
          p.wnbaTrackingDecision ||
          "BOARD_ONLY",
      },
      side
    );
    if (q.ok) survivors.push({ player: p.player, side, line: p.line, edge: q.edge });
    else
      rejected.push({
        player: p.player,
        side,
        line: p.line,
        reasons: q.reasons,
      });
  }

  console.log(
    JSON.stringify(
      {
        aug5SealedHistoricalCount: props.length,
        aug5WouldSurviveNewMembership: survivors.length,
        survivors,
        rejectedSample: rejected.slice(0, 8),
        note: "Dry-run only — 2026-08-05.json was not rewritten",
      },
      null,
      2
    )
  );

  // Locked product structure still on board builder
  const strong = [
    ...makeStrongPair("ATL", "PHX", "aug5g1"),
    {
      ...makeStrongPair("PHX", "ATL", "aug5g1")[0],
      team: "PHX",
      opponent: "ATL",
      player: "PHX-Star",
    },
    {
      ...makeStrongPair("PHX", "ATL", "aug5g1")[1],
      team: "PHX",
      opponent: "ATL",
      player: "PHX-Low",
    },
  ];
  const live = selectControlledBestBoard(strong, {
    requestedSlateDate: "2026-08-05",
  });
  console.log(
    "  Aug5 synthetic strong-board:",
    live.board.map((p) => `${p.player} ${p.side} ${p.line}`),
    "emptySlots",
    live.audit.emptySlots
  );
  assert.equal(live.topPicks.length, 0);
  assert.equal(live.bestSixOverall.length, 0);
  assert.equal(live.audit.labLifecycleRemoved, true);
  assert.equal(live.selectedProps.length, live.board.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.error("-", f.name, f.err.message);
  process.exit(1);
}
