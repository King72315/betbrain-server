import AsyncStorage from "@react-native-async-storage/async-storage";

import type { HistoryEntry } from "./historyArchive";

export const HISTORY_RETENTION_DAYS = 7;
export const HISTORY_CLEAR_STORAGE_KEY = "courtEdge_historyDisplayClear";

export type HistoryDisplayClear = {
  clearedAt: string;
  hiddenSlateDates: string[];
  hiddenEntryIds: string[];
};

function getChicagoTodayString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function parseChicagoDate(slateDate: string) {
  const d = new Date(`${slateDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isWithinHistoryRetention(slateDate: string, days = HISTORY_RETENTION_DAYS) {
  if (!slateDate || slateDate === "unknown") return false;

  const slate = parseChicagoDate(slateDate);
  if (!slate) return false;

  const today = parseChicagoDate(getChicagoTodayString());
  if (!today) return true;

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  return slate >= cutoff;
}

export async function loadHistoryDisplayClear(): Promise<HistoryDisplayClear | null> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_CLEAR_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HistoryDisplayClear;
  } catch {
    return null;
  }
}

export async function saveHistoryDisplayClear(payload: HistoryDisplayClear) {
  await AsyncStorage.setItem(HISTORY_CLEAR_STORAGE_KEY, JSON.stringify(payload));
}

export async function clearHistoryDisplay(entries: HistoryEntry[]) {
  const payload: HistoryDisplayClear = {
    clearedAt: new Date().toISOString(),
    hiddenSlateDates: [...new Set(entries.map((entry) => entry.slateDate))],
    hiddenEntryIds: entries.map((entry) => entry.id),
  };

  await saveHistoryDisplayClear(payload);
  return payload;
}

export function applyHistoryRetentionFilters(
  entries: HistoryEntry[],
  options?: {
    currentLabSlateDate?: string | null;
    displayClear?: HistoryDisplayClear | null;
    retentionDays?: number;
  }
) {
  const retentionDays = options?.retentionDays ?? HISTORY_RETENTION_DAYS;
  const currentLab = options?.currentLabSlateDate || null;
  const displayClear = options?.displayClear || null;

  return entries.filter((entry) => {
    if (currentLab && entry.type === "official-slate" && entry.slateDate === currentLab) {
      return false;
    }

    if (!isWithinHistoryRetention(entry.slateDate, retentionDays)) {
      return false;
    }

    if (displayClear) {
      if (displayClear.hiddenEntryIds.includes(entry.id)) return false;
      if (displayClear.hiddenSlateDates.includes(entry.slateDate)) return false;
    }

    return true;
  });
}
