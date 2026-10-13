import type { DashboardState } from "../shared/types";

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
