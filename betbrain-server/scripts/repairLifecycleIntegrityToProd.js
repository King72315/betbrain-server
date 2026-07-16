/**
 * Prod lifecycle integrity repair runner.
 * node betbrain-server/scripts/repairLifecycleIntegrityToProd.js --dry-run
 * node betbrain-server/scripts/repairLifecycleIntegrityToProd.js --confirm
 */
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const dryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm");

async function main() {
  if (!dryRun && !confirm) {
    console.error("Pass --dry-run or --confirm");
    process.exit(1);
  }
  const body = {
    lifecycleRepair: true,
    dryRun,
    confirm: confirm && !dryRun,
    slateDate: process.env.TARGET_LAB_SLATE || null,
    backupReason: "pre-lifecycle-integrity-repair-v1",
  };
  const res = await fetch(`${SOURCE}/daily-slate-reports/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { preview: text.slice(0, 800) };
  }
  console.log(JSON.stringify({ status: res.status, ok: res.ok, data }, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
