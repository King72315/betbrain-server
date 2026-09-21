/**
 * Research-only WNBA team identity.
 * Exact alias map only — no substring matching that can map Toronto → SEA.
 * Does not replace production normalizeWnbaTeam.
 */
export const RESEARCH_TEAM_IDENTITY_BUILD = "courteedge-research-team-identity-v1";

export const EXACT_ALIASES = Object.freeze({
  atl: "ATL",
  atlanta: "ATL",
  atlantadream: "ATL",
  chi: "CHI",
  chicago: "CHI",
  chicagosky: "CHI",
  con: "CON",
  connecticut: "CON",
  connecticutsun: "CON",
  dal: "DAL",
  dallas: "DAL",
  dallaswings: "DAL",
  gsv: "GSV",
  gs: "GSV",
  goldenstate: "GSV",
  goldenstatevalkyries: "GSV",
  valkyries: "GSV",
  ind: "IND",
  indiana: "IND",
  indianafever: "IND",
  las: "LAS",
  la: "LAS",
  losangeles: "LAS",
  losangelessparks: "LAS",
  sparks: "LAS",
  lva: "LVA",
  lv: "LVA",
  lasvegas: "LVA",
  lasvegasaces: "LVA",
  aces: "LVA",
  min: "MIN",
  minnesota: "MIN",
  minnesotalynx: "MIN",
  lynx: "MIN",
  ny: "NYL",
  nyl: "NYL",
  newyork: "NYL",
  newyorkliberty: "NYL",
  liberty: "NYL",
  pho: "PHO",
  phx: "PHO",
  phoenix: "PHO",
  phoenixmercury: "PHO",
  mercury: "PHO",
  por: "POR",
  portland: "POR",
  portlandfire: "POR",
  sea: "SEA",
  seattle: "SEA",
  seattlestorm: "SEA",
  storm: "SEA",
  tor: "TOR",
  toronto: "TOR",
  torontotempo: "TOR",
  tempo: "TOR",
  wsh: "WAS",
  was: "WAS",
  washington: "WAS",
  washingtonmystics: "WAS",
  mystics: "WAS",
});

const CODES = new Set([
  "ATL",
  "CHI",
  "CON",
  "DAL",
  "GSV",
  "IND",
  "LAS",
  "LVA",
  "MIN",
  "NYL",
  "NY",
  "PHO",
  "POR",
  "SEA",
  "TOR",
  "WAS",
  "WSH",
]);

export function cleanTeam(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function aliasContaminationFlags(value = "") {
  const cleaned = cleanTeam(value);
  const flags = [];
  if (!cleaned) return flags;
  const hasTor = cleaned.includes("toronto") || cleaned === "tor" || cleaned.includes("tempo");
  const hasSea = cleaned.includes("seattle") || cleaned === "sea" || (cleaned.includes("storm") && !cleaned.includes("tempo"));
  if (hasTor && hasSea) flags.push("TOR_SEA_COMPOSITE");
  if (cleaned === "torontostorm" || cleaned === "stormtoronto") flags.push("TOR_SEA_COMPOSITE");
  return flags;
}

export function normalizeWnbaTeamExact(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { id: null, method: "EMPTY", flags: [] };
  const flags = aliasContaminationFlags(raw);
  const cleaned = cleanTeam(raw);
  if (EXACT_ALIASES[cleaned]) {
    return { id: EXACT_ALIASES[cleaned], method: "EXACT_ALIAS", flags };
  }
  const upper = raw.toUpperCase();
  if (CODES.has(upper)) {
    const id = upper === "NY" ? "NYL" : upper === "WSH" ? "WAS" : upper;
    return { id, method: "EXACT_CODE", flags };
  }
  return { id: null, method: "UNRESOLVED", flags: [...flags, "UNRESOLVED_TEAM"] };
}
