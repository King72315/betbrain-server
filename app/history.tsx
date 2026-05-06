import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Pick = {
  id: string;
  player: string;
  team: string;
  opponent: string;
  stat: string;
  line: string;
  pick: string;
  confidence: number;
  result: string;
  completedDate: string;
};

export default function History() {
  const [history, setHistory] = useState<Pick[]>([]);

  const loadHistory = async () => {
    const saved = await AsyncStorage.getItem('historyPicks');
    setHistory(saved ? JSON.parse(saved) : []);
  };

  useFocusEffect(useCallback(() => {
    loadHistory();
  }, []));

  const wins = history.filter((p) => p.result === "Win").length;
  const losses = history.filter((p) => p.result === "Loss").length;
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  const groupedByDate = history.reduce<Record<string, Pick[]>>((groups, pick) => {
    const date = pick.completedDate || "Unknown Date";
    if (!groups[date]) groups[date] = [];
    groups[date].push(pick);
    return groups;
  }, {});

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Results History</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Performance</Text>
        <Text style={styles.summaryText}>Total Picks: {total}</Text>
        <Text style={styles.winText}>Wins: {wins}</Text>
        <Text style={styles.lossText}>Losses: {losses}</Text>
        <Text style={styles.rateText}>Win Rate: {winRate}%</Text>
      </View>

      {history.length === 0 && <Text style={styles.empty}>No completed picks yet</Text>}

      {Object.keys(groupedByDate).map((date) => (
        <View key={date}>
          <Text style={styles.date}>{date}</Text>

          {groupedByDate[date].map((p) => (
            <View key={p.id} style={styles.card}>
              <Text style={styles.player}>{p.player}</Text>
              <Text style={styles.text}>{p.team} vs {p.opponent}</Text>
              <Text style={styles.text}>{p.stat} {p.pick} {p.line}</Text>
              <Text style={styles.conf}>{p.confidence}% Confidence</Text>
              <Text style={p.result === "Win" ? styles.win : styles.loss}>
                Result: {p.result}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', padding: 20 },
  title: { color: '#22c55e', fontSize: 24, marginBottom: 20, fontWeight: 'bold' },
  empty: { color: '#aaa' },
  summaryCard: {
    backgroundColor: '#111827',
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  summaryTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  summaryText: { color: '#cbd5e1', marginTop: 3 },
  winText: { color: '#22c55e', marginTop: 3, fontWeight: 'bold' },
  lossText: { color: '#ef4444', marginTop: 3, fontWeight: 'bold' },
  rateText: { color: '#facc15', marginTop: 8, fontSize: 18, fontWeight: 'bold' },
  date: { color: '#eab308', fontSize: 18, marginTop: 15, marginBottom: 10, fontWeight: 'bold' },
  card: { backgroundColor: '#1e293b', padding: 15, borderRadius: 12, marginBottom: 10 },
  player: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  text: { color: '#cbd5e1', marginTop: 4 },
  conf: { color: '#22c55e', marginTop: 8, fontWeight: 'bold' },
  win: { color: '#22c55e', marginTop: 8, fontWeight: 'bold' },
  loss: { color: '#ef4444', marginTop: 8, fontWeight: 'bold' },
});