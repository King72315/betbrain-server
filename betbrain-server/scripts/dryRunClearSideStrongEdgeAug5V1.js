/**
 * Aug 5 raw-market dry run for clear-side strong-edge membership path v1.
 * Does not rewrite sealed historical slates.
 *
 * Usage: node scripts/dryRunClearSideStrongEdgeAug5V1.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectControlledBestBoard,
  buildDualSideCandidates,
  collectSoftPenalties,
  MEMBERSHIP_EDGE_FLOOR,
  MEMBERSHIP_REJECT,
} from "../engines/topProps/controlledBestBoardV2.js";
import {
  auditBestPropScore,
  resolveProjectionSanity,
  resolveProjectionSanityLevel,
} from "../engines/topProps/bestSixSelectionIntegrityV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function loadCandidates() {
  const picksPath = path.join(ROOT, "_tmp_picks.json");
  const analysisPath = path.join(ROOT, "_analysis_wnba_20260805_empty_board.json");
  const rows = [];

  if (fs.existsSync(picksPath)) {
    const picks = JSON.parse(fs.readFileSync(picksPath, "utf8"));
    const games =
      picks.games ||
      picks.wnba?.games ||
      picks.payload?.games ||
      [];
    for (const g of games) {
      const pool = [
        ...(g.allGeneratedCandidates || []),
        ...(g.candidates || []),
        ...(g.props || []),
        ...(g.pointMarkets || []),
      ];
      for (const p of pool) {
        if (!p || typeof p !== "object") continue;
        const stat = String(p.stat || p.market || p.propType || "Points").toLowerCase();
        if (!stat.includes("point") && p.line == null) continue;
        rows.push(p);
      }
    }
    for (const key of [
      "controlledBestBoard",
      "selectedPropsTodayWNBA",
      "bestSixDisplayTodayWNBA",
      "officialMembership",
    ]) {
      for (const p of picks[key] || []) {
        if (p && typeof p === "object") rows.push(p);
      }
    }
  }

  // Analysis file is diagnostic-only (no full market rows) — keep as fallback hint.
  if (!rows.length && fs.existsSync(analysisPath)) {
    const a = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
    for (const g of a.games || []) {
      for (const key of ["bestOverAlmost", "bestUnderAlmost", "nearMisses"]) {
        const v = g[key];
        if (Array.isArray(v)) {
          for (const p of v) if (p?.player) rows.push(p);
        } else if (v?.player) rows.push(v);
      }
    }
  }

  const map = new Map();
  for (const r of rows) {
    if (!r?.player) continue;
    const key = `${String(r.player).toLowerCase()}|${r.line}|${r.team || ""}`;
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()];
}

function edgeFor(pick, side) {
  const line = num(pick.line ?? pick.selectedLine);
  const proj = num(pick.projection ?? pick.projectedPoints);
  if (line == null || proj == null) return null;
  return side === "OVER" ? proj - line : line - proj;
}

function teamOf(p) {
  return String(p.team || p.teamName || p.teamKey || "unknown");
}

const candidates = loadCandidates();
const slateDate = "2026-08-05";

const beforeSoft = { lowScore: 0, sanityWeak: 0, lastValid: 0, total: 0 };
const afterSoft = { lowScore: 0, sanityWeak: 0, lastValid: 0, total: 0 };
const onlyLegacyLastValid = [];
const realEvidenceRejects = [];
const newlyQualified = [];
const dualRows = [];

for (const pick of candidates) {
  const dated = {
    ...pick,
    slateDate,
    canonicalSlateDate: slateDate,
    commenceTime: pick.commenceTime || "2026-08-05T23:00:00Z",
    league: pick.league || "WNBA",
  };

  // BEFORE packaging (legacy questionsUsage / missing→0)
  const scoreBefore = auditBestPropScore(dated);
  const sanityBefore = resolveProjectionSanity(dated);
  // Simulate old soft: missing score treated as 0 < 50; questionsUsage → WEAK
  const oldLow =
    !scoreBefore.present ||
    (scoreBefore.scale === "ZERO_TO_HUNDRED" && scoreBefore.raw < 50) ||
    (scoreBefore.present && Number(scoreBefore.raw) === 0);
  // Old path treated missing resolveBestPropScore(0) as low — count missing as old low
  const oldLowFlag = !scoreBefore.present || scoreBefore.belowFiftyFloor;
  const oldWeak = sanityBefore.questionsUsage === true;

  for (const side of ["OVER", "UNDER"]) {
    beforeSoft.total += 1;
    if (oldLowFlag) beforeSoft.lowScore += 1;
    if (oldWeak) beforeSoft.sanityWeak += 1;

    const soft = collectSoftPenalties(dated, side);
    afterSoft.total += 1;
    if (soft.penalties.includes("LOW_BEST_PROP_SCORE")) afterSoft.lowScore += 1;
    if (soft.penalties.includes("PROJECTION_SANITY_WEAK")) afterSoft.sanityWeak += 1;
    if (soft.penaltyScore >= 28 || soft.riskBump >= 2) afterSoft.lastValid += 1;
  }

  const dual = buildDualSideCandidates(dated, { requestedSlateDate: slateDate });
  if (!dual.valid) continue;

  for (const side of ["over", "under"]) {
    const cand = dual[side];
    if (!cand) continue;
    dualRows.push({
      player: cand.player,
      team: teamOf(cand),
      side: cand.side,
      line: cand.line,
      projection: cand.projection,
      fairLine: cand.fairLine,
      edge: cand.sideEdge,
      fairSupports:
        cand.fairLine != null && cand.line != null
          ? cand.side === "OVER"
            ? cand.fairLine > cand.line
            : cand.fairLine < cand.line
          : null,
      naturalDecision: cand.naturalDecision || cand.wnbaTrackingDecision,
      scoreBefore: scoreBefore.raw,
      scoreAfterPresent: scoreBefore.present,
      scoreAudit: cand.bestPropScoreAudit,
      sanityBefore: oldWeak ? "WEAK_FLAGGED" : "OK",
      sanityAfter: cand.projectionSanityLevel,
      hardBlocks: cand.membershipRejectReasons || [],
      qualified: cand.officialMembershipEligible === true,
      tier: cand.teamSideTier,
    });

    const reasons = cand.membershipRejectReasons || [];
    const onlyLegacy =
      reasons.length === 1 && reasons[0] === MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID;
    if (onlyLegacy) onlyLegacyLastValid.push(`${cand.player} ${cand.side}`);

    if (cand.officialMembershipEligible) {
      newlyQualified.push({
        player: cand.player,
        team: teamOf(cand),
        side: cand.side,
        line: cand.line,
        edge: cand.sideEdge,
        tier: cand.teamSideTier,
      });
    } else if (reasons.length) {
      realEvidenceRejects.push({
        player: cand.player,
        side: cand.side,
        reasons,
      });
    }
  }
}

const board = selectControlledBestBoard(
  candidates.map((p) => ({
    ...p,
    slateDate,
    canonicalSlateDate: slateDate,
    commenceTime: p.commenceTime || "2026-08-05T23:00:00Z",
    league: p.league || "WNBA",
  })),
  { requestedSlateDate: slateDate }
);

const byTeam = {};
for (const row of dualRows) {
  const t = row.team;
  if (!byTeam[t]) {
    byTeam[t] = {
      team: t,
      rawPointMarkets: 0,
      overPackets: [],
      underPackets: [],
      qualified: [],
      selected: [],
      emptySlots: [],
    };
  }
  byTeam[t].rawPointMarkets += 1;
  if (row.side === "OVER") byTeam[t].overPackets.push(row);
  else byTeam[t].underPackets.push(row);
  if (row.qualified) byTeam[t].qualified.push(row);
}

for (const p of board.board || []) {
  const t = teamOf(p);
  if (!byTeam[t]) byTeam[t] = { team: t, selected: [], qualified: [], emptySlots: [] };
  byTeam[t].selected.push({
    player: p.player,
    side: p.side,
    line: p.line,
    edge: p.sideEdge ?? edgeFor(p, String(p.side || "").toUpperCase()),
  });
}

const overs = (board.board || []).filter((p) =>
  String(p.side || p.pick || "").toUpperCase().startsWith("OVER")
);
const unders = (board.board || []).filter((p) =>
  String(p.side || p.pick || "").toUpperCase().startsWith("UNDER")
);

const games = new Set(
  (board.board || []).map((p) => p.providerEventId || p.gameId || p.game)
);

const focusNames = [
  "Kelsey Plum",
  "Rhyne Howard",
  "Rae Burrell",
  "Nneka Ogwumike",
  "Natisha Hiedeman",
  "Flau'jae Johnson",
  "Flau’jae Johnson",
];

const focus = dualRows.filter((r) =>
  focusNames.some((n) => String(r.player || "").includes(n.split(" ")[0]))
);

const report = {
  build: "courteedge-clear-side-strong-edge-membership-path-v1",
  slateDate,
  candidateCount: candidates.length,
  dualSideEvaluations: dualRows.length,
  before: {
    lowBestPropScore: beforeSoft.lowScore,
    projectionSanityWeak: beforeSoft.sanityWeak,
    note: "Legacy: missing score→0 and questionsUsage→WEAK",
  },
  after: {
    lowBestPropScore: afterSoft.lowScore,
    projectionSanityWeak: afterSoft.sanityWeak,
    lastValidTierSoft: afterSoft.lastValid,
  },
  rejectedOnlyByOldLastValid: onlyLegacyLastValid.length,
  rejectedByRealEvidence: realEvidenceRejects.length,
  newlyQualifiedCount: newlyQualified.length,
  newlyQualified,
  selected: (board.board || []).map((p) => ({
    player: p.player,
    team: teamOf(p),
    side: p.side,
    line: p.line,
    edge: p.sideEdge,
    membershipQualificationStatus: p.membershipQualificationStatus,
  })),
  finalOfficialCount: (board.board || []).length,
  overCount: overs.length,
  underCount: unders.length,
  gamesRepresented: games.size,
  homeCount: (board.board || []).length,
  resultsCount: (board.officialMembership || board.selectedProps || []).length,
  focusCandidates: focus,
  teams: Object.values(byTeam),
  emptySlotAudit: board.audit || null,
  membershipEdgeFloor: MEMBERSHIP_EDGE_FLOOR,
};

const outPath = path.join(
  ROOT,
  "_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json"
);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
