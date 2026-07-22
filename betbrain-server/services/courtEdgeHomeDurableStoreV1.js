/**
 * CourtEdge Home Today/Tomorrow restart durability v1.
 *
 * Authoritative Home day records survive process restart when Postgres
 * (DATABASE_URL / COURTEDGE_DATABASE_URL) is connected. Filesystem/mirror
 * remain secondary caches only — never the production database.
 *
 * Build: courteedge-home-restart-durability-v1
 */
import crypto from "crypto";
import {
  DURABLE_KEYS,
  choosePreferredRecord,
  durableGet,
  durablePut,
  getDurableStoreHealth,
  getDurableStoreHealthSync,
  scoreDurableRecord,
} from "./courtEdgeDurableStoreV1.js";

export const HOME_DURABLE_BUILD = "courteedge-home-restart-durability-v1";
export const HOME_DURABLE_SCHEMA = "courtedge-home-day-v1";

export const HOME_DAY_BUCKETS = Object.freeze({
  TODAY: "TODAY",
  TOMORROW: "TOMORROW",
});

const DISPLAY_KEYS = Object.freeze({
  WNBA: {
    TODAY: "bestSixDisplayTodayWNBA",
    TOMORROW: "bestSixDisplayTomorrowWNBA",
  },
  NBA: {
    TODAY: "bestSixDisplayTodayNBA",
    TOMORROW: "bestSixDisplayTomorrowNBA",
  },
});

let lastHomePersistAt = null;
let lastHomePersistError = null;
let lastHomeHydrate = null;
let lastRejectedStaleWrite = null;

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

export function homeDayDurableKey({ league, slateDate, dayBucket }) {
  const lg = String(league || "WNBA").toUpperCase();
  const date = String(slateDate || "").slice(0, 10);
  const bucket = String(dayBucket || "TODAY").toUpperCase();
  // Use underscores — Windows cannot store `|` in filenames for FS mirror.
  return `home-day__${lg}__${date}__${bucket}`;
}

export function homeBoardCompositeKey() {
  return DURABLE_KEYS.BOARD_CACHE;
}

function displayKeyFor(league, dayBucket) {
  const lg = String(league || "WNBA").toUpperCase() === "NBA" ? "NBA" : "WNBA";
  const bucket =
    String(dayBucket || "TODAY").toUpperCase() === "TOMORROW"
      ? "TOMORROW"
      : "TODAY";
  return DISPLAY_KEYS[lg][bucket];
}

function analysisCoverage(prop) {
  const dq = prop?.homeDetailedAnalysisV1?.dataQuality;
  if (dq?.coverage != null) return Number(dq.coverage) || 0;
  if (prop?.homeDetailedAnalysisV1 && dq?.shellAnalysis !== true) return 80;
  if (prop?.sealedAnalysis) return 70;
  if (prop?.projection != null) return 40;
  return 0;
}

function isHydratedProp(prop) {
  if (!prop || typeof prop !== "object") return false;
  if (prop.homeDetailedAnalysisV1?.dataQuality?.shellAnalysis === true) {
    return false;
  }
  return Boolean(
    prop.homeDetailedAnalysisV1 ||
      prop.sealedAnalysis ||
      prop.engineEvidence ||
      (Array.isArray(prop.whySide) && prop.whySide.length) ||
      prop.courtEdgePlayerEvidence
  );
}

function isSealedProp(prop) {
  return Boolean(
    prop?.immutableOfficial ||
      prop?.sealed === true ||
      prop?.sealedAt ||
      prop?.officialSealedAt ||
      prop?.lifecycleState === "SEALED" ||
      prop?.lifecycle === "SEALED"
  );
}

/**
 * Merge precedence for Home day records (mission Phase 6).
 * Higher score wins. Empty / placeholder / seed / bundle lose to valid durable.
 */
export function scoreHomeDayRecord(record, meta = {}) {
  if (!record || typeof record !== "object") return -1;
  let score = scoreDurableRecord(record, meta);
  const props = Array.isArray(record.props) ? record.props : [];
  const sealedCount = props.filter(isSealedProp).length;
  const hydratedCount = props.filter(isHydratedProp).length;
  const avgCoverage =
    props.length === 0
      ? 0
      : props.reduce((s, p) => s + analysisCoverage(p), 0) / props.length;

  if (record.dayBucket === "TODAY" || record.dayBucket === "TOMORROW") {
    score += 5;
  }
  score += sealedCount * 40;
  score += hydratedCount * 25;
  score += Math.min(avgCoverage, 100);
  if (record.legitimateEmptyProven === true && props.length === 0) {
    score += 50; // proven empty beats unknown empty
  }
  if (meta.providerPartial || record.providerPartial === true) score -= 2000;
  if (meta.providerFailed || record.providerFailed === true) score -= 2000;
  if (meta.fromBundle || record.fromBundle === true) score -= 800;
  if (meta.isSeed || record.seededBoardCache || record.emergencyEmptyBoardSeed) {
    score -= 400;
  }
  if (meta.emptyInit || record.emptyInit === true) score -= 5000;
  if (record.placeholder === true || record.recoveryPlaceholder === true) {
    score -= 3000;
  }
  return score;
}

export function choosePreferredHomeDay(a, b, metaA = {}, metaB = {}) {
  if (!a) return b;
  if (!b) return a;
  const sa = scoreHomeDayRecord(a, metaA);
  const sb = scoreHomeDayRecord(b, metaB);
  if (sa !== sb) return sa >= sb ? a : b;
  const va = Number(a.recordVersion || 0);
  const vb = Number(b.recordVersion || 0);
  if (va !== vb) return va >= vb ? a : b;
  return a;
}

export function buildHomeDayRecord(board, options = {}) {
  const league = String(options.league || "WNBA").toUpperCase();
  const dayBucket =
    String(options.dayBucket || "TODAY").toUpperCase() === "TOMORROW"
      ? "TOMORROW"
      : "TODAY";
  const slateDate = String(
    options.slateDate ||
      board?.slateDate ||
      board?.canonicalSlateDate ||
      ""
  ).slice(0, 10);
  const key = displayKeyFor(league, dayBucket);
  const props = Array.isArray(board?.[key])
    ? board[key]
    : Array.isArray(options.props)
      ? options.props
      : [];
  const games = (Array.isArray(board?.games) ? board.games : []).filter((g) => {
    const gLeague = String(g?.league || "").toUpperCase();
    if (gLeague && gLeague !== league) return false;
    const bucket = String(g?.dayBucket || "").toUpperCase();
    if (!bucket) return true;
    return bucket === dayBucket;
  });
  const contentHash = hashValue({
    slateDate,
    dayBucket,
    league,
    props: props.map((p) => ({
      propId: p.officialPropId || p.propId,
      player: p.player,
      side: p.side || p.pick || p.finalCourtEdgeSide,
      line: p.line ?? p.sealedLine,
      confidence: p.confidence ?? p.finalConfidence,
      risk: p.trueRisk || p.riskLabel,
      rank: p.rank,
      contentHash: p.contentHash,
    })),
  });
  const hydrated = props.filter(isHydratedProp).length;
  const sealed = props.filter(isSealedProp).length;
  return {
    schemaVersion: HOME_DURABLE_SCHEMA,
    buildVersion: HOME_DURABLE_BUILD,
    league,
    slateDate,
    dayBucket,
    marketType: "points",
    canonicalSlateId:
      options.canonicalSlateId ||
      `${league}|${slateDate}|official-best6|points`,
    props,
    games,
    candidateCount: Number(
      options.candidateCount ?? board?.boardCandidates ?? props.length
    ),
    officialBestSixCount: props.length,
    sealed: sealed > 0 && sealed === props.length && props.length > 0,
    sealedAt: props.find((p) => p.sealedAt)?.sealedAt || board?.sealedAt || null,
    recordVersion: Number(options.recordVersion || board?.recordVersion || 1) || 1,
    contentHash,
    analysisCompleteness:
      props.length === 0 ? 0 : Math.round((hydrated / props.length) * 100),
    legitimateEmptyProven: Boolean(options.legitimateEmptyProven),
    emptyProof: options.emptyProof || null,
    seededBoardCache: Boolean(board?.seededBoardCache),
    emergencyEmptyBoardSeed: Boolean(board?.emergencyEmptyBoardSeed),
    fromBundle: Boolean(options.fromBundle || board?.fromBundle),
    placeholder: Boolean(options.placeholder),
    createdAt: board?.createdAt || board?.lastUpdated || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultsAdmissionLinks: options.resultsAdmissionLinks || null,
  };
}

export function validateHomeDayRecord(record) {
  if (!record || typeof record !== "object") {
    return { ok: false, reason: "missing_record" };
  }
  if (!record.slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.slateDate)) {
    return { ok: false, reason: "invalid_slate_date" };
  }
  if (!["TODAY", "TOMORROW"].includes(String(record.dayBucket || ""))) {
    return { ok: false, reason: "invalid_day_bucket" };
  }
  if (!record.league) {
    return { ok: false, reason: "missing_league" };
  }
  if (!Array.isArray(record.props)) {
    return { ok: false, reason: "props_not_array" };
  }
  if (
    record.props.length === 0 &&
    record.legitimateEmptyProven !== true &&
    !record.placeholder
  ) {
    // Empty without proof is valid to *store* only as non-authoritative;
    // callers must not let it replace a populated durable record.
    return { ok: true, reason: "empty_unproven", weak: true };
  }
  for (const p of record.props) {
    if (!p || typeof p !== "object") {
      return { ok: false, reason: "invalid_prop" };
    }
  }
  return { ok: true, reason: "valid", weak: false };
}

/**
 * Empty-board replacement is allowed only with explicit proof for that CT date.
 */
export function proveLegitimateEmptySlate(evidence = {}) {
  const reasons = [];
  if (evidence.noScheduledGames === true) reasons.push("no_scheduled_games");
  if (evidence.noValidPlayerPointsMarkets === true) {
    reasons.push("no_valid_player_points_markets");
  }
  if (evidence.allGamesCanceledOrPostponed === true) {
    reasons.push("all_games_canceled_or_postponed");
  }
  if (evidence.providerOk === false) {
    return {
      ok: false,
      proven: false,
      reason: "provider_not_ok",
      reasons,
    };
  }
  const failureTypes = [
    "timeout",
    "401",
    "403",
    "404",
    "rate_limit",
    "malformed",
    "partial",
    "network",
    "startup_race",
  ];
  for (const t of failureTypes) {
    if (evidence[`provider_${t}`] === true || evidence.failureType === t) {
      return { ok: false, proven: false, reason: `provider_${t}`, reasons };
    }
  }
  if (reasons.length === 0) {
    return { ok: false, proven: false, reason: "no_empty_proof", reasons };
  }
  return {
    ok: true,
    proven: true,
    reason: reasons.join("|"),
    reasons,
    slateDate: evidence.slateDate || null,
  };
}

/**
 * Decide whether candidate may replace current durable Home day.
 * Enforces Today/Tomorrow isolation by key (caller must use distinct keys).
 */
export function canReplaceHomeDay(current, candidate, options = {}) {
  if (!candidate) {
    return { allow: false, reason: "no_candidate" };
  }
  const candCheck = validateHomeDayRecord(candidate);
  if (!candCheck.ok) {
    return { allow: false, reason: candCheck.reason };
  }
  if (!current) {
    if (candCheck.weak && !candidate.legitimateEmptyProven) {
      return { allow: false, reason: "refuse_unproven_empty_init" };
    }
    return { allow: true, reason: "no_current" };
  }
  if (
    current.dayBucket &&
    candidate.dayBucket &&
    current.dayBucket !== candidate.dayBucket
  ) {
    return { allow: false, reason: "day_bucket_mismatch" };
  }
  if (
    current.slateDate &&
    candidate.slateDate &&
    current.slateDate !== candidate.slateDate &&
    options.allowDateRollover !== true
  ) {
    return { allow: false, reason: "slate_date_mismatch" };
  }

  const curProps = Array.isArray(current.props) ? current.props.length : 0;
  const nextProps = Array.isArray(candidate.props) ? candidate.props.length : 0;
  const curVer = Number(current.recordVersion || 0);
  const nextVer = Number(candidate.recordVersion || 0);

  if (options.providerFailed || candidate.providerFailed) {
    return { allow: false, reason: "provider_failed_preserve" };
  }
  if (options.providerPartial || candidate.providerPartial) {
    if (curProps > 0 && nextProps < curProps) {
      return { allow: false, reason: "partial_provider_preserve" };
    }
  }
  if (curProps > 0 && nextProps === 0) {
    const proof = proveLegitimateEmptySlate(
      candidate.emptyProof || options.emptyProof || {}
    );
    if (!proof.proven && candidate.legitimateEmptyProven !== true) {
      return { allow: false, reason: "empty_unproven_preserve" };
    }
    // Proven legitimate empty may clear the board (force or non-stale version).
    if (proof.proven || candidate.legitimateEmptyProven === true) {
      if (options.force === true || nextVer >= curVer) {
        return { allow: true, reason: "legitimate_empty_proven" };
      }
    }
  }

  // Hydrated must not be downgraded by placeholder / shell analysis.
  if (
    current.analysisCompleteness >= 60 &&
    (candidate.placeholder ||
      (candidate.analysisCompleteness || 0) + 20 < current.analysisCompleteness)
  ) {
    if (nextProps <= curProps) {
      return { allow: false, reason: "refuse_hydration_downgrade" };
    }
  }

  // Stale writer rejection
  if (nextVer < curVer && options.force !== true) {
    lastRejectedStaleWrite = {
      at: new Date().toISOString(),
      key: options.key || null,
      currentVersion: curVer,
      attemptedVersion: nextVer,
    };
    return { allow: false, reason: "stale_record_version" };
  }

  const preferred = choosePreferredHomeDay(current, candidate, {}, options);
  if (preferred !== candidate && options.force !== true) {
    return { allow: false, reason: "precedence_keeps_current" };
  }
  return { allow: true, reason: "replace_allowed" };
}

export async function persistHomeDayRecord(record, options = {}) {
  const check = validateHomeDayRecord(record);
  if (!check.ok) {
    lastHomePersistError = check.reason;
    return { ok: false, reason: check.reason };
  }
  const key =
    options.key ||
    homeDayDurableKey({
      league: record.league,
      slateDate: record.slateDate,
      dayBucket: record.dayBucket,
    });
  const existing = await durableGet(key);
  const current = existing.ok ? existing.value : null;
  const decision = canReplaceHomeDay(current, record, {
    ...options,
    key,
  });
  if (!decision.allow) {
    lastHomePersistError = decision.reason;
    return {
      ok: false,
      reason: decision.reason,
      preserved: true,
      key,
      contentHash: current?.contentHash || null,
      recordVersion: current?.recordVersion || null,
    };
  }
  const toWrite = {
    ...record,
    recordVersion: Math.max(
      Number(record.recordVersion || 1) || 1,
      Number(current?.recordVersion || 0) + (current ? 1 : 0)
    ),
    updatedAt: new Date().toISOString(),
  };
  if (!toWrite.contentHash) {
    toWrite.contentHash = hashValue(toWrite.props);
  }
  const put = await durablePut(key, toWrite, {
    recordVersion: toWrite.recordVersion,
    contentHash: toWrite.contentHash,
    force: options.force === true,
    // Home day keys are mirror+postgres authoritative; avoid polluting
    // server-root with dynamic filenames unless explicitly requested.
    writeLocalFile: options.writeLocalFile === true,
  });
  // Verify read-back when postgres available
  const verify = await durableGet(key);
  if (
    verify.ok &&
    verify.value?.contentHash &&
    toWrite.contentHash &&
    verify.value.contentHash !== toWrite.contentHash &&
    options.force !== true
  ) {
    lastHomePersistError = "verify_hash_mismatch";
    return {
      ok: false,
      reason: "verify_hash_mismatch",
      preserved: true,
      key,
    };
  }
  lastHomePersistAt = new Date().toISOString();
  lastHomePersistError = put.warning || null;
  return {
    ok: true,
    key,
    source: put.source,
    contentHash: toWrite.contentHash,
    recordVersion: toWrite.recordVersion,
    props: toWrite.props.length,
  };
}

/**
 * Extract Today/Tomorrow per league from a board and persist atomically per day.
 * Does not allow Today writes to mutate Tomorrow keys (and vice versa).
 */
export async function persistHomeBoardAtomic(board, options = {}) {
  if (!board || typeof board !== "object") {
    return { ok: false, reason: "no_board" };
  }
  const todayDate = String(options.todayDate || board.slateDate || "").slice(
    0,
    10
  );
  const tomorrowDate = String(
    options.tomorrowDate ||
      (todayDate
        ? (() => {
            const [y, m, d] = todayDate.split("-").map(Number);
            const dt = new Date(Date.UTC(y, m - 1, d + 1, 12));
            return dt.toISOString().slice(0, 10);
          })()
        : "")
  ).slice(0, 10);

  const results = [];
  const leagues = options.leagues || ["WNBA", "NBA"];
  for (const league of leagues) {
    for (const dayBucket of ["TODAY", "TOMORROW"]) {
      const slateDate = dayBucket === "TODAY" ? todayDate : tomorrowDate;
      if (!slateDate) continue;
      const record = buildHomeDayRecord(board, {
        league,
        dayBucket,
        slateDate,
        recordVersion: options.recordVersion,
        fromBundle: options.fromBundle,
        legitimateEmptyProven: options.legitimateEmptyProven,
        emptyProof: options.emptyProof,
      });
      // Skip writing empty unproven days when we have nothing and no proof —
      // avoids clobbering durable populated days with empty board shells.
      if (
        record.props.length === 0 &&
        record.legitimateEmptyProven !== true &&
        options.writeEmptyUnproven !== true
      ) {
        results.push({
          league,
          dayBucket,
          ok: true,
          skipped: true,
          reason: "skip_empty_unproven",
        });
        continue;
      }
      const put = await persistHomeDayRecord(record, {
        force: options.force,
        providerFailed: options.providerFailed,
        providerPartial: options.providerPartial,
        emptyProof: options.emptyProof,
        allowDateRollover: options.allowDateRollover,
      });
      results.push({ league, dayBucket, slateDate, ...put });
    }
  }

  // Also persist composite board-cache for full-board startup restore.
  // Always write to the configured durable mirror (tests + prod); avoid
  // clobbering a higher-scored remote unless force or empty.
  const composite = {
    ...board,
    homeDurableBuild: HOME_DURABLE_BUILD,
    homeDurablePersistedAt: new Date().toISOString(),
    recordVersion: Number(options.recordVersion || board.recordVersion || 1),
  };
  const existingBoard = await durableGet(DURABLE_KEYS.BOARD_CACHE);
  let shouldWriteComposite = options.force === true || !existingBoard.ok;
  if (!shouldWriteComposite && existingBoard.value) {
    const preferred = choosePreferredRecord(
      composite,
      existingBoard.value,
      { isSeed: board.seededBoardCache || board.emergencyEmptyBoardSeed },
      {
        fromBundle: options.fromBundle,
        emptyInit: false,
      }
    );
    shouldWriteComposite = preferred === composite;
  }
  let compositePut = { ok: true, skipped: true };
  if (shouldWriteComposite) {
    compositePut = await durablePut(DURABLE_KEYS.BOARD_CACHE, composite, {
      recordVersion: composite.recordVersion,
      contentHash: hashValue({
        today: (composite.bestSixDisplayTodayWNBA || []).map(
          (p) => p.contentHash
        ),
        tomorrow: (composite.bestSixDisplayTomorrowWNBA || []).map(
          (p) => p.contentHash
        ),
      }),
      force: true,
      writeLocalFile: options.writeLocalFile === true,
    });
  }

  const failed = results.filter((r) => r.ok === false && !r.skipped);
  lastHomePersistAt = new Date().toISOString();
  return {
    ok: failed.length === 0,
    build: HOME_DURABLE_BUILD,
    results,
    composite: compositePut,
    failedCount: failed.length,
  };
}

function applyDayRecordToBoard(board, record) {
  if (!board || !record) return board;
  const key = displayKeyFor(record.league, record.dayBucket);
  const out = { ...board };
  out[key] = Array.isArray(record.props) ? record.props : [];
  if (record.league === "WNBA" && record.dayBucket === "TODAY") {
    out.bestSixWNBA = out[key];
    out.bestSixDisplayWNBA = out[key];
  }
  if (record.league === "NBA" && record.dayBucket === "TODAY") {
    out.bestSixNBA = out[key];
    out.bestSixDisplayNBA = out[key];
  }
  // Merge games for that day without wiping the other day.
  const otherGames = (Array.isArray(out.games) ? out.games : []).filter((g) => {
    const gLeague = String(g?.league || record.league).toUpperCase();
    if (gLeague !== String(record.league).toUpperCase()) return true;
    const bucket = String(g?.dayBucket || "").toUpperCase();
    return bucket && bucket !== record.dayBucket;
  });
  const dayGames = Array.isArray(record.games) ? record.games : [];
  out.games = [...otherGames, ...dayGames];
  if (record.league === "WNBA") {
    out.wnbaGames = out.games.filter(
      (g) => String(g?.league || "WNBA").toUpperCase() === "WNBA"
    );
  }
  if (record.league === "NBA") {
    out.nbaGames = out.games.filter(
      (g) => String(g?.league || "").toUpperCase() === "NBA"
    );
  }
  return out;
}

/**
 * Startup hydrate: durable Today + Tomorrow win over bundled recovery / empty init.
 */
export async function hydrateHomeBoardFromDurable(options = {}) {
  const todayDate = String(options.todayDate || "").slice(0, 10);
  const tomorrowDate = String(options.tomorrowDate || "").slice(0, 10);
  const leagues = options.leagues || ["WNBA", "NBA"];
  const actions = [];
  let board = options.seedBoard && typeof options.seedBoard === "object"
    ? { ...options.seedBoard }
    : {
        ok: true,
        games: [],
        nbaGames: [],
        wnbaGames: [],
        bestSixWNBA: [],
        bestSixNBA: [],
        bestSixDisplayTodayWNBA: [],
        bestSixDisplayTodayNBA: [],
        bestSixDisplayTomorrowWNBA: [],
        bestSixDisplayTomorrowNBA: [],
        bestSixDisplayWNBA: [],
        bestSixDisplayNBA: [],
        topProps: [],
        homeDurableHydrated: true,
        homeDurableBuild: HOME_DURABLE_BUILD,
      };

  // Prefer composite board when present and populated.
  const composite = await durableGet(DURABLE_KEYS.BOARD_CACHE);
  if (composite.ok && composite.value) {
    const todayLen = (
      composite.value.bestSixDisplayTodayWNBA ||
      composite.value.bestSixWNBA ||
      []
    ).length;
    const tomLen = (composite.value.bestSixDisplayTomorrowWNBA || []).length;
    if (todayLen > 0 || tomLen > 0) {
      board = {
        ...composite.value,
        homeDurableHydrated: true,
        homeDurableBuild: HOME_DURABLE_BUILD,
        homeDurableSource: composite.source,
      };
      actions.push({
        action: "restored_composite_board",
        source: composite.source,
        today: todayLen,
        tomorrow: tomLen,
      });
    } else {
      actions.push({
        action: "composite_empty_skipped",
        source: composite.source,
      });
    }
  }

  for (const league of leagues) {
    for (const dayBucket of ["TODAY", "TOMORROW"]) {
      const slateDate = dayBucket === "TODAY" ? todayDate : tomorrowDate;
      if (!slateDate) continue;
      const key = homeDayDurableKey({ league, slateDate, dayBucket });
      const remote = await durableGet(key);
      if (!remote.ok || !remote.value) {
        actions.push({ key, action: "missing" });
        continue;
      }
      const check = validateHomeDayRecord(remote.value);
      if (!check.ok) {
        actions.push({ key, action: "invalid", reason: check.reason });
        continue;
      }
      const displayKey = displayKeyFor(league, dayBucket);
      const localProps = board[displayKey] || [];
      const preferred = choosePreferredHomeDay(
        remote.value,
        localProps.length
          ? buildHomeDayRecord(board, { league, dayBucket, slateDate })
          : null,
        { fromBundle: remote.source === "filesystem" && options.treatLocalAsBundle },
        {
          fromBundle: options.treatLocalAsBundle,
          emptyInit: localProps.length === 0,
        }
      );
      if (preferred === remote.value || localProps.length === 0) {
        board = applyDayRecordToBoard(board, remote.value);
        actions.push({
          key,
          action: "restored_day",
          source: remote.source,
          props: remote.value.props?.length || 0,
          contentHash: remote.value.contentHash,
        });
      } else {
        actions.push({ key, action: "kept_local", props: localProps.length });
      }
    }
  }

  const todayCount = (board.bestSixDisplayTodayWNBA || []).length;
  const tomorrowCount = (board.bestSixDisplayTomorrowWNBA || []).length;
  lastHomeHydrate = {
    at: new Date().toISOString(),
    actions,
    todayCount,
    tomorrowCount,
    build: HOME_DURABLE_BUILD,
  };

  return {
    ok: true,
    board:
      todayCount > 0 || tomorrowCount > 0 || (board.games || []).length > 0
        ? board
        : null,
    actions,
    todayCount,
    tomorrowCount,
    build: HOME_DURABLE_BUILD,
  };
}

/**
 * Sealed Tomorrow → Today durable rollover with identity preservation.
 */
export async function rolloverDurableHomeTomorrowToToday(options = {}) {
  const today = String(options.todayDate || "").slice(0, 10);
  const league = String(options.league || "WNBA").toUpperCase();
  if (!today) return { ok: false, reason: "missing_today" };
  const tomKey = homeDayDurableKey({
    league,
    slateDate: today,
    dayBucket: "TOMORROW",
  });
  // When calendar rolls, yesterday's "tomorrow" date equals today's date.
  const remote = await durableGet(tomKey);
  if (!remote.ok || !remote.value) {
    return { ok: true, action: "no_sealed_tomorrow", today };
  }
  const record = remote.value;
  if (!record.sealed && !(record.props || []).some(isSealedProp)) {
    return { ok: true, action: "tomorrow_unsealed_skip", today };
  }
  const todayRecord = {
    ...record,
    dayBucket: "TODAY",
    slateDate: today,
    recordVersion: Number(record.recordVersion || 0) + 1,
    updatedAt: new Date().toISOString(),
    rolloverVerifiedAt: new Date().toISOString(),
    contentHash: record.contentHash,
  };
  const put = await persistHomeDayRecord(todayRecord, {
    force: true,
    allowDateRollover: true,
  });
  return {
    ok: put.ok,
    action: "promoted_identity_preserved",
    slateDate: today,
    contentHash: record.contentHash,
    propIds: (record.props || []).map((p) => p.officialPropId || p.propId),
    put,
  };
}

export function getHomeDurableStatus() {
  const durable = getDurableStoreHealthSync();
  return {
    build: HOME_DURABLE_BUILD,
    schema: HOME_DURABLE_SCHEMA,
    durableStoreType: durable.type,
    databaseUrlConfigured: durable.databaseUrlConfigured,
    postgresHealthy: durable.postgresHealthy,
    lastHomePersistAt,
    lastHomePersistError,
    lastHomeHydrate,
    lastRejectedStaleWrite,
    durableActive:
      durable.type === "postgres" && durable.postgresHealthy === true,
  };
}

export async function getHomeDurableStatusAsync() {
  const durable = await getDurableStoreHealth();
  const sync = getHomeDurableStatus();
  return {
    ...sync,
    durableStoreType: durable.type,
    databaseUrlConfigured: durable.databaseUrlConfigured,
    postgresHealthy: durable.postgresHealthy,
    durableActive: durable.type === "postgres" && durable.postgresHealthy === true,
    lastDurableWriteAt: durable.lastDurableWriteAt,
    lastDurableError: durable.lastDurableError,
  };
}

export function resetHomeDurableForTests() {
  lastHomePersistAt = null;
  lastHomePersistError = null;
  lastHomeHydrate = null;
  lastRejectedStaleWrite = null;
}
