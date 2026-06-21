import { resetChiDalBadGrades } from "../services/trackedPropService.js";

const result = resetChiDalBadGrades({
  backupSuffix: "before-chi-dal-reset-20260621",
  pendingReason: "Game not final yet.",
});

console.log("CHI/DAL RESET:", result);

if (!result.ok) {
  process.exit(1);
}
