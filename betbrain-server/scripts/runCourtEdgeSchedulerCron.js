/**
 * Render Cron dispatcher for CourtEdge scheduler.
 * Calls POST /internal/courtedge/run-scheduled-jobs with COURTEDGE_SCHEDULER_TOKEN.
 * Exit 0 when endpoint responds ok (even if all jobs skipped).
 * Exit non-zero only on real scheduler/auth/network failure after retries.
 */
const DEFAULT_URL = "https://betbrain-server-1.onrender.com";
const COLD_START_TIMEOUT_MS = Number(
  process.env.COURTEDGE_SCHEDULER_TIMEOUT_MS || 120000
);
const MAX_ATTEMPTS = Number(process.env.COURTEDGE_SCHEDULER_CRON_RETRIES || 3);

function resolveServerUrl() {
  const raw =
    process.env.COURTEDGE_SERVER_URL ||
    process.env.BETBRAIN_SERVER_URL ||
    DEFAULT_URL;
  return String(raw).replace(/\/$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "").toUpperCase();
  if (/timeout|aborted|timed out/i.test(message) || code === "ABORT_ERR") {
    return { retryable: true, type: "COLD_START_OR_TIMEOUT" };
  }
  if (
    /econnreset|econnrefused|enotfound|fetch failed|network/i.test(message) ||
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  ) {
    return { retryable: true, type: "NETWORK" };
  }
  return { retryable: false, type: "UNKNOWN" };
}

async function callScheduler(attempt) {
  const baseUrl = resolveServerUrl();
  const token = String(process.env.COURTEDGE_SCHEDULER_TOKEN || "").trim();
  if (!token) {
    const err = new Error("COURTEDGE_SCHEDULER_TOKEN is not set");
    err.fatal = true;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLD_START_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/internal/courtedge/run-scheduled-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-courtedge-scheduler-token": token,
      },
      body: JSON.stringify({
        source: "render-cron",
        force: false,
        attempt,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, message: "Non-JSON response", raw: text.slice(0, 200) };
    }

    if (res.status === 401 || res.status === 403) {
      const err = new Error("Scheduler token rejected");
      err.fatal = true;
      err.status = res.status;
      throw err;
    }

    if (res.status >= 500) {
      const err = new Error(data?.message || `Server ${res.status}`);
      err.retryable = true;
      err.status = res.status;
      throw err;
    }

    if (!res.ok) {
      const err = new Error(data?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.fatal = res.status < 500;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const data = await callScheduler(attempt);
      const summary = {
        ok: data?.ok !== false,
        serverBuild: data?.serverBuild || null,
        courtEdgeLocalTime: data?.courtEdgeLocalTime || null,
        jobsRun: (data?.jobsRun || []).map((j) => j.jobId || j),
        jobsSkipped: (data?.jobsSkipped || []).length,
        errors: (data?.errors || []).length,
        attempt,
      };
      console.log(JSON.stringify({ event: "courtedge_scheduler_cron_ok", ...summary }));
      // Endpoint replied successfully — skipped jobs are still exit 0.
      if (data?.ok === false && (data?.errors || []).length) {
        process.exitCode = 1;
        return;
      }
      process.exitCode = 0;
      return;
    } catch (error) {
      lastError = error;
      if (error.fatal) {
        console.error(
          JSON.stringify({
            event: "courtedge_scheduler_cron_fatal",
            type: "AUTH_OR_CONFIG",
            message: String(error.message || error),
            // never log token
          })
        );
        process.exitCode = 1;
        return;
      }
      const classified = error.retryable
        ? { retryable: true, type: "SERVER_5XX" }
        : classifyFetchError(error);
      console.error(
        JSON.stringify({
          event: "courtedge_scheduler_cron_retry",
          attempt,
          type: classified.type,
          message: String(error.message || error),
        })
      );
      if (!classified.retryable || attempt >= MAX_ATTEMPTS) break;
      await sleep(attempt * 4000);
    }
  }

  console.error(
    JSON.stringify({
      event: "courtedge_scheduler_cron_failed",
      message: String(lastError?.message || lastError || "unknown"),
    })
  );
  process.exitCode = 1;
}

main();
