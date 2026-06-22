import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  applyWnbaOfficialV1Rules,
  evaluateWnbaOfficialEligibility,
  isCourteEdgeWnbaV1Enabled,
} from "../engines/wnbaOfficialEngine.js";
import { archiveSlate, lockSlate, SLATE_PHASE } from "./slateLockService.js";
import {
  getTrackedProps,
  isOfficialTrackablePick,
  isPreV1ShadowProp,
  labelPreV1ShadowProps,
  replaceTrackedPropsForSlate,
  applySlateLockFreeze,
} from "./trackedPropService.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const REGISTRY_FILE = path.join(SERVER_ROOT, "locked-slates.json");
const SNAPSHOTS_DIR = path.join(SERVER_ROOT, "slate-snapshots");

export const RESLATE_SLATE_DATE = "2026-06-22";
export const PRE_V1_SHADOW_LABEL = "PRE_V1_LOCKED_PROPS";

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function anyGameStarted(props = [], now = new Date()) {
  const started = [];
  for (const prop of props) {
    const commence = prop.commenceTime || prop.time || "";
    if (!commence) continue;
    const kickoff = new Date(commence);
    if (Number.isFinite(kickoff.getTime()) && kickoff <= now) {
      started.push({
        player: prop.player,
        commenceTime: commence,
        game: prop.game,
      });
    }
  }
  return {
    blocked: started.length > 0,
    started,
    checkedAt: now.toISOString(),
  };
}

export function classifyV1BoardProps(picks = []) {
  const wnba = picks.filter(
    (p) => String(p.league || "").toUpperCase() === "WNBA"
  );
  const replayed = wnba.map((pick) => {
    const withRules = applyWnbaOfficialV1Rules(pick);
    const eligibility = evaluateWnbaOfficialEligibility(withRules);
    return { ...withRules, wnbaOfficialEligibility: eligibility };
  });

  const official = replayed.filter(isOfficialTrackablePick);
  const watchlist = replayed.filter((p) => {
    const tier = String(p.tier || "").toUpperCase();
    return tier === "WATCHLIST" && !isOfficialTrackablePick(p);
  });
  const blocked = replayed.filter((p) => {
    const tier = String(p.tier || "").toUpperCase();
    return tier === "LEAN" || p.noPlay === true;
  });

  return {
    total: replayed.length,
    official: official.length,
    watchlist: watchlist.length,
    blocked: blocked.length,
    officialProps: official,
    watchlistProps: watchlist,
    blockedProps: blocked,
    v1Enabled: isCourteEdgeWnbaV1Enabled(),
  };
}

export function archivePreV1ShadowBundle(props = [], options = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(
    SERVER_ROOT,
    "safe-backups",
    options.archiveDirName || `pre-v1-shadow-0622-${ts}`
  );
  fs.mkdirSync(archiveDir, { recursive: true });

  const labeled = labelPreV1ShadowProps(props, {
    shadowLabel: PRE_V1_SHADOW_LABEL,
    archivedAt: new Date().toISOString(),
    archiveReason: options.reason || "0622_v1_reslate",
  });

  const manifest = {
    label: PRE_V1_SHADOW_LABEL,
    slateDate: RESLATE_SLATE_DATE,
    capturedAt: new Date().toISOString(),
    propCount: labeled.length,
    metadata: {
      generated_before_wnba_v1_engine: true,
      excluded_from_v1_official_record: true,
    },
    source: options.source || "reslate0622V1Service",
  };

  writeJSON(path.join(archiveDir, "manifest.json"), manifest);
  writeJSON(path.join(archiveDir, "pre-v1-shadow-props.json"), {
    props: labeled,
    ...manifest,
  });

  return { ok: true, archiveDir, manifest, props: labeled };
}

function releaseActiveSlate(slateDate) {
  const date = String(slateDate || "");
  const registry = readJSON(REGISTRY_FILE, { slates: [] });
  const slates = Array.isArray(registry.slates) ? [...registry.slates] : [];
  const index = slates.findIndex((s) => s.slateDate === date);

  if (index < 0) {
    return { ok: true, message: `Slate ${date} not in registry`, released: false };
  }

  const entry = slates[index];
  if (String(entry.phase || "").toUpperCase() === SLATE_PHASE.ACTIVE) {
    const archived = archiveSlate(date, { reason: "pre_v1_reslate_release" });
    return { ok: archived.ok, released: true, entry: archived.entry };
  }

  return { ok: true, released: false, entry };
}

function removeSlateSnapshot(slateDate) {
  const file = path.join(SNAPSHOTS_DIR, `${slateDate}.json`);
  if (!fs.existsSync(file)) return { removed: false };
  const backup = readJSON(file, null);
  fs.unlinkSync(file);
  return { removed: true, propCount: backup?.props?.length || 0 };
}

export function reslate0622V1(options = {}) {
  const slateDate = RESLATE_SLATE_DATE;
  const dryRun = Boolean(options.dryRun);
  const today = getTodayLocalDate();
  const tracked = options.trackedProps || getTrackedProps();
  const slateProps = tracked.filter(
    (p) =>
      String(p.slateDate || "") === slateDate && !isPreV1ShadowProp(p)
  );

  const gameCheck = anyGameStarted(slateProps);
  if (gameCheck.blocked) {
    return {
      ok: false,
      blocked: true,
      reason: "games_started",
      gameCheck,
      message: "06/22 games have started — reslate aborted",
    };
  }

  let backupId = null;
  if (!dryRun) {
    try {
      backupId = createBackup(`pre-reslate-${slateDate}`).backupId;
    } catch (err) {
      console.log("RESLATE BACKUP WARNING:", err.message);
    }
  }

  const boardEval = options.boardPicks
    ? classifyV1BoardProps(options.boardPicks)
    : null;

  const preArchive = archivePreV1ShadowBundle(slateProps, {
    archiveDirName: options.preV1ArchiveDirName,
    source: options.source || "reslate0622V1",
    reason: "preserve_pre_v1_locked_props",
  });

  const officialCount = boardEval?.official ?? 0;
  const result = {
    ok: true,
    dryRun,
    slateDate,
    today,
    backupId,
    preV1Archive: preArchive.archiveDir,
    preV1PropCount: slateProps.length,
    gameCheck,
    boardEval,
    officialCount,
    engineVersion: "WNBA_V1",
    actions: [],
  };

  if (dryRun) {
    result.actions.push("dry_run_only");
    return result;
  }

  const preserved = tracked.filter(
    (p) => String(p.slateDate || "") !== slateDate
  );
  const nextSlateProps =
    officialCount > 0
      ? (boardEval.officialProps || []).map((p) => ({
          ...p,
          engineVersion: "WNBA_V1",
          slateDate,
        }))
      : [];

  const merged = replaceTrackedPropsForSlate(slateDate, nextSlateProps);
  result.actions.push(`tracked_cleared_${slateProps.length}_pre_v1`);
  result.trackedAfterCount = merged.filter(
    (p) => String(p.slateDate || "") === slateDate
  ).length;

  const release = releaseActiveSlate(slateDate);
  result.actions.push(release.released ? "active_slate_archived" : "active_slate_skip");
  result.release = release;

  const snapshot = removeSlateSnapshot(slateDate);
  result.actions.push(snapshot.removed ? "snapshot_removed" : "snapshot_absent");
  result.snapshot = snapshot;

  if (officialCount > 0) {
    const lockResult = lockSlate(slateDate, {
      reason: "wnba_v1_official_reslate",
      trackedProps: getTrackedProps(),
    });
    if (lockResult.ok && lockResult.snapshot?.props?.length) {
      applySlateLockFreeze(slateDate, lockResult.snapshot.props);
    }
    result.actions.push("locked_v1_official_slate");
    result.lock = lockResult;
  } else {
    result.actions.push("no_official_plays_empty_results");
    result.emptyOfficial = true;
  }

  return result;
}
