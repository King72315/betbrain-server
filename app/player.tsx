import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function PlayerScreen() {
  const router = useRouter();
  const { name, team, opponent, stat, line } = useLocalSearchParams();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{name}</Text>

      <Text style={styles.info}>Team: {team}</Text>
      <Text style={styles.info}>Vs: {opponent}</Text>
      <Text style={styles.info}>
        {stat} Line: {line}
      </Text>

      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>Add To My Picks</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0f1a",
    padding: 20,
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    color: "#00ff99",
    fontWeight: "bold",
    marginBottom: 20,
  },
  info: {
    fontSize: 18,
    color: "#fff",
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#1f2937",
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
  },
  buttonText: {
    color: "#00ff99",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
  },
  back: {
    marginTop: 20,
    color: "#aaa",
    textAlign: "center",
  },
});