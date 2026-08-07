/**
 * Official prop explanations for Empirical Finder V2.
 */
function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function buildEmpiricalRiskExplanationV2(prop = {}, riskPacket = null) {
  const risk =
    prop.trueRisk ||
    prop.riskLabel ||
    riskPacket?.risk ||
    prop.risk?.risk ||
    "HIGH";
  const rel =
    num(prop.reliabilityProbability) ??
    num(riskPacket?.reliabilityProbability) ??
    num(prop.reliability?.reliabilityProbability);
  const trust =
    num(prop.trustScore) ??
    num(riskPacket?.trustScore) ??
    num(prop.trust?.trustScore);
  const safety =
    num(prop.safetyScore) ??
    num(prop.SafetyScore) ??
    num(riskPacket?.SafetyScore);
  const edge =
    num(prop.projectionEdge) ?? num(riskPacket?.projectionEdge);
  const mins =
    num(prop.minutesStabilityScore) ??
    num(prop.minutesStability) ??
    num(riskPacket?.minutesStability);
  const expectedMinutes =
    num(prop.expectedMinutes) ?? num(riskPacket?.expectedMinutes);
  const role =
    num(prop.roleStabilityScore) ??
    num(prop.roleStability) ??
    num(riskPacket?.roleStability);
  const conflict =
    num(prop.conflictIndex) ?? num(riskPacket?.conflictIndex);
  const pathway =
    prop.safePathway ||
    riskPacket?.safePathway ||
    prop.pathway?.safePathway ||
    "NONE";
  const books = num(prop.bookCount ?? riskPacket?.bookCount);
  const softFlags = riskPacket?.softFlags || prop.softFlags || [];
  const whyNotLow =
    riskPacket?.whyNotLow ||
    prop.whyNotLow ||
    [];

  const whyTrust = [];
  if (rel != null) {
    whyTrust.push(`Empirical reliability ${(rel * 100).toFixed(0)}%`);
  }
  if (trust != null) whyTrust.push(`TrustScore ${trust}/100`);
  if (edge != null && edge >= 2)
    whyTrust.push(`Model edge ${edge.toFixed(1)} points`);
  if (mins != null && mins >= 70) {
    whyTrust.push(
      `Stable${expectedMinutes != null ? ` ~${Math.round(expectedMinutes)}` : ""} minute role (stability ${mins})`
    );
  }
  if (role != null && role >= 70) {
    whyTrust.push(`Stable role/volume profile (${role})`);
  } else if (role == null) {
    // do not claim role is bad when missing
  }
  if (conflict != null && conflict <= 15) whyTrust.push("Low conflict across evidence");
  if (pathway && pathway !== "NONE") {
    whyTrust.push(`Matches historical ${pathway} profile`);
  }
  if (safety != null && safety >= 70) whyTrust.push(`SafetyScore ${safety}`);
  if (books != null && books <= 2) {
    whyTrust.push(
      `Thin market (${books} books) treated as soft uncertainty — not a veto`
    );
  }

  const loseWays = [];
  const fails = prop.failurePaths || riskPacket?.failurePaths || [];
  if (Array.isArray(fails) && fails.length) {
    for (const f of fails.slice(0, 3)) {
      loseWays.push(f.label || f.code || String(f));
    }
  }
  if (!loseWays.length) {
    if (conflict != null && conflict > 20) loseWays.push("evidence conflict materializes");
    loseWays.push("unusual usage drop");
    loseWays.push("foul trouble / minutes restriction");
  }

  const notLow = [...whyNotLow];
  if (risk === "MEDIUM" || risk === "HIGH") {
    if (rel != null && rel < 0.78) {
      notLow.push(`Reliability ${(rel * 100).toFixed(0)}% below LOW region`);
    }
    if (trust != null && trust < 72) {
      notLow.push(`TrustScore ${trust} below LOW floor`);
    }
    if (mins != null && mins < 70) {
      notLow.push(`Minutes stability ${mins}`);
    }
    if (conflict != null && conflict > 25) {
      notLow.push(`Conflict index ${conflict}`);
    }
    if (softFlags.includes("thin_book_soft")) {
      notLow.push("Thin market adds uncertainty (not a hard veto)");
    }
    // Never claim market quality alone as the reason for HIGH in plain language as if veto
  }

  const title = `${risk} RISK`;
  let plainLanguage;
  if (risk === "LOW") {
    plainLanguage = [
      "LOW RISK",
      "",
      rel != null ? `Reliability: ${Math.round(rel * 100)}%` : null,
      trust != null ? `Trust: ${trust}/100` : null,
      "",
      "Why CourtEdge trusts it:",
      ...whyTrust.map((x) => `• ${x}`),
      "",
      "Main ways this prop could lose:",
      ...loseWays.map((x) => `• ${x}`),
    ]
      .filter((x) => x != null)
      .join("\n");
  } else if (risk === "MEDIUM") {
    plainLanguage = [
      "MEDIUM",
      "",
      rel != null ? `Reliability: ${Math.round(rel * 100)}%` : null,
      trust != null ? `Trust: ${trust}` : null,
      "",
      "Strong factors:",
      ...whyTrust.map((x) => `• ${x}`),
      "",
      "Why not LOW:",
      ...(notLow.length ? notLow : ["Meaningful uncertainty remains moderate"]).map(
        (x) => `• ${x}`
      ),
    ]
      .filter((x) => x != null)
      .join("\n");
  } else {
    plainLanguage = [
      "HIGH RISK — research only",
      "",
      ...(riskPacket?.officialRejectionReasons || []).map((x) => `• ${x}`),
    ].join("\n");
  }

  return {
    risk,
    title,
    reliabilityProbability: rel,
    trustScore: trust,
    safePathway: pathway,
    whyCourtEdgeTrustsIt: whyTrust,
    whyCourtEdgeLikesIt: whyTrust,
    whyItIsNotLow: notLow,
    whyNotLow: notLow,
    mainWaysItCouldLose: loseWays,
    mainWayItLoses: loseWays[0] || "Unexpected variance",
    plainLanguage,
  };
}
