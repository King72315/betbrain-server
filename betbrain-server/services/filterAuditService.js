import {
  TRACKING_MODE,
  isOfficialTrackablePick,
  isTrackablePick,
} from "./trackedPropService.js";

const STANDARD_REASONS = [
  "Confidence below threshold",
  "Weak market/low book count",
  "Projection edge too low",
  "Fair edge too low",
  "LEAN not official",
  "WATCHLIST not official",
  "Game started",
  "Missing player data",
  "Missing market line",
  "Risk too high",
  "Data coverage too low",
  "Duplicate prop",
  "Unknown",
];

const REASON_ALIASES = {
  "missing both projection and recent scoring data": "Missing player data",
  "data quality is too thin": "Data coverage too low",
  "not enough side support": "Projection edge too low",
  "not enough total evidence": "Data coverage too low",
  "over/under gap is too close": "Fair edge too low",
  "chosen side risk is too high": "Risk too high",
  "support does not clearly beat resistance": "Projection edge too low",
  "market quality is too weak": "Weak market/low book count",
  "over/under evidence is tied": "Unknown",
  "missing player data": "Missing player data",
  "no team match": "Missing player data",
  "no opponent match": "Missing player data",
  "game started": "Game started",
  "lean not official": "LEAN not official",
  "watchlist not official": "WATCHLIST not official",
  "duplicate prop": "Duplicate prop",
  "missing market line": "Missing market line",
  "confidence below threshold": "Confidence below threshold",
  "not playable": "Confidence below threshold",
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFilterReason(rawReason = "") {
  const key = String(rawReason || "")
    .trim()
    .toLowerCase();

  if (!key) return "Unknown";

  if (REASON_ALIASES[key]) {
    return REASON_ALIASES[key];
  }

  for (const [needle, mapped] of Object.entries(REASON_ALIASES)) {
    if (key.includes(needle)) {
      return mapped;
    }
  }

  return "Unknown";
}

function initReasonCounts() {
  const counts = {};

  for (const reason of STANDARD_REASONS) {
    counts[reason] = 0;
  }

  return counts;
}

function bumpReason(counts, reason, amount = 1) {
  const normalized = normalizeFilterReason(reason);
  counts[normalized] = num(counts[normalized]) + num(amount);
}

function aggregateRejectionReasons(counts, rejectionReasons = {}) {
  for (const [reason, count] of Object.entries(rejectionReasons || {})) {
    bumpReason(counts, reason, count);
  }
}

function countTierAndDisplayFilters(games = [], topProps = [], counts, options = {}) {
  const trackAllGenerated = options.trackingMode === "ALL_GENERATED_PROPS";
  const seen = new Set();

  const inspectPick = (pick) => {
    if (!pick?.player) return;

    const key = [
      pick.league || "",
      pick.player || "",
      pick.line ?? pick.sportsbookLine ?? "",
      pick.side || pick.pick || "",
    ].join("|");

    if (seen.has(key)) {
      bumpReason(counts, "Duplicate prop");
      return;
    }

    seen.add(key);

    if (pick.isStarted) {
      bumpReason(counts, "Game started");
      return;
    }

    if (trackAllGenerated) return;

    const tier = String(pick.tier || "").toUpperCase();

    if (tier === "LEAN") {
      bumpReason(counts, "LEAN not official");
      return;
    }

    if (tier === "WATCHLIST") {
      bumpReason(counts, "WATCHLIST not official");
    }
  };

  for (const game of games) {
    for (const pick of game.picks || []) {
      inspectPick(pick);
    }
  }

  for (const pick of topProps) {
    inspectPick(pick);
  }
}

function countPlayableGate(games = [], counts) {
  for (const game of games) {
    const built = num(game.allCandidateCount);
    const playable = num(game.playableCandidateCount);
    const delta = Math.max(0, built - playable);

    if (delta > 0) {
      bumpReason(counts, "Confidence below threshold", delta);
    }
  }
}

function countFilteredBeforeGeneration(games = [], generatedProps = []) {
  const totalScanned = games.reduce(
    (sum, game) => sum + num(game.consensusPropCount ?? game.rawPropCount),
    0
  );
  const builtCandidates = games.reduce(
    (sum, game) => sum + num(game.allCandidateCount),
    0
  );

  return Math.max(0, totalScanned - builtCandidates);
}

function buildTierDistribution(props = []) {
  const distribution = {
    PREMIUM: 0,
    PLAYABLE: 0,
    LEAN: 0,
    WATCHLIST: 0,
    UNKNOWN: 0,
  };

  for (const pick of props) {
    const tier = String(pick.tier || "UNKNOWN").toUpperCase();
    if (distribution[tier] !== undefined) {
      distribution[tier] += 1;
    } else {
      distribution.UNKNOWN += 1;
    }
  }

  return distribution;
}

function resolveAuditInputs(auditInput = {}) {
  if (Array.isArray(auditInput)) {
    return {
      generatedProps: [],
      topProps: auditInput,
      trackingMode: TRACKING_MODE,
    };
  }

  return {
    generatedProps: auditInput.generatedProps || [],
    topProps: auditInput.topProps || [],
    trackingMode: auditInput.trackingMode || TRACKING_MODE,
  };
}

export function buildFilterAudit(games = [], sideAudit = {}, auditInput = {}) {
  const { generatedProps, topProps, trackingMode } = resolveAuditInputs(auditInput);
  const trackAllGenerated = trackingMode === "ALL_GENERATED_PROPS";

  const totalScanned = games.reduce(
    (sum, game) => sum + num(game.consensusPropCount ?? game.rawPropCount),
    0
  );
  const builtCandidates = games.reduce(
    (sum, game) => sum + num(game.allCandidateCount),
    0
  );
  const playableCandidates = games.reduce(
    (sum, game) => sum + num(game.playableCandidateCount),
    0
  );
  const displayedProps = games.reduce(
    (sum, game) => sum + (Array.isArray(game.picks) ? game.picks.length : 0),
    0
  );

  const propsForTracking = trackAllGenerated
    ? generatedProps
  : topProps.filter(isOfficialTrackablePick);

  const trackedToResults = propsForTracking.filter(isTrackablePick).length;
  const officialTracked = (Array.isArray(topProps) ? topProps : []).filter(
    isOfficialTrackablePick
  ).length;
  const propsPassed = trackedToResults;
  const filteredBeforeGeneration = countFilteredBeforeGeneration(
    games,
    generatedProps
  );
  const filteredOut = Math.max(0, totalScanned - trackedToResults);
  const filteredPct =
    totalScanned > 0 ? Math.round((filteredOut / totalScanned) * 100) : 0;

  const reasonCounts = initReasonCounts();

  aggregateRejectionReasons(reasonCounts, sideAudit.rejectionReasons);
  countPlayableGate(games, reasonCounts);
  countTierAndDisplayFilters(games, topProps, reasonCounts, { trackingMode });

  const topReasons = Object.entries(reasonCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return {
    trackingMode,
    totalScanned,
    builtCandidates,
    playableCandidates,
    displayedProps,
    generatedProps: generatedProps.length,
    propsPassed,
    trackedToResults,
    officialTracked,
    filteredBeforeGeneration,
    filteredOut,
    filteredPct,
    tierDistribution: buildTierDistribution(generatedProps),
    reasonCounts,
    topReasons,
    pipeline: {
      rawLines:
        num(sideAudit.rawOverLines) + num(sideAudit.rawUnderLines),
      riskRejected:
        num(sideAudit.rejectedOver) + num(sideAudit.rejectedUnder),
      chosenPicks: num(sideAudit.chosenOver) + num(sideAudit.chosenUnder),
      topPropsListed: Array.isArray(topProps) ? topProps.length : 0,
      boardPropsTracked: generatedProps.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
