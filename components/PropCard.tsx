import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  formatAvailabilitySummary,
  formatDefenseSummary,
  formatGateLabel,
} from "../utils/pointStrengthLedger";

type PropCardProps = {
  pick: any;
  index?: number;
  game?: any;
  onSave?: () => void;
  onDelete?: () => void;
  showSaveHint?: boolean;
  showDelete?: boolean;
  compact?: boolean;
  variant?: "default" | "bestSix";
  playType?: "Official" | "Test";
};

export default function PropCard({
  pick,
  index = 0,
  game = {},
  onSave,
  onDelete,
  showSaveHint = false,
  showDelete = false,
  compact = false,
  variant = "default",
  playType,
}: PropCardProps) {
  const [expanded, setExpanded] = useState(false);

  const [roleExpanded, setRoleExpanded] = useState(false);
  const [fairLineExpanded, setFairLineExpanded] = useState(false);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);

  const wnbaTrackingDecision =
    pick.decisionIntelligence?.trackEligibility || pick.wnbaTrackingDecision;
  const wnbaTrackingReason =
    pick.decisionIntelligence?.gateReason || pick.wnbaTrackingReason;
  const tier = String(pick.tier || "WATCHLIST").toUpperCase();
  const wnbaV2 = String(pick.engineHandled || "") === "WNBA_V2";
  // Control-plane Official: C2 risk + displayConfidence only. DDI is research.
  const officialControlPlane = Boolean(
    pick.officialSelected === true ||
      pick.controlPlaneBuild ||
      String(pick.riskOwner || "").includes("EMPIRICAL_SAFE_PROP_V2") ||
      pick.membershipVersion ||
      (pick.architectureBuild &&
        String(pick.architectureBuild).includes("empirical"))
  );
  const membershipRiskOwner = officialControlPlane;
  const trueRisk = officialControlPlane
    ? pick.c2Risk || pick.displayTrueRisk || pick.trueRisk || pick.v2Risk
    : pick.decisionIntelligence?.trueRisk || pick.trueRisk;
  const decisionExplanation = pick.decisionIntelligence?.simpleExplanation;
  const readerDecision = pick.readerDecision || pick.wnbaReader?.decision;
  const readerConfidence =
    pick.readerConfidence ?? pick.wnbaReader?.readerConfidence;
  const dataConfidence =
    pick.dataConfidence ?? pick.wnbaDataCard?.dataConfidenceScore ?? pick.dataQuality;
  const dataIntegrity =
    pick.dataIntegrity || pick.wnbaDataCard?.dataIntegrity || null;
  const dataIntegrityLabel =
    pick.dataIntegrityOverall ||
    dataIntegrity?.overall ||
    (Number(dataConfidence) >= 75
      ? "GOOD"
      : Number(dataConfidence) >= 55
        ? "PARTIAL"
        : "BAD");
  const dataIntegrityIssues = dataIntegrity?.issues || [];
  const bestPropScore = pick.bestPropScore ?? pick.finalBestPropScore;
  const whySide = pick.whySide || pick.wnbaReader?.supports || pick.support || [];
  const missingWarnings =
    pick.missingDataWarnings ||
    (dataIntegrityIssues.length
      ? dataIntegrityIssues.map((issue: any) => issue.message || issue.key)
      : (pick.wnbaDataCard?.dataMissingFlags || [])
          .filter((f: any) => f.missing)
          .map((f: any) => f.note || f.key));
  const wnbaShadowEnabled =
    process.env.EXPO_PUBLIC_WNBA_SHADOW_RECALIBRATION === "true";
  const wnbaShadow = pick.wnbaShadow || null;
  const shadowTier = wnbaShadow?.shadowTier
    ? String(wnbaShadow.shadowTier).toUpperCase()
    : null;
  // Official: displayConfidence only. Research rows may use sealed/analysis trails.
  const canonical = pick.homeDetailedAnalysisV1?.canonical || {};
  const confidenceRaw = officialControlPlane
    ? pick.displayConfidence ??
      pick.finalConfidence ??
      pick.confidence ??
      50
    : canonical.confidence ??
      pick.finalConfidence ??
      pick.confidence ??
      pick.winProbability
  const confidence =
    confidenceRaw === null || confidenceRaw === undefined || confidenceRaw === ""
      ? null
      : Math.round(Number(confidenceRaw));
  const side = pick.side || pick.pick || "";
  const line = pick.line ?? pick.sportsbookLine;
  const propTypeRaw = String(
    pick.propType || pick.canonicalPropType || pick.stat || "POINTS"
  ).toUpperCase();
  const displayStat = propTypeRaw.includes("REBOUND")
    ? "REBOUNDS"
    : propTypeRaw.includes("ASSIST")
      ? "ASSISTS"
      : "POINTS";
  const stat = displayStat;
  const league = pick.league || game.league || "—";
  const dataMode =
    pick.dataMode || pick.playerState?.dataMode || "";
  const playerState = pick.playerState || {};
  const roleChange = pick.roleChange || {};
  const volumeProfile = pick.volumeProfile || {};
  const scoreLedger = pick.scoreLedger || [];
  const marketIntelligence = pick.marketIntelligence || {};
  const volumeDangerGates = pick.volumeDangerGates || {};
  const availabilityGate = pick.availabilityGate || {};
  const defenseResult = pick.defenseResult || {};
  const opponentHistoryLabel =
    pick.opponentHistoryLabel ??
    pick.flipFirstLabels?.opponentHistory ??
    pick.decisionDataIntelligence?.flipFirstLabels?.opponentHistory ??
    null;
  const openingLine =
    pick.openingLine ?? marketIntelligence.openingLine;
  const currentLine =
    pick.currentLine ?? marketIntelligence.currentLine ?? line;
  const lineDelta =
    pick.lineDelta ?? marketIntelligence.lineDelta;
  const status = getStatusLabel(pick);
  const commenceTime =
    pick.commenceTime || pick.time || game.commenceTime || game.time;
  const startTimeDisplay =
    pick.startTimeDisplay || formatTime(commenceTime);
  const matchDate =
    pick.gameDate || pick.date || game.date || game.gameDate || "";
  const dayBucketLabel =
    pick.dateLabel ||
    game.dateLabel ||
    (pick.dayBucket ? String(pick.dayBucket) : "");
  const team = pick.team || "—";
  const opponent = pick.opponent || "—";
  const gameLabel =
    pick.game ||
    game.game ||
    `${formatTeam(team)} vs ${formatTeam(opponent)}`;
  const resolvedPlayType =
    playType ||
    (pick.officialEligible === false ? "Test" : "Official");

  if (variant === "bestSix") {
    const rank = pick.bestSixRank || pick.controlledBestSixRank || index + 1;
    const trackDecision = "OFFICIAL";
    const displayTrueRisk = String(
      membershipRiskOwner
        ? canonical.risk ||
            pick.v2Risk ||
            pick.displayTrueRisk ||
            pick.trueRisk ||
            trueRisk ||
            "—"
        : canonical.risk ||
            pick.displayTrueRisk ||
            pick.decisionIntelligence?.trueRisk ||
            trueRisk ||
            pick.trueRisk ||
            "—"
    ).toUpperCase();
    const sameTeamFlip = Boolean(
      pick.sameTeamArbitrationFlip ||
        pick.sameTeamArbitration?.applied ||
        pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
    );
    const originalModelSide =
      pick.originalModelSide ||
      pick.sameTeamArbitration?.originalModelSide ||
      null;
    const finalCourtEdgeSide =
      pick.finalCourtEdgeSide ||
      canonical.side ||
      (String(side).toUpperCase().startsWith("U") ? "UNDER" : "OVER");
    const whyTextRaw =
      pick.displayWhy || decisionExplanation || wnbaTrackingReason || "";
    const whyText = String(whyTextRaw)
      .replace(/\b(BOARD_ONLY|NO_BET|SHADOW_ONLY|NATURAL_TRACK|READER_UNCERTAIN(?:_TEST)?|NO_DECISIVE_RESCUE|UNDER_GAP_BELOW_[A-Z0-9_]+|OVER_GAP_BELOW_[A-Z0-9_]+|DANGER_STACK_[A-Z0-9_]+|DANGER_GATE_STACK_[A-Z0-9_]+)\b/gi, "")
      .replace(/\bdanger[\s_-]*gates?\b/gi, "risk factors")
      .replace(/\bgap[\s_-]*floors?\b/gi, "projection threshold")
      .replace(/prior gate:\s*/gi, "")
      .replace(/Natural Track/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const riskDebts: string[] =
      pick.displayRiskDebts ||
      (pick.decisionIntelligence?.riskDebts || []).map((d: any) =>
        typeof d === "string" ? d : d.label || d.code || String(d)
      );
    const riskRepairs: string[] =
      pick.displayRiskRepairs ||
      (pick.decisionIntelligence?.riskRepairs || []).map((d: any) =>
        typeof d === "string" ? d : d.label || d.code || String(d)
      );
    // Side Rescue has no production authority — never render rescue chrome.
    // Same-team arbitration remains a separate, legitimate display path.
    const sideRescueAction = sameTeamFlip ? "SAME_TEAM_ARBITRATION" : null;
    const sideRescueExplanation = sameTeamFlip ? whyText : "";
    const flipLabels =
      pick.displayFlipFirstLabels ??
      pick.flipFirstLabels ??
      pick.decisionDataIntelligence?.flipFirstLabels ??
      null;
    const opponentDefenseStatus =
      pick.defenseResult?.status ||
      pick.courtEdgePlayerEvidence?.opponentContext?.defenseStatus ||
      null;
    const opponentDefenseScore =
      pick.defenseResult?.defenseScore ??
      pick.courtEdgePlayerEvidence?.opponentContext?.defenseScore ??
      null;

    return (
      <TouchableOpacity
        activeOpacity={onSave ? 0.86 : 1}
        onPress={onSave}
        disabled={!onSave}
        style={[styles.pickCard, styles.bestSixCard]}
      >
        <View style={styles.pickTopRow}>
          <View style={styles.badgeRow}>
            <Text style={styles.bestSixBadge}>#{rank}</Text>
            {pick.topPickLabel ? (
              <Text style={styles.topPickBadge}>{pick.topPickLabel}</Text>
            ) : null}
            <Text style={[styles.decisionBadge, getDecisionStyle(trackDecision)]}>
              {trackDecision}
            </Text>
          </View>
          <Text style={styles.confidenceText}>
            {confidence == null ? "—" : `${confidence}%`}
          </Text>
        </View>

        <Text style={styles.playerName}>{pick.player}</Text>
        <Text style={styles.teamText}>
          {formatTeam(team)} · {gameLabel}
        </Text>
        {startTimeDisplay ? (
          <Text style={styles.metaText}>{startTimeDisplay}</Text>
        ) : null}

        <View style={styles.pickLineBox}>
          <Text style={styles.pickSide}>
            {side} {safeDisplay(line)} {displayStat}
          </Text>
        </View>

        <View style={styles.bestSixMetricRow}>
          <Metric label="Risk" value={displayTrueRisk} />
          <Metric label="Decision" value={trackDecision} />
          <Metric label="Data" value={dataIntegrityLabel} />
        </View>

        {sameTeamFlip ? (
          <View style={styles.bestSixFlipRow}>
            <Metric
              label="Model Side"
              value={originalModelSide || "OVER"}
            />
            <Metric label="Final Side" value={finalCourtEdgeSide || "UNDER"} />
            <Metric label="Arbitration" value="Applied" />
          </View>
        ) : null}

        {flipLabels ? (
          <View style={styles.bestSixFlipRow}>
            <Metric label="Usage" value={flipLabels.usage || "—"} />
            <Metric label="Collision" value={flipLabels.collision || "—"} />
            <Metric label="Market" value={flipLabels.market || "—"} />
          </View>
        ) : null}
        {flipLabels ? (
          <View style={styles.bestSixFlipRow}>
            <Metric label="Availability" value={flipLabels.availability || "—"} />
            <Metric
              label="Opponent"
              value={
                opponentDefenseStatus &&
                String(opponentDefenseStatus).toUpperCase() !== "UNAVAILABLE"
                  ? `${opponentDefenseScore ?? "—"} (${opponentDefenseStatus})`
                  : flipLabels.opponentHistory || "—"
              }
            />
            <Metric label="Proj Q" value={flipLabels.projectionQuality || "—"} />
          </View>
        ) : null}

        {opponentHistoryLabel && !sameTeamFlip ? (
          <Text style={styles.bestSixOppHistLine}>
            Opponent History: {opponentHistoryLabel}
          </Text>
        ) : null}

        {whyText ? (
          <View style={styles.bestSixWhyBox}>
            <Text style={styles.bestSixWhyTitle}>Why</Text>
            <Text style={styles.bestSixWhyText}>{whyText}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={(e) => {
            e?.stopPropagation?.();
            setExpanded((v) => !v);
          }}
          style={styles.detailedAnalysisToggle}
        >
          <Text style={styles.detailedAnalysisToggleText}>
            {expanded ? "Hide Detailed Analysis" : "View Detailed Analysis"}
          </Text>
        </TouchableOpacity>

        {expanded ? (
          <DetailedAnalysisPanel
            analysis={pick.homeDetailedAnalysisV1}
            pick={pick}
          />
        ) : null}

        {riskDebts.length > 0 ? (
          <View style={styles.bestSixDebtBox}>
            <Text style={styles.bestSixDebtTitle}>Risk Debt</Text>
            {riskDebts
              .filter((line) => {
                const s = String(line);
                if (/BOARD_ONLY|NO_BET|NATURAL_TRACK|READER_UNCERTAIN/i.test(s)) {
                  return false;
                }
                if (
                  /neutral proxy|missing opponent defense/i.test(s) &&
                  String(opponentDefenseStatus || "")
                    .toUpperCase()
                    .startsWith("CALCULATED")
                ) {
                  return false;
                }
                return true;
              })
              .slice(0, 3)
              .map((line, i) => (
              <Text key={`debt-${i}`} style={styles.bestSixDebtLine}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        {riskRepairs.length > 0 ? (
          <View style={styles.bestSixRepairBox}>
            <Text style={styles.bestSixRepairTitle}>Risk Repair</Text>
            {riskRepairs.slice(0, 3).map((line, i) => (
              <Text key={`repair-${i}`} style={styles.bestSixRepairLine}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        {sameTeamFlip ? (
          <View style={styles.bestSixRescueBox}>
            <Text style={styles.bestSixRescueTitle}>Same-Team Arbitration</Text>
            {sideRescueExplanation ? (
              <Text style={styles.bestSixRescueText} numberOfLines={3}>
                {String(sideRescueExplanation).replace(/^Side Rescue: [^—]+ — /, "")}
              </Text>
            ) : null}
          </View>
        ) : null}

        {showSaveHint && onSave ? (
          <Text style={styles.saveHint}>Tap card to save pick</Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  if (compact) {
    const topReasons = [
      ...whySide.slice(0, 2),
      ...(pick.reasons || []).slice(0, 2),
    ].filter(Boolean);

    return (
      <TouchableOpacity
        activeOpacity={onSave ? 0.86 : 1}
        onPress={onSave}
        disabled={!onSave}
        style={[styles.pickCard, tier === "PREMIUM" && styles.premiumPickCard]}
      >
        <View style={styles.pickTopRow}>
          <View style={styles.badgeRow}>
            {pick.bestSixLabel ? (
              <Text style={styles.bestSixBadge}>{pick.bestSixLabel}</Text>
            ) : pick.controlledBestSixRank ? (
              <Text style={styles.bestSixBadge}>B6 #{pick.controlledBestSixRank}</Text>
            ) : null}
            {pick.topPickLabel ? (
              <Text style={styles.topPickBadge}>{pick.topPickLabel}</Text>
            ) : pick.topPickRank ? (
              <Text style={styles.topPickBadge}>Top #{pick.topPickRank}</Text>
            ) : (
              <Text style={styles.rankBadge}>#{pick.rank || index + 1}</Text>
            )}
            <Text style={styles.leagueBadge}>{league}</Text>
            <Text
              style={[
                styles.playTypeBadge,
                resolvedPlayType === "Official"
                  ? styles.officialPlayTypeBadge
                  : styles.testPlayTypeBadge,
              ]}
            >
              {resolvedPlayType}
            </Text>
            {wnbaV2 ? <Text style={styles.engineBadge}>WNBA v2</Text> : null}
          </View>
          <Text style={styles.confidenceText}>
            {confidence == null ? "—" : `${confidence}%`}
          </Text>
        </View>

        <Text style={styles.playerName}>{pick.player}</Text>
        <Text style={styles.teamText}>
          {formatTeam(team)} vs {formatTeam(opponent)}
        </Text>
        {startTimeDisplay ? (
          <Text style={styles.metaText}>{startTimeDisplay}</Text>
        ) : null}

        <View style={styles.pickLineBox}>
          <Text style={styles.pickSide}>
            {side} {safeDisplay(line)} {displayStat}
          </Text>
          {wnbaV2 ? (
            <View style={styles.wnbaV2Compact}>
              <Text style={styles.wnbaV2Line}>
                Score {safeDisplay(bestPropScore)} • {readerDecision || "—"} • Reader{" "}
                {safeDisplay(readerConfidence)}% • Data {dataIntegrityLabel}
              </Text>
              {whySide?.length ? (
                <Text style={styles.wnbaV2Why} numberOfLines={2}>
                  Why {side}: {whySide.slice(0, 2).join(" • ")}
                </Text>
              ) : null}
              {missingWarnings?.length ? (
                <Text style={styles.wnbaV2Warn} numberOfLines={2}>
                  Missing: {missingWarnings.slice(0, 3).join(", ")}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.projectionText}>
            Projection {safeDisplay(pick.projection)} • Fair Line{" "}
            {safeDisplay(pick.fairLine)}
          </Text>
        </View>

        {topReasons.length > 0 ? (
          <View style={styles.compactReasonBox}>
            {topReasons.slice(0, 3).map((reason: string, i: number) => (
              <Text key={`compact-reason-${i}`} style={styles.previewReason}>
                • {reason}
              </Text>
            ))}
          </View>
        ) : null}

        {wnbaTrackingDecision || decisionExplanation ? (
          <Text style={styles.wnbaV2Warn}>
            {decisionExplanation ||
              `Gate ${wnbaTrackingDecision}${wnbaTrackingReason ? ` · ${wnbaTrackingReason}` : ""}`}
            {trueRisk ? ` · True ${trueRisk}` : ""}
            {pick.riskAfterCeiling ? ` · ${pick.riskAfterCeiling}` : ""}
          </Text>
        ) : null}

        {!wnbaV2 && missingWarnings?.length ? (
          <Text style={styles.wnbaV2Warn}>
            Missing: {missingWarnings.slice(0, 3).join(", ")}
          </Text>
        ) : null}

        {showSaveHint && onSave ? (
          <Text style={styles.saveHint}>Tap card to save pick</Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={onSave ? 0.86 : 1}
      onPress={onSave}
      disabled={!onSave}
      style={[styles.pickCard, tier === "PREMIUM" && styles.premiumPickCard]}
    >
      <View style={styles.pickTopRow}>
        <View style={styles.badgeRow}>
          <Text style={styles.rankBadge}>#{pick.rank || index + 1}</Text>
          <Text style={styles.leagueBadge}>{league}</Text>
          <Text
            style={[styles.tierBadge, tier === "PREMIUM" && styles.premiumBadge]}
          >
            {tier}
          </Text>
          {status ? (
            <Text style={[styles.statusBadge, getStatusStyle(status)]}>
              {status}
            </Text>
          ) : null}
          {dataMode ? (
            <Text style={styles.dataModeBadge}>{formatDataMode(dataMode)}</Text>
          ) : null}
          {wnbaV2 ? (
            <Text style={styles.engineBadge}>WNBA v2</Text>
          ) : null}
          {pick.bestSixLabel ? (
            <Text style={styles.bestSixBadge}>{pick.bestSixLabel}</Text>
          ) : pick.controlledBestSixRank ? (
            <Text style={styles.bestSixBadge}>B6 #{pick.controlledBestSixRank}</Text>
          ) : null}
          {pick.topPickLabel ? (
            <Text style={styles.topPickBadge}>{pick.topPickLabel}</Text>
          ) : pick.topPickRank ? (
            <Text style={styles.topPickBadge}>Top #{pick.topPickRank}</Text>
          ) : null}
          {wnbaShadowEnabled && wnbaShadow && shadowTier ? (
            <Text style={styles.shadowTierBadge}>Shadow {shadowTier}</Text>
          ) : null}
        </View>

        <Text style={styles.confidenceText}>
          {confidence == null ? "—" : `${confidence}%`}
        </Text>
      </View>

      <Text style={styles.playerName}>{pick.player}</Text>
      <Text style={styles.gameText}>{gameLabel}</Text>
      <Text style={styles.metaText}>
        {dayBucketLabel ? `${dayBucketLabel}` : ""}
        {matchDate ? `${dayBucketLabel ? " • " : ""}Date: ${matchDate}` : ""}
        {startTimeDisplay
          ? `${dayBucketLabel || matchDate ? " • " : ""}Start: ${startTimeDisplay}`
          : ""}
      </Text>
      <Text style={styles.teamText}>
        {formatTeam(team)} vs {formatTeam(opponent)}
      </Text>

      <View style={styles.pickLineBox}>
        <Text style={styles.pickSide}>
          {side} {safeDisplay(line)} {displayStat}
        </Text>
        {wnbaV2 ? (
          <View style={styles.wnbaV2Compact}>
            <Text style={styles.wnbaV2Line}>
              Score {safeDisplay(bestPropScore)} • {readerDecision || "—"} • Reader{" "}
              {safeDisplay(readerConfidence)}% • Data {dataIntegrityLabel}
            </Text>
            {whySide?.length ? (
              <Text style={styles.wnbaV2Why} numberOfLines={2}>
                Why {side}: {whySide.slice(0, 2).join(" • ")}
              </Text>
            ) : null}
            {missingWarnings?.length ? (
              <Text style={styles.wnbaV2Warn} numberOfLines={2}>
                Missing: {missingWarnings.slice(0, 3).join(", ")}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.projectionText}>
          Projection {safeDisplay(pick.projection)} • Edge {safeDisplay(pick.edge)}
        </Text>
        {pick.odds || pick.price ? (
          <Text style={styles.projectionText}>
            Odds {safeDisplay(pick.odds ?? pick.price)}
          </Text>
        ) : null}
      </View>

      <View style={styles.metricGrid}>
        <Metric
          label="Risk"
          value={
            officialControlPlane
              ? trueRisk || pick.riskLabel || "—"
              : pick.riskAfterCeiling || pick.riskLabel || trueRisk || "—"
          }
        />
        {!officialControlPlane && trueRisk ? (
          <Metric label="True Risk" value={trueRisk} />
        ) : null}
        {wnbaTrackingDecision ? (
          <Metric label="Track" value={wnbaTrackingDecision} />
        ) : null}
        {wnbaTrackingReason ? (
          <Metric label="Track Reason" value={wnbaTrackingReason} />
        ) : null}
        {pick.riskCeilingReason ? (
          <Metric label="Risk Ceiling" value={pick.riskCeilingReason} />
        ) : null}
        {!officialControlPlane ? (
          <Metric label="Signal" value={pick.signalStrength || "—"} />
        ) : pick.directionAdmission ? (
          <Metric label="Admission" value={pick.directionAdmission} />
        ) : null}
        <Metric label="Support" value={safeDisplay(pick.supportScore)} />
        <Metric
          label="Danger"
          value={safeDisplay(pick.resistanceScore ?? pick.dangerScore)}
        />
        <Metric label="Net Edge" value={safeDisplay(pick.netEdge)} />
        <Metric label="Books" value={safeDisplay(pick.bookCount)} />
        <Metric label="Data" value={`${safeDisplay(pick.dataQuality)}%`} />
        <Metric label="Market" value={`${safeDisplay(pick.marketQuality)}%`} />
      </View>

      {decisionExplanation ? (
        <View style={styles.decisionIntelBox}>
          <Text style={styles.decisionIntelTitle}>Decision Intelligence</Text>
          <Text style={styles.decisionIntelText}>{decisionExplanation}</Text>
        </View>
      ) : null}

      <View style={styles.statRow}>
        <Text style={styles.statText}>
          Last 5 Avg: {safeDisplay(pick.last5Average)}
        </Text>
        <Text style={styles.statText}>
          Season Avg: {safeDisplay(pick.seasonAverage)}
        </Text>
      </View>

      <Text style={styles.v3PreviewLabel}>
        Pricing engine v3 preview — side/confidence unchanged
      </Text>

      <View style={styles.v3Section}>
        <Text style={styles.v3SectionTitle}>Role Change</Text>
        <View style={styles.metricGrid}>
          <Metric
            label="Role Score"
            value={safeDisplay(roleChange.roleChangeScore)}
          />
          <Metric
            label="Role Certainty"
            value={
              roleChange.roleChangeCertainty !== undefined
                ? `${safeDisplay(roleChange.roleChangeCertainty)}%`
                : "—"
            }
          />
        </View>
      </View>

      <View style={styles.v3Section}>
        <Text style={styles.v3SectionTitle}>Season vs Recent</Text>
        <View style={styles.compareRow}>
          <Text style={styles.compareLabel}>Points</Text>
          <Text style={styles.compareValue}>
            {safeDisplay(playerState.seasonPoints ?? pick.seasonAverage)} →{" "}
            {safeDisplay(playerState.recentPoints ?? pick.last5Average)}
          </Text>
        </View>
        <View style={styles.compareRow}>
          <Text style={styles.compareLabel}>Minutes</Text>
          <Text style={styles.compareValue}>
            {safeDisplay(playerState.seasonMinutes)} →{" "}
            {safeDisplay(
              playerState.recentMinutes ??
                pick.minutesAverage ??
                pick.recentMinutes
            )}
          </Text>
        </View>
        <View style={styles.compareRow}>
          <Text style={styles.compareLabel}>FGA</Text>
          <Text style={styles.compareValue}>
            {safeDisplay(playerState.seasonFGA)} →{" "}
            {safeDisplay(playerState.recentFGA ?? pick.fgaAverage ?? pick.recentFGA)}
          </Text>
        </View>
        <View style={styles.compareRow}>
          <Text style={styles.compareLabel}>FTA</Text>
          <Text style={styles.compareValue}>
            {safeDisplay(playerState.seasonFTA)} →{" "}
            {safeDisplay(playerState.recentFTA ?? pick.ftaAverage ?? pick.recentFTA)}
          </Text>
        </View>
      </View>

      <View style={styles.v3Section}>
        <Text style={styles.v3SectionTitle}>Point Strength Ledger</Text>

        <View style={styles.metricGrid}>
          <Metric
            label="Shot Volume"
            value={safeDisplay(volumeProfile.shotVolume ?? pick.shotVolume)}
          />
          <Metric
            label="Vol Stability"
            value={volumeProfile.volumeStability || "—"}
          />
          <Metric label="Role Trend" value={volumeProfile.roleTrend || "—"} />
          <Metric
            label="Book Line"
            value={safeDisplay(currentLine ?? line)}
          />
          <Metric label="Opening Line" value={safeDisplay(openingLine)} />
          <Metric
            label="Line Delta"
            value={
              lineDelta !== undefined && lineDelta !== null
                ? `${Number(lineDelta) >= 0 ? "+" : ""}${safeDisplay(lineDelta)}`
                : "—"
            }
          />
          <Metric
            label="Snapshot Time"
            value={formatTime(pick.snapshotTime) || "—"}
          />
          <Metric label="Books" value={safeDisplay(pick.bookCount)} />
        </View>

        {volumeProfile.efficiencyWarning ? (
          <Text style={styles.previewRisk}>⚠️ {volumeProfile.efficiencyWarning}</Text>
        ) : null}

        {volumeProfile.wnbaLimitedData ? (
          <Text style={styles.ledgerMeta}>WNBA limited-data profile (BDL)</Text>
        ) : null}

        {marketIntelligence.signals?.length ? (
          <Text style={styles.ledgerMeta}>
            Market signals: {marketIntelligence.signals.join(", ")}
          </Text>
        ) : null}

        {(marketIntelligence.supportReasons?.length ||
          marketIntelligence.dangerReasons?.length) ? (
          <View style={styles.previewBox}>
            {marketIntelligence.supportReasons?.map((reason: string, i: number) => (
              <Text key={`mi-support-${i}`} style={styles.previewReason}>
                ✅ {reason}
              </Text>
            ))}
            {marketIntelligence.dangerReasons?.map((reason: string, i: number) => (
              <Text key={`mi-danger-${i}`} style={styles.previewRisk}>
                ⚠️ {reason}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.ledgerMeta}>
          Defense: {formatDefenseSummary(defenseResult, league)}
        </Text>
        <Text style={styles.ledgerMeta}>
          Availability: {formatAvailabilitySummary(availabilityGate, league)}
        </Text>
        {opponentHistoryLabel ? (
          <Text style={styles.ledgerMeta}>
            Opponent History: {opponentHistoryLabel}
          </Text>
        ) : null}
        {wnbaV2 && dataIntegrity ? (
          <View style={styles.previewBox}>
            <Text style={styles.ledgerMeta}>
              Data Integrity: {dataIntegrityLabel}
              {dataIntegrity.score != null ? ` (${safeDisplay(dataIntegrity.score)}%)` : ""}
            </Text>
            {dataIntegrityIssues.slice(0, 6).map((issue: any, i: number) => (
              <Text key={`di-${i}`} style={styles.previewRisk}>
                • [{issue.status || issue.key}] {issue.message || issue.key}
              </Text>
            ))}
          </View>
        ) : null}

        {volumeDangerGates.gates?.length ? (
          <View style={styles.previewBox}>
            <Text style={styles.ledgerMeta}>
              Danger gates:{" "}
              {volumeDangerGates.gates.map(formatGateLabel).join(" • ")}
            </Text>
            {volumeDangerGates.dangerReasons?.map((reason: string, i: number) => (
              <Text key={`vdg-${i}`} style={styles.previewRisk}>
                ⚠️ {reason}
              </Text>
            ))}
            {volumeDangerGates.supportReasons?.map((reason: string, i: number) => (
              <Text key={`vdg-support-${i}`} style={styles.previewReason}>
                ✅ {reason}
              </Text>
            ))}
          </View>
        ) : null}

        {scoreLedger.length > 0 ? (
          <>
            <TouchableOpacity
              onPress={() => setLedgerExpanded((value) => !value)}
              style={styles.expandButton}
            >
              <Text style={styles.expandButtonText}>
                {ledgerExpanded
                  ? "Hide Score Ledger Rows"
                  : `Score Ledger (${Math.min(scoreLedger.length, 6)} shown)`}
              </Text>
            </TouchableOpacity>

            <View style={styles.previewBox}>
              {scoreLedger
                .slice(0, ledgerExpanded ? 12 : 6)
                .map((row: any, i: number) => (
                  <Text key={`ledger-${i}`} style={styles.previewReason}>
                    {row.side && row.side !== "NEUTRAL" ? `[${row.side}] ` : ""}
                    {row.label}
                    {row.explanation ? ` — ${row.explanation}` : ""}
                  </Text>
                ))}
            </View>
          </>
        ) : null}
      </View>

      {(roleChange.roleChangeReasons?.length > 0 ||
        roleChange.roleRiskReasons?.length > 0) && (
        <>
          <TouchableOpacity
            onPress={() => setRoleExpanded((value) => !value)}
            style={styles.expandButton}
          >
            <Text style={styles.expandButtonText}>
              {roleExpanded ? "Hide Role Change Details" : "Role Change Details"}
            </Text>
          </TouchableOpacity>

          {roleExpanded && (
            <View style={styles.previewBox}>
              {roleChange.roleChangeReasons?.map((reason: string, i: number) => (
                <Text key={`role-reason-${i}`} style={styles.previewReason}>
                  ✅ {reason}
                </Text>
              ))}
              {roleChange.roleRiskReasons?.map((risk: string, i: number) => (
                <Text key={`role-risk-${i}`} style={styles.previewRisk}>
                  ⚠️ {risk}
                </Text>
              ))}
            </View>
          )}
        </>
      )}

      <TouchableOpacity
        onPress={() => setFairLineExpanded((value) => !value)}
        style={styles.expandButton}
      >
        <Text style={styles.expandButtonText}>
          {fairLineExpanded
            ? "Hide CourtEdge Fair Line Preview"
            : "CourtEdge Fair Line Preview"}
        </Text>
      </TouchableOpacity>

      {fairLineExpanded && (
        <View style={styles.v3Section}>
          <Text style={styles.fairLinePreviewLabel}>
            Preview only — not controlling pick side yet
          </Text>
          <View style={styles.metricGrid}>
            <Metric
              label="Expected Minutes"
              value={safeDisplay(pick.expectedMinutes)}
            />
            <Metric label="Expected FGA" value={safeDisplay(pick.expectedFGA)} />
            <Metric label="Expected FTA" value={safeDisplay(pick.expectedFTA)} />
            <Metric
              label="Pts Per FGA"
              value={safeDisplay(pick.pointsPerFGA)}
            />
            <Metric label="FT Pts/FTA" value={safeDisplay(pick.ftPercent)} />
            <Metric
              label="Base Volume Pts"
              value={safeDisplay(pick.baseVolumePoints)}
            />
            <Metric
              label="Projection Anchor"
              value={safeDisplay(pick.projectionAnchor)}
            />
            <Metric label="Fair Line" value={safeDisplay(pick.fairLine)} />
            <Metric label="Book Line" value={safeDisplay(pick.bookLine ?? line)} />
            <Metric label="Fair Edge" value={safeDisplay(pick.fairLineEdge)} />
            <Metric
              label="Fair Side"
              value={pick.fairLineSide || "NONE"}
            />
            <Metric
              label="Fair Confidence"
              value={
                pick.fairLineConfidence !== undefined
                  ? `${safeDisplay(pick.fairLineConfidence)}%`
                  : "—"
              }
            />
            <Metric
              label="Fair Quality"
              value={
                pick.fairLineQuality !== undefined
                  ? `${safeDisplay(pick.fairLineQuality)}%`
                  : "—"
              }
            />
            <Metric
              label="Audit Old Side"
              value={pick.auditOldSide || side || "—"}
            />
            <Metric
              label="Audit Match"
              value={
                pick.auditSideMatch === true
                  ? "Yes"
                  : pick.auditSideMatch === false
                    ? "No"
                    : "—"
              }
            />
          </View>
          {pick.fairLineReasons?.length > 0 && (
            <View style={styles.previewBox}>
              {pick.fairLineReasons.map((reason: string, i: number) => (
                <Text key={`fair-reason-${i}`} style={styles.previewReason}>
                  ✅ {reason}
                </Text>
              ))}
            </View>
          )}
          {pick.fairLineRiskReasons?.length > 0 && (
            <View style={styles.previewBox}>
              {pick.fairLineRiskReasons.map((risk: string, i: number) => (
                <Text key={`fair-risk-${i}`} style={styles.previewRisk}>
                  ⚠️ {risk}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {(pick.reasons?.length > 0 || pick.risks?.length > 0) && (
        <View style={styles.previewBox}>
          {pick.reasons?.slice(0, 2).map((reason: string, i: number) => (
            <Text key={`reason-${i}`} style={styles.previewReason}>
              ✅ {reason}
            </Text>
          ))}
          {pick.risks?.slice(0, 2).map((risk: string, i: number) => (
            <Text key={`risk-${i}`} style={styles.previewRisk}>
              ⚠️ {risk}
            </Text>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={() => setExpanded((value) => !value)}
        style={styles.expandButton}
      >
        <Text style={styles.expandButtonText}>
          {expanded ? "Hide Why This Prop?" : "Why This Prop?"}
        </Text>
      </TouchableOpacity>

      {expanded && <PropFactors pick={pick} />}

      {showSaveHint && onSave ? (
        <Text style={styles.saveHint}>Tap card to save pick</Text>
      ) : null}

      {showDelete && onDelete ? (
        <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
          <Text style={styles.deleteButtonText}>Delete Pick</Text>
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

export function PropFactors({ pick }: { pick: any }) {
  const sections = [
    {
      title: "Confidence Adjustments",
      items: pick.confidenceAdjustmentReasons || [],
    },
    { title: "Tier Reasons", items: pick.tierReasons || [] },
    { title: "Support", items: pick.reasons || pick.boosts || [] },
    { title: "Danger", items: pick.risks || pick.penalties || [] },
    {
      title: "Warnings",
      items: [
        ...(pick.warnings || []),
        ...(pick.marketWarnings || []),
        ...(pick.riskWarnings || []),
      ],
    },
    { title: "Risk Reasons", items: pick.riskReasons || [] },
  ];

  const metrics = [
    ["Raw Confidence", pick.rawConfidenceBeforeReliability],
    ["Evidence Reliability", formatPercent(pick.evidenceReliability)],
    ["Danger Pressure", formatPercent(pick.dangerPressure)],
    ["Chosen Risk", pick.chosenRisk],
    ["Support Score", pick.supportScore],
    ["Resistance Score", pick.resistanceScore],
    ["Net Edge", pick.netEdge],
    ["Data Coverage", pick.dataCoverage],
    ["Opportunity Score", pick.opportunityScore],
    ["Last 5 Hit Rate", pick.last5HitRate],
    ["Minutes Avg", pick.minutesAverage ?? pick.recentMinutes],
    ["FGA Avg", pick.fgaAverage ?? pick.recentFGA],
    ["FTA Avg", pick.ftaAverage ?? pick.recentFTA],
    ["Line Spread", pick.lineSpread],
    ["Market Quality", pick.marketQuality],
  ];

  return (
    <View style={styles.factorsBox}>
      <Text style={styles.factorsTitle}>Why This Prop?</Text>

      <View style={styles.metricGrid}>
        {metrics.map(([label, value]) => (
          <Metric key={String(label)} label={String(label)} value={safeDisplay(value)} />
        ))}
      </View>

      {sections.map((section) =>
        section.items?.length ? (
          <View key={section.title} style={styles.factorSection}>
            <Text style={styles.factorSectionTitle}>{section.title}</Text>
            {section.items.map((item: string, index: number) => (
              <Text key={`${section.title}-${index}`} style={styles.factorItem}>
                • {item}
              </Text>
            ))}
          </View>
        ) : null
      )}
    </View>
  );
}

export function ResultMarginText({ pick }: { pick: any }) {
  const side = pick.side || pick.pick || "";
  const line = pick.line ?? pick.sportsbookLine;
  const actual = getActual(pick);
  const margin = pick.resultMargin ?? pick.margin;

  if (actual === null || actual === undefined || actual === "") {
    return <Text style={styles.statText}>Result pending</Text>;
  }

  const prefix =
    String(pick.status || "").toLowerCase() === "win"
      ? "Won by"
      : String(pick.status || "").toLowerCase() === "loss"
        ? "Lost by"
        : "Push";

  return (
    <Text style={styles.statText}>
      {side} {safeDisplay(line)} • Actual {safeDisplay(actual)} • {prefix}{" "}
      {margin !== null && margin !== undefined && margin !== ""
        ? `${Number(margin) > 0 ? "+" : ""}${safeDisplay(margin)}`
        : "0"}
    </Text>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  const display =
    value == null || value === ""
      ? "—"
      : typeof value === "object"
        ? String(value.label || value.code || value.value || "—")
        : String(value);
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{display}</Text>
    </View>
  );
}

export function safeDisplay(value: any) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);

  if (Number.isFinite(n)) {
    return Number(n.toFixed(1)).toString();
  }

  return String(value);
}

export function formatTeam(value: any) {
  if (!value) return "—";

  const raw = String(value);

  if (raw.length <= 3) return raw.toUpperCase();

  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .toUpperCase();
}

export function formatTime(value: any) {
  if (!value) return "";

  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);

  return (
    d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " CT"
  );
}

function formatPercent(value: any) {
  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  return `${Math.round(n * 100)}%`;
}

function getActual(pick: any) {
  const status = String(pick.status || "pending").toLowerCase();

  if (status === "pending") {
    return null;
  }

  return (
    pick.actualStat ??
    pick.actualPoints ??
    pick.finalPoints ??
    pick.resultMeta?.points ??
    null
  );
}

function formatDataMode(mode: string) {
  if (mode === "NBA_FULL_DATA") return "NBA Full Data";
  if (mode === "WNBA_FULL_DATA" || mode === "WNBA_FULL") return "WNBA Full Data";
  if (mode === "WNBA_LIMITED_DATA") return "WNBA Limited Data";
  return mode;
}

function getStatusLabel(pick: any) {
  const raw = String(pick.status || "upcoming").toLowerCase();

  if (raw === "win") return "Graded";
  if (raw === "loss") return "Graded";
  if (raw === "push") return "Graded";
  if (raw === "pending") return "Pending";

  return "Upcoming";
}

function getStatusStyle(status: string) {
  if (status === "Graded") {
    return { backgroundColor: "#14532d", color: "#bbf7d0" };
  }

  if (status === "Pending") {
    return { backgroundColor: "#1e3a8a", color: "#bfdbfe" };
  }

  return { backgroundColor: "#334155", color: "#e2e8f0" };
}

function getDecisionStyle(decision: string) {
  const normalized = String(decision || "").toUpperCase();
  if (normalized === "TRACK") {
    return { backgroundColor: "#14532d", color: "#bbf7d0" };
  }
  if (normalized === "NOT SELECTED" || normalized === "NOT_SELECTED") {
    return { backgroundColor: "#334155", color: "#e2e8f0" };
  }
  // Legacy gate labels must never paint as user-facing categories.
  return { backgroundColor: "#334155", color: "#e2e8f0" };
}

function daVal(value: any, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== "") {
    // Integers for whole numbers; 1 decimal otherwise.
    if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9) {
      return String(Math.round(n));
    }
    return String(Number(n.toFixed(1)));
  }
  return String(value);
}

function DetailedAnalysisPanel({
  analysis,
  pick,
}: {
  analysis?: any;
  pick?: any;
}) {
  const a = analysis || pick?.homeDetailedAnalysisV1;
  if (!a || !a.schemaVersion) {
    return (
      <View style={styles.daBox}>
        <Text style={styles.daSectionTitle}>DETAILED ANALYSIS</Text>
        <Text style={styles.daLine}>
          Analysis payload not attached yet. Refresh picks to load evidence.
        </Text>
      </View>
    );
  }

  const s = a.propSnapshot || {};
  const r = a.recentPerformance || {};
  const m = a.matchupHistory || {};
  const role = a.roleOpportunity || {};
  const proj = a.projectionDistribution || {};
  const opp = a.opponentContext || {};
  const env = a.gameEnvironment || {};
  const mkt = a.marketAnalysis || {};
  const avail = a.availability || {};
  const dec = a.finalDecision || {};
  const dq = a.dataQuality || {};
  const last = m.lastMatchup;
  const propTypeRaw = String(
    s.propType || r.propType || pick?.propType || pick?.stat || "POINTS"
  ).toUpperCase();
  const propType = propTypeRaw.includes("REBOUND")
    ? "REBOUNDS"
    : propTypeRaw.includes("ASSIST")
      ? "ASSISTS"
      : "POINTS";
  const statWord =
    propType === "REBOUNDS"
      ? "rebounds"
      : propType === "ASSISTS"
        ? "assists"
        : "points";
  const l5 = r.last5Values || r.last5Points;
  const l10 = r.last10Values || r.last10Points;

  return (
    <View style={styles.daBox}>
      <Text style={styles.daSectionTitle}>DETAILED ANALYSIS</Text>

      <Text style={styles.daHeader}>1. Prop Snapshot</Text>
      <Text style={styles.daLine}>
        {daVal(s.player)} · {daVal(s.team)} vs {daVal(s.opponent)} · {daVal(s.league)} ·{" "}
        {propType}
      </Text>
      <Text style={styles.daLine}>
        {daVal(s.finalCourtEdgeSide)} {daVal(s.sealedLine)} · Conf {daVal(s.confidence)}% · Risk{" "}
        {daVal(s.risk)} · {daVal(s.sealedLiveStatus)}
      </Text>
      <Text style={styles.daLine}>
        Original model: {daVal(s.originalModelSide)} · Official #{daVal(s.bestSixRank, "—")} ·
        Coverage {daVal(s.evidenceCoverage, "—")}%
      </Text>

      <Text style={styles.daHeader}>2. Recent Performance</Text>
      <Text style={styles.daLine}>
        Last 5 {statWord}: {daVal(l5)}
      </Text>
      <Text style={styles.daLine}>
        Last 5 avg: {daVal(r.last5Average)} · Hit: {daVal(r.last5HitRate?.label)}
      </Text>
      <Text style={styles.daLine}>
        Last 10 {statWord}: {daVal(l10)} (n={daVal(r.last10SampleSize, "0")})
      </Text>
      <Text style={styles.daLine}>
        Last 10 avg: {daVal(r.last10Average)} · Season avg: {daVal(r.seasonAverage)} · Trend:{" "}
        {daVal(r.scoringTrend?.trend)}
      </Text>

      <Text style={styles.daHeader}>3. Last Matchup And History</Text>
      {m.status === "UNAVAILABLE" || !(m.recentMatchups?.length || last) ? (
        <Text style={styles.daLine}>
          {m.display || "No previous matchup data available."}
        </Text>
      ) : (
        <>
          {(m.recentMatchups?.length ? m.recentMatchups : last ? [last] : []).map(
            (row: any, i: number) => (
              <View key={`mu-${i}`}>
                <Text style={styles.daLine}>
                  Matchup {i + 1}: {daVal(row.date)} ·{" "}
                  {propType === "POINTS" ? "Pts" : propType === "REBOUNDS" ? "Reb" : "Ast"}{" "}
                  {daVal(row.statValue ?? row.points)} · Min {daVal(row.minutes)}
                  {propType === "POINTS"
                    ? ` · FGA ${daVal(row.fga)} · FTA ${daVal(row.fta)}`
                    : ""}{" "}
                  · {daVal(row.againstTodaysLine)}
                </Text>
                {row.relevanceNote ? (
                  <Text style={styles.daNote}>{row.relevanceNote}</Text>
                ) : null}
              </View>
            )
          )}
          <Text style={styles.daLine}>
            Sample {daVal(m.sampleSize)} · avg {daVal(m.matchupAverage)} · median{" "}
            {daVal(m.matchupMedian)} · hit {daVal(m.matchupHitRate?.label)}
          </Text>
        </>
      )}

      <Text style={styles.daHeader}>4. Role And Opportunity</Text>
      <Text style={styles.daLine}>
        Exp min {daVal(role.expectedMinutes)} · L5 min {daVal(role.last5Minutes)}
        {propType === "POINTS"
          ? ` · Exp FGA ${daVal(role.expectedFGA)} · Exp FTA ${daVal(role.expectedFTA)}`
          : ""}
      </Text>
      <Text style={styles.daLine}>
        {propType === "POINTS" ? `Usage ${daVal(role.expectedUsage)} · ` : ""}
        Stability {daVal(role.roleStability)} · {daVal(role.teammateImpactSummary)}
      </Text>

      <Text style={styles.daHeader}>5. Projection, Distribution, Volatility</Text>
      <Text style={styles.daLine}>
        Raw {daVal(proj.rawProjection)} · Final {daVal(proj.finalProjection)} · Fair{" "}
        {daVal(proj.fairLine)} · Gap {daVal(proj.projectionGap)}
      </Text>
      <Text style={styles.daLine}>
        Vol {daVal(proj.volatilityTier)} · Ceiling {daVal(proj.ceiling)} · Floor {daVal(proj.floor)}
      </Text>

      <Text style={styles.daHeader}>6. Matchup And Opponent</Text>
      <Text style={styles.daLine}>
        Defense {daVal(opp.opponentDefenseStatus)} · Score {daVal(opp.defenseScore)} · Source{" "}
        {daVal(opp.opponentDefenseSource)}
      </Text>
      {opp.unavailableReason ? (
        <Text style={styles.daNote}>Unavailable: {opp.unavailableReason}</Text>
      ) : null}

      <Text style={styles.daHeader}>7. Game Environment</Text>
      <Text style={styles.daLine}>
        Spread {daVal(env.spread)} · Total {daVal(env.gameTotal)} · ITT {daVal(env.impliedTeamTotal)} ·
        Rest {daVal(env.daysRest)}
      </Text>
      <Text style={styles.daLine}>
        Pace proxy {daVal(env.paceProxy)} ({env.paceProxyLabel || "proxy"}) — not true pace
      </Text>

      <Text style={styles.daHeader}>8. Market Analysis</Text>
      <Text style={styles.daLine}>
        Open {daVal(mkt.openingLine)} · Sealed {daVal(mkt.selectedSealedLine)} · Current{" "}
        {daVal(mkt.currentLine)} · {daVal(mkt.compactResult)}
      </Text>
      <Text style={styles.daNote}>
        {mkt.marketRelativeToFinalSide?.explanation || ""}
      </Text>

      <Text style={styles.daHeader}>9. Availability And Team Context</Text>
      <Text style={styles.daLine}>{daVal(avail.displayStatus)}</Text>
      {avail.note ? <Text style={styles.daNote}>{avail.note}</Text> : null}

      <Text style={styles.daHeader}>10. Final CourtEdge Decision</Text>
      <Text style={styles.daLine}>
        {daVal(dec.originalModelSide)} → {daVal(dec.finalCourtEdgeSide)} · Conf{" "}
        {daVal(dec.finalConfidence)}% · Risk {daVal(dec.finalRisk)}
      </Text>
      <Text style={styles.daLine}>
        Flip {daVal(dec.flipFirstDisplay || dec.flipFirstAction)} · Same-team{" "}
        {dec.sameTeamArbitration?.applied ? "Applied" : "No"}
      </Text>
      {dec.topPickTransparency ? (
        <Text style={styles.daNote}>
          Top Pick: rank {daVal(dec.topPickTransparency.rank)} ·{" "}
          {daVal(dec.topPickTransparency.reason)}
          {dec.topPickTransparency.scoreVsNext?.explanation
            ? ` · ${dec.topPickTransparency.scoreVsNext.explanation}`
            : ""}
        </Text>
      ) : null}
      {dec.finalReadableExplanation ? (
        <Text style={styles.daNote}>{String(dec.finalReadableExplanation)}</Text>
      ) : null}

      <Text style={styles.daHeader}>11. Data Quality And Sources</Text>
      <Text style={styles.daLine}>
        Coverage {daVal(dq.coverage)}% · Fetched {daVal(dq.fetchedAt)} · Missing:{" "}
        {(dq.missingFields || []).join(", ") || "none"}
      </Text>
      {a.liveMarketReference?.referenceOnly ? (
        <Text style={styles.daNote}>
          Live market is reference-only after seal — official side/line/confidence frozen.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pickCard: {
    backgroundColor: "#1e293b",
    padding: 15,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  premiumPickCard: {
    borderColor: "#facc15",
    backgroundColor: "#172033",
  },
  bestSixCard: {
    borderColor: "#831843",
    backgroundColor: "#1a1520",
  },
  decisionBadge: {
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  bestSixMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  bestSixFlipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  bestSixWhyBox: {
    backgroundColor: "#052e16",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#166534",
    marginBottom: 10,
  },
  bestSixWhyTitle: {
    color: "#86efac",
    fontWeight: "900",
    fontSize: 11,
    marginBottom: 4,
  },
  detailedAnalysisToggle: {
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#475569",
  },
  detailedAnalysisToggleText: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  daBox: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#1e293b",
    gap: 2,
  },
  daSectionTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  daHeader: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 2,
  },
  daLine: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
  },
  daNote: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "500",
    fontStyle: "italic",
    marginTop: 2,
  },
  bestSixWhyText: {
    color: "#dcfce7",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  bestSixOppHistLine: {
    color: "#a5b4fc",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
  },
  bestSixResultsBox: {
    backgroundColor: "#422006",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#92400e",
    marginBottom: 10,
  },
  bestSixResultsTitle: {
    color: "#fcd34d",
    fontWeight: "900",
    fontSize: 11,
    marginBottom: 4,
  },
  bestSixResultsText: {
    color: "#fef3c7",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  bestSixDebtBox: {
    backgroundColor: "#450a0a",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    marginBottom: 10,
  },
  bestSixDebtTitle: {
    color: "#fecaca",
    fontWeight: "900",
    fontSize: 11,
    marginBottom: 4,
  },
  bestSixDebtLine: {
    color: "#fee2e2",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  bestSixRepairBox: {
    backgroundColor: "#0c4a6e",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#0369a1",
    marginBottom: 10,
  },
  bestSixRepairTitle: {
    color: "#bae6fd",
    fontWeight: "900",
    fontSize: 11,
    marginBottom: 4,
  },
  bestSixRepairLine: {
    color: "#e0f2fe",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  bestSixRescueBox: {
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    borderColor: "rgba(251, 191, 36, 0.35)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 8,
  },
  bestSixRescueTitle: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 2,
  },
  bestSixRescueText: {
    color: "#fde68a",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  pickTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  rankBadge: {
    color: "#e2e8f0",
    backgroundColor: "#334155",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  leagueBadge: {
    color: "#bfdbfe",
    backgroundColor: "#1e40af",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  tierBadge: {
    color: "#bbf7d0",
    backgroundColor: "#14532d",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  premiumBadge: {
    color: "#fef9c3",
    backgroundColor: "#713f12",
  },
  shadowTierBadge: {
    color: "#fde68a",
    backgroundColor: "#78350f",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  engineBadge: {
    color: "#c4b5fd",
    backgroundColor: "#4c1d95",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  topPickBadge: {
    color: "#fef9c3",
    backgroundColor: "#854d0e",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  bestSixBadge: {
    color: "#bae6fd",
    backgroundColor: "#0c4a6e",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  playTypeBadge: {
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  officialPlayTypeBadge: {
    color: "#bbf7d0",
    backgroundColor: "#14532d",
  },
  testPlayTypeBadge: {
    color: "#fde68a",
    backgroundColor: "#78350f",
  },
  compactReasonBox: {
    marginTop: 4,
  },
  wnbaV2Compact: {
    marginTop: 8,
    gap: 4,
  },
  wnbaV2Line: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  wnbaV2Why: {
    color: "#86efac",
    fontSize: 11,
    fontWeight: "600",
  },
  wnbaV2Warn: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "600",
  },
  decisionIntelBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  decisionIntelTitle: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  decisionIntelText: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  dataModeBadge: {
    color: "#e9d5ff",
    backgroundColor: "#581c87",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  statusBadge: {
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
  },
  confidenceText: {
    color: "#22c55e",
    fontSize: 24,
    fontWeight: "900",
  },
  playerName: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  gameText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4,
  },
  metaText: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  teamText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 10,
  },
  pickLineBox: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263449",
    marginBottom: 12,
  },
  pickSide: {
    color: "#93c5fd",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  projectionText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  metricBox: {
    width: "48%",
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#263449",
  },
  metricLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "900",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  statText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  v3PreviewLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
    fontStyle: "italic",
    marginBottom: 10,
  },
  v3Section: {
    marginBottom: 12,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263449",
  },
  v3SectionTitle: {
    color: "#93c5fd",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  fairLinePreviewLabel: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "800",
    fontStyle: "italic",
    marginBottom: 10,
  },
  compareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  compareLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
  },
  compareValue: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  ledgerMeta: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  previewBox: {
    marginBottom: 10,
  },
  previewReason: {
    color: "#dcfce7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  previewRisk: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  expandButton: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 4,
  },
  expandButtonText: {
    color: "#93c5fd",
    fontWeight: "900",
    textAlign: "center",
  },
  factorsBox: {
    marginTop: 10,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  factorsTitle: {
    color: "#facc15",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 10,
  },
  factorSection: {
    marginTop: 10,
  },
  factorSectionTitle: {
    color: "#93c5fd",
    fontWeight: "900",
    marginBottom: 4,
  },
  factorItem: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 3,
  },
  saveHint: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "right",
  },
  deleteButton: {
    marginTop: 10,
    backgroundColor: "#7f1d1d",
    borderRadius: 12,
    paddingVertical: 10,
  },
  deleteButtonText: {
    color: "#fecaca",
    fontWeight: "900",
    textAlign: "center",
  },
});
