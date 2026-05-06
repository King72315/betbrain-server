import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function Settings() {
  const [rapidApiKey, setRapidApiKey] = useState('');
  const [rapidApiHost, setRapidApiHost] = useState('tank01-fantasy-stats.p.rapidapi.com');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const savedKey = await AsyncStorage.getItem('rapidApiKey');
    const savedHost = await AsyncStorage.getItem('rapidApiHost');

    if (savedKey) setRapidApiKey(savedKey);
    if (savedHost) setRapidApiHost(savedHost);
  };

  const saveSettings = async () => {
    await AsyncStorage.setItem('rapidApiKey', rapidApiKey);
    await AsyncStorage.setItem('rapidApiHost', rapidApiHost);

    Alert.alert('Saved ✅', 'API settings saved successfully');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings ⚙️</Text>

      <Text style={styles.label}>RapidAPI Key</Text>
      <TextInput
        style={styles.input}
        placeholder="Paste your RapidAPI key"
        placeholderTextColor="#64748b"
        value={rapidApiKey}
        onChangeText={setRapidApiKey}
        secureTextEntry
      />

      <Text style={styles.label}>RapidAPI Host</Text>
      <TextInput
        style={styles.input}
        placeholder="tank01-fantasy-stats.p.rapidapi.com"
        placeholderTextColor="#64748b"
        value={rapidApiHost}
        onChangeText={setRapidApiHost}
      />

      <TouchableOpacity style={styles.button} onPress={saveSettings}>
        <Text style={styles.buttonText}>Save API Settings</Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        Your API key stays saved only on this phone. Later, every user will save their own key/data on their own device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', padding: 20 },
  title: { color: '#22c55e', fontSize: 28, fontWeight: 'bold', marginBottom: 30 },
  label: { color: '#cbd5e1', marginBottom: 8 },
  input: {
    backgroundColor: '#1e293b',
    color: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#22c55e',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: 'black', fontWeight: 'bold' },
  note: { color: '#94a3b8', marginTop: 20, lineHeight: 20 },
});