import fs from "fs";

const p = "history-archive/2026-07-17.json";
const raw = fs.readFileSync(p, "utf8");
if (!raw.includes('"phase": "LAB"')) {
  console.log("Jul 17 phase already not LAB (or missing)");
  process.exit(0);
}
const next = raw.replace('"phase": "LAB"', '"phase": "ARCHIVED"');
fs.writeFileSync(p, next);
console.log("patched Jul17 phase LAB -> ARCHIVED");
