import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";

import {
  ScrollView,
  Text,
  View
} from "react-native";

import { fetchSavedPicks } from "./api";

const SAVED_PICKS_KEY = "BETBRAIN_SAVED_PICKS";

export default function GamePicksScreen() {

const getTier = (edge: number) => {
  if (edge >= 2.5) return '🟢';
  if (edge >= 1.5) return '🟡';
  return '🔴';
};

  const { game } = useLocalSearchParams();
  const parsedGame = game ? JSON.parse(String(game)) : null;

console.log("GAME DATA:", parsedGame);

  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedPicks, setSavedPicks] = useState<any[]>([]);

  useEffect(() => {
  loadPicks();
  loadSavedPicks();
}, []);

  const loadPicks = async () => {
    try {
      setLoading(true);

      if (!parsedGame) {
        setPicks([]);
        return;
      }

      const data = await fetchSavedPicks();

const allPicks = (data.realProps || []).filter((p: any) => {
  const sameId = String(p.gameId) === String(parsedGame.id);

  const sameGame =
    String(p.game || "").toLowerCase() ===
    String(parsedGame.game || "").toLowerCase();

  return sameId || sameGame;
});
      setPicks(allPicks || []);
    } catch (err) {
      console.log("GAME PICKS ERROR:", err);
      setPicks([]);
    } finally {
      setLoading(false);
    }
  };

const loadSavedPicks = async () => {
  const raw = await AsyncStorage.getItem(SAVED_PICKS_KEY);
  setSavedPicks(raw ? JSON.parse(raw) : []);
};

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "rgb(11, 15, 26)",
        padding: 16,
      }}
    >
      <Text style={{ color: "white", fontSize: 30, fontWeight: "900" }}>
        {parsedGame?.AwayTeam} vs {parsedGame?.HomeTeam}
      </Text>

      <Text
        style={{
          color: "#fbbf24",
          fontSize: 16,
          fontWeight: "800",
          marginTop: 6,
          marginBottom: 16,
        }}
      >
        Full Pick Board
      </Text>

      {loading && (
        <Text style={{ color: "white", fontSize: 18 }}>Loading picks...</Text>
      )}

      {!loading && picks.length === 0 && (
        <Text style={{ color: "white", fontSize: 18 }}>
          No valid picks found.
        </Text>
      )}

      {!loading &&
        picks.map((p: any, index: number) => (
          <View
            key={`${p.player}-${p.stat}-${p.line}-${index}`}
            style={{
              backgroundColor: "#1f3a4d",
              padding: 16,
              borderRadius: 14,
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 20,
                fontWeight: "900",
                marginBottom: 4,
              }}
            >
              {index + 1}. {p.player} ({p.team})
            </Text>

            <Text style={{ color: "white", fontSize: 17, marginBottom: 6 }}>
              BetBrain Pick: {p.pick || p.side} {p.line} {p.stat}
            </Text>


            <Text style={{ color: "#4ade80", fontSize: 15 }}>
              Projection: {p.projection}
            </Text>

            <Text style={{ color: "#fbbf24", fontSize: 15 }}>
              Edge: {p.edge}
            </Text>

             <Text style={{ color: "#4ade80", fontSize: 15 }}>
               Last 5 Hit Rate: {p.hitRateLabel || "N/A"}
            </Text>

            <Text style={{ fontSize: 18 }}>
              {getTier(p.edge)}
            </Text>

            <Text style={{ color: "#38bdf8", fontSize: 15 }}>
              Confidence: {p.winProb || p.confidence}%
            </Text>

<Text
  onPress={async () => {
    const alreadySaved = savedPicks.find(
  (sp: any) =>
    sp.player === p.player &&
    sp.stat === p.stat &&
    sp.line === p.line
);

let updated;

if (alreadySaved) {
  updated = savedPicks.filter(
    (sp: any) =>
      !(
        sp.player === p.player &&
        sp.stat === p.stat &&
        sp.line === p.line
      )
  );
} else {
  updated = [
    ...savedPicks,
    {
      ...p,
      id: `${p.gameId}-${p.player}-${p.stat}-${p.line}`,
      result: "Pending",
      savedAt: new Date().toISOString(),
    },
  ];
}

setSavedPicks(updated);
await AsyncStorage.setItem(SAVED_PICKS_KEY, JSON.stringify(updated));
  }}
  style={{
    color: savedPicks.find(
      (sp: any) =>
        sp.player === p.player &&
        sp.stat === p.stat &&
        sp.line === p.line
    )
      ? "#22c55e"
      : "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 10,
  }}
>
  {savedPicks.find(
    (sp: any) =>
      sp.player === p.player &&
      sp.stat === p.stat &&
      sp.line === p.line
  )
    ? "✓ SAVED PICK"
    : "+ SAVE PICK"}
</Text>

            <Text style={{ color: "#cbd5e1", fontSize: 13, marginTop: 6 }}>
              {p.reasoning}
            </Text>
          </View>
        ))}
    </ScrollView>
  );
}