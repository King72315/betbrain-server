/**
 * Cross-provider identity normalization for CourtEdge.
 * Never join solely on unnormalized display names when IDs exist.
 */

const IDENTITY_CACHE = new Map();
const CACHE_MS = 60 * 60 * 1000;

export const PROVIDER_IDENTITY_VERSION = "provider-identity-v1";

export function normalizePersonName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTeamName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(wnba|nba|basketball)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function nameTokens(name = "") {
  return normalizePersonName(name).split(" ").filter(Boolean);
}

/**
 * Strict identity match — refuse weak fuzzy joins.
 * Returns confidence 0–1 and whether attach is allowed.
 */
export function scoreNameMatch(a = "", b = "") {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) {
    return { confidence: 0, allowAttach: false, reason: "empty_name" };
  }
  if (na === nb) {
    return { confidence: 1, allowAttach: true, reason: "exact" };
  }

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length >= 2 && tb.length >= 2) {
    const lastA = ta[ta.length - 1];
    const lastB = tb[tb.length - 1];
    const firstA = ta[0];
    const firstB = tb[0];
    if (lastA === lastB && firstA === firstB) {
      return { confidence: 0.98, allowAttach: true, reason: "first_last_exact" };
    }
    if (lastA === lastB && (firstA[0] === firstB[0] || firstA.startsWith(firstB) || firstB.startsWith(firstA))) {
      // Initial / prefix — require team confirmation before attach
      return {
        confidence: 0.72,
        allowAttach: false,
        reason: "last_exact_first_weak_needs_team",
      };
    }
  }

  return { confidence: 0.2, allowAttach: false, reason: "ambiguous" };
}

export function scoreTeamMatch(a = "", b = "") {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) {
    return { confidence: 0, allowAttach: false, reason: "empty_team" };
  }
  if (na === nb) {
    return { confidence: 1, allowAttach: true, reason: "exact" };
  }
  if (na.includes(nb) || nb.includes(na)) {
    return { confidence: 0.9, allowAttach: true, reason: "contains" };
  }
  return { confidence: 0.15, allowAttach: false, reason: "mismatch" };
}

/**
 * Build identity record. Refuses attach when name match is weak without IDs.
 */
export function buildProviderIdentity({
  playerName = "",
  team = "",
  opponent = "",
  league = "WNBA",
  oddsEventId = null,
  bdlPlayerId = null,
  sportsDataPlayerId = null,
  bdlTeamId = null,
  sportsDataTeamId = null,
  oddsPlayerName = null,
  bdlPlayerName = null,
  sportsDataPlayerName = null,
} = {}) {
  const oddsName = oddsPlayerName || playerName;
  const bdlName = bdlPlayerName || null;
  const sdName = sportsDataPlayerName || null;

  let nameMatch = { confidence: null, allowAttach: true, reason: null };
  let unresolved = null;

  if (bdlPlayerId) {
    nameMatch = { confidence: 1, allowAttach: true, reason: "bdl_id" };
  } else if (bdlName) {
    nameMatch = scoreNameMatch(oddsName, bdlName);
    const teamMatch = scoreTeamMatch(team, team);
    if (!nameMatch.allowAttach) {
      if (nameMatch.reason === "last_exact_first_weak_needs_team" && teamMatch.allowAttach) {
        nameMatch = {
          confidence: 0.85,
          allowAttach: true,
          reason: "weak_name_confirmed_by_team",
        };
      } else {
        unresolved = `bdl_name_match_refused:${nameMatch.reason}`;
      }
    }
  }

  if (sportsDataPlayerId && !bdlPlayerId) {
    // SportsData attach only with ID — never name-only for generation joins
  } else if (sdName && !sportsDataPlayerId) {
    const sdMatch = scoreNameMatch(oddsName, sdName);
    if (!sdMatch.allowAttach) {
      unresolved = unresolved || `sportsdata_name_match_refused:${sdMatch.reason}`;
    }
  }

  const teamMatch = scoreTeamMatch(team, team);

  const identity = {
    version: PROVIDER_IDENTITY_VERSION,
    canonicalPlayerId: bdlPlayerId
      ? `bdl:${league}:${bdlPlayerId}`
      : sportsDataPlayerId
        ? `sd:${league}:${sportsDataPlayerId}`
        : oddsName
          ? `name:${league}:${normalizePersonName(oddsName)}`
          : null,
    oddsPlayerName: oddsName || null,
    bdlPlayerId: bdlPlayerId || null,
    sportsDataPlayerId: sportsDataPlayerId || null,
    canonicalTeamId: bdlTeamId
      ? `bdl-team:${bdlTeamId}`
      : team
        ? `name-team:${normalizeTeamName(team)}`
        : null,
    bdlTeamId: bdlTeamId || null,
    sportsDataTeamId: sportsDataTeamId || null,
    oddsEventId: oddsEventId || null,
    providerGameIds: {
      odds: oddsEventId || null,
      bdl: null,
      sportsData: null,
    },
    team: team || null,
    opponent: opponent || null,
    normalizedOpponent: opponent ? normalizeTeamName(opponent) : null,
    nameMatchConfidence: nameMatch.confidence,
    teamMatchConfidence: teamMatch.confidence,
    unresolvedIdentityReason: unresolved,
    attachAllowed: !unresolved || Boolean(bdlPlayerId),
  };

  const cacheKey = identity.canonicalPlayerId || normalizePersonName(oddsName);
  if (cacheKey) {
    IDENTITY_CACHE.set(cacheKey, { loadedAt: Date.now(), identity });
  }

  if (unresolved) {
    console.warn("COURTEDGE_IDENTITY_UNRESOLVED", {
      player: oddsName,
      team,
      reason: unresolved,
      nameMatchConfidence: nameMatch.confidence,
    });
  }

  return identity;
}

export function getCachedIdentity(canonicalPlayerId) {
  const hit = IDENTITY_CACHE.get(canonicalPlayerId);
  if (!hit) return null;
  if (Date.now() - hit.loadedAt > CACHE_MS) {
    IDENTITY_CACHE.delete(canonicalPlayerId);
    return null;
  }
  return hit.identity;
}

export function clearIdentityCache() {
  IDENTITY_CACHE.clear();
}
