const BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );

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

  picks?: any[];
  pick?: any;
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
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

    picks: data.picks || [],
    pick: data.pick || null,
  };
}

async function apiGet(path: string): Promise<ApiResult> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await safeJson(res);

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
    lastUpdated: data.lastUpdated || null,
    topProps: data.topProps || [],
    topNBAProps: data.topNBAProps || [],
    topWNBAProps: data.topWNBAProps || [],
  };
};

export const fetchLeaguePicks = async (league: League) => {
  const safeLeague = league === "WNBA" ? "WNBA" : "NBA";
  const data = await apiGet(`/picks/${safeLeague}`);

  return {
    ok: data.ok,
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
  const data = await apiGet("/saved-picks");

  return {
    ok: data.ok,
    picks: data.picks || [],
  };
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
    };
  }

  lastResolveAt = now;

  const data = await apiPost("/resolve-picks");

  return {
    ok: data.ok,
    skipped: false,
    message: data.message || "",
    error: data.error || "",
    picks: data.picks || [],
  };
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

export const fetchTrackedProps = async () => {
  try {
    const res = await fetch(`${BASE_URL}/tracked-props`);
    const data = await safeJson(res);

    return {
      ok: res.ok && (data.ok ?? false),
      props: Array.isArray(data.props) ? data.props : [],
      count: data.count || (Array.isArray(data.props) ? data.props.length : 0),
    };
  } catch (err) {
    console.log("FETCH TRACKED PROPS FAILED:", err);

    return {
      ok: false,
      props: [],
      count: 0,
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