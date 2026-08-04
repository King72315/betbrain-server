import { Tabs } from "expo-router";
import React from "react";

/**
 * CourtEdge navigation V2:
 * Home → WNBA → Results → Tennis → History
 * Top and Lab remain hidden from active product chrome.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#020617",
          borderTopColor: "#1e293b",
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#22c55e",
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "900",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
        }}
      />

      <Tabs.Screen
        name="wnba"
        options={{
          title: "WNBA",
        }}
      />

      <Tabs.Screen
        name="results"
        options={{
          title: "Results",
        }}
      />

      <Tabs.Screen
        name="tennis-results"
        options={{
          title: "Tennis",
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: "History",
        }}
      />

      <Tabs.Screen
        name="top-props"
        options={{
          title: "Top",
          href: null,
        }}
      />

      <Tabs.Screen
        name="prop-lab"
        options={{
          title: "Lab",
          href: null,
        }}
      />

      <Tabs.Screen
        name="view-picks"
        options={{
          title: "Saved",
          href: null,
        }}
      />

      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="nba"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
