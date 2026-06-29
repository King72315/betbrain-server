/**
 * Capture 06/28 Best 6 tracked props into bundled repair slice.
 *
 * Usage (local server must be running with API keys):
 *   node betbrain-server/scripts/capture0628TrackedPropsSlice.js
 *   API_URL=https://betbrain-server-1.onrender.com node betbrain-server/scripts/capture0628TrackedPropsSlice.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLATE_DATE = "2026-06-28";
const OUT_PATH = path.join(
  __dirname,
  "..",
  "backups",
  "courteedge-repair-0628-tracked-props-slice.json"
);
const API = process.env.API_URL || "http://127.0.0.1:3010";

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { preview: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log(`Refreshing picks at ${API} ...`);
  await fetchJson(`${API}/refresh-picks`, { method: "POST" });

  const tracked = await fetchJson(`${API}/tracked-props?includeLegacy=true`);
  if (!tracked.ok) {
    throw new Error(`tracked-props failed: ${tracked.status}`);
  }

  const props = (tracked.data.props || []).filter(
    (prop) => String(prop.slateDate || "") === SLATE_DATE
  );

  console.log(`Found ${props.length} tracked props for ${SLATE_DATE}`);

  if (!props.length) {
    console.error(
      "No 06/28 props returned. Games may be finished and board empty — props must exist in tracked-props store before capture."
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(props, null, 2));
  console.log(`Wrote ${props.length} props to ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
