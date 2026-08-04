import { Tabs } from "expo-router";
import React from "react";

/**
 * CourtEdge navigation lock V1:
 * Home → Results → History
 * Top and Lab tabs removed from active product.
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
        name="top-props"
        options={{
          title: "Top",
          href: null,
        }}
      />

      <Tabs.Screen
        name="results"
        options={{
          title: "Results",
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
        name="history"
        options={{
          title: "History",
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
        name="wnba"
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
