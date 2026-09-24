/**
 * Era routes: Winner-C production + REB/AST shadow lab (never Official).
 */
import { getShadowSlate, appendShadowOutcomes } from "./courtEdgeMarketShadowStoreV1.js";
import { getOfficialPtsSlate } from "./courtEdgeOfficialPtsStoreV1.js";
import { buildAndPersistWinnerCSlate } from "./wnbaWinnerSlateBuilderC.js";
import { slateDateCT } from "../engines/wnba/winnersV1/constants.js";
import {
  COURTEDGE_AST_SHADOW_V1,
  COURTEDGE_PRODUCTION_PERFORMANCE_ERA,
  COURTEDGE_PTS_WINNERC_PRODUCTION_V1,
  COURTEDGE_REB_SHADOW_V1,
  COURTEDGE_SHADOW_PERFORMANCE_ERA,
  COURTEDGE_WINNER_C_PRODUCTION_V1,
  COURTEDGE_WINNER_SCOPE,
} from "../engines/courtEdgeEraV1.js";

export function registerCourtEdgeEraRoutes(app) {
  app.get("/courtedge/era", (_req, res) => {
    res.json({
      ok: true,
      production: {
        era: COURTEDGE_PTS_WINNERC_PRODUCTION_V1,
        performanceEra: COURTEDGE_PRODUCTION_PERFORMANCE_ERA,
        points: "PRODUCTION_UNCHANGED",
        winners: COURTEDGE_WINNER_C_PRODUCTION_V1,
        winnerScope: COURTEDGE_WINNER_SCOPE,
      },
      shadow: {
        era: COURTEDGE_SHADOW_PERFORMANCE_ERA,
        reb: COURTEDGE_REB_SHADOW_V1,
        ast: COURTEDGE_AST_SHADOW_V1,
        official: false,
        label: "NOT OFFICIAL / RESEARCH ONLY",
      },
      stores: {
        officialPts: "durable official-pts + data/courtedge-official-pts-v1.json + /picks",
        winnerC: "durable wnba-winners + data/wnba-winners-v1.json",
        shadowRebAst: "durable shadow-reb-ast + data/courtedge-shadow-reb-ast-v1.json",
        productTruth: "historical locked corpus — not reminted for 2026-09-21+",
      },
    });
  });

  app.get("/courtedge/official-pts", (req, res) => {
    const date = String(req.query.date || slateDateCT(new Date())).trim();
    const slate = getOfficialPtsSlate(date);
    res.json({
      ok: true,
      official: true,
      slateDateCT: date,
      slate,
    });
  });

  app.get("/courtedge/shadow-reb-ast", (req, res) => {
    const date = String(req.query.date || slateDateCT(new Date())).trim();
    const slate = getShadowSlate(date);
    res.json({
      ok: true,
      official: false,
      productTruthUntouched: true,
      label: slate?.label || "NOT OFFICIAL / RESEARCH ONLY",
      slateDateCT: date,
      slate,
    });
  });

  app.post("/courtedge/wnba-winners/build-c", async (req, res) => {
    const date = String(req.query.date || req.body?.date || slateDateCT(new Date())).trim();
    try {
      const result = await buildAndPersistWinnerCSlate(date);
      if (result.ok === false) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post("/courtedge/shadow-reb-ast/grade", (req, res) => {
    const date = String(req.query.date || req.body?.date || slateDateCT(new Date())).trim();
    const grades = Array.isArray(req.body?.grades) ? req.body.grades : [];
    const slate = appendShadowOutcomes(date, grades);
    if (!slate) return res.status(404).json({ ok: false, error: "NO_SHADOW_SLATE" });
    res.json({ ok: true, official: false, slateDateCT: date, slate });
  });
}
