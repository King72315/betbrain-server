import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BetBrain 🧠</Text>
      <Text style={styles.subtitle}>Smart Picks. Real Tracking.</Text>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/explore')}>
        <Text style={styles.buttonText}>Explore Picks</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/view-picks')}>
        <Text style={styles.buttonText}>My Active Picks</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/history')}>
        <Text style={styles.buttonText}>Results History</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={() => router.push('/settings')}>
        <Text style={styles.buttonText}>Settings ⚙️</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 34,
    color: '#22c55e',
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#cbd5e1',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#1e293b',
    padding: 16,
    marginVertical: 10,
    width: '78%',
    borderRadius: 12,
  },
  buttonText: {
    color: '#22c55e',
    textAlign: 'center',
    fontSize: 17,
    fontWeight: 'bold',
  },
});