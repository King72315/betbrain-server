export const WNBA_WINNER_VERSION = "courtedge-wnba-winner-v1";
export const WNBA_WINNER_READER_VERSION = "courtedge-wnba-winner-reader-v1";
export const WNBA_WINNER_MODEL_VERSION = "courtedge-wnba-winner-model-v1";
export const WNBA_WINNER_C_VERSION = "COURTEDGE_WINNER_C_PRODUCTION_V1";

export const TRACKING = Object.freeze({
  OFFICIAL: "OFFICIAL",
  TEST: "TEST",
  NO_PICK: "NO_PICK",
});

export const MAX_TOP_WINNERS = 3;

export const P_BANDS = [
  { key: "50-54.9", lo: 0.5, hi: 0.549 },
  { key: "55-59.9", lo: 0.55, hi: 0.599 },
  { key: "60-64.9", lo: 0.6, hi: 0.649 },
  { key: "65-69.9", lo: 0.65, hi: 0.699 },
  { key: "70-74.9", lo: 0.7, hi: 0.749 },
  { key: "75+", lo: 0.75, hi: 1.001 },
];

export const TEAM_ALIASES = {
  atl: "ATL", atlanta: "ATL", "atlantadream": "ATL",
  chi: "CHI", chicago: "CHI", "chicagosky": "CHI",
  con: "CON", connecticut: "CON", "connecticutsun": "CON",
  dal: "DAL", dallas: "DAL", "dallaswings": "DAL",
  gsv: "GSV", gs: "GSV", goldenstate: "GSV", "goldenstatevalkyries": "GSV", valkyries: "GSV",
  ind: "IND", indiana: "IND", "indianafever": "IND",
  las: "LAS", la: "LAS", losangeles: "LAS", "losangelessparks": "LAS", sparks: "LAS",
  lva: "LVA", lv: "LVA", lasvegas: "LVA", "lasvegasaces": "LVA", aces: "LVA",
  min: "MIN", minnesota: "MIN", "minnesotalynx": "MIN", lynx: "MIN",
  ny: "NYL", nyl: "NYL", newyork: "NYL", "newyorkliberty": "NYL", liberty: "NYL",
  pho: "PHO", phx: "PHO", phoenix: "PHO", "phoenixmercury": "PHO", mercury: "PHO",
  por: "POR", portland: "POR", "portlandfire": "POR",
  sea: "SEA", seattle: "SEA", "seattlestorm": "SEA", storm: "SEA",
  tor: "TOR", toronto: "TOR", "torontotempo": "TOR", tempo: "TOR",
  wsh: "WAS", was: "WAS", washington: "WAS", "washingtonmystics": "WAS", mystics: "WAS",
};

export function cleanTeam(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeWnbaTeam(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = cleanTeam(raw);
  if (TEAM_ALIASES[cleaned]) return TEAM_ALIASES[cleaned];
  const upper = raw.toUpperCase();
  if (["ATL", "CHI", "CON", "DAL", "GSV", "IND", "LAS", "LVA", "MIN", "NYL", "NY", "PHO", "POR", "SEA", "TOR", "WAS", "WSH"].includes(upper)) {
    if (upper === "NY") return "NYL";
    if (upper === "WSH") return "WAS";
    return upper;
  }
  const hasTor = cleaned.includes("toronto") || cleaned.includes("tempo");
  const hasSea = cleaned.includes("seattle") || (cleaned.includes("storm") && !cleaned.includes("tempo"));
  if (hasTor && hasSea) return null;
  return null;
}

export function slateDateCT(iso = new Date()) {
  const d = iso instanceof Date ? iso : new Date(iso);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function formatTipCT(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function americanToImplied(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : -o / (-o + 100);
}

export function noVigPair(impA, impB) {
  if (impA == null || impB == null) return { a: null, b: null };
  const s = impA + impB;
  if (!(s > 0)) return { a: null, b: null };
  return { a: impA / s, b: impB / s };
}

export function clampProb(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.999, Math.max(0.001, n));
}

export function normalizePair(pHome) {
  const h = clampProb(pHome);
  return { pHome: h, pAway: Number((1 - h).toFixed(6)), rawHome: h };
}

export function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

export function brier(p, win) {
  return (p - (win ? 1 : 0)) ** 2;
}

export function logLoss(p, win) {
  const q = clampProb(p);
  return -(win ? Math.log(q) : Math.log(1 - q));
}

export function normalizeBookId(id = "") {
  const s = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!s) return null;
  if (s.includes("draftking") || s === "dk") return "draftkings";
  if (s.includes("fanduel") || s === "fd") return "fanduel";
  if (s.includes("betmgm") || s === "mgm") return "betmgm";
  if (s.includes("caesar") || s === "czr") return "caesars";
  if (s.includes("pinnacle")) return "pinnacle";
  if (s.includes("pointsbet")) return "pointsbet";
  if (s.includes("fanatics")) return "fanatics";
  if (s.includes("bet365")) return "bet365";
  if (s.includes("prizepick")) return "prizepicks";
  if (s.includes("underdog")) return "underdog";
  return s;
}
