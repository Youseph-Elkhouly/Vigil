import type { IntegrationStatus, ScannerAdapter } from "../../shared/types";

function placeholder(
  id: string,
  name: string,
  status: Extract<IntegrationStatus, "not_installed" | "not_configured" | "unsupported">,
  summary: string,
): ScannerAdapter {
  return {
    id,
    name,
    async checkAvailability() {
      return { status, version: null, error: summary };
    },
    async scan() {
      return { status, version: null, findings: [], error: summary };
    },
  };
}

export const lassoAdapter = placeholder(
  "lasso",
  "Lasso",
  "not_installed",
  "Lasso scanner integration is not installed",
);

export const semgrepAdapter = placeholder(
  "semgrep",
  "Semgrep",
  "not_installed",
  "Semgrep scanner integration is not installed",
);

export const dockerSandboxesAdapter = placeholder(
  "docker-sandboxes",
  "Docker Sandboxes",
  "unsupported",
  "Docker Sandboxes scanning is not supported by this version",
);

export const langfuseAdapter = placeholder(
  "langfuse",
  "Langfuse",
  "not_configured",
  "Langfuse credentials and endpoint are not configured",
);
