import Constants from "expo-constants";
import { Platform } from "react-native";

import { getApiBaseUrl, getBackendMode } from "../services/api";

export type ReportSections = {
  visibleSummary?: string;
  mainData?: string;
  warnings?: string;
  errors?: string;
  debugNotes?: string;
};

export type PageReportInput = {
  page: string;
  leagueFilter?: string;
  lastUpdated?: string | null;
  dataSource?: string;
  extraContext?: Record<string, string | number | boolean | null | undefined>;
} & ReportSections;

export function formatReportTimestamp(date = new Date()) {
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function getAppContext(options?: {
  leagueFilter?: string;
  lastUpdated?: string | null;
  dataSource?: string;
  extraContext?: Record<string, string | number | boolean | null | undefined>;
}) {
  const lines = [
    `Backend URL: ${getApiBaseUrl()}`,
    `Backend Mode: ${getBackendMode()}`,
    `League/Filter: ${options?.leagueFilter ?? "—"}`,
    `Last Updated: ${options?.lastUpdated ?? "—"}`,
    `Data Source: ${options?.dataSource ?? "BetBrain backend API"}`,
    `App Mode: ${Constants.executionEnvironment ?? "unknown"}`,
    `Build: CourtEdge v${Constants.expoConfig?.version ?? "1.0.0"} (${Platform.OS})`,
  ];

  if (options?.extraContext) {
    for (const [key, value] of Object.entries(options.extraContext)) {
      if (value === undefined || value === null || value === "") continue;
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join("\n");
}

export function buildPageReport(input: PageReportInput) {
  const sections = [
    "COURTEDGE PAGE REPORT",
    "",
    `Page: ${input.page}`,
    `Generated At: ${formatReportTimestamp()} CT`,
    "",
    "App Context:",
    getAppContext({
      leagueFilter: input.leagueFilter,
      lastUpdated: input.lastUpdated ?? undefined,
      dataSource: input.dataSource,
      extraContext: input.extraContext,
    }),
    "",
    "Visible Summary:",
    input.visibleSummary?.trim() || "—",
    "",
    "Main Data:",
    input.mainData?.trim() || "—",
    "",
    "Warnings / Empty States:",
    input.warnings?.trim() || "None",
    "",
    "Errors:",
    input.errors?.trim() || "None",
    "",
    "Debug Notes:",
    input.debugNotes?.trim() || "—",
  ];

  return sections.join("\n");
}

function legacyWebCopy(text: string) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyNative(text: string): Promise<boolean> {
  try {
    const Clipboard = require("expo-clipboard");
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }

      return legacyWebCopy(text);
    }

    return copyNative(text);
  } catch {
    return false;
  }
}

export function joinLines(lines: Array<string | null | undefined | false>) {
  return lines.filter(Boolean).join("\n");
}

export function bulletList(items: string[]) {
  if (!items.length) return "—";
  return items.map((item) => `- ${item}`).join("\n");
}
