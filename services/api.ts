/**
 * CourtEdge public API client.
 *
 * Core product reads (Home Controlled Best 6, Top props, league boards, Results
 * tracking displays) use unauthenticated GET/POST -- no JWT / login required.
 * Admin /scheduler endpoints are gated server-side separately and are not used here.
 */
const LIVE_RENDER_URL = "https://betbrain-server-1.onrender.com";

export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  // Web and native default to live Render; localhost only via explicit EXPO_PUBLIC_API_URL.
  return LIVE_RENDER_URL;
}

const BASE_URL = resolveApiBaseUrl();

type League = "NBA" | "WNBA";

type ApiResult = {
  ok: boolean;
  message?: string;
  error?: string;
  lastUpdated?: string | null;
  config?: any;

  games?: any[];
  nbaGames?: any[];
  wnbaGames?: any[];

  topProps?: any[];
  topNBAProps?: any[];
  topWNBAProps?: any[];
  topWNBAProps?: any[];
  bestSixWNBA?: any[];
  bestSixDisplayWNBA?: any[];
  bestSixNBA?: any[];
  bestSixDisplayNBA?: any[];
  bestSixLimit?: number | null;
  controlledBestSixVersion?: string | null;
  wnbaTopPropLimit?: number | null;
  filterAudit?: any;
  trackingMode?: string;
  generatedPropCount?: number;

  picks?: any[];
  pick?: any;
};

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { ok: false, _nonJson: true };
  }

  try {
    return await res.json();
  } catch {
    return { ok: false, _nonJson: true };
  }
}

function nonJsonBackendError() {
  const mode = getBackendMode();
  return `Backend returned HTML instead of JSON (${mode}: ${BASE_URL}). CourtEdge server may not be running on that port.`;
}

function normalizePicksResponse(data: any = {}): ApiResult {
  return {
    ok: data.ok ?? false,
    message: data.message || "",
    error: data.error || "",
    lastUpdated: data.lastUpdated || null,
    config: data.config || null,

    games: data.games || [],
    nbaGames: data.nbaGames || [],
    wnbaGames: data.wnbaGames || [],

    topProps: data.topProps || [],
    topNBAProps: data.topNBAProps || [],
    topWNBAProps: data.topWNBAProps || [],
    bestSixWNBA: data.bestSixWNBA || [],
    bestSixDisplayWNBA: data.bestSixDisplayWNBA || [],
    bestSixNBA: data.bestSixNBA || [],
    bestSixDisplayNBA: data.bestSixDisplayNBA || [],
    bestSixLimit: data.bestSixLimit ?? null,
    controlledBestSixVersion: data.controlledBestSixVersion ?? null,
    wnbaTopPropLimit: data.wnbaTopPropLimit ?? null,
    filterAudit: data.filterAudit || null,
    trackingMode: data.trackingMode || data.filterAudit?.trackingMode || null,
    generatedPropCount: data.generatedPropCount ?? null,

    picks: data.picks || [],
    pick: data.pick || null,
  };
}

async function apiGet(path: string): Promise<ApiResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await safeJson(res);

    if (data._nonJson) {
      console.log(`API GET NON-JSON ${path}:`, nonJsonBackendError());

      return normalizePicksResponse({
        ok: false,
        message: nonJsonBackendError(),
        error: "NON_JSON_RESPONSE",
      });
    }

    if (!res.ok) {
      console.log(`API GET ERROR ${path}:`, data);

      return normalizePicksResponse({
        ok: false,
        message: data.message || "Request failed",
        error: data.error || `HTTP ${res.status}`,
      });
    }

    return normalizePicksResponse(data);
  } catch (err) {
    console.log(`API GET FAILED ${path}:`, err);

    return normalizePicksResponse({
      ok: false,
      message: "Network request failed",
      error: String(err),
    });
  }
}

async function apiPost(path: string, body?: any): Promise<ApiResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: body
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await safeJson(res);

    if (data._nonJson) {
      console.log(`API POST NON-JSON ${path}:`, nonJsonBackendError());

      return normalizePicksResponse({
        ok: false,
        message: nonJsonBackendError(),
        error: "NON_JSON_RESPONSE",
      });
    }

    if (!res.ok) {
      console.log(`API POST ERROR ${path}:`, data);

      return normalizePicksResponse({
        ok: false,
        message: data.message || "Request failed",
        error: data.error || `HTTP ${res.status}`,
      });
    }

    return normalizePicksResponse(data);
  } catch (err) {
    console.log(`API POST FAILED ${path}:`, err);

    return normalizePicksResponse({
      ok: false,
      message: "Network request failed",
      error: String(err),
    });
  }
}

export const fetchSavedPicks = async () => {
  const data = await apiGet("/picks");

  console.log("COURTEDGE PICKS:", {
    ok: data.ok,
    games: data.games?.length || 0,
    topProps: data.topProps?.length || 0,
    nbaGames: data.nbaGames?.length || 0,
    wnbaGames: data.wnbaGames?.length || 0,
  });

  return data;
};

export const refreshSavedPicks = async () => {
  const data = await apiPost("/refresh-picks");

  console.log("COURTEDGE REFRESH:", {
    ok: data.ok,
    games: data.games?.length || 0,
    topProps: data.topProps?.length || 0,
    nbaGames: data.nbaGames?.length || 0,
    wnbaGames: data.wnbaGames?.length || 0,
  });

  return data;
};

export const fetchTopProps = async () => {
  const data = await apiGet("/top-props");

  return {
    ok: data.ok,
    message: data.message || "",
    error: data.error || "",
    lastUpdated: data.lastUpdated || null,
    topProps: data.topProps || [],
    topOfficialProps: data.topOfficialProps || [],
    topTestProps: data.topTestProps || [],
    topNBAProps: data.topNBAProps || [],
    topWNBAProps: data.topWNBAProps || [],
    topNBAOfficialProps: data.topNBAOfficialProps || [],
    topNBATestProps: data.topNBATestProps || [],
    topWNBAOfficialProps: data.topWNBAOfficialProps || [],
    topWNBATestProps: data.topWNBATestProps || [],
    bestSixWNBA: data.bestSixWNBA || [],
    bestSixDisplayWNBA: data.bestSixDisplayWNBA || [],
    bestSixNBA: data.bestSixNBA || [],
    bestSixDisplayNBA: data.bestSixDisplayNBA || [],
    topPropsSource: data.topPropsSource || null,
    topWNBAPropsSelectedFromBestSix: data.topWNBAPropsSelectedFromBestSix ?? null,
    topNBAPropsSelectedFromBestSix: data.topNBAPropsSelectedFromBestSix ?? null,
    bestSixCountByLeague: data.bestSixCountByLeague || {},
    controlledBestSixVersion: data.controlledBestSixVersion ?? null,
    topSelectionAudit: data.topSelectionAudit || null,
    candidateCount: data.candidateCount ?? null,
    selectedCount: data.selectedCount ?? null,
    officialCount: data.officialCount ?? null,
    testCount: data.testCount ?? null,
    noBetCount: data.noBetCount ?? null,
    topPropSelectorVersion: data.topPropSelectorVersion ?? null,
    topPropLimit: data.topPropLimit ?? 4,
    nbaTopPropLimit: data.nbaTopPropLimit ?? 2,
    wnbaTopPropLimit: data.wnbaTopPropLimit ?? 2,
    selectedNBA: data.selectedNBA ?? null,
    selectedWNBA: data.selectedWNBA ?? null,
    hiddenDueToLimit: data.hiddenDueToLimit ?? null,
    engineHandled: data.engineHandled || {},
    filterAudit: data.filterAudit || null,
    trackingMode: data.trackingMode || data.filterAudit?.trackingMode || null,
    generatedPropCount: data.generatedPropCount ?? null,
  };
};

export const fetchLeaguePicks = async (league: League) => {
  const safeLeague = league === "WNBA" ? "WNBA" : "NBA";
  const data = await apiGet(`/picks/${safeLeague}`);

  return {
    ok: data.ok,
    message: data.message || "",
    error: data.error || "",
    league: safeLeague,
    lastUpdated: data.lastUpdated || null,
    games: data.games || [],
    topProps: data.topProps || [],
  };
};

export const fetchNBAPicks = async () => {
  return fetchLeaguePicks("NBA");
};

export const fetchWNBAPicks = async () => {
  return fetchLeaguePicks("WNBA");
};

export const savePick = async (pick: any) => {
  const data = await apiPost("/save-pick", pick);

  return {
    ok: data.ok,
    message: data.message || "",
    pick: data.pick || pick,
  };
};

export const fetchPickHistory = async () => {
  try {
    const res = await fetch(`${BASE_URL}/saved-picks`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      picks: Array.isArray(data.picks) ? data.picks : [],
    };
  } catch (err) {
    console.log("FETCH PICK HISTORY FAILED:", err);

    return {
      ok: false,
      picks: [],
    };
  }
};

const RESOLVE_COOLDOWN_MS = 5 * 60 * 1000;
let lastResolveAt = 0;

export const resolvePicks = async (options?: { force?: boolean }) => {
  const force = Boolean(options?.force);
  const now = Date.now();

  if (!force && now - lastResolveAt < RESOLVE_COOLDOWN_MS) {
    return {
      ok: true,
      skipped: true,
      message: "Resolve skipped (cooldown active)",
      error: "",
      picks: [],
      summary: null,
    };
  }

  lastResolveAt = now;

  try {
    const res = await fetch(`${BASE_URL}/resolve-picks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      skipped: false,
      message: data.message || "",
      error: data.error || "",
      picks: Array.isArray(data.picks) ? data.picks : [],
      summary: data.summary || null,
    };
  } catch (err) {
    console.log("RESOLVE PICKS FAILED:", err);

    return {
      ok: false,
      skipped: false,
      message: "Network request failed",
      error: String(err),
      picks: [],
      summary: null,
    };
  }
};

export const checkPendingResults = async (options?: {
  requireLikelyFinished?: boolean;
  force?: boolean;
}) => {
  const force = Boolean(options?.force);
  const now = Date.now();

  if (!force && now - lastResolveAt < RESOLVE_COOLDOWN_MS) {
    return {
      ok: true,
      skipped: true,
      message: "Check skipped (cooldown active)",
      error: "",
      picks: [],
      props: [],
      savedSummary: null,
      trackedSummary: null,
      dailyReport: null,
      reports: [],
    };
  }

  lastResolveAt = now;

  try {
    const res = await fetch(`${BASE_URL}/check-pending-results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requireLikelyFinished: Boolean(options?.requireLikelyFinished),
      }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      skipped: false,
      message: data.message || "",
      error: data.error || "",
      picks: Array.isArray(data.picks) ? data.picks : [],
      props: Array.isArray(data.props) ? data.props : [],
      savedSummary: data.savedSummary || null,
      trackedSummary: data.trackedSummary || null,
      dailyReport: data.dailyReport || null,
      reports: Array.isArray(data.reports) ? data.reports : [],
      analytics: data.analytics || null,
    };
  } catch (err) {
    console.log("CHECK PENDING RESULTS FAILED:", err);

    return {
      ok: false,
      skipped: false,
      message: "Network request failed",
      error: String(err),
      picks: [],
      props: [],
      savedSummary: null,
      trackedSummary: null,
      dailyReport: null,
      reports: [],
      analytics: null,
    };
  }
};

export const deletePick = async (id: string) => {
  try {
    const res = await fetch(`${BASE_URL}/saved-picks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      picks: data.picks || [],
    };
  } catch (err) {
    console.log("DELETE PICK FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      picks: [],
    };
  }
};

export const getApiBaseUrl = () => BASE_URL;

export type BackendMode = "LOCAL DEV" | "LIVE RENDER" | "CUSTOM";

export const getBackendMode = (): BackendMode => {
  const url = BASE_URL.toLowerCase();

  if (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    /^http:\/\/192\.168\./.test(url) ||
    /^http:\/\/10\./.test(url)
  ) {
    return "LOCAL DEV";
  }

  if (url.includes("onrender.com")) {
    return "LIVE RENDER";
  }

  return "CUSTOM";
};

export const fetchTrackedProps = async () => {
  try {
    const res = await fetch(`${BASE_URL}/tracked-props`);
    const data = await safeJson(res);

    if (data._nonJson) {
      return {
        ok: false,
        props: [],
        count: 0,
        error: nonJsonBackendError(),
      };
    }

    return {
      ok: res.ok && (data.ok ?? false),
      props: Array.isArray(data.props) ? data.props : [],
      count: data.count || (Array.isArray(data.props) ? data.props.length : 0),
      error: data.error || (!res.ok ? `HTTP ${res.status}` : undefined),
    };
  } catch (err) {
    console.log("FETCH TRACKED PROPS FAILED:", err);

    return {
      ok: false,
      props: [],
      count: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const fetchTrackedAnalytics = async () => {
  try {
    const res = await fetch(`${BASE_URL}/tracked-props/analytics`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      analytics: data.analytics || null,
      count: data.count || 0,
    };
  } catch (err) {
    console.log("FETCH TRACKED ANALYTICS FAILED:", err);

    return {
      ok: false,
      analytics: null,
      count: 0,
    };
  }
};

export const resolveTrackedProps = async (options?: {
  requireLikelyFinished?: boolean;
}) => {
  try {
    const res = await fetch(`${BASE_URL}/resolve-tracked-props`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requireLikelyFinished: Boolean(options?.requireLikelyFinished),
      }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      props: Array.isArray(data.props) ? data.props : [],
      summary: data.summary || null,
      analytics: data.analytics || null,
    };
  } catch (err) {
    console.log("RESOLVE TRACKED PROPS FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      props: [],
      summary: null,
      analytics: null,
    };
  }
};

export const fetchDailySlateReports = async () => {
  try {
    const res = await fetch(`${BASE_URL}/daily-slate-reports`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      reports: Array.isArray(data.reports) ? data.reports : [],
      count: data.count || 0,
      currentLabSlateDate: data.currentLabSlateDate || null,
      activeResultsSlateDate: data.activeResultsSlateDate || null,
      viewedSlateDate: data.viewedSlateDate || null,
      viewingHistorical: Boolean(data.viewingHistorical),
      historySlateDates: Array.isArray(data.historySlateDates)
        ? data.historySlateDates
        : [],
      activeInProgressSlateDates: Array.isArray(data.activeInProgressSlateDates)
        ? data.activeInProgressSlateDates
        : [],
      quarantinedLegacySlateDates: Array.isArray(data.quarantinedLegacySlateDates)
        ? data.quarantinedLegacySlateDates
        : [],
      quarantinedSlateDates: Array.isArray(data.quarantinedSlateDates)
        ? data.quarantinedSlateDates
        : [],
      quarantinedSlateReasons:
        data.quarantinedSlateReasons && typeof data.quarantinedSlateReasons === "object"
          ? data.quarantinedSlateReasons
          : {},
      staleUnresolvedSlateDates: Array.isArray(data.staleUnresolvedSlateDates)
        ? data.staleUnresolvedSlateDates
        : [],
      lifecycleByDate: data.lifecycleByDate || {},
      rotationDecisionDebug: data.rotationDecisionDebug || null,
      serverBuild: data.serverBuild || null,
      historyThreeSlateGroups: data.historyThreeSlateGroups || null,
      signalPerformanceVersion: data.signalPerformanceVersion || null,
      historyThreeSlateGroupsVersion: data.historyThreeSlateGroupsVersion || null,
    };
  } catch (err) {
    console.log("FETCH DAILY SLATE REPORTS FAILED:", err);

    return {
      ok: false,
      reports: [],
      count: 0,
      currentLabSlateDate: null,
      activeResultsSlateDate: null,
      viewedSlateDate: null,
      viewingHistorical: false,
      historySlateDates: [],
      activeInProgressSlateDates: [],
      quarantinedLegacySlateDates: [],
      quarantinedSlateDates: [],
      quarantinedSlateReasons: {},
      staleUnresolvedSlateDates: [],
      lifecycleByDate: {},
      rotationDecisionDebug: null,
      serverBuild: null,
    };
  }
};

export const fetchDailySlateReport = async (slateDate: string) => {
  try {
    const res = await fetch(
      `${BASE_URL}/daily-slate-reports/${encodeURIComponent(slateDate)}`
    );
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      report: data.report || null,
      message: data.message || "",
    };
  } catch (err) {
    console.log("FETCH DAILY SLATE REPORT FAILED:", err);

    return {
      ok: false,
      report: null,
      message: "Network request failed",
    };
  }
};

export const buildDailySlateReports = async (options?: {
  slateDate?: string;
  forceRebuild?: boolean;
}) => {
  try {
    const res = await fetch(`${BASE_URL}/daily-slate-reports/build`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(options?.slateDate ? { slateDate: options.slateDate } : {}),
        ...(options?.forceRebuild ? { forceRebuild: true } : {}),
      }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      reports: Array.isArray(data.reports) ? data.reports : [],
      summary: data.summary || data.dailyReport || null,
      built: Array.isArray(data.built) ? data.built : [],
    };
  } catch (err) {
    console.log("BUILD DAILY SLATE REPORTS FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      reports: [],
      summary: null,
      built: [],
    };
  }
};

export const fetchLockedSlates = async () => {
  try {
    const res = await fetch(`${BASE_URL}/slates/locked`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      slates: Array.isArray(data.slates) ? data.slates : [],
      count: data.count || 0,
      lastBlockedWrite: data.lastBlockedWrite || null,
    };
  } catch (err) {
    console.log("FETCH LOCKED SLATES FAILED:", err);

    return {
      ok: false,
      slates: [],
      count: 0,
      lastBlockedWrite: null,
    };
  }
};

export const lockSlate = async (slateDate: string, reason = "manual") => {
  try {
    const res = await fetch(`${BASE_URL}/slates/${encodeURIComponent(slateDate)}/lock`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      slateDate: data.slateDate || slateDate,
      entry: data.entry || null,
      snapshot: data.snapshot || null,
      alreadyLocked: Boolean(data.alreadyLocked),
    };
  } catch (err) {
    console.log("LOCK SLATE FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      slateDate,
      entry: null,
      snapshot: null,
      alreadyLocked: false,
    };
  }
};

export const fetchDiagnostics = async () => {
  try {
    const res = await fetch(`${BASE_URL}/diagnostics`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      diagnostics: data,
    };
  } catch (err) {
    console.log("FETCH DIAGNOSTICS FAILED:", err);

    return {
      ok: false,
      diagnostics: null,
    };
  }
};

export const fetchHistoryArchives = async () => {
  try {
    const res = await fetch(`${BASE_URL}/history-archives`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      archives: Array.isArray(data.archives) ? data.archives : [],
      count: data.count || 0,
      historyThreeSlateGroups: data.historyThreeSlateGroups || null,
      signalPerformanceVersion: data.signalPerformanceVersion || null,
      historyThreeSlateGroupsVersion: data.historyThreeSlateGroupsVersion || null,
      serverBuild: data.serverBuild || null,
    };
  } catch (err) {
    console.log("FETCH HISTORY ARCHIVES FAILED:", err);

    return {
      ok: false,
      archives: [],
      count: 0,
    };
  }
};

export const fetchHistoryArchive = async (slateDate: string) => {
  try {
    const res = await fetch(
      `${BASE_URL}/history-archives/${encodeURIComponent(slateDate)}`
    );
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      archive: data.archive || null,
      message: data.message || "",
    };
  } catch (err) {
    console.log("FETCH HISTORY ARCHIVE FAILED:", err);

    return {
      ok: false,
      archive: null,
      message: "Network request failed",
    };
  }
};

export const resetHistoryArchives = async (options?: {
  dryRun?: boolean;
  confirm?: boolean;
  adminSecret?: string;
}) => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = String(options?.adminSecret || process.env.EXPO_PUBLIC_ADMIN_SECRET || "").trim();
    if (secret) {
      headers["x-admin-secret"] = secret;
    }

    const res = await fetch(`${BASE_URL}/admin/reset-history`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dryRun: Boolean(options?.dryRun),
        confirm: Boolean(options?.confirm),
      }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      result: data.result || null,
      status: res.status,
    };
  } catch (err) {
    console.log("RESET HISTORY FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      result: null,
      status: 0,
    };
  }
};

export const resetLabNoRestore = async (options?: {
  dryRun?: boolean;
  confirm?: boolean;
  adminSecret?: string;
}) => {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = String(
      options?.adminSecret || process.env.EXPO_PUBLIC_ADMIN_SECRET || ""
    ).trim();
    if (secret) {
      headers["x-admin-secret"] = secret;
    }

    const res = await fetch(`${BASE_URL}/admin/reset-lab-no-restore`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dryRun: Boolean(options?.dryRun),
        confirm: Boolean(options?.confirm),
      }),
    });
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      message: data.message || "",
      result: data.result || null,
      status: res.status,
    };
  } catch (err) {
    console.log("RESET LAB NO RESTORE FAILED:", err);

    return {
      ok: false,
      message: "Network request failed",
      result: null,
      status: 0,
    };
  }
};