import test from "node:test";
import assert from "node:assert/strict";
import type { DashboardState, Session, VigilEvent, CoverageItem } from "../src/shared/types.js";
import { dashboardScope, sessionCode } from "../src/ui/dashboard.js";

test("all-session overview interleaves events and filters every section by the same session", () => {
  const session: Session = { id: "session-a", projectName: "shared-project", projectPath: "/project", agent: "Codex", status: "running", startedAt: "2026-01-01T00:00:00Z", endedAt: null, simulated: false };
  const event: VigilEvent = { id: "event-a", sessionId: session.id, timestamp: "2026-01-01T00:00:01Z", eventType: "tool_attempt", toolName: "exec_command", input: {}, decision: "allowed", ruleId: null, reason: null, simulated: false };
  const check: CoverageItem = { id: "session-a:gitleaks", sessionId: session.id, name: "Gitleaks", status: "active", version: null, summary: "Clean", lastError: null, lastRunAt: null };
  const state: DashboardState = {
    sessions: [session, { ...session, id: "session-b" }],
    events: [event, { ...event, id: "event-b", sessionId: "session-b", timestamp: "2026-01-01T00:00:02Z", decision: "denied" }],
    findings: [{ id: "finding-b", sessionId: "session-b", eventId: "event-b", severity: "high", source: "Policy", title: "Denied", resource: "secrets", status: "open", evidence: "Denied read", remediation: "Review", createdAt: event.timestamp, simulated: false }],
    coverage: [check, { ...check, id: "session-b:gitleaks", sessionId: "session-b", status: "checking" }, { ...check, id: "legacy", sessionId: null }],
  };
  const all = dashboardScope(state, null);
  assert.deepEqual(all.events.map((item) => item.id), ["event-b", "event-a"]);
  assert.equal(all.coverage.length, 3);
  const selected = dashboardScope(state, "session-b");
  assert.deepEqual(selected.sessions.map((item) => item.id), ["session-b"]);
  assert.deepEqual(selected.events.map((item) => item.id), ["event-b"]);
  assert.deepEqual(selected.findings.map((item) => item.id), ["finding-b"]);
  assert.deepEqual(selected.coverage.map((item) => item.id), ["session-b:gitleaks"]);
  assert.deepEqual(state.events.map((item) => item.id), ["event-a", "event-b"]);
  assert.notEqual(sessionCode("codex-session-0001"), sessionCode("codex-session-0002"));
});

test("board keeps each session in one column and prioritizes unresolved security findings", async () => {
  const { sessionColumn } = await import("../src/ui/dashboard.js");
  const { demoState } = await import("../src/demo.js");
  const demo = demoState(), session = demo.sessions[0]!, issue = demo.findings[0]!;
  assert.equal(demo.sessions.length, 1);
  assert.equal(sessionColumn(session, []), "Running");
  assert.equal(sessionColumn({ ...session, status: "ended" }, []), "Completed");
  assert.equal(sessionColumn({ ...session, status: "failed" }, []), "Completed");
  assert.equal(sessionColumn(session, [issue]), "Vulnerable");
  assert.equal(sessionColumn({ ...session, status: "ended" }, [issue]), "Vulnerable");
  assert.equal(sessionColumn(session, [{ ...issue, status: "acknowledged" }]), "Vulnerable");
  assert.equal(sessionColumn(session, [{ ...issue, status: "resolved" }]), "Running");
  assert.equal(sessionColumn(session, [{ ...issue, severity: "info" }]), "Running");
  assert.equal(sessionColumn(session, [{ ...issue, sessionId: "another-session" }]), "Running");
  assert.ok(demo.events.every(event => event.sessionId === session.id && event.simulated));
  assert.ok(demo.findings.every(finding => finding.sessionId === session.id && finding.simulated));
});

test("friendly demo wording is used only for simulated events", async () => {
  const { demoState } = await import("../src/demo.js");
  const { activityTitle } = await import("../src/ui/labels.js");
  const event = demoState().events[1]!;
  assert.equal(activityTitle(event), "Opened the website draft");
  assert.equal(activityTitle({ ...event, simulated: false, decision: "denied" }), "Vigil blocked an action");
});
