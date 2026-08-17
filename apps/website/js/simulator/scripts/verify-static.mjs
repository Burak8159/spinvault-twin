#!/usr/bin/env node
/**
 * Static "build" check for the vanilla Twin workspace.
 * There is no bundler; this verifies the shell entrypoints exist.
 */

import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const websiteRoot = fileURLToPath(new URL("../../..", import.meta.url));
const required = [
  "simulator.html",
  "simulator.css",
  "js/simulator/main.js",
  "js/simulator/lib/types.d.ts",
  "js/simulator/lib/defaults.js",
  "js/simulator/lib/fieldMetadata.js",
  "js/simulator/lib/validation.js",
  "js/simulator/lib/mockResults.js",
  "js/simulator/lib/units.js",
  "js/simulator/lib/store.js",
  "js/simulator/lib/statusCopy.js",
  "js/simulator/lib/charts.js",
  "js/simulator/lib/resultView.js",
  "js/simulator/lib/playback.js",
  "js/simulator/lib/frameView.js",
  "js/simulator/lib/spinCellModel.js",
  "js/simulator/lib/tunnelingModel.js",
  "js/simulator/lib/quantumTransportView.js",
  "js/simulator/lib/paths.js",
  "js/simulator/components/scientificBoard.js",
  "js/simulator/components/mumax3FrameAnimator.js",
  "js/simulator/components/mtjViewportLayout.js",
  "js/simulator/components/spinView.js",
  "js/simulator/components/waveView.js",
  "js/simulator/components/twinViewport.js",
  "js/simulator/components/workspace.js",
  "js/simulator/components/viewport.js",
  "js/api/client.js",
  "js/api/demoClient.js",
  "js/api/config.js",
  "js/api/serialize.js",
  "js/api/remoteClient.js",
  "js/api/jobMapper.js"
];

for (const file of required) {
  accessSync(join(websiteRoot, file), constants.R_OK);
}

console.log("Static simulator shell verified. No physics bundle is produced.");
