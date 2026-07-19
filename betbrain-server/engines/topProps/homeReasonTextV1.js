/**
 * Home-facing reason text — translate internal gate codes to readable copy.
 * Keep raw codes in diagnostics / Lab only.
 */

export const HOME_REASON_TRANSLATIONS = {
  UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR:
    "The Under projection edge is below the normal limited-data threshold.",
  UNDER_GAP_BELOW_WNBA_FULL_DATA_FLOOR:
    "The Under projection edge is below the normal full-data threshold.",
  OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR:
    "The Over has a limited projection advantage on limited data.",
  OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR:
    "The Over has a limited projection advantage despite otherwise complete data.",
  DANGER_STACK_INSUFFICIENT_EDGE:
    "The projection edge is thin relative to the identified risk factors.",
  DANGER_GATE_STACK_BOARD_ONLY:
    "Multiple risk factors are stacked against this side.",
  DANGER_GATE_STACK_NO_TRACK:
    "Risk factors are stacked too heavily for a clean read.",
  NO_DECISIVE_RESCUE:
    "No stronger opposite-side case was found.",
  READER_UNCERTAIN_TEST:
    "The model lean is uncertain; confidence stays conservative.",
  READER_UNCERTAIN:
    "The model lean is uncertain; confidence stays conservative.",
  OVER_UNSTABLE_THIN_BOOK:
    "Book coverage is thin and the Over profile is unstable.",
  OVER_THIN_GAP_VOLATILE:
    "The Over edge is thin with elevated volatility.",
  OVER_VOLATILE_WEAK_EDGE:
    "Volatility is high and the Over edge is weak.",
  LOW_VOLUME_OVER_TRAP:
    "Shot volume is too low to trust this Over.",
  INSUFFICIENT_EDGE_SOFT:
    "The projection edge is thin; kept as a playable board lean.",
  GAP_FLOOR_BOARD_SOFT_PICK:
    "The projection edge is below the usual floor; kept as a playable board lean.",
  BOARD_ONLY:
    "Kept as a playable board lean on available evidence.",
};

const RAW_CODE_RE =
  /\b(UNDER_GAP_BELOW_[A-Z0-9_]+|OVER_GAP_BELOW_[A-Z0-9_]+|DANGER_STACK_[A-Z0-9_]+|DANGER_GATE_STACK_[A-Z0-9_]+|NO_DECISIVE_RESCUE|INSUFFICIENT_EDGE_SOFT|GAP_FLOOR_BOARD_SOFT_PICK|READER_UNCERTAIN(?:_TEST)?|OVER_UNSTABLE_THIN_BOOK|OVER_THIN_GAP_VOLATILE|OVER_VOLATILE_WEAK_EDGE|LOW_VOLUME_OVER_TRAP|BOARD_ONLY|NO_BET|SHADOW_ONLY|NATURAL_TRACK)\b/gi;

export function translateHomeReasonCode(code = "") {
  const key = String(code || "").trim().toUpperCase();
  if (!key) return "";
  if (HOME_REASON_TRANSLATIONS[key]) return HOME_REASON_TRANSLATIONS[key];
  for (const [raw, text] of Object.entries(HOME_REASON_TRANSLATIONS)) {
    if (key.includes(raw)) return text;
  }
  return "";
}

export function stripRawDecisionLabels(text = "") {
  return String(text || "")
    .replace(RAW_CODE_RE, "")
    // Consumer compact text must never mention internal danger-gate machinery.
    .replace(/\s*flagged by danger gate\.?/gi, ".")
    .replace(/\bdanger[\s_-]*gates?\b/gi, "risk factors")
    .replace(/\bgap[\s_-]*floors?\b/gi, "projection threshold")
    .replace(/\b(BOARD_ONLY|NO_BET|SHADOW_ONLY|NATURAL_TRACK)\b/gi, "")
    .replace(/prior gate:\s*/gi, "")
    .replace(/\.\s*\./g, ".")
    .replace(/^\s*[—–-]+\s*/g, "")
    .replace(/\s*[—–-]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .replace(/\.\.+/g, ".")
    .trim();
}

/**
 * Build concise Home "Why" text. Never returns empty/dash-only.
 */
export function buildHomeDisplayWhy(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const rawCode =
    di.naturalGateReason ||
    di.gateReason ||
    pick.wnbaTrackingReason ||
    pick.sideRescueAction ||
    pick.sideRescue?.action ||
    pick.naturalGateReason ||
    "";
  const translated = translateHomeReasonCode(rawCode);

  let base =
    pick.displayWhy ||
    di.simpleExplanation ||
    pick.sideRescueExplanation ||
    "";
  base = stripRawDecisionLabels(base);

  if (translated) {
    if (!base || /^TRACK\s*[—–-]\s*True risk/i.test(base)) {
      const risk = String(di.trueRisk || pick.trueRisk || "MEDIUM").toUpperCase();
      base = `TRACK — ${translated} True risk ${risk}.`;
    } else if (!base.includes(translated)) {
      base = `${base.replace(/\.$/, "")}. ${translated}`;
    }
  }

  base = stripRawDecisionLabels(base);
  if (!base || base === "—" || base === "-" || /^TRACK\s*[—–-]\s*$/i.test(base)) {
    const risk = String(di.trueRisk || pick.trueRisk || "MEDIUM").toUpperCase();
    const side = String(pick.side || pick.pick || "this side");
    base = `TRACK — Selected ${side} on available evidence. True risk ${risk}.`;
  }

  return base.trim();
}

export function applyHomeDisplayWhyToPick(pick = {}) {
  const displayWhy = buildHomeDisplayWhy(pick);
  const di = pick.decisionIntelligence || {};
  return {
    ...pick,
    displayWhy,
    decisionIntelligence: {
      ...di,
      simpleExplanation: displayWhy,
      // Preserve raw codes for diagnostics / Lab only
      gateReasonRaw: di.gateReason || pick.wnbaTrackingReason || di.gateReasonRaw || null,
      naturalGateReason:
        di.naturalGateReason || di.gateReason || pick.wnbaTrackingReason || null,
    },
  };
}
