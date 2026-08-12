/**
 * CourtEdge Bottom Navigation Cleanup V1 — regression tests
 *
 * Asserts product chrome:
 *   HOME | RESULTS | LAB | HISTORY
 * and that WNBA/TENNIS are not bottom-tab destinations.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const EXPECTED_TITLES = ["Home", "Results", "Lab", "History"];
const EXPECTED_ROUTES = ["index", "results", "prop-lab", "history"];
const FORBIDDEN_ROUTES = ["wnba", "tennis-results", "nba"];
const HOME_LEAGUES = ["NBA", "WNBA"];
const HOME_DATES = ["Today", "Tomorrow"];
const HOME_PROP_FILTERS = ["ALL", "POINTS", "REBOUNDS", "ASSISTS"];

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err && err.message ? err.message : String(err) });
    console.error(`FAIL ${name}: ${err && err.message ? err.message : err}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function parseTabsLayout(source) {
  const screenRe =
    /<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g;
  const screens = [];
  let m;
  while ((m = screenRe.exec(source))) {
    const name = m[1];
    const opts = m[2];
    const titleMatch = opts.match(/title:\s*"([^"]+)"/);
    const hidden = /href:\s*null/.test(opts);
    screens.push({
      name,
      title: titleMatch ? titleMatch[1] : name,
      hidden,
    });
  }
  return screens;
}

test("contract util exports exact bottom tab titles", () => {
  const util = read("utils/courtEdgeNavigationV1.js");
  for (const title of EXPECTED_TITLES) {
    assert.ok(util.includes(`"${title}"`), `util missing ${title}`);
  }
  assert.ok(util.includes('"WNBA"'));
  assert.ok(util.includes('"Tennis"') || util.includes('"TENNIS"'));
});

test("layout: visible tabs exactly Home/Results/Lab/History in order", () => {
  const source = read("app/(tabs)/_layout.tsx");
  const screens = parseTabsLayout(source);
  assert.ok(screens.length >= 4, "expected Tabs.Screen entries");
  const visible = screens.filter((s) => !s.hidden);
  assert.deepEqual(
    visible.map((s) => s.title),
    EXPECTED_TITLES
  );
  assert.deepEqual(
    visible.map((s) => s.name),
    EXPECTED_ROUTES
  );
});

test("layout: WNBA and Tennis are not visible bottom tabs", () => {
  const source = read("app/(tabs)/_layout.tsx");
  const screens = parseTabsLayout(source);
  const visibleTitles = screens
    .filter((s) => !s.hidden)
    .map((s) => s.title.toUpperCase());
  assert.ok(!visibleTitles.includes("WNBA"));
  assert.ok(!visibleTitles.includes("TENNIS"));
  for (const route of FORBIDDEN_ROUTES) {
    const hit = screens.find((s) => s.name === route);
    assert.ok(hit, `missing Tabs.Screen for ${route}`);
    assert.equal(hit.hidden, true, `${route} must have href: null`);
  }
});

test("legacy wnba route redirects to Home (no standalone board)", () => {
  const source = read("app/(tabs)/wnba.tsx");
  assert.ok(/Redirect/.test(source), "wnba.tsx must Redirect");
  assert.ok(/href=["']\/["']/.test(source), "wnba.tsx must redirect to Home");
  assert.ok(
    !/LeagueControlledBestSixScreen/.test(source),
    "standalone WNBA board screen must be removed"
  );
});

test("legacy tennis route redirects to Home (unreachable TennisEdge UI)", () => {
  const source = read("app/(tabs)/tennis-results.tsx");
  assert.ok(/Redirect/.test(source), "tennis-results.tsx must Redirect");
  assert.ok(
    /href=["']\/["']/.test(source),
    "tennis-results.tsx must redirect to Home"
  );
  assert.ok(
    !/filterTennisTrackedProps/.test(source),
    "CourtEdge tennis results UI must be unwired"
  );
  assert.ok(
    !/export default function TennisResultsScreen/.test(source),
    "legacy Tennis screen component must not remain"
  );
});

test("layout has no Tennis product destination wiring", () => {
  const source = read("app/(tabs)/_layout.tsx");
  assert.ok(!/href:\s*["']\/tennis/.test(source));
  assert.ok(!/router\.(push|replace)/.test(source));
  // tennis-results may remain registered only as href:null (dead tab chrome)
  const tennis = parseTabsLayout(source).find((s) => s.name === "tennis-results");
  assert.ok(tennis);
  assert.equal(tennis.hidden, true);
});

test("Home owns NBA | WNBA selectors (not bottom tabs)", () => {
  const home = read("components/HomeControlledBestSixScreen.tsx");
  for (const league of HOME_LEAGUES) {
    assert.ok(home.includes(league), `Home missing league selector ${league}`);
  }
  assert.ok(/setActiveLeague/.test(home), "Home must own league state");
  assert.ok(/SUPPORTED_LEAGUES/.test(home), "Home must map NBA/WNBA");
  for (const label of HOME_DATES) {
    assert.ok(home.includes(label), `Home missing date selector ${label}`);
  }
  for (const filter of HOME_PROP_FILTERS) {
    assert.ok(
      home.includes(`"${filter}"`) || home.includes(`'${filter}'`),
      `Home missing prop filter ${filter}`
    );
  }
});

test("Home still reaches WNBA predictions path", () => {
  const home = read("components/HomeControlledBestSixScreen.tsx");
  assert.ok(/buildBoardForView\(picksData,\s*"WNBA"/.test(home));
  assert.ok(/activeLeague/.test(home));
  const index = read("app/(tabs)/index.tsx");
  assert.ok(/HomeControlledBestSixScreen/.test(index));
});

test("Lab and History tab screens still exist", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "app/(tabs)/prop-lab.tsx")));
  assert.ok(fs.existsSync(path.join(ROOT, "app/(tabs)/history.tsx")));
  assert.ok(fs.existsSync(path.join(ROOT, "app/(tabs)/results.tsx")));
  const lab = read("app/(tabs)/prop-lab.tsx");
  assert.ok(/fetchCourtEdgeLabV2|Prop Lab|courtEdgeLab/i.test(lab));
  const history = read("app/(tabs)/history.tsx");
  assert.ok(history.length > 50, "history screen should remain non-empty");
});

test("app tree has no CourtEdge router push to tennis", () => {
  const roots = ["app", "components"];
  const offenders = [];
  for (const root of roots) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      const st = fs.statSync(cur);
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(cur)) {
          if (name === "node_modules" || name === ".git") continue;
          stack.push(path.join(cur, name));
        }
        continue;
      }
      if (!/\.(tsx|ts|jsx|js)$/.test(cur)) continue;
      if (cur.replace(/\\/g, "/").endsWith("app/(tabs)/tennis-results.tsx")) {
        continue;
      }
      const text = fs.readFileSync(cur, "utf8");
      if (
        /router\.(push|replace)\([^)]*tennis/i.test(text) ||
        /href=["']\/\(tabs\)\/tennis/i.test(text) ||
        /href=["']\/tennis-results["']/i.test(text)
      ) {
        offenders.push(path.relative(ROOT, cur));
      }
    }
  }
  assert.deepEqual(offenders, [], `tennis nav targets remain: ${offenders.join(", ")}`);
});

console.log("");
console.log(
  `CourtEdge Navigation Cleanup V1: ${passed} passed, ${failed} failed`
);
if (failed) {
  for (const f of failures) {
    console.error(` - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}
console.log("COURTEDGE_NAVIGATION_CLEANUP_V1_PASS");
