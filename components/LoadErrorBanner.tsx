import React from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  message: string | null | undefined;
  title?: string;
};

export default function LoadErrorBanner({
  message,
  title = "Backend connection error",
}: Props) {
  if (!message) return null;

  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  errorCard: {
    backgroundColor: "#450a0a",
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ef4444",
    marginBottom: 14,
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
  },
});
