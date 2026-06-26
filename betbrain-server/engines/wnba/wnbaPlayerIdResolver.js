/**
 * Stable BallDontLie WNBA player IDs for names that are ambiguous or API-noisy.
 */

function cleanKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Verified BDL WNBA player_ids — used when search returns no safe match. */
const STABLE_WNBA_PLAYER_IDS = {
  azurastevens: "42",
  sydneytaylor: "528",
};

export function resolveStableWnbaPlayerId(playerName = "") {
  const key = cleanKey(playerName);
  if (!key) return "";

  return STABLE_WNBA_PLAYER_IDS[key] || "";
}

export function listStableWnbaPlayerOverrides() {
  return { ...STABLE_WNBA_PLAYER_IDS };
}
