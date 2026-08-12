import { Redirect } from "expo-router";

/**
 * Legacy standalone WNBA product tab removed from CourtEdge bottom nav.
 * WNBA remains available inside Home (NBA | WNBA selector).
 */
export default function LegacyWnbaTabRedirect() {
  return <Redirect href="/" />;
}
