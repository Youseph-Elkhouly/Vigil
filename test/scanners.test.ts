import test from "node:test";
import assert from "node:assert/strict";
import { parseGitleaksReport } from "../src/server/scanners/gitleaks.js";
import { parseSnykAgentScanJson } from "../src/server/scanners/snyk-agent-scan.js";
import { runProcess, processError } from "../src/server/scanners/process.js";

test("Gitleaks imports findings without secret values", () => {
  const secret = "ghp_000000000000000000000000000000000000";
  const findings = parseGitleaksReport(JSON.stringify([{ RuleID: "github", Description: `Found ${secret}`, File: "secret.env", StartLine: 2, Secret: secret, Match: `TOKEN=${secret}` }]), "session");
  assert.equal(findings.length, 1);
  assert.doesNotMatch(JSON.stringify(findings), /ghp_000/);
  assert.match(JSON.stringify(findings), /REDACTED/);
});

test("Snyk JSON import is bounded to selected fields", () => {
  const findings = parseSnykAgentScanJson(JSON.stringify({ issues: [{ id: "MCP-1", title: "Unsafe MCP", severity: "high", component: "demo-server", token: "should-not-survive" }] }), "session");
  assert.equal(findings[0]?.severity, "high");
  assert.doesNotMatch(JSON.stringify(findings), /should-not-survive/);
});

test("subprocess failures stay distinguishable from clean output", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stderr.write('scanner failed'); process.exit(7)"]);
  assert.equal(result.code, 7);
  assert.match(processError(result, "fallback"), /scanner failed/);
});
