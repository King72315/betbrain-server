import { getTrackedProps } from "../services/trackedPropService.js";
import { buildRetroactiveGateSimulation } from "../engines/wnba/wnbaTrackingGateV2.js";

const props = getTrackedProps().filter((p) => p.slateDate === "2026-06-24");
const sim = buildRetroactiveGateSimulation(props, { slateDate: "2026-06-24" });
console.log(
  JSON.stringify(
    {
      count: props.length,
      actual: sim.actualRecord,
      simulated: sim.simulatedRecord,
      lossesBlockedCount: sim.lossesWouldBeBlocked.length,
      lossesBlocked: sim.lossesWouldBeBlocked,
      winsKeptCount: sim.winsWouldStillTrack.length,
      winsBlockedCount: sim.winsWouldBeBlocked.length,
      improvesQuality: sim.improvesQuality,
    },
    null,
    2
  )
);
