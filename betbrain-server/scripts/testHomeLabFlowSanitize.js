/**
 * Home must never show Lab / past Results cohort as Today.
 * Read-path sanitize only — no tracked-prop deletes.
 */
import assert from "node:assert/strict";
import {
  sanitizeHomeBoardForLifecycle,
  pickActiveResultsSlateDate,
} from "../services/slateScopeService.js";
import { computeSlateRotation } from "../services/slateScopeService.js";
import {
  filterCalendarTodayHomePool,
  buildLeagueBestSixBoard,
  resolveLeaguePicksPayload,
} from "../../utils/controlledBestSixDisplay.js";

const TODAY = "2026-07-16";
const LAB = "2026-07-15";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

const labProp = {
  player: "Lab Player",
  league: "WNBA",
  slateDate: LAB,
  dayBucket: "TODAY",
  dateLabel: "today",
};
const todayProp = {
  player: "Today Player",
  league: "WNBA",
  slateDate: TODAY,
  dayBucket: "TODAY",
  dateLabel: "today",
};

test("sanitizeHomeBoardForLifecycle scrubs Lab cohort from Home Today pools", () => {
  const tracked = [
    {
      player: "Lab Player",
      league: "WNBA",
      slateDate: LAB,
      result: "win",
      trackingType: "OFFICIAL",
    },
  ];
  const reports = [
    {
      slateDate: LAB,
      status: "final",
      reportStatus: "final",
      frozen: true,
      completedAt: "2026-07-16T06:00:00.000Z",
      sections: {
        A: {
          reportStatus: "final",
          pending: 0,
          awaitingStats: 0,
          graded: 1,
          totalOfficialProps: 1,
        },
        O: { picks: tracked },
      },
    },
  ];
  const board = {
    bestSixWNBA: [labProp],
    bestSixNBA: [],
    bestSixDisplayWNBA: [labProp, todayProp],
    bestSixDisplayNBA: [],
    bestSixDisplayTodayWNBA: [labProp],
    bestSixDisplayTodayNBA: [],
    topWNBAProps: [labProp, todayProp],
  };

  const sanitized = sanitizeHomeBoardForLifecycle(board, {
    todayLocalDate: TODAY,
    trackedProps: tracked,
    reports,
    lockedSlates: [{ slateDate: LAB, phase: "LAB" }],
    archives: [],
  });

  const rotation = computeSlateRotation(reports, {
    trackedProps: tracked,
    lockedSlates: [{ slateDate: LAB, phase: "LAB" }],
    today: TODAY,
  });
  assert.equal(rotation.currentLabSlateDate, LAB);
  assert.equal(
    pickActiveResultsSlateDate(tracked, reports, TODAY, [
      { slateDate: LAB, phase: "LAB" },
    ]),
    null
  );

  assert.equal(sanitized.bestSixWNBA.length, 1);
  assert.equal(sanitized.bestSixWNBA[0].player, "Today Player");
  assert.equal(sanitized.bestSixDisplayTodayWNBA.length, 1);
  assert.equal(sanitized.bestSixDisplayTodayWNBA[0].player, "Today Player");
  assert.ok(
    !(sanitized.topWNBAProps || []).some((p) => p.slateDate === LAB),
    "Lab tops scrubbed"
  );
});

test("sanitizeHomeBoardForLifecycle reclassifies stale dayBucket using commenceTime", () => {
  const TODAY21 = "2026-07-21";
  const priorSealed = {
    player: "Rhyne Howard",
    league: "WNBA",
    side: "Under",
    line: 18.5,
    dayBucket: "TODAY",
    dateLabel: "Today",
    commenceTime: "2026-07-19T20:00:00Z",
    officialPropId:
      "2026-07-20|WNBA|rhynehoward|atlantadream|chicagosky|points|UNDER|18.5",
  };
  const staleTomorrow = {
    player: "Kayla McBride",
    league: "WNBA",
    side: "Over",
    line: 18.5,
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
    commenceTime: "2026-07-21T02:00:00Z",
  };
  const trueToday = {
    player: "Jul21 Player",
    league: "WNBA",
    side: "Over",
    line: 12.5,
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
    commenceTime: "2026-07-22T00:00:00Z",
    slateDate: "2026-07-21",
  };
  const trueTomorrow = {
    player: "Jul22 Player",
    league: "WNBA",
    side: "Under",
    line: 9.5,
    dayBucket: "TODAY",
    dateLabel: "Today",
    commenceTime: "2026-07-23T02:00:00Z",
    slateDate: "2026-07-22",
  };

  const sanitized = sanitizeHomeBoardForLifecycle(
    {
      bestSixDisplayTodayWNBA: [priorSealed],
      bestSixDisplayTomorrowWNBA: [staleTomorrow, trueToday],
      bestSixDisplayWNBA: [priorSealed, staleTomorrow, trueToday, trueTomorrow],
      bestSixWNBA: [priorSealed],
      games: [
        {
          league: "WNBA",
          game: "OLD",
          dayBucket: "TODAY",
          commenceTime: "2026-07-19T20:00:00Z",
          date: "2026-07-19",
          picks: [priorSealed],
        },
        {
          league: "WNBA",
          game: "TODAY21",
          dayBucket: "TOMORROW",
          commenceTime: "2026-07-22T00:00:00Z",
          date: "2026-07-21",
          picks: [trueToday],
        },
        {
          league: "WNBA",
          game: "TOM22",
          dayBucket: "TODAY",
          commenceTime: "2026-07-23T02:00:00Z",
          date: "2026-07-22",
          picks: [trueTomorrow],
        },
      ],
    },
    { todayLocalDate: TODAY21, trackedProps: [], reports: [], archives: [], lockedSlates: [] }
  );

  assert.equal(sanitized.bestSixDisplayTodayWNBA.length, 1);
  assert.equal(sanitized.bestSixDisplayTodayWNBA[0].player, "Jul21 Player");
  assert.equal(sanitized.bestSixDisplayTodayWNBA[0].dayBucket, "TODAY");
  assert.equal(sanitized.bestSixDisplayTomorrowWNBA.length, 1);
  assert.equal(sanitized.bestSixDisplayTomorrowWNBA[0].player, "Jul22 Player");
  assert.ok(
    !(sanitized.bestSixDisplayTodayWNBA || []).some((p) => p.player === "Rhyne Howard"),
    "Jul 20 sealed must not appear as Home Today"
  );
  assert.ok(
    !(sanitized.bestSixDisplayTomorrowWNBA || []).some((p) => p.player === "Kayla McBride"),
    "Jul 20 evening games must not appear as Home Tomorrow on Jul 21"
  );
  assert.equal(sanitized.games.length, 2);
  assert.deepEqual(
    sanitized.games.map((g) => g.dayBucket).sort(),
    ["TODAY", "TOMORROW"]
  );
  assert.equal(
    sanitized.controlledBestSixAudit.bestSixDisplayTodayCountByLeague.WNBA,
    1
  );
  assert.equal(
    sanitized.controlledBestSixAudit.bestSixDisplayTomorrowCountByLeague.WNBA,
    1
  );
  assert.equal(sanitized.lifecycleHomeSanitize.today, TODAY21);
  assert.equal(sanitized.lifecycleHomeSanitize.tomorrow, "2026-07-22");
  assert.equal(sanitized.lifecycleHomeSanitize.slateDateReclassified, true);
});

test("filterCalendarTodayHomePool ignores stale dayBucket=TODAY Lab props", () => {
  const filtered = filterCalendarTodayHomePool([labProp, todayProp], TODAY);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].player, "Today Player");
});

test("buildLeagueBestSixBoard today view rejects Lab slateDate props", () => {
  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSix: [labProp],
    bestSixDisplay: [labProp, todayProp],
    bestSixDisplayToday: [labProp],
    dateView: "today",
    bestSixLimit: 6,
  });
  // Without a calendar-today pool, board should not show Lab as Today.
  assert.ok(
    board.bestSixCards.every((c) => c.slateDate !== LAB),
    "no Lab cards on Today"
  );
});

test("resolveLeaguePicksPayload never falls back Today pool to Results bestSix", () => {
  const payload = resolveLeaguePicksPayload(
    {
      bestSixWNBA: [labProp],
      bestSixDisplayWNBA: [todayProp],
      bestSixDisplayTodayWNBA: [],
      wnbaGames: [],
    },
    "WNBA"
  );
  assert.equal(payload.bestSixDisplayToday.length, 1);
  assert.equal(payload.bestSixDisplayToday[0].player, "Today Player");
});

console.log("All home/lab flow sanitize tests passed.");
