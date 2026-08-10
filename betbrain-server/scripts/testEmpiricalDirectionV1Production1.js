/**
 * Acceptance tests for Empirical Direction V1 PRODUCTION_1 freeze.
 */
import assert from "assert";
import {
  decideDirectionalSideV1,
  evaluateHistoricalDirectionRowV1,
  DIRECTION_THRESHOLDS_V1,
  EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
} from "../engines/empiricalDirectionV1/index.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function pkt(side, { edge, rel, safety, role, minutes, mq, books, fairEdge } = {}) {
  const line = 20.5;
  const projection = side === "OVER" ? line + (edge ?? 0) : line - (edge ?? 0);
  const fairLine =
    fairEdge == null
      ? null
      : side === "OVER"
        ? line + fairEdge
        : line - fairEdge;
  return {
    side,
    line,
    projection,
    fairLine,
    rawWinProbability: rel != null ? Math.min(0.99, 0.5 + rel / 2) : 0.6,
    reliabilityProbability: rel,
    safety: { finalSafetyScore: safety },
    role: { roleStabilityScore: role },
    minutes: { expectedMinutes: minutes },
    market: { marketQualityScore: mq, bookCount: books },
  };
}

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log("PASS", name);
}

// Freeze identity
ok(
  "freeze id",
  DIRECTION_THRESHOLDS_V1.freezeId === EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE
);

// OVER pass at edge 2.5 + safety 65
{
  const d = decideDirectionalSideV1({
    overPacket: pkt("OVER", { edge: 2.6, safety: 70, rel: 0.6 }),
    underPacket: pkt("UNDER", { edge: 0.5, safety: 50, rel: 0.3 }),
  });
  ok("strong over directs OVER", d.decision === "OVER");
  ok("over not NO_BET", d.officialDirectionEligible === true);
}

// Weak edge → NO BET
{
  const d = decideDirectionalSideV1({
    overPacket: pkt("OVER", { edge: 0.5, safety: 80, rel: 0.8 }),
    underPacket: pkt("UNDER", { edge: 0.4, safety: 80, rel: 0.8 }),
  });
  ok("weak edge NO_BET", d.decision === "NO_BET");
}

// UNDER requires edge >= 4
{
  const fail = decideDirectionalSideV1({
    overPacket: pkt("OVER", { edge: 0.2, safety: 50 }),
    underPacket: pkt("UNDER", { edge: 3.0, safety: 70, rel: 0.6, role: 70, minutes: 30 }),
  });
  ok("under edge 3 still NO_BET", fail.decision === "NO_BET");

  const pass = decideDirectionalSideV1({
    overPacket: pkt("OVER", { edge: 0.2, safety: 50 }),
    underPacket: pkt("UNDER", { edge: 4.2, safety: 70, rel: 0.6, role: 70, minutes: 30 }),
  });
  ok("under edge 4.2 directs UNDER", pass.decision === "UNDER");
}

// Market conflict soft — still OVER but reduced confidence
{
  const d = decideDirectionalSideV1({
    overPacket: pkt("OVER", {
      edge: 3.0,
      safety: 70,
      rel: 0.75,
      mq: 90,
      books: 5,
    }),
    underPacket: pkt("UNDER", { edge: 0.2, safety: 40 }),
  });
  ok("market conflict still OVER", d.decision === "OVER");
  ok("market conflict soft flag", d.marketConflict === true);
  ok("market conflict confidence not STRONG", d.confidence !== "STRONG");
}

// Historical row eval on study sample
{
  const rowsPath = path.join(
    ROOT,
    "research/empirical-direction-v1/COURTEDGE_EMPIRICAL_DIRECTION_STUDY_ROWS_V1.json"
  );
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8")).rows || [];
  let directed = 0;
  let wins = 0;
  for (const r of rows) {
    const e = evaluateHistoricalDirectionRowV1(r);
    if (e.decision === r.side && e.pass) {
      directed += 1;
      if (r.result === "WIN") wins += 1;
    }
  }
  ok("historical directed count near freeze (~53)", directed >= 45 && directed <= 60);
  ok("historical directed win rate strong", wins / directed >= 0.75);
}

console.log(`\n${passed} tests passed`);
