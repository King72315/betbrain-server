import { useRouter } from "expo-router";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.brand}>CourtEdge</Text>
          <Text style={styles.powered}>Powered by BetBrain</Text>
          <Text style={styles.motto}>
            We Don&apos;t Guess. We Calculate. We Cash.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Main Board</Text>

          <TouchableOpacity
            style={[styles.primaryButton, styles.goldBorder]}
            onPress={() => router.push("/top-props")}
          >
            <Text style={styles.primaryButtonText}>🔥 Top Props</Text>
            <Text style={styles.buttonSubtext}>
              Best NBA + WNBA props ranked by confidence, risk, support, market,
              and data quality
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/nba")}
          >
            <Text style={styles.buttonText}>🏀 NBA Props</Text>
            <Text style={styles.buttonSubtext}>
              NBA-only board with SportsData projections and rotation context
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/wnba")}
          >
            <Text style={styles.buttonText}>🏀 WNBA Props</Text>
            <Text style={styles.buttonSubtext}>
              WNBA-only board with BallDontLie recent form and market lines
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/explore")}
          >
            <Text style={styles.buttonText}>📊 Full Game Board</Text>
            <Text style={styles.buttonSubtext}>
              All available game cards and candidate props
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tracking</Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/view-picks")}
          >
            <Text style={styles.buttonText}>✅ My Active Picks</Text>
            <Text style={styles.buttonSubtext}>
              Saved picks waiting to be graded
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/history")}
          >
            <Text style={styles.buttonText}>📈 Results History</Text>
            <Text style={styles.buttonSubtext}>
              Wins, losses, pushes, accuracy, and calibration
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/settings")}
          >
            <Text style={styles.buttonText}>⚙️ Settings</Text>
            <Text style={styles.buttonSubtext}>
              Backend connection, app settings, and testing tools
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>75%+ Mission</Text>
          <Text style={styles.footerText}>
            Premium props only. Low volume. High trust. No random leans.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },

  container: {
    padding: 20,
    paddingBottom: 36,
  },

  headerCard: {
    backgroundColor: "#0f172a",
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: "#1e293b",
    marginBottom: 24,
  },

  brand: {
    fontSize: 38,
    color: "#22c55e",
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  powered: {
    color: "#94a3b8",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },

  motto: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 14,
    lineHeight: 22,
  },

  section: {
    marginBottom: 24,
  },

  sectionTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 12,
  },

  primaryButton: {
    backgroundColor: "#111827",
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
  },

  goldBorder: {
    borderColor: "#facc15",
  },

  primaryButtonText: {
    color: "#facc15",
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 6,
  },

  button: {
    backgroundColor: "#1e293b",
    padding: 18,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },

  buttonText: {
    color: "#22c55e",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 6,
  },

  buttonSubtext: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },

  footerCard: {
    backgroundColor: "#052e16",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#166534",
  },

  footerTitle: {
    color: "#86efac",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },

  footerText: {
    color: "#dcfce7",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },
});