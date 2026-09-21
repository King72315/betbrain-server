/**
 * Separate REB/AST shadow freeze store. Never Official Results.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { buildShadowBoards } from "../engines/wnba/shadow/rebAstShadowBoardV1.js";
import {
  COURTEDGE_AST_SHADOW_V1,
  COURTEDGE_REB_SHADOW_V1,
  isCourtEdgePtsWinnerCEra,
  isShadowPropMarket,
  normalizePropMarket,
} from "../engines/courtEdgeEraV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "courtedge-shadow-reb-ast-v1.json");

function atomicWrite(file, value) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readStore() {
  if (!fs.existsSync(FILE)) return { slates: {} };
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { slates: {} };
  }
}

export function persistShadowBoards({ slateDateCT, packets = [], fetchedAt = new Date().toISOString() } = {}) {
  if (!isCourtEdgePtsWinnerCEra(slateDateCT)) return null;
  const boards = buildShadowBoards(packets);
  const payload = {
    marker: "courtedge-reb-ast-shadow-v1",
    official: false,
    label: "NOT OFFICIAL / RESEARCH ONLY",
    slateDateCT,
    frozenAt: fetchedAt,
    predictionTimestampCT: fetchedAt,
    eras: { reb: COURTEDGE_REB_SHADOW_V1, ast: COURTEDGE_AST_SHADOW_V1 },
    reb: boards.reb,
    ast: boards.ast,
  };
  const freezeHash = crypto.createHash("sha256").update(JSON.stringify({
    slateDateCT,
    reb: boards.reb.rows.map((r) => [r.player, r.line, r.side, r.projection, r.candidates]),
    ast: boards.ast.rows.map((r) => [r.player, r.line, r.side, r.projection, r.candidates]),
  })).digest("hex");
  payload.freezeHash = freezeHash;
  const store = readStore();
  const existing = store.slates[slateDateCT];
  const incomingEmpty = (boards.reb.analyzed || 0) + (boards.ast.analyzed || 0) === 0;
  if (existing?.freezeHash && existing.immutable === true) {
    const existingEmpty = (existing.reb?.analyzed || 0) + (existing.ast?.analyzed || 0) === 0;
    if (!existingEmpty || incomingEmpty) return existing;
  }
  store.slates[slateDateCT] = {
    ...payload,
    immutable: !incomingEmpty,
  };
  atomicWrite(FILE, store);
  return store.slates[slateDateCT];
}

export function getShadowSlate(slateDateCT) {
  return readStore().slates[slateDateCT] || null;
}

export function appendShadowOutcomes(slateDateCT, grades = []) {
  const store = readStore();
  const slate = store.slates[slateDateCT];
  if (!slate) return null;
  const byKey = new Map(grades.map((g) => [`${g.player}|${g.market}|${g.line}`, g]));
  const apply = (rows) =>
    (rows || []).map((r) => {
      const g = byKey.get(`${r.player}|${r.market}|${r.line}`);
      if (!g) return r;
      return {
        ...r,
        postgame: {
          actualMinutes: g.actualMinutes ?? null,
          actualRebounds: g.actualRebounds ?? (r.market === "REBOUNDS" ? g.actual ?? null : null),
          actualAssists: g.actualAssists ?? (r.market === "ASSISTS" ? g.actual ?? null : null),
          actual: g.actual ?? null,
          starterStatus: g.starterStatus ?? null,
          actualRole: g.actualRole ?? null,
          actualTeamShooting: g.actualTeamShooting ?? null,
          actualOpponentShooting: g.actualOpponentShooting ?? null,
          actualPace: g.actualPace ?? null,
          actualPossessions: g.actualPossessions ?? null,
          potentialAssists: g.potentialAssists ?? null,
          touches: g.touches ?? null,
          timeOfPossession: g.timeOfPossession ?? null,
          teammateConversion: g.teammateConversion ?? null,
          estimatedReboundOpportunities: g.estimatedReboundOpportunities ?? null,
          teamOpponentMissedShots: g.teamOpponentMissedShots ?? null,
          reboundShare: g.reboundShare ?? null,
          dnp: g.dnp === true || g.actualMinutes === 0,
          missClass: g.missClass ?? null,
          gradedAt: new Date().toISOString(),
          separatedFromPrematch: true,
        },
      };
    });
  slate.reb.rows = apply(slate.reb.rows);
  slate.ast.rows = apply(slate.ast.rows);
  slate.reb.hypotheticalTop6 = apply(slate.reb.hypotheticalTop6);
  slate.ast.hypotheticalTop6 = apply(slate.ast.hypotheticalTop6);
  store.slates[slateDateCT] = slate;
  atomicWrite(FILE, store);
  return slate;
}

export function appendShadowOutcomeFromTracked(pick = {}) {
  const date = pick.slateDate || pick.canonicalSlateDateCT || pick.slateDateCT || pick.dateCT;
  if (!isCourtEdgePtsWinnerCEra(date)) return null;
  const market = normalizePropMarket(pick.propType || pick.stat || pick.market || pick.marketKey);
  if (!isShadowPropMarket(market)) return null;
  return appendShadowOutcomes(date, [
    {
      player: pick.playerName || pick.player,
      market,
      line: pick.line ?? pick.officialLine,
      actualMinutes: pick.postgameTruth?.minutes ?? pick.actualMinutes ?? null,
      actual: pick.actualStat ?? pick.result ?? null,
      actualRebounds: market === "REBOUNDS" ? pick.actualStat ?? null : null,
      actualAssists: market === "ASSISTS" ? pick.actualStat ?? null : null,
      starterStatus: pick.postgameTruth?.starterStatus ?? pick.actualStarterStatus ?? null,
      dnp: pick.actualMinutes === 0,
    },
  ]);
}
