/**
 * Immutable prospective slate freeze for EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2.
 * Append-only. Never rewrite after outcomes.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  MEMBERSHIP_VERSION_V2,
  PATHWAY_MODEL_VERSION,
  RELIABILITY_MODEL_VERSION,
  TRUST_SCORE_VERSION,
} from "./versions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const FREEZE_DIR = path.join(
  SERVER,
  "research",
  "empirical-safe-prop-v2",
  "prospective-slate-freezes"
);

const LOCKED_HASH_FILES = [
  "engines/empiricalSafePropV2/versions.js",
  "engines/empiricalSafePropV2/reliabilityModelV2.js",
  "engines/empiricalSafePropV2/trustScoreV2.js",
  "engines/empiricalSafePropV2/safePathwayEngineV2.js",
  "engines/empiricalSafePropV2/explanationsV2.js",
  "engines/empiricalSafePropV2/slateRelativeStrengthV1.js",
  "engines/empiricalSafePropV2/researchPacketPersistenceV2.js",
  "engines/empiricalSafePropV2/index.js",
  "engines/topProps/courtEdgeFeatureFlagsV1.js",
];

export function computeCalibrationHashV2() {
  const h = crypto.createHash("sha256");
  for (const rel of LOCKED_HASH_FILES) {
    const buf = fs.readFileSync(path.join(SERVER, rel));
    h.update(rel);
    h.update("\0");
    h.update(buf);
    h.update("\0");
  }
  return h.digest("hex");
}

export function loadFrozenCalibrationManifest() {
  const p = path.join(
    SERVER,
    "research",
    "empirical-safe-prop-v2",
    "calibration-2-freeze",
    "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_FREEZE.json"
  );
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Compact immutable prop row for prospective experiment. */
export function buildProspectivePropRecordV2(prop = {}, meta = {}) {
  const side = prop.side || prop.pick || prop.selectedSide;
  const projection = prop.projection ?? prop.projectedPoints ?? null;
  const fairLine = prop.fairLine ?? null;
  const line = prop.line ?? null;
  const edge =
    prop.projectionEdge ??
    prop.edge ??
    (projection != null && line != null && String(side).toUpperCase().startsWith("OVER")
      ? projection - line
      : projection != null && line != null && String(side).toUpperCase().startsWith("UNDER")
        ? line - projection
        : null);

  return {
    player: prop.playerName || prop.player,
    game: prop.game || `${prop.team || "?"} vs ${prop.opponent || "?"}`,
    team: prop.team,
    opponent: prop.opponent,
    side,
    line,
    risk: prop.trueRisk || prop.v2Risk || prop.riskLabel || prop.risk,
    v2Risk: prop.v2Risk || prop.trueRisk || prop.riskLabel,
    v1Risk: prop.v1Risk ?? prop.riskV1Legacy?.risk ?? null,
    rawProbability: prop.rawWinProbability ?? null,
    reliability: prop.reliabilityProbability ?? null,
    trustScore: prop.trustScore ?? null,
    SafetyScore: prop.SafetyScore ?? prop.safetyScore ?? null,
    projection,
    fairLine,
    edge,
    pathway: prop.safePathway ?? null,
    pathwayEvidence: prop.pathwayEvidence ?? [],
    minutes: {
      expectedMinutes: prop.expectedMinutes ?? null,
      minutesStability: prop.minutesStabilityScore ?? null,
    },
    role: {
      roleStability: prop.roleStabilityScore ?? null,
      isStarter: prop.isStarter ?? null,
    },
    market: {
      marketQuality: prop.marketQualityScore ?? null,
      bookCount: prop.bookCount ?? null,
    },
    conflict: prop.conflictIndex ?? null,
    failurePaths: prop.failurePaths ?? [],
    majorFailurePathCount: prop.majorFailurePathCount ?? null,
    officialEligible: prop.officialEligible === true,
    membershipBand:
      (prop.trueRisk || prop.v2Risk) === "LOW"
        ? "OFFICIAL_LOW"
        : (prop.trueRisk || prop.v2Risk) === "MEDIUM"
          ? "OFFICIAL_MEDIUM"
          : "RESEARCH_HIGH",
    pregameTimestamp: prop.pregameTimestamp || meta.frozenAt || new Date().toISOString(),
    modelVersion: prop.modelVersion || EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
    calibrationHash: meta.calibrationHash || prop.calibrationHash || null,
    reliabilityModelVersion: RELIABILITY_MODEL_VERSION,
    trustModelVersion: TRUST_SCORE_VERSION,
    pathwayModelVersion: PATHWAY_MODEL_VERSION,
    membershipVersion: MEMBERSHIP_VERSION_V2,
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    // Outcomes left null at freeze — filled only by separate graded ledger, never rewrite freeze
    result: null,
    actualPoints: null,
    margin: null,
  };
}

/**
 * Write immutable prospective freeze. Does not overwrite prior stamp files.
 */
export function persistProspectiveSlateFreezeV2({
  slateDateCT,
  officialProps = [],
  researchProps = [],
  pregameGate = null,
  refresh = null,
  meta = {},
} = {}) {
  fs.mkdirSync(FREEZE_DIR, { recursive: true });
  const calibrationHash = computeCalibrationHashV2();
  const frozenAt = new Date().toISOString();
  const stamp = frozenAt.replace(/[:.]/g, "-");
  const official = (officialProps || []).map((p) =>
    buildProspectivePropRecordV2(p, { calibrationHash, frozenAt })
  );
  const research = (researchProps || []).map((p) =>
    buildProspectivePropRecordV2(p, { calibrationHash, frozenAt })
  );

  const payload = {
    freezeId: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
    build: EMPIRICAL_SAFE_PROP_V2_BUILD,
    slateDateCT,
    frozenAt,
    calibrationHash,
    immutable: true,
    noRewriteAfterOutcomes: true,
    noTuningAfterActivation: true,
    rules: {
      LOW: "Calibration 2 LOW",
      MEDIUM: "Calibration 2 MEDIUM",
      HIGH: "blocked from Official",
      noFixedSix: true,
      noMinimumBoard: true,
      noForcedSides: true,
      noTeamQuotas: true,
      sortOrder: "LOW first, MEDIUM second",
      researchTracksEverything: true,
      v1ShadowComparison: true,
    },
    pregameGate,
    refresh,
    counts: {
      official: official.length,
      officialLow: official.filter((p) => p.risk === "LOW").length,
      officialMedium: official.filter((p) => p.risk === "MEDIUM").length,
      research: research.length,
      researchHigh: research.filter((p) => p.risk === "HIGH").length,
    },
    official,
    researchUniverse: research,
    meta,
    note: "Prospective experiment freeze. One-slate W-L must not trigger retuning.",
  };

  const file = path.join(
    FREEZE_DIR,
    `${slateDateCT}__${stamp}__PROSPECTIVE_FREEZE.json`
  );
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const latest = path.join(FREEZE_DIR, `${slateDateCT}__LATEST_PROSPECTIVE.json`);
  // latest pointer OK to update; stamp file remains immutable
  fs.writeFileSync(latest, JSON.stringify(payload, null, 2));
  return { file, latest, calibrationHash, payload };
}

export { FREEZE_DIR, LOCKED_HASH_FILES };
