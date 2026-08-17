import { createSimulatorStore } from "./lib/store.js";
import { mountSimulatorWorkspace } from "./components/workspace.js";

const root = document.getElementById("sv-workspace");
if (root) {
  mountSimulatorWorkspace(createSimulatorStore());
}
