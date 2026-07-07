export type PropDisplayLabel = {
  primary: string;
  badges: string[];
  detail: string;
};

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isPlayableGeneratedProp(prop: any = {}) {
  if (!prop || prop.noPlay) return false;
  if (prop.trustable === false) return false;

  const confidence = num(prop.confidence ?? prop.winProbability);
  const supportScore = num(prop.supportScore);
  const netEdge = num(prop.netEdge ?? prop.gap);
  const chosenRisk = num(prop.chosenRisk, 70);

  if (confidence < 55) return false;
  if (supportScore < 6) return false;
  if (netEdge < 2) return false;
  if (chosenRisk >= 70) return false;

  return true;
}

export function getPropDisplayLabels(prop: any = {}): PropDisplayLabel {
  const tier = String(prop.tier || "").toUpperCase();
  const badges: string[] = [];

  if (prop.topPickLabel) {
    badges.unshift(prop.topPickLabel);
  } else if (prop.topPickRank) {
    badges.unshift(`Top #${prop.topPickRank}`);
  }

  const decisionLabel = String(
    prop.resultsDecisionLabel ||
      prop.decisionIntelligence?.trackEligibility ||
      prop.trackingEligibility ||
      ""
  ).toUpperCase();
  if (decisionLabel === "TRACK") {
    badges.push("Track");
  } else if (decisionLabel === "NO_BET") {
    badges.push("No Bet");
  }

  if (prop.noPlay) {
    badges.push("No Play");
  } else if (String(prop.trackingType || prop.recordType || "").toUpperCase() === "TEST") {
    badges.push("TEST");
    badges.push("Learning");
  } else if (tier === "PREMIUM") {
    badges.push("Premium");
  } else if (isPlayableGeneratedProp(prop)) {
    badges.push("Playable");
  }

  if (tier === "LEAN") badges.push("Lean");
  if (tier === "WATCHLIST") badges.push("Watchlist");

  if (
    prop.trackingMode === "ALL_GENERATED_PROPS" ||
    tier === "LEAN" ||
    tier === "WATCHLIST"
  ) {
    badges.push("Testing");
  }

  const confidence = prop.confidence ?? prop.winProbability;
  const books = prop.bookCount ?? "—";
  const dataMode = prop.dataMode || prop.playerState?.dataMode || "—";
  const risk = prop.riskLabel || "—";

  const detail = `Conf ${confidence ?? "—"}% • Risk ${risk} • Books ${books} • Data ${dataMode}`;

  const primary = badges[0] || tier || "Generated";

  return {
    primary,
    badges: [...new Set(badges)],
    detail,
  };
}

export function formatPropLabelLine(prop: any = {}) {
  const labels = getPropDisplayLabels(prop);
  return `${labels.badges.join(" • ")} — ${labels.detail}`;
}
