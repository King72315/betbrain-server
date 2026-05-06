import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { buildAllPlayerPicksForGame } from "./api";

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

  useEffect(() => {
    loadPicks();
  }, []);

  const loadPicks = async () => {
    try {
      setLoading(true);

      if (!parsedGame) {
        setPicks([]);
        return;
      }

      const allPicks = await buildAllPlayerPicksForGame(parsedGame);
      setPicks(allPicks || []);
    } catch (err) {
      console.log("GAME PICKS ERROR:", err);
      setPicks([]);
    } finally {
      setLoading(false);
    }
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
              {index + 1}. {p.player}
            </Text>

            <Text style={{ color: "white", fontSize: 17, marginBottom: 6 }}>
              BetBrain Pick: {p.side} {p.line} {p.stat}
            </Text>

            <Text style={{ color: "#4ade80", fontSize: 15 }}>
              Projection: {p.projection}
            </Text>

            <Text style={{ color: "#fbbf24", fontSize: 15 }}>
              Edge: {p.edge}
            </Text>

<Text style={{ fontSize: 18 }}>
  {getTier(p.edge)}
</Text>

            <Text style={{ color: "#38bdf8", fontSize: 15 }}>
              Confidence: {p.winProb || p.confidence}%
            </Text>

            <Text style={{ color: "#cbd5e1", fontSize: 13, marginTop: 6 }}>
              {p.reasoning}
            </Text>
          </View>
        ))}
    </ScrollView>
  );
}