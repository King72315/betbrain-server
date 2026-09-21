import {
  MAX_TOP_WINNERS,
  TRACKING,
  WNBA_WINNER_C_VERSION,
  WNBA_WINNER_MODEL_VERSION,
  WNBA_WINNER_VERSION,
  clampProb,
  formatTipCT,
  normalizePair,
  normalizeWnbaTeam,
  slateDateCT,
} from "./constants.js";
import { mergeWinnerMarket } from "./winnerMarketV1.js";
import { predictWinnerV1, emptyTeamState, predictPointDiff } from "./winnerModelV1.js";
import { predictWinnerC } from "./winnerModelC.js";
import { buildWinnerReaderAudit } from "./winnerReaderAuditV1.js";
import {
  buildWinnerPredictionId,
  freezeWinnerPrediction,
  toCanonicalPacket,
} from "./winnerLifecycleV1.js";
import { isCourtEdgePtsWinnerCEra } from "../../courtEdgeEraV1.js";

export function qualityFromState(homeState, awayState, market, audit) {
  const sample = Math.min(homeState.games || 0, awayState.games || 0);
  let q = 40;
  if (sample >= 20) q += 20;
  else if (sample >= 11) q += 14;
  else if (sample >= 6) q += 8;
  if ((market?.bookCount || 0) >= 2) q += 8;
  if (audit?.caseMargin >= 0.08) q += 8;
  if ((audit?.missingData || []).length) q -= 15;
  if (audit?.confidenceRiskSignals?.includes("MODEL_MARKET_DISAGREEMENT")) q -= 4;
  return Math.max(0, Math.min(99, q));
}

export function trackingForWinner({ officialPromotion, quality, missingCore, pWinner }) {
  if (missingCore) return TRACKING.NO_PICK;
  if (officialPromotion !== true) return TRACKING.TEST;
  if (quality < 55 || pWinner < 0.54) return TRACKING.TEST;
  return TRACKING.OFFICIAL;
}

export function rankTopWinners(rows = [], options = {}) {
  const byP = options.rankByProbability === true;
  const official = rows
    .filter((r) => r.winnerTrackingType === TRACKING.OFFICIAL)
    .sort((a, b) => {
      if (byP) {
        return (b.selectedProbability - a.selectedProbability) || (b.qualityScore - a.qualityScore);
      }
      return (b.qualityScore - a.qualityScore) || (b.selectedProbability - a.selectedProbability);
    });
  return official.slice(0, MAX_TOP_WINNERS).map((row, i) => ({ ...row, winnerRank: i + 1 }));
}

export function buildWinnerRow({
  event,
  slateDate,
  season = "2026",
  homeState = emptyTeamState(),
  awayState = emptyTeamState(),
  homeCourt = { hfaElo: 40, intercept: 0.08 },
  oddsApiEvent = null,
  sgoEvent = null,
  officialPromotion = false,
  fetchedAt = new Date().toISOString(),
}) {
  const homeTeam = normalizeWnbaTeam(event.homeTeam || event.homeAbbr);
  const awayTeam = normalizeWnbaTeam(event.awayTeam || event.awayAbbr);
  const homeName = event.homeName || homeTeam;
  const awayName = event.awayName || awayTeam;
  const missing = [];
  if (!homeTeam || !awayTeam) missing.push("TEAM_IDENTITY");
  if (!event.eventId) missing.push("EVENT_ID");

  const winnerCEra = isCourtEdgePtsWinnerCEra(slateDate);
  const extras = {
    hfaElo: homeCourt.hfaElo,
    homeIntercept: homeCourt.intercept,
    restHome: event.restHome,
    restAway: event.restAway,
  };
  const forensicV1 = predictWinnerV1(homeState, awayState, extras);
  const pred = winnerCEra ? predictWinnerC(homeState, awayState, extras) : forensicV1;
  const pair = normalizePair(pred.pHome);
  const pPdHome = predictPointDiff(homeState, awayState, false);
  const market = mergeWinnerMarket({ oddsApi: oddsApiEvent, sgo: sgoEvent, fetchedAt });
  const pMarketHome = market.noVigHome;
  const modelMarketDisagreement =
    pMarketHome != null && (pair.pHome >= 0.5) !== (pMarketHome >= 0.5);
  const selectedHome = pair.pHome >= pair.pAway;
  const audit = buildWinnerReaderAudit({
    homeTeam,
    awayTeam,
    homeName,
    awayName,
    pHome: pair.pHome,
    pAway: pair.pAway,
    components: pred.components,
    market: { ...market, modelMarketDisagreement },
    missingData: missing,
    restHome: event.restHome,
    restAway: event.restAway,
  });
  const quality = qualityFromState(homeState, awayState, market, audit);
  const selectedProbability = selectedHome ? pair.pHome : pair.pAway;
  const tracking = winnerCEra
    ? missing.includes("TEAM_IDENTITY")
      ? TRACKING.NO_PICK
      : TRACKING.OFFICIAL
    : trackingForWinner({
        officialPromotion,
        quality,
        missingCore: missing.includes("TEAM_IDENTITY"),
        pWinner: selectedProbability,
      });
  const confidence = Math.round(50 + (selectedProbability - 0.5) * 80 + Math.min(10, (homeState.games || 0) / 3));
  const risk = selectedProbability >= 0.64 && quality >= 70 ? "LOW" : selectedProbability >= 0.56 ? "MEDIUM" : "HIGH";

  const row = {
    version: WNBA_WINNER_VERSION,
    winnerPredictionId: buildWinnerPredictionId({
      slateDateCT: slateDate,
      eventId: event.eventId,
      homeTeam,
      awayTeam,
    }),
    league: "WNBA",
    season,
    seasonPhase: event.seasonPhase || "REGULAR_SEASON",
    slateDateCT: slateDate,
    eventId: event.eventId,
    startCT: formatTipCT(event.commenceTime),
    commenceTime: event.commenceTime,
    homeTeam,
    awayTeam,
    homeName,
    awayName,
    pHome: Number(pair.pHome.toFixed(4)),
    pAway: Number(pair.pAway.toFixed(4)),
    selectedWinnerId: selectedHome ? homeTeam : awayTeam,
    selectedWinnerName: selectedHome ? homeName : awayName,
    selectedProbability: Number(selectedProbability.toFixed(4)),
    qualityScore: quality,
    winnerRank: null,
    winnerTrackingType: tracking,
    confidence: Math.max(50, Math.min(84, confidence)),
    risk,
    winningReason: audit.winningReason,
    winnerReaderAudit: audit,
    marketSnapshot: {
      ...market,
      pMarketHome,
      pMarketAway: market.noVigAway,
      homeMarketEdge: pMarketHome != null ? Number((pair.pHome - pMarketHome).toFixed(4)) : null,
      awayMarketEdge: market.noVigAway != null ? Number((pair.pAway - market.noVigAway).toFixed(4)) : null,
      modelMarketDisagreement,
    },
    featureSnapshot: {
      homeElo: homeState.elo,
      awayElo: awayState.elo,
      homeRecord: `${homeState.wins}-${homeState.losses}`,
      awayRecord: `${awayState.wins}-${awayState.losses}`,
      components: pred.components,
      pPdHome,
      pdBaselinePick: pPdHome >= 0.5 ? homeTeam : awayTeam,
      pdBaselineProbability: Number((pPdHome >= 0.5 ? pPdHome : 1 - pPdHome).toFixed(4)),
    },
    forensicWinnerV1: {
      modelVersion: WNBA_WINNER_MODEL_VERSION,
      pHome: Number(forensicV1.pHome.toFixed(4)),
      selectedWinnerId: forensicV1.pHome >= 0.5 ? homeTeam : awayTeam,
      selectedProbability: Number((forensicV1.pHome >= 0.5 ? forensicV1.pHome : 1 - forensicV1.pHome).toFixed(4)),
    },
    provenance: {
      eventSource: event.source || market.eventSource || "ESPN",
      moneylineSource: market.moneylineSource,
      secondaryMarketSources: market.secondaryMarketSources,
      providerEventIds: {
        espn: event.eventId,
        ...market.providerEventIds,
      },
      providerFetchedAt: fetchedAt,
      bookSources: market.bookSources,
      marketFailoverUsed: market.marketFailoverUsed === true,
    },
    modelVersion: winnerCEra ? WNBA_WINNER_C_VERSION : WNBA_WINNER_MODEL_VERSION,
    productionOwner: winnerCEra ? WNBA_WINNER_C_VERSION : WNBA_WINNER_VERSION,
    frozenAt: null,
  };
  return freezeWinnerPrediction(row, fetchedAt);
}

export function buildFullWinnerSlate(events = [], context = {}) {
  const slateDate = context.slateDate || slateDateCT(new Date());
  const rows = events.map((event) =>
    buildWinnerRow({
      event,
      slateDate,
      season: context.season || "2026",
      homeState: context.states?.get?.(normalizeWnbaTeam(event.homeTeam)) || emptyTeamState(),
      awayState: context.states?.get?.(normalizeWnbaTeam(event.awayTeam)) || emptyTeamState(),
      homeCourt: context.homeCourt || { hfaElo: 40, intercept: 0.08 },
      oddsApiEvent: context.oddsByEvent?.get?.(event.eventId) || matchOdds(event, context.oddsEvents),
      sgoEvent: context.sgoByEvent?.get?.(event.eventId) || matchSgo(event, context.sgoEvents),
      officialPromotion: context.officialPromotion === true,
      fetchedAt: context.fetchedAt || new Date().toISOString(),
    })
  );
  const winnerCEra = isCourtEdgePtsWinnerCEra(slateDate);
  const top = rankTopWinners(rows, { rankByProbability: winnerCEra });
  const topIds = new Set(top.map((r) => r.winnerPredictionId));
  const ranked = rows.map((r) => {
    const hit = top.find((t) => t.winnerPredictionId === r.winnerPredictionId);
    return hit ? { ...r, winnerRank: hit.winnerRank } : r;
  });
  return {
    version: winnerCEra ? WNBA_WINNER_C_VERSION : WNBA_WINNER_VERSION,
    slateDateCT: slateDate,
    officialPromotion: winnerCEra ? true : context.officialPromotion === true,
    productionMode: winnerCEra
      ? "WINNER_C_PRODUCTION"
      : context.officialPromotion === true
        ? "OFFICIAL"
        : "TEST_ONLY",
    fullSlate: ranked,
    topWinners: top,
    testWinners: ranked.filter((r) => r.winnerTrackingType === TRACKING.TEST),
    officialWinners: ranked.filter((r) => r.winnerTrackingType === TRACKING.OFFICIAL),
    packets: ranked.map(toCanonicalPacket),
    topIds: [...topIds],
  };
}

function matchOdds(event, oddsEvents = []) {
  const home = normalizeWnbaTeam(event.homeTeam);
  const away = normalizeWnbaTeam(event.awayTeam);
  return (oddsEvents || []).find((o) => {
    return normalizeWnbaTeam(o.home_team) === home && normalizeWnbaTeam(o.away_team) === away;
  }) || null;
}

function matchSgo(event, sgoEvents = []) {
  const home = normalizeWnbaTeam(event.homeName || event.homeTeam);
  const away = normalizeWnbaTeam(event.awayName || event.awayTeam);
  return (sgoEvents || []).find((ev) => {
    const h = normalizeWnbaTeam(ev.teams?.home?.names?.short || ev.teams?.home?.names?.medium);
    const a = normalizeWnbaTeam(ev.teams?.away?.names?.short || ev.teams?.away?.names?.medium);
    return h === home && a === away;
  }) || null;
}

export { clampProb };
