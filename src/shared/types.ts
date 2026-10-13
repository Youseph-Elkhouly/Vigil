export type EventType = "session_start" | "tool_attempt" | "tool_result" | "session_end";
export type Decision = "allowed" | "denied" | "observed" | "error";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type IntegrationStatus = "active" | "checking" | "not_installed" | "not_configured" | "failed" | "unsupported";

export interface VigilEvent {
  id: string;
  toolUseId?: string | null;
  sessionId: string;
  timestamp: string;
  eventType: EventType;
  toolName: string | null;
  input: unknown;
  decision: Decision;
  ruleId: string | null;
  reason: string | null;
  simulated: boolean;
}

export interface Session {
  id: string;
  projectPath: string;
  projectName: string;
  agent: string;
  status: "starting" | "running" | "ended" | "failed" | "simulated";
  startedAt: string;
  endedAt: string | null;
  simulated: boolean;
}

export interface Finding {
  id: string;
  sessionId: string | null;
  eventId: string | null;
  severity: Severity;
  source: string;
  title: string;
  resource: string;
  status: "open" | "acknowledged" | "resolved";
  evidence: string;
  remediation: string;
  createdAt: string;
  simulated: boolean;
}

export interface CoverageItem {
  id: string;
  sessionId?: string | null;
  name: string;
  status: IntegrationStatus;
  version: string | null;
  summary: string;
  lastError: string | null;
  lastRunAt: string | null;
}

export interface DashboardState {
  sessions: Session[];
  events: VigilEvent[];
  findings: Finding[];
  coverage: CoverageItem[];
}

export interface ProtectedPathPolicy {
  protectedPaths: string[];
}

export interface ScannerResult {
  status: IntegrationStatus;
  version: string | null;
  findings: Omit<Finding, "id" | "createdAt">[];
  error: string | null;
}

export interface ScannerAdapter {
  id: string;
  name: string;
  checkAvailability(): Promise<{ status: IntegrationStatus; version: string | null; error: string | null }>;
  scan(projectPath: string, sessionId: string): Promise<ScannerResult>;
}
