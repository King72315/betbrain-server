/** ISO slate date for user-facing status messages (e.g. "2026-06-25 slate checked: …"). */
export function formatSlateMessageDate(slateDate: string | null | undefined): string {
  const value = String(slateDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return value || "unknown slate";
}

export function formatSlateArchivedMessage(slateDate: string | null | undefined): string {
  return `${formatSlateMessageDate(slateDate)} slate archived to History.`;
}

export function formatSlateMovedToLabMessage(slateDate: string | null | undefined): string {
  return `${formatSlateMessageDate(slateDate)} slate has already been moved to Lab.`;
}

export function formatPriorSlateStillActiveLabel(
  activeSlateDate: string | null | undefined
): string {
  const date = formatSlateMessageDate(activeSlateDate);
  if (!activeSlateDate || date === "unknown slate") {
    return "Still resolving prior slate. Newer slate remains on board until that slate closes.";
  }
  return `Still resolving ${date} slate. Newer slate remains on board until that slate closes.`;
}
