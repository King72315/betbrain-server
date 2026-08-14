/**
 * CourtEdge 2026-08-14 Prospective Data Integrity V1
 * Protects frozen Full-stack V3 cohort. Does NOT retune predictions.
 *
 * Usage: node scripts/research/runProspective20260814DataIntegrityV1.js
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  loadCanonicalPredictionStore,
  getCanonicalRecordsBySlate,
} from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import { getHomeProductTruthBoard } from "../../services/courtEdgeProductTruthUiCutoverV1.js";
import { getProductTruthBoard } from "../../services/courtEdgeSingleProductTruthApiV1.js";
import { getTodayLocalDate } from "../../services/slateScopeService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "../..");
const OUT = path.join(
  SERVER_ROOT,
  "research",
  "courteedge-prospective-2026-08-14-v1"
);
const SLATE = "2026-08-14";
const COHORT_ID = "COURTEDGE_V3_PROSPECTIVE_COHORT_2026_08_14_01";

const EXPECTED_TRUSTED = [
  ["Bridget Carleton", "REBOUNDS", "OVER", 4.5],
  ["Natisha Hiedeman", "ASSISTS", "OVER", 4.5],
  ["Kelsey Mitchell", "POINTS", "OVER", 24.5],
  ["Aliyah Boston", "REBOUNDS", "OVER", 8.5],
  ["Aliyah Boston", "ASSISTS", "OVER", 3.5],
  ["Alanna Smith", "REBOUNDS", "OVER", 7.5],
  ["Carla Leite", "ASSISTS", "OVER", 6.5],
  ["Arike Ogunbowale", "ASSISTS", "OVER", 3.5],
  ["Lexie Hull", "REBOUNDS", "OVER", 2.5],
  ["Caitlin Clark", "ASSISTS", "OVER", 9.5],
  ["Kelsey Mitchell", "ASSISTS", "OVER", 2.5],
  ["Megan DiLeo", "REBOUNDS", "OVER", 4.5],
  ["Bridget Carleton", "POINTS", "OVER", 16.5],
  ["Natisha Hiedeman", "REBOUNDS", "OVER", 2.5],
  ["Jade Melbourne", "POINTS", "OVER", 9.5],
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function sha256(obj) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(obj))
    .digest("hex");
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sideOf(r) {
  return String(r.side || r.selectedSide || r.pick || "")
    .toUpperCase()
    .startsWith("U")
    ? "UNDER"
    : "OVER";
}

function propKey(r) {
  return [
    normName(r.player || r.playerName),
    String(r.propType || "").toUpperCase(),
    sideOf(r),
    Number(r.line),
  ].join("|");
}

function expectedKey([player, propType, side, line]) {
  return [normName(player), propType, side, Number(line)].join("|");
}

function gitHead() {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: path.join(SERVER_ROOT, ".."),
      encoding: "utf8",
    });
    return String(r.stdout || "").trim() || null;
  } catch {
    return null;
  }
}

function slimRow(r, membershipHints = {}) {
  return {
    canonicalPropId: r.canonicalPropId || null,
    slateDateCt: r.slateDateCt || SLATE,
    gameId: r.gameId || r.eventId || null,
    eventId: r.eventId || r.gameId || null,
    playerId: r.playerId || null,
    player: r.player || r.playerName || null,
    playerName: r.playerName || r.player || null,
    team: r.team || null,
    opponent: r.opponent || null,
    propType: r.propType || null,
    side: sideOf(r),
    line: r.line ?? null,
    projection: r.projection ?? null,
    fairLine: r.fairLine ?? null,
    pOver: r.pOver ?? null,
    pUnder: r.pUnder ?? null,
    predictedProbability: r.predictedProbability ?? null,
    modelWinProbability: r.modelWinProbability ?? null,
    decisionScoreV2: r.decisionScoreV2 ?? null,
    officialRankScore: r.officialRankScore ?? null,
    safetyScore: r.safetyScore ?? r.SafetyScore ?? null,
    risk: r.risk ?? r.riskV2 ?? r.c2Risk ?? null,
    signalLevel: r.signalLevel || null,
    recommendationTier: r.recommendationTier || null,
    membership: r.membership || null,
    officialSelected: r.officialSelected === true,
    fullMembership: true,
    bestAvailableMembership: membershipHints.best === true,
    trustedMembership:
      membershipHints.trusted === true ||
      r.membership === "OFFICIAL" ||
      r.officialSelected === true,
    modelVersion: r.modelVersion || r.build || null,
    serverBuild: "courteedge-grade-a-recovery-v3",
    gitCommit: gitHead(),
    mintTimestamp: r.mintedAt || r.createdAt || null,
    freezeTimestamp: r.frozenAt || null,
    providerTimestamp: r.providerTimestamp || r.marketTimestamp || null,
    grade: r.grade || r.result?.grade || "PENDING",
    actual: r.actual ?? r.result?.actual ?? null,
    gameFinal: Boolean(r.gameFinal ?? r.result?.gameFinal),
    integrityKey: propKey(r),
  };
}

function immutableFingerprint(row) {
  return {
    canonicalPropId: row.canonicalPropId,
    player: row.player || row.playerName,
    propType: row.propType,
    side: sideOf(row),
    line: row.line,
    projection: row.projection,
    fairLine: row.fairLine,
    predictedProbability: row.predictedProbability,
    modelWinProbability: row.modelWinProbability,
    decisionScoreV2: row.decisionScoreV2,
    safetyScore: row.safetyScore ?? row.SafetyScore ?? null,
    risk: row.risk ?? row.c2Risk ?? null,
    membership: row.membership,
    officialSelected: row.officialSelected === true,
  };
}

ensureDir(OUT);
const now = new Date().toISOString();
const head = gitHead();

const store = loadCanonicalPredictionStore();
const slateRows = getCanonicalRecordsBySlate(SLATE);
const home = getHomeProductTruthBoard({ todayLocalDate: SLATE });
const board = getProductTruthBoard({ slateDateCt: SLATE });

const trustedHome = home.homeTodayTrusted || home.homeTodayDisplayOfficial || [];
const bestHome = home.homeTodayBestAvailable || home.todayBestAvailable || [];
const fullHome = home.homeTodayFullPredictions || home.todayFullPredictions || [];

const officialCanon = slateRows.filter(
  (r) => r.membership === "OFFICIAL" || r.officialSelected === true
);
const researchCanon = slateRows.filter((r) => r.membership !== "OFFICIAL");

const bestKeys = new Set(bestHome.map(propKey));
const trustedKeys = new Set(trustedHome.map(propKey));

const fullSlim = slateRows.map((r) =>
  slimRow(r, {
    trusted: trustedKeys.has(propKey(r)) || r.membership === "OFFICIAL",
    best: bestKeys.has(propKey(r)),
  })
);
const trustedSlim = fullSlim.filter((r) => r.trustedMembership);
const bestSlim = fullSlim.filter((r) => r.bestAvailableMembership);

// Prefer Home membership lists if canonical Official count differs — Home is display truth for sections
const trustedFromHome = trustedHome.map((r) =>
  slimRow(r, { trusted: true, best: bestKeys.has(propKey(r)) })
);
const bestFromHome = bestHome.map((r) =>
  slimRow(r, { trusted: false, best: true })
);

const trustedExport = trustedFromHome.length === 15 ? trustedFromHome : trustedSlim;
const bestExport = bestFromHome.length === 10 ? bestFromHome : bestSlim;

writeJson(path.join(OUT, "pregame-product-truth.json"), {
  cohortId: COHORT_ID,
  exportedAt: now,
  slateDateCt: SLATE,
  serverBuild: "courteedge-grade-a-recovery-v3",
  gitCommit: head,
  homeRankAuthority: home.homeRankAuthority,
  marketBalancedWeave: home.marketBalancedWeave,
  architecture: "FULL_STACK_OK / global_quality_v3 / market_weave_OFF",
  counts: {
    trusted: trustedExport.length,
    bestAvailable: bestExport.length,
    full: fullSlim.length,
    byPropType: {
      POINTS: fullSlim.filter((r) => r.propType === "POINTS").length,
      REBOUNDS: fullSlim.filter((r) => r.propType === "REBOUNDS").length,
      ASSISTS: fullSlim.filter((r) => r.propType === "ASSISTS").length,
    },
  },
  records: fullSlim,
});
writeJson(path.join(OUT, "pregame-trusted-15.json"), {
  cohortId: COHORT_ID,
  n: trustedExport.length,
  records: trustedExport,
});
writeJson(path.join(OUT, "pregame-best-available-10.json"), {
  cohortId: COHORT_ID,
  n: bestExport.length,
  records: bestExport,
});
writeJson(path.join(OUT, "pregame-full-50.json"), {
  cohortId: COHORT_ID,
  n: fullSlim.length,
  records: fullSlim,
});

const identityManifest = fullSlim.map((r) => ({
  integrityKey: r.integrityKey,
  canonicalPropId: r.canonicalPropId,
  player: r.player,
  propType: r.propType,
  side: r.side,
  line: r.line,
  trusted: r.trustedMembership,
  bestAvailable: r.bestAvailableMembership,
  membership: r.membership,
  immutableHash: sha256(immutableFingerprint(r)),
}));
writeJson(path.join(OUT, "pregame-identity-manifest.json"), {
  cohortId: COHORT_ID,
  n: identityManifest.length,
  rows: identityManifest,
});

const hashes = {
  cohortId: COHORT_ID,
  exportedAt: now,
  gitCommit: head,
  fullSha256: sha256(fullSlim.map(immutableFingerprint)),
  trustedSha256: sha256(trustedExport.map(immutableFingerprint)),
  bestSha256: sha256(bestExport.map(immutableFingerprint)),
  identityManifestSha256: sha256(identityManifest),
  perTrusted: trustedExport.map((r) => ({
    key: r.integrityKey,
    hash: sha256(immutableFingerprint(r)),
  })),
};
writeJson(path.join(OUT, "pregame-hashes.json"), hashes);

// --- Home display audit vs expected 15 ---
const homeTrustedKeys = new Set(trustedHome.map(propKey));
const expectedKeys = EXPECTED_TRUSTED.map(expectedKey);
const missingTrusted = expectedKeys.filter((k) => !homeTrustedKeys.has(k));
const extraTrusted = [...homeTrustedKeys].filter((k) => !expectedKeys.includes(k));

function fieldMatch(a, b, fields) {
  const diffs = [];
  for (const f of fields) {
    const av = a?.[f];
    const bv = b?.[f];
    const an = typeof av === "number" ? Number(av) : av;
    const bn = typeof bv === "number" ? Number(bv) : bv;
    if (String(an) !== String(bn) && !(an == null && bn == null)) {
      // tolerate tiny float noise on p
      if (
        ["p", "modelWinProbability", "predictedProbability", "projection", "fairLine"].includes(f) &&
        Number.isFinite(Number(an)) &&
        Number.isFinite(Number(bn)) &&
        Math.abs(Number(an) - Number(bn)) < 0.00015
      ) {
        continue;
      }
      diffs.push({ field: f, home: an, expectedOrCanon: bn });
    }
  }
  return diffs;
}

const canonByKey = new Map(slateRows.map((r) => [propKey(r), r]));
const mutated = [];
for (const h of trustedHome) {
  const c = canonByKey.get(propKey(h));
  if (!c) {
    mutated.push({ key: propKey(h), reason: "HOME_NOT_IN_CANONICAL" });
    continue;
  }
  const diffs = fieldMatch(
    {
      player: h.player || h.playerName,
      propType: h.propType,
      side: sideOf(h),
      line: h.line,
      projection: h.projection,
      fairLine: h.fairLine,
      p: h.decisionScoreV2 ?? h.modelWinProbability ?? h.predictedProbability,
      safety: h.safetyScore ?? h.SafetyScore,
      risk: typeof h.risk === "object" ? h.risk?.risk || h.c2Risk : h.risk ?? h.c2Risk,
    },
    {
      player: c.playerName || c.player,
      propType: c.propType,
      side: sideOf(c),
      line: c.line,
      projection: c.projection,
      fairLine: c.fairLine,
      p: c.decisionScoreV2 ?? c.modelWinProbability ?? c.predictedProbability,
      safety: c.safetyScore,
      risk: typeof c.risk === "object" ? c.risk?.risk || c.c2Risk : c.risk ?? c.c2Risk,
    },
    ["propType", "side", "line", "projection", "fairLine", "p", "safety", "risk"]
  );
  if (diffs.length) mutated.push({ key: propKey(h), diffs });
}

const homeDisplayAudit = {
  expectedTrusted: 15,
  displayedTrusted: trustedHome.length,
  missing: missingTrusted,
  extra: extraTrusted,
  mutated,
  expectedBest: 10,
  displayedBest: bestHome.length,
  expectedFull: 50,
  displayedFull: fullHome.length,
  fullByPropType: {
    POINTS: fullHome.filter((r) => r.propType === "POINTS").length,
    REBOUNDS: fullHome.filter((r) => r.propType === "REBOUNDS").length,
    ASSISTS: fullHome.filter((r) => r.propType === "ASSISTS").length,
  },
  marketBalancedWeave: home.marketBalancedWeave === true,
  homeRankAuthority: home.homeRankAuthority,
  pass:
    trustedHome.length === 15 &&
    missingTrusted.length === 0 &&
    extraTrusted.length === 0 &&
    mutated.length === 0 &&
    bestHome.length === 10 &&
    fullHome.length === 50 &&
    home.marketBalancedWeave === false,
};
writeJson(path.join(OUT, "home-display-audit.json"), homeDisplayAudit);

// --- Cap regression check ---
const capAudit = {
  fullTotal: fullSlim.length,
  points: fullSlim.filter((r) => r.propType === "POINTS").length,
  rebounds: fullSlim.filter((r) => r.propType === "REBOUNDS").length,
  assists: fullSlim.filter((r) => r.propType === "ASSISTS").length,
  not151515:
    !(
      fullSlim.filter((r) => r.propType === "POINTS").length === 15 &&
      fullSlim.filter((r) => r.propType === "REBOUNDS").length === 15 &&
      fullSlim.filter((r) => r.propType === "ASSISTS").length === 15
    ),
  expected: { total: 50, POINTS: 19, REBOUNDS: 17, ASSISTS: 14 },
  pass:
    fullSlim.length === 50 &&
    fullSlim.filter((r) => r.propType === "POINTS").length === 19 &&
    fullSlim.filter((r) => r.propType === "REBOUNDS").length === 17 &&
    fullSlim.filter((r) => r.propType === "ASSISTS").length === 14 &&
    home.marketBalancedWeave === false,
};
writeJson(path.join(OUT, "stat-distribution-audit.json"), capAudit);

// --- Identity traces ---
function pickTrace(pred) {
  const row = slateRows.find(pred) || fullHome.find(pred);
  if (!row) return null;
  const key = propKey(row);
  return {
    integrityKey: key,
    canonicalPropId: row.canonicalPropId || null,
    productTruth: slimRow(row),
    inHomeTrusted: trustedKeys.has(key),
    inHomeBest: bestKeys.has(key),
    inHomeFull: fullHome.some((r) => propKey(r) === key),
    inCanonical: canonByKey.has(key),
    canonicalMembership: canonByKey.get(key)?.membership || null,
  };
}

const identityIntegrity = {
  traces: {
    trustedPoints: pickTrace(
      (r) =>
        propKey(r) ===
        expectedKey(["Kelsey Mitchell", "POINTS", "OVER", 24.5])
    ),
    trustedRebounds: pickTrace(
      (r) =>
        propKey(r) ===
        expectedKey(["Bridget Carleton", "REBOUNDS", "OVER", 4.5])
    ),
    trustedAssists: pickTrace(
      (r) =>
        propKey(r) ===
        expectedKey(["Natisha Hiedeman", "ASSISTS", "OVER", 4.5])
    ),
    bestAvailable: pickTrace((r) => bestKeys.has(propKey(r))),
    fullOnly: pickTrace(
      (r) => !trustedKeys.has(propKey(r)) && !bestKeys.has(propKey(r))
    ),
  },
};
writeJson(path.join(OUT, "identity-integrity.json"), identityIntegrity);

// --- Grade target preflight (lookup only, no writes) ---
const gradeTargets = {
  dryRun: true,
  note: "Lookup-only — no grades written",
  trusted: { found: 0, missing: [] },
  best: { found: 0, missing: [] },
  full: { found: 0, missing: [] },
  byPropType: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
};
for (const k of expectedKeys) {
  if (canonByKey.has(k)) gradeTargets.trusted.found += 1;
  else gradeTargets.trusted.missing.push(k);
}
for (const k of bestKeys) {
  if (canonByKey.has(k)) gradeTargets.best.found += 1;
  else gradeTargets.best.missing.push(k);
}
for (const r of slateRows) {
  if (r.canonicalPropId && r.propType && r.line != null && sideOf(r)) {
    gradeTargets.full.found += 1;
    if (gradeTargets.byPropType[r.propType] != null) {
      gradeTargets.byPropType[r.propType] += 1;
    }
  } else {
    gradeTargets.full.missing.push(propKey(r));
  }
}
gradeTargets.pass =
  gradeTargets.trusted.found === 15 &&
  gradeTargets.best.found === 10 &&
  gradeTargets.full.found === 50 &&
  gradeTargets.byPropType.POINTS === 19 &&
  gradeTargets.byPropType.REBOUNDS === 17 &&
  gradeTargets.byPropType.ASSISTS === 14;
writeJson(path.join(OUT, "grade-target-preflight.json"), gradeTargets);

// --- EPERM test ---
const eperm = spawnSync(
  process.execPath,
  [path.join(SERVER_ROOT, "scripts/testCanonicalEpermAtomicWriteV1.js")],
  { encoding: "utf8", cwd: SERVER_ROOT }
);
const epremStatus = {
  exitCode: eperm.status,
  pass: eperm.status === 0,
  stdoutTail: String(eperm.stdout || "").slice(-500),
  stderrTail: String(eperm.stderr || "").slice(-300),
};
writeJson(path.join(OUT, "eprem-test.json"), epremStatus);

// --- Pre-grade backup (copy durable files) ---
const backupDir = path.join(OUT, "pre-grade-backup");
ensureDir(backupDir);
const backupFiles = [
  "canonical-predictions-v1.json",
  "tracked-props.json",
  "line-snapshots.json",
  "locked-slates.json",
  "daily-slate-reports.json",
];
const backupReport = { copied: [], missing: [], at: now };
for (const f of backupFiles) {
  const src = path.join(SERVER_ROOT, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(backupDir, f));
    backupReport.copied.push(f);
  } else {
    backupReport.missing.push(f);
  }
}
// also snapshot product truth export
fs.copyFileSync(
  path.join(OUT, "pregame-product-truth.json"),
  path.join(backupDir, "pregame-product-truth.json")
);
backupReport.copied.push("pregame-product-truth.json");
writeJson(path.join(backupDir, "backup-manifest.json"), backupReport);

// --- Game final status (no grading writes) ---
const pendingN = slateRows.filter(
  (r) => String(r.result?.grade || r.grade || "PENDING").toUpperCase() === "PENDING"
).length;
const finalsN = slateRows.filter((r) => r.result?.gameFinal === true).length;

const gradingStatus = {
  gamesFinalObserved: finalsN > 0 && pendingN === 0,
  pendingCount: pendingN,
  finalCount: finalsN,
  action:
    pendingN === 50
      ? "GRADING_DEFERRED_AWAIT_FINALS — all 50 PENDING; dry-run only"
      : pendingN > 0
        ? "PARTIAL_PENDING — do not remint; grade remaining when FINAL"
        : "READY_OR_COMPLETE",
};

// --- Summary markdown ---
const summaryMd = `# CourtEdge Prospective 2026-08-14 Pregame Freeze

- Cohort: \`${COHORT_ID}\`
- Exported: ${now}
- Git: ${head}
- Architecture: FULL_STACK_OK / global_quality_v3 / market_weave_OFF

## Counts
| Lane | N |
|------|--:|
| Trusted | ${trustedExport.length} |
| Best Available | ${bestExport.length} |
| Full | ${fullSlim.length} |
| POINTS | ${capAudit.points} |
| REBOUNDS | ${capAudit.rebounds} |
| ASSISTS | ${capAudit.assists} |

## Audits
- Home display: ${homeDisplayAudit.pass ? "PASS" : "FAIL"}
- Cap/distribution: ${capAudit.pass ? "PASS" : "FAIL"}
- Grade targets: ${gradeTargets.pass ? "PASS" : "FAIL"}
- EPERM: ${epremStatus.pass ? "PASS" : "FAIL"}
- Grading: ${gradingStatus.action}

## Rule
Immutable pregame prediction fields must not change after this export.
`;
fs.writeFileSync(path.join(OUT, "pregame-summary.md"), summaryMd);

const report = {
  cohortId: COHORT_ID,
  exportedAt: now,
  gitCommit: head,
  homeDisplayAudit,
  capAudit,
  gradeTargets,
  epremStatus,
  gradingStatus,
  backupReport,
  trustedN: trustedExport.length,
  bestN: bestExport.length,
  fullN: fullSlim.length,
};
writeJson(path.join(OUT, "pregame-integrity-run.json"), report);
console.log(JSON.stringify(report, null, 2));
