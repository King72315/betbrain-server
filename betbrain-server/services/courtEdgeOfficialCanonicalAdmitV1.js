/**
 * Ensure Home officialSelected rows exist as durable Official Results cohort
 * via canonical prediction records (no remint).
 */
import {
  getCanonicalRecordsBySlate,
  upsertCanonicalPredictionRecords,
  buildCanonicalPredictionRecord,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import { admitSealedPropsToResultsSync } from "./courtEdgeTabFlowRepairV1.js";
import { getTrackedProps } from "./trackedPropService.js";
import { getResultsPropSlateDate } from "./slateScopeService.js";

export const OFFICIAL_CANONICAL_ADMIT_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

function trackedHasCanonical(tracked = [], record = {}, slateDate = "") {
  const canonicalPropId = record.canonicalPropId || "";
  return (tracked || []).some((p) => {
    if (canonicalPropId && p.canonicalPropId === canonicalPropId) return true;
    if (getResultsPropSlateDate(p) !== slateDate) return false;
    const samePlayer =
      String(p.player || p.playerName || "").toLowerCase() ===
      String(record.playerName || "").toLowerCase();
    const sameType =
      String(p.propType || p.canonicalPropType || p.stat || "").toUpperCase() ===
      String(record.propType || "").toUpperCase();
    const sameLine = Number(p.line) === Number(record.line);
    const official =
      p.officialSelected === true ||
      p.immutableOfficial === true ||
      String(p.trackingType || "").toUpperCase() === "OFFICIAL";
    return official && samePlayer && sameType && sameLine;
  });
}

/**
 * Admit canonical OFFICIAL records for a slate into Results tracked cohort.
 */
export function admitCanonicalOfficialToResults(slateDateCt, options = {}) {
  const date = String(slateDateCt || "").slice(0, 10);
  let official = getCanonicalRecordsBySlate(date, { membership: "OFFICIAL" });

  // Optional board seed (Home display) → canonical then admit.
  if (!official.length && Array.isArray(options.homeOfficialProps)) {
    const built = [];
    for (const pick of options.homeOfficialProps) {
      const row = buildCanonicalPredictionRecord(
        {
          ...pick,
          league: pick.league || "WNBA",
          slateDate: date,
          slateDateCt: date,
          membership: "OFFICIAL",
          officialSelected: true,
          trackingType: "OFFICIAL",
        },
        { reconstructionConfidence: options.reconstructionConfidence || "RECOVERED" }
      );
      if (row.ok) built.push(row.record);
    }
    if (built.length) {
      upsertCanonicalPredictionRecords(built);
      official = built;
    }
  }

  if (!official.length) {
    return {
      ok: false,
      admitted: false,
      message: `No canonical OFFICIAL rows for ${date}`,
      build: OFFICIAL_CANONICAL_ADMIT_BUILD,
    };
  }

  const tracked = getTrackedProps();
  const already = official.filter((r) => trackedHasCanonical(tracked, r, date));
  const missing = official.filter((r) => !trackedHasCanonical(tracked, r, date));

  const admitProps = official.map((r) => ({
    player: r.playerName,
    playerName: r.playerName,
    playerId: r.playerId,
    team: r.team,
    opponent: r.opponent,
    league: r.league,
    gameId: r.gameId,
    eventId: r.gameId,
    propType: r.propType,
    canonicalPropType: r.propType,
    stat: r.stat,
    side: r.side,
    pick: r.side,
    line: r.line,
    officialLine: r.sealedLine ?? r.line,
    projection: r.projection,
    fairLine: r.fairLine,
    confidence: r.confidence,
    risk: r.risk,
    SafetyScore: r.safetyScore,
    predictedProbability: r.predictedProbability,
    engineSignals: r.engineSignals,
    decisionPacket: r.decisionPacket,
    officialSelected: true,
    immutableOfficial: true,
    canonicalPropId: r.canonicalPropId,
    officialPropId: r.officialPropId,
    trackedKey: r.trackedKey,
    slateDate: date,
    resultsSlateDate: date,
    cohortSlateDate: date,
    trackingType: "OFFICIAL",
    finalDecision: "OFFICIAL",
    homeStaged: false,
    marketHistoryIntegrity: r.marketHistoryIntegrity,
    openingLineUsable: r.openingLineUsable,
    openingLine: r.openingLineUsable ? r.openingLine : null,
    legacyOpeningLineRaw: r.legacyOpeningLineRaw,
    result: r.result,
  }));

  const admit = admitSealedPropsToResultsSync(date, admitProps, {
    reason: "CANONICAL_OFFICIAL_PRODUCT_TRUTH_ADMIT",
    serverBuild: OFFICIAL_CANONICAL_ADMIT_BUILD,
    promoteToResults: true,
  });

  return {
    ok: Boolean(admit?.ok),
    admitted: Boolean(admit?.admitted || admit?.ok),
    slateDateCt: date,
    officialCount: official.length,
    alreadyTrackedLikely: already.length,
    missingBeforeAdmit: missing.length,
    admit,
    build: OFFICIAL_CANONICAL_ADMIT_BUILD,
  };
}
