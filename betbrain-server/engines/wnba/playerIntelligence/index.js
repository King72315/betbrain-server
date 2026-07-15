/**
 * CourtEdge Player Intelligence — Phases 1–7 barrel export.
 * Aliases keep parallel wiring (playerRoleProfileV1, DDI, lab) stable.
 */

export {
  PLAYER_INTELLIGENCE_VERSION,
  PLAYER_INTELLIGENCE_BUILD_TAG,
  ROLE_STABILITY,
  USAGE_PROFILE,
  SCORING_PROFILE,
  OPPORTUNITY_TREND,
  AVAILABILITY_PROFILE,
  buildPlayerIntelligenceProfile,
  computeAdaptiveProfileConfidence,
  mapToLegacyRoleFields,
  mapIntelligenceToLegacyRoleFields,
  snapshotPlayerProfileForLab,
  resolveIntelligenceGameSample,
  classifyRoleStabilityScore,
  classifyUsageProfile,
  classifyScoringProfile,
  classifyOpportunityTrend,
  classifyAvailabilityProfile,
  computeVolatilityIndex,
} from "./playerIntelligenceEngineV1.js";

export {
  getStoredPlayerProfile,
  savePlayerProfile,
  getOrBuildPlayerIntelligenceProfile,
  updateAdaptiveProfileFromGrade,
  clearPlayerIntelligenceMemoryCache,
  getPlayerIntelligenceStorePath,
} from "./playerProfileStoreV1.js";

/** Alias used by playerRoleProfileV1 */
export { getStoredPlayerProfile as getCachedPlayerProfile } from "./playerProfileStoreV1.js";

export {
  PROJECTION_ADJUSTMENT_VERSION,
  PROJECTION_CAPS,
  buildProjectionAdjustments,
  applyProjectionAdjustmentPipeline,
  applyPlayerIntelligenceProjectionAdjustments,
  buildIntelligenceProjectionCalibration,
} from "./projectionAdjustmentEngineV1.js";

export {
  CONFIDENCE_ENGINE_VERSION,
  CONFIDENCE_WEIGHTS,
  computePlayerIntelligenceConfidence,
  confidenceEngineDirectionalDelta,
  scoreProjectionQuality,
  scoreProjectionEdgeStrength,
  scorePlayerStability,
  scoreUsageStability,
  scoreHistoricalAccuracy,
  scoreMarketAgreement,
  scoreSameTeamOpportunity,
  scoreDecisionIntelligence,
  scoreRecentCalibration,
} from "./confidenceEngineV1.js";

export {
  EVIDENCE_FINAL_CONFIDENCE_VERSION,
  EVIDENCE_FINAL_WEIGHTS,
  computeEvidenceFinalConfidence,
  applyEvidenceFinalConfidenceToPick,
} from "./evidenceFinalConfidenceV1.js";

export {
  MULTI_CONFIDENCE_VERSION,
  computeMultiComponentConfidence,
  applyMultiConfidenceToPick,
} from "./multiConfidenceEngineV1.js";

export {
  SAME_TEAM_OPPORTUNITY_VERSION,
  OPPORTUNITY_STATUS,
  resolveImpliedTeamTotal,
  evaluateSameTeamOpportunityCluster,
  underIndependentlyWins,
  evaluateSlateSameTeamOpportunity,
  applySameTeamOpportunityAdjustments,
  evaluateSameTeamOpportunityForPick,
  evaluateSameTeamOpportunity,
  evaluateSlateSameTeamOpportunities,
  evaluateSameTeamUsageCollisionViaOpportunity,
} from "./sameTeamOpportunityEngineV1.js";

export {
  HISTORICAL_CALIBRATION_VERSION,
  recordGradedPropCalibration,
  getLearnedCalibrationForProfile,
  getHistoricalAccuracyForPlayer,
  getCalibrationStoreSummary,
  getCalibrationRecords,
  getCalibrationFilePath,
  getCalibrationHintsForPlayer,
} from "./historicalCalibrationEngineV1.js";

export {
  PLAYER_PROFILE_LAB_VERSION,
  buildPlayerProfileLabReport,
  attachProfileLabFieldsToTracked,
} from "./playerProfileLabV1.js";

export {
  PROJECTION_BIAS_MONITOR_VERSION,
  computeProjectionBiasMetrics,
  buildProjectionBiasReport,
} from "./projectionBiasMonitorV1.js";
