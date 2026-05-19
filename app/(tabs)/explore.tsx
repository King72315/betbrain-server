

import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import {
  fetchSavedPicks,
  refreshSavedPicks,
} from "../api";

export default function ExploreScreen() {
  const router = useRouter();

  const [games, setGames] = useState<any[]>([]);
  const [picksByGame, setPicksByGame] = useState<any>({});
  const [twoManPick, setTwoManPick] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [savedData, setSavedData] = useState<any>(null);

  useEffect(() => {
    loadSaved();
  }, []);

const loadSaved = async () => {
  try {
    setLoading(true);

    const data = await fetchSavedPicks();
    setSavedData(data);
    setSavedData(data);

setGames(
  (data.games || []).sort(
    (a: any, b: any) =>
      new Date(a.time).getTime() - new Date(b.time).getTime()
  )
);


setTwoManPick(data.twoMan || []);
setPicksByGame({});

  } catch (err) {
    console.log("LOAD SAVED ERROR:", err);
    setGames([]);
    setTwoManPick([]);
    setPicksByGame({});
  } finally {
    setLoading(false);
  }
};

const runRefresh = async () => {
  try {
    setLoading(true);

    await refreshSavedPicks();
    await loadSaved();
  } catch (err) {
    console.log("REFRESH ERROR:", err);
  } finally {
    setLoading(false);
  }
};

  const getGameKey = (game: any) =>
  String(game.id || game.oddsEventID || game.GameID || game.gameID || game.game);

  const formatGameTimeCT = (game: any) => {
    const dateValue =
      game.time ||
      game.GameDateTime ||
      game.DateTimeUTC ||
      game.gameDate ||
      game.Day;

    if (!dateValue) return "";

    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return String(dateValue);

    return (
      d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " CT"
    );
  };




  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "rgb(11, 15, 26)",
        padding: 16,
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 34,
          fontWeight: "900",
          marginBottom: 18,
        }}
      >
        🧠 BetBrain Explore
      </Text>

     
          
<TouchableOpacity
  onPress={runRefresh}
  style={{
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 20,
  }}
>
  <Text
    style={{
      color: "white",
      fontWeight: "900",
      fontSize: 16,
      textAlign: "center",
    }}
  >
    Refresh Saved Picks
  </Text>
</TouchableOpacity>

           

      {/* 2 MAN PICK */}
      {twoManPick.length > 0 && (
        <View
          style={{
            backgroundColor: "#29465a",
            padding: 18,
            borderRadius: 16,
            marginBottom: 20,
          }}
        >
          <Text
            style={{
              color: "#fbbf24",
              fontSize: 24,
              fontWeight: "900",
              marginBottom: 10,
            }}
          >
            🔒 2-Man Pick of the Day
          </Text>

          {twoManPick.map((p, index) => (
            <Text
              key={`${p.player}-${p.stat}-${index}`}
              style={{ color: "white", fontSize: 18, marginBottom: 6 }}
            >
              {index + 1}. {p.player} {p.stat} {p.pick} {p.line}
            </Text>
          ))}
        </View>
      )}

      {/* LOADING */}
      {loading && (
        <Text style={{ color: "white", fontSize: 18 }}>
          Loading games...
        </Text>
      )}

      {/* NO GAMES */}
      {!loading && games.length === 0 && (
        <Text style={{ color: "white", fontSize: 18 }}>
          No games found.
        </Text>
      )}

      {/* GAMES LIST */}
      {!loading &&
        games.map((game: any) => {
          const gameKey = getGameKey(game);
    

const sourcePicks =
  savedData?.realProps?.length
    ? savedData.realProps
    : savedData?.gamePicks?.length
    ? savedData.gamePicks
    : savedData?.top3 || [];

console.log("EXPLORE MATCH CHECK:", {
  game,
  sourcePicks,
});

const picks =
  sourcePicks.filter((p: any) => {
    const sameId =
      String(p.gameId) === String(game.id) ||
      String(p.gameId) === String(game.GameID);

    const sameGame =
      String(p.game || "").toLowerCase() ===
      String(game.game || "").toLowerCase();

    return sameId || sameGame;
  }) || [];

          return (
            <TouchableOpacity
              key={gameKey}
              onPress={() => {
                router.push({
                  pathname: "/game-picks",
                  params: { game: JSON.stringify(game) },
                });
              }}
              style={{
                backgroundColor: "#1f3a4d",
                padding: 18,
                borderRadius: 16,
                marginBottom: 18,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 22,
                  fontWeight: "900",
                  marginBottom: 4,
                }}
              >
               {game.game || `${game.away} vs ${game.home}`}
{"\n"}
<Text style={{ color: "#fbbf24", fontSize: 14 }}>
  {new Date(game.time).toLocaleString()}
</Text>
              </Text>

              <Text
                style={{
                  color: "#fbbf24",
                  fontSize: 16,
                  fontWeight: "800",
                  marginBottom: 14,
                }}
              >
                {formatGameTimeCT(game)}
              </Text>

              <Text
                style={{
                  color: "#4ade80",
                  fontSize: 18,
                  fontWeight: "900",
                  marginBottom: 8,
                }}
              >
                🔥 Top Active Player Props
              </Text>

              {picks.length === 0 ? (
                <Text style={{ color: "white", fontSize: 16 }}>
                  No props found for this game yet.
                </Text>
              ) : (
                picks.slice(0, 3).map((p: any, index: number) => (
                  <Text
                    key={`${gameKey}-${p.player}-${p.stat}-${index}`}
                    style={{
                      color: "white",
                      fontSize: 16,
                      marginBottom: 5,
                    }}
                  >
                    {index + 1}. {p.player} {p.stat} {p.pick} {p.line} ({p.winProb || p.confidence}%)
                     — Proj: {p.projection} | Edge: {p.edge}
                  </Text>
                ))
              )}
            </TouchableOpacity>
          );
        })}
    </ScrollView>
  );
}