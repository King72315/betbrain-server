/**
 * Prod runner — append Lab learning layers for current Lab slate.
 *
 * Usage:
 *   node betbrain-server/scripts/backfillLabLearningLayersToProd.js --dry-run
 *   ADMIN_SECRET=... node betbrain-server/scripts/backfillLabLearningLayersToProd.js --confirm
 */
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const dryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm");
const useOpenBuild = process.argv.includes("--open-build");
const slateDate = process.argv.find((arg) => arg.startsWith("--slate="))?.split("=")[1];

async function main() {
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }

  const body = {
    learningOnly: useOpenBuild || !ADMIN_SECRET,
    dryRun,
    confirm: confirm && !dryRun,
    ...(slateDate ? { slateDate } : {}),
    backupReason: "pre-lab-learning-backfill-v1",
  };

  const endpoint =
    useOpenBuild || !ADMIN_SECRET
      ? `${SOURCE}/daily-slate-reports/build`
      : `${SOURCE}/admin/backfill-lab-learning-layers`;

  const headers = { "Content-Type": "application/json" };
  if (ADMIN_SECRET && !useOpenBuild) {
    headers["x-admin-secret"] = ADMIN_SECRET;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { preview: text.slice(0, 500) };
  }

  console.log(JSON.stringify({ status: res.status, ok: res.ok, data }, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
