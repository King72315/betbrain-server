/**
 * CourtEdge line integrity helpers.
 * Same-team / Flip-First may change SIDE but never the sportsbook LINE.
 */

export const LINE_INTEGRITY_VERSION = "line-integrity-v1";

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the immutable candidate line used for selection/seal.
 */
export function resolveSelectedLine(pick = {}) {
  return num(
    pick.selectedLine ??
      pick.officialLine ??
      pick.sealedLine ??
      pick.line ??
      pick.sportsbookLine ??
      pick.consensusLine ??
      pick.currentLine
  );
}

/**
 * Build auditable line fields. Does not invent movement without snapshots.
 */
export function buildLineAuditFields(pick = {}, options = {}) {
  const selectedLine = resolveSelectedLine(pick);
  const openingLine = num(
    options.openingLine ?? pick.openingLine ?? selectedLine
  );
  const currentLine = num(
    options.currentLine ?? pick.currentLine ?? pick.sportsbookLine ?? selectedLine
  );
  const sealedLine = num(
    pick.sealedLine ??
      (pick.immutableOfficial || pick.officialSealedAt
        ? pick.officialLine ?? selectedLine
        : null)
  );
  const lineMovement =
    openingLine != null && currentLine != null
      ? Number((currentLine - openingLine).toFixed(1))
      : null;

  return {
    lineIntegrityVersion: LINE_INTEGRITY_VERSION,
    openingLine,
    selectedLine,
    sealedLine,
    currentLine,
    sportsbookLine: selectedLine,
    line: selectedLine,
    officialLine: sealedLine ?? selectedLine,
    consensusLine: num(pick.consensusLine ?? selectedLine),
    lineSource:
      pick.lineSource ||
      options.lineSource ||
      "odds-consensus",
    lineCapturedAt:
      pick.lineCapturedAt ||
      options.lineCapturedAt ||
      new Date().toISOString(),
    sealedAt: pick.sealedAt || pick.officialSealedAt || null,
    lineMovement,
    availableLines: pick.availableLines || null,
  };
}

/**
 * Force a side change while locking the original line.
 * Throws nothing — returns patched pick with audit.
 */
export function applySideChangeKeepLine(pick = {}, nextSide = "UNDER", meta = {}) {
  const lockedLine = resolveSelectedLine(pick);
  const sideLabel =
    String(nextSide).toUpperCase() === "UNDER" ? "Under" : "Over";
  const audit = buildLineAuditFields(pick);

  return {
    ...pick,
    ...audit,
    side: sideLabel,
    pick: sideLabel,
    line: lockedLine,
    sportsbookLine: lockedLine,
    selectedLine: lockedLine,
    officialLine: pick.officialLine ?? lockedLine,
    lineLockedThroughSideChange: true,
    lineLockMeta: {
      reason: meta.reason || "side_change_line_lock",
      previousSide: pick.side || pick.pick || null,
      nextSide: sideLabel,
      lockedLine,
      at: new Date().toISOString(),
    },
  };
}

/**
 * Assert same-team flip did not mutate line (for tests / diagnostics).
 */
export function assertLineUnchanged(before = {}, after = {}) {
  const a = resolveSelectedLine(before);
  const b = resolveSelectedLine(after);
  return {
    ok: a != null && b != null && a === b,
    beforeLine: a,
    afterLine: b,
  };
}
