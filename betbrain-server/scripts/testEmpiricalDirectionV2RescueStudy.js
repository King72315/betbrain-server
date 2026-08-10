/**
 * Direction V2 rescue study unit tests — not production activation.
 */
import assert from "assert";
import {
  evaluateHistoricalDirectionRowV2,
  evaluatePrimarySideV2,
  evaluateSideDecisionV2,
  isDirectionRescueEnabled,
} from "../engines/empiricalDirectionV2/index.js";
import { evaluateHistoricalDirectionRowV1 } from "../engines/empiricalDirectionV1/index.js";

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log("PASS", name);
}

// Rescue kill-switch defaults on for study
ok("rescue enabled by default", isDirectionRescueEnabled({}) === true);
ok(
  "rescue kill-switch works",
  isDirectionRescueEnabled({ directionRescueEnabled: false }) === false
);

// Missing role cannot clear UNDER primary (missing ≠ safe)
{
  const primary = evaluatePrimarySideV2({
    side: "UNDER",
    directionalEdge: 4.5,
    reliability: 0.8,
    safety: 70,
    roleStability: null,
    expectedMinutes: 30,
  });
  ok("under missing role fails primary", primary.pass === false);
  ok("under missing role reason", primary.reason === "UNDER_ROLE_MISSING");
}

// role=58 fails; null must not be easier
{
  const low = evaluatePrimarySideV2({
    side: "UNDER",
    directionalEdge: 4.5,
    reliability: 0.8,
    safety: 70,
    roleStability: 58,
    expectedMinutes: 30,
  });
  const missing = evaluatePrimarySideV2({
    side: "UNDER",
    directionalEdge: 4.5,
    reliability: 0.8,
    safety: 70,
    roleStability: null,
    expectedMinutes: 30,
  });
  ok("role 58 fails", low.pass === false);
  ok("role null also fails", missing.pass === false);
}

// Brionna-like UNDER edge 3.0 — not primary; rescue only with full corroboration
{
  const weak = evaluateSideDecisionV2({
    side: "UNDER",
    directionalEdge: 3.0,
    fairDirectionalEdge: 0.5,
    reliability: 0.55,
    safety: 66,
    roleStability: 62,
    expectedMinutes: 22,
    conflictIndex: 25,
    majorFailurePathCount: 1,
    rawP: 0.58,
  });
  ok("weak under 3.0 stays NO_BET", weak.decision === "NO_BET");
  ok("weak under is near-miss fail", weak.nearMiss === true);

  const strong = evaluateSideDecisionV2({
    side: "UNDER",
    directionalEdge: 3.0,
    fairDirectionalEdge: 2.0,
    reliability: 0.82,
    safety: 74,
    roleStability: 78,
    expectedMinutes: 28,
    conflictIndex: 10,
    majorFailurePathCount: 0,
    rawP: 0.72,
  });
  ok("strong under 3.0 rescued", strong.decision === "UNDER");
  ok("admission is RESCUE", strong.admission === "RESCUE");
  ok(
    "pathway UNDER_STRUCTURAL_RESCUE",
    strong.rescuePathway === "UNDER_STRUCTURAL_RESCUE"
  );
}

// Deep failure never enters rescue
{
  const deep = evaluateSideDecisionV2({
    side: "UNDER",
    directionalEdge: 0.3,
    fairDirectionalEdge: 3,
    reliability: 0.9,
    safety: 80,
    roleStability: 80,
    expectedMinutes: 30,
    conflictIndex: 5,
    majorFailurePathCount: 0,
    rawP: 0.8,
  });
  ok("edge 0.3 never rescued", deep.decision === "NO_BET");
  ok("edge 0.3 not near-miss", deep.nearMiss !== true);
}

// OVER near-miss with fair corroboration
{
  const overRescue = evaluateSideDecisionV2({
    side: "OVER",
    directionalEdge: 2.2,
    fairDirectionalEdge: 2.0,
    reliability: 0.75,
    safety: 72,
    expectedMinutes: 30,
    conflictIndex: 12,
    majorFailurePathCount: 0,
    rawP: 0.7,
    marketQuality: 70,
    bookCount: 3,
  });
  ok("over 2.2 rescued", overRescue.decision === "OVER");
  ok("over rescue admission", overRescue.admission === "RESCUE");
}

// Market conflict demands corroboration (no soft label-only pass)
{
  const conflict = evaluateSideDecisionV2({
    side: "OVER",
    directionalEdge: 4.8,
    fairDirectionalEdge: 0.2,
    reliability: 0.9,
    safety: 72,
    expectedMinutes: 30,
    conflictIndex: 12,
    majorFailurePathCount: 0,
    rawP: 0.9,
    marketQuality: 90,
    bookCount: 5,
  });
  ok(
    "hamby-like conflict without fair confirm is NO_BET",
    conflict.decision === "NO_BET"
  );

  const conflictRescued = evaluateSideDecisionV2({
    side: "OVER",
    directionalEdge: 4.8,
    fairDirectionalEdge: 2.5,
    reliability: 0.9,
    safety: 72,
    expectedMinutes: 30,
    conflictIndex: 12,
    majorFailurePathCount: 0,
    rawP: 0.9,
    marketQuality: 90,
    bookCount: 5,
  });
  ok(
    "market conflict with full corroboration can RESCUE",
    conflictRescued.admission === "RESCUE"
  );
  ok(
    "market conflict pathway tagged",
    conflictRescued.rescuePathway === "OVER_MARKET_CONFLICT_RESCUE"
  );
}

// Primary UNDER >=4 still PRIMARY
{
  const primary = evaluateSideDecisionV2({
    side: "UNDER",
    directionalEdge: 4.2,
    fairDirectionalEdge: 1.0,
    reliability: 0.6,
    safety: 68,
    roleStability: 65,
    expectedMinutes: 26,
    conflictIndex: 30,
    majorFailurePathCount: 1,
    rawP: 0.55,
  });
  ok("under 4.2 primary", primary.admission === "PRIMARY");
  ok("under 4.2 decision", primary.decision === "UNDER");
}

// Historical API shape
{
  const row = evaluateHistoricalDirectionRowV2({
    side: "OVER",
    directionalEdge: 3.0,
    fairDirectionalEdge: 2.0,
    reliability: 0.7,
    safety: 70,
    expectedMinutes: 30,
    conflictIndex: 10,
    majorFailurePathCount: 0,
    rawP: 0.7,
    marketQuality: 60,
    bookCount: 2,
  });
  ok("historical primary over", row.admission === "PRIMARY");
  ok("no production authority", row.productionAuthority === false);
}

// V1 still null-skips (document contrast; V1 unchanged)
{
  const v1 = evaluateHistoricalDirectionRowV1({
    side: "UNDER",
    directionalEdge: 4.5,
    reliability: 0.8,
    safety: 70,
    roleStability: null,
    expectedMinutes: 30,
  });
  ok("V1 still null-skips role (unchanged production)", v1.pass === true);
}

console.log(`\n${passed} tests passed`);
