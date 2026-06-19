function getPlayerStatus(player = {}) {
  return String(
    player.Status ||
      player.InjuryStatus ||
      player.GameStatus ||
      player.PlayerStatus ||
      player.InjuryNotes ||
      ""
  )
    .trim()
    .toLowerCase();
}

function classifyStatus(status = "") {
  if (!status) {
    return { level: "UNKNOWN", label: "Unknown" };
  }

  if (
    status.includes("out") ||
    status.includes("inactive") ||
    status.includes("suspended") ||
    status.includes("doubtful") ||
    status.includes("injured reserve")
  ) {
    return { level: "OUT", label: status };
  }

  if (
    status.includes("questionable") ||
    status.includes("game time") ||
    status.includes("gtd") ||
    status.includes("probable")
  ) {
    return { level: "QUESTIONABLE", label: status };
  }

  if (status.includes("active") || status.includes("expected")) {
    return { level: "ACTIVE", label: status };
  }

  return { level: "UNKNOWN", label: status };
}

export function evaluateAvailabilityGate({
  playerData = {},
  league = "NBA",
} = {}) {
  if (league !== "NBA") {
    return {
      applicable: false,
      status: "N/A",
      statusLevel: "N/A",
      dangerPressure: 0,
      dangerReasons: [],
      noPlay: false,
      noPlayReasons: [],
    };
  }

  const rawStatus = getPlayerStatus(playerData);
  const { level, label } = classifyStatus(rawStatus);

  const dangerReasons = [];
  const noPlayReasons = [];
  let dangerPressure = 0;
  let noPlay = false;

  if (level === "OUT") {
    dangerReasons.push(`Player status: ${label || "out/inactive/doubtful"}`);
    dangerPressure = 0.5;
    noPlay = true;
    noPlayReasons.push("Player unavailable (Out/Inactive/Doubtful)");
  } else if (level === "QUESTIONABLE") {
    dangerReasons.push(`Player questionable: ${label}`);
    dangerPressure = 0.15;
  } else if (level === "UNKNOWN" && rawStatus) {
    dangerReasons.push(`Unclear availability: ${label}`);
    dangerPressure = 0.05;
  }

  return {
    applicable: true,
    status: rawStatus || "unknown",
    statusLevel: level,
    statusLabel: label,
    dangerPressure,
    dangerReasons,
    noPlay,
    noPlayReasons,
  };
}
