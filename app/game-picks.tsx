import { useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ScrollView,
  Text,
  View,
} from "react-native";

export default function GamePicksScreen() {
  const params = useLocalSearchParams();

  let game: any = null;

  try {
    game = params.game
      ? JSON.parse(String(params.game))
      : null;
  } catch {
    game = null;
  }

  const getStrengthColor = (strength: string) => {
    if (strength === "Elite") return "#22c55e";
    if (strength === "Strong") return "#fbbf24";

    return "#93c5fd";
  };

  if (!game) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "rgb(11,15,26)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 18,
          }}
        >
          No game data found
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "rgb(11,15,26)",
        padding: 16,
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 28,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        {game.game}
      </Text>

      <Text
        style={{
          color: "#94a3b8",
          marginBottom: 24,
        }}
      >
        {game.dateLabel}
      </Text>

      {(game.picks || []).map(
        (pick: any, index: number) => (
          <View
            key={index}
            style={{
              backgroundColor: "#1f2937",
              padding: 16,
              borderRadius: 16,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                color: "#64748b",
                marginBottom: 6,
              }}
            >
              Rank #{index + 1}
            </Text>

            <Text
              style={{
                color: "white",
                fontSize: 20,
                fontWeight: "900",
              }}
            >
              {pick.player} — {pick.team}
            </Text>

            <Text
              style={{
                color: "#93c5fd",
                marginTop: 6,
                fontSize: 16,
              }}
            >
              {pick.pick} {pick.line} Points
            </Text>

            <Text
              style={{
                color: getStrengthColor(
                  pick.strength
                ),
                marginTop: 10,
                fontSize: 17,
                fontWeight: "900",
              }}
            >
              {pick.winProbability}% —
              {" "}
              {pick.strength}
            </Text>

            <Text
              style={{
                color: "white",
                marginTop: 8,
              }}
            >
              Projection: {pick.projection}
            </Text>

            <Text
              style={{
                color: "#cbd5e1",
                marginTop: 4,
              }}
            >
              Opportunity: {pick.opportunityScore}
            </Text>

            {pick.reasons?.length > 0 && (
              <>
                <Text
                  style={{
                    color: "#4ade80",
                    marginTop: 10,
                    fontWeight: "800",
                  }}
                >
                  Reasons
                </Text>

                {pick.reasons.map(
                  (
                    reason: string,
                    i: number
                  ) => (
                    <Text
                      key={i}
                      style={{
                        color: "#d1fae5",
                        marginTop: 2,
                      }}
                    >
                      • {reason}
                    </Text>
                  )
                )}
              </>
            )}

            {pick.risks?.length > 0 && (
              <>
                <Text
                  style={{
                    color: "#ef4444",
                    marginTop: 10,
                    fontWeight: "800",
                  }}
                >
                  Risks
                </Text>

                {pick.risks.map(
                  (
                    risk: string,
                    i: number
                  ) => (
                    <Text
                      key={i}
                      style={{
                        color: "#fecaca",
                        marginTop: 2,
                      }}
                    >
                      • {risk}
                    </Text>
                  )
                )}
              </>
            )}
          </View>
        )
      )}
    </ScrollView>
  );
}