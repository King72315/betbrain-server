/**
 * Full-slate Home board V1
 *
 * Ingest frozen research packets for a CT slate → canonical RESEARCH rows
 * → optional tracked RESEARCH mirrors → ESPN grade → Home displays the
 * full slate ranked safest → riskiest (decisionScoreV2).
 *
 * Does not remint markets. Does not invent Official membership for volume.
 * Home display is the full candidate slate for data collection.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildCanonicalPredictionRecord,
  upsertCanonicalPredictionRecords,
  getCanonicalRecordsBySlate,
  loadCanonicalPredictionStore,
  saveCanonicalPredictionStore,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import {
  scoreCandidateV2,
  buildDailyLearningReportV2,
  selectOfficialMembershipV2,
} from "./courtEdgeDecisionEngineV2.js";
import {
  materializeResearchTrackedPropsFromBoardCandidates,
  addTrackedProps,
} from "./trackedPropService.js";
import { hasCompleteTrustedPacketV3 } from "./courtEdgeHomeProductTruthSectionsV3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const PACKET_DIR = path.join(
  SERVER_ROOT,
  "research",
  "empirical-safe-prop-v2",
  "frozen-research-packets"
);

export const FULL_SLATE_HOME_BUILD = "courteedge-full-slate-home-v1";

function normalizeSide(side = "") {
  const s = String(side || "").toUpperCase();
  if (s.startsWith("U")) return "UNDER";
  if (s.startsWith("O")) return "OVER";
  return null;
}

function normalizePropType(raw) {
  const s = String(raw || "POINTS").toUpperCase();
  if (s.includes("ASSIST") || s === "AST") return "ASSISTS";
  if (s.includes("REBOUND") || s === "REB") return "REBOUNDS";
  return "POINTS";
}

export function resolveFrozenPacketPath(slateDateCt) {
  const latest = path.join(PACKET_DIR, `${slateDateCt}__LATEST.json`);
  if (fs.existsSync(latest)) return latest;
  if (!fs.existsSync(PACKET_DIR)) return null;
  const matches = fs
    .readdirSync(PACKET_DIR)
    .filter((f) => f.startsWith(`${slateDateCt}__`) && f.endsWith(".json"))
    .sort();
  return matches.length ? path.join(PACKET_DIR, matches[matches.length - 1]) : null;
}

export function loadFrozenPacketsForSlate(slateDateCt) {
  const file = resolveFrozenPacketPath(slateDateCt);
  if (!file) return { file: null, packets: [] };
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      file,
      packets: Array.isArray(doc.packets) ? doc.packets : [],
      meta: doc.meta || null,
      officialCount: doc.officialCount ?? null,
    };
  } catch {
    return { file, packets: [] };
  }
}

function packetToCanonicalSeed(packet, slateDateCt) {
  const side = normalizeSide(packet.side || packet.selectedSide);
  const propType = normalizePropType(
    packet.propType || packet.canonicalPropType || packet.stat || "POINTS"
  );
  let v2 = null;
  try {
    v2 = scoreCandidateV2({
      propType,
      selectedSide: side,
      line: packet.line,
      projection: packet.projection,
      rawWinProbability: packet.rawWinProbability,
      risk: packet.v2Risk || packet.c2Risk || packet.risk,
      expectedMinutes: packet.expectedMinutes,
    });
  } catch {
    v2 = null;
  }
  return {
    league: "WNBA",
    slateDate: slateDateCt,
    slateDateCt,
    playerName: packet.playerName || packet.player,
    playerId: packet.playerId || null,
    team: packet.team,
    opponent: packet.opponent,
    gameId: packet.eventId || packet.gameId,
    propType,
    side,
    pick: side,
    line: packet.line,
    projection: packet.projection,
    fairLine: packet.fairLine,
    predictedProbability: packet.rawWinProbability ?? packet.reliabilityProbability,
    modelWinProbability: v2?.modelWinProbability ?? null,
    decisionScoreV2: v2?.decisionScoreV2 ?? null,
    normalizedProjectionStrength: v2?.normalizedProjectionStrength ?? null,
    SafetyScore: packet.SafetyScore,
    risk: packet.v2Risk || packet.c2Risk || packet.risk,
    riskScore: packet.c2RankScore,
    confidence:
      v2?.modelWinProbability != null
        ? Math.round(v2.modelWinProbability * 100)
        : packet.rawWinProbability,
    officialRankScore: v2?.decisionScoreV2 ?? packet.c2RankScore,
    // Full-slate data collection: RESEARCH membership (not forced Official).
    membership: "RESEARCH",
    officialSelected: false,
    trackingType: "RESEARCH",
    boardCandidate: packet.boardCandidate !== false,
    bookCount: packet.bookCount,
    marketQuality: packet.marketQuality,
    reconstructionConfidence: "CLEAN_PROSPECTIVE",
    engineSignals: {
      version: packet.modelVersions || null,
      directionAdmission: packet.directionAdmission || null,
      fullSlateHome: FULL_SLATE_HOME_BUILD,
    },
    pregameTimestamp: packet.pregameTimestamp || packet.predictionCreatedAt,
  };
}

/**
 * Upsert all frozen packets for slate as RESEARCH canonical rows.
 */
export function ingestFullSlateToCanonical(slateDateCt, options = {}) {
  const loaded = loadFrozenPacketsForSlate(slateDateCt);
  const seeds = (loaded.packets || [])
    .map((p) => packetToCanonicalSeed(p, slateDateCt))
    .filter((s) => s.playerName && s.side && s.line != null);
  const records = seeds
    .map((s) => buildCanonicalPredictionRecord(s))
    .filter((b) => b?.ok && b.record?.canonicalPropId)
    .map((b) => b.record);
  const upserted =
    options.persist === false
      ? { count: records.length, inserted: records.length, updated: 0, skipped: 0 }
      : upsertCanonicalPredictionRecords(records);
  return {
    ok: true,
    build: FULL_SLATE_HOME_BUILD,
    slateDateCt,
    packetFile: loaded.file,
    packetCount: loaded.packets.length,
    ingested: records.length,
    upserted,
    records,
  };
}

export function materializeFullSlateTrackedResearch(slateDateCt, options = {}) {
  const loaded = loadFrozenPacketsForSlate(slateDateCt);
  const boardCandidates = (loaded.packets || []).map((p) => ({
    ...p,
    officialSelected: false,
    boardCandidate: true,
    selectedSide: normalizeSide(p.side || p.selectedSide),
    propType: normalizePropType(p.propType || p.stat || "POINTS"),
    canonicalSlateDateCT: slateDateCt,
  }));
  const tracked = materializeResearchTrackedPropsFromBoardCandidates(
    boardCandidates,
    { slateDate: slateDateCt }
  );
  return {
    ok: true,
    slateDateCt,
    trackedCount: tracked.length,
    tracked,
    packetFile: loaded.file,
  };
}

/**
 * Grade all RESEARCH (+ optionally OFFICIAL) canonical rows for a slate via ESPN.
 * Reuses Aug12 research grader without forcing Aug12 reconstruct when skipReconstruct.
 */
export async function gradeFullSlateCanonical(slateDateCt, options = {}) {
  // Persist ingest first so grader has rows.
  if (options.ingest !== false) {
    ingestFullSlateToCanonical(slateDateCt, { persist: true });
  }
  // gradeAug12ResearchCandidates always reconstructs Aug12 — call internal loop
  // by importing after patching: pass slateDateCt and use a thin wrapper that
  // grades RESEARCH for any date without Aug12 reconstruct.
  const { gradeCanonicalResearchForSlate } = await import(
    "./courtEdgeCanonicalSlateGradingV1.js"
  );
  return gradeCanonicalResearchForSlate(slateDateCt, options);
}

/**
 * Apply ONE Official/Trusted membership pass on the Full pool.
 * Does not invent volume — selectOfficialMembershipV2 quality cliff only.
 * Zero Official is valid.
 */
export function applyOfficialMembershipFromFullPool(slateDateCt, options = {}) {
  const store = loadCanonicalPredictionStore();
  const slate = String(slateDateCt || "").slice(0, 10);
  const pool = (store.records || []).filter(
    (r) => String(r.slateDateCt || "").slice(0, 10) === slate
  );
  if (!pool.length) {
    return {
      ok: true,
      slateDateCt: slate,
      officialCount: 0,
      promoted: 0,
      reason: "NO_CANONICAL_ROWS",
    };
  }

  const membership = selectOfficialMembershipV2(pool, {
    engine: options.engine,
    qualityProbFloor: options.qualityProbFloor,
    // Production Trusted requires complete packets (default).
    allowMissingEnvironmentFields: options.allowMissingEnvironmentFields === true,
  });

  const selectedIds = new Set(
    (membership.selectedPackets || []).map((p) => p.canonicalPropId).filter(Boolean)
  );
  // Fallback match when scoreCandidate clones lack canonicalPropId.
  const selectedKeys = new Set(
    (membership.selectedPackets || []).map((p) =>
      [
        String(p.playerName || p.player || "")
          .toLowerCase()
          .replace(/\s+/g, "-"),
        p.propType,
        p.line,
        String(p.selectedSide || p.side || "").toUpperCase(),
      ].join("|")
    )
  );

  let promoted = 0;
  const nextRecords = (store.records || []).map((r) => {
    if (String(r.slateDateCt || "").slice(0, 10) !== slate) return r;
    const key = [
      String(r.playerName || r.player || "")
        .toLowerCase()
        .replace(/\s+/g, "-"),
      r.propType,
      r.line,
      String(r.side || "").toUpperCase(),
    ].join("|");
    const earn =
      selectedIds.has(r.canonicalPropId) || selectedKeys.has(key);
    if (!earn) {
      // Keep RESEARCH; never demote historical OFFICIAL on other paths here.
      if (r.membership === "OFFICIAL" && options.demoteNonSelected === true) {
        return {
          ...r,
          membership: "RESEARCH",
          officialSelected: false,
          membershipQualificationStatus: "BELOW_V2_QUALITY_CLIFF",
        };
      }
      return r;
    }
    if (r.membership === "OFFICIAL" && r.officialSelected === true) return r;
    promoted += 1;
    const gate = hasCompleteTrustedPacketV3(r);
    return {
      ...r,
      membership: "OFFICIAL",
      officialSelected: true,
      membershipQualificationStatus: gate.ok
        ? "DECISION_ENGINE_V2_RANK"
        : "DECISION_ENGINE_V2_RANK_INCOMPLETE_PACKET",
      decisionScoreV2: r.decisionScoreV2,
      officialRankScore: r.officialRankScore ?? r.decisionScoreV2,
    };
  });

  saveCanonicalPredictionStore({ ...store, records: nextRecords });
  return {
    ok: true,
    slateDateCt: slate,
    officialCount: selectedIds.size || selectedKeys.size,
    promoted,
    qualityProbFloor: membership.qualityProbFloor,
    boardSizePolicy: membership.boardSizePolicy,
    decisionAuthority: membership.decisionAuthority,
  };
}

/**
 * End-to-end: ingest → Official quality pass → track → grade → learning V2.
 */
export async function bootstrapFullSlateHome(slateDateCt, options = {}) {
  const ingest = ingestFullSlateToCanonical(slateDateCt, { persist: true });
  const officialPass =
    options.applyOfficial !== false
      ? applyOfficialMembershipFromFullPool(slateDateCt, options)
      : { ok: true, skipped: true, officialCount: 0, promoted: 0 };
  const trackedMat = materializeFullSlateTrackedResearch(slateDateCt);
  let trackedAdd = null;
  if (options.persistTracked !== false && trackedMat.tracked.length) {
    trackedAdd = addTrackedProps(trackedMat.tracked, {
      preFilteredCohort: true,
      skipTopPickReferences: true,
    });
  }
  const grade = await gradeFullSlateCanonical(slateDateCt, {
    ingest: false,
    includeOfficial: options.includeOfficial !== false,
    ...options,
  });
  let learningV2 = null;
  try {
    learningV2 = buildDailyLearningReportV2(slateDateCt, { persist: true });
  } catch {
    learningV2 = null;
  }
  const ranked = getCanonicalRecordsBySlate(slateDateCt)
    .map((r) => {
      const scored = scoreCandidateV2(r);
      return {
        player: r.playerName,
        propType: r.propType,
        side: r.side,
        line: r.line,
        projection: r.projection,
        modelWinProbability: scored.modelWinProbability,
        grade: r.result?.grade || "PENDING",
        actual: r.result?.actual ?? null,
        membership: r.membership,
      };
    })
    .sort(
      (a, b) =>
        Number(b.modelWinProbability || 0) - Number(a.modelWinProbability || 0)
    );

  return {
    ok: true,
    build: FULL_SLATE_HOME_BUILD,
    slateDateCt,
    ingest,
    officialPass,
    trackedCount: trackedMat.trackedCount,
    trackedAdd,
    grade: {
      ok: grade.ok,
      gradedCount: grade.gradedCount,
      unresolvedCount: grade.unresolvedCount,
      researchCount: grade.researchCount,
    },
    rankedHomeSlate: ranked,
    learningV2: learningV2
      ? { overall: learningV2.overall, byPropType: learningV2.byPropType }
      : null,
  };
}
