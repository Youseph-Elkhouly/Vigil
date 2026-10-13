import path from "node:path";
import type { DashboardState, VigilEvent } from "./shared/types.js";

/** Fixed, fictional examples. No files are read and no agent actions are executed. */
export function demoState(root = path.resolve("demo")): DashboardState {
  const sessions: DashboardState["sessions"] = [
    { id: "demo-birthday", projectName: "Plan a birthday party", projectPath: path.join(root, "birthday-party"), agent: "Example assistant", status: "running", startedAt: "2026-01-15T10:00:00.000Z", endedAt: null, simulated: true },
    { id: "demo-photos", projectName: "Sort holiday photos", projectPath: path.join(root, "holiday-photos"), agent: "Example assistant", status: "ended", startedAt: "2026-01-15T09:00:00.000Z", endedAt: "2026-01-15T09:05:00.000Z", simulated: true },
    { id: "demo-newsletter", projectName: "Write a school newsletter", projectPath: path.join(root, "school-newsletter"), agent: "Example assistant", status: "failed", startedAt: "2026-01-15T09:30:00.000Z", endedAt: "2026-01-15T09:31:00.000Z", simulated: true },
  ];
  const event = (sessionIndex: number, id: string, timestamp: string, title: string, description: string, extra: Partial<VigilEvent> = {}): VigilEvent => ({
    id, sessionId: sessions[sessionIndex]!.id, timestamp, eventType: "tool_result", toolName: "exec_command", input: { demo: { title, description } }, decision: "allowed", ruleId: null, reason: null, simulated: true, ...extra,
  });
  const events = [
    event(0, "demo-birthday-start", "2026-01-15T10:00:00.000Z", "Started planning the party", "The example assistant began with your party notes.", { eventType: "session_start", toolName: null, decision: "observed" }),
    event(0, "demo-birthday-notes", "2026-01-15T10:00:04.000Z", "Read the party notes", "The notes list the date, venue, and food ideas."),
    event(0, "demo-birthday-private", "2026-01-15T10:00:08.000Z", "Blocked access to a private guest list", "The guest list contains home addresses. It is marked private, so the example assistant could not read it.", { eventType: "tool_attempt", decision: "denied", ruleId: "VIGIL-CODEX-PATH-001", reason: "The guest list is marked private.", input: { cmd: "cat private/guest-list.csv", demo: { title: "Blocked access to a private guest list", description: "The guest list contains home addresses. It is marked private, so the example assistant could not read it." } } }),
    event(1, "demo-photos-start", "2026-01-15T09:00:00.000Z", "Started sorting the photos", "The example assistant began organizing the holiday album.", { eventType: "session_start", toolName: null, decision: "observed" }),
    event(1, "demo-photos-sort", "2026-01-15T09:04:00.000Z", "Grouped the photos by day", "The example album now has a folder for each day of the holiday."),
    event(1, "demo-photos-end", "2026-01-15T09:05:00.000Z", "Finished sorting the photos", "The example task is complete.", { eventType: "session_end", toolName: null, decision: "observed" }),
    event(2, "demo-newsletter-start", "2026-01-15T09:30:00.000Z", "Started the newsletter", "The example assistant looked for this week's school notes.", { eventType: "session_start", toolName: null, decision: "observed" }),
    event(2, "demo-newsletter-missing", "2026-01-15T09:30:30.000Z", "Could not find the school notes", "The notes file is missing. Add it before asking the assistant to try again.", { decision: "error", reason: "school-notes.txt was not found." }),
    event(2, "demo-newsletter-end", "2026-01-15T09:31:00.000Z", "Stopped until the notes are added", "The newsletter has not been written yet.", { eventType: "session_end", toolName: null, decision: "observed" }),
  ];
  const findings: DashboardState["findings"] = [
    { id: "demo-private-list", sessionId: sessions[0]!.id, eventId: "demo-birthday-private", severity: "high", source: "Private-file check", title: "The guest list is private", resource: "private/guest-list.csv", status: "open", evidence: "The example assistant tried to read home addresses from a file marked private. Access was blocked.", remediation: "Give the assistant a separate list with first names only. Keep home addresses in the private file.", createdAt: "2026-01-15T10:00:08.000Z", simulated: true },
    { id: "demo-missing-notes", sessionId: sessions[2]!.id, eventId: "demo-newsletter-missing", severity: "low", source: "Example task", title: "The school notes are missing", resource: "school-notes.txt", status: "open", evidence: "The example assistant could not find the notes it needs to write the newsletter. This is a task problem, not a security alert.", remediation: "Add this week's school notes, then start the task again.", createdAt: "2026-01-15T09:30:30.000Z", simulated: true },
  ];
  const coverage: DashboardState["coverage"] = sessions.flatMap((session) => [
    { id: `${session.id}:protected-read`, sessionId: session.id, name: "Private files", status: "active" as const, version: "Example", summary: "Example: the private-file rule is on. It blocks supported direct file reads, including the guest-list request shown here.", lastError: null, lastRunAt: session.startedAt },
    { id: `${session.id}:bash-gap`, sessionId: session.id, name: "Other ways to open files", status: "unsupported" as const, version: "Example", summary: "Example: this rule does not cover scripts or other indirect ways of opening files.", lastError: null, lastRunAt: null },
    { id: `${session.id}:mcp-gap`, sessionId: session.id, name: "Connected apps", status: "unsupported" as const, version: "Example", summary: "Example: the private-file rule does not cover connected apps.", lastError: null, lastRunAt: null },
  ]);
  return { sessions, events, findings, coverage };
}
