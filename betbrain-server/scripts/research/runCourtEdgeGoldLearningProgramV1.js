/**
 * CourtEdge Gold Learning Program V1
 *
 * Maps the TennisEdge-style phase plan onto CourtEdge WNBA props.
 * Phase 1: architecture freeze (document only — no engine retune).
 * Phases 2–13: gold dataset + audits + prospective plan.
 *
 * Does NOT retune Direction PRODUCTION_1 or C2 CALIBRATION_2.
 * Does NOT add rescue engines or second side authorities.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "research", "courteedge-gold-learning-v1");
const FREEZE_DIR = path.join(
  ROOT,
  "research",
  "empirical-safe-prop-v2",
  "frozen-research-packets"
);
const HISTORY_DIR = path.join(ROOT, "history-archive");
const AUG8_GRADED = path.join(
  ROOT,
  "research",
  "empirical-safe-prop-v2",
  "aug8-graded",
  "COURTEDGE_AUG8_FROZEN_RESEARCH_GRADED_V1.json"
);
const HIST_MASTER = path.join(
  ROOT,
  "research",
  "historical-safe-prop-v1",
  "exports",
  "COURTEDGE_HISTORICAL_PLAYER_PROP_MASTER_V1.json"
);

const PROGRAM_BUILD = "courteedge-gold-learning-program-v1";
const ARCHITECTURE_FREEZE = Object.freeze({
  product: "CourtEdge",
  note: "TennisEdge plan mapped onto CourtEdge single-authority engine",
  pipeline: [
    "MATCH_DATA",
    "MODEL_MATCH_SHAPE",
    "pOVER_pUNDER",
    "canonical_predictedSide",
    "predictedProbability",
    "RiskV2_C2_Safety",
    "recommendationTier",
    "HOME",
  ],
  authorities: {
    side: "Direction PRIMARY | BEST_GUESS dual-C2 safer side",
    probability: "selectedSide rawWinProbability / displayConfidence (single)",
    risk: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    safety: "propSafetyEngineV1 finalSafetyScore",
    membership: "selectOfficialMembershipV1",
  },
  recommendationTier: {
    CERTIFIED: "officialSelected && directionAdmission===PRIMARY && c2Risk in LOW|MEDIUM",
    BEST_AVAILABLE: "officialSelected (includes BEST_GUESS / HIGH min-2 fill)",
    FULL_PREDICTIONS: "all boardCandidate / research packets with a side",
  },
  forbidden: [
    "Direction V2 production authority",
    "second rescue engine",
    "second probability authority",
    "second risk authority",
    "second side selector",
    "forced LOW / forced Certified",
    "arbitrary thresholds without recalibration",
    "hand-written player exceptions",
  ],
  freezesDoNotRetune: [
    "EMPIRICAL_DIRECTION_V1_PRODUCTION_1",
    "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
  ],
  controlPlaneBuild: "courteedge-single-machine-control-plane-v1-safer-side",
});

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function cleanName(v = "") {
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sideOf(row = {}) {
  return String(
    row.selectedSide || row.side || row.pick || row.predictedSide || ""
  ).toUpperCase();
}

function oppositeSide(side) {
  return side === "OVER" ? "UNDER" : side === "UNDER" ? "OVER" : null;
}

function gradeSide(side, line, actual) {
  if (actual == null || line == null || !side) return null;
  if (actual === line) return "PUSH";
  if (side === "OVER") return actual > line ? "WIN" : "LOSS";
  if (side === "UNDER") return actual < line ? "WIN" : "LOSS";
  return null;
}

function marginSide(side, line, actual) {
  if (actual == null || line == null || !side) return null;
  return side === "OVER" ? actual - line : line - actual;
}

function mean(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function rmse(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return Math.sqrt(mean(a.map((x) => x * x)));
}

function brier(rows) {
  const a = rows.filter(
    (r) =>
      Number.isFinite(r.predictedProbability) &&
      (r.result === "WIN" || r.result === "LOSS")
  );
  if (!a.length) return null;
  return mean(
    a.map((r) => {
      const y = r.result === "WIN" ? 1 : 0;
      return (r.predictedProbability - y) ** 2;
    })
  );
}

function recordOf(rows) {
  let w = 0,
    l = 0,
    p = 0;
  for (const r of rows) {
    if (r.result === "WIN") w += 1;
    else if (r.result === "LOSS") l += 1;
    else if (r.result === "PUSH") p += 1;
  }
  const decided = w + l;
  return {
    n: rows.length,
    win: w,
    loss: l,
    push: p,
    decided,
    hitRate: decided ? w / decided : null,
    record: `${w}-${l}-${p}`,
  };
}

function failureFlags(row = {}) {
  const paths = row.failurePaths || row.selectedFailurePaths || [];
  const ids = (Array.isArray(paths) ? paths : [])
    .map((x) => String(x?.id || x || "").toUpperCase())
    .filter(Boolean);
  return {
    failurePathIds: ids,
    blowoutFlag: ids.some((id) => id.includes("BLOWOUT")),
    roleChangeFlag: ids.some((id) => id.includes("ROLE")),
    minutesFlag: ids.some(
      (id) => id.includes("MINUTES") || id.includes("RESTRICTION")
    ),
    // CourtEdge analogue of "false extension": blowout / minutes collapse risk
    falseExtensionAnalog: ids.some(
      (id) => id.includes("BLOWOUT") || id === "BLOWOUT_MINUTES"
    ),
  };
}

function recommendationTier(row = {}) {
  const risk = String(row.c2Risk || row.v2Risk || row.risk || "").toUpperCase();
  const adm = String(row.directionAdmission || "").toUpperCase();
  const official =
    row.officialSelected === true ||
    row.trackingType === "OFFICIAL" ||
    row.officialEligible === true;
  // Older freezes may lack directionAdmission; LOW/MEDIUM Official ≈ Certified.
  const primaryLike = !adm || adm === "PRIMARY";
  if (official && primaryLike && (risk === "LOW" || risk === "MEDIUM")) {
    return "CERTIFIED";
  }
  if (official) return "BEST_AVAILABLE";
  if (risk === "LOW" || risk === "MEDIUM") return "BEST_AVAILABLE";
  return "FULL_PREDICTIONS";
}

function isSyntheticPoolFreeze(freeze) {
  const names = (freeze?.packets || []).map((p) => p.playerName || p.player || "");
  if (!names.length) return true;
  const poolish = names.filter((n) => /^Pool\s*\d+/i.test(String(n))).length;
  return poolish >= Math.max(1, Math.floor(names.length * 0.5));
}

/** Prefer real slate freezes; skip synthetic Pool-* test LATEST files. */
function listLatestFreezes() {
  if (!fs.existsSync(FREEZE_DIR)) return [];
  const byDate = new Map();
  for (const f of fs.readdirSync(FREEZE_DIR)) {
    if (!f.endsWith(".json")) continue;
    const m = f.match(/^(20\d{2}-\d{2}-\d{2})__/);
    if (!m) continue;
    const slateDate = m[1];
    const full = path.join(FREEZE_DIR, f);
    const freeze = readJson(full);
    if (!freeze?.packets?.length) continue;
    if (isSyntheticPoolFreeze(freeze)) continue;
    const prev = byDate.get(slateDate);
    // Prefer denser real universes, then newer mint, then __LATEST name.
    const score =
      freeze.packets.length * 1e12 +
      Date.parse(freeze.frozenAt || "1970-01-01") +
      (f.includes("__LATEST") ? 1e6 : 0);
    if (!prev || score > prev.score) {
      byDate.set(slateDate, { file: full, score, freeze });
    }
  }
  // If LATEST was synthetic, keep best non-LATEST already chosen.
  return [...byDate.values()]
    .map((x) => x.file)
    .sort();
}

function outcomeKey(slateDate, player, side, line) {
  return [
    String(slateDate || "").slice(0, 10),
    cleanName(player),
    String(side || "").toUpperCase(),
    String(line ?? ""),
  ].join("|");
}

function playerDateKey(slateDate, player) {
  return `${String(slateDate || "").slice(0, 10)}|${cleanName(player)}`;
}

function buildOutcomeIndex() {
  const byExact = new Map();
  const byPlayerDate = new Map();

  const upsert = (row) => {
    const slateDate = String(row.slateDate || row.slateDateCT || "").slice(0, 10);
    const player = row.player || row.playerName;
    const side = sideOf(row);
    const line = num(row.line ?? row.officialLine);
    const actual = num(row.actualPoints ?? row.actualStat ?? row.actual);
    if (!slateDate || !player || actual == null) return;
    const exact = outcomeKey(slateDate, player, side, line);
    const soft = playerDateKey(slateDate, player);
    const payload = {
      slateDate,
      player,
      side,
      line,
      actualPoints: actual,
      source: row.source || "unknown",
    };
    byExact.set(exact, payload);
    byPlayerDate.set(soft, payload);
  };

  // Aug 8 graded freeze
  const aug8 = readJson(AUG8_GRADED);
  for (const r of aug8?.rows || []) {
    upsert({
      ...r,
      slateDate: "2026-08-08",
      player: r.player,
      source: "aug8-graded",
    });
  }

  // History archive Official props
  if (fs.existsSync(HISTORY_DIR)) {
    for (const f of fs.readdirSync(HISTORY_DIR).filter((x) => x.endsWith(".json"))) {
      const ha = readJson(path.join(HISTORY_DIR, f));
      const slateDate = String(ha?.slateDate || f.replace(".json", "")).slice(0, 10);
      for (const p of ha?.props || []) {
        const actual = num(p.actualStat ?? p.actualPoints ?? p.result);
        // result field sometimes stores points; status stores win/loss
        const actualPoints =
          num(p.actualStat ?? p.actualPoints) ??
          (typeof p.result === "number" ? p.result : null);
        upsert({
          slateDate,
          player: p.player || p.playerName,
          side: p.side || p.pick,
          line: p.officialLine ?? p.line,
          actualPoints,
          source: `history-archive/${f}`,
        });
      }
    }
  }

  // Historical master graded rows
  const master = readJson(HIST_MASTER);
  const masterRows = Array.isArray(master) ? master : master?.records || master?.rows || [];
  for (const r of masterRows) {
    const status = String(r.result || r.status || "").toUpperCase();
    const actual = num(r.actualPoints ?? r.actualStat);
    if (actual == null && !(status === "WIN" || status === "LOSS" || status === "PUSH")) {
      continue;
    }
    upsert({
      slateDate: r.slateDate || r.date || r.canonicalSlateDateCT,
      player: r.player || r.playerName,
      side: r.side || r.pick,
      line: r.line ?? r.officialLine,
      actualPoints: actual,
      source: "historical-master",
      // keep win/loss even if actual missing for later
      _status: status,
      _resultOnly: actual == null,
    });
    if (actual == null && (status === "WIN" || status === "LOSS" || status === "PUSH")) {
      const slateDate = String(r.slateDate || r.date || "").slice(0, 10);
      const player = r.player || r.playerName;
      const side = sideOf(r);
      const line = num(r.line ?? r.officialLine);
      byExact.set(outcomeKey(slateDate, player, side, line) + "|STATUS", {
        slateDate,
        player,
        side,
        line,
        resultOnly: status,
        source: "historical-master-status",
      });
    }
  }

  // Full ESPN box-score actuals for recent slates (grade every Full Prediction)
  for (const date of ["2026-08-10", "2026-08-11"]) {
    const espn = readJson(
      path.join(OUT_DIR, `ESPN_ACTUALS_${date}.json`)
    );
    for (const r of espn?.rows || []) {
      upsert({
        slateDate: date,
        player: r.player,
        actualPoints: r.actualPoints,
        source: r.source || "espn-boxscore",
      });
    }
  }

  return { byExact, byPlayerDate };
}

function extractGoldRow(packet, freezeMeta, outcomes) {
  const slateDate = String(
    packet.canonicalSlateDateCT || freezeMeta.slateDateCT || ""
  ).slice(0, 10);
  const player = packet.playerName || packet.player;
  const side = sideOf(packet);
  const line = num(packet.line);
  const projection = num(packet.projection);
  const fairLine = num(packet.fairLine);
  const pSelected = num(packet.rawWinProbability);
  const pOver = num(packet.overPacket?.rawWinProbability);
  const pUnder = num(packet.underPacket?.rawWinProbability);
  const predictedProbability =
    pSelected ??
    (side === "OVER" ? pOver : side === "UNDER" ? pUnder : null);

  const flags = failureFlags(packet);
  const exact = outcomes.byExact.get(outcomeKey(slateDate, player, side, line));
  const soft = outcomes.byPlayerDate.get(playerDateKey(slateDate, player));
  const hit = exact || soft;
  const actualPoints = hit?.actualPoints ?? null;
  const result =
    actualPoints != null
      ? gradeSide(side, line, actualPoints)
      : null;
  const opp = oppositeSide(side);
  const oppositeResult =
    actualPoints != null && opp ? gradeSide(opp, line, actualPoints) : null;

  const calibrationExcludeReasons = [];
  if (!side || (side !== "OVER" && side !== "UNDER")) {
    calibrationExcludeReasons.push("missing_side");
  }
  if (line == null) calibrationExcludeReasons.push("ambiguous_line");
  if (!slateDate) calibrationExcludeReasons.push("wrong_date");
  if (!player) calibrationExcludeReasons.push("uncertain_identity");
  if (packet.postgameRecomputed === true) {
    calibrationExcludeReasons.push("postgame_recomputation");
  }
  if (packet.remintUncertain === true) {
    calibrationExcludeReasons.push("remint_uncertainty");
  }

  const tier = recommendationTier({
    officialSelected: packet.officialSelected,
    officialEligible: packet.officialEligible,
    trackingType: packet.trackingType,
    directionAdmission: packet.directionAdmission,
    c2Risk: packet.c2Risk || packet.v2Risk || packet.risk,
  });

  return {
    goldId: `${slateDate}|${cleanName(player)}|${side}|${line}`,
    date: slateDate,
    league: "WNBA",
    team: packet.team || null,
    opponent: packet.opponent || null,
    game: packet.game || null,
    eventId: packet.eventId || null,
    players: player,
    marketLine: line,
    predictedSide: side,
    pOver,
    pUnder,
    predictedProbability,
    projectedTotal: projection,
    fairTotal: fairLine,
    projectionEdge: num(packet.edge),
    Safety: num(packet.SafetyScore ?? packet.safety?.finalSafetyScore),
    RiskV2: String(packet.c2Risk || packet.v2Risk || packet.risk || "").toUpperCase() || null,
    Reliability: num(packet.reliabilityProbability),
    Validity: packet.analysisEligible !== false,
    Trust: num(packet.trustScore),
    primaryArchetype: packet.safePathway || packet.risk?.safePathway || "NONE",
    secondaryArchetypes: packet.pathwayEvidence || [],
    falseExtensionAnalog: flags.falseExtensionAnalog,
    blowoutFlag: flags.blowoutFlag,
    closeoutAnalog: flags.minutesFlag,
    extensionAnalog: flags.blowoutFlag,
    holdBreakAnalog: null,
    serveReturnAnalog: null,
    recentForm: {
      minutesStability: num(packet.minutesStability),
      roleStability: num(packet.roleStability),
      expectedMinutes: num(packet.expectedMinutes),
    },
    opponentQualityAdjustments: {
      conflictIndex: num(packet.conflictIndex),
      marketQuality: num(packet.marketQuality),
      bookCount: num(packet.bookCount),
    },
    historicalSimilarity: null,
    sideSearchOutput: {
      directionAdmission: packet.directionAdmission || null,
      directionResearchDecision: packet.directionResearchDecision || null,
      directionConfidence: packet.directionConfidence || null,
      bestGuessReason: packet.direction?.reason || null,
    },
    dataCompleteness: {
      bookCount: num(packet.bookCount),
      marketQuality: num(packet.marketQuality),
      availabilityCertainty: packet.availabilityCertainty ?? null,
      majorFailurePathCount: num(packet.majorFailurePathCount, 0),
    },
    mintTimestamp: packet.pregameTimestamp || packet.predictionCreatedAt || freezeMeta.frozenAt,
    modelVersion: {
      freezeBuild: freezeMeta.build || null,
      controlPlane: ARCHITECTURE_FREEZE.controlPlaneBuild,
      directionFreeze: "EMPIRICAL_DIRECTION_V1_PRODUCTION_1",
      c2Freeze: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
      programBuild: PROGRAM_BUILD,
    },
    officialSelected: packet.officialSelected === true,
    boardCandidate: packet.boardCandidate !== false,
    trackingType: packet.trackingType || (packet.officialSelected ? "OFFICIAL" : "RESEARCH"),
    directionAdmission: packet.directionAdmission || null,
    recommendationTier: tier,
    failurePathIds: flags.failurePathIds,
    // outcomes
    actualPoints,
    result,
    oppositeResult,
    predictionMargin: marginSide(side, line, actualPoints),
    projectionError:
      actualPoints != null && projection != null ? actualPoints - projection : null,
    outcomeSource: hit?.source || null,
    cleanPregameFrozen: true,
    calibrationEligible: calibrationExcludeReasons.length === 0 && result != null,
    calibrationExcludeReasons,
    forensicKeep: true,
  };
}

function buildGoldDataset(outcomes) {
  const rows = [];
  const freezeSummaries = [];
  for (const file of listLatestFreezes()) {
    const freeze = readJson(file);
    if (!freeze?.packets?.length) continue;
    const meta = {
      slateDateCT: freeze.slateDateCT,
      frozenAt: freeze.frozenAt,
      build: freeze.build,
      file: path.basename(file),
    };
    let graded = 0;
    for (const pkt of freeze.packets) {
      const row = extractGoldRow(pkt, meta, outcomes);
      rows.push(row);
      if (row.result) graded += 1;
    }
    freezeSummaries.push({
      ...meta,
      packetCount: freeze.packets.length,
      gradedJoined: graded,
      researchUniverse: freeze.researchUniverse || null,
      officialCount: freeze.officialCount ?? null,
    });
  }
  return { rows, freezeSummaries };
}

function splitMetrics(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = {};
  for (const [k, rs] of groups) {
    const absErr = rs.map((r) =>
      r.projectionError == null ? null : Math.abs(r.projectionError)
    );
    const signed = rs.map((r) => r.projectionError);
    out[k] = {
      ...recordOf(rs),
      mae: mean(absErr),
      medianAbsError: median(absErr),
      signedError: mean(signed),
      rmse: rmse(signed),
      brier: brier(rs),
      avgPredictedProbability: mean(rs.map((r) => r.predictedProbability)),
      avgSafety: mean(rs.map((r) => r.Safety)),
      avgReliability: mean(rs.map((r) => r.Reliability)),
    };
  }
  return out;
}

function probabilityBands(rows) {
  const bands = [
    [0.5, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.75],
    [0.75, 1.01],
  ];
  const out = [];
  for (const [lo, hi] of bands) {
    const rs = rows.filter((r) => {
      const p = r.predictedProbability;
      return Number.isFinite(p) && p >= lo && p < hi;
    });
    out.push({
      band: `${Math.round(lo * 100)}-${Math.round(hi * 100 - (hi > 1 ? 1 : 0))}`,
      lo,
      hi,
      ...recordOf(rs),
      brier: brier(rs),
      avgP: mean(rs.map((r) => r.predictedProbability)),
    });
  }
  return out;
}

function inverseSideAudit(rows) {
  const graded = rows.filter((r) => r.result === "WIN" || r.result === "LOSS");
  const pred = recordOf(graded);
  const inv = recordOf(
    graded.map((r) => ({
      ...r,
      result: r.oppositeResult,
    }))
  );
  return {
    predicted: pred,
    opposite: inv,
    edgeVsFlip:
      pred.hitRate != null && inv.hitRate != null
        ? pred.hitRate - inv.hitRate
        : null,
    bySide: splitMetrics(graded, (r) => r.predictedSide || "NA"),
    byRisk: splitMetrics(graded, (r) => r.RiskV2 || "NA"),
    byAdmission: splitMetrics(graded, (r) => r.directionAdmission || "NA"),
    byTier: splitMetrics(graded, (r) => r.recommendationTier || "NA"),
    byFalseExt: splitMetrics(graded, (r) =>
      r.falseExtensionAnalog ? "FALSE_EXT_TRUE" : "FALSE_EXT_FALSE"
    ),
    byArchetype: splitMetrics(graded, (r) => r.primaryArchetype || "NONE"),
  };
}

function featureAblationProxy(rows) {
  // Proxy ablation: compare subsets that lack evidence families vs full graded set.
  // True model ablation needs offline re-inference; this measures observational value.
  const graded = rows.filter((r) => r.result === "WIN" || r.result === "LOSS");
  const full = {
    label: "FULL_COURTEDGE_OBSERVED",
    ...recordOf(graded),
    brier: brier(graded),
    mae: mean(
      graded.map((r) =>
        r.projectionError == null ? null : Math.abs(r.projectionError)
      )
    ),
  };
  const variants = [
    {
      label: "without_pathway_archetype",
      rows: graded.filter((r) => !r.primaryArchetype || r.primaryArchetype === "NONE"),
    },
    {
      label: "without_false_extension_flag",
      rows: graded.filter((r) => !r.falseExtensionAnalog),
    },
    {
      label: "with_false_extension_flag_only",
      rows: graded.filter((r) => r.falseExtensionAnalog),
    },
    {
      label: "thin_books_lt4",
      rows: graded.filter((r) => (r.dataCompleteness?.bookCount ?? 0) < 4),
    },
    {
      label: "books_gte4",
      rows: graded.filter((r) => (r.dataCompleteness?.bookCount ?? 0) >= 4),
    },
    {
      label: "high_conflict_gt40",
      rows: graded.filter(
        (r) => (r.opponentQualityAdjustments?.conflictIndex ?? 0) > 40
      ),
    },
    {
      label: "low_conflict_lte40",
      rows: graded.filter(
        (r) => (r.opponentQualityAdjustments?.conflictIndex ?? 0) <= 40
      ),
    },
  ].map((v) => ({
    label: v.label,
    ...recordOf(v.rows),
    brier: brier(v.rows),
    mae: mean(
      v.rows.map((r) =>
        r.projectionError == null ? null : Math.abs(r.projectionError)
      )
    ),
  }));
  return { full, variants, note: "Observational proxy — not offline model ablation" };
}

function riskCalibration(rows) {
  const graded = rows.filter((r) => r.result === "WIN" || r.result === "LOSS");
  const byRisk = splitMetrics(graded, (r) => r.RiskV2 || "NA");
  const safetyWinners = mean(
    graded.filter((r) => r.result === "WIN").map((r) => r.Safety)
  );
  const safetyLosers = mean(
    graded.filter((r) => r.result === "LOSS").map((r) => r.Safety)
  );
  return {
    byRisk,
    safetySeparatesWinners:
      safetyWinners != null && safetyLosers != null
        ? safetyWinners > safetyLosers
        : null,
    avgSafetyWinners: safetyWinners,
    avgSafetyLosers: safetyLosers,
    avgRelWinners: mean(
      graded.filter((r) => r.result === "WIN").map((r) => r.Reliability)
    ),
    avgRelLosers: mean(
      graded.filter((r) => r.result === "LOSS").map((r) => r.Reliability)
    ),
  };
}

function falseExtensionStudy(rows) {
  const graded = rows.filter((r) => r.result === "WIN" || r.result === "LOSS");
  return {
    overall: splitMetrics(graded, (r) =>
      r.falseExtensionAnalog ? "TRUE" : "FALSE"
    ),
    bySide: splitMetrics(graded, (r) =>
      `${r.falseExtensionAnalog ? "TRUE" : "FALSE"}|${r.predictedSide}`
    ),
    byArchetype: splitMetrics(graded, (r) =>
      `${r.falseExtensionAnalog ? "TRUE" : "FALSE"}|${r.primaryArchetype || "NONE"}`
    ),
    note: "CourtEdge analogue = BLOWOUT / BLOWOUT_MINUTES failure paths. Not tennis false-extension.",
  };
}

function tierRecords(rows) {
  const graded = rows.filter((r) => r.result === "WIN" || r.result === "LOSS");
  return {
    CERTIFIED: recordOf(graded.filter((r) => r.recommendationTier === "CERTIFIED")),
    BEST_AVAILABLE: recordOf(
      graded.filter((r) => r.recommendationTier === "BEST_AVAILABLE")
    ),
    FULL_PREDICTIONS: recordOf(
      graded.filter((r) => r.recommendationTier === "FULL_PREDICTIONS")
    ),
    orderingCheck: null,
  };
}

function main() {
  ensureDir(OUT_DIR);
  const generatedAt = new Date().toISOString();

  // PHASE 1
  writeJson(path.join(OUT_DIR, "PHASE1_ARCHITECTURE_FREEZE_V1.json"), {
    version: "phase1-architecture-freeze-v1",
    generatedAt,
    programBuild: PROGRAM_BUILD,
    status: "FROZEN_NO_STRUCTURAL_CHANGE",
    architecture: ARCHITECTURE_FREEZE,
  });

  // PHASE 2
  const outcomes = buildOutcomeIndex();
  const { rows, freezeSummaries } = buildGoldDataset(outcomes);
  writeJson(path.join(OUT_DIR, "COURTEDGE_GOLD_DATASET_V1.json"), {
    version: "courteedge-gold-dataset-v1",
    generatedAt,
    programBuild: PROGRAM_BUILD,
    rowCount: rows.length,
    rows,
  });

  // PHASE 3
  const stored = rows.length;
  const gradedRows = rows.filter((r) => r.result === "WIN" || r.result === "LOSS" || r.result === "PUSH");
  const cleanFrozen = rows.filter((r) => r.cleanPregameFrozen);
  const calibEligible = rows.filter((r) => r.calibrationEligible);
  const forensicOnly = rows.filter(
    (r) => !r.calibrationEligible && r.forensicKeep
  );
  const phase3 = {
    version: "phase3-clean-historical-n-v1",
    generatedAt,
    TOTAL_STORED_ROWS: stored,
    TOTAL_GRADED_ROWS: gradedRows.length,
    TOTAL_CLEAN_PREMATCH_FROZEN_ROWS: cleanFrozen.length,
    TOTAL_CALIBRATION_ELIGIBLE_ROWS: calibEligible.length,
    FORENSIC_EXCLUDED_FROM_CALIBRATION: forensicOnly.length,
    freezeSummaries,
    excludeReasonCounts: forensicOnly.reduce((acc, r) => {
      for (const reason of r.calibrationExcludeReasons || ["ungraded"]) {
        acc[reason] = (acc[reason] || 0) + 1;
      }
      if (!(r.calibrationExcludeReasons || []).length && !r.result) {
        acc.ungraded_no_outcome = (acc.ungraded_no_outcome || 0) + 1;
      }
      return acc;
    }, {}),
  };
  writeJson(path.join(OUT_DIR, "PHASE3_CLEAN_HISTORICAL_N_V1.json"), phase3);

  const eligible = calibEligible.filter(
    (r) => r.result === "WIN" || r.result === "LOSS"
  );

  // PHASE 4
  const absErr = eligible.map((r) =>
    r.projectionError == null ? null : Math.abs(r.projectionError)
  );
  const signed = eligible.map((r) => r.projectionError);
  const phase4 = {
    version: "phase4-projection-audit-v1",
    generatedAt,
    n: eligible.length,
    mae: mean(absErr),
    medianAbsError: median(absErr),
    signedError: mean(signed),
    rmse: rmse(signed),
    bySide: splitMetrics(eligible, (r) => r.predictedSide || "NA"),
    byRisk: splitMetrics(eligible, (r) => r.RiskV2 || "NA"),
    byTier: splitMetrics(eligible, (r) => r.recommendationTier || "NA"),
    byArchetype: splitMetrics(eligible, (r) => r.primaryArchetype || "NONE"),
    byFalseExt: splitMetrics(eligible, (r) =>
      r.falseExtensionAnalog ? "TRUE" : "FALSE"
    ),
    byProbBand: probabilityBands(eligible),
  };
  writeJson(path.join(OUT_DIR, "PHASE4_PROJECTION_AUDIT_V1.json"), phase4);

  // PHASE 5
  const phase5 = {
    version: "phase5-inverse-side-audit-v1",
    generatedAt,
    ...inverseSideAudit(eligible),
  };
  writeJson(path.join(OUT_DIR, "PHASE5_INVERSE_SIDE_AUDIT_V1.json"), phase5);

  // PHASE 6
  const phase6 = {
    version: "phase6-probability-calibration-v1",
    generatedAt,
    n: eligible.length,
    brier: brier(eligible),
    bands: probabilityBands(eligible),
    note: "Recalibration of predictedProbability is NOT applied here — report only. Single authority preserved.",
  };
  writeJson(path.join(OUT_DIR, "PHASE6_PROBABILITY_CALIBRATION_V1.json"), phase6);

  // PHASE 7
  const phase7 = {
    version: "phase7-risk-safety-calibration-v1",
    generatedAt,
    ...riskCalibration(eligible),
  };
  writeJson(path.join(OUT_DIR, "PHASE7_RISK_SAFETY_CALIBRATION_V1.json"), phase7);

  // PHASE 8
  const phase8 = {
    version: "phase8-archetype-validation-v1",
    generatedAt,
    byArchetype: splitMetrics(eligible, (r) => r.primaryArchetype || "NONE"),
    byArchetypeSide: splitMetrics(
      eligible,
      (r) => `${r.primaryArchetype || "NONE"}|${r.predictedSide}`
    ),
    byArchetypeFalseExt: splitMetrics(
      eligible,
      (r) =>
        `${r.primaryArchetype || "NONE"}|${r.falseExtensionAnalog ? "FEXT" : "NOFEXT"}`
    ),
    shrinkageNote: "Tiny cohorts exploratory only — do not mint Certified rules from n<30.",
  };
  writeJson(path.join(OUT_DIR, "PHASE8_ARCHETYPE_VALIDATION_V1.json"), phase8);

  // PHASE 9
  const phase9 = {
    version: "phase9-false-extension-forensic-v1",
    generatedAt,
    ...falseExtensionStudy(eligible),
  };
  writeJson(path.join(OUT_DIR, "PHASE9_FALSE_EXTENSION_FORENSIC_V1.json"), phase9);

  // PHASE 10
  const phase10 = {
    version: "phase10-feature-ablation-proxy-v1",
    generatedAt,
    ...featureAblationProxy(eligible),
  };
  writeJson(path.join(OUT_DIR, "PHASE10_FEATURE_ABLATION_PROXY_V1.json"), phase10);

  // PHASE 11 guidance (no live tier rewrite)
  const tiers = tierRecords(rows);
  const phase11 = {
    version: "phase11-recommendation-tier-rebuild-guidance-v1",
    generatedAt,
    status: "GUIDANCE_ONLY_NO_LIVE_REWRITE",
    currentObservedRecords: tiers,
    proposedRule: {
      CERTIFIED:
        "PRIMARY + LOW/MEDIUM + calibratedProbability floor + evidence completeness + no dangerous interaction flags — only after prospective proof",
      BEST_AVAILABLE:
        "Top Official selected by C2 rank among non-Certified — always labeled uncertified",
      FULL_PREDICTIONS: "Every boardCandidate / research packet with a side — all graded",
    },
    doNot: ARCHITECTURE_FREEZE.forbidden,
  };
  writeJson(
    path.join(OUT_DIR, "PHASE11_RECOMMENDATION_TIER_GUIDANCE_V1.json"),
    phase11
  );

  // PHASE 12
  const phase12 = {
    version: "phase12-three-records-forever-v1",
    generatedAt,
    records: tiers,
    rule: "Never blend Certified / Best Available / Full Predictions into one W-L.",
  };
  writeJson(path.join(OUT_DIR, "PHASE12_THREE_RECORDS_V1.json"), phase12);

  // PHASE 13
  const phase13 = {
    version: "phase13-prospective-validation-plan-v1",
    generatedAt,
    status: "PLAN_ACTIVE",
    freezeBeforeTuning: true,
    successOrdering: ["FULL_PREDICTIONS", "BEST_AVAILABLE", "CERTIFIED"],
    successTest:
      "Prospective hitRate(CERTIFIED) > hitRate(BEST_AVAILABLE) > hitRate(FULL_PREDICTIONS)",
    failureModes: {
      certifiedNotBest: "certification broken",
      fullBoardPoor: "prediction engine broken",
      bestNotAboveFull: "ranking broken",
    },
    discipline: [
      "No tuning because tomorrow goes 1-3",
      "No one-off player exceptions",
      "Model changes from cohorts, not emotions",
    ],
  };
  writeJson(
    path.join(OUT_DIR, "PHASE13_PROSPECTIVE_VALIDATION_PLAN_V1.json"),
    phase13
  );

  // Master summary
  const master = {
    version: "courteedge-gold-learning-program-master-v1",
    generatedAt,
    programBuild: PROGRAM_BUILD,
    mappingNote:
      "User plan named TennisEdge; executed on CourtEdge WNBA single-authority engine in this repo.",
    phase1: "ARCHITECTURE_FROZEN",
    phase3,
    phase4Summary: {
      n: phase4.n,
      mae: phase4.mae,
      medianAbsError: phase4.medianAbsError,
      signedError: phase4.signedError,
      rmse: phase4.rmse,
    },
    phase5Summary: {
      predicted: phase5.predicted,
      opposite: phase5.opposite,
      edgeVsFlip: phase5.edgeVsFlip,
    },
    phase6Summary: { brier: phase6.brier, bands: phase6.bands },
    phase7Summary: {
      byRisk: phase7.byRisk,
      safetySeparatesWinners: phase7.safetySeparatesWinners,
      avgSafetyWinners: phase7.avgSafetyWinners,
      avgSafetyLosers: phase7.avgSafetyLosers,
    },
    phase12Records: tiers,
    nextActions: [
      "Keep grading every Full Prediction (not only Official)",
      "Do not retune Direction/C2 until calibration-eligible N is large and prospective ordering is tested",
      "Rebuild Certified only from evidence in PHASE11 guidance",
      "Run true offline feature ablation when re-inference harness exists",
    ],
  };
  writeJson(path.join(OUT_DIR, "MASTER_SUMMARY_V1.json"), master);

  // Markdown report
  const md = `# CourtEdge Gold Learning Program V1

Generated: ${generatedAt}

> Plan text used TennisEdge naming. This repo's production engine is **CourtEdge** (WNBA props). Architecture mapping preserved; no second brain added.

## Phase 1 — Architecture freeze
Single-authority path kept. No rescue engine. No second side/probability/risk authority.
Control plane: \`${ARCHITECTURE_FREEZE.controlPlaneBuild}\`

## Phase 3 — Clean N
| Metric | N |
|---|---:|
| TOTAL STORED ROWS | ${phase3.TOTAL_STORED_ROWS} |
| TOTAL GRADED ROWS | ${phase3.TOTAL_GRADED_ROWS} |
| TOTAL CLEAN PRE-MATCH FROZEN ROWS | ${phase3.TOTAL_CLEAN_PREMATCH_FROZEN_ROWS} |
| TOTAL CALIBRATION-ELIGIBLE ROWS | ${phase3.TOTAL_CALIBRATION_ELIGIBLE_ROWS} |

## Phase 4 — Projection audit (calibration-eligible)
- MAE: ${phase4.mae?.toFixed?.(3) ?? phase4.mae}
- Median abs error: ${phase4.medianAbsError?.toFixed?.(3) ?? phase4.medianAbsError}
- Signed error: ${phase4.signedError?.toFixed?.(3) ?? phase4.signedError}
- RMSE: ${phase4.rmse?.toFixed?.(3) ?? phase4.rmse}

## Phase 5 — Inverse-side
- Predicted: ${phase5.predicted?.record} (hit ${(phase5.predicted?.hitRate * 100)?.toFixed?.(1)}%)
- Opposite: ${phase5.opposite?.record} (hit ${(phase5.opposite?.hitRate * 100)?.toFixed?.(1)}%)
- Edge vs flip: ${phase5.edgeVsFlip?.toFixed?.(3) ?? phase5.edgeVsFlip}

## Phase 6 — Probability calibration
- Brier: ${phase6.brier?.toFixed?.(4) ?? phase6.brier}

## Phase 7 — Risk / Safety
- Safety winners > losers: ${phase7.safetySeparatesWinners}
- Avg Safety W/L: ${phase7.avgSafetyWinners?.toFixed?.(1)} / ${phase7.avgSafetyLosers?.toFixed?.(1)}

## Phase 12 — Three records (observed graded)
- CERTIFIED: ${tiers.CERTIFIED.record} (n=${tiers.CERTIFIED.n})
- BEST_AVAILABLE: ${tiers.BEST_AVAILABLE.record} (n=${tiers.BEST_AVAILABLE.n})
- FULL_PREDICTIONS: ${tiers.FULL_PREDICTIONS.record} (n=${tiers.FULL_PREDICTIONS.n})

## Phase 13 — Prospective rule
Success only if forward: Full < Best Available < Certified.
No emotional retunes after one slate.

## Outputs
All JSON artifacts in \`research/courteedge-gold-learning-v1/\`.
`;
  fs.writeFileSync(path.join(OUT_DIR, "REPORT_V1.md"), md);

  console.log(JSON.stringify(master, null, 2));
  console.log("\nWrote artifacts to", OUT_DIR);
}

main();
