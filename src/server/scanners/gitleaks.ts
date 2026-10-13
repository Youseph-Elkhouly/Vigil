import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, ScannerAdapter, ScannerResult, Severity } from "../../shared/types";
import { redactString } from "../redaction";
import { processError, runProcess, safeText } from "./process";

const REPORT_LIMIT = 20 * 1024 * 1024;
const MAX_FINDINGS = 10_000;

interface GitleaksRecord {
  RuleID?: unknown;
  Description?: unknown;
  File?: unknown;
  StartLine?: unknown;
  Secret?: unknown;
  Match?: unknown;
}

function failed(version: string | null, error: string): ScannerResult {
  return { status: "failed", version, findings: [], error };
}

function parseVersion(output: string): string | null {
  const match = safeText(output, 200).match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGitleaksReport(report: string, sessionId: string): ScannerResult["findings"] {
  if (Buffer.byteLength(report, "utf8") > REPORT_LIMIT) throw new Error("Gitleaks report exceeds size limit");
  const parsed: unknown = JSON.parse(report);
  if (!Array.isArray(parsed)) throw new Error("Gitleaks report is not an array");
  if (parsed.length > MAX_FINDINGS) throw new Error("Gitleaks report contains too many findings");

  return parsed.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Invalid Gitleaks finding at index ${index}`);
    const record: GitleaksRecord = raw;
    const secretValues = [record.Secret, record.Match]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort((left, right) => right.length - left.length);
    const redact = (value: unknown, limit: number): string => {
      let text = typeof value === "string" ? value : "";
      for (const secret of secretValues) text = text.split(secret).join("[REDACTED]");
      return safeText(redactString(text), limit);
    };
    const rule = redact(record.RuleID, 120) || "secret";
    const description = redact(record.Description, 200) || "Potential secret detected";
    const file = redact(record.File, 1_000) || "unknown file";
    const line = typeof record.StartLine === "number" && Number.isSafeInteger(record.StartLine)
      ? `:${record.StartLine}`
      : "";
    // Deliberately do not copy Secret, Match, fingerprint, commit message, or raw tool output.
    return {
      sessionId,
      eventId: null,
      severity: "high" as Severity,
      source: "gitleaks",
      title: `${description} (${rule})`,
      resource: `${file}${line}`,
      status: "open" as const,
      evidence: "Secret value redacted; see the local source location.",
      remediation: "Remove the secret, rotate the credential, and purge it from version history if committed.",
      simulated: false,
    } satisfies Omit<Finding, "id" | "createdAt">;
  });
}

export const gitleaksAdapter: ScannerAdapter = {
  id: "gitleaks",
  name: "Gitleaks",

  async checkAvailability() {
    const result = await runProcess("gitleaks", ["version"]);
    if (result.error?.code === "ENOENT") {
      return { status: "not_installed", version: null, error: null };
    }
    if (result.code !== 0 || result.timedOut) {
      return { status: "failed", version: parseVersion(result.stdout), error: processError(result, "Unable to determine Gitleaks version") };
    }
    return { status: "active", version: parseVersion(result.stdout || result.stderr), error: null };
  },

  async scan(projectPath: string, sessionId: string): Promise<ScannerResult> {
    const availability = await this.checkAvailability();
    if (availability.status !== "active") return { ...availability, findings: [] };

    try {
      const project = await stat(projectPath);
      if (!project.isDirectory()) return failed(availability.version, "Selected project path is not a directory");
    } catch {
      return failed(availability.version, "Selected project directory is unavailable");
    }

    let tempDirectory: string;
    try {
      tempDirectory = await mkdtemp(join(tmpdir(), "vigil-gitleaks-"));
    } catch (error) {
      return failed(availability.version, `Unable to create temporary report directory: ${safeText((error as Error).message)}`);
    }
    const reportPath = join(tempDirectory, "report.json");
    try {
      // `dir` is the supported filesystem scan command in current Gitleaks versions.
      const result = await runProcess("gitleaks", [
        "dir", projectPath,
        "--report-format", "json",
        "--report-path", reportPath,
        "--redact",
        "--no-banner",
      ], { timeoutMs: 5 * 60_000 });

      if (result.error || result.timedOut || (result.code !== 0 && result.code !== 1)) {
        return failed(availability.version, processError(result, "Gitleaks scan failed"));
      }

      let report = "[]";
      try {
        const info = await stat(reportPath);
        if (info.size > REPORT_LIMIT) return failed(availability.version, "Gitleaks report exceeds size limit");
        report = await readFile(reportPath, "utf8");
      } catch (error) {
        if (result.code === 0) return { status: "active", version: availability.version, findings: [], error: null };
        return failed(availability.version, `Gitleaks did not produce a readable report: ${safeText((error as Error).message)}`);
      }

      try {
        const findings = parseGitleaksReport(report, sessionId);
        return { status: "active", version: availability.version, findings, error: null };
      } catch (error) {
        return failed(availability.version, `Invalid Gitleaks report: ${safeText((error as Error).message)}`);
      }
    } finally {
      // Cleanup failure must not expose a report path or replace the scan result.
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
