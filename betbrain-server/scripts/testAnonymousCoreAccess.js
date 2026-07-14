/**
 * Guard: core CourtEdge product routes must stay anonymous (no login / JWT).
 * Usage: node betbrain-server/scripts/testAnonymousCoreAccess.js
 * Optional live: ANON_API_BASE=https://betbrain-server-1.onrender.com node ...
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../server.js");
const source = fs.readFileSync(serverPath, "utf8");

const ANONYMOUS_CORE_ROUTES = [
  { method: "get", path: "/picks" },
  { method: "get", path: "/top-props" },
  { method: "get", path: "/picks/:league" },
  { method: "post", path: "/refresh-picks" },
  { method: "get", path: "/tracked-props" },
  { method: "get", path: "/daily-slate-reports" },
  { method: "get", path: "/health" },
];

const AUTH_MIDDLEWARES = ["requireAdminSecret", "requireSchedulerToken"];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

/** Registration line only — avoids scanning into later helper defs like requireSchedulerToken. */
function getRouteRegistrationLine(method, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`app\\.${method}\\(\\s*["']${escaped}["'][^\\n]*`);
  const match = source.match(re);
  assert.ok(match, `Could not find app.${method}("${routePath}")`);
  return match[0];
}

console.log("\nAnonymous core access guards\n");

for (const route of ANONYMOUS_CORE_ROUTES) {
  test(`${route.method.toUpperCase()} ${route.path} has no auth middleware`, () => {
    const line = getRouteRegistrationLine(route.method, route.path);
    for (const mw of AUTH_MIDDLEWARES) {
      assert.ok(
        !new RegExp(`\\b${mw}\\b`).test(line),
        `${route.path} must not use ${mw} on registration (got: ${line})`
      );
    }
  });
}

test("admin routes still use requireAdminSecret", () => {
  assert.match(
    source,
    /app\.get\(\s*["']\/admin\/courtedge-scheduler-status["']\s*,\s*requireAdminSecret/
  );
  assert.match(
    source,
    /app\.post\(\s*["']\/admin\/reset-history["']\s*,\s*requireAdminSecret/
  );
});

test("scheduler token helper remains separate from public /picks", () => {
  assert.match(source, /function requireSchedulerToken/);
  const picksLine = getRouteRegistrationLine("get", "/picks");
  assert.ok(!/\brequireSchedulerToken\b/.test(picksLine));
});

const liveBase = String(process.env.ANON_API_BASE || "").trim().replace(/\/$/, "");

async function runLiveProbe() {
  if (!liveBase) {
    console.log("\n(skip live probe — set ANON_API_BASE to hit a running server)\n");
    return;
  }

  console.log(`\nLive probe against ${liveBase}\n`);
  for (const route of ["/health", "/picks", "/top-props", "/picks/WNBA"]) {
    try {
      const res = await fetch(`${liveBase}${route}`, { headers: {} });
      assert.notEqual(res.status, 401, `${route} must not require auth`);
      assert.notEqual(res.status, 403, `${route} must not forbid anonymous`);
      const data = await res.json();
      assert.equal(data.ok, true, `${route} should return ok:true`);
      passed += 1;
      console.log(`  ✓ live GET ${route} without Authorization`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ live GET ${route} without Authorization`);
      console.error(`    ${error.message}`);
    }
  }
}

await runLiveProbe();

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
