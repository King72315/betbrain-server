/**
 * Canonical WNBA team IDs and alias resolution for matchup / slate alignment.
 * Keys match oddsService normalizeTeam output (e.g. chicagosky, portlandfire).
 */

function cleanKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const WNBA_TEAMS = [
  {
    id: "atlantadream",
    display: "Atlanta Dream",
    abbreviations: ["atl", "dream"],
    aliases: ["atlantadream", "atlanta dream"],
  },
  {
    id: "chicagosky",
    display: "Chicago Sky",
    abbreviations: ["chi", "sky"],
    aliases: ["chicagosky", "chicago sky", "chicagosky"],
  },
  {
    id: "connecticutsun",
    display: "Connecticut Sun",
    abbreviations: ["con", "conn", "sun"],
    aliases: ["connecticutsun", "connecticut sun"],
  },
  {
    id: "dallaswings",
    display: "Dallas Wings",
    abbreviations: ["dal", "wings"],
    aliases: ["dallaswings", "dallas wings"],
  },
  {
    id: "goldenstatevalkyries",
    display: "Golden State Valkyries",
    abbreviations: ["gs", "gsv", "valkyries"],
    aliases: ["goldenstatevalkyries", "golden state valkyries"],
  },
  {
    id: "indianafever",
    display: "Indiana Fever",
    abbreviations: ["ind", "fever"],
    aliases: ["indianafever", "indiana fever"],
  },
  {
    id: "lasvegasaces",
    display: "Las Vegas Aces",
    abbreviations: ["lv", "lva", "las", "aces"],
    aliases: ["lasvegasaces", "las vegas aces"],
  },
  {
    id: "losangelessparks",
    display: "Los Angeles Sparks",
    abbreviations: ["la", "lasparks", "sparks"],
    aliases: ["losangelessparks", "los angeles sparks"],
  },
  {
    id: "minnesotalynx",
    display: "Minnesota Lynx",
    abbreviations: ["min", "lynx"],
    aliases: ["minnesotalynx", "minnesota lynx"],
  },
  {
    id: "newyorkliberty",
    display: "New York Liberty",
    abbreviations: ["ny", "nyl", "liberty"],
    aliases: ["newyorkliberty", "new york liberty"],
  },
  {
    id: "phoenixmercury",
    display: "Phoenix Mercury",
    abbreviations: ["phx", "pho", "mercury"],
    aliases: ["phoenixmercury", "phoenix mercury"],
  },
  {
    id: "portlandfire",
    display: "Portland Fire",
    abbreviations: ["por", "fire"],
    aliases: ["portlandfire", "portland fire"],
  },
  {
    id: "seattlestorm",
    display: "Seattle Storm",
    abbreviations: ["sea", "storm"],
    aliases: ["seattlestorm", "seattle storm"],
  },
  {
    id: "torontotempo",
    display: "Toronto Tempo",
    abbreviations: ["tor", "tempo"],
    aliases: ["torontotempo", "toronto tempo"],
  },
  {
    id: "washingtonmystics",
    display: "Washington Mystics",
    abbreviations: ["was", "wash", "mystics"],
    aliases: ["washingtonmystics", "washington mystics"],
  },
];

const ALIAS_TO_ID = new Map();

for (const team of WNBA_TEAMS) {
  const keys = new Set([
    team.id,
    cleanKey(team.id),
    cleanKey(team.display),
    ...team.abbreviations.map(cleanKey),
    ...team.aliases.map(cleanKey),
  ]);
  for (const key of keys) {
    if (key) ALIAS_TO_ID.set(key, team.id);
  }
}

export function resolveWnbaTeamId(input = "") {
  if (!input) return "";

  if (typeof input === "object") {
    const fromAbbr = cleanKey(input.abbreviation || "");
    const fromName = cleanKey(
      `${input.city || ""}${input.name || ""}${input.full_name || ""}`
    );
    const fromId = input.id != null ? cleanKey(String(input.id)) : "";

    return (
      ALIAS_TO_ID.get(fromAbbr) ||
      ALIAS_TO_ID.get(fromName) ||
      ALIAS_TO_ID.get(fromId) ||
      ALIAS_TO_ID.get(cleanKey(input.display || "")) ||
      ""
    );
  }

  const key = cleanKey(input);
  if (!key) return "";

  const resolved = ALIAS_TO_ID.get(key);
  if (resolved) return resolved;
  if (WNBA_TEAMS.some((t) => t.id === key)) return key;
  return "";
}

export function teamsMatch(teamA = "", teamB = "") {
  const a = resolveWnbaTeamId(teamA);
  const b = resolveWnbaTeamId(teamB);

  if (!a || !b) {
    return cleanKey(teamA) === cleanKey(teamB);
  }

  return a === b;
}

export function formatWnbaTeamDisplay(teamId = "") {
  const id = resolveWnbaTeamId(teamId) || cleanKey(teamId);
  const team = WNBA_TEAMS.find((t) => t.id === id);
  return team?.display || String(teamId || "");
}

export function listWnbaTeamAliases(teamId = "") {
  const id = resolveWnbaTeamId(teamId);
  const team = WNBA_TEAMS.find((t) => t.id === id);
  if (!team) return [cleanKey(teamId)].filter(Boolean);

  return [
    team.id,
    team.display,
    ...team.abbreviations,
    ...team.aliases,
  ].filter(Boolean);
}

export function getWnbaTeamRegistry() {
  return WNBA_TEAMS.map((t) => ({ ...t }));
}
