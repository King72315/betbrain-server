/**
 * Global Top Props selector — full candidate pool, score, then diversity caps.
 */
import { CONFIG } from "../../config.js";
import { scoreNbaTopProp } from "./nbaTopPropScore.js";
import { scoreWnbaTopProp } from "./wnbaTopPropScore.js";
import {
  TOP_PROP_SELECTOR_VERSION,
  createTopPropSelectionAudit,
  finalizeTopPropSelectionAudit,
  isNoBetPick,
  isOfficialPick,
  isTestPick,
  summarizePickForAudit,
} from "./topPropSelectionAudit.js";

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw === "OVER") return "OVER";
  if (raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function enrichPickFromGame(pick = {}, game = {}) {
  return {
    ...pick,
    gameId: game.gameId || game.id,
    game: game.game,
    date: game.date,
    dateLabel: game.dateLabel,
    dayBucket: game.dayBucket || pick.dayBucket || "",
    time: game.time,
    commenceTime: game.commenceTime,
    minutesUntilStart: game.minutesUntilStart,
    isStarted: Boolean(game.isStarted || pick.isStarted),
    league: game.league || pick.league,
  };
}

export function collectAllGeneratedCandidates(gameCards = []) {
  const candidates = [];

  for (const game of gameCards) {
    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];

    for (const pick of pool) {
      candidates.push(enrichPickFromGame(pick, game));
    }
  }

  return candidates;
}

function exactDupeKey(pick = {}) {
  return [
    clean(pick.player),
    clean(pick.team),
    String(pick.line),
    normalizeSide(pick.side || pick.pick),
    String(pick.league || "").toUpperCase(),
    clean(pick.gameId || pick.game),
  ].join("|");
}

function playerKey(pick = {}) {
  return clean(`${pick.player}-${pick.team}`);
}

function playerLineKey(pick = {}) {
  return clean(`${pick.player}-${pick.line}-${pick.stat || "points"}`);
}

function scoreCandidate(pick = {}) {
  const league = String(pick.league || "").toUpperCase();
  const scored =
    league === "WNBA" ? scoreWnbaTopProp(pick) : scoreNbaTopProp(pick);

  return {
    ...pick,
    ...scored,
    pickScore: scored.bestPropScore,
  };
}

function filterInvalidCandidates(candidates = [], audit = {}) {
  const exactSeen = new Map();
  const valid = [];

  for (const pick of candidates) {
    if (pick.isStarted) {
      audit.hiddenStarted += 1;
      audit.rejected.push({
        reason: "started",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (isNoBetPick(pick)) {
      audit.noBetCount += 1;
      audit.hiddenNoBet += 1;
      audit.rejected.push({
        reason: "no_bet",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (pick.noPlay) {
      audit.hiddenNoPlay += 1;
      audit.rejected.push({
        reason: "no_play",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const dupeKey = exactDupeKey(pick);
    const existing = exactSeen.get(dupeKey);
    if (existing) {
      audit.hiddenExactDupe += 1;
      audit.hidden.push({
        reason: "exact_dupe",
        pick: summarizePickForAudit(pick),
        kept: summarizePickForAudit(existing),
      });
      continue;
    }

    exactSeen.set(dupeKey, pick);
    valid.push(pick);

    const engine = pick.engineHandled || pick.league || "UNKNOWN";
    audit.engineHandled[engine] = Number(audit.engineHandled[engine] || 0) + 1;
  }

  audit.afterInvalidFilter = valid.length;
  return valid;
}

function applyDiversityCaps(sorted = [], options = {}, audit = {}) {
  const limit = Number(options.limit ?? CONFIG.TOP_PROP_LIMIT ?? 8);
  const maxPerGame = options.maxPerGame ?? options.maxPerGameCap ?? null;
  const selected = [];
  const playersSeen = new Set();
  const playerLineBest = new Map();
  const gameCounts = new Map();

  for (const pick of sorted) {
    const pKey = playerKey(pick);
    if (playersSeen.has(pKey)) {
      audit.hiddenDuplicatePlayer += 1;
      audit.hidden.push({
        reason: "duplicate_player",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const plKey = playerLineKey(pick);
    const prior = playerLineBest.get(plKey);
    if (prior) {
      const priorSide = normalizeSide(prior.side || prior.pick);
      const nextSide = normalizeSide(pick.side || pick.pick);
      if (priorSide && nextSide && priorSide !== nextSide) {
        audit.hiddenOppositeSide += 1;
        audit.hidden.push({
          reason: "opposite_side",
          pick: summarizePickForAudit(pick),
          kept: summarizePickForAudit(prior),
        });
        continue;
      }
    }

    if (maxPerGame != null && Number.isFinite(Number(maxPerGame))) {
      const gameKey = clean(pick.gameId || pick.game || "");
      const count = gameCounts.get(gameKey) || 0;
      if (count >= Number(maxPerGame)) {
        audit.hiddenDueToCap += 1;
        audit.hidden.push({
          reason: "hidden_due_to_cap",
          cap: "per_game",
          maxPerGame: Number(maxPerGame),
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
    }

    if (selected.length >= limit) break;

    selected.push(pick);
    playersSeen.add(pKey);
    playerLineBest.set(plKey, pick);

    if (maxPerGame != null && Number.isFinite(Number(maxPerGame))) {
      const gameKey = clean(pick.gameId || pick.game || "");
      gameCounts.set(gameKey, (gameCounts.get(gameKey) || 0) + 1);
    }
  }

  return selected;
}

export function selectTopProps(gameCards = [], options = {}) {
  const audit = createTopPropSelectionAudit();
  const leagueFilter = options.league
    ? String(options.league).toUpperCase()
    : null;

  let candidates = collectAllGeneratedCandidates(gameCards);
  audit.candidateCount = candidates.length;

  if (leagueFilter) {
    candidates = candidates.filter(
      (p) => String(p.league || "").toUpperCase() === leagueFilter
    );
  }

  const valid = filterInvalidCandidates(candidates, audit);
  const scored = valid.map(scoreCandidate);
  scored.sort(
    (a, b) =>
      Number(b.bestPropScore || 0) - Number(a.bestPropScore || 0) ||
      Number(b.confidence || 0) - Number(a.confidence || 0) ||
      Number(b.netEdge || 0) - Number(a.netEdge || 0)
  );

  const selected = applyDiversityCaps(scored, options, audit);
  const ranked = selected.map((pick, index) => ({
    ...pick,
    rank: index + 1,
    topPropRank: index + 1,
  }));

  finalizeTopPropSelectionAudit(audit, ranked, scored);

  const topOfficialProps = ranked.filter(isOfficialPick);
  const topTestProps = ranked.filter(isTestPick);

  return {
    topProps: ranked,
    topOfficialProps,
    topTestProps,
    topSelectionAudit: audit,
    candidateCount: audit.candidateCount,
    selectedCount: audit.selectedCount,
    officialCount: audit.officialCount,
    testCount: audit.testCount,
    noBetCount: audit.noBetCount,
    selectorVersion: TOP_PROP_SELECTOR_VERSION,
  };
}

export { TOP_PROP_SELECTOR_VERSION };
