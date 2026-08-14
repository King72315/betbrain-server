/**
 * CourtEdge Market-Balanced V2 Home Weave V1
 *
 * Surfacing only — does NOT modify Decision Engine V2 scores/calibration.
 *
 * 1) Bucket PTS / REB / AST (proven propType only)
 * 2) Rank each bucket by existing decisionScoreV2 / modelWinProbability
 * 3) Order markets by each bucket's #1 score
 * 4) Weave cycle-by-cycle in that order, max 10, no minimum
 */
import { normalizePropTypeV1 } from "../engines/wnba/propTypeV1.js";

export const HOME_MARKET_WEAVE_BUILD =
  "courteedge-market-balanced-home-weave-v1";

export const MAX_HOME_PROPS = 10;

export const HOME_WEAVE_MARKETS = Object.freeze([
  "POINTS",
  "REBOUNDS",
  "ASSISTS",
]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normSide(raw) {
  const s = String(raw || "").toUpperCase();
  if (s.startsWith("U")) return "UNDER";
  if (s.startsWith("O")) return "OVER";
  return null;
}

/**
 * Proven propType only — never default missing identity to POINTS.
 */
export function resolveProvenPropType(packet = {}) {
  const raw =
    packet.propType ??
    packet.canonicalPropType ??
    packet.marketType ??
    packet.stat ??
    null;
  if (raw == null || String(raw).trim() === "") return null;
  return normalizePropTypeV1(raw);
}

export function resolveDecisionScore(packet = {}) {
  const a = num(packet.decisionScoreV2);
  if (a != null) return a;
  const b = num(packet.modelWinProbability);
  if (b != null) return b > 1 ? b / 100 : b;
  return null;
}

function stableTieKey(packet = {}) {
  return String(
    packet.canonicalPropId ||
      [
        packet.playerName || packet.player || "",
        packet.propType || "",
        packet.side || packet.selectedSide || "",
        packet.line ?? "",
      ].join("|")
  );
}

function compareV2StrongestFirst(a, b) {
  const sa = resolveDecisionScore(a);
  const sb = resolveDecisionScore(b);
  if (sa != null && sb != null && sb !== sa) return sb - sa;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;
  return stableTieKey(a).localeCompare(stableTieKey(b));
}

function duplicateKey(packet = {}) {
  return [
    String(packet.playerName || packet.player || "")
      .toLowerCase()
      .replace(/\s+/g, "-"),
    packet.propType,
    packet.line,
    packet.selectedSide || packet.side,
  ].join("|");
}

/**
 * Build market buckets + independent V2 rankings.
 * Candidates without proven propType are excluded and reported.
 */
export function buildMarketBucketsV1(candidates = [], options = {}) {
  const buckets = { POINTS: [], REBOUNDS: [], ASSISTS: [] };
  const identityProblems = [];
  const seen = new Set();

  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const propType = resolveProvenPropType(raw);
    if (!propType) {
      identityProblems.push({
        player: raw.playerName || raw.player || null,
        line: raw.line ?? null,
        side: raw.side || raw.selectedSide || null,
        reason: "UNPROVEN_PROPTYPE",
        rawPropType: raw.propType ?? raw.canonicalPropType ?? raw.stat ?? null,
      });
      continue;
    }
    const side = normSide(raw.selectedSide || raw.side || raw.pick);
    if (!side || raw.line == null) {
      identityProblems.push({
        player: raw.playerName || raw.player || null,
        propType,
        reason: "MISSING_SIDE_OR_LINE",
      });
      continue;
    }
    const score = resolveDecisionScore(raw);
    if (score == null && options.requireScore !== false) {
      identityProblems.push({
        player: raw.playerName || raw.player || null,
        propType,
        reason: "MISSING_V2_SCORE",
      });
      continue;
    }
    // Preserve true V2 scores — ranking uses resolveDecisionScore; do not overwrite.
    const storedModel = num(raw.modelWinProbability);
    const modelWinProbability =
      storedModel != null
        ? storedModel > 1
          ? storedModel / 100
          : storedModel
        : score;
    const storedDecision = num(raw.decisionScoreV2);
    const decisionScoreV2 =
      storedDecision != null
        ? storedDecision > 1
          ? storedDecision / 100
          : storedDecision
        : score;
    const row = {
      ...raw,
      propType,
      canonicalPropType: propType,
      selectedSide: side,
      side,
      decisionScoreV2,
      modelWinProbability,
      _rankScore: score,
      marketKey:
        raw.marketKey ||
        raw.marketType ||
        (propType === "REBOUNDS"
          ? "player_rebounds"
          : propType === "ASSISTS"
            ? "player_assists"
            : "player_points"),
    };
    const key = duplicateKey(row);
    // Same player+propType+line+side only once; different propTypes never collapse.
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[propType].push(row);
  }

  for (const pt of HOME_WEAVE_MARKETS) {
    buckets[pt] = [...buckets[pt]]
      .sort(compareV2StrongestFirst)
      .map((row, idx) => ({
        ...row,
        marketRank: idx + 1,
      }));
  }

  return {
    build: HOME_MARKET_WEAVE_BUILD,
    buckets,
    candidateCounts: {
      POINTS: buckets.POINTS.length,
      REBOUNDS: buckets.REBOUNDS.length,
      ASSISTS: buckets.ASSISTS.length,
    },
    identityProblems,
  };
}

/**
 * Determine first-cycle market order from each bucket's #1 score.
 */
export function determineFirstCycleMarketOrder(buckets = {}) {
  const tops = [];
  for (const pt of HOME_WEAVE_MARKETS) {
    const first = (buckets[pt] || [])[0];
    if (!first) continue;
    tops.push({
      propType: pt,
      score: resolveDecisionScore(first),
      tieKey: stableTieKey(first),
    });
  }
  tops.sort((a, b) => {
    if (a.score != null && b.score != null && b.score !== a.score) {
      return b.score - a.score;
    }
    return a.propType.localeCompare(b.propType);
  });
  return tops.map((t) => t.propType);
}

/**
 * Weave ranked market lists into Home board (max 10, no minimum).
 */
export function weaveHomeBoardV1(buckets = {}, options = {}) {
  const maxBoard = num(options.maxBoard) ?? MAX_HOME_PROPS;
  const marketOrder =
    options.marketOrder || determineFirstCycleMarketOrder(buckets);
  const cursors = Object.fromEntries(HOME_WEAVE_MARKETS.map((m) => [m, 0]));
  const selected = [];

  let progressed = true;
  while (selected.length < maxBoard && progressed) {
    progressed = false;
    for (const pt of marketOrder) {
      if (selected.length >= maxBoard) break;
      const list = buckets[pt] || [];
      const idx = cursors[pt] || 0;
      if (idx >= list.length) continue;
      const next = list[idx];
      cursors[pt] = idx + 1;
      selected.push({
        ...next,
        homeWeaveRank: selected.length + 1,
        marketRank: next.marketRank ?? idx + 1,
        homeWeaveBuild: HOME_MARKET_WEAVE_BUILD,
      });
      progressed = true;
    }
  }

  const homeCounts = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 };
  for (const row of selected) {
    if (homeCounts[row.propType] != null) homeCounts[row.propType] += 1;
  }

  return {
    build: HOME_MARKET_WEAVE_BUILD,
    maxBoard,
    marketOrder,
    selectedPackets: selected,
    homeCounts,
    candidateCounts: {
      POINTS: (buckets.POINTS || []).length,
      REBOUNDS: (buckets.REBOUNDS || []).length,
      ASSISTS: (buckets.ASSISTS || []).length,
    },
    shortBuckets: HOME_WEAVE_MARKETS.filter(
      (pt) => (buckets[pt] || []).length === 0
    ),
  };
}

/**
 * Full Home weave pipeline from scored candidates.
 * Does not recompute V2 — uses existing decisionScoreV2 / modelWinProbability.
 */
export function selectHomeBoardMarketWeaveV1(candidates = [], options = {}) {
  const bucketed = buildMarketBucketsV1(candidates, options);
  const woven = weaveHomeBoardV1(bucketed.buckets, {
    maxBoard: options.maxBoard ?? MAX_HOME_PROPS,
  });
  return {
    ...woven,
    identityProblems: bucketed.identityProblems,
    buckets: bucketed.buckets,
    boardSizePolicy: "MARKET_BALANCED_V2_HOME_WEAVE",
    officialBoardMin: 0,
    officialBoardMax: woven.maxBoard,
    homeBoardMax: woven.maxBoard,
    byMarketSelected: woven.homeCounts,
    decisionAuthority: "HOME_WEAVE_SURFACING_ONLY",
    note: "Home visibility order only — V2 scores unchanged",
  };
}
