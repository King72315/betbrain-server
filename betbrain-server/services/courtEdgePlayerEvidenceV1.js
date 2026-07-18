/**
 * CourtEdge Player Evidence Bundle V1
 * Versioned snapshot attached at generation/selection time and preserved on seal.
 */

export const COURTEDGE_PLAYER_EVIDENCE_VERSION = "courtEdgePlayerEvidenceV1";

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function qualityBlock({
  available = false,
  provider = null,
  fetchedAt = null,
  sampleSize = 0,
  quality = "UNAVAILABLE",
  stale = false,
  error = null,
  fallbackUsed = false,
  confidenceEligible = false,
} = {}) {
  return {
    available: Boolean(available),
    provider,
    fetchedAt: fetchedAt || null,
    sampleSize: num(sampleSize, 0) || 0,
    quality,
    stale: Boolean(stale),
    error: error || null,
    fallbackUsed: Boolean(fallbackUsed),
    confidenceEligible: Boolean(confidenceEligible),
  };
}

function ptsList(games = []) {
  return (games || [])
    .map((g) => num(g.points ?? g.pts))
    .filter((v) => v !== null);
}

function avg(values = []) {
  if (!values.length) return null;
  return Number(
    (values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)
  );
}

function median(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
  return sorted[mid];
}

function stdev(values = []) {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Number(Math.sqrt(variance).toFixed(2));
}

function hitRate(values = [], line = null) {
  const L = num(line);
  if (L === null || !values.length) return null;
  const hits = values.filter((v) => v > L).length;
  return Number((hits / values.length).toFixed(3));
}

/**
 * Build evidence from the generation context already present on a pick/card.
 * Does not invent provider rows — only packages verified inputs.
 */
export function buildCourtEdgePlayerEvidenceV1(ctx = {}) {
  const last5 = ctx.last5 || ctx.playerState?.last5 || [];
  const seasonGames = ctx.bdlSeasonGames || ctx.seasonGames || [];
  const matchupGames = ctx.matchupGames || [];
  const defense = ctx.defenseResult || {};
  const gameCtx = ctx.wnbaGameContext || ctx.gameContext || {};
  const prop = ctx.prop || {};
  const opportunity = ctx.opportunity || {};
  const availability = ctx.availabilityGate || {};
  const identity = ctx.identity || {};
  const marketSnapshot = ctx.marketSnapshot || {};
  const projectionResult = ctx.projectionResult || ctx.projection || {};
  const line = num(ctx.line ?? prop.line);
  const last5Pts = ptsList(last5);
  const last10Source = seasonGames.length
    ? seasonGames.slice(0, 10)
    : last5;
  const last10Pts = ptsList(last10Source).slice(0, 10);
  const last3Pts = last5Pts.slice(0, 3);
  const seasonPts = ptsList(seasonGames);
  const seasonAvg = num(
    ctx.seasonAverage ??
      ctx.playerState?.seasonPoints ??
      avg(seasonPts)
  );

  const defenseAvailable =
    defense.available === true &&
    defense.defenseScore !== null &&
    defense.defenseScore !== undefined &&
    defense.status !== "UNAVAILABLE";

  const matchupPts = ptsList(matchupGames);
  const matchupAvailable = matchupGames.length > 0;

  const coverageGroups = {
    identity: Boolean(identity.canonicalPlayerId || ctx.playerName || ctx.player),
    recentForm: last5Pts.length > 0 || seasonAvg !== null,
    roleVolume:
      num(opportunity.recentMinutes) !== null ||
      num(opportunity.recentFGA) !== null,
    matchup: matchupAvailable,
    opponentDefense: defenseAvailable,
    gameEnvironment:
      num(gameCtx.spread) !== null || num(gameCtx.total) !== null,
    availability: availability.availabilitySourceStatus !== "ERROR",
    market: line !== null,
    projections:
      num(projectionResult.finalProjection ?? projectionResult.projection ?? ctx.projection) !==
      null,
  };
  const groupKeys = Object.keys(coverageGroups);
  const availableCount = groupKeys.filter((k) => coverageGroups[k]).length;
  const coveragePct = Number(
    ((availableCount / groupKeys.length) * 100).toFixed(1)
  );

  return {
    schemaVersion: COURTEDGE_PLAYER_EVIDENCE_VERSION,
    builtAt: new Date().toISOString(),
    identity: {
      canonicalPlayerId: first(
        identity.canonicalPlayerId,
        ctx.playerId,
        ctx.wnbaPlayerId
      ),
      oddsPlayerName: first(identity.oddsPlayerName, ctx.playerName, ctx.player),
      bdlPlayerId: first(identity.bdlPlayerId, ctx.wnbaPlayerId, ctx.playerId),
      sportsDataPlayerId: identity.sportsDataPlayerId || null,
      canonicalTeamId: identity.canonicalTeamId || null,
      bdlTeamId: identity.bdlTeamId || null,
      sportsDataTeamId: identity.sportsDataTeamId || null,
      oddsEventId: first(identity.oddsEventId, ctx.game?.id, ctx.gameId),
      providerGameIds: identity.providerGameIds || {
        odds: first(ctx.game?.id, ctx.gameId),
        bdl: null,
        sportsData: null,
      },
      team: first(ctx.team, identity.team),
      opponent: first(ctx.opponent, identity.opponent),
      normalizedOpponent: identity.normalizedOpponent || null,
      league: String(ctx.league || "WNBA").toUpperCase(),
      slateDate: first(ctx.slateDate, ctx.game?.date, ctx.gameDate),
      commenceTime: first(ctx.commenceTime, ctx.game?.commenceTime, ctx.game?.time),
      nameMatchConfidence: identity.nameMatchConfidence ?? null,
      teamMatchConfidence: identity.teamMatchConfidence ?? null,
      unresolvedIdentityReason: identity.unresolvedIdentityReason || null,
    },
    recentForm: {
      seasonGames: seasonGames.length || null,
      seasonPointsAverage: seasonAvg,
      last3Points: last3Pts.length ? last3Pts : null,
      last5Points: last5Pts.length ? last5Pts : null,
      last10Points: last10Pts.length ? last10Pts : null,
      pointsMedian: median(last10Pts.length ? last10Pts : last5Pts),
      standardDeviation: stdev(last10Pts.length ? last10Pts : last5Pts),
      hitRateAgainstCurrentLine: hitRate(
        last10Pts.length ? last10Pts : last5Pts,
        line
      ),
      recentTrend: first(ctx.scoringTrend, ctx.dataCard?.scoringTrend),
      sampleSize: (last10Pts.length ? last10Pts : last5Pts).length,
      quality: qualityBlock({
        available: last5Pts.length > 0 || seasonAvg !== null,
        provider: "balldontlie",
        sampleSize: (last10Pts.length ? last10Pts : last5Pts).length,
        quality: last5Pts.length >= 5 ? "USABLE" : last5Pts.length >= 3 ? "DEVELOPING" : "EARLY",
        confidenceEligible: last5Pts.length >= 3 || seasonAvg !== null,
      }),
    },
    roleAndVolume: {
      seasonMinutes: num(opportunity.seasonMinutes ?? ctx.playerState?.seasonMinutes),
      last3Minutes: null,
      last5Minutes: num(opportunity.recentMinutes),
      last10Minutes: null,
      minutesTrend: first(ctx.roleTrend, ctx.dataCard?.roleTrend),
      minutesFloor: null,
      minutesCeiling: null,
      fga: num(opportunity.recentFGA),
      fta: num(opportunity.recentFTA),
      threePointAttempts: null,
      startsRecent: null,
      inferredRole: first(
        ctx.playerRoleProfile?.inferredRole,
        ctx.dataCard?.playerRoleProfile?.inferredRole
      ),
      roleStability: first(
        ctx.volumeProfile?.minutesStability,
        ctx.dataCard?.playerRoleProfile?.roleStability
      ),
      shotVolumeStability: first(
        ctx.volumeProfile?.volumeStability,
        ctx.dataCard?.usageShotTrend
      ),
      teammateOutRoleChange: Boolean(ctx.teammateUsageShift?.active),
      estimatedUsage: first(
        opportunity.estimatedUsage,
        ctx.dataCard?.playerRoleProfile?.estimatedUsage
      ),
      estimatedUsageLabel: "ESTIMATE_NOT_PROVIDER",
      usageTrend: null,
      roleConfidence: num(opportunity.roleCertainty),
      quality: qualityBlock({
        available:
          num(opportunity.recentMinutes) !== null ||
          num(opportunity.recentFGA) !== null,
        provider: "balldontlie",
        sampleSize: last5.length,
        quality:
          num(opportunity.recentMinutes) !== null && num(opportunity.recentFGA) !== null
            ? "USABLE"
            : "DEVELOPING",
        confidenceEligible: num(opportunity.recentMinutes) !== null,
      }),
    },
    matchup: {
      priorGamesVsOpponent: matchupGames.length,
      points: matchupPts.length ? matchupPts : null,
      minutes: matchupGames.map((g) => num(g.minutes)).filter((v) => v !== null),
      fga: matchupGames.map((g) => num(g.fga)).filter((v) => v !== null),
      fta: matchupGames.map((g) => num(g.fta)).filter((v) => v !== null),
      matchupAverage: matchupAvailable ? avg(matchupPts) : null,
      matchupMedian: matchupAvailable ? median(matchupPts) : null,
      sampleSize: matchupGames.length,
      recency: matchupGames[0]?.date || null,
      teamScoringVsOpponent: null,
      unavailableBecauseNoMeetings: matchupGames.length === 0,
      quality: qualityBlock({
        available: matchupAvailable,
        provider: "balldontlie",
        sampleSize: matchupGames.length,
        quality:
          matchupGames.length >= 3
            ? "USABLE"
            : matchupGames.length >= 1
              ? "EARLY"
              : "UNAVAILABLE",
        error: matchupGames.length === 0 ? "zero_matchup_meetings" : null,
        confidenceEligible: matchupGames.length >= 2,
      }),
    },
    opponentContext: {
      seasonPointsAllowed: num(defense.seasonPointsAllowed ?? defense.opponentPPG),
      recentPointsAllowedLast5: num(defense.last5PointsAllowed),
      recentPointsAllowedLast10: num(defense.last10PointsAllowed),
      defensiveRating: null,
      pace: num(defense.pace),
      paceProxy: num(defense.paceProxy ?? defense.recentGameTotalAvg),
      paceLabel: defense.paceProxy != null ? "GAME_TOTAL_PROXY" : null,
      recentPace: num(defense.paceProxy),
      opponentForm: null,
      homeAwaySplit: null,
      defenseScore: defenseAvailable ? num(defense.defenseScore) : null,
      defenseStatus: defense.status || (defenseAvailable ? "CALCULATED" : "UNAVAILABLE"),
      source: defense.source || "unavailable",
      sampleSize: num(defense.sampleGames, 0) || 0,
      dataQuality: defense.quality?.quality || (defenseAvailable ? "DEVELOPING" : "UNAVAILABLE"),
      quality: qualityBlock({
        available: defenseAvailable,
        provider: defense.quality?.provider || "balldontlie",
        fetchedAt: defense.quality?.fetchedAt,
        sampleSize: defense.sampleGames || 0,
        quality: defense.quality?.quality || "UNAVAILABLE",
        error: defense.defenseAudit?.unavailableReason || defense.quality?.error,
        fallbackUsed: Boolean(defense.proxyUsed || defense.quality?.fallbackUsed),
        confidenceEligible: Boolean(defense.confidenceEligible),
      }),
    },
    gameEnvironment: {
      spread: num(gameCtx.spread),
      total: num(gameCtx.total),
      impliedTeamTotal: num(gameCtx.impliedTeamTotal),
      opponentImpliedTotal: num(gameCtx.opponentImpliedTotal),
      favoriteUnderdog: gameCtx.favoriteUnderdog || null,
      blowoutRisk: num(gameCtx.blowoutRisk ?? ctx.blowoutRisk),
      marketTimestamp: marketSnapshot.snapshotTime || null,
      bookCount: num(prop.bookCount ?? ctx.bookCount),
      quality: qualityBlock({
        available: num(gameCtx.spread) !== null || num(gameCtx.total) !== null,
        provider: "the-odds-api",
        sampleSize: num(prop.bookCount, 0) || 0,
        quality:
          num(gameCtx.spread) !== null && num(gameCtx.total) !== null
            ? "USABLE"
            : "DEVELOPING",
        confidenceEligible: num(gameCtx.impliedTeamTotal) !== null,
      }),
    },
    availability: {
      playerInjuryStatus: first(
        availability.status,
        availability.statusLevel,
        availability.availabilityStatus
      ),
      feedHealth: availability.availabilitySourceStatus || null,
      playerListed: availability.availabilitySourceStatus === "OK"
        ? !(availability.noPlay || availability.availabilityRisk)
        : null,
      teammateInjuries: ctx.teammateInjuries || null,
      likelyRoleBeneficiaries: null,
      statusSource: availability.source || "balldontlie",
      statusTimestamp: availability.fetchedAt || null,
      quality: qualityBlock({
        available: availability.availabilitySourceStatus !== "ERROR",
        provider: "balldontlie",
        quality:
          availability.availabilitySourceStatus === "OK" ? "USABLE" : "UNAVAILABLE",
        error:
          availability.availabilitySourceStatus === "ERROR"
            ? "injury_feed_error"
            : null,
        confidenceEligible: availability.availabilitySourceStatus === "OK",
      }),
    },
    market: {
      currentLine: num(marketSnapshot.currentLine ?? line),
      openingLine: num(marketSnapshot.openingLine),
      lineMovement: num(
        marketSnapshot.lineDelta ??
          (num(marketSnapshot.currentLine) !== null &&
          num(marketSnapshot.openingLine) !== null
            ? num(marketSnapshot.currentLine) - num(marketSnapshot.openingLine)
            : null)
      ),
      currentPrice: first(prop.overOdds, prop.underOdds),
      bookConsensus: num(prop.consensusLine),
      bookDisagreement: num(prop.lineSpread),
      staleMarketWarning: Boolean(prop.marketWarnings?.length),
      quality: qualityBlock({
        available: line !== null,
        provider: "the-odds-api",
        sampleSize: num(prop.bookCount, 0) || 0,
        quality: num(prop.bookCount, 0) >= 3 ? "USABLE" : "DEVELOPING",
        confidenceEligible: line !== null && num(prop.bookCount, 0) >= 2,
      }),
    },
    projections: {
      vendorProjectionByProvider: {
        sportsData: num(ctx.sportsProjection),
        ballDontLie: null,
      },
      internalBaseline: num(
        projectionResult.baseline ?? seasonAvg
      ),
      roleAdjustedProjection: num(projectionResult.roleAdjusted),
      matchupAdjustedProjection: num(projectionResult.matchupAdjusted),
      gameContextAdjustment: num(projectionResult.gameContextAdjustment),
      finalProjection: num(
        projectionResult.finalProjection ??
          projectionResult.projection ??
          ctx.projection
      ),
      fairLine: num(ctx.fairLine ?? projectionResult.fairLine),
      projectionRange: projectionResult.range || null,
      projectionUncertainty: num(projectionResult.uncertainty),
      quality: qualityBlock({
        available:
          num(
            projectionResult.finalProjection ??
              projectionResult.projection ??
              ctx.projection
          ) !== null,
        provider: "internal",
        quality: "DEVELOPING",
        confidenceEligible: true,
      }),
    },
    dataQuality: {
      coverageGroups,
      availableGroupCount: availableCount,
      totalGroupCount: groupKeys.length,
      coveragePct,
      fakeCompleteCoverage: false,
      note:
        "Coverage is share of evidence groups with verified data — never forced to 100%",
    },
  };
}

export function isEvidenceV1Enabled() {
  try {
    // Lazy import avoidance — callers pass CONFIG or env
    return process.env.COURTEDGE_EVIDENCE_V1_ENABLED !== "false";
  } catch {
    return true;
  }
}
