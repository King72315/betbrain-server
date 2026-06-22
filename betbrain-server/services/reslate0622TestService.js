/**
 * CourtEdge 06/22 TEST slate repair — LOCAL ONLY.
 * Creates TEST tracking slate from live board candidates when official count is 0.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  applyWnbaOfficialV1Rules,
  isCourteEdgeWnbaV1Enabled,
} from "../engines/wnbaOfficialEngine.js";
import { finalizeSideTrackingDecision } from "../engines/sideSelectionEngine.js";
import {
  anyGameStarted,
  RESLATE_SLATE_DATE,
} from "./reslate0622V1Service.js";
import {
  getStableTrackedPropKey,
  getTrackedProps,
  isPreV1ShadowProp,
  isTestTrackingPick,
  replaceTrackedPropsForSlate,
} from "./trackedPropService.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isOutPlayer(pick = {}) {
  const gate = pick.availabilityGate || {};
  return gate.statusLevel === "OUT" || gate.noPlay === true;
}

function hasMissingCoreData(pick = {}) {
  if (!pick.player) return true;
  if (!num(pick.line)) return true;
  if (!pick.side && !pick.pick && !pick.currentEngineSide) return true;
  return false;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function backupRuntimeFiles(tag = "pre-0622-test-reslate") {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(SERVER_ROOT, "safe-backups", `${tag}-${ts}`);
  fs.mkdirSync(dir, { recursive: true });

  const files = [
    "tracked-props.json",
    "locked-slates.json",
    "daily-slate-reports.json",
  ];

  const copied = [];
  for (const name of files) {
    const src = path.join(SERVER_ROOT, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, name));
      copied.push(name);
    }
  }

  return { dir, copied, ts };
}

export function classifyTestBoardProps(picks = []) {
  const wnba = picks.filter(
    (p) => String(p.league || "").toUpperCase() === "WNBA"
  );

  const replayed = wnba.map((pick) => {
    let enriched = applyWnbaOfficialV1Rules(pick);
    if (enriched.trackingType === "TEST" || isTestTrackingPick(enriched)) {
      return enriched;
    }
    if (enriched.sideSelectionAudit) {
      const finalized = finalizeSideTrackingDecision(enriched, {
        finalSide: String(enriched.side || enriched.pick).toUpperCase().startsWith("O")
          ? "OVER"
          : "UNDER",
        finalDecision: enriched.sideSelectionDecision || "TEST",
        sideTrustable: enriched.sideTrustable ?? true,
        contradictions: enriched.contradictions || [],
        testReasons: enriched.testReasons || [],
      });
      enriched = { ...enriched, ...finalized };
    }
    return enriched;
  });

  const testProps = replayed.filter((pick) => {
    if (isOutPlayer(pick)) return false;
    if (hasMissingCoreData(pick)) return false;
    if (pick.isStarted) return false;
    return isTestTrackingPick(pick) || pick.trackingType === "TEST";
  });

  const seen = new Map();
  for (const pick of testProps) {
    const key = getStableTrackedPropKey(pick);
    if (!seen.has(key)) seen.set(key, pick);
  }

  return {
    total: replayed.length,
    testCount: seen.size,
    testProps: Array.from(seen.values()),
    v1Enabled: isCourteEdgeWnbaV1Enabled(),
  };
}

export function reslate0622Test(options = {}) {
  const slateDate = RESLATE_SLATE_DATE;
  const dryRun = Boolean(options.dryRun);
  const today = getTodayLocalDate();
  const tracked = options.trackedProps || getTrackedProps();
  const slateProps = tracked.filter(
    (p) => String(p.slateDate || "") === slateDate && !isPreV1ShadowProp(p)
  );

  const gameCheck = anyGameStarted(slateProps.length ? slateProps : options.boardPicks || []);
  if (gameCheck.blocked) {
    return {
      ok: false,
      blocked: true,
      reason: "games_started",
      gameCheck,
      message: "06/22 games have started — TEST reslate aborted",
    };
  }

  let backup = null;
  let backupId = null;
  if (!dryRun) {
    backup = backupRuntimeFiles(options.backupTag);
    try {
      backupId = createBackup(`pre-test-reslate-${slateDate}`).backupId;
    } catch (err) {
      console.log("TEST RESLATE BACKUP WARNING:", err.message);
    }
  }

  const boardEval = options.boardPicks
    ? classifyTestBoardProps(options.boardPicks)
    : { testCount: 0, testProps: [] };

  const result = {
    ok: true,
    dryRun,
    slateDate,
    today,
    backupDir: backup?.dir || null,
    backupId,
    gameCheck,
    boardEval,
    testCount: boardEval.testCount,
    engineVersion: "side-selection-v1-test",
    actions: [],
  };

  if (dryRun) {
    result.actions.push("dry_run_only");
    return result;
  }

  if (boardEval.testCount === 0) {
    result.actions.push("no_test_candidates");
    result.emptyTest = true;
    return result;
  }

  const nextSlateProps = boardEval.testProps.map((p) => ({
    ...p,
    slateDate,
    trackingType: "TEST",
    recordType: "TEST",
    excludedFromOfficialRecord: true,
    engineVersion: p.engineVersion || "side-selection-v1",
    generatedAfterV1: true,
  }));

  const merged = replaceTrackedPropsForSlate(slateDate, nextSlateProps);
  result.actions.push(`test_slate_written_${nextSlateProps.length}`);
  result.trackedAfterCount = merged.filter(
    (p) => String(p.slateDate || "") === slateDate
  ).length;

  return result;
}

export { backupRuntimeFiles };
