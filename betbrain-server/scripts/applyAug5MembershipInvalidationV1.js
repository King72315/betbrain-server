/**
 * Stamp MEMBERSHIP_INTEGRITY_INVALIDATED onto Aug 5 lock registry + snapshot.
 * Does NOT rewrite Official prop identities.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  attachIntegrityFieldsToLockEntry,
  getSlateIntegrityInvalidation,
  MEMBERSHIP_INTEGRITY_BUILD,
} from "../services/slateMembershipIntegrityV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(ROOT, "locked-slates.json");
const SNAP = path.join(ROOT, "slate-snapshots", "2026-08-05.json");
const DATE = "2026-08-05";

const inv = getSlateIntegrityInvalidation(DATE);
if (!inv) {
  console.error("No invalidation for", DATE);
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
const slates = Array.isArray(registry.slates) ? registry.slates : [];
const idx = slates.findIndex((s) => s.slateDate === DATE);
if (idx < 0) {
  console.error("No lock entry for", DATE);
  process.exit(1);
}

const beforeProps = idx >= 0 ? slates[idx].propCount : null;
slates[idx] = attachIntegrityFieldsToLockEntry(slates[idx], DATE);
registry.slates = slates;
registry.updatedAt = new Date().toISOString();
registry.membershipIntegrityBuild = MEMBERSHIP_INTEGRITY_BUILD;
fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));

if (fs.existsSync(SNAP)) {
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const propCountBefore = Array.isArray(snap.props) ? snap.props.length : 0;
  Object.assign(snap, inv, {
    membershipIntegrityBuild: MEMBERSHIP_INTEGRITY_BUILD,
  });
  // Preserve props array byte-for-identity (no rewrite).
  fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        slateDate: DATE,
        propCountBefore,
        propCountAfter: Array.isArray(snap.props) ? snap.props.length : 0,
        registryPropCount: slates[idx].propCount,
        beforeProps,
        membershipIntegrityStatus: snap.membershipIntegrityStatus,
        officialRecordEligible: snap.officialRecordEligible,
        propsRewritten: false,
      },
      null,
      2
    )
  );
} else {
  console.log(JSON.stringify({ ok: true, snapshotMissing: true, registryUpdated: true }));
}
