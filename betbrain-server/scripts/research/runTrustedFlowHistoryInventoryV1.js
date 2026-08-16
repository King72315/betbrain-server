/**
 * READ-ONLY inventory for Trusted + Product Truth flow + History recovery.
 * Does not write Product Truth / tracked / archives.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCanonicalPredictionStore } from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import {
  selectOfficialMembershipV2,
  scoreCandidateV2,
  getCachedEngine,
} from "../../services/courtEdgeDecisionEngineV2.js";
import { hasCompleteTrustedPacketV3 } from "../../services/courtEdgeHomeProductTruthSectionsV3.js";
import { getProductTruthCopyReport } from "../../services/courtEdgeProductTruthUiCutoverV1.js";
import { buildHomeProductTruthSectionsV3 } from "../../services/courtEdgeHomeProductTruthSectionsV3.js";
import { toProductTruthCard } from "../../services/courtEdgeCanonicalPredictionRecordV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const OUT = path.join(
  ROOT,
  "research/courteedge-trusted-flow-history-recovery-v1"
);

function ensure(p) {
  fs.mkdirSync(p, { recursive: true });
}
function write(rel, data) {
  ensure(OUT);
  const f = path.join(OUT, rel);
  ensure(path.dirname(f));
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  return f;
}
function exists(p) {
  return fs.existsSync(p);
}
function readJson(p, fb = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fb;
  }
}
function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

function tallyByDate(rows, dateField = "slateDateCt") {
  const m = {};
  for (const r of rows || []) {
    const d = String(r[dateField] || r.slateDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    m[d] = (m[d] || 0) + 1;
  }
  return m;
}

function wl(rows) {
  const g = (rows || []).filter((r) => {
    const x = String(r.result?.grade || r.grade || r.status || "").toUpperCase();
    return x === "WIN" || x === "LOSS" || x === "PUSH";
  });
  const W = g.filter((r) => String(r.result?.grade || r.grade || "").toUpperCase() === "WIN").length;
  const L = g.filter((r) => String(r.result?.grade || r.grade || "").toUpperCase() === "LOSS").length;
  const P = g.filter((r) => String(r.result?.grade || r.grade || "").toUpperCase() === "PUSH").length;
  return { W, L, P, n: g.length, record: `${W}-${L}${P ? `-${P}` : ""}` };
}

const store = loadCanonicalPredictionStore();
const records = store.records || [];
const byDate = {};
for (const r of records) {
  const d = String(r.slateDateCt || "").slice(0, 10);
  if (!byDate[d]) byDate[d] = [];
  byDate[d].push(r);
}

const dates = Object.keys(byDate).sort();
const canonicalSummary = dates.map((d) => {
  const rows = byDate[d];
  const official = rows.filter((r) => r.membership === "OFFICIAL");
  const research = rows.filter((r) => r.membership === "RESEARCH");
  return {
    date: d,
    n: rows.length,
    official: official.length,
    research: research.length,
    graded: wl(rows),
    officialGraded: wl(official),
    pts: rows.filter((r) => r.propType === "POINTS").length,
    reb: rows.filter((r) => r.propType === "REBOUNDS").length,
    ast: rows.filter((r) => r.propType === "ASSISTS").length,
    over: rows.filter((r) => String(r.side).toUpperCase() === "OVER").length,
    under: rows.filter((r) => String(r.side).toUpperCase() === "UNDER").length,
  };
});

const d16 = byDate["2026-08-16"] || [];
const d14 = byDate["2026-08-14"] || [];
const d13 = byDate["2026-08-13"] || [];

const cards16 = d16.map(toProductTruthCard).filter(Boolean);
const sections16 = buildHomeProductTruthSectionsV3({
  trusted: cards16.filter((c) => c.membership === "OFFICIAL"),
  full: cards16,
});

const engine = getCachedEngine();
const membership16 = selectOfficialMembershipV2(
  d16.map((r) => ({
    ...r,
    selectedSide: r.side,
    boardCandidate: true,
    rawWinProbability: r.predictedProbability,
    fairLine: r.fairLine,
    safetyScore: r.safetyScore,
    risk: r.risk,
  })),
  { engine }
);

const rejectedNear = (membership16.boardCandidates || [])
  .slice(0, 25)
  .map((p) => ({
    player: p.playerName || p.player,
    propType: p.propType,
    side: p.selectedSide || p.side,
    line: p.line,
    projection: p.projection,
    fairLine: p.fairLine,
    predictedProbability: p.predictedProbability,
    decisionScoreV2: p.decisionScoreV2,
    modelWinProbability: p.modelWinProbability,
    officialRankScore: p.officialRankScore,
    safetyScore: p.safetyScore,
    risk: p.c2Risk || p.risk,
    trustedPacketComplete: p.trustedPacketComplete,
    membershipQualificationStatus: p.membershipQualificationStatus,
    officialSelected: p.officialSelected,
    trustedAdjustedScore: p.trustedAdjustedScore,
    exposureSoftPenalty: p.exposureSoftPenalty,
    completeGate: hasCompleteTrustedPacketV3(p),
  }));

// Strongest + first rejected
const ranked = [...(membership16.boardCandidates || [])].sort(
  (a, b) => (b.decisionScoreV2 || 0) - (a.decisionScoreV2 || 0)
);
const top = ranked[0] || null;
const firstReject = ranked.find((p) => !p.officialSelected) || null;

const copyTrusted = getProductTruthCopyReport({
  slateDateCt: "2026-08-16",
  cohort: "trusted",
});
const copyFull = getProductTruthCopyReport({
  slateDateCt: "2026-08-16",
  cohort: "full",
});
const copyBest = getProductTruthCopyReport({
  slateDateCt: "2026-08-16",
  cohort: "best",
});

const tracked = readJson(path.join(ROOT, "tracked-props.json"), { props: [] });
const trackedProps = Array.isArray(tracked)
  ? tracked
  : tracked.props || tracked.trackedProps || [];
const trackedDates = tallyByDate(trackedProps, "slateDate");

const reports = readJson(path.join(ROOT, "daily-slate-reports.json"), { reports: [] });
const reportList = Array.isArray(reports) ? reports : reports.reports || [];
const reportDates = (reportList || [])
  .map((r) => String(r.slateDate || "").slice(0, 10))
  .filter(Boolean);

const archiveDir = path.join(ROOT, "history-archive");
const archiveFiles = exists(archiveDir)
  ? fs.readdirSync(archiveDir).filter((n) => n.endsWith(".json") && !n.endsWith(".bak"))
  : [];
const archiveMeta = archiveFiles.map((name) => {
  const full = readJson(path.join(archiveDir, name), {});
  const props = Array.isArray(full.props) ? full.props : [];
  return {
    file: name,
    slateDate: full.slateDate,
    phase: full.phase,
    propCount: props.length || full.propCount || 0,
    record: full.record || full.report?.record || null,
    bytes: fileSize(path.join(archiveDir, name)),
  };
});

const locked = readJson(path.join(ROOT, "locked-slates.json"), {});
const snapshotsDir = path.join(ROOT, "slate-snapshots");
const snapshotDates = exists(snapshotsDir)
  ? fs
      .readdirSync(snapshotsDir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.replace(".json", ""))
  : [];

const freeze14dir = path.join(
  ROOT,
  "research/courteedge-two-slate-deep-calibration-v1"
);
const freeze14prospective = path.join(
  ROOT,
  "research/courteedge-prospective-2026-08-14-v1"
);

const out = {
  inspectedAt: new Date().toISOString(),
  canonical: {
    path: "canonical-predictions-v1.json",
    total: records.length,
    dates: canonicalSummary,
    d16: {
      n: d16.length,
      official: d16.filter((r) => r.membership === "OFFICIAL").length,
      research: d16.filter((r) => r.membership === "RESEARCH").length,
      pts: d16.filter((r) => r.propType === "POINTS").length,
      reb: d16.filter((r) => r.propType === "REBOUNDS").length,
      ast: d16.filter((r) => r.propType === "ASSISTS").length,
      over: d16.filter((r) => String(r.side).toUpperCase() === "OVER").length,
      under: d16.filter((r) => String(r.side).toUpperCase() === "UNDER").length,
      sections: {
        trusted: sections16.trustedCount,
        best: sections16.bestAvailableCount,
        full: sections16.fullCount,
      },
      selector: {
        officialCount: membership16.officialCount,
        qualityProbFloor: membership16.qualityProbFloor,
        highPolicy: membership16.highPolicy,
        boardCandidateCount: membership16.boardCandidateCount,
      },
    },
    d14: { n: d14.length, official: d14.filter((r) => r.membership === "OFFICIAL").length, graded: wl(d14) },
    d13: { n: d13.length, official: d13.filter((r) => r.membership === "OFFICIAL").length, graded: wl(d13) },
  },
  copyN: {
    trusted: (copyTrusted.match(/^N: (\d+)/m) || [])[1] || null,
    full: (copyFull.match(/^N: (\d+)/m) || [])[1] || null,
    best: (copyBest.match(/^N: (\d+)/m) || [])[1] || null,
  },
  nearTrusted: rejectedNear,
  topCandidate: top
    ? {
        player: top.playerName || top.player,
        propType: top.propType,
        side: top.selectedSide || top.side,
        line: top.line,
        projection: top.projection,
        predictedProbability: top.predictedProbability,
        decisionScoreV2: top.decisionScoreV2,
        officialSelected: top.officialSelected,
        membershipQualificationStatus: top.membershipQualificationStatus,
        trustedPacketComplete: top.trustedPacketComplete,
        completeGate: hasCompleteTrustedPacketV3(top),
        safetyScore: top.safetyScore,
        risk: top.c2Risk || top.risk,
      }
    : null,
  firstReject: firstReject
    ? {
        player: firstReject.playerName || firstReject.player,
        propType: firstReject.propType,
        side: firstReject.selectedSide || firstReject.side,
        line: firstReject.line,
        projection: firstReject.projection,
        predictedProbability: firstReject.predictedProbability,
        decisionScoreV2: firstReject.decisionScoreV2,
        membershipQualificationStatus: firstReject.membershipQualificationStatus,
        trustedPacketComplete: firstReject.trustedPacketComplete,
        completeGate: hasCompleteTrustedPacketV3(firstReject),
        safetyScore: firstReject.safetyScore,
        risk: firstReject.c2Risk || firstReject.risk,
        qualityFloor: membership16.qualityProbFloor,
      }
    : null,
  tracked: {
    n: trackedProps.length,
    dates: trackedDates,
    d13: trackedDates["2026-08-13"] || 0,
    d14: trackedDates["2026-08-14"] || 0,
    d16: trackedDates["2026-08-16"] || 0,
  },
  reports: {
    n: reportList.length,
    dates: [...new Set(reportDates)].sort(),
    has13: reportDates.includes("2026-08-13"),
    has14: reportDates.includes("2026-08-14"),
    has16: reportDates.includes("2026-08-16"),
  },
  historyArchive: {
    dir: archiveDir,
    fileCount: archiveFiles.length,
    files: archiveMeta,
    has13: archiveMeta.some((a) => a.slateDate === "2026-08-13"),
    has14: archiveMeta.some((a) => a.slateDate === "2026-08-14"),
  },
  lockedSlatesKeys: Object.keys(locked?.slates || locked || {}).slice(0, 40),
  snapshotDates,
  research: {
    twoSlateFull50: exists(
      path.join(freeze14dir, "01-aug14-final-50/full-50-graded.json")
    ),
    twoSlateTrusted15: exists(
      path.join(freeze14dir, "01-aug14-final-50/trusted-15-graded.json")
    ),
    prospectiveDir: exists(freeze14prospective),
  },
};

write("00-inventory.json", out);
write("01-aug16-near-trusted.json", rejectedNear);
write("01-aug16-copy-trusted-head.txt", copyTrusted.slice(0, 400));

console.log(JSON.stringify({
  canonicalDates: canonicalSummary,
  d16: out.canonical.d16,
  copyN: out.copyN,
  top: out.topCandidate,
  firstReject: out.firstReject,
  tracked: out.tracked,
  reports: out.reports,
  historyArchive: {
    fileCount: archiveFiles.length,
    dates: archiveMeta.map((a) => a.slateDate),
  },
}, null, 2));
