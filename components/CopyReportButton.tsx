import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";

import { copyTextToClipboard } from "../utils/copyReport";

type CopyReportButtonProps = {
  getReportText: () => string;
  label?: string;
  style?: ViewStyle;
};

export default function CopyReportButton({
  getReportText,
  label = "Copy Page Report",
  style,
}: CopyReportButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleCopy = async () => {
    const text = getReportText();
    const ok = await copyTextToClipboard(text);
    setFeedback(ok ? "Report copied" : "Failed to copy");

    setTimeout(() => {
      setFeedback(null);
    }, 2200);
  };

  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity style={styles.button} onPress={handleCopy} activeOpacity={0.85}>
        <Text style={styles.buttonText}>{label}</Text>
      </TouchableOpacity>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#475569",
  },
  buttonText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "900",
  },
  feedback: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
});
