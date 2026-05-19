import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, "pick-history.json");
const ACCURACY_FILE = path.join(__dirname, "player_accuracy.json");
const FILTERED_FILE = path.join(__dirname, "filtered-props.json");

function ensureFile(file, defaultData = []) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
  }
}

ensureFile(HISTORY_FILE, []);
ensureFile(ACCURACY_FILE, {});
ensureFile(FILTERED_FILE, []);

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function savePick(pick) {
  const picks = readJSON(HISTORY_FILE, []);

  picks.push({
    ...pick,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  writeJSON(HISTORY_FILE, picks);
}

export function getSavedPicks() {
  return readJSON(HISTORY_FILE, []);
}

export function savePickHistory(picks) {
  writeJSON(HISTORY_FILE, picks);
}

export function saveFilteredProp(prop) {
  const props = readJSON(FILTERED_FILE, []);

  props.push({
    ...prop,
    timestamp: new Date().toISOString(),
  });

  writeJSON(FILTERED_FILE, props);
}

export function getFilteredProps() {
  return readJSON(FILTERED_FILE, []);
}

export function updatePlayerAccuracy(player, hit) {
  const accuracy = readJSON(ACCURACY_FILE, {});

  if (!accuracy[player]) {
    accuracy[player] = {
      wins: 0,
      losses: 0,
    };
  }

  if (hit) {
    accuracy[player].wins += 1;
  } else {
    accuracy[player].losses += 1;
  }

  writeJSON(ACCURACY_FILE, accuracy);
}

export function getPlayerAccuracy() {
  return readJSON(ACCURACY_FILE, {});
}