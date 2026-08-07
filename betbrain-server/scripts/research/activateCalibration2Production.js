/**
 * Activate EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 as production champion.
 * - Verify freeze hash
 * - Pregame gate for Aug 7
 * - One Odds refresh ONLY if every slate event is still pregame
 * - Immutable prospective freeze (Official + full research) with V1 shadow
 *
 * NO tuning. One-slate outcomes must not change the model.
 */
process.env.EMPIRICAL_SAFE_PROP_V2 = "true";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  selectOfficialBoardFromProbabilitySafetyV1,
} from "../../engines/probabilitySafetyV1/index.js";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  computeCalibrationHashV2,
  persistProspectiveSlateFreezeV2,
  loadFrozenCalibrationManifest,
} from "../../engines/empiricalSafePropV2/index.js";
import {
  EMPIRICAL_SAFE_PROP_V2,
  getCourtEdgeFeatureFlagSnapshot,
} from "../../engines/topProps/courtEdgeFeatureFlagsV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT = path.join(
  SERVER,
  "research",
  "empirical-safe-prop-v2",
  "calibration-2-freeze"
);
const PROD = process.env.COURTEDGE_PROD_URL || "https://betbrain-server-1.onrender.com";
const SLATE_DATE = "2026-08-07";

function readJson(p, fb = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
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

function loadAug7Candidates() {
  const p = path.join(SERVER, "_ps_aug7_refresh_raw.json");
  const raw = readJson(p, null);
  if (!raw) return { candidates: [], games: [] };
  const games = raw.games || raw.boardCache?.games || [];
  const candidates = [];
  for (const g of games) {
    const commence =
      g.commence_time || g.commenceTime || g.startTime || g.start || null;
    for (const c of g.allGeneratedCandidates || []) {
      candidates.push({
        playerName: c.playerName || c.player,
        player: c.playerName || c.player,
        team: c.team,
        opponent: c.opponent,
        league: "WNBA",
        line: num(c.line),
        side: sideNorm(c.side || c.pick),
        pick: sideNorm(c.side || c.pick),
        projection: num(c.projection),
        fairLine: num(c.fairLine),
        avgMinutesL5: num(c.recentMinutes ?? c.avgMinutesL5),
        expectedMinutes: num(c.recentMinutes ?? c.avgMinutesL5),
        bookCount: num(c.bookCount),
        availabilityStatus: c.availabilityStatus || "ACTIVE",
        isStarter: c.isStarter,
        slateDate: SLATE_DATE,
        game:
          g.game ||
          g.matchup ||
          `${c.team || "?"} vs ${c.opponent || "?"}`,
        commence_time: commence,
        eventId: g.eventId || g.id || c.eventId,
      });
    }
  }
  return { candidates, games };
}

function evaluatePregameGate(games) {
  const now = Date.now();
  const events = [];
  for (const g of games) {
    const commence =
      g.commence_time || g.commenceTime || g.startTime || g.start || null;
    const t = commence ? Date.parse(commence) : NaN;
    const label =
      g.game || g.matchup || `${g.awayTeam || "?"} @ ${g.homeTeam || "?"}`;
    const pregame = Number.isFinite(t) && t > now;
    events.push({
      game: label,
      commence,
      status: !Number.isFinite(t)
        ? "UNKNOWN"
        : pregame
          ? "PREGAME"
          : "STARTED_OR_FINAL",
      minutesToStart: Number.isFinite(t) ? Math.round((t - now) / 60000) : null,
    });
  }
  const allPregame =
    events.length > 0 && events.every((e) => e.status === "PREGAME");
  return {
    checkedAt: new Date().toISOString(),
    allPregame,
    allowOddsRefresh: allPregame,
    events,
    reason: allPregame
      ? "All slate events still pregame — Odds refresh permitted"
      : "Not every Aug 7 event is still pregame — Odds refresh BLOCKED to protect prospective integrity",
  };
}

async function maybeRefreshProd(gate) {
  if (String(process.env.COURTEDGE_SKIP_PROD_REFRESH || "").toLowerCase() === "true") {
    return {
      attempted: false,
      skipped: true,
      reason: "COURTEDGE_SKIP_PROD_REFRESH=true",
    };
  }
  if (!gate.allowOddsRefresh) {
    return {
      attempted: false,
      skipped: true,
      reason: gate.reason,
    };
  }
  try {
    const url = `${PROD}/refresh-picks?scope=today&chainTomorrow=false`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return {
      attempted: true,
      skipped: false,
      status: res.status,
      url,
      body,
    };
  } catch (err) {
    return {
      attempted: true,
      skipped: false,
      error: String(err.message || err),
    };
  }
}

function ensureEnvChampion() {
  const envPath = path.join(SERVER, ".env");
  try {
    let raw = "";
    if (fs.existsSync(envPath)) raw = fs.readFileSync(envPath, "utf8");
    if (/^EMPIRICAL_SAFE_PROP_V2=/m.test(raw)) {
      raw = raw.replace(
        /^EMPIRICAL_SAFE_PROP_V2=.*$/m,
        "EMPIRICAL_SAFE_PROP_V2=true"
      );
    } else {
      raw = `${raw.trimEnd()}\nEMPIRICAL_SAFE_PROP_V2=true\n`;
    }
    fs.writeFileSync(envPath, raw);
    return { wrote: true, path: envPath };
  } catch (e) {
    return { wrote: false, error: String(e.message || e) };
  }
}

async function main() {
  console.log("ACTIVATE", EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE);
  if (EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE !== "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2") {
    throw new Error("Freeze id mismatch");
  }
  if (EMPIRICAL_SAFE_PROP_V2 !== true) {
    throw new Error("EMPIRICAL_SAFE_PROP_V2 must be true for activation");
  }

  const calibrationHash = computeCalibrationHashV2();
  const priorManifest = loadFrozenCalibrationManifest();
  const envWrite = ensureEnvChampion();

  const { candidates, games } = loadAug7Candidates();
  const gate = evaluatePregameGate(games);
  console.log("pregameGate", gate.allPregame, gate.reason);

  const board = selectOfficialBoardFromProbabilitySafetyV1(candidates, {
    empiricalSafePropV2: true,
    requestedSlateDate: SLATE_DATE,
    simulationCount: 1500,
    seed: 7,
  });

  const researchProps = (board.research?.packets || []).map((pkt) => {
    const sidePkt =
      pkt.selectedSide === "UNDER" ? pkt.underPacket : pkt.overPacket;
    return {
      playerName: pkt.playerName,
      team: pkt.team,
      opponent: pkt.opponent,
      game: `${pkt.team || "?"} vs ${pkt.opponent || "?"}`,
      side: pkt.selectedSide,
      line: sidePkt?.line ?? pkt.market?.consensusLine,
      projection: sidePkt?.projection,
      fairLine: sidePkt?.fairLine,
      projectionEdge: sidePkt?.projectionEdge,
      trueRisk: pkt.risk?.risk,
      v2Risk: pkt.risk?.risk,
      v1Risk: pkt.riskV1Legacy?.risk ?? null,
      riskV1Legacy: pkt.riskV1Legacy,
      rawWinProbability: pkt.probability?.rawWinProbability,
      reliabilityProbability: pkt.risk?.reliabilityProbability,
      trustScore: pkt.risk?.trustScore,
      SafetyScore: pkt.safety?.finalSafetyScore,
      safePathway: pkt.risk?.safePathway,
      pathwayEvidence: pkt.risk?.pathwayEvidence,
      expectedMinutes: pkt.minutesModel?.expectedMinutes,
      minutesStabilityScore: pkt.minutesModel?.minutesStabilityScore,
      roleStabilityScore: pkt.roleModel?.roleStabilityScore,
      marketQualityScore: pkt.market?.marketQualityScore,
      bookCount: pkt.market?.bookCount,
      conflictIndex: pkt.uncertainty?.conflictIndex,
      failurePaths: sidePkt?.failure?.failurePaths,
      majorFailurePathCount: sidePkt?.failure?.majorFailurePathCount,
      officialEligible: pkt.risk?.officialEligible === true,
      pregameTimestamp: pkt.predictionCreatedAt,
      modelVersion: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
      calibrationHash,
    };
  });

  const refresh = await maybeRefreshProd(gate);

  const freeze = persistProspectiveSlateFreezeV2({
    slateDateCT: SLATE_DATE,
    officialProps: board.selectedProps,
    researchProps,
    pregameGate: gate,
    refresh,
    meta: {
      activation: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_PRODUCTION_CHAMPION",
      sourcePacket: "_ps_aug7_refresh_raw.json",
      boardVersion: board.version,
      productionFreeze: board.productionFreeze,
      noTuning: true,
      noMondayMorningQuarterbacking: true,
    },
  });

  // Update freeze manifest status → production champion (hashes stay the model lock;
  // note: feature-flag file hash may differ after ON default — record both)
  const championManifest = {
    ...(priorManifest || {}),
    freezeId: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    status: "PRODUCTION_CHAMPION_FROZEN",
    activatedAt: new Date().toISOString(),
    productionChampion: true,
    empiricalSafePropV2Default: true,
    calibrationHashAtActivation: calibrationHash,
    noTuningAfterActivation: true,
    prospectiveExperimentRules: {
      ifLowLoses: "do nothing",
      ifAllLowsWin: "do nothing",
      ifMediumGoesBad: "do nothing",
      reconsiderOnlyAfterMeaningfulProspectiveSample: true,
    },
    activationPregameGate: gate,
    activationRefresh: refresh,
    prospectiveFreezeFile: freeze.file,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_FREEZE.json"),
    JSON.stringify(championManifest, null, 2)
  );

  const report = `# EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 — PRODUCTION ACTIVATION

**Freeze:** \`EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2\`  
**Status:** PRODUCTION CHAMPION 🔐  
**Activated:** ${championManifest.activatedAt}  
**Calibration hash:** \`${calibrationHash}\`  
**EMPIRICAL_SAFE_PROP_V2:** ${EMPIRICAL_SAFE_PROP_V2}  
**Build:** ${EMPIRICAL_SAFE_PROP_V2_BUILD}

## Locked rules (unchanged)

- LOW = Calibration 2 LOW
- MEDIUM = Calibration 2 MEDIUM
- HIGH = blocked from Official
- No fixed six / no minimum board / no forced sides / no team quotas
- LOW sorted first, MEDIUM second
- Research tracks everything
- V1 continues in shadow (\`v1Risk\` beside \`v2Risk\`)
- **Absolutely no tuning after activation**

## Aug 7 pregame gate

**All pregame:** ${gate.allPregame}  
**Odds refresh:** ${refresh.skipped ? "SKIPPED" : refresh.attempted ? `ATTEMPTED status=${refresh.status}` : "n/a"}

${gate.reason}

| Game | Commence | Status |
|------|----------|--------|
${gate.events.map((e) => `| ${e.game} | ${e.commence || "?"} | ${e.status} |`).join("\n")}

## Prospective freeze

- File: \`${freeze.file}\`
- Official: **${freeze.payload.counts.official}** (LOW ${freeze.payload.counts.officialLow} / MEDIUM ${freeze.payload.counts.officialMedium})
- Research universe: **${freeze.payload.counts.research}** (HIGH ${freeze.payload.counts.researchHigh})

Official board (immutable for this activation freeze):

| Player | Side | Line | V2 | V1 | Rel | Trust | Pathway |
|--------|------|-----:|----|----|----:|------:|---------|
${freeze.payload.official
  .map(
    (p) =>
      `| ${p.player} | ${p.side} | ${p.line} | ${p.v2Risk} | ${p.v1Risk ?? "—"} | ${p.reliability ?? "—"} | ${p.trustScore ?? "—"} | ${p.pathway ?? "—"} |`
  )
  .join("\n")}

## Experiment discipline

If a LOW loses tonight: **do nothing.**  
If all LOWs win: **do nothing.**  
If MEDIUM goes 2–6: **do nothing.**  

Next scientific focus (later, not tonight): improve MEDIUM recall **without touching LOW**.

## Deploy note

Code default is ON. Render must run this build (or set \`EMPIRICAL_SAFE_PROP_V2=true\`) for live Home/Results to use Calibration 2.
`;

  fs.writeFileSync(
    path.join(OUT, "COURTEDGE_CALIBRATION_2_PRODUCTION_ACTIVATION.md"),
    report
  );
  fs.writeFileSync(
    path.join(SERVER, "COURTEDGE_CALIBRATION_2_PRODUCTION_ACTIVATION.md"),
    report
  );

  console.log(
    JSON.stringify(
      {
        freezeId: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
        EMPIRICAL_SAFE_PROP_V2,
        calibrationHash,
        flags: getCourtEdgeFeatureFlagSnapshot(),
        envWrite,
        pregameGate: gate,
        refresh,
        official: freeze.payload.counts,
        freezeFile: freeze.file,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
