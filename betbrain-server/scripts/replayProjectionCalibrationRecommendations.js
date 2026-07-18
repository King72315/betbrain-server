/**
 * Historical replay recommendations for projection weights (analysis only).
 * Does NOT enable COURTEDGE_PROJECTION_CALIBRATION_V2.
 *
 * Usage: node betbrain-server/scripts/replayProjectionCalibrationRecommendations.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function collect(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return [
    ...(payload.trackedProps || []),
    ...(payload.props || []),
    ...(payload.picks || []),
    ...(payload.generatedProps || []),
  ];
}

function analyze(props = []) {
  const graded = props.filter(
    (p) =>
      String(p.league || "WNBA").toUpperCase() === "WNBA" &&
      (p.result === "WIN" ||
        p.result === "LOSS" ||
        p.status === "won" ||
        p.status === "lost")
  );
  const buckets = {
    seasonHeavy: { n: 0, wins: 0 },
    recentHeavy: { n: 0, wins: 0 },
    withDefense: { n: 0, wins: 0 },
    missingDefense: { n: 0, wins: 0 },
    sameTeamFlip: { n: 0, wins: 0 },
    over: { n: 0, wins: 0 },
    under: { n: 0, wins: 0 },
  };

  for (const p of graded) {
    const win =
      p.result === "WIN" || String(p.status || "").toLowerCase() === "won";
    const side = String(p.side || p.pick || "").toUpperCase().startsWith("U")
      ? "under"
      : "over";
    buckets[side].n += 1;
    if (win) buckets[side].wins += 1;

    const def =
      p.defenseResult?.status ||
      p.courtEdgePlayerEvidence?.opponentContext?.defenseStatus ||
      "";
    if (String(def).toUpperCase().startsWith("CALCULATED")) {
      buckets.withDefense.n += 1;
      if (win) buckets.withDefense.wins += 1;
    } else if (String(def).toUpperCase() === "UNAVAILABLE" || Number(p.defenseResult?.defenseScore) === 50) {
      buckets.missingDefense.n += 1;
      if (win) buckets.missingDefense.wins += 1;
    }

    if (p.sameTeamArbitrationFlip) {
      buckets.sameTeamFlip.n += 1;
      if (win) buckets.sameTeamFlip.wins += 1;
    }

    const season = Number(p.seasonAverage || 0);
    const last5 = Number(p.last5Average || p.playerState?.last5Avg || 0);
    const proj = Number(p.projection || 0);
    if (Math.abs(proj - season) <= Math.abs(proj - last5)) {
      buckets.seasonHeavy.n += 1;
      if (win) buckets.seasonHeavy.wins += 1;
    } else {
      buckets.recentHeavy.n += 1;
      if (win) buckets.recentHeavy.wins += 1;
    }
  }

  const rate = (b) =>
    b.n ? { sample: b.n, winRate: Number(((b.wins / b.n) * 100).toFixed(1)), label: b.n < 20 ? "EARLY" : b.n < 50 ? "DEVELOPING" : "USABLE" } : { sample: 0, winRate: null, label: "EARLY" };

  return {
    gradedCount: graded.length,
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, rate(v)])
    ),
  };
}

const sources = [
  ".audit-lifecycle-0716/tracked-props.json",
  "../.tmp-prod-tracked-props.json",
  "tracked-props.json",
];

let all = [];
for (const s of sources) {
  all = all.concat(collect(loadJson(s)));
}

const analysis = analyze(all);

const recommendations = {
  mode: "recommendations_only",
  projectionCalibrationV2Enabled: false,
  mutatesSealedHistory: false,
  analysis,
  recommendedWeights: {
    version: "projection-calibration-v2-candidate",
    note: "Do not enable until sample labels reach USABLE for WNBA overall.",
    components: {
      seasonBaseline: 0.22,
      last5: 0.2,
      last10: 0.12,
      roleMinutesTrend: 0.1,
      shotVolumeTrend: 0.08,
      opponentDefense: 0.1,
      matchupHistory: 0.06,
      // Avg combined game total — NOT official possessions; do not treat as true pace.
      scoringEnvironmentProxy: 0.04,
      paceProxy: 0.04, // alias for back-compat reads only
      impliedTeamTotal: 0.04,
      spreadBlowout: 0.02,
      vendorProjection: 0.02,
    },
    rules: [
      "Missing evidence groups receive zero weight; redistribute only among available groups",
      "Opponent defense uses CALCULATED games-proxy when available; UNAVAILABLE contributes 0",
      "Same-team forced Unders keep TRACK but apply policy-override confidence/risk penalty",
      "Do not let market line become circular proof of the pick",
    ],
    rollback: "Set COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED=false",
  },
};

const out = path.join(root, ".tmp-projection-calibration-recommendations.json");
fs.writeFileSync(out, JSON.stringify(recommendations, null, 2));
console.log(JSON.stringify(recommendations, null, 2));
console.log(`\nWrote ${out}`);
