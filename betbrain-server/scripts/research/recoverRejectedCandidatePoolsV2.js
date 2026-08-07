/**
 * Recover unused rejected / full-pool candidates and join actuals.
 * historicalProviderCalls = 0
 *
 * Sources (from Mariah recovery inventory):
 * - .durable-mirror-v1/home-day__*
 * - root home-day__*
 * - freeze-2026-07-15-candidates-slim + before-evidence-rank
 * - Jul19 candidate-pool / today-candidate audits + picks.json
 * - sibling Jul21 picks dumps
 * - home-completion / live-empty-board picks dumps
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const ROOT = path.resolve(SERVER, "..");
const OUT = path.join(SERVER, "research", "empirical-safe-prop-v2", "exports");
fs.mkdirSync(OUT, { recursive: true });

function readJson(p, fb = null) {
  try {
    let buf = fs.readFileSync(p);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
    let s = buf.toString("utf8");
    const i = s.search(/[\{\[]/);
    if (i > 0) s = s.slice(i);
    return JSON.parse(s);
  } catch {
    return fb;
  }
}

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sideNorm(s) {
  const u = String(s || "").toUpperCase();
  if (u.startsWith("OVER")) return "OVER";
  if (u.startsWith("UNDER")) return "UNDER";
  return null;
}

function cleanName(n) {
  return String(n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function grade(side, line, actual) {
  if (actual == null || line == null || !side) return null;
  if (Math.abs(actual - line) < 1e-9) return "PUSH";
  if (side === "OVER") return actual > line ? "WIN" : "LOSS";
  return actual < line ? "WIN" : "LOSS";
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Build (slateDate|player) -> actual points from archives + tracked-props. */
function buildActualIndex() {
  const byDatePlayer = new Map(); // date|player -> {actual, sources}
  const byPlayerDates = new Map(); // player -> [{date, actual}]

  function add(date, player, actual, source) {
    if (!date || !player || actual == null) return;
    const cn = cleanName(player);
    const key = `${date}|${cn}`;
    if (!byDatePlayer.has(key)) {
      byDatePlayer.set(key, { actual, sources: [source], player, date });
    } else {
      byDatePlayer.get(key).sources.push(source);
    }
    if (!byPlayerDates.has(cn)) byPlayerDates.set(cn, []);
    byPlayerDates.get(cn).push({ date, actual, source });
  }

  const archDir = path.join(SERVER, "history-archive");
  for (const f of fs.readdirSync(archDir).filter((x) => x.endsWith(".json"))) {
    const date = f.replace(/\.json$/, "");
    const j = readJson(path.join(archDir, f), { props: [] });
    for (const pr of j.props || []) {
      const actual = num(pr.actualStat ?? pr.actual ?? pr.actualPoints);
      add(date, pr.player || pr.playerName, actual, `history-archive/${f}`);
    }
  }

  // slate-snapshots often carry graded Official props
  const snapDir = path.join(SERVER, "slate-snapshots");
  if (exists(snapDir)) {
    for (const f of fs.readdirSync(snapDir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
      const date = f.replace(/\.json$/, "");
      const j = readJson(path.join(snapDir, f), null);
      const props = j?.props || j?.officialProps || j?.board || [];
      for (const pr of Array.isArray(props) ? props : []) {
        const actual = num(pr.actualStat ?? pr.actual ?? pr.actualPoints);
        add(date, pr.player || pr.playerName, actual, `slate-snapshots/${f}`);
      }
    }
  }

  // tracked-props — large; extract actuals by slateDate
  const tp = readJson(path.join(SERVER, "tracked-props.json"), null);
  const tpList = Array.isArray(tp)
    ? tp
    : tp?.props || tp?.trackedProps || tp?.items || [];
  if (Array.isArray(tpList)) {
    for (const pr of tpList) {
      const date = pr.slateDate || pr.resultsSlateDate || pr.canonicalSlateDateCT;
      const actual = num(pr.actualStat ?? pr.actual ?? pr.actualPoints);
      if (date && actual != null) {
        add(date, pr.player || pr.playerName, actual, "tracked-props.json");
      }
    }
  }

  // lab/active bundles
  for (const rootName of ["lab-bundles", "active-bundles"]) {
    const root = path.join(SERVER, rootName);
    if (!exists(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const tpPath = path.join(root, d, "tracked-props.json");
      if (!exists(tpPath)) continue;
      const j = readJson(tpPath, { props: [] });
      for (const pr of j.props || []) {
        const actual = num(pr.actualStat ?? pr.actual ?? pr.actualPoints);
        add(d, pr.player || pr.playerName, actual, `${rootName}/${d}`);
      }
    }
  }

  return { byDatePlayer, byPlayerDates, size: byDatePlayer.size };
}

function lookupActual(index, date, player) {
  const cn = cleanName(player);
  const hit = index.byDatePlayer.get(`${date}|${cn}`);
  if (hit) return hit;
  // same calendar date ±0 only — no cross-date guessing
  return null;
}

function pushCand(out, rec) {
  if (!rec.playerName || !rec.selectedSide || rec.line == null) return;
  if (rec.originalProjection == null) return;
  out.push(rec);
}

function walkAllGenerated(node, visit, d = 0) {
  if (!node || d > 8) return;
  if (Array.isArray(node)) {
    for (const x of node) walkAllGenerated(x, visit, d + 1);
    return;
  }
  if (typeof node !== "object") return;
  if (Array.isArray(node.allGeneratedCandidates)) {
    visit(node.allGeneratedCandidates, node);
  }
  for (const v of Object.values(node)) walkAllGenerated(v, visit, d + 1);
}

function extractFromCandidateArray(arr, meta) {
  const out = [];
  for (const c of arr || []) {
    const side = sideNorm(c.side || c.pick);
    const line = num(c.line);
    const projection = num(c.projection ?? c.projectedPoints ?? c.finalProjection);
    pushCand(out, {
      slateDateCT: meta.slateDate,
      playerName: c.playerName || c.player,
      team: c.team,
      opponent: c.opponent,
      selectedSide: side,
      line,
      originalProjection: projection,
      originalFairLine: num(c.fairLine),
      bookCount: num(c.bookCount),
      avgMinutesL5: num(c.recentMinutes ?? c.avgMinutesL5 ?? c.expectedMinutes),
      expectedFGA: num(c.expectedFGA ?? c.avgFGA),
      avgPointsL5: num(c.last5Average ?? c.avgPointsL5),
      avgPoints: num(c.seasonAverage ?? c.avgPoints),
      availabilityStatus: c.availabilityStatus || "ACTIVE",
      isStarter: c.isStarter,
      officialEligibleHint: c.officialEligible === true,
      readerDecision: c.readerDecision,
      tier: c.tier,
      sourceType: meta.sourceType,
      sourcePath: meta.sourcePath,
      originalSelectedOfficial: false,
      reconstructed: true,
      reconstructionMethod: meta.method || "candidate_pool+actual_join",
      contaminated: meta.slateDate === "2026-08-05",
      prospectiveHoldout: meta.slateDate === "2026-08-07",
    });
  }
  return out;
}

function resolveHomeDaySlateDate(filePath, j) {
  const m = filePath.match(/home-day__WNBA__(\d{4}-\d{2}-\d{2})__(TODAY|TOMORROW)/);
  const base = j.slateDate || m?.[1];
  const bucket = j.dayBucket || m?.[2] || "TODAY";
  if (!base) return null;
  if (String(bucket).toUpperCase() === "TOMORROW") {
    const d = new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return base;
}

function loadHomeDayPools() {
  const files = [];
  const mirror = path.join(SERVER, ".durable-mirror-v1");
  if (exists(mirror)) {
    for (const f of fs.readdirSync(mirror)) {
      if (/^home-day__WNBA__\d{4}-\d{2}-\d{2}__(TODAY|TOMORROW)\.json$/.test(f)) {
        files.push(path.join(mirror, f));
      }
    }
  }
  for (const f of fs.readdirSync(SERVER)) {
    if (/^home-day__WNBA__\d{4}-\d{2}-\d{2}__(TODAY|TOMORROW)\.json$/.test(f)) {
      files.push(path.join(SERVER, f));
    }
  }
  const out = [];
  for (const p of files) {
    const j = readJson(p, null);
    if (!j) continue;
    const date = resolveHomeDaySlateDate(p, j);
    if (!date) continue;
    const officialNames = new Set(
      (j.props || []).map((x) => cleanName(x.player || x.playerName))
    );
    walkAllGenerated(j, (arr) => {
      // normalize player field aliases before extract
      for (const c of arr || []) {
        if (!c.playerName && c.player) c.playerName = c.player;
        if (!c.player && c.playerName) c.player = c.playerName;
      }
      const rows = extractFromCandidateArray(arr, {
        slateDate: date,
        sourceType: "HOME_DAY_ALL_GENERATED",
        sourcePath: p,
        method: "home-day.allGeneratedCandidates+actual_join",
      });
      for (const r of rows) {
        r.wasOfficialOnHomeDay = officialNames.has(cleanName(r.playerName));
        r.originalSelectedOfficial = r.wasOfficialOnHomeDay === true;
        out.push(r);
      }
    });
    for (const pr of j.props || []) {
      const side = sideNorm(pr.side || pr.pick);
      pushCand(out, {
        slateDateCT: date,
        playerName: pr.playerName || pr.player,
        team: pr.team,
        opponent: pr.opponent,
        selectedSide: side,
        line: num(pr.line),
        originalProjection: num(pr.projection),
        originalFairLine: num(pr.fairLine),
        bookCount: num(pr.bookCount),
        avgMinutesL5: num(pr.avgMinutesL5 ?? pr.expectedMinutes),
        expectedFGA: num(pr.expectedFGA),
        avgPointsL5: num(pr.last5Average ?? pr.avgPointsL5),
        avgPoints: num(pr.seasonAverage),
        availabilityStatus: pr.availabilityStatus || "ACTIVE",
        sourceType: "HOME_DAY_OFFICIAL_PROPS",
        sourcePath: p,
        originalSelectedOfficial: true,
        reconstructed: true,
        reconstructionMethod: "home-day.props",
        contaminated: date === "2026-08-05",
        prospectiveHoldout: date === "2026-08-07",
      });
    }
  }
  return out;
}

function loadFreezePools() {
  const out = [];
  const slim = path.join(SERVER, "slate-snapshots", "freeze-2026-07-15-candidates-slim.json");
  const full = path.join(
    SERVER,
    "slate-snapshots",
    "freeze-2026-07-15-before-evidence-rank.json"
  );
  for (const [p, type] of [
    [slim, "FREEZE_2026_07_15_CANDIDATES_SLIM"],
    [full, "FREEZE_2026_07_15_BEFORE_EVIDENCE"],
  ]) {
    if (!exists(p)) continue;
    const j = readJson(p, null);
    if (!j) continue;
    walkAllGenerated(j, (arr) => {
      out.push(
        ...extractFromCandidateArray(arr, {
          slateDate: "2026-07-15",
          sourceType: type,
          sourcePath: p,
        })
      );
    });
    // beforeBestSixDisplayWNBA etc.
    for (const key of Object.keys(j)) {
      if (Array.isArray(j[key]) && j[key][0]?.player && j[key][0]?.line != null) {
        out.push(
          ...extractFromCandidateArray(j[key], {
            slateDate: "2026-07-15",
            sourceType: `${type}_${key}`,
            sourcePath: p,
          })
        );
      }
    }
  }
  return out;
}

function loadAug3AutopsyRejected() {
  const p = path.join(SERVER, "scripts", "_aug3_autopsy_registry.json");
  const j = readJson(p, null);
  if (!j?.registry) return [];
  const out = [];
  for (const r of j.registry) {
    if (r.everOfficial) continue;
    const side = sideNorm(r.side || r.pick);
    const actual = num(r.actualPoints ?? r.actual);
    const resultRaw = String(r.grade || r.result || "").toUpperCase();
    const result =
      resultRaw === "W" || resultRaw === "WIN"
        ? "WIN"
        : resultRaw === "L" || resultRaw === "LOSS"
          ? "LOSS"
          : resultRaw === "P" || resultRaw === "PUSH"
            ? "PUSH"
            : grade(side, num(r.line), actual);
    // Allow missing projection — backfill later from other pools when possible
    if (!r.player || !side || num(r.line) == null) continue;
    out.push({
      slateDateCT: r.slateDate || "2026-08-03",
      playerName: r.player,
      team: r.team,
      opponent: r.opponent,
      selectedSide: side,
      line: num(r.line),
      originalProjection: num(r.projection),
      actualPoints: actual,
      result,
      bookCount: num(r.bookCount),
      sourceType: "AUG3_AUTOPSY_REJECTED",
      sourcePath: p,
      originalSelectedOfficial: false,
      reconstructed: true,
      reconstructionMethod: "aug3_autopsy_registry",
      contaminated: false,
      prospectiveHoldout: false,
      projectionOptional: true,
    });
  }
  return out;
}

function loadJul19Audits() {
  const out = [];
  const audit = path.join(
    SERVER,
    "backups",
    "2026-07-19T06-44-52-pre-best6-playable-pool-repair-v1",
    "candidate-pool-audit.json"
  );
  const todayAudit = path.join(
    SERVER,
    "backups",
    "2026-07-19T06-46-11-pre-best6-playable-pool-repair-v1-fresh",
    "today-candidate-audit.json"
  );
  const picks = path.join(
    SERVER,
    "backups",
    "2026-07-19T06-46-11-pre-best6-playable-pool-repair-v1-fresh",
    "picks.json"
  );

  if (exists(audit)) {
    const j = readJson(audit, {});
    for (const row of [...(j.today || []), ...(j.tomorrow || [])]) {
      const date = row.slateDate || (row.dayBucket === "TOMORROW" ? "2026-07-20" : "2026-07-19");
      // audits often lack projection — keep for later backfill
      out.push({
        slateDateCT: date,
        playerName: row.player,
        team: row.team,
        opponent: row.opponent,
        selectedSide: sideNorm(row.side || row.pick),
        line: num(row.line),
        originalProjection: num(row.projection),
        bookCount: num(row.bookCount),
        avgMinutesL5: num(row.avgMinutesL5),
        sourceType: "JUL19_CANDIDATE_POOL_AUDIT",
        sourcePath: audit,
        originalSelectedOfficial: String(row.track || "").includes("OFFICIAL"),
        reconstructed: true,
        reconstructionMethod: "jul19_audit+actual_join",
        contaminated: false,
        prospectiveHoldout: false,
        projectionOptional: true,
      });
    }
    // rejected arrays nested
    function walkRejected(o, d = 0) {
      if (!o || d > 8) return;
      if (Array.isArray(o)) {
        for (const x of o) walkRejected(x, d + 1);
        return;
      }
      if (typeof o !== "object") return;
      if (Array.isArray(o.rejected)) {
        for (const r of o.rejected) {
          const pick = r.pick || r;
          pushCand(out, {
            slateDateCT: "2026-07-19",
            playerName: pick.player,
            team: pick.team,
            selectedSide: sideNorm(pick.side || pick.pick),
            line: num(pick.line),
            originalProjection: num(pick.projection),
            bookCount: num(pick.bookCount),
            sourceType: "JUL19_REJECTED_AUDIT",
            sourcePath: audit,
            originalSelectedOfficial: false,
            rejectReason: r.reason,
            reconstructed: true,
            reconstructionMethod: "jul19_rejected+actual_join",
          });
        }
      }
      for (const v of Object.values(o)) walkRejected(v, d + 1);
    }
    walkRejected(j);
  }

  if (exists(todayAudit)) {
    const j = readJson(todayAudit, {});
    const arrays = j.arrays || {};
    for (const [k, arr] of Object.entries(arrays)) {
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        const date =
          row.slateDate ||
          (String(row.dayBucket || "").includes("TOMORROW")
            ? "2026-07-20"
            : "2026-07-19");
        pushCand(out, {
          slateDateCT: date,
          playerName: row.player,
          team: row.team,
          selectedSide: sideNorm(row.side || row.pick),
          line: num(row.line),
          originalProjection: num(row.projection),
          sourceType: `JUL19_TODAY_AUDIT_${k}`,
          sourcePath: todayAudit,
          originalSelectedOfficial: /official|sealed/i.test(k),
          reconstructed: true,
          reconstructionMethod: "jul19_today_audit+actual_join",
        });
      }
    }
  }

  if (exists(picks)) {
    const j = readJson(picks, null);
    if (j) {
      walkAllGenerated(j, (arr) => {
        out.push(
          ...extractFromCandidateArray(arr, {
            slateDate: "2026-07-19",
            sourceType: "JUL19_PICKS_ALL_GENERATED",
            sourcePath: picks,
            method: "jul19_picks+actual_join",
          })
        );
      });
    }
  }
  return out;
}

function loadSiblingJul21Pools() {
  const out = [];
  const paths = [
    path.join(ROOT, ".slate-date-verify-20260721-refresh", "picks.json"),
    path.join(ROOT, ".slate-date-verify-v2", "picks.json"),
    path.join(ROOT, ".verify-tabs-20260721", "picks_post.json"),
    path.join(ROOT, ".verify-tabs-20260721", "refresh-kick.json"),
    path.join(ROOT, ".slate-date-capture-20260720-235810", "picks.json"),
    path.join(ROOT, ".slate-date-capture-20260721", "picks.json"),
    path.join(SERVER, "backups", "home-completion-refresh-attempt", "picks-after.json"),
    path.join(SERVER, "backups", "home-completion-refresh-attempt", "picks-current.json"),
    path.join(SERVER, "backups", "live-empty-board-probe", "picks-after-refresh.json"),
  ];
  for (const p of paths) {
    if (!exists(p)) continue;
    const j = readJson(p, null);
    if (!j) continue;
    // Infer slate date from lastUpdated / content — Jul20/21 window
    const updated = String(j.lastUpdated || "");
    let date = "2026-07-20";
    if (updated.includes("2026-07-21") || p.includes("20260721")) date = "2026-07-21";
    if (p.includes("20260720")) date = "2026-07-20";
    // Prefer game commence if present later; default research date
    walkAllGenerated(j, (arr) => {
      const rows = extractFromCandidateArray(arr, {
        slateDate: date,
        sourceType: "SIBLING_OR_BACKUP_PICKS_ALL_GENERATED",
        sourcePath: p,
        method: "sibling_picks+actual_join",
      });
      // For tomorrow buckets, shift date +1 when dayBucket says TOMORROW
      for (const r of rows) {
        out.push(r);
      }
    });
  }
  return out;
}

function dedupeKey(r) {
  const proj =
    r.originalProjection == null
      ? "noproj"
      : Number(r.originalProjection).toFixed(1);
  return [
    r.slateDateCT,
    cleanName(r.playerName),
    r.selectedSide,
    r.line,
    proj,
  ].join("|");
}

function loadEspnActualIndex() {
  const p = path.join(
    SERVER,
    "research",
    "empirical-safe-prop-v2",
    "exports",
    "COURTEDGE_ESPN_ACTUALS_INDEX_V2.json"
  );
  const j = readJson(p, null);
  if (!j?.byKey) return { byKey: {}, count: 0, espnResearchFetches: 0 };
  return {
    byKey: j.byKey,
    count: j.count || Object.keys(j.byKey).length,
    espnResearchFetches: j.espnResearchFetches || 0,
  };
}

function backfillProjections(pools) {
  // Build player|date|side|line → projection from richer rows
  const projMap = new Map();
  for (const r of pools) {
    if (r.originalProjection == null || !r.playerName || !r.selectedSide) continue;
    const k = [
      r.slateDateCT,
      cleanName(r.playerName),
      r.selectedSide,
      r.line,
    ].join("|");
    if (!projMap.has(k)) projMap.set(k, r.originalProjection);
    // also player|date only fallback later
  }
  const byPlayerDate = new Map();
  for (const r of pools) {
    if (r.originalProjection == null || !r.playerName) continue;
    const k = `${r.slateDateCT}|${cleanName(r.playerName)}`;
    if (!byPlayerDate.has(k)) byPlayerDate.set(k, []);
    byPlayerDate.get(k).push(r);
  }
  let filled = 0;
  for (const r of pools) {
    if (r.originalProjection != null) continue;
    const k = [
      r.slateDateCT,
      cleanName(r.playerName),
      r.selectedSide,
      r.line,
    ].join("|");
    if (projMap.has(k)) {
      r.originalProjection = projMap.get(k);
      r.projectionBackfilled = true;
      filled++;
      continue;
    }
    // same player/date nearest line projection
    const cands = byPlayerDate.get(
      `${r.slateDateCT}|${cleanName(r.playerName)}`
    );
    if (cands?.length && r.line != null) {
      let best = null;
      let bestDist = Infinity;
      for (const c of cands) {
        if (c.selectedSide !== r.selectedSide) continue;
        const dist = Math.abs((c.line ?? 0) - r.line);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (best && bestDist <= 1.0) {
        r.originalProjection = best.originalProjection;
        r.projectionBackfilled = true;
        r.projectionBackfillDist = bestDist;
        filled++;
      }
    }
  }
  return filled;
}

function main() {
  console.log("Recovering rejected candidate pools...");
  const index = buildActualIndex();
  const espn = loadEspnActualIndex();
  console.log("actualIndexSize", index.size, "espnActuals", espn.count);

  // Merge ESPN into local index (do not overwrite local)
  for (const [k, row] of Object.entries(espn.byKey || {})) {
    if (!index.byDatePlayer.has(k)) {
      index.byDatePlayer.set(k, {
        actual: row.points,
        sources: ["ESPN_BOXSCORE"],
        player: row.player,
        date: row.date,
      });
    }
  }
  console.log("mergedActualIndexSize", index.byDatePlayer.size);

  const pools = [
    ...loadHomeDayPools(),
    ...loadFreezePools(),
    ...loadJul19Audits(),
    ...loadSiblingJul21Pools(),
    ...loadAug3AutopsyRejected(),
  ];
  const projFilled = backfillProjections(pools);
  console.log("rawPoolRows", pools.length, "projectionBackfills", projFilled);

  const stats = {
    withProjection: 0,
    withActual: 0,
    graded: 0,
    win: 0,
    loss: 0,
    push: 0,
    rejectedGraded: 0,
    officialGraded: 0,
    espnJoined: 0,
    bySource: {},
    byDate: {},
  };

  const seen = new Map();
  for (const r of pools) {
    if (!r.selectedSide || r.line == null) continue;
    if (r.originalProjection == null && !r.projectionOptional) continue;
    if (r.originalProjection != null) stats.withProjection++;
    let date = r.slateDateCT;
    let hit =
      r.actualPoints != null
        ? { actual: r.actualPoints, sources: [r.actualJoinSource || r.sourceType] }
        : lookupActual(index, date, r.playerName);
    if (!hit && (date === "2026-07-21" || date === "2026-07-19")) {
      for (const alt of ["2026-07-20", "2026-07-22", "2026-07-19", "2026-07-21"]) {
        const h = lookupActual(index, alt, r.playerName);
        if (h) {
          hit = h;
          date = alt;
          r.slateDateJoined = alt;
          r.slateDateCT = alt;
          break;
        }
      }
    }
    if (hit) {
      r.actualPoints = hit.actual;
      r.actualJoinSource = hit.sources[0];
      if (hit.sources[0] === "ESPN_BOXSCORE") stats.espnJoined++;
      if (!r.result) r.result = grade(r.selectedSide, r.line, hit.actual);
      stats.withActual++;
    } else if (r.actualPoints == null) {
      r.result = r.result || null;
    }
    if (r.result === "WIN") stats.win++;
    if (r.result === "LOSS") stats.loss++;
    if (r.result === "PUSH") stats.push++;
    if (r.result === "WIN" || r.result === "LOSS") {
      stats.graded++;
      if (r.originalSelectedOfficial) stats.officialGraded++;
      else stats.rejectedGraded++;
    }
    stats.bySource[r.sourceType] = (stats.bySource[r.sourceType] || 0) + 1;
    stats.byDate[r.slateDateCT] = (stats.byDate[r.slateDateCT] || 0) + 1;

    const key = dedupeKey(r);
    const prev = seen.get(key);
    if (!prev) seen.set(key, r);
    else if (!prev.result && r.result) seen.set(key, r);
    else if (
      prev.originalProjection == null &&
      r.originalProjection != null
    ) {
      seen.set(key, { ...prev, ...r, result: prev.result || r.result });
    } else if (
      prev.originalSelectedOfficial &&
      !r.originalSelectedOfficial &&
      r.result &&
      !prev.result
    ) {
      seen.set(key, r);
    }
  }

  const unique = [...seen.values()];
  const gradedRejected = unique.filter(
    (r) =>
      !r.originalSelectedOfficial &&
      !r.contaminated &&
      !r.prospectiveHoldout &&
      (r.result === "WIN" || r.result === "LOSS") &&
      r.originalProjection != null
  );
  const gradedAll = unique.filter(
    (r) =>
      !r.contaminated &&
      !r.prospectiveHoldout &&
      (r.result === "WIN" || r.result === "LOSS") &&
      r.originalProjection != null
  );

  const summary = {
    historicalProviderCalls: 0,
    oddsHistoricalProviderCalls: 0,
    espnResearchFetches: espn.espnResearchFetches,
    actualIndexSizeLocal: index.size,
    espnActuals: espn.count,
    mergedActualIndexSize: index.byDatePlayer.size,
    rawPoolRows: pools.length,
    projectionBackfills: projFilled,
    uniqueWithProjection: unique.filter((r) => r.originalProjection != null).length,
    uniqueGraded: gradedAll.length,
    uniqueGradedRejected: gradedRejected.length,
    uniqueGradedOfficial: gradedAll.filter((r) => r.originalSelectedOfficial).length,
    rejectedWinLoss: {
      W: gradedRejected.filter((r) => r.result === "WIN").length,
      L: gradedRejected.filter((r) => r.result === "LOSS").length,
    },
    stats,
    dates: [...new Set(gradedRejected.map((r) => r.slateDateCT))].sort(),
  };

  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_RECOVERED_REJECTED_CANDIDATE_POOLS_V2.json"),
    JSON.stringify(
      {
        build: "courteedge-empirical-low-medium-prop-finder-v2",
        recoveryPass: "rejected-pool-ingest-v2.1",
        summary,
        records: unique,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_RECOVERED_REJECTED_GRADED_V2.json"),
    JSON.stringify(
      {
        build: "courteedge-empirical-low-medium-prop-finder-v2",
        recoveryPass: "rejected-pool-ingest-v2.1",
        count: gradedRejected.length,
        records: gradedRejected,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(OUT, "_rejected_pool_recovery_summary.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();
