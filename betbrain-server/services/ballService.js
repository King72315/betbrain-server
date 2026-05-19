import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const API_KEY = CONFIG.BALLDONTLIE_KEY;

function clean(str = "") {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function fetchLast5(playerName) {
  try {
    if (!API_KEY) return [];

    const playerSearch =
      await fetch(
        `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(playerName)}`,
        {
          headers: {
            Authorization: API_KEY,
          },
        }
      );

    const playerData =
      await playerSearch.json();

    const player =
      playerData?.data?.[0];

    if (!player) return [];

    const gamesRequest =
      await fetch(
        `https://api.balldontlie.io/v1/stats?player_ids[]=${player.id}&per_page=5`,
        {
          headers: {
            Authorization: API_KEY,
          },
        }
      );

    const stats =
      await gamesRequest.json();

    return (
      stats?.data?.map(
        (g) => ({
          pts: g.pts || 0,
          min:
            Number(
              g.min
            ) || 0,
          fga:
            g.fga || 0,
          fgm:
            g.fgm || 0,
          date:
            g.game?.date,
        })
      ) || []
    );
  } catch (err) {
    console.log(
      "LAST5 ERROR:",
      err.message
    );

    return [];
  }
}

export async function fetchLast3VsOpponent(
  playerName,
  opponent
) {
  try {
    const allGames =
      await fetchLast5(
        playerName
      );

    return allGames
      .filter((g) =>
        clean(
          g.opponent
        ).includes(
          clean(
            opponent
          )
        )
      )
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function summarizeScoringProfile(
  games
) {
  if (
    !games?.length
  )
    return {
      average: 0,
      high: 0,
      low: 0,
    };

  const pts =
    games.map(
      (g) => g.pts
    );

  return {
    average:
      pts.reduce(
        (a, b) =>
          a + b,
        0
      ) /
      pts.length,

    high:
      Math.max(
        ...pts
      ),

    low:
      Math.min(
        ...pts
      ),
  };
}