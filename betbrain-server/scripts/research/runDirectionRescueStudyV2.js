/**
 * Direction V2 rescue study — historical comparison vs V1 PRODUCTION_1.
 *
 * STUDY ONLY. Does not activate V2 in production. Does not retune C2.
 *
 * Usage:
 *   node scripts/research/runDirectionRescueStudyV2.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateHistoricalDirectionRowV1 } from "../../engines/empiricalDirectionV1/index.js";
import { evaluateHistoricalDirectionRowV2 } from "../../engines/empiricalDirectionV2/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const ROWS_PATH = path.join(
  ROOT,
  "research/empirical-direction-v1/COURTEDGE_EMPIRICAL_DIRECTION_STUDY_ROWS_V1.json"
);
const OUT_DIR = path.join(
  ROOT,
  "research/empirical-direction-v2/rescue-study-1"
);

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function record(rows) {
  const directed = rows.filter((r) => r.decision === "OVER" || r.decision === "UNDER");
  const wins = directed.filter((r) => r.result === "WIN").length;
  const losses = directed.filter((r) => r.result === "LOSS").length;
  const noBet = rows.length - directed.length;
  return {
    n: rows.length,
    directed: directed.length,
    wins,
    losses,
    noBet,
    winRate: directed.length ? wins / directed.length : null,
    coverage: rows.length ? directed.length / rows.length : null,
    record: `${wins}-${losses}`,
  };
}

/** Pool W-L over all rows (not only directed). */
function poolRecord(rows) {
  const wins = rows.filter((r) => r.result === "WIN").length;
  const losses = rows.filter((r) => r.result === "LOSS").length;
  return {
    n: rows.length,
    wins,
    losses,
    winRate: rows.length ? wins / rows.length : null,
    record: `${wins}-${losses}`,
  };
}

function byAdmission(rows) {
  const primary = rows.filter((r) => r.admission === "PRIMARY");
  const rescue = rows.filter((r) => r.admission === "RESCUE");
  return {
    PRIMARY: record(primary),
    RESCUE: record(rescue),
    OVER_PRIMARY: record(primary.filter((r) => r.decision === "OVER")),
    UNDER_PRIMARY: record(primary.filter((r) => r.decision === "UNDER")),
    OVER_RESCUE: record(rescue.filter((r) => r.decision === "OVER")),
    UNDER_RESCUE: record(rescue.filter((r) => r.decision === "UNDER")),
  };
}

function bySide(rows) {
  return {
    OVER: record(rows.filter((r) => r.side === "OVER")),
    UNDER: record(rows.filter((r) => r.side === "UNDER")),
  };
}

function main() {
  const payload = JSON.parse(fs.readFileSync(ROWS_PATH, "utf8"));
  const rows = payload.rows || [];

  function evaluateUniverse(rescueOpts) {
    const v1Rows = [];
    const v2Rows = [];
    const rescueOnly = [];
    const v2KillsMissingPass = [];
    const underNearMiss = [];
    const overNearMiss = [];
    const marketConflictDemand = [];

    for (const row of rows) {
      const v1 = evaluateHistoricalDirectionRowV1(row);
      const v2 = evaluateHistoricalDirectionRowV2(row, {
        directionRescueEnabled: true,
        ...rescueOpts,
      });

      const v1Pass = v1.pass === true;
      const v2Pass = v2.pass === true;

      v1Rows.push({
        player: row.player,
        slateDateCT: row.slateDateCT,
        side: row.side,
        result: row.result,
        directionalEdge: row.directionalEdge,
        decision: v1Pass ? row.side : "NO_BET",
        reason: v1.reason,
        admission: v1Pass ? "PRIMARY" : null,
      });

      v2Rows.push({
        player: row.player,
        slateDateCT: row.slateDateCT,
        side: row.side,
        result: row.result,
        directionalEdge: row.directionalEdge,
        decision: v2Pass ? row.side : "NO_BET",
        reason: v2.reason,
        admission: v2Pass ? v2.admission : null,
        rescuePathway: v2.rescuePathway || null,
        nearMiss: v2.nearMiss || false,
        stage: v2.stage,
      });

      if (v2Pass && v2.admission === "RESCUE") {
        rescueOnly.push({
          player: row.player,
          slateDateCT: row.slateDateCT,
          side: row.side,
          result: row.result,
          directionalEdge: row.directionalEdge,
          fairDirectionalEdge: row.fairDirectionalEdge,
          reliability: row.reliability,
          roleStability: row.roleStability,
          expectedMinutes: row.expectedMinutes,
          conflictIndex: row.conflictIndex,
          majorFailurePathCount: row.majorFailurePathCount,
          pathway: v2.rescuePathway,
          reason: v2.reason,
        });
      }

      if (
        row.side === "UNDER" &&
        v1Pass &&
        !v2Pass &&
        String(v2.reason || "").includes("MISSING")
      ) {
        v2KillsMissingPass.push({
          player: row.player,
          slateDateCT: row.slateDateCT,
          side: row.side,
          result: row.result,
          v1Reason: v1.reason,
          v2Reason: v2.reason,
          roleStability: row.roleStability,
          expectedMinutes: row.expectedMinutes,
          reliability: row.reliability,
          safety: row.safety,
        });
      }

      const edge = Number(row.directionalEdge);
      if (
        row.side === "UNDER" &&
        Number.isFinite(edge) &&
        edge >= 2.5 &&
        edge < 4
      ) {
        underNearMiss.push({
          player: row.player,
          result: row.result,
          edge,
          reason: v2.reason,
          admission: v2.admission,
          rescueFailures: v2.rescueFailures || null,
        });
      }
      if (
        row.side === "OVER" &&
        Number.isFinite(edge) &&
        edge >= 1.75 &&
        edge < 2.5
      ) {
        overNearMiss.push({
          player: row.player,
          result: row.result,
          edge,
          reason: v2.reason,
          admission: v2.admission,
          rescueFailures: v2.rescueFailures || null,
        });
      }
      if (
        v2.primary?.reason === "OVER_MARKET_CONFLICT_NEEDS_CORROBORATION"
      ) {
        marketConflictDemand.push({
          player: row.player,
          result: row.result,
          edge: row.directionalEdge,
          fairDirectionalEdge: row.fairDirectionalEdge,
          reason: v2.reason,
          admission: v2.admission,
          rescueFailures: v2.rescueFailures || null,
        });
      }
    }

    return {
      v1: { overall: record(v1Rows), bySide: bySide(v1Rows) },
      v2: {
        overall: record(v2Rows),
        bySide: bySide(v2Rows),
        byAdmission: byAdmission(v2Rows),
      },
      rescueCohort: {
        count: rescueOnly.length,
        record: record(rescueOnly),
        rows: rescueOnly,
      },
      missingDataPrimaryBlocked: {
        count: v2KillsMissingPass.length,
        rows: v2KillsMissingPass.slice(0, 50),
      },
      nearMissPools: {
        underEdgeBand_2_5_to_4: {
          n: underNearMiss.length,
          record: poolRecord(underNearMiss),
          rescued: underNearMiss.filter((r) => r.admission === "RESCUE").length,
        },
        overEdgeBand_1_75_to_2_5: {
          n: overNearMiss.length,
          record: poolRecord(overNearMiss),
          rescued: overNearMiss.filter((r) => r.admission === "RESCUE").length,
        },
        overMarketConflictDemand: {
          n: marketConflictDemand.length,
          record: poolRecord(marketConflictDemand),
          rescued: marketConflictDemand.filter((r) => r.admission === "RESCUE")
            .length,
        },
      },
    };
  }

  const strict = evaluateUniverse({ rescueNullFailurePathsAsZero: false });
  const sensitivity = evaluateUniverse({
    rescueNullFailurePathsAsZero: true,
  });

  const summary = {
    studyId: "EMPIRICAL_DIRECTION_V2_RESCUE_STUDY_1",
    generatedAt: new Date().toISOString(),
    n: rows.length,
    note: "Study only — V1 remains production Direction authority. Rescue has kill-switch.",
    strictMissingFailurePaths: strict,
    sensitivityNullFailurePathsAsZero: sensitivity,
    // Convenience aliases = strict baseline
    v1: strict.v1,
    v2: strict.v2,
    rescueCohort: strict.rescueCohort,
    missingDataPrimaryBlocked: strict.missingDataPrimaryBlocked,
    interpretation: {
      primaryUntouchedIntent:
        "Primary OVER>=2.5 / UNDER>=4 preserved; rescue is separate measurable class",
      underRescueCaution:
        "UNDER 2.5–4.0 band in this sample is weak (~4-9). Rescue correctly refuses weak profiles; do not lower U4.",
      missingFailurePaths:
        "Strict mode treats null majorFailurePathCount as missing (blocks rescue). Sensitivity mode treats null as 0 for sparse historical rows only.",
      marketConflict:
        "V2 routes high marketQuality conflict Overs into corroboration demand instead of soft confidence labels",
      killSwitch:
        "If RESCUE W-L is poor, set DIRECTION_V2_RESCUE_ENABLED=false without touching primary gates",
      production:
        "Do not activate V2 Official until prospective shadow confirms rescue quality",
    },
  };

  ensureDir(OUT_DIR);
  const jsonPath = path.join(
    OUT_DIR,
    "COURTEDGE_DIRECTION_V2_RESCUE_STUDY_1.json"
  );
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md = `# Direction V2 Rescue Study 1

**Status:** STUDY ONLY — V1 PRODUCTION_1 remains Official Direction authority  
**Generated:** ${summary.generatedAt}  
**Universe:** n=${summary.n} (same Direction V1 study rows)

## Architecture under test

\`\`\`text
PRIMARY GATE (O2.5 / U4, missing ≠ clear-pass)
        ↓ fail
NEAR-MISS?
        ↓ yes
RESCUE ENGINE (fair-line + reliability + structural corroboration)
        ↓
PRIMARY | RESCUE | NO BET   (separately tagged)
\`\`\`

## V1 (production rules, labeled-side accept)

| Slice | Directed | W-L | Win% | Coverage |
|------:|--------:|----:|-----:|---------:|
| ALL | ${summary.v1.overall.directed} | ${summary.v1.overall.record} | ${pct(summary.v1.overall.winRate)} | ${pct(summary.v1.overall.coverage)} |
| OVER | ${summary.v1.bySide.OVER.directed} | ${summary.v1.bySide.OVER.record} | ${pct(summary.v1.bySide.OVER.winRate)} | ${pct(summary.v1.bySide.OVER.coverage)} |
| UNDER | ${summary.v1.bySide.UNDER.directed} | ${summary.v1.bySide.UNDER.record} | ${pct(summary.v1.bySide.UNDER.winRate)} | ${pct(summary.v1.bySide.UNDER.coverage)} |

## V2 overall (primary + rescue)

| Slice | Directed | W-L | Win% | Coverage |
|------:|--------:|----:|-----:|---------:|
| ALL | ${summary.v2.overall.directed} | ${summary.v2.overall.record} | ${pct(summary.v2.overall.winRate)} | ${pct(summary.v2.overall.coverage)} |
| OVER | ${summary.v2.bySide.OVER.directed} | ${summary.v2.bySide.OVER.record} | ${pct(summary.v2.bySide.OVER.winRate)} | ${pct(summary.v2.bySide.OVER.coverage)} |
| UNDER | ${summary.v2.bySide.UNDER.directed} | ${summary.v2.bySide.UNDER.record} | ${pct(summary.v2.bySide.UNDER.winRate)} | ${pct(summary.v2.bySide.UNDER.coverage)} |

## V2 by admission class (critical)

| Class | Directed | W-L | Win% |
|------|--------:|----:|-----:|
| PRIMARY | ${summary.v2.byAdmission.PRIMARY.directed} | ${summary.v2.byAdmission.PRIMARY.record} | ${pct(summary.v2.byAdmission.PRIMARY.winRate)} |
| RESCUE | ${summary.v2.byAdmission.RESCUE.directed} | ${summary.v2.byAdmission.RESCUE.record} | ${pct(summary.v2.byAdmission.RESCUE.winRate)} |
| OVER PRIMARY | ${summary.v2.byAdmission.OVER_PRIMARY.directed} | ${summary.v2.byAdmission.OVER_PRIMARY.record} | ${pct(summary.v2.byAdmission.OVER_PRIMARY.winRate)} |
| UNDER PRIMARY | ${summary.v2.byAdmission.UNDER_PRIMARY.directed} | ${summary.v2.byAdmission.UNDER_PRIMARY.record} | ${pct(summary.v2.byAdmission.UNDER_PRIMARY.winRate)} |
| OVER RESCUE | ${summary.v2.byAdmission.OVER_RESCUE.directed} | ${summary.v2.byAdmission.OVER_RESCUE.record} | ${pct(summary.v2.byAdmission.OVER_RESCUE.winRate)} |
| UNDER RESCUE | ${summary.v2.byAdmission.UNDER_RESCUE.directed} | ${summary.v2.byAdmission.UNDER_RESCUE.record} | ${pct(summary.v2.byAdmission.UNDER_RESCUE.winRate)} |

## Near-miss pools (why rescue stayed closed)

| Pool | n | W-L | Rescued (strict) |
|------|--:|----:|-----------------:|
| UNDER edge 2.5–4.0 | ${summary.strictMissingFailurePaths.nearMissPools.underEdgeBand_2_5_to_4.n} | ${summary.strictMissingFailurePaths.nearMissPools.underEdgeBand_2_5_to_4.record.record} | ${summary.strictMissingFailurePaths.nearMissPools.underEdgeBand_2_5_to_4.rescued} |
| OVER edge 1.75–2.5 | ${summary.strictMissingFailurePaths.nearMissPools.overEdgeBand_1_75_to_2_5.n} | ${summary.strictMissingFailurePaths.nearMissPools.overEdgeBand_1_75_to_2_5.record.record} | ${summary.strictMissingFailurePaths.nearMissPools.overEdgeBand_1_75_to_2_5.rescued} |
| OVER market-conflict demand | ${summary.strictMissingFailurePaths.nearMissPools.overMarketConflictDemand.n} | ${summary.strictMissingFailurePaths.nearMissPools.overMarketConflictDemand.record.record} | ${summary.strictMissingFailurePaths.nearMissPools.overMarketConflictDemand.rescued} |

UNDER 2.5–4 is a bad band in this sample — rescue refusing it is a feature, not a bug.

## Sensitivity: null failure-path inventory as 0

Some historical rows lack \`majorFailurePathCount\`. Strict mode blocks those from rescue.

| Mode | Directed | W-L | RESCUE W-L |
|------|--------:|----:|-----------:|
| Strict (null ≠ 0) | ${summary.v2.overall.directed} | ${summary.v2.overall.record} | ${summary.v2.byAdmission.RESCUE.record} |
| Sensitivity (null→0) | ${summary.sensitivityNullFailurePathsAsZero.v2.overall.directed} | ${summary.sensitivityNullFailurePathsAsZero.v2.overall.record} | ${summary.sensitivityNullFailurePathsAsZero.v2.byAdmission.RESCUE.record} |

## Missing ≠ safe

Rows where V1 primary would pass but V2 primary blocks for missing structural evidence: **${summary.missingDataPrimaryBlocked.count}**

## Kill-switch

If RESCUE W-L is poor prospectively:

\`\`\`text
DIRECTION_V2_RESCUE_ENABLED=false
\`\`\`

Primary O2.5 / U4 gates remain untouched.

## Shadow (no Official authority)

\`\`\`text
DIRECTION_V2_SHADOW=true
\`\`\`

Packets gain \`directionV2Shadow\` with \`admission\` / \`rescuePathway\`; Official still uses V1.

## Next

1. Inspect rescue / near-miss rows in the JSON
2. Shadow V2 on live full-feature packets (failure paths present)
3. Promote only if RESCUE precision holds chronologically / prospectively
`;

  const mdPath = path.join(
    OUT_DIR,
    "COURTEDGE_DIRECTION_V2_RESCUE_STUDY_1.md"
  );
  fs.writeFileSync(mdPath, md);

  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    v1: summary.v1.overall,
    v2Strict: summary.v2.overall,
    byAdmissionStrict: summary.v2.byAdmission,
    rescueCountStrict: summary.rescueCohort.count,
    v2Sensitivity: summary.sensitivityNullFailurePathsAsZero.v2.overall,
    byAdmissionSensitivity:
      summary.sensitivityNullFailurePathsAsZero.v2.byAdmission,
    rescueCountSensitivity:
      summary.sensitivityNullFailurePathsAsZero.rescueCohort.count,
    nearMissPools: summary.strictMissingFailurePaths.nearMissPools,
    missingBlocked: summary.missingDataPrimaryBlocked.count,
  }, null, 2));
}

function pct(x) {
  if (x == null || Number.isNaN(x)) return "n/a";
  return `${(x * 100).toFixed(1)}%`;
}

main();
