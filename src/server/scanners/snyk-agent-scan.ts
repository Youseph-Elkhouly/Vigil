import type { Finding, ScannerAdapter, ScannerResult, Severity } from "../../shared/types";
import { redactString } from "../redaction";
import { processError, runProcess, safeText } from "./process";

const IMPORT_LIMIT = 20 * 1024 * 1024;
const MAX_FINDINGS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return safeText(redactString(value), 500);
  }
  return "";
}

function severity(value: unknown): Severity {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return (["critical", "high", "medium", "low", "info"] as const).includes(normalized as Severity)
    ? normalized as Severity
    : "medium";
}

function candidateIssues(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) throw new Error("Snyk import root must be an object or array");
  const collected: unknown[] = [];
  let foundCollection = false;
  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++visited > 50_000) throw new Error("Snyk import is too complex");
    if (depth > 8) throw new Error("Snyk import nesting exceeds limit");
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "issues" || key === "vulnerabilities" || key === "findings") && Array.isArray(child)) {
        foundCollection = true;
        collected.push(...child);
        if (collected.length > MAX_FINDINGS) throw new Error("Snyk import contains too many findings");
      } else if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  if (!foundCollection) throw new Error("Snyk import has no recognized findings collection");
  return collected;
}

/**
 * Parse an already-produced Snyk Agent Scan JSON document. No commands, paths,
 * or URLs from the document are executed or opened.
 */
export function parseSnykAgentScanJson(document: string, sessionId: string): ScannerResult["findings"] {
  if (Buffer.byteLength(document, "utf8") > IMPORT_LIMIT) throw new Error("Snyk import exceeds size limit");
  const root: unknown = JSON.parse(document);
  const issues = candidateIssues(root);
  if (issues.length > MAX_FINDINGS) throw new Error("Snyk import contains too many findings");

  return issues.map((value, index) => {
    if (!isRecord(value)) throw new Error(`Invalid Snyk finding at index ${index}`);
    const title = stringField(value, "title", "name", "issueType") || "Snyk finding";
    const issueId = stringField(value, "id", "issueId", "ruleId", "type");
    const packageName = stringField(value, "packageName", "package", "component", "targetFile");
    const packageVersion = stringField(value, "version", "packageVersion");
    const resource = packageName
      ? `${packageName}${packageVersion ? `@${packageVersion}` : ""}`
      : (issueId || "imported result");
    // Do not retain arbitrary descriptions, paths, request data, or raw JSON: imported
    // reports can contain credentials in unexpected extension fields.
    return {
      sessionId,
      eventId: null,
      severity: severity(value.severity),
      source: "snyk-agent-scan",
      title: issueId ? `${title} (${issueId})` : title,
      resource,
      status: "open" as const,
      evidence: "Imported from Snyk Agent Scan JSON; sensitive report fields omitted.",
      remediation: "Review the issue in Snyk and apply the recommended upgrade or mitigation.",
      simulated: false,
    } satisfies Omit<Finding, "id" | "createdAt">;
  });
}

export const parseSnykAgentScanReport = parseSnykAgentScanJson;

function parseVersion(output: string): string | null {
  return safeText(output, 200).match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

export const snykAgentScanAdapter: ScannerAdapter = {
  id: "snyk-agent-scan",
  name: "Snyk Agent Scan",

  async checkAvailability() {
    const result = await runProcess("snyk-agent-scan", ["--version"]);
    if (result.error?.code === "ENOENT") return { status: "not_installed", version: null, error: null };
    if (result.code !== 0 || result.timedOut) {
      return { status: "failed", version: parseVersion(result.stdout), error: processError(result, "Unable to determine Snyk Agent Scan version") };
    }
    const version = parseVersion(result.stdout || result.stderr);
    if (!process.env.SNYK_TOKEN) {
      return { status: "not_configured", version, error: "SNYK_TOKEN is not configured" };
    }
    return {
      status: "unsupported",
      version,
      error: "Installed Snyk Agent Scan versions are import-only until their scan behavior is explicitly supported",
    };
  },

  async scan(_projectPath: string, _sessionId: string): Promise<ScannerResult> {
    const availability = await this.checkAvailability();
    return { ...availability, findings: [] };
  },
};
