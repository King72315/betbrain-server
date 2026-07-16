/**
 * Official slate membership — sole source for Results/Lab/History prop counts.
 */
import { buildOfficialPropId, getOfficialSlate } from "./officialSlateService.js";
import { getDailySlateReport, getRawDailySlateReports } from "./dailySlateReportService.js";
import { logLifecycleIntegrityFailure } from "./lifecyclePointerStateService.js";
import { isResolvedStatus } from "./gradeMonotonicityGuard.js";

export const OFFICIAL_MEMBERSHIP_VERSION = "official-slate-membership-v1";

function propKey(prop = {}) {
  return String(
    prop.trackedKey || prop.trackedId || prop.officialPropId || ""
  );
}

function isOfficialCohortProp(prop = {}) {
  if (prop.immutableOfficial === true) return true;
  if (prop.controlledBestSixDisplayTracked === true) return true;
  if (prop.controlledBestSixDisplay === true) return true;
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return true;
  if (explicit === "TEST" || explicit === "NO_BET") return false;
  if (prop.bestSixRank != null && Number(prop.bestSixRank) > 0) return true;
  if (prop.controlledBestSixRank != null && Number(prop.controlledBestSixRank) > 0) {
    return true;
  }
  return false;
}

export function resolveOfficialSlateMembership(
  slateDate = "",
  trackedProps = [],
  options = {}
) {
  const date = String(slateDate || "");
  const slateTracked = (Array.isArray(trackedProps) ? trackedProps : []).filter(
    (prop) => String(prop.slateDate || "") === date
  );

  const sealed = getOfficialSlate(date);
  if (sealed?.props?.length) {
    return {
      slateDate: date,
      officialSlateId: sealed.officialSlateId || date,
      source: "sealed_snapshot",
      props: sealed.props.map((prop) => ({ ...prop })),
      officialPropIds: sealed.officialPropIds || [],
      propCount: sealed.props.length,
    };
  }

  const cohort = slateTracked.filter(isOfficialCohortProp);
  if (cohort.length) {
    const officialPropIds = cohort
      .map((prop) => prop.officialPropId || buildOfficialPropId(prop, date))
      .filter(Boolean);
    return {
      slateDate: date,
      officialSlateId: date,
      source: "display_cohort",
      props: cohort.map((prop) => ({ ...prop })),
      officialPropIds,
      propCount: cohort.length,
    };
  }

  const existingReport =
    getDailySlateReport(date) ||
    getRawDailySlateReports().find((r) => String(r.slateDate) === date) ||
    null;
  const knownIds = Array.isArray(existingReport?.officialPropIds)
    ? existingReport.officialPropIds.map(String)
    : [];

  if (knownIds.length) {
    const byId = new Map(
      slateTracked
        .filter((prop) => prop.officialPropId)
        .map((prop) => [String(prop.officialPropId), prop])
    );
    const props = knownIds
      .map((id) => byId.get(id))
      .filter(Boolean);
    return {
      slateDate: date,
      officialSlateId: existingReport?.officialSlateId || date,
      source: "report_official_prop_ids",
      props,
      officialPropIds: knownIds,
      propCount: knownIds.length,
    };
  }

  if (slateTracked.length && options.strict !== false) {
    logLifecycleIntegrityFailure({
      code: "OFFICIAL_MEMBERSHIP_UNKNOWN",
      slateDate: date,
      trackedCount: slateTracked.length,
    });
  }

  return {
    slateDate: date,
    officialSlateId: date,
    source: "empty",
    props: [],
    officialPropIds: [],
    propCount: 0,
  };
}

export function mergeMembershipWithLiveGrades(membership = {}, liveProps = []) {
  const liveByKey = new Map(
    (Array.isArray(liveProps) ? liveProps : []).map((prop) => [
      propKey(prop),
      prop,
    ])
  );
  const idSet = new Set(
    (membership.officialPropIds || []).map(String)
  );

  const props = (membership.props || []).map((member) => {
    const key = propKey(member);
    const live =
      liveByKey.get(key) ||
      [...liveByKey.values()].find(
        (p) =>
          member.officialPropId &&
          String(p.officialPropId) === String(member.officialPropId)
      );
    if (!live) return { ...member };
    return {
      ...member,
      ...live,
      officialPropId: member.officialPropId || live.officialPropId,
      pregameSnapshot: member.pregameSnapshot?.sealedAt
        ? member.pregameSnapshot
        : live.pregameSnapshot,
      trackingType: member.trackingType || live.trackingType || "OFFICIAL",
      recordType: member.recordType || live.recordType || "OFFICIAL",
    };
  });

  return {
    ...membership,
    props,
    officialPropIds: props
      .map((p) => p.officialPropId)
      .filter((id) => id && idSet.has(String(id)) || !idSet.size),
    propCount: props.length,
    gradedCount: props.filter((p) => isResolvedStatus(p.status)).length,
  };
}

export function validateMembershipIntegrity(membership = {}, report = null) {
  const failures = [];
  const sealedCount = membership.propCount || 0;
  const reportCount =
    report?.totalProps ??
    report?.sections?.A?.totalOfficialProps ??
    report?.sections?.A?.totalTrackedProps ??
    null;
  const reportIds = Array.isArray(report?.officialPropIds)
    ? report.officialPropIds
    : [];
  const memberIds = (membership.officialPropIds || []).map(String);

  if (reportCount != null && sealedCount !== reportCount) {
    failures.push({
      code: "MEMBERSHIP_COUNT_MISMATCH",
      sealedCount,
      reportCount,
    });
  }
  if (reportIds.length && memberIds.length) {
    const reportSet = new Set(reportIds.map(String));
    for (const id of memberIds) {
      if (!reportSet.has(id)) {
        failures.push({ code: "MEMBERSHIP_ID_MISSING_IN_REPORT", officialPropId: id });
      }
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    sealedOfficialPropCount: sealedCount,
    reportPropCount: reportCount,
  };
}
