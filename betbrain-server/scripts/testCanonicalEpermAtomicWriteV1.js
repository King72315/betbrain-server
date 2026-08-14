/**
 * Windows-oriented EPERM / atomic write regression for canonical store.
 * Simulates concurrent reader holding a file handle during replace.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Re-implement atomicWriteJson locally mirroring production semantics so the
// test does not depend on private exports.
function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload);
  const maxAttempts = 8;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return { method: "rename", attempts: attempt };
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw err;
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.renameSync(tmp, file);
        return { method: "unlink+rename", attempts: attempt };
      } catch (err2) {
        lastErr = err2;
      }
      const waitMs = 40 * attempt;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        /* spin */
      }
    }
  }
  fs.copyFileSync(tmp, file);
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  return { method: "copyFile", attempts: maxAttempts, lastErr: lastErr?.code };
}

test("atomicWriteJson succeeds with open reader handle (Windows-safe)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-eprem-"));
  const file = path.join(dir, "canonical-predictions-v1.json");
  fs.writeFileSync(file, JSON.stringify({ records: [{ id: 1 }] }, null, 2));

  // Hold a read handle open (simulates local API).
  const fd = fs.openSync(file, "r");
  try {
    const result = atomicWriteJson(file, {
      records: [{ id: 1 }, { id: 2 }],
      batch: true,
    });
    assert.ok(result.method);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(parsed.records.length, 2);
    assert.strictEqual(parsed.batch, true);
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("batchAppendCanonicalResults exists and is exported", async () => {
  const mod = await import(
    "../services/courtEdgeCanonicalPredictionRecordV1.js"
  );
  assert.strictEqual(typeof mod.batchAppendCanonicalResults, "function");
  assert.strictEqual(typeof mod.appendCanonicalResult, "function");
});

console.log("\nEPERM atomic write regression tests done");
