/**
 * Historical replay (analysis only) — does NOT mutate sealed props.
 * Compares old defenseScore=50 defaults vs defense V2 / evidence packaging
 * using preserved local fixtures when present.
 *
 * Usage: node betbrain-server/scripts/replayEvidencePipelineDryRun.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCourtEdgePlayerEvidenceV1 } from "../services/courtEdgePlayerEvidenceV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const FOCUS_PLAYERS = [
  "Dominique Malonga",
  "Naz Hillmon",
  "Isabelle Harrison",
  "Kelsey Mitchell",
  "Nneka Ogwumike",
  "Rhyne Howard",
  "Breanna Stewart",
  "Kayla McBride",
  "Olivia Miles",
  "Sabrina Ionescu",
  "Veronica Burton",
];

function loadJson(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function collectPropsFromPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.trackedProps)) return payload.trackedProps;
  if (Array.isArray(payload.props)) return payload.props;
  if (Array.isArray(payload.picks)) return payload.picks;
  if (Array.isArray(payload.generatedProps)) return payload.generatedProps;
  if (Array.isArray(payload.topProps)) return payload.topProps;
  if (payload.games && Array.isArray(payload.games)) {
    return payload.games.flatMap((g) => g.props || g.picks || []);
  }
  return [];
}

function replayProp(prop = {}) {
  const oldDefense = prop.defenseResult?.defenseScore;
  const oldSource = prop.defenseResult?.source;
  const wasFakeNeutral =
    Number(oldDefense) === 50 &&
    (!prop.defenseResult?.opponentPPG ||
      oldSource === "default" ||
      prop.defenseResult?.proxyUsed === true);

  const defenseForReplay = wasFakeNeutral
    ? {
        defenseScore: null,
        status: "UNAVAILABLE",
        available: false,
        source: "unavailable",
        reasons: ["replay: prior fake-neutral/default defense withheld"],
      }
    : prop.defenseResult || {
        defenseScore: null,
        status: "UNAVAILABLE",
        available: false,
        source: "unavailable",
      };

  const evidence = buildCourtEdgePlayerEvidenceV1({
    playerName: prop.player,
    team: prop.team,
    opponent: prop.opponent,
    league: prop.league || "WNBA",
    slateDate: prop.slateDate || prop.gameDate,
    commenceTime: prop.commenceTime,
    last5: prop.last5 || prop.playerState?.last5 || [],
    seasonAverage: prop.seasonAverage ?? prop.playerState?.seasonPoints,
    matchupGames: prop.matchupGames || [],
    defenseResult: defenseForReplay,
    prop: {
      line: prop.line ?? prop.sportsbookLine,
      bookCount: prop.bookCount,
      overOdds: prop.overOdds,
      underOdds: prop.underOdds,
      consensusLine: prop.consensusLine,
      lineSpread: prop.lineSpread,
    },
    opportunity: {
      recentMinutes: prop.recentMinutes ?? prop.minutesAverage,
      recentFGA: prop.recentFGA ?? prop.fgaAverage,
      recentFTA: prop.recentFTA ?? prop.ftaAverage,
    },
    availabilityGate: prop.availabilityGate || {
      availabilitySourceStatus: "OK",
      statusLevel: "ACTIVE",
    },
    wnbaGameContext: prop.wnbaGameContext || prop.gameContext || {},
    projection: prop.projection,
    marketSnapshot: {
      openingLine: prop.openingLine,
      currentLine: prop.currentLine ?? prop.line,
    },
  });

  return {
    player: prop.player,
    slateDate: prop.slateDate || prop.gameDate || null,
    league: prop.league || "WNBA",
    oldSide: prop.side || prop.pick || null,
    oldProjection: prop.projection ?? null,
    oldConfidence: prop.confidence ?? prop.finalConfidence ?? null,
    oldRisk: prop.riskLabel || prop.trueRisk || null,
    oldDefenseScore: oldDefense ?? null,
    oldDefenseSource: oldSource || null,
    wasFakeNeutralDefense: Boolean(wasFakeNeutral),
    newDefenseScore: evidence.opponentContext.defenseScore,
    newDefenseStatus: evidence.opponentContext.defenseStatus,
    newPaceProxy: evidence.opponentContext.paceProxy,
    coveragePct: evidence.dataQuality.coveragePct,
    matchupSample: evidence.matchup.sampleSize,
    wouldMutateSealedRecord: false,
    evidenceGained: wasFakeNeutral
      ? ["honest_unavailable_defense_instead_of_fake_50"]
      : [],
    evidenceStillUnavailable: [
      !evidence.dataQuality.coverageGroups.opponentDefense && "opponentDefense",
      !evidence.dataQuality.coverageGroups.matchup && "matchup",
      evidence.opponentContext.pace == null && "official_pace",
    ].filter(Boolean),
  };
}

function main() {
  const sources = [
    { label: "audit-0716-tracked", path: ".audit-lifecycle-0716/tracked-props.json" },
    { label: "audit-0716-picks", path: ".audit-lifecycle-0716/picks.json" },
    { label: "tmp-prod-tracked", path: "../.tmp-prod-tracked-props.json" },
  ];

  const rows = [];
  for (const src of sources) {
    const payload = loadJson(src.path);
    const props = collectPropsFromPayload(payload);
    for (const prop of props) {
      if (String(prop.league || "WNBA").toUpperCase() !== "WNBA") continue;
      rows.push({ source: src.label, ...replayProp(prop) });
    }
  }

  const focus = rows.filter((r) =>
    FOCUS_PLAYERS.some((name) =>
      String(r.player || "")
        .toLowerCase()
        .includes(name.toLowerCase().split(" ").pop())
    )
  );

  const summary = {
    mode: "analysis_only",
    mutatesSealedHistory: false,
    projectionCalibrationV2Applied: false,
    totalReplayed: rows.length,
    fakeNeutralDefenseFound: rows.filter((r) => r.wasFakeNeutralDefense).length,
    focusPlayerHits: focus.length,
    focusSample: focus.slice(0, 25),
    sample: rows.slice(0, 15),
  };

  const outPath = path.join(root, ".tmp-evidence-replay-dry-run.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
