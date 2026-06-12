import { useEffect, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { getApiBaseUrl, refreshSavedPicks, resolvePicks } from "../../services/api";

export default function Settings() {
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    checkBackend();
  }, []);

  const checkBackend = async () => {
    try {
      setChecking(true);

      const res = await fetch(`${getApiBaseUrl()}/health`);
      const data = await res.json();

      setHealth(data);

      if (data.ok) {
        console.log("COURTEDGE HEALTH:", data);
      } else {
        console.log("COURTEDGE HEALTH ISSUE:", data);
      }
    } catch (err) {
      console.log("BACKEND HEALTH ERROR:", err);

      setHealth({
        ok: false,
        message: "Backend connection failed",
        error: String(err),
      });
    } finally {
      setChecking(false);
    }
  };

  const runRefresh = async () => {
    try {
      setRefreshing(true);

      const data = await refreshSavedPicks();

      if (data.ok) {
        Alert.alert("Refresh Complete ✅", "CourtEdge picks refreshed.");
      } else {
        Alert.alert("Refresh Failed", data.message || data.error || "Unknown error");
      }

      await checkBackend();
    } catch (err) {
      Alert.alert("Refresh Failed", String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const runResolve = async () => {
    try {
      setResolving(true);

      const data = await resolvePicks();

      if (data.ok) {
        Alert.alert("Resolve Complete ✅", data.message || "Saved picks checked.");
      } else {
        Alert.alert("Resolve Failed", data.message || data.error || "Unknown error");
      }
    } catch (err) {
      Alert.alert("Resolve Failed", String(err));
    } finally {
      setResolving(false);
    }
  };

  const config = health?.config || {};

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>⚙️ Settings</Text>
          <Text style={styles.subtitle}>CourtEdge — Powered by BetBrain</Text>
          <Text style={styles.motto}>
            Backend keys stay in the server .env file. The app only talks to the
            backend.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backend Connection</Text>

          <InfoRow label="API URL" value={getApiBaseUrl()} />
          <InfoRow
            label="Status"
            value={checking ? "Checking..." : health?.ok ? "Online ✅" : "Offline ❌"}
            valueColor={health?.ok ? "#22c55e" : "#ef4444"}
          />

          {health?.message || health?.error ? (
            <Text style={styles.errorText}>
              {health.message || health.error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={styles.button}
            onPress={checkBackend}
            disabled={checking}
          >
            <Text style={styles.buttonText}>
              {checking ? "Checking..." : "Check Backend Health"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Loaded Keys</Text>

          <InfoRow
            label="SportsData"
            value={config.sportsKeyLoaded || "Unknown"}
            valueColor={config.sportsKeyLoaded === "YES" ? "#22c55e" : "#ef4444"}
          />

          <InfoRow
            label="Odds API"
            value={config.oddsKeyLoaded || "Unknown"}
            valueColor={config.oddsKeyLoaded === "YES" ? "#22c55e" : "#ef4444"}
          />

          <InfoRow
            label="BallDontLie"
            value={config.ballKeyLoaded || "Unknown"}
            valueColor={config.ballKeyLoaded === "YES" ? "#22c55e" : "#ef4444"}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>CourtEdge Rules</Text>

          <InfoRow label="Top Prop Limit" value={config.topPropLimit ?? "—"} />
          <InfoRow
            label="Premium Minimum"
            value={`${config.premiumConfidenceMin ?? "—"}%`}
          />
          <InfoRow
            label="Watchlist Minimum"
            value={`${config.watchlistConfidenceMin ?? "—"}%`}
          />
          <InfoRow label="NBA Enabled" value={String(config.nbaEnabled ?? "—")} />
          <InfoRow label="WNBA Enabled" value={String(config.wnbaEnabled ?? "—")} />
          <InfoRow label="Timezone" value={config.timezone || "—"} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Testing Tools</Text>

          <TouchableOpacity
            style={styles.blueButton}
            onPress={runRefresh}
            disabled={refreshing}
          >
            <Text style={styles.buttonText}>
              {refreshing ? "Refreshing..." : "Refresh Picks Now"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.goldButton}
            onPress={runResolve}
            disabled={resolving}
          >
            <Text style={styles.darkButtonText}>
              {resolving ? "Resolving..." : "Resolve Saved Picks"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Phone Testing Note</Text>
          <Text style={styles.note}>
            If this app is running on your phone, localhost may not connect. Use
            your computer IP in .env:
          </Text>

          <Text style={styles.codeText}>
            EXPO_PUBLIC_API_URL=http://YOUR-COMPUTER-IP:3000
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  valueColor = "#f8fafc",
}: {
  label: string;
  value: any;
  valueColor?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor }]}>{String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },

  container: {
    padding: 16,
    paddingBottom: 36,
  },

  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 16,
  },

  title: {
    color: "#22c55e",
    fontSize: 34,
    fontWeight: "900",
  },

  subtitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },

  motto: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
    lineHeight: 20,
  },

  card: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },

  cardTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 12,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },

  infoLabel: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
  },

  infoValue: {
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
    flex: 1,
  },

  errorText: {
    color: "#fecaca",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
    lineHeight: 18,
  },

  button: {
    backgroundColor: "#22c55e",
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 14,
  },

  blueButton: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
  },

  goldButton: {
    backgroundColor: "#fbbf24",
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
  },

  buttonText: {
    color: "white",
    fontWeight: "900",
    fontSize: 15,
  },

  darkButtonText: {
    color: "#111827",
    fontWeight: "900",
    fontSize: 15,
  },

  noteCard: {
    backgroundColor: "#052e16",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#166534",
  },

  noteTitle: {
    color: "#86efac",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 8,
  },

  note: {
    color: "#dcfce7",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },

  codeText: {
    color: "#fef9c3",
    backgroundColor: "#14532d",
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
    fontSize: 12,
    fontWeight: "900",
  },
});