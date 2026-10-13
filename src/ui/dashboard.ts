import type { DashboardState, Session } from "../shared/types";

export type SessionColumn = "Running" | "Completed" | "Vulnerable";

export function sessionColumn(session: Session, findings: DashboardState["findings"]): SessionColumn {
  if (findings.some(finding => finding.sessionId === session.id && finding.status !== "resolved" && finding.severity !== "info")) return "Vulnerable";
  return session.status === "ended" || session.status === "failed" ? "Completed" : "Running";
}

export function sessionCode(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function sessionTone(id: string): number {
  return [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 5;
}

export function dashboardScope(state: DashboardState, sessionId: string | null) {
  return {
    sessions: state.sessions.filter((item) => !sessionId || item.id === sessionId),
    events: state.events.filter((item) => !sessionId || item.sessionId === sessionId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    findings: state.findings.filter((item) => !sessionId || item.sessionId === sessionId),
    coverage: state.coverage.filter((item) => !sessionId || item.sessionId === sessionId),
  };
}
