/**
 * Aggregated CourtEdge Engine Expansion test runner.
 *
 * Spawns child suites and exits nonzero if any relevant child fails.
 * Child failures are never hidden.
 *
 *   npm run test:courtedge-engine-expansion
 *   node scripts/runCourtEdgeEngineExpansionSuite.js --with-smoke
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const withSmoke = process.argv.includes("--with-smoke");

const suites = [
  {
    name: "unit:testCourtEdgeEngineExpansionV1",
    file: path.join(__dirname, "testCourtEdgeEngineExpansionV1.js"),
  },
];

if (withSmoke) {
  suites.push({
    name: "smoke:smokeCourtEdgeEngineExpansionV1",
    file: path.join(__dirname, "smokeCourtEdgeEngineExpansionV1.js"),
  });
}

const results = [];
for (const suite of suites) {
  if (!fs.existsSync(suite.file)) {
    console.error(`MISSING suite script: ${suite.name} → ${suite.file}`);
    results.push({ name: suite.name, code: 1 });
    continue;
  }
  console.log(`\n>>> Running ${suite.name}`);
  console.log(`    ${suite.file}`);
  const result = spawnSync(process.execPath, [suite.file], {
    cwd: root,
    env: { ...process.env, COURTEDGE_EXPANSION_SUITE_CHILD: "1" },
    stdio: "inherit",
  });
  const code = result.status == null ? 1 : result.status;
  console.log(`<<< ${suite.name} exit=${code}`);
  results.push({ name: suite.name, code });
}

const failed = results.filter((r) => r.code !== 0);
console.log("\n=== Aggregate summary ===");
for (const r of results) {
  console.log(`${r.code === 0 ? "PASS" : "FAIL"} ${r.name} (exit ${r.code})`);
}
if (failed.length) {
  console.error(`\n${failed.length} suite(s) failed — not hidden.`);
  process.exit(1);
}
console.log("\nAll CourtEdge engine-expansion suites passed.");
process.exit(0);
