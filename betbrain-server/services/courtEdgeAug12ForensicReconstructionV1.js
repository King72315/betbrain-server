/**
 * Aug 12 FORENSIC reconstruction — NO remint / NO Odds refresh.
 *
 * Reconstructs the pregame candidate universe from frozen research packets.
 * Known Official regression fixtures remain distinct ASSISTS / REBOUNDS rows.
 * Points research cohort is preserved separately and never merged into REB/AST.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildCanonicalPredictionRecord,
  upsertCanonicalPredictionRecords,
  markContaminatedMarketHistory,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import { writeCanonicalResult, gradeFromActual } from "./courtEdgeCanonicalResultTruthV1.js";
import { buildCanonicalPropId } from "./courtEdgeCanonicalPropIdV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const PACKET_DIR = path.join(
  SERVER_ROOT,
  "research",
  "empirical-safe-prop-v2",
  "frozen-research-packets"
);

export const AUG12_FORENSIC_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";
export const AUG12_SLATE = "2026-08-12";

/** Required regression fixtures — FORENSIC propType (packets lacked propType stamp). */
export const AUG12_OFFICIAL_FORENSIC_FIXTURES = Object.freeze([
  {
    playerName: "Paige Bueckers",
    playerId: null,
    team: "dallaswings",
    opponent: "torontotempo",
    propType: "ASSISTS",
    side: "UNDER",
    line: 7.5,
    gameId: "744d7516c6ce883856e697bfe904153d",
    reconstructionConfidence: "FORENSIC",
  },
  {
    playerName: "Napheesa Collier",
    playerId: null,
    team: "minnesotalynx",
    opponent: "portlandfire",
    propType: "REBOUNDS",
    side: "UNDER",
    line: 7.5,
    gameId: "62ed8d04c26de1f3164b3c15775a52e6",
    reconstructionConfidence: "FORENSIC",
    // Known legacy opening-line contamination shape (3.5 vs sealed 7.5).
    marketHistoryIntegrity: "CONTAMINATED_LEGACY_IDENTITY",
    openingLineUsable: false,
    legacyOpeningLineRaw: 3.5,
  },
]);

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pickPrimaryPacketFile() {
  // Prefer the earliest Aug12 packet that still contains Bueckers/Collier Official.
  const preferred = path.join(
    PACKET_DIR,
    "2026-08-12__2026-08-12T19-17-18-268Z__research-packets.json"
  );
  if (fs.existsSync(preferred)) return preferred;
  const latest = path.join(PACKET_DIR, "2026-08-12__LATEST.json");
  if (fs.existsSync(latest)) return latest;
  return null;
}

function normalizeSide(side = "") {
  const s = String(side || "").toUpperCase();
  if (s.startsWith("UNDER")) return "UNDER";
  if (s.startsWith("OVER")) return "OVER";
  return null;
}

function matchFixture(packet, fixture) {
  const player = String(packet.playerName || packet.player || "").toLowerCase();
  const want = String(fixture.playerName).toLowerCase();
  if (!player.includes(want.split(" ").pop())) return false;
  if (Number(packet.line) !== Number(fixture.line)) return false;
  return normalizeSide(packet.side || packet.selectedSide) === fixture.side;
}

function packetToSeed(packet, overrides = {}) {
  const side = normalizeSide(packet.side || packet.selectedSide);
  return {
    league: "WNBA",
    slateDate: AUG12_SLATE,
    slateDateCt: AUG12_SLATE,
    playerName: packet.playerName || packet.player,
    playerId: packet.playerId || null,
    team: packet.team,
    opponent: packet.opponent,
    gameId: packet.eventId || packet.gameId,
    side,
    pick: side,
    line: packet.line,
    projection: packet.projection,
    fairLine: packet.fairLine,
    predictedProbability: packet.rawWinProbability ?? packet.reliabilityProbability,
    SafetyScore: packet.SafetyScore,
    risk: packet.v2Risk || packet.c2Risk || packet.risk,
    riskScore: packet.c2RankScore,
    confidence: packet.directionConfidence ?? packet.rawWinProbability,
    officialRankScore: packet.c2RankScore,
    officialSelected: packet.officialSelected === true,
    membership: packet.officialSelected === true ? "OFFICIAL" : "RESEARCH",
    trackingType: packet.officialSelected === true ? "OFFICIAL" : "RESEARCH",
    boardCandidate: packet.boardCandidate === true,
    bookCount: packet.bookCount,
    marketQuality: packet.marketQuality,
    engineSignals: {
      version: packet.modelVersions || null,
      directionAdmission: packet.directionAdmission || null,
      failurePaths: packet.failurePaths || null,
    },
    decisionPacket: null,
    pregameTimestamp: packet.pregameTimestamp || packet.predictionCreatedAt,
    ...overrides,
  };
}

/**
 * Reconstruct Aug12 canonical cohorts without reminting predictions.
 */
export function reconstructAug12ForensicCohorts(options = {}) {
  const packetFile = options.packetFile || pickPrimaryPacketFile();
  const packetDoc = packetFile ? readJSON(packetFile, null) : null;
  const packets = Array.isArray(packetDoc?.packets) ? packetDoc.packets : [];

  const officialSeeds = [];
  const researchSeeds = [];
  const unresolved = [];

  for (const fixture of AUG12_OFFICIAL_FORENSIC_FIXTURES) {
    const packet = packets.find((p) => matchFixture(p, fixture));
    if (!packet) {
      unresolved.push({
        ...fixture,
        reason: "OFFICIAL_PACKET_ROW_MISSING",
        reconstructionConfidence: "UNRESOLVED",
      });
      // Still materialize forensic fixture so product truth exists.
      officialSeeds.push({
        ...fixture,
        league: "WNBA",
        slateDate: AUG12_SLATE,
        slateDateCt: AUG12_SLATE,
        pick: fixture.side,
        membership: "OFFICIAL",
        officialSelected: true,
        trackingType: "OFFICIAL",
        reconstructionConfidence: "FORENSIC",
      });
      continue;
    }
    officialSeeds.push(
      packetToSeed(packet, {
        ...fixture,
        membership: "OFFICIAL",
        officialSelected: true,
        trackingType: "OFFICIAL",
        reconstructionConfidence: "FORENSIC",
      })
    );
  }

  for (const packet of packets) {
    const isOfficialFixture = AUG12_OFFICIAL_FORENSIC_FIXTURES.some((f) =>
      matchFixture(packet, f)
    );
    if (isOfficialFixture) continue;

    // Packet lacked propType — Points research cohort retained as FORENSIC Points
    // unless a future CLEAN stamp exists on the packet.
    const propType = packet.propType || packet.canonicalPropType || packet.stat || "POINTS";
    researchSeeds.push(
      packetToSeed(packet, {
        propType: String(propType).toUpperCase().includes("REBOUND")
          ? "REBOUNDS"
          : String(propType).toUpperCase().includes("ASSIST")
            ? "ASSISTS"
            : "POINTS",
        membership: "RESEARCH",
        officialSelected: false,
        trackingType: "RESEARCH",
        reconstructionConfidence: packet.propType ? "RECOVERED" : "FORENSIC",
      })
    );
  }

  const builtOfficial = officialSeeds
    .map((seed) =>
      buildCanonicalPredictionRecord(seed, {
        reconstructionConfidence: seed.reconstructionConfidence || "FORENSIC",
        frozenAt: packetDoc?.frozenAt || "2026-08-12T19:17:18.269Z",
      })
    )
    .filter((b) => b.ok)
    .map((b) => b.record);

  const builtResearch = researchSeeds
    .map((seed) =>
      buildCanonicalPredictionRecord(seed, {
        reconstructionConfidence: seed.reconstructionConfidence || "FORENSIC",
        frozenAt: packetDoc?.frozenAt || "2026-08-12T19:17:18.269Z",
      })
    )
    .filter((b) => b.ok)
    .map((b) => b.record);

  if (options.persist !== false) {
    upsertCanonicalPredictionRecords([...builtOfficial, ...builtResearch], {
      reconstructionConfidence: "FORENSIC",
    });
    for (const row of builtOfficial) {
      if (row.marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY") {
        markContaminatedMarketHistory(row.canonicalPropId, row.legacyOpeningLineRaw);
      }
    }
  }

  return {
    ok: true,
    build: AUG12_FORENSIC_BUILD,
    slateDateCt: AUG12_SLATE,
    packetFile,
    packetCount: packets.length,
    official: builtOfficial,
    research: builtResearch,
    unresolved,
    officialCount: builtOfficial.length,
    researchCount: builtResearch.length,
    note:
      "Official Bueckers ASSISTS / Collier REBOUNDS are FORENSIC propType stamps; Points research cohort kept separate.",
  };
}

/**
 * Apply known/provider actuals into canonical result truth (no invention beyond provided map).
 */
export function applyAug12CanonicalGrades(actualByCanonicalOrPlayerProp = {}, options = {}) {
  const recon = options.recon || reconstructAug12ForensicCohorts({ persist: true });
  const graded = [];

  for (const row of [...recon.official, ...recon.research]) {
    const key = row.canonicalPropId;
    const alt = `${row.playerName}|${row.propType}|${row.side}|${row.line}`;
    const actual =
      actualByCanonicalOrPlayerProp[key] ??
      actualByCanonicalOrPlayerProp[alt] ??
      null;
    if (actual == null) continue;
    const g = gradeFromActual({ side: row.side, line: row.line, actual });
    const written = writeCanonicalResult(key, {
      grade: g.grade,
      actual,
      gameFinal: true,
      gradeSource: options.gradeSource || "AUG12_FORENSIC_GRADE",
      side: row.side,
      line: row.line,
    });
    graded.push(written.record || row);
  }

  return {
    ok: true,
    gradedCount: graded.length,
    graded,
    build: AUG12_FORENSIC_BUILD,
  };
}

export function assertAug12RegressionFixtures(records = []) {
  const bueckers = records.find(
    (r) =>
      /buecker/i.test(r.playerName || r.player || "") &&
      r.propType === "ASSISTS" &&
      Number(r.line) === 7.5 &&
      String(r.side).toUpperCase() === "UNDER"
  );
  const collier = records.find(
    (r) =>
      /collier/i.test(r.playerName || r.player || "") &&
      r.propType === "REBOUNDS" &&
      Number(r.line) === 7.5 &&
      String(r.side).toUpperCase() === "UNDER"
  );

  const failures = [];
  if (!bueckers) failures.push("MISSING_BUECKERS_ASSISTS_U7_5");
  if (!collier) failures.push("MISSING_COLLIER_REBOUNDS_U7_5");
  if (bueckers && /point/i.test(String(bueckers.stat || ""))) {
    failures.push("BUECKERS_STAT_POINTS_CONTAMINATION");
  }
  if (collier && /point/i.test(String(collier.stat || ""))) {
    failures.push("COLLIER_STAT_POINTS_CONTAMINATION");
  }
  if (
    collier &&
    collier.openingLineUsable !== false &&
    collier.marketHistoryIntegrity !== "CONTAMINATED_LEGACY_IDENTITY"
  ) {
    // Contaminated opening line must be unusable when present as 3.5 shape.
    if (Number(collier.legacyOpeningLineRaw) === 3.5) {
      failures.push("COLLIER_CONTAMINATED_OPENING_STILL_USABLE");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    bueckersId: bueckers?.canonicalPropId || null,
    collierId: collier?.canonicalPropId || null,
    build: AUG12_FORENSIC_BUILD,
  };
}

export function buildCanonicalPropIdForAug12Fixture(fixture) {
  return buildCanonicalPropId({
    league: "WNBA",
    slateDateCt: AUG12_SLATE,
    ...fixture,
  });
}
