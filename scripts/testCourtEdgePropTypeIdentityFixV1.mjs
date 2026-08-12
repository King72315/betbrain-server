/**
 * CourtEdge propType identity + market-history isolation V1
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

const href = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const { normalizePickPropType, resolvePickStatLabel } = await import(
  href("utils/propTypeDisplayFilter.js")
);
const display = await import(href("utils/controlledBestSixDisplay.js"));
const {
  resolveSnapshotStatLabel,
} = await import(href("betbrain-server/services/marketSnapshotService.js"));
const { buildHomeDetailedAnalysisV1 } = await import(
  href("betbrain-server/services/courtEdgeHomeDetailedAnalysisV1.js")
);
const { buildCanonicalSealedProp } = await import(
  href("betbrain-server/services/canonicalSealedProp.js")
);

test("display: propType wins over legacy Points stat label", () => {
  assert.equal(
    resolvePickStatLabel({ propType: "REBOUNDS", stat: "Points" }),
    "REBOUNDS"
  );
  assert.equal(
    normalizePickPropType({ propType: "ASSISTS", stat: "Points" }),
    "ASSISTS"
  );
  assert.equal(
    normalizePickPropType({ canonicalPropType: "REBOUNDS" }),
    "REBOUNDS"
  );
});

test("report formatter uses propType not Points default", () => {
  const line = display.formatControlledBestSixPickLine(
    {
      player: "Napheesa Collier",
      propType: "REBOUNDS",
      stat: "Points",
      side: "UNDER",
      line: 7.5,
      trueRisk: "LOW",
      confidence: 70,
    },
    0,
    "WNBA"
  );
  assert.ok(line.includes("REBOUNDS"), line);
  assert.ok(!/Prop: UNDER 7\.5 Points/i.test(line), line);
  assert.ok(line.includes("OFFICIAL"), line);
  assert.ok(!/Side Rescue/i.test(line), line);
  assert.ok(!/\bTRACK\b/.test(line), line);
});

test("report summary drops Controlled Best Board / Best 6 language", () => {
  const text = display.buildLeagueControlledBestSixReportText({
    league: "WNBA",
    bestSixCards: [],
    summary: { controlledBestSixTotal: 0 },
    dateView: "today",
  });
  assert.ok(text.includes("Official Board"), text);
  assert.ok(!/Controlled Best Board/i.test(text), text);
  assert.ok(!/Best 6 Overall/i.test(text), text);
  assert.ok(!/4 props\/game/i.test(text), text);
});

test("snapshot stat label resolves propType over Points default", () => {
  assert.equal(
    resolveSnapshotStatLabel({ propType: "REBOUNDS", stat: "Points" }),
    "Rebounds"
  );
  assert.equal(resolveSnapshotStatLabel({ propType: "ASSISTS" }), "Assists");
});

test("market snapshot service has no player-only fallback", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "betbrain-server/services/marketSnapshotService.js"),
    "utf8"
  );
  assert.ok(src.includes("resolveSnapshotStatLabel"));
  assert.ok(src.includes("Never falls back to player+date alone"));
  assert.ok(!src.includes("clean(s.league) === clean(league)"));
});

await testAsync(
  "detailed analysis builder uses rebounds for REBOUNDS market",
  async () => {
    const analysis = buildHomeDetailedAnalysisV1({
      player: "Napheesa Collier",
      propType: "REBOUNDS",
      stat: "Rebounds",
      side: "UNDER",
      line: 7.5,
      sealedLine: 7.5,
      confidence: 72,
      trueRisk: "LOW",
      courtEdgePlayerEvidence: {
        recentForm: {
          propType: "REBOUNDS",
          last5Values: [6, 8, 7, 9, 5],
          last5Points: [6, 8, 7, 9, 5],
          last10Values: [6, 8, 7, 9, 5, 4, 10, 8, 7, 6],
          last10Points: [6, 8, 7, 9, 5, 4, 10, 8, 7, 6],
          seasonPointsAverage: 7.2,
        },
        dataQuality: { coveragePct: 80 },
      },
      last5: [
        { rebounds: 6, points: 22 },
        { rebounds: 8, points: 18 },
        { rebounds: 7, points: 25 },
        { rebounds: 9, points: 15 },
        { rebounds: 5, points: 30 },
      ],
    });

    assert.equal(analysis.propSnapshot.propType, "REBOUNDS");
    assert.deepEqual(analysis.recentPerformance.last5Values, [6, 8, 7, 9, 5]);
    assert.equal(analysis.finalDecision.sideRescueAction, null);
    assert.equal(analysis.finalDecision.sideRescueDisplay, null);
  }
);

await testAsync("read-path sanitize rebuilds ASSISTS L5 from game logs", async () => {
  const { sanitizePropTypeDisplayOnPick } = await import(
    href("betbrain-server/services/propTypeDisplaySanitizeV1.js")
  );
  const fixed = sanitizePropTypeDisplayOnPick({
    player: "Paige Bueckers",
    propType: "ASSISTS",
    stat: "Points",
    side: "UNDER",
    line: 7.5,
    confidence: 52,
    trueRisk: "MEDIUM",
    displayWhy: "Side Rescue: KEEP ORIGINAL — Original UNDER stronger.",
    sideRescueAction: "KEEP_ORIGINAL",
    homeDetailedAnalysisV1: {
      schemaVersion: "x",
      recentPerformance: { last5Points: [23, 17, 17, 6, 23] },
      finalDecision: { sideRescueAction: "KEEP_ORIGINAL", sideRescueDisplay: "x" },
    },
    last5: [
      { assists: 8, points: 23 },
      { assists: 1, points: 17 },
      { assists: 4, points: 17 },
      { assists: 4, points: 6 },
      { assists: 2, points: 23 },
    ],
  });
  assert.equal(fixed.stat, "Assists");
  assert.deepEqual(fixed.homeDetailedAnalysisV1.recentPerformance.last5Values, [
    8, 1, 4, 4, 2,
  ]);
  assert.equal(fixed.sideRescueAction, null);
  assert.ok(!/Side Rescue|KEEP ORIGINAL/i.test(fixed.displayWhy || ""));
});

test("canonical sealed prop persists propType", () => {
  const sealed = buildCanonicalSealedProp({
    player: "Paige Bueckers",
    propType: "ASSISTS",
    stat: "Assists",
    side: "UNDER",
    line: 7.5,
    confidence: 70,
    trueRisk: "LOW",
    officialSelected: true,
  });
  assert.equal(sealed.propType, "ASSISTS");
  assert.equal(sealed.canonicalPropType, "ASSISTS");
  assert.equal(sealed.stat, "Assists");
  assert.equal(sealed.sideRescue.productionAuthority, false);
  assert.equal(sealed.sideRescue.action, null);
});

console.log("");
console.log(
  `CourtEdge propType identity fixes: ${passed} passed, ${failed} failed`
);
if (failed) process.exit(1);
console.log("COURTEDGE_PROPTYPE_IDENTITY_FIX_V1_PASS");
