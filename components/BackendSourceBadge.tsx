import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  ensureActiveBackend,
  formatBackendBadgeLabel,
  type ApiEndpointDiagnostics,
} from "../lib/apiEndpointResolver.js";

/**
 * Dev-only indicator of which backend CourtEdge is reading.
 * Hidden in production builds.
 */
export default function BackendSourceBadge() {
  const [diag, setDiag] = useState<ApiEndpointDiagnostics | null>(null);

  useEffect(() => {
    if (typeof __DEV__ !== "undefined" && !__DEV__) return;
    let cancelled = false;
    ensureActiveBackend()
      .then((next) => {
        if (!cancelled) setDiag(next);
      })
      .catch(() => {
        if (!cancelled) setDiag(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return null;
  }

  const label = formatBackendBadgeLabel(diag);
  const isLocal = diag?.activeBackend === "LOCAL";
  const isFallback = Boolean(diag?.fallbackUsed);

  return (
    <View
      style={[
        styles.badge,
        isLocal ? styles.local : isFallback ? styles.fallback : styles.render,
      ]}
    >
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  local: {
    backgroundColor: "#052e16",
    borderColor: "#16a34a",
  },
  render: {
    backgroundColor: "#0f172a",
    borderColor: "#475569",
  },
  fallback: {
    backgroundColor: "#3b1c0a",
    borderColor: "#ea580c",
  },
  text: {
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
