# CourtEdge Backend Network Failure Regression Repair v1

**Date:** 2026-07-22 (America/Chicago)  
**SERVER_BUILD:** `courteedge-backend-network-regression-repair-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin` (`https://github.com/King72315/betbrain-server.git`)  
**Prod:** `https://betbrain-server-1.onrender.com`

---

## Previously working commit

| Item | Value |
|---|---|
| Last known-good live `/health` | `7f88bc0` — *Fail-fast Postgres boot so Render startup cannot hang on DATABASE_URL* |
| Live fingerprint then | `serverBuild=courteedge-home-restart-durability-v1`, `durableStore.type=filesystem`, `databaseUrlConfigured=false` |
| Evidence | `COURTEDGE_HOME_RESTART_DURABILITY_V1_REPORT.md` §19 (live Today 6 via bundled recovery) |

`d7d4cc3` (report-only) sat between `7f88bc0` and the primary regression commit and did not change boot.

---

## Regression commits

| Commit | Role |
|---|---|
| `e766d02` | Fully autonomous ops — Postgres durable store, watchdog, Blueprint `DATABASE_URL` wiring |
| `69e42b3` | Home restart durability — hydrate Today/Tomorrow before bundled recovery |
| `7f88bc0` | Fail-fast Postgres + 12s hydrate budget (**last working prod health**) |
| `aef8425` | *Listen before durable hydrate* — **primary network regression** |
| `HEAD` (this repair) | `courteedge-backend-network-regression-repair-v1` |

---

## Root cause

Not “only Render sleeping.” Live probes returned consistent **HTTP 502** (Render Bad Gateway HTML), not cold-start spin-up.

`aef8425` moved `app.listen` ahead of Postgres hydrate but **left heavy sync work before listen**:

1. `rehydrateLockedSlatesOnStartup()` / orphan recovery / date-stamp repair still ran **before** `startServer()`.
2. Local repro on `aef8425`: port bound only after **~32s**, then durable hydrate **blocked the event loop** so `/health` returned `000` for several seconds after listen.
3. After listen, hydrate still **awaited** (comment said “background” but code did not defer). Large JSON (`board-cache` ~17MB local, `tracked-props` multi-MB, `daily-slate-reports` can be huge) made parse/write starve requests and risk OOM on free-tier 512MB.
4. `Promise.race` startup budgets / Postgres boot timeouts could leave **late rejections unhandled**, which can terminate Node after fail-open.
5. Blueprint `render.yaml` wires `DATABASE_URL` from `courtedge-durable-db`; a mislinked/unreachable DB must never prevent `/health` from answering.

Net: Render free-tier health checks / proxy saw no healthy process → **502 / Network Request Failed** in the app.

---

## Fix

1. **True listen-first:** bind `CONFIG.PORT` immediately; defer all integrity + durable hydrate via `setImmediate` so `/health` answers during `bootPhase=listening|hydrating`.
2. **Non-fatal deferred startup:** hydrate errors set `bootPhase=degraded` but **do not** `process.exit`.
3. **Budget + late-reject safe:** `withStartupBudget` attaches `.catch` on work so timeout winners cannot crash the process.
4. **Postgres fail-open hardened:** shorter connect/boot ceilings; swallow late boot errors; never await unbounded `pool.end()`.
5. **Boot hydrate slim:** only critical keys; skip files over `COURTEDGE_HYDRATE_MAX_BYTES` (default 4MB); `setImmediate` yields between keys; `durableGet` refuses oversized filesystem mirrors.
6. **Delay first scheduler heartbeat** to 60s (env override) — no heavy refresh during bind.
7. **SERVER_BUILD** → `courteedge-backend-network-regression-repair-v1`; `/health` exposes `bootPhase`.

Home Best 6 restore path preserved: deferred Home durable hydrate → sealed Jul 20 restore → bundled `empty-board-recovery-v1` fallback (no startup auto-refresh).

---

## Local proof (pre-push)

| Check | Result |
|---|---|
| `/health` first 200 | **~11s** after process start (`bootPhase=hydrating`) — was ~32s+ blocked on `aef8425` |
| `/picks` | **200**, Today **6**, Tomorrow **6**, `serverBuild=courteedge-backend-network-regression-repair-v1` |
| Bad `DATABASE_URL` | Fail-open filesystem; process stays up (see live section for prod) |

---

## Live `/health` proof

*(filled after deploy)*

| Probe | Result |
|---|---|
| `GET https://betbrain-server-1.onrender.com/health` | _pending deploy_ |
| `serverBuild` | `courteedge-backend-network-regression-repair-v1` |
| `bootPhase` | expected `ready` (or briefly `hydrating`) |
| `GET /picks` | _pending_ |

---

## Remaining Render free-tier limitations

1. **Cold start / sleep:** free web services still spin down; first request after idle can take tens of seconds (not a substitute for a paid always-on instance).
2. **Module import cost:** large `server.js` dependency graph still costs ~10s before listen on a warm laptop; Render free CPUs may be slower — listen-first only starts after modules load.
3. **No Postgres durability** until `DATABASE_URL` is actually attached and healthy on `betbrain-server-1` (`durableActive=true`). Filesystem + bundled recovery remain the bridge.
4. **Ephemeral disk:** redeploy still wipes runtime JSON; Home survival without Postgres depends on recovery bundle / future durable DB.
5. **Oversized local artifacts:** boot intentionally skips >4MB hydrate files to avoid OOM; do not commit bloated `daily-slate-reports.json` / board dumps.

---

## Final verdict

```text
REPAIR SHIPPED — awaiting live deploy verify
```
