/**
 * CourtEdge Local-first / Render-fallback API routing V1 tests
 */
import assert from "assert";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const resolverUrl = pathToFileURL(
  path.join(ROOT, "lib", "apiEndpointResolver.js")
).href;

const {
  selectApiBackend,
  ensureActiveBackend,
  resetApiEndpointSessionForTests,
  assertSingleBackendTruth,
  DEFAULT_LOCAL_API_URL,
  DEFAULT_RENDER_API_URL,
} = await import(resolverUrl);

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`PASS ${name}`);
    })
    .catch((err) => {
      failed += 1;
      failures.push({ name, error: err?.message || String(err) });
      console.error(`FAIL ${name}: ${err?.message || err}`);
    });
}

function mockFetch(handler) {
  return async (url, init = {}) => handler(String(url), init);
}

const envBase = {
  EXPO_PUBLIC_LOCAL_API_URL: DEFAULT_LOCAL_API_URL,
  EXPO_PUBLIC_RENDER_API_URL: DEFAULT_RENDER_API_URL,
  EXPO_PUBLIC_API_URL: "",
};

await test("Local healthy → LOCAL chosen, Render not used", async () => {
  resetApiEndpointSessionForTests();
  const calls = [];
  const fetchFn = mockFetch(async (url) => {
    calls.push(url);
    if (url.includes("/health") && url.includes("127.0.0.1")) {
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const diag = await selectApiBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "auto" },
    isDev: true,
    fetchFn,
  });
  assert.equal(diag.activeBackend, "LOCAL");
  assert.equal(diag.baseUrl, DEFAULT_LOCAL_API_URL);
  assert.equal(diag.fallbackUsed, false);
  assert.ok(calls.every((u) => u.startsWith(DEFAULT_LOCAL_API_URL)));
  assert.ok(!calls.some((u) => u.includes("onrender.com")));
});

await test("Local down → Render chosen with fallback", async () => {
  resetApiEndpointSessionForTests();
  const fetchFn = mockFetch(async () => {
    throw new Error("ECONNREFUSED");
  });
  const diag = await selectApiBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "auto" },
    isDev: true,
    fetchFn,
  });
  assert.equal(diag.activeBackend, "RENDER");
  assert.equal(diag.baseUrl, DEFAULT_RENDER_API_URL);
  assert.equal(diag.fallbackUsed, true);
  assert.ok(String(diag.reason || "").includes("LOCAL"));
});

await test("Forced Render → Render even if Local healthy", async () => {
  resetApiEndpointSessionForTests();
  let localHits = 0;
  const fetchFn = mockFetch(async (url) => {
    if (url.includes("127.0.0.1")) localHits += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const diag = await selectApiBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "render" },
    isDev: true,
    fetchFn,
  });
  assert.equal(diag.activeBackend, "RENDER");
  assert.equal(diag.fallbackUsed, false);
  assert.equal(localHits, 0);
});

await test("Forced Local → Local chosen; clear error if unavailable", async () => {
  resetApiEndpointSessionForTests();
  const fetchFn = mockFetch(async () => {
    throw new Error("down");
  });
  const diag = await selectApiBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "local" },
    isDev: true,
    fetchFn,
  });
  assert.equal(diag.activeBackend, "LOCAL");
  assert.equal(diag.baseUrl, DEFAULT_LOCAL_API_URL);
  assert.equal(diag.fallbackUsed, false);
  assert.equal(diag.error, "LOCAL_UNAVAILABLE");
});

await test("No response merging across backends", async () => {
  assert.equal(
    assertSingleBackendTruth({ sources: ["LOCAL"] }),
    true
  );
  assert.equal(
    assertSingleBackendTruth({ backends: ["RENDER"] }),
    true
  );
  let threw = false;
  try {
    assertSingleBackendTruth({ sources: ["LOCAL", "RENDER"] });
  } catch (err) {
    threw = true;
    assert.ok(String(err.message).includes("COURTEDGE_API_MERGE_FORBIDDEN"));
  }
  assert.equal(threw, true);
});

await test("Same backend across board request (session lock)", async () => {
  resetApiEndpointSessionForTests();
  let healthCalls = 0;
  const fetchFn = mockFetch(async (url) => {
    if (url.includes("/health")) healthCalls += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const a = await ensureActiveBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "auto" },
    isDev: true,
    fetchFn,
  });
  const b = await ensureActiveBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "auto" },
    isDev: true,
    fetchFn,
  });
  assert.equal(a.baseUrl, b.baseUrl);
  assert.equal(a.activeBackend, "LOCAL");
  assert.equal(b.activeBackend, "LOCAL");
  assert.equal(healthCalls, 1, "health probed once per session");
});

await test("Production auto defaults to Render without local probe", async () => {
  resetApiEndpointSessionForTests();
  let calls = 0;
  const fetchFn = mockFetch(async () => {
    calls += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const diag = await selectApiBackend({
    env: { ...envBase, EXPO_PUBLIC_API_MODE: "auto" },
    isDev: false,
    fetchFn,
  });
  assert.equal(diag.activeBackend, "RENDER");
  assert.equal(calls, 0);
});

console.log("");
console.log(
  `CourtEdge Local/Render Fallback V1: ${passed} passed, ${failed} failed`
);
if (failed) {
  for (const f of failures) console.error(` - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log("COURTEDGE_LOCAL_RENDER_FALLBACK_V1_PASS");
