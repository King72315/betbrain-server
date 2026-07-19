/**
 * Stable BallDontLie WNBA player IDs for names that are ambiguous or API-noisy.
 */

function cleanKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Verified BDL WNBA player_ids — used when search returns no safe match. */
const STABLE_WNBA_PLAYER_IDS = {
  // Prod-verified 2026-06-26 refresh (525 not legacy 42; 67033 not 528 which is Gabby Williams)
  azurastevens: "525",
  sydneytaylor: "67033",
};

export function resolveStableWnbaPlayerId(playerName = "") {
  const key = cleanKey(playerName);
  if (!key) return "";

  return STABLE_WNBA_PLAYER_IDS[key] || "";
}

export function listStableWnbaPlayerOverrides() {
  return { ...STABLE_WNBA_PLAYER_IDS };
}
