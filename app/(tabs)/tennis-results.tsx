import { Redirect } from "expo-router";

/**
 * TennisEdge is a separate BetBrain product.
 * CourtEdge must not expose a Tennis navigation destination.
 * Deep links to this legacy route bounce to CourtEdge Home.
 */
export default function LegacyTennisTabRedirect() {
  return <Redirect href="/" />;
}
