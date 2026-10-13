import type { ScannerAdapter } from "../../shared/types";
import { gitleaksAdapter } from "./gitleaks";
import {
  dockerSandboxesAdapter,
  langfuseAdapter,
  lassoAdapter,
  semgrepAdapter,
} from "./placeholders";
import { snykAgentScanAdapter } from "./snyk-agent-scan";

export { gitleaksAdapter, parseGitleaksReport } from "./gitleaks";
export { runProcess, safeText } from "./process";
export {
  dockerSandboxesAdapter,
  langfuseAdapter,
  lassoAdapter,
  semgrepAdapter,
} from "./placeholders";
export {
  parseSnykAgentScanJson,
  parseSnykAgentScanReport,
  snykAgentScanAdapter,
} from "./snyk-agent-scan";

export const scannerAdapters: readonly ScannerAdapter[] = Object.freeze([
  gitleaksAdapter,
  snykAgentScanAdapter,
  lassoAdapter,
  semgrepAdapter,
  dockerSandboxesAdapter,
  langfuseAdapter,
]);

export const scannerRegistry: ReadonlyMap<string, ScannerAdapter> = new Map(
  scannerAdapters.map((adapter) => [adapter.id, adapter]),
);

export function getScannerAdapter(id: string): ScannerAdapter | undefined {
  return scannerRegistry.get(id);
}

export async function checkScannerAvailability() {
  return Promise.all(scannerAdapters.map(async (adapter) => ({
    id: adapter.id,
    name: adapter.name,
    ...await adapter.checkAvailability(),
  })));
}
