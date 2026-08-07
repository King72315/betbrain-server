/**
 * slateRelativeStrengthV1 — rank candidates within a slate.
 * Relative strength does NOT auto-admit LOW; distinguishes strong vs best-of-bad.
 */
import { SLATE_RELATIVE_STRENGTH_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function rankBy(items, getter, higherBetter = true) {
  const scored = items.map((item, idx) => ({
    idx,
    score: num(getter(item)),
  }));
  scored.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return higherBetter ? b.score - a.score : a.score - b.score;
  });
  const ranks = new Array(items.length).fill(null);
  scored.forEach((row, rankZero) => {
    ranks[row.idx] = rankZero + 1;
  });
  return ranks;
}

/**
 * Annotate an array of candidate risk/packet objects with slate ranks.
 */
export function annotateSlateRelativeStrengthV1(candidates = []) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return [];

  const relRanks = rankBy(
    list,
    (c) => c.reliabilityProbability ?? c.reliability?.reliabilityProbability
  );
  const trustRanks = rankBy(list, (c) => c.trustScore ?? c.trust?.trustScore);
  const safetyRanks = rankBy(
    list,
    (c) => c.SafetyScore ?? c.safetyScore ?? c.safety?.finalSafetyScore
  );
  const rawRanks = rankBy(
    list,
    (c) => c.rawWinProbability ?? c.probability?.rawWinProbability
  );

  const n = list.length;
  return list.map((c, i) => {
    const slateReliabilityRank = relRanks[i];
    const slateTrustRank = trustRanks[i];
    const slateSafetyRank = safetyRanks[i];
    const slateRawProbRank = rawRanks[i];
    // percentile: best = ~100
    const slatePercentile =
      slateReliabilityRank == null
        ? null
        : Math.round(((n - slateReliabilityRank + 1) / n) * 100);
    return {
      ...c,
      slateRelativeStrength: {
        version: SLATE_RELATIVE_STRENGTH_VERSION,
        slateReliabilityRank,
        slateTrustRank,
        slateSafetyRank,
        slateRawProbRank,
        slatePercentile,
        slateSize: n,
      },
      slateReliabilityRank,
      slateTrustRank,
      slatePercentile,
    };
  });
}
