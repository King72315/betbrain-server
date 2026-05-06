import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const params = useLocalSearchParams();
const [propsData, setPropsData] = useState<any[]>([]);

useEffect(() => {
  const loadProps = async () => {
    try {
      const res = await fetch(`http://localhost:5000/props/${params.gameID}`);
      const data = await res.json();
      setPropsData(data);
    } catch (err) {
      console.log("Error loading props:", err);
    }
  };

  if (params.gameID) {
    loadProps();
  }
}, [params.gameID]);

export default function PickDetail() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const addPick = async () => {
    const saved = await AsyncStorage.getItem('activePicks');
    const activePicks = saved ? JSON.parse(saved) : [];

    const exists = activePicks.find(
      (p: any) =>
        p.player === params.player &&
        p.stat === params.stat &&
        p.line === params.line
    );

    if (exists) {
      Alert.alert("Already Selected");
      return;
    }

    const newPick = {
      id: Date.now().toString(),
      player: params.player,
      team: params.team,
      opponent: params.opponent,
      stat: params.stat,
      line: params.line,
      pick: params.pick,
      confidence: Number(params.confidence),
      status: "Pending",
      pickedDate: new Date().toLocaleDateString(),
    };

    await AsyncStorage.setItem('activePicks', JSON.stringify([...activePicks, newPick]));
    Alert.alert("Pick Added ✅");
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{params.player}</Text>
      <Text style={styles.subtitle}>{params.team} vs {params.opponent}</Text>

      <View style={styles.mainCard}>
        <Text style={styles.pickText}>{params.stat} {params.pick} {params.line}</Text>
        <Text style={styles.confidence}>{params.confidence}% Confidence</Text>
        <Text style={styles.trend}>{params.trend}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Advanced Data</Text>
        <Text style={styles.detail}>Season Avg: {params.seasonAvg}</Text>
        <Text style={styles.detail}>Last 5 Avg: {params.last5Avg}</Text>
        <Text style={styles.detail}>Vs Opponent Avg: {params.vsOpponentAvg}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Bot Reasoning</Text>
        <Text style={styles.reasoning}>{params.reasoning}</Text>
      </View>

      <TouchableOpacity style={styles.addButton} onPress={addPick}>
        <Text style={styles.addButtonText}>Add To My Picks</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', padding: 20 },
  title: { color: 'white', fontSize: 28, fontWeight: 'bold' },
  subtitle: { color: '#cbd5e1', marginTop: 6, marginBottom: 18 },
  mainCard: { backgroundColor: '#064e3b', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: '#22c55e', marginBottom: 15 },
  pickText: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  confidence: { color: '#22c55e', fontSize: 18, marginTop: 8, fontWeight: 'bold' },
  trend: { color: '#facc15', marginTop: 8, fontWeight: 'bold' },
  card: { backgroundColor: '#1e293b', padding: 15, borderRadius: 12, marginBottom: 15 },
  sectionTitle: { color: '#22c55e', fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  detail: { color: '#cbd5e1', marginBottom: 6 },
  reasoning: { color: 'white', lineHeight: 22 },
  addButton: { backgroundColor: '#22c55e', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  addButtonText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  backButton: { backgroundColor: '#334155', padding: 15, borderRadius: 12, alignItems: 'center', marginBottom: 40 },
  backButtonText: { color: 'white', fontWeight: 'bold' },
});