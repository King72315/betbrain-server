import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { resolveSavedPicks } from "./api";

const SAVED_PICKS_KEY = "BETBRAIN_SAVED_PICKS";

export default function ViewPicksScreen() {
  const [picks, setPicks] = useState<any[]>([]);
const [filter, setFilter] = useState("All");

  useEffect(() => {
  const autoResolve = async () => {
    await resolveSavedPicks();
    await loadPicks();
  };

  autoResolve();

  const interval = setInterval(() => {
    autoResolve();
  }, 300000);

  return () => clearInterval(interval);

}, []);

  const loadPicks = async () => {
    const raw = await AsyncStorage.getItem(SAVED_PICKS_KEY);
    setPicks(raw ? JSON.parse(raw) : []);
  };

  const updateResult = async (id: string, result: string) => {
    const updated = picks.map((p) =>
      p.id === id ? { ...p, result } : p
    );

    setPicks(updated);
    await AsyncStorage.setItem(SAVED_PICKS_KEY, JSON.stringify(updated));
  };

  const deletePick = async (id: string) => {
    const updated = picks.filter((p) => p.id !== id);
    setPicks(updated);
    await AsyncStorage.setItem(SAVED_PICKS_KEY, JSON.stringify(updated));
  };

  const wins = picks.filter((p) => p.result === "Win").length;
  const losses = picks.filter((p) => p.result === "Loss").length;
  const pending = picks.filter((p) => p.result === "Pending").length;
  const unitsWon = wins * 1;
const unitsLost = losses * 1;
const netUnits = unitsWon - unitsLost;

const gradedPicks = picks.filter((p) => p.result === "Win" || p.result === "Loss");

let streakType = "";
let streakCount = 0;

for (let i = gradedPicks.length - 1; i >= 0; i--) {
  const result = gradedPicks[i].result;

  if (!streakType) {
    streakType = result;
    streakCount = 1;
  } else if (result === streakType) {
    streakCount++;
  } else {
    break;
  }
}

const streakLabel =
  streakCount > 0
    ? `${streakType === "Win" ? "W" : "L"}${streakCount}`
    : "None";

const filteredPicks =
  filter === "All"
    ? picks
    : picks.filter((p) => p.result === filter);

  const graded = wins + losses;
  const winRate = graded ? Math.round((wins / graded) * 100) : 0;

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "rgb(11, 15, 26)",
        padding: 16,
      }}
    >
      <Text style={{ color: "white", fontSize: 32, fontWeight: "900" }}>
        📊 Saved Picks
      </Text>

      <Text
        style={{
          color: "#fbbf24",
          fontSize: 16,
          fontWeight: "800",
          marginTop: 8,
          marginBottom: 16,
        }}
      >
       Record: {wins}-{losses} | Pending: {pending} | Win Rate: {winRate}% | Net Units: 
       {netUnits > 0 ? "+" : ""}{netUnits} | Streak: {streakLabel}
      </Text>

<View
  style={{
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  }}
>
  {["All", "Win", "Loss", "Pending"].map((type) => (
    <TouchableOpacity
      key={type}
      onPress={() => setFilter(type)}
      style={{
        backgroundColor:
          filter === type ? "#fbbf24" : "#1f3a4d",
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 10,
      }}
    >
      <Text
        style={{
          color: filter === type ? "black" : "white",
          fontWeight: "800",
        }}
      >
        {type}
      </Text>
    </TouchableOpacity>
  ))}
</View>

      {picks.length === 0 && (
        <Text style={{ color: "white", fontSize: 18 }}>
          No saved picks yet.
        </Text>
      )}

      {filteredPicks.map((p) => (
        <View
          key={p.id}
          style={{
            backgroundColor: "#1f3a4d",
            padding: 16,
            borderRadius: 14,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>
            {p.player}
          </Text>

          <Text style={{ color: "#cbd5e1", fontSize: 14 }}>
            {p.game}
          </Text>

          <Text style={{ color: "white", fontSize: 16, marginTop: 6 }}>
            Pick: {p.side} {p.sportsbookLine} {p.stat}
          </Text>

    <Text style={{ color: "white", fontSize: 16, marginTop: 6 }}>
  Pick: {p.side || p.pick} {p.line} {p.stat}
</Text>

<Text style={{ color: "#4ade80", fontSize: 14 }}>
  Projection: {p.projection}
</Text>

<Text style={{ color: "#fbbf24", fontSize: 14 }}>
  Line: {p.line}
</Text>

<Text style={{ color: "#f59e0b", fontSize: 14 }}>
  Edge: +{p.edge}
</Text>

<Text style={{ color: "#38bdf8", fontSize: 14 }}>
  Confidence: {p.confidence}%
</Text>

<Text style={{ color: "#cbd5e1", fontSize: 14 }}>
  Need:
  {(p.side || p.pick) === "Over"
    ? ` ${Math.floor(Number(p.line) + 1)}+ ${p.stat}`
    : ` ${p.line} or less ${p.stat}`}
</Text>

<Text style={{ color: "#a78bfa", fontSize: 14 }}>
  Actual: {p.actualStat || "Pending"}
</Text>

          <Text
            style={{
              color:
                p.result === "Win"
                  ? "#22c55e"
                  : p.result === "Loss"
                  ? "#ef4444"
                  : "white",
              fontSize: 16,
              fontWeight: "900",
              marginTop: 8,
            }}
          >
            Result: {p.result}
          </Text>

          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => updateResult(p.id, "Win")}
              style={{
                flex: 1,
                backgroundColor: "#22c55e",
                padding: 10,
                borderRadius: 10,
                marginRight: 8,
              }}
            >
              <Text
                style={{
                  color: "#052e16",
                  textAlign: "center",
                  fontWeight: "900",
                }}
              >
                Win
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => updateResult(p.id, "Loss")}
              style={{
                flex: 1,
                backgroundColor: "#ef4444",
                padding: 10,
                borderRadius: 10,
              }}
            >
              <Text
                style={{
                  color: "white",
                  textAlign: "center",
                  fontWeight: "900",
                }}
              >
                Loss
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => deletePick(p.id)}
            style={{
              backgroundColor: "#7f1d1d",
              padding: 10,
              borderRadius: 10,
              marginTop: 10,
            }}
          >
            <Text
              style={{
                color: "white",
                textAlign: "center",
                fontWeight: "900",
              }}
            >
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}