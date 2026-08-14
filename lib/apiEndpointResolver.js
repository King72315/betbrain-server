/**
 * CourtEdge API endpoint resolver V1
 *
 * Dev laptop: LOCAL first → RENDER fallback
 * Production builds: RENDER primary
 *
 * One active backend per session. Never merge Local + Render responses.
 */

export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:3000";
export const DEFAULT_RENDER_API_URL = "https://betbrain-server-1.onrender.com";
/** LAN phones need a bit more than loopback; keep short so Render fallback stays snappy. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 3000;

function stripTrailingSlash(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

export function isLocalUrl(url) {
  const u = String(url || "").toLowerCase();
  return (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    /^http:\/\/192\.168\./.test(u) ||
    /^http:\/\/10\./.test(u)
  );
}

export function isRenderUrl(url) {
  return String(url || "").toLowerCase().includes("onrender.com");
}

function readEnv(env, key) {
  const v = env?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function detectIsDev(options = {}) {
  if (typeof options.isDev === "boolean") return options.isDev;
  if (typeof __DEV__ !== "undefined") return Boolean(__DEV__);
  return process.env.NODE_ENV !== "production";
}

/**
 * Resolve configured local/render URLs + mode.
 * Compatible with legacy EXPO_PUBLIC_API_URL.
 */
export function getApiEndpointConfig(env = process.env, options = {}) {
  const isDev = detectIsDev(options);
  const legacy = stripTrailingSlash(readEnv(env, "EXPO_PUBLIC_API_URL"));
  const localFromEnv = stripTrailingSlash(readEnv(env, "EXPO_PUBLIC_LOCAL_API_URL"));
  const renderFromEnv = stripTrailingSlash(
    readEnv(env, "EXPO_PUBLIC_RENDER_API_URL")
  );

  let localUrl = localFromEnv || DEFAULT_LOCAL_API_URL;
  let renderUrl = renderFromEnv || DEFAULT_RENDER_API_URL;

  if (legacy) {
    if (isLocalUrl(legacy)) {
      localUrl = legacy;
    } else if (isRenderUrl(legacy) || /^https?:\/\//i.test(legacy)) {
      renderUrl = legacy;
    }
  }

  const modeRaw = readEnv(env, "EXPO_PUBLIC_API_MODE").toLowerCase();
  let mode = "auto";
  if (modeRaw === "local" || modeRaw === "render" || modeRaw === "auto") {
    mode = modeRaw;
  } else if (!isDev) {
    mode = "render";
  } else {
    mode = "auto";
  }

  return {
    mode,
    localUrl,
    renderUrl,
    isDev,
    legacyApiUrl: legacy || null,
  };
}

function logApiSelection(diag) {
  const line = [
    "[COURTEDGE API]",
    `mode=${String(diag.mode || "").toUpperCase()}`,
    `local=${diag.localUrl}`,
    `render=${diag.renderUrl}`,
    `selected=${diag.activeBackend}`,
    `fallback=${diag.fallbackUsed ? "true" : "false"}`,
  ];
  if (diag.reason) line.push(`reason=${diag.reason}`);
  if (diag.error) line.push(`error=${diag.error}`);
  console.log(line.join("\n"));
}

/**
 * Probe LOCAL /health with a short timeout. Never hangs on a dead host.
 */
export async function probeLocalHealth(localUrl, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs =
    Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_HEALTH_TIMEOUT_MS;
  if (typeof fetchFn !== "function") {
    return { ok: false, reason: "FETCH_UNAVAILABLE" };
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  try {
    const res = await fetchFn(`${stripTrailingSlash(localUrl)}/health`, {
      method: "GET",
      signal: controller?.signal,
    });
    if (!res || !res.ok) {
      return { ok: false, reason: "LOCAL_HTTP_ERROR" };
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (data && data.ok === false) {
      return { ok: false, reason: "LOCAL_HEALTH_NOT_OK" };
    }
    return { ok: true, reason: null };
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    if (name === "AbortError") {
      return { ok: false, reason: "LOCAL_TIMEOUT" };
    }
    return { ok: false, reason: "LOCAL_UNREACHABLE" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Candidate local base URLs: configured first, then loopback.
 * Phones cannot use 127.0.0.1 (that is the phone itself); Expo web/simulator can.
 */
export function getLocalUrlCandidates(config = {}) {
  const out = [];
  const push = (url) => {
    const u = stripTrailingSlash(url);
    if (!u || out.includes(u)) return;
    out.push(u);
  };
  push(config.localUrl);
  push(DEFAULT_LOCAL_API_URL);
  push("http://localhost:3000");
  return out;
}

/**
 * First healthy local candidate wins.
 */
export async function probeFirstHealthyLocal(candidates = [], options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let lastReason = "LOCAL_UNREACHABLE";
  for (const url of list) {
    const probe = await probeLocalHealth(url, options);
    if (probe.ok) {
      return { ok: true, baseUrl: url, reason: null };
    }
    lastReason = probe.reason || lastReason;
  }
  return { ok: false, baseUrl: list[0] || DEFAULT_LOCAL_API_URL, reason: lastReason };
}

/**
 * Pure selection (no session). Never merges Local and Render.
 */
export async function selectApiBackend(options = {}) {
  const env = options.env || process.env;
  const config = getApiEndpointConfig(env, options);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs;
  const localCandidates = getLocalUrlCandidates(config);

  const base = {
    activeBackend: "RENDER",
    baseUrl: config.renderUrl,
    fallbackUsed: false,
    mode: config.mode,
    localUrl: config.localUrl,
    renderUrl: config.renderUrl,
    localCandidates,
  };

  if (config.mode === "render") {
    return {
      ...base,
      activeBackend: "RENDER",
      baseUrl: config.renderUrl,
      fallbackUsed: false,
      reason: "MODE_RENDER",
    };
  }

  if (config.mode === "local") {
    const probe = await probeFirstHealthyLocal(localCandidates, {
      fetchFn,
      timeoutMs,
    });
    if (!probe.ok) {
      return {
        ...base,
        activeBackend: "LOCAL",
        baseUrl: probe.baseUrl,
        fallbackUsed: false,
        reason: probe.reason || "LOCAL_UNREACHABLE",
        error: "LOCAL_UNAVAILABLE",
      };
    }
    return {
      ...base,
      activeBackend: "LOCAL",
      baseUrl: probe.baseUrl,
      localUrl: probe.baseUrl,
      fallbackUsed: false,
      reason: "MODE_LOCAL",
    };
  }

  // auto
  if (!config.isDev) {
    return {
      ...base,
      activeBackend: "RENDER",
      baseUrl: config.renderUrl,
      fallbackUsed: false,
      reason: "PRODUCTION_RENDER",
    };
  }

  const probe = await probeFirstHealthyLocal(localCandidates, {
    fetchFn,
    timeoutMs,
  });
  if (probe.ok) {
    return {
      ...base,
      activeBackend: "LOCAL",
      baseUrl: probe.baseUrl,
      localUrl: probe.baseUrl,
      fallbackUsed: false,
      reason: "LOCAL_HEALTHY",
    };
  }

  return {
    ...base,
    activeBackend: "RENDER",
    baseUrl: config.renderUrl,
    fallbackUsed: true,
    reason: probe.reason || "LOCAL_UNREACHABLE",
  };
}

let sessionDiagnostics = null;
let selectPromise = null;

/**
 * Session-locked backend selection. All Home/Results/Lab/History calls share this.
 */
export async function ensureActiveBackend(options = {}) {
  if (options.forceReselect) {
    sessionDiagnostics = null;
    selectPromise = null;
  }
  if (sessionDiagnostics && !options.forceReselect) {
    return sessionDiagnostics;
  }
  if (selectPromise) {
    return selectPromise;
  }

  selectPromise = (async () => {
    const previous = sessionDiagnostics;
    const next = await selectApiBackend(options);

    if (
      previous &&
      (previous.activeBackend !== next.activeBackend ||
        previous.baseUrl !== next.baseUrl)
    ) {
      console.log(
        `[COURTEDGE API] source change ${previous.activeBackend} → ${next.activeBackend}`
      );
    }

    sessionDiagnostics = next;
    logApiSelection(next);
    return next;
  })();

  try {
    return await selectPromise;
  } finally {
    selectPromise = null;
  }
}

export async function resolveActiveApiBaseUrl(options = {}) {
  const diag = await ensureActiveBackend(options);
  return diag.baseUrl;
}

export function getApiEndpointDiagnostics() {
  return sessionDiagnostics;
}

export function getLockedApiBaseUrlOrNull() {
  return sessionDiagnostics?.baseUrl || null;
}

/**
 * Sync helper for reports. Prefers session lock; otherwise configured preference (no probe).
 */
export function peekPreferredApiBaseUrl(env = process.env, options = {}) {
  if (sessionDiagnostics?.baseUrl) return sessionDiagnostics.baseUrl;
  const config = getApiEndpointConfig(env, options);
  if (config.mode === "local") return config.localUrl;
  if (config.mode === "render" || !config.isDev) return config.renderUrl;
  return config.localUrl;
}

export function resetApiEndpointSessionForTests() {
  sessionDiagnostics = null;
  selectPromise = null;
}

/**
 * Guard: a single result object must come from one backend only.
 */
export function assertSingleBackendTruth(resultMeta = {}) {
  const sources = []
    .concat(resultMeta.sources || [])
    .concat(resultMeta.backends || [])
    .filter(Boolean)
    .map((s) => String(s).toUpperCase());
  const unique = [...new Set(sources)];
  if (unique.length > 1) {
    throw new Error(
      `COURTEDGE_API_MERGE_FORBIDDEN: cannot combine backends ${unique.join("+")}`
    );
  }
  return true;
}

export function formatBackendBadgeLabel(diag) {
  if (!diag) return "Backend: …";
  if (diag.activeBackend === "LOCAL") {
    const host = String(diag.baseUrl || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "");
    return host ? `Backend: LOCAL (${host})` : "Backend: LOCAL";
  }
  if (diag.fallbackUsed) {
    return "Backend: RENDER (Local unavailable — open firewall TCP 3000 or use Expo on this PC)";
  }
  return "Backend: RENDER";
}
