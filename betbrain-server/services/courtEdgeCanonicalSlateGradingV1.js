/**
 * Grade canonical RESEARCH (and optionally OFFICIAL) rows for any CT slate
 * from ESPN box scores. No Odds remint. No Aug12 hardwire.
 */
import {
  getCanonicalRecordsBySlate,
  loadCanonicalPredictionStore,
  batchAppendCanonicalResults,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import {
  gradeFromActual,
  buildCanonicalResultObject,
} from "./courtEdgeCanonicalResultTruthV1.js";
import {
  rebuildDecisionLearningWarehouse,
  buildDailyDecisionLearningReport,
} from "./courtEdgeDecisionLearningWarehouseV1.js";
import { PROP_TYPE_TO_BOX_FIELD } from "../engines/wnba/propTypeV1.js";

export const CANONICAL_SLATE_GRADING_BUILD =
  "courteedge-canonical-slate-grading-v1";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary";

function clean(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function boxFieldForPropType(propType = "") {
  const pt = String(propType || "").toUpperCase();
  return PROP_TYPE_TO_BOX_FIELD[pt] || null;
}

function extractStat(map = {}, propType = "") {
  const field = boxFieldForPropType(propType);
  if (!field) return null;
  const key =
    field === "points"
      ? "PTS"
      : field === "rebounds"
        ? "REB"
        : field === "assists"
          ? "AST"
          : null;
  if (!key) return null;
  const n = Number(map[key]);
  return Number.isFinite(n) ? n : null;
}

async function fetchEspnPlayerBoxMap(slateDateCt) {
  const ymd = String(slateDateCt).replace(/-/g, "");
  const sb = await fetch(`${ESPN_SCOREBOARD}?dates=${ymd}`).then((r) => r.json());
  const byPlayer = new Map();
  const events = sb.events || [];
  let completedEvents = 0;
  let scheduledEvents = 0;

  for (const event of events) {
    const completed = Boolean(event?.status?.type?.completed);
    if (completed) completedEvents += 1;
    else scheduledEvents += 1;
    const summary = await fetch(`${ESPN_SUMMARY}?event=${event.id}`).then((r) =>
      r.json()
    );
    for (const teamBlock of summary.boxscore?.players || []) {
      for (const statGroup of teamBlock.statistics || []) {
        const labels = statGroup.labels || statGroup.names || [];
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName || athlete.athlete?.fullName;
          if (!name) continue;
          const stats = athlete.stats || [];
          const map = {};
          labels.forEach((lab, i) => {
            map[String(lab).toUpperCase()] = stats[i];
          });
          byPlayer.set(clean(name), {
            name,
            map,
            gameFinal: completed,
            eventId: event.id,
          });
        }
      }
    }
  }
  return {
    byPlayer,
    eventCount: events.length,
    completedEvents,
    scheduledEvents,
    slateNotStarted: events.length > 0 && completedEvents === 0,
  };
}

function findPlayerBox(byPlayer, playerName = "") {
  const key = clean(playerName);
  if (byPlayer.has(key)) return byPlayer.get(key);
  for (const [k, v] of byPlayer.entries()) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  const token = key.slice(-8);
  for (const [k, v] of byPlayer.entries()) {
    if (token && k.endsWith(token)) return v;
  }
  return null;
}

function buildResultPatch(row, byPlayer, slateMeta = {}) {
  const box = findPlayerBox(byPlayer, row.playerName);
  if (!box) {
    if (slateMeta.slateNotStarted || slateMeta.eventCount === 0) {
      return {
        kind: "unresolved",
        reason: "GAME_NOT_FINAL",
        result: buildCanonicalResultObject({
          grade: "PENDING",
          actual: null,
          gameFinal: false,
          gradeSource: CANONICAL_SLATE_GRADING_BUILD,
        }),
      };
    }
    return {
      kind: "unresolved",
      reason: "PLAYER_NOT_FOUND_IN_ESPN_BOX",
      result: buildCanonicalResultObject({
        grade: "UNRESOLVED",
        actual: null,
        gameFinal: false,
        unresolvedReason: "PLAYER_NOT_FOUND_IN_ESPN_BOX",
        gradeSource: CANONICAL_SLATE_GRADING_BUILD,
      }),
    };
  }
  if (!box.gameFinal) {
    return {
      kind: "unresolved",
      reason: "GAME_NOT_FINAL",
      result: buildCanonicalResultObject({
        grade: "PENDING",
        actual: null,
        gameFinal: false,
        gradeSource: CANONICAL_SLATE_GRADING_BUILD,
      }),
    };
  }
  const actual = extractStat(box.map, row.propType);
  if (actual == null) {
    const dnp = box.map.MIN === "0" || box.map.MIN === "0:00" || !box.map.MIN;
    return {
      kind: "unresolved",
      reason: dnp ? "VOID_DNP" : "STAT_MISSING",
      result: buildCanonicalResultObject({
        grade: dnp ? "VOID" : "UNRESOLVED",
        actual: null,
        gameFinal: true,
        voidReason: dnp ? "DNP_OR_ZERO_MINUTES" : "STAT_MISSING_IN_BOX",
        gradeSource: CANONICAL_SLATE_GRADING_BUILD,
      }),
    };
  }
  const g = gradeFromActual({ side: row.side, line: row.line, actual });
  return {
    kind: "graded",
    actual,
    grade: g.grade,
    result: buildCanonicalResultObject({
      grade: g.grade,
      actual,
      gameFinal: true,
      gradeSource: "ESPN_BOXSCORE",
    }),
  };
}

export async function gradeCanonicalResearchForSlate(slateDateCt, options = {}) {
  const includeOfficial = options.includeOfficial === true;
  const research = getCanonicalRecordsBySlate(slateDateCt, {
    membership: "RESEARCH",
  });
  const official = includeOfficial
    ? getCanonicalRecordsBySlate(slateDateCt, { membership: "OFFICIAL" })
    : [];
  const rows = [...research, ...official];
  const boxMeta = await fetchEspnPlayerBoxMap(slateDateCt);
  const byPlayer = boxMeta.byPlayer;

  const graded = [];
  const unresolved = [];
  const patches = [];

  for (const row of rows) {
    const out = buildResultPatch(row, byPlayer, boxMeta);
    patches.push({
      canonicalPropId: row.canonicalPropId,
      result: out.result,
    });
    const payload = {
      canonicalPropId: row.canonicalPropId,
      playerName: row.playerName,
      propType: row.propType,
      side: row.side,
      line: row.line,
      membership: row.membership,
      actual: out.actual ?? out.result?.actual ?? null,
      grade: out.grade || out.result?.grade,
      reason: out.reason || null,
      homeWeaveRank: row.homeWeaveRank ?? null,
      marketRank: row.marketRank ?? null,
    };
    if (out.kind === "graded") graded.push(payload);
    else unresolved.push(payload);
  }

  // One atomic store write for the whole slate — avoids Windows EPERM from
  // per-prop rename while the local API keeps the file open.
  const persist = batchAppendCanonicalResults(patches);

  const warehouse = rebuildDecisionLearningWarehouse({ persist: true });
  const learning = buildDailyDecisionLearningReport(slateDateCt, { warehouse });

  return {
    ok: true,
    build: CANONICAL_SLATE_GRADING_BUILD,
    slateDateCt,
    gradedCount: graded.length,
    unresolvedCount: unresolved.length,
    researchCount: research.length,
    officialCount: official.length,
    storeCount: loadCanonicalPredictionStore().records.length,
    persist,
    espn: {
      eventCount: boxMeta.eventCount,
      completedEvents: boxMeta.completedEvents,
      scheduledEvents: boxMeta.scheduledEvents,
    },
    graded,
    unresolved,
    learning,
  };
}
