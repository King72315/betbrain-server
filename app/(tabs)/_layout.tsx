import { Tabs } from "expo-router";
import React from "react";

import {
  COURTEDGE_BOTTOM_TAB_ROUTE_NAMES_V1,
  COURTEDGE_BOTTOM_TAB_TITLES_V1,
} from "../../utils/courtEdgeNavigationV1";

/**
 * CourtEdge bottom navigation V1 (lifecycle):
 * Home → Results → Lab → History
 *
 * WNBA is a league selector inside Home (not a product tab).
 * Tennis product screens are not CourtEdge destinations.
 */
export {
  COURTEDGE_BOTTOM_TAB_ROUTE_NAMES_V1 as COURTEDGE_BOTTOM_TABS_V1_ROUTES,
  COURTEDGE_BOTTOM_TAB_TITLES_V1 as COURTEDGE_BOTTOM_TABS_V1,
};

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
        name="results"
        options={{
          title: "Results",
        }}
      />

      <Tabs.Screen
        name="prop-lab"
        options={{
          title: "Lab",
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: "History",
        }}
      />

      {/* Legacy / non-product routes — not bottom-nav destinations */}
      <Tabs.Screen
        name="wnba"
        options={{
          title: "WNBA",
          href: null,
        }}
      />

      <Tabs.Screen
        name="tennis-results"
        options={{
          title: "Tennis",
          href: null,
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
