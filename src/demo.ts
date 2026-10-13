import path from "node:path";
import type { DashboardState } from "./shared/types.js";

export function demoState(): DashboardState {
  const session = {
    id: "demo-cafe-website", projectName: "Update the café website", projectPath: path.resolve("cafe-website"), agent: "Demo assistant",
    status: "running" as const, startedAt: "2026-01-15T10:00:00.000Z", endedAt: null, simulated: true,
  };
  return {
    sessions: [session],
    events: [
      { id: "demo-cafe-start", sessionId: session.id, timestamp: session.startedAt, eventType: "session_start", toolName: null, input: { demo: { title: "Started updating the website", description: "The demo assistant is adding the café's new opening hours." } }, decision: "observed", ruleId: null, reason: null, simulated: true },
      { id: "demo-cafe-read", sessionId: session.id, timestamp: "2026-01-15T10:00:04.000Z", eventType: "tool_attempt", toolName: "exec_command", input: { cmd: "cat website-draft.txt", demo: { title: "Opened the website draft", description: "The assistant asked to read the draft before making changes." } }, decision: "allowed", ruleId: null, reason: null, simulated: true },
      { id: "demo-cafe-result", sessionId: session.id, timestamp: "2026-01-15T10:00:05.000Z", eventType: "tool_result", toolName: "exec_command", input: { cmd: "cat website-draft.txt", demo: { title: "Read the opening hours", description: "The draft lists the café's opening hours and contact details." } }, decision: "allowed", ruleId: null, reason: null, simulated: true },
    ],
    findings: [{
      id: "demo-cafe-password", sessionId: session.id, eventId: null, severity: "high", source: "Password check", title: "A password is in the website draft", resource: "website-draft.txt", status: "open",
      evidence: "In this fictional example, a security check found a password in a draft that could be published on the website. The password value is not shown.",
      remediation: "Remove the password from the draft and change it before publishing the website.", createdAt: "2026-01-15T10:00:06.000Z", simulated: true,
    }],
    coverage: [
      { id: `${session.id}:gitleaks`, sessionId: session.id, name: "Password check", status: "active", version: "Demo", summary: "Demo result: one password needs removing from the website draft.", lastError: null, lastRunAt: "2026-01-15T10:00:06.000Z" },
      { id: `${session.id}:protected-read`, sessionId: session.id, name: "Private files", status: "active", version: "Demo", summary: "Demo only: the private-file rule is enabled for supported direct file reads.", lastError: null, lastRunAt: session.startedAt },
      { id: `${session.id}:bash-gap`, sessionId: session.id, name: "Other ways to open files", status: "unsupported", version: "Demo", summary: "The private-file rule does not cover every way of opening files.", lastError: null, lastRunAt: null },
      { id: `${session.id}:mcp-gap`, sessionId: session.id, name: "Connected apps", status: "unsupported", version: "Demo", summary: "The private-file rule does not cover connected apps.", lastError: null, lastRunAt: null },
    ],
  };
}
