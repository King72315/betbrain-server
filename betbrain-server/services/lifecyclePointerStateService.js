/**
 * Monotonic Lab pointer persistence — prevents backward lifecycle transitions.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "lifecycle-pointer-state.json");

const integrityEvents = [];

export function readLifecyclePointerState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return {
        currentLabSlateDate: null,
        historySlateDates: [],
        updatedAt: null,
      };
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {
      currentLabSlateDate: null,
      historySlateDates: [],
      updatedAt: null,
    };
  }
}

export function writeLifecyclePointerState(state = {}) {
  const next = {
    ...readLifecyclePointerState(),
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function logLifecycleIntegrityFailure(event = {}) {
  const row = {
    type: "LIFECYCLE_INTEGRITY_FAILURE",
    at: new Date().toISOString(),
    ...event,
  };
  integrityEvents.unshift(row);
  if (integrityEvents.length > 100) integrityEvents.pop();
  console.log("LIFECYCLE_INTEGRITY_FAILURE:", JSON.stringify(row));
  return row;
}

export function getLifecycleIntegrityEvents() {
  return [...integrityEvents];
}

/**
 * Lab pointer may advance or stay; never move backward unless allowRepairForward.
 */
export function applyMonotonicLabPointer(rotation = {}, options = {}) {
  const persisted = readLifecyclePointerState();
  const computed = rotation.currentLabSlateDate
    ? String(rotation.currentLabSlateDate)
    : null;
  const previous = persisted.currentLabSlateDate
    ? String(persisted.currentLabSlateDate)
    : null;
  const allowRepairForward = Boolean(options.allowRepairForward);

  if (!computed) {
    return {
      ...rotation,
      labPointerSource: previous ? "persisted" : "computed",
      currentLabSlateDate: previous,
      historySlateDates:
        rotation.historySlateDates?.length > 0
          ? rotation.historySlateDates
          : persisted.historySlateDates || [],
    };
  }

  if (previous && computed < previous) {
    logLifecycleIntegrityFailure({
      code: "LAB_POINTER_BACKWARD_BLOCKED",
      previousLabSlateDate: previous,
      computedLabSlateDate: computed,
      activeResultsSlateDate: rotation.activeResultsSlateDate || null,
      allowRepairForward,
    });
    return {
      ...rotation,
      labPointerSource: "persisted_blocked_backward",
      currentLabSlateDate: previous,
      historySlateDates: mergeHistoryDates(
        rotation.historySlateDates,
        persisted.historySlateDates
      ),
      lifecycleIntegrityBlocked: true,
    };
  }

  const nextLab = !previous || computed >= previous ? computed : previous;
  const nextHistory = mergeHistoryDates(
    rotation.historySlateDates,
    persisted.historySlateDates,
    previous && nextLab !== previous ? [previous] : []
  ).filter((d) => d !== nextLab);

  if (nextLab !== previous || !arraysEqual(nextHistory, persisted.historySlateDates || [])) {
    writeLifecyclePointerState({
      currentLabSlateDate: nextLab,
      historySlateDates: nextHistory,
    });
  }

  return {
    ...rotation,
    labPointerSource: nextLab === computed ? "computed" : "persisted",
    currentLabSlateDate: nextLab,
    historySlateDates: nextHistory,
  };
}

function mergeHistoryDates(...lists) {
  const out = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      const date = String(item || "");
      if (date) out.add(date);
    }
  }
  return [...out].sort((a, b) => b.localeCompare(a));
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
