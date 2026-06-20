/**
 * One-off: Pearson r for bookCount/consensusBookCount vs marketQuality in tracked-props.
 * Read-only; does not modify data.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "tracked-props.json");

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

function collectRows(props) {
  const rows = [];
  for (const p of props) {
    const top = {
      bookCount: p.bookCount,
      marketQuality: p.marketQuality,
      consensusBookCount: p.consensusBookCount,
    };
    const nested = p.marketIntelligence
      ? {
          bookCount: p.marketIntelligence.bookCount,
          marketQuality: p.marketIntelligence.marketQuality,
          consensusBookCount: p.marketIntelligence.consensusBookCount,
        }
      : null;

    for (const src of [top, nested].filter(Boolean)) {
      const bc = Number(src.bookCount);
      const mq = Number(src.marketQuality);
      const cbc = Number(src.consensusBookCount);
      if (Number.isFinite(bc) && bc > 0 && Number.isFinite(mq) && mq > 0) {
        rows.push({ bookCount: bc, marketQuality: mq, consensusBookCount: cbc });
      }
    }
  }
  // Dedupe identical triples (top-level often mirrors nested)
  const seen = new Set();
  return rows.filter((r) => {
    const k = `${r.bookCount}|${r.marketQuality}|${r.consensusBookCount}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const raw = JSON.parse(readFileSync(dataPath, "utf8"));
const props = Array.isArray(raw) ? raw : raw.props || [];
const rows = collectRows(props);

const bcMq = rows.filter((r) => r.bookCount > 0 && r.marketQuality > 0);
const xs = bcMq.map((r) => r.bookCount);
const ys = bcMq.map((r) => r.marketQuality);

const withConsensus = bcMq.filter((r) => Number.isFinite(r.consensusBookCount));
const cbcXs = withConsensus.map((r) => r.consensusBookCount);
const cbcYs = withConsensus.map((r) => r.marketQuality);

console.log("=== CourtEdge reliability input correlation ===");
console.log(`Unique rows (bookCount + marketQuality): ${bcMq.length}`);
console.log(`Pearson r (bookCount vs marketQuality): ${pearson(xs, ys)?.toFixed(3) ?? "n/a"}`);

if (withConsensus.length >= 3) {
  console.log(`Rows with consensusBookCount: ${withConsensus.length}`);
  console.log(
    `Pearson r (consensusBookCount vs marketQuality): ${pearson(cbcXs, cbcYs)?.toFixed(3) ?? "n/a"}`
  );
  console.log(
    `Pearson r (bookCount vs consensusBookCount): ${pearson(withConsensus.map((r) => r.bookCount), cbcXs)?.toFixed(3) ?? "n/a"}`
  );
}

// Group means: bookCount bucket vs avg marketQuality
const buckets = {};
for (const r of bcMq) {
  const b = r.bookCount;
  if (!buckets[b]) buckets[b] = [];
  buckets[b].push(r.marketQuality);
}
console.log("\nMean marketQuality by bookCount:");
for (const b of Object.keys(buckets).sort((a, c) => Number(a) - Number(c))) {
  const vals = buckets[b];
  const avg = vals.reduce((a, v) => a + v, 0) / vals.length;
  console.log(`  bookCount=${b}: n=${vals.length}, avg marketQuality=${avg.toFixed(1)}`);
}
