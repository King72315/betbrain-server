import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function MakePick() {
  const router = useRouter();

  const [player, setPlayer] = useState('');
  const [stat, setStat] = useState('');
  const [prediction, setPrediction] = useState('');

  const savePick = () => {
    const newPick = {
      player,
      stat,
      prediction,
    };

    global.picks = global.picks ? [...global.picks, newPick] : [newPick];

    alert('Pick Saved!');
    router.push('/view-picks');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Make a Pick</Text>

      <TextInput
        placeholder="Player Name"
        placeholderTextColor="#aaa"
        style={styles.input}
        onChangeText={setPlayer}
      />

      <TextInput
        placeholder="Stat (Points, Rebounds...)"
        placeholderTextColor="#aaa"
        style={styles.input}
        onChangeText={setStat}
      />

      <TextInput
        placeholder="Prediction (Over/Under)"
        placeholderTextColor="#aaa"
        style={styles.input}
        onChangeText={setPrediction}
      />

      <TouchableOpacity style={styles.button} onPress={savePick}>
        <Text style={styles.buttonText}>Save Pick</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    color: '#22c55e',
    fontSize: 24,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1e293b',
    color: 'white',
    padding: 12,
    marginVertical: 10,
    borderRadius: 8,
  },
  button: {
    backgroundColor: '#22c55e',
    padding: 15,
    marginTop: 20,
    borderRadius: 10,
  },
  buttonText: {
    textAlign: 'center',
    color: 'black',
    fontWeight: 'bold',
  },
});