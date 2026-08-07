/**
 * Persist every research market packet (including HIGH) — never counts-only again.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  RESEARCH_PACKET_PERSIST_VERSION,
} from "../empiricalSafePropV2/versions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const RESEARCH_DIR = path.join(
  SERVER_ROOT,
  "research",
  "empirical-safe-prop-v2",
  "frozen-research-packets"
);

export function ensureResearchPacketDir() {
  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  return RESEARCH_DIR;
}

export function slimForecastPacketForPersist(pkt = {}) {
  const sidePkt =
    pkt.selectedSide === "UNDER" ? pkt.underPacket : pkt.overPacket;
  const line =
    pkt.market?.consensusLine ?? sidePkt?.line ?? pkt.overPacket?.line ?? pkt.underPacket?.line;
  const projection = sidePkt?.projection ?? pkt.overPacket?.projection;
  const fairLine = sidePkt?.fairLine ?? pkt.overPacket?.fairLine;
  const v2Risk = pkt.risk?.risk ?? null;
  const v1Risk = pkt.riskV1Legacy?.risk ?? null;
  return {
    playerName: pkt.playerName || pkt.player,
    playerId: pkt.playerId || null,
    team: pkt.team,
    opponent: pkt.opponent,
    game: `${pkt.team || "?"} vs ${pkt.opponent || "?"}`,
    eventId: pkt.eventId,
    canonicalSlateDateCT: pkt.canonicalSlateDateCT,
    selectedSide: pkt.selectedSide,
    side: pkt.selectedSide,
    line,
    projection,
    fairLine,
    edge: sidePkt?.projectionEdge ?? null,
    rawWinProbability: pkt.probability?.rawWinProbability,
    SafetyScore: pkt.safety?.finalSafetyScore,
    reliabilityProbability:
      pkt.reliabilityProbability ?? pkt.risk?.reliabilityProbability,
    trustScore: pkt.trustScore ?? pkt.risk?.trustScore ?? null,
    risk: v2Risk,
    v2Risk,
    v1Risk,
    safePathway: pkt.safePathway ?? pkt.risk?.safePathway,
    pathwayEvidence: pkt.pathwayEvidence ?? pkt.risk?.pathwayEvidence ?? [],
    officialEligible: pkt.risk?.officialEligible,
    minutesStability: pkt.minutesModel?.minutesStabilityScore,
    expectedMinutes: pkt.minutesModel?.expectedMinutes,
    roleStability: pkt.roleModel?.roleStabilityScore,
    marketQuality: pkt.market?.marketQualityScore,
    bookCount: pkt.market?.bookCount,
    availabilityCertainty: pkt.availability?.availabilityCertaintyScore,
    conflictIndex: pkt.uncertainty?.conflictIndex,
    failurePaths:
      sidePkt?.failure?.failurePaths ||
      pkt.overPacket?.failure?.failurePaths ||
      [],
    majorFailurePathCount:
      sidePkt?.failure?.majorFailurePathCount ??
      pkt.overPacket?.failure?.majorFailurePathCount,
    supportingEvidenceFamilies:
      pkt.overPacket?.conflict?.supportingEvidenceFamilies ||
      pkt.underPacket?.conflict?.supportingEvidenceFamilies,
    overPacket: {
      side: "OVER",
      rawWinProbability: pkt.overPacket?.rawWinProbability,
      projectionEdge: pkt.overPacket?.projectionEdge,
      risk: pkt.overPacket?.risk?.risk,
      v1Risk: pkt.overPacket?.riskV1Legacy?.risk ?? null,
      safety: pkt.overPacket?.safety?.finalSafetyScore,
    },
    underPacket: {
      side: "UNDER",
      rawWinProbability: pkt.underPacket?.rawWinProbability,
      projectionEdge: pkt.underPacket?.projectionEdge,
      risk: pkt.underPacket?.risk?.risk,
      v1Risk: pkt.underPacket?.riskV1Legacy?.risk ?? null,
      safety: pkt.underPacket?.safety?.finalSafetyScore,
    },
    riskV1Legacy: pkt.riskV1Legacy
      ? {
          risk: pkt.riskV1Legacy.risk,
          failedLowReasons: pkt.riskV1Legacy.failedLowReasons,
          failedMediumReasons: pkt.riskV1Legacy.failedMediumReasons,
        }
      : null,
    modelVersions: {
      architectureBuild: pkt.architectureBuild || EMPIRICAL_SAFE_PROP_V2_BUILD,
      persistVersion: RESEARCH_PACKET_PERSIST_VERSION,
      productionFreeze: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    },
    pregameTimestamp: pkt.predictionCreatedAt || new Date().toISOString(),
    predictionCreatedAt: pkt.predictionCreatedAt || new Date().toISOString(),
  };
}

/**
 * Freeze all research packets for a slate (LOW/MEDIUM/HIGH).
 * Append-only: writes a dated file; does not rewrite prior freezes.
 */
export function persistResearchUniversePacketsV2({
  slateDateCT,
  packets = [],
  researchUniverse = null,
  officialProps = [],
  meta = {},
} = {}) {
  ensureResearchPacketDir();
  const date = slateDateCT || "unknown";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(
    RESEARCH_DIR,
    `${date}__${stamp}__research-packets.json`
  );
  const slim = (packets || []).map(slimForecastPacketForPersist);
  const payload = {
    version: RESEARCH_PACKET_PERSIST_VERSION,
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    slateDateCT: date,
    frozenAt: new Date().toISOString(),
    packetCount: slim.length,
    researchUniverse,
    officialCount: (officialProps || []).length,
    packets: slim,
    meta,
    note: "Immutable pregame research freeze — do not rewrite after outcomes",
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  // Also write/overwrite "latest" pointer for the slate (separate from immutable stamp)
  const latest = path.join(RESEARCH_DIR, `${date}__LATEST.json`);
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2));
  return { file, latest, packetCount: slim.length };
}
