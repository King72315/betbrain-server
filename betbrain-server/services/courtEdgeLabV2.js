/**
 * CourtEdge Lab V2 — authoritative consumer Lab aggregation.
 * One calculation shared by GET /courtedge/lab, report.labV2, and copy report.
 * Analysis-only: no live weight writes, no Calibration Feedback Engine, no engine reruns.
 */
import {
  LAB_V2_VERSION,
  LAB_V2_BUILD,
  LAB_V2_ENGINE_KEYS,
  LAB_V2_ENGINE_LABELS,
  CONFIDENCE_BUCKETS,
  RISK_BUCKETS,
  BANNED_LAB_LABELS,
} from "./courtEdgeLabV2Constants.js";
import {
  buildLabPropRecord,
  buildRecordStats,
  buildAllEngineScorecards,
  splitBy,
  confidenceBucketKey,
  avg,
  round,
  num,
  normalizeSide,
  isOfficialBestSixProp,
  attributeDirectional,
  attributeCalibration,
  extractEngineSignals,
  extractDecisionPacket,
  extractPregameSnapshot,
  deltaMetric,
  classifySlateInstrumentation,
  filterInstrumentedRecords,
} from "./courtEdgeLabV2Helpers.js";
import { buildHistoryThreeSlateGroupsV2 } from "./historyThreeSlateGroupsV2.js";
import { computeSlateRotation } from "./slateScopeService.js";

function filterOfficialProps(props = []) {
  return (props || []).filter(isOfficialBestSixProp);
}

function propsForSlate(trackedProps = [], slateDate) {
  return filterOfficialProps(trackedProps).filter(
    (p) => String(p.slateDate) === String(slateDate)
  );
}

function buildCurrentSlateSummary(records = [], slateDate, instrumentation = null) {
  const overall = buildRecordStats(records);
  const flags = instrumentation || classifySlateInstrumentation(
    records.map((r) => ({
      ...r,
      trackingType: "OFFICIAL",
      courtEdgeEngineSignalsV1: r.signals?.available
        ? { enabled: true, engines: r.signals.engines }
        : null,
    }))
  );
  // Prefer explicit instrumentation from raw props when provided
  const inst = instrumentation || {
    legacy: records.some((r) => r.legacy || r.uninstrumented),
    uninstrumented: records.every((r) => r.uninstrumented || !r.signals?.available),
    instrumented: records.length > 0 && records.every((r) => r.signals?.available === true),
    evidenceCoverage:
      records.length > 0
        ? round(
            (records.filter((r) => r.signals?.available === true).length / records.length) *
              100,
            1
          )
        : null,
    sixProp: records.length >= 6,
    thinOfficial: records.length > 0 && records.length < 6,
  };
  return {
    slateDate,
    leagueCoverage: [...new Set(records.map((r) => r.league).filter(Boolean))],
    ...overall,
    accuracy: overall.winRate,
    legacy: inst.legacy === true,
    uninstrumented: inst.uninstrumented === true,
    instrumented: inst.instrumented === true,
    evidenceCoverage: inst.evidenceCoverage ?? null,
    sixProp: inst.sixProp === true,
    thinOfficial: inst.thinOfficial === true,
    instrumentation: inst,
    topPickRecord: buildRecordStats(records.filter((r) => r.isTopPick)),
    overRecord: buildRecordStats(records.filter((r) => r.finalSide === "OVER")),
    underRecord: buildRecordStats(records.filter((r) => r.finalSide === "UNDER")),
    nbaRecord: buildRecordStats(records.filter((r) => r.league === "NBA")),
    wnbaRecord: buildRecordStats(records.filter((r) => r.league === "WNBA")),
  };
}

function buildBestSixResults(records = []) {
  return [...records]
    .sort((a, b) => (num(a.bestSixRank, 99) || 99) - (num(b.bestSixRank, 99) || 99))
    .map((r) => ({
      officialPropId: r.officialPropId,
      bestSixRank: r.bestSixRank,
      isTopPick: r.isTopPick,
      topPickRank: r.topPickRank,
      player: r.player,
      matchup: `${r.team || "—"} vs ${r.opponent || "—"}`,
      league: r.league,
      finalSide: r.finalSide,
      sealedLine: r.sealedLine,
      actualPoints: r.actual,
      result: r.status,
      resultMargin: r.margin,
      confidence: r.confidence,
      risk: r.risk,
      confidenceRiskSource: r.confidenceRiskSource || null,
      projection: r.projection,
      fairLine: r.fairLine,
      projectionError: r.projectionError,
      openingLine: r.openingLine,
      closingLine: r.closingLine,
      clv: r.clv,
      originalModelSide: r.organicSide,
      finalCourtEdgeSide: r.finalSide,
      sameTeamArbitration: r.forcedSameTeam
        ? {
            forced: true,
            detail: r.sameTeam || { applied: true },
          }
        : { forced: false },
      diagnosisSummary:
        r.missType ||
        r.diagnosis ||
        (r.won ? "WIN" : r.lost ? "LOSS" : r.push ? "PUSH" : "PENDING"),
      engineSignalsAvailable: r.signals?.available === true,
      legacy: r.legacy === true,
      uninstrumented: r.uninstrumented === true,
      evidenceCoverage: r.evidenceCoverage ?? null,
    }));
}

function buildPerPropPacket(rec) {
  const engines = {};
  for (const key of LAB_V2_ENGINE_KEYS) {
    const signal = rec.signals?.engines?.[key] || {
      available: false,
      unavailableReason: "not_present_on_sealed_record",
    };
    engines[key] = {
      label: LAB_V2_ENGINE_LABELS[key],
      available: signal.available === true,
      normalizedSignal: signal.normalizedSignal ?? null,
      supportedSide: (() => {
        const over = num(signal.overContribution, 0) || 0;
        const under = num(signal.underContribution, 0) || 0;
        if (over > under + 0.001) return "OVER";
        if (under > over + 0.001) return "UNDER";
        return null;
      })(),
      overContribution: signal.overContribution ?? null,
      underContribution: signal.underContribution ?? null,
      confidenceAdjustment: signal.confidenceAdjustment ?? null,
      riskAdjustment: signal.riskAdjustment ?? null,
      quality: signal.quality ?? null,
      sampleSize: signal.sampleSize ?? null,
      reason: signal.reason ?? null,
      unavailableReason:
        signal.available === true
          ? null
          : signal.unavailableReason || signal.reason || "unavailable",
      used: signal.used !== false && signal.available === true,
      suppressed: signal.suppressed === true,
      suppressionReason: signal.suppressionReason || null,
      directionalAttribution: attributeDirectional(
        signal,
        rec.finalSide,
        rec.won,
        rec.lost
      ),
      calibrationAttribution: attributeCalibration(
        signal,
        rec.won,
        rec.lost,
        rec.margin
      ),
    };
  }

  const pregame = rec.pregame || {};
  return {
    officialPropId: rec.officialPropId,
    player: rec.player,
    team: rec.team,
    opponent: rec.opponent,
    league: rec.league,
    layers: {
      freeze: {
        identity: {
          officialPropId: rec.officialPropId,
          slateDate: rec.slateDate,
          player: rec.player,
          team: rec.team,
          opponent: rec.opponent,
          league: rec.league,
        },
        side: rec.finalSide,
        sealedLine: rec.sealedLine,
        bestSixRank: rec.bestSixRank,
        topPickRank: rec.topPickRank,
        originalModelSide: rec.organicSide,
        finalSide: rec.finalSide,
        projection: rec.projection,
        fairLine: rec.fairLine,
        confidence: rec.confidence,
        risk: rec.risk,
        evidenceCoverage:
          rec.signals?.aggregation?.evidenceCoverage || rec.evidenceCoverage || null,
        buildVersion: rec.buildVersion,
        engineVersions: rec.engineVersions,
        legacy: rec.legacy === true,
        uninstrumented: rec.uninstrumented === true,
        instrumented: rec.signals?.available === true,
        confidenceRiskSource: rec.confidenceRiskSource || null,
      },
      pregameEngineEvidence: {
        signalsAvailable: rec.signals?.available === true,
        unavailableReason: rec.signals?.unavailableReason || null,
        legacy: rec.legacy === true,
        uninstrumented: rec.uninstrumented === true,
        evidenceCoverage: rec.evidenceCoverage ?? null,
        engines,
      },
      decisionPath: {
        readerOriginalSide: normalizeSide(
          rec.reader?.originalSide || rec.reader?.side || rec.organicSide
        ),
        flipFirstAction:
          rec.flipFirst?.action || rec.flipFirst?.decision || null,
        sideRescueAction:
          rec.sideRescue?.action ||
          rec.sideRescue?.terminalAction ||
          null,
        originalModelSide: rec.organicSide,
        sameTeamArbitration: {
          forced: Boolean(rec.forcedSameTeam),
          ...(rec.forcedSameTeam
            ? rec.sameTeam || {}
            : {}),
        },
        finalCourtEdgeSide: rec.finalSide,
        confidenceTrail: {
          original: num(pregame.confidence ?? rec.packet?.originalConfidence),
          final: rec.confidence,
        },
        finalConfidence: rec.confidence,
        finalRisk: rec.risk,
        deduplicatedEvidenceGroups:
          rec.signals?.aggregation?.independentEvidenceGroups ||
          rec.signals?.evidenceDeduplication?.groups ||
          null,
        suppressedDuplicateSignals:
          rec.signals?.aggregation?.suppressedDuplicateContributions ||
          rec.signals?.evidenceDeduplication?.suppressed ||
          null,
        packetVersion: rec.packet?.version || rec.packet?.schemaBuild || null,
        packetHash: rec.packet?.decisionHash || null,
        alreadyApplied: rec.packet?.alreadyApplied ?? null,
      },
      postgameTruth: {
        actualPoints: rec.actual,
        measured: {
          actualPoints: rec.actual,
          result: rec.status,
          resultMargin: rec.margin,
          projectionError: rec.projectionError,
          absProjectionError: rec.absProjectionError,
          closingLine: rec.closingLine,
          clv: rec.clv,
        },
        result: rec.status,
        resultMargin: rec.margin,
        projectionError: rec.projectionError,
        closingLine: rec.closingLine,
        clv: rec.clv,
      },
      diagnosis: {
        whatWentRight: rec.won
          ? ["Final side matched outcome", ...(rec.modulesHelped || []).slice(0, 4)]
          : (rec.modulesHelped || []).slice(0, 4),
        whatWentWrong: rec.lost
          ? [
              rec.missType || "LOSS",
              rec.missSubtype,
              ...(rec.modulesHurt || []).slice(0, 4),
            ].filter(Boolean)
          : (rec.modulesHurt || []).slice(0, 4),
        enginesHelped: rec.modulesHelped || [],
        enginesHurt: rec.modulesHurt || [],
        enginesNeutral: rec.modulesNeutral || [],
        primaryCause: rec.missType || (rec.won ? "WIN" : rec.push ? "PUSH" : null),
        secondaryCause: rec.missSubtype || null,
        counterfactual: rec.counterfactual || null,
        reviewNotes: rec.diagnosis || null,
      },
    },
  };
}

function buildDecisionPathAnalysis(records = []) {
  const readerKept = records.filter((r) => r.organicSide && r.organicSide === r.finalSide);
  const readerChanged = records.filter(
    (r) => r.organicSide && r.finalSide && r.organicSide !== r.finalSide
  );

  const flipAction = (r) =>
    String(r.flipFirst?.action || r.flipFirst?.decision || "").toUpperCase();
  const rescueAction = (r) =>
    String(r.sideRescue?.action || r.sideRescue?.terminalAction || "").toUpperCase();

  const flipFlips = records.filter((r) => flipAction(r).includes("FLIP"));
  const flipKeeps = records.filter((r) => flipAction(r).includes("KEEP"));
  const flipNone = records.filter(
    (r) =>
      flipAction(r).includes("NO_DECISIVE") ||
      flipAction(r) === "" ||
      flipAction(r).includes("NONE")
  );

  const rescueFlips = records.filter((r) => rescueAction(r).includes("FLIP"));
  const rescueKeeps = records.filter((r) => rescueAction(r).includes("KEEP"));
  const rescueNone = records.filter((r) =>
    rescueAction(r).includes("NO_DECISIVE")
  );

  const strongerOver = records.filter(
    (r) =>
      r.forcedSameTeam &&
      (r.sameTeam?.role === "stronger" ||
        r.finalSide === "OVER" ||
        r.sameTeam?.forcedSide === "OVER")
  );
  const weakerUnder = records.filter(
    (r) =>
      r.forcedSameTeam &&
      (r.sameTeam?.role === "weaker" ||
        r.finalSide === "UNDER" ||
        r.sameTeam?.forcedSide === "UNDER")
  );

  return {
    reader: {
      kept: buildRecordStats(readerKept),
      laterChanged: buildRecordStats(readerChanged),
      avgProjectionErrorKept: avg(readerKept.map((r) => r.projectionError)),
      avgProjectionErrorChanged: avg(readerChanged.map((r) => r.projectionError)),
    },
    flipFirst: {
      keep: buildRecordStats(flipKeeps),
      flip: buildRecordStats(flipFlips),
      noDecisiveChange: buildRecordStats(flipNone),
      correctFlips: flipFlips.filter((r) => r.won).length,
      incorrectFlips: flipFlips.filter((r) => r.lost).length,
      avgResultMargin: avg(flipFlips.map((r) => r.margin)),
    },
    sideRescue: {
      keep: buildRecordStats(rescueKeeps),
      flip: buildRecordStats(rescueFlips),
      noDecisiveRescue: buildRecordStats(rescueNone),
      correctRescues: rescueFlips.filter((r) => r.won).length,
      incorrectRescues: rescueFlips.filter((r) => r.lost).length,
    },
    sameTeamArbitration: {
      strongerTeammateOver: buildRecordStats(strongerOver),
      weakerForcedUnder: buildRecordStats(weakerUnder),
      combinedForced: buildRecordStats(records.filter((r) => r.forcedSameTeam)),
      organicVersusFinal: {
        organic: buildRecordStats(records.filter((r) => !r.forcedSameTeam)),
        forced: buildRecordStats(records.filter((r) => r.forcedSameTeam)),
      },
    },
    decisionPacket: {
      byOrganicSide: splitBy(records, (r) => r.organicSide),
      byFinalSide: splitBy(records, (r) => r.finalSide),
      versions: [
        ...new Set(
          records.map((r) => r.packet?.version || r.packet?.schemaBuild).filter(Boolean)
        ),
      ],
      withPacket: records.filter((r) => r.packet).length,
      withoutPacket: records.filter((r) => !r.packet).length,
    },
  };
}

function buildProjectionCalibration(records = []) {
  const buildSlice = (slice) => {
    const stats = buildRecordStats(slice);
    return {
      sample: slice.length,
      avgProjection: avg(slice.map((r) => r.projection)),
      avgActual: avg(slice.map((r) => r.actual)),
      signedProjectionError: avg(slice.map((r) => r.projectionError)),
      absoluteProjectionError: avg(slice.map((r) => r.absProjectionError)),
      fairLineError: avg(
        slice
          .filter((r) => r.fairLine != null && r.actual != null)
          .map((r) => r.actual - r.fairLine)
      ),
      projectionVsClosing: avg(
        slice
          .filter((r) => r.projection != null && r.closingLine != null)
          .map((r) => r.projection - r.closingLine)
      ),
      ...stats,
    };
  };

  return {
    overall: buildSlice(records),
    byLeague: {
      NBA: buildSlice(records.filter((r) => r.league === "NBA")),
      WNBA: buildSlice(records.filter((r) => r.league === "WNBA")),
    },
    bySide: {
      OVER: buildSlice(records.filter((r) => r.finalSide === "OVER")),
      UNDER: buildSlice(records.filter((r) => r.finalSide === "UNDER")),
    },
    byTop: {
      top: buildSlice(records.filter((r) => r.isTopPick)),
      nonTop: buildSlice(records.filter((r) => !r.isTopPick)),
    },
    bySameTeam: {
      organic: buildSlice(records.filter((r) => !r.forcedSameTeam)),
      forced: buildSlice(records.filter((r) => r.forcedSameTeam)),
    },
    byEvidence: {
      complete: buildSlice(records.filter((r) => r.signals?.available === true)),
      limited: buildSlice(records.filter((r) => r.signals?.available !== true)),
    },
  };
}

function buildConfidenceCalibration(records = []) {
  const buckets = {};
  for (const b of CONFIDENCE_BUCKETS) {
    const slice = records.filter((r) => confidenceBucketKey(r.confidence) === b.key);
    const stats = buildRecordStats(slice);
    const avgConf = avg(slice.map((r) => r.confidence));
    buckets[b.key] = {
      ...stats,
      sample: slice.length,
      avgConfidence: avgConf,
      actualWinRate: stats.winRate,
      calibrationGap:
        avgConf != null && stats.winRate != null
          ? round(avgConf - stats.winRate, 1)
          : null,
    };
  }
  return {
    buckets,
    sameTeamForced: buildRecordStats(records.filter((r) => r.forcedSameTeam)),
    organic: buildRecordStats(records.filter((r) => !r.forcedSameTeam)),
  };
}

function buildRiskCalibration(records = []) {
  const buckets = {};
  for (const risk of RISK_BUCKETS) {
    const slice = records.filter((r) => r.risk === risk);
    buckets[risk] = {
      ...buildRecordStats(slice),
      sample: slice.length,
      avgConfidence: avg(slice.map((r) => r.confidence)),
      top: buildRecordStats(slice.filter((r) => r.isTopPick)),
      nonTop: buildRecordStats(slice.filter((r) => !r.isTopPick)),
      sameTeamForced: buildRecordStats(slice.filter((r) => r.forcedSameTeam)),
    };
  }
  return { buckets };
}

function buildMarketLineAnalysis(records = []) {
  const withClv = records.filter((r) => r.clv != null);
  const favorable = withClv.filter((r) => r.clv > 0);
  const unfavorable = withClv.filter((r) => r.clv < 0);
  return {
    sample: records.length,
    avgClv: avg(records.map((r) => r.clv)),
    favorableSealedLine: buildRecordStats(favorable),
    unfavorableSealedLine: buildRecordStats(unfavorable),
    bySide: {
      OVER: buildRecordStats(records.filter((r) => r.finalSide === "OVER")),
      UNDER: buildRecordStats(records.filter((r) => r.finalSide === "UNDER")),
    },
  };
}

function buildRoleVolumeAnalysis(records = []) {
  return {
    sample: records.length,
    note: "Role/volume/distribution/volatility metrics consume sealed pregame fields when present; expansion engines scored separately.",
    engineCoverage: {
      roleVelocity: buildAllEngineScorecards(records).roleVelocity,
      distribution: buildAllEngineScorecards(records).distribution,
      volatility: buildAllEngineScorecards(records).volatility,
      teammateImpact: buildAllEngineScorecards(records).teammateImpact,
    },
  };
}

function buildOpponentGameContextAnalysis(records = []) {
  const cards = buildAllEngineScorecards(records);
  return {
    defensiveArchetype: cards.defensiveArchetype,
    pacePossession: cards.pacePossession,
    restFatigue: cards.restFatigue,
    note: "True pace and scoringEnvironmentProxy remain separate; unavailable defense is not treated as neutral 50.",
  };
}

function buildSameTeamAnalysis(records = []) {
  const forced = records.filter((r) => r.forcedSameTeam);
  return {
    sample: forced.length,
    record: buildRecordStats(forced),
    organic: buildRecordStats(records.filter((r) => !r.forcedSameTeam)),
    overForced: buildRecordStats(forced.filter((r) => r.finalSide === "OVER")),
    underForced: buildRecordStats(forced.filter((r) => r.finalSide === "UNDER")),
  };
}

function buildOutcomeDiagnosis(records = []) {
  const wins = records.filter((r) => r.won);
  const losses = records.filter((r) => r.lost);
  const missCounts = {};
  const winTypes = {};
  for (const r of losses) {
    const key = r.missType || "UNSPECIFIED_LOSS";
    missCounts[key] = (missCounts[key] || 0) + 1;
  }
  for (const r of wins) {
    const key = r.missType || "WIN";
    winTypes[key] = (winTypes[key] || 0) + 1;
  }
  return {
    wins: buildRecordStats(wins),
    losses: buildRecordStats(losses),
    missTypeCounts: missCounts,
    winTypeCounts: winTypes,
    cases: records
      .filter((r) => !r.pending)
      .map((r) => ({
        officialPropId: r.officialPropId,
        player: r.player,
        result: r.status,
        primaryCause: r.missType || (r.won ? "WIN" : null),
        secondaryCause: r.missSubtype || null,
        enginesHelped: r.modulesHelped || [],
        enginesHurt: r.modulesHurt || [],
      })),
  };
}

/**
 * Manual adjustment review only — never writes weights or creates Calibration Feedback Engine.
 */
function buildAdjustmentReview(activeBlock, previousBlock) {
  const suggestions = [];
  if (!activeBlock || !previousBlock) {
    return {
      writesLiveWeights: false,
      calibrationFeedbackEngine: false,
      suggestions: [],
      note: "Adjustment review requires an active block and a previous frozen block.",
    };
  }

  const engineKeys = LAB_V2_ENGINE_KEYS;
  for (const key of engineKeys) {
    const cur = activeBlock.engineScorecards?.[key];
    const prev = previousBlock.engineScorecards?.[key];
    if (!cur || !prev) continue;
    const dirDelta = deltaMetric(prev.directionalAccuracy, cur.directionalAccuracy);
    if (dirDelta.difference == null) continue;
    if (Math.abs(dirDelta.difference) < 5) continue;

    suggestions.push({
      league: "COMBINED",
      engine: key,
      label: LAB_V2_ENGINE_LABELS[key],
      affectedSideProfile: "directional",
      currentThreeSlateSample: cur.availableCount,
      previousThreeSlateSample: prev.availableCount,
      currentPerformance: cur.directionalAccuracy,
      previousPerformance: prev.directionalAccuracy,
      difference: dirDelta.difference,
      evidenceSupporting:
        dirDelta.difference < 0
          ? [`${key} directional accuracy declined ${dirDelta.difference}%`]
          : [`${key} directional accuracy improved +${dirDelta.difference}%`],
      evidenceAgainst: [
        "Single three-slate block is not sufficient to change production weights",
      ],
      suggestedAdjustmentType:
        dirDelta.difference < 0 ? "investigate provider quality" : "no change",
      estimatedImpact: "manual review only",
      replayRequirement: true,
      minimumAdditionalDataNeeded: "At least one more complete three-slate block",
      appliesAutomatically: false,
    });
  }

  return {
    writesLiveWeights: false,
    calibrationFeedbackEngine: false,
    suggestions,
    note: "Recommendations are for human review only. Lab does not modify live engine weights.",
  };
}

function buildRawSignalExplorer(records = [], options = {}) {
  const rows = [];
  for (const rec of records) {
    for (const key of LAB_V2_ENGINE_KEYS) {
      const signal = rec.signals?.engines?.[key] || {
        available: false,
        unavailableReason: "not_present_on_sealed_record",
      };
      rows.push({
        officialPropId: rec.officialPropId,
        slateDate: rec.slateDate,
        player: rec.player,
        team: rec.team,
        opponent: rec.opponent,
        league: rec.league,
        side: rec.finalSide,
        risk: rec.risk,
        isTopPick: rec.isTopPick,
        forcedSameTeam: rec.forcedSameTeam,
        result: rec.status,
        resultMargin: rec.margin,
        projectionError: rec.projectionError,
        engine: key,
        engineLabel: LAB_V2_ENGINE_LABELS[key],
        available: signal.available === true,
        rawValues: signal.rawValues || null,
        normalizedSignal: signal.normalizedSignal ?? null,
        quality: signal.quality ?? null,
        sampleSize: signal.sampleSize ?? null,
        overContribution: signal.overContribution ?? null,
        underContribution: signal.underContribution ?? null,
        confidenceAdjustment: signal.confidenceAdjustment ?? null,
        riskAdjustment: signal.riskAdjustment ?? null,
        used: signal.available === true && signal.suppressed !== true,
        suppressed: signal.suppressed === true,
        suppressionReason: signal.suppressionReason || null,
        unavailableReason:
          signal.available === true
            ? null
            : signal.unavailableReason || "unavailable",
      });
    }
  }

  const pageSize = options.pageSize || 100;
  const page = Math.max(1, Number(options.page || 1));
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return {
    totalRows: rows.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    rows: pageRows,
    allRows: options.includeAllRows === true ? rows : undefined,
    // Always keep small samples visible — no "needs more data" hide flag.
    hideSmallSamples: false,
  };
}

function buildAllTimeContext(allRecords = []) {
  const instrumented = filterInstrumentedRecords(allRecords);
  const byBuild = {};
  const byEvidenceSchema = {};
  const byPacketVersion = {};

  for (const rec of allRecords) {
    const buildKey = String(rec.buildVersion || rec.engineVersions?.schemaBuild || "unknown");
    if (!byBuild[buildKey]) byBuild[buildKey] = [];
    byBuild[buildKey].push(rec);

    const schemaKey = String(
      rec.engineVersions?.signals ||
        (rec.signals?.available ? "courtEdgeEngineSignalsV1" : "uninstrumented_legacy")
    );
    if (!byEvidenceSchema[schemaKey]) byEvidenceSchema[schemaKey] = [];
    byEvidenceSchema[schemaKey].push(rec);

    const packetKey = String(
      rec.engineVersions?.packet ||
        rec.packet?.version ||
        (rec.packet ? "courtEdgeDecisionPacketV1" : "no_decision_packet")
    );
    if (!byPacketVersion[packetKey]) byPacketVersion[packetKey] = [];
    byPacketVersion[packetKey].push(rec);
  }

  const summarizeCohort = (records) => ({
    ...buildRecordStats(records),
    engineScorecards: buildAllEngineScorecards(records, { instrumentedOnly: true }),
    instrumentedCount: filterInstrumentedRecords(records).length,
    legacyCount: records.filter((r) => r.legacy || r.uninstrumented).length,
  });

  return {
    ...buildRecordStats(allRecords),
    nba: buildRecordStats(allRecords.filter((r) => r.league === "NBA")),
    wnba: buildRecordStats(allRecords.filter((r) => r.league === "WNBA")),
    over: buildRecordStats(allRecords.filter((r) => r.finalSide === "OVER")),
    under: buildRecordStats(allRecords.filter((r) => r.finalSide === "UNDER")),
    risk: splitBy(allRecords, (r) => r.risk),
    confidence: buildConfidenceCalibration(allRecords).buckets,
    top: buildRecordStats(allRecords.filter((r) => r.isTopPick)),
    nonTop: buildRecordStats(allRecords.filter((r) => !r.isTopPick)),
    sameTeamForced: buildRecordStats(allRecords.filter((r) => r.forcedSameTeam)),
    // Primary engine scoreboard: instrumented sealed evidence only
    engineScorecards: buildAllEngineScorecards(instrumented, { instrumentedOnly: true }),
    engineScorecardsLegacySegregated: buildAllEngineScorecards(allRecords, {
      instrumentedOnly: false,
    }),
    instrumentedRecordCount: instrumented.length,
    legacyRecordCount: allRecords.length - instrumented.length,
    avgProjectionError: avg(allRecords.map((r) => r.projectionError)),
    avgAbsProjectionError: avg(allRecords.map((r) => r.absProjectionError)),
    avgClv: avg(allRecords.map((r) => r.clv)),
    byBuildVersion: Object.fromEntries(
      Object.entries(byBuild).map(([k, list]) => [k, summarizeCohort(list)])
    ),
    byEvidenceSchema: Object.fromEntries(
      Object.entries(byEvidenceSchema).map(([k, list]) => [k, summarizeCohort(list)])
    ),
    byDecisionPacketVersion: Object.fromEntries(
      Object.entries(byPacketVersion).map(([k, list]) => [k, summarizeCohort(list)])
    ),
  };
}

function resolveNewestCompletedOfficialSlateDate({
  slateDate,
  officialProps,
  reports,
  archives,
  currentLabSlateDate = null,
}) {
  if (slateDate) return String(slateDate);
  if (currentLabSlateDate) return String(currentLabSlateDate);

  try {
    const rotation = computeSlateRotation(reports || [], {
      archives: archives || [],
      trackedProps: officialProps || [],
    });
    if (rotation?.currentLabSlateDate) return String(rotation.currentLabSlateDate);
  } catch {
    // Fall through to prop-date max — Lab must still render.
  }

  const completedFromProps = new Map();
  for (const prop of officialProps || []) {
    const d = String(prop.slateDate || "");
    if (!d) continue;
    if (!completedFromProps.has(d)) completedFromProps.set(d, []);
    completedFromProps.get(d).push(prop);
  }
  const completedDates = [...completedFromProps.entries()]
    .filter(([, props]) => props.every((p) => ["win", "loss", "push"].includes(String(p.status || p.result || "").toLowerCase())))
    .map(([d]) => d)
    .sort();

  return completedDates.slice(-1)[0] || officialProps.map((p) => p.slateDate).filter(Boolean).sort().slice(-1)[0] || null;
}

/**
 * Build the authoritative courtEdgeLabV2 payload.
 * Does not mutate tracked props / pregameSnapshot / sealed records.
 */
export function buildCourtEdgeLabV2(options = {}) {
  const {
    slateDate = null,
    trackedProps = [],
    archives = [],
    reports = [],
    persistThreeSlate = true,
    rawPage = 1,
    rawPageSize = 100,
    includeAllRawRows = false,
    currentLabSlateDate = null,
  } = options;

  const officialProps = filterOfficialProps(trackedProps);
  const threeSlate = buildHistoryThreeSlateGroupsV2({
    archives,
    reports,
    trackedProps: officialProps,
    persist: persistThreeSlate,
  });

  // Lab defaults to newest completed official slate (rotation), not stuck on an older block date.
  const resolvedSlateDate = resolveNewestCompletedOfficialSlateDate({
    slateDate,
    officialProps,
    reports,
    archives,
    currentLabSlateDate,
  });

  const slateProps = resolvedSlateDate
    ? propsForSlate(officialProps, resolvedSlateDate)
    : [];
  const slateRecords = slateProps.map(buildLabPropRecord);
  const slateInstrumentation = classifySlateInstrumentation(slateProps);

  const activeDates = threeSlate.activeBlock?.slateDates || [];
  const activeRecords = officialProps
    .filter((p) => activeDates.includes(String(p.slateDate)))
    .map(buildLabPropRecord);
  const prevDates = threeSlate.previousBlock?.slateDates || [];
  const prevRecords = officialProps
    .filter((p) => prevDates.includes(String(p.slateDate)))
    .map(buildLabPropRecord);

  const allRecords = officialProps.map(buildLabPropRecord);

  const activeBlock = threeSlate.activeBlock;
  const previousBlock = threeSlate.previousBlock;

  // Directional/calibration scoreboards: instrumented sealed props only
  const currentEngineScorecards = buildAllEngineScorecards(slateRecords, {
    instrumentedOnly: true,
  });
  const activeEngineScorecards =
    activeBlock?.engineScorecards ||
    buildAllEngineScorecards(activeRecords, { instrumentedOnly: true });
  const previousEngineScorecards =
    previousBlock?.engineScorecards ||
    buildAllEngineScorecards(prevRecords, { instrumentedOnly: true });

  const engineScorecards = {};
  for (const key of LAB_V2_ENGINE_KEYS) {
    engineScorecards[key] = {
      label: LAB_V2_ENGINE_LABELS[key],
      currentSlate: currentEngineScorecards[key],
      activeThreeSlateBlock: activeEngineScorecards[key],
      previousThreeSlateBlock: previousEngineScorecards[key],
      instrumentedOnly: true,
      change: {
        directionalAccuracy: deltaMetric(
          previousEngineScorecards[key]?.directionalAccuracy,
          activeEngineScorecards[key]?.directionalAccuracy
        ),
        coveragePct: deltaMetric(
          previousEngineScorecards[key]?.coveragePct,
          activeEngineScorecards[key]?.coveragePct
        ),
        helped: deltaMetric(
          previousEngineScorecards[key]?.helped,
          activeEngineScorecards[key]?.helped
        ),
        hurt: deltaMetric(
          previousEngineScorecards[key]?.hurt,
          activeEngineScorecards[key]?.hurt
        ),
      },
    };
  }

  const currentSlateSummary = buildCurrentSlateSummary(
    slateRecords,
    resolvedSlateDate,
    slateInstrumentation
  );

  const labV2 = {
    version: LAB_V2_VERSION,
    generatedAt: new Date().toISOString(),
    buildVersion: LAB_V2_BUILD,
    slateDate: resolvedSlateDate,
    bannedLabels: BANNED_LAB_LABELS,
    analysisOnly: true,
    writesLiveWeights: false,
    calibrationFeedbackEngine: false,

    currentSlate: currentSlateSummary,
    activeThreeSlateBlock: activeBlock,
    previousThreeSlateBlock: previousBlock,
    threeSlateComparison: activeBlock?.comparison || previousBlock?.comparison || null,

    overallSummary: currentSlateSummary,
    officialBestSixResults: buildBestSixResults(slateRecords),
    perPropPackets: slateRecords.map(buildPerPropPacket),
    engineScorecards,
    decisionPathAnalysis: {
      currentSlate: buildDecisionPathAnalysis(slateRecords),
      activeThreeSlateBlock: buildDecisionPathAnalysis(activeRecords),
      previousThreeSlateBlock: buildDecisionPathAnalysis(prevRecords),
    },
    projectionCalibration: {
      currentSlate: buildProjectionCalibration(slateRecords),
      activeThreeSlateBlock: buildProjectionCalibration(activeRecords),
      previousThreeSlateBlock: buildProjectionCalibration(prevRecords),
    },
    confidenceCalibration: {
      currentSlate: buildConfidenceCalibration(slateRecords),
      activeThreeSlateBlock: buildConfidenceCalibration(activeRecords),
      previousThreeSlateBlock: buildConfidenceCalibration(prevRecords),
    },
    riskCalibration: {
      currentSlate: buildRiskCalibration(slateRecords),
      activeThreeSlateBlock: buildRiskCalibration(activeRecords),
      previousThreeSlateBlock: buildRiskCalibration(prevRecords),
    },
    marketLineAnalysis: {
      currentSlate: buildMarketLineAnalysis(slateRecords),
      activeThreeSlateBlock: buildMarketLineAnalysis(activeRecords),
      previousThreeSlateBlock: buildMarketLineAnalysis(prevRecords),
    },
    roleVolumeAnalysis: {
      currentSlate: buildRoleVolumeAnalysis(slateRecords),
      activeThreeSlateBlock: buildRoleVolumeAnalysis(activeRecords),
    },
    opponentGameContextAnalysis: {
      currentSlate: buildOpponentGameContextAnalysis(slateRecords),
      activeThreeSlateBlock: buildOpponentGameContextAnalysis(activeRecords),
    },
    sameTeamAnalysis: {
      currentSlate: buildSameTeamAnalysis(slateRecords),
      activeThreeSlateBlock: buildSameTeamAnalysis(activeRecords),
      previousThreeSlateBlock: buildSameTeamAnalysis(prevRecords),
    },
    outcomeDiagnosis: {
      currentSlate: buildOutcomeDiagnosis(slateRecords),
      activeThreeSlateBlock: buildOutcomeDiagnosis(activeRecords),
    },
    adjustmentReview: buildAdjustmentReview(activeBlock, previousBlock),
    rawSignalExplorer: buildRawSignalExplorer(slateRecords, {
      page: rawPage,
      pageSize: rawPageSize,
      includeAllRows: includeAllRawRows,
    }),
    allTimeContext: buildAllTimeContext(allRecords),

    threeSlateGroups: threeSlate,
    legacySlateDates: threeSlate.legacySlateDates || [],
    instrumentedLearningDates: threeSlate.instrumentedLearningDates || [],
    slateInstrumentation: threeSlate.slateInstrumentation || {
      [resolvedSlateDate]: slateInstrumentation,
    },
    meta: {
      officialPropCount: slateRecords.length,
      engineKeys: LAB_V2_ENGINE_KEYS,
      legacy: slateInstrumentation.legacy === true,
      uninstrumented: slateInstrumentation.uninstrumented === true,
      instrumented: slateInstrumentation.instrumented === true,
      evidenceCoverage: slateInstrumentation.evidenceCoverage,
      learningTrack: "instrumented-six-prop-v1",
      cacheKey: `${resolvedSlateDate || "none"}:${LAB_V2_BUILD}:${threeSlate.store?.updatedAt || ""}`,
    },
  };

  return labV2;
}

/**
 * Attach labV2 onto an existing daily slate report without mutating sealed props.
 */
export function attachLabV2ToReport(report, options = {}) {
  if (!report) return report;
  const labV2 = buildCourtEdgeLabV2({
    slateDate: report.slateDate,
    trackedProps: options.trackedProps || [],
    archives: options.archives || [],
    reports: options.reports || [report],
    persistThreeSlate: options.persistThreeSlate !== false,
  });
  return {
    ...report,
    labV2,
    labV2Version: LAB_V2_VERSION,
    labV2Build: LAB_V2_BUILD,
  };
}

/**
 * Assert Lab rebuild does not mutate a pregameSnapshot object identity/content.
 */
export function assertPregameSnapshotUnchanged(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

export {
  LAB_V2_VERSION,
  LAB_V2_BUILD,
  LAB_V2_ENGINE_KEYS,
  extractEngineSignals,
  extractDecisionPacket,
  extractPregameSnapshot,
  buildLabPropRecord,
  isOfficialBestSixProp,
};
