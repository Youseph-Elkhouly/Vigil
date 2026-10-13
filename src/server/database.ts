import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CoverageItem, DashboardState, Finding, Session, VigilEvent } from "../shared/types.js";
import { redact } from "./redaction.js";
import type { SecurityMap } from "../shared/giotto.js";

export class VigilDatabase {
  private db: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, project_path TEXT NOT NULL, project_name TEXT NOT NULL, agent TEXT NOT NULL,
        status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, simulated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp TEXT NOT NULL, event_type TEXT NOT NULL,
        tool_name TEXT, input_json TEXT NOT NULL, decision TEXT NOT NULL, rule_id TEXT, reason TEXT,
        simulated INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY, session_id TEXT, event_id TEXT, severity TEXT NOT NULL, source TEXT NOT NULL,
        title TEXT NOT NULL, resource TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT NOT NULL,
        remediation TEXT NOT NULL, created_at TEXT NOT NULL, simulated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS coverage (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, version TEXT, summary TEXT NOT NULL,
        last_error TEXT, last_run_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
      CREATE TABLE IF NOT EXISTS security_maps (session_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);
    `);
    const coverageColumns = this.db.prepare("PRAGMA table_info(coverage)").all();
    if (!coverageColumns.some((column) => column.name === "session_id")) {
      this.db.exec("ALTER TABLE coverage ADD COLUMN session_id TEXT");
    }
    if (!this.db.prepare("PRAGMA table_info(events)").all().some(c=>c.name==="tool_use_id")) this.db.exec("ALTER TABLE events ADD COLUMN tool_use_id TEXT");
  }

  upsertSession(session: Session): void {
    this.db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET project_path=excluded.project_path,project_name=excluded.project_name,
      agent=excluded.agent,status=excluded.status,started_at=excluded.started_at,ended_at=excluded.ended_at,
      simulated=excluded.simulated`)
      .run(session.id, session.projectPath, session.projectName, session.agent, session.status, session.startedAt, session.endedAt, Number(session.simulated));
  }

  addEvent(event: VigilEvent): void {
    event = redact(event);
    this.db.prepare("INSERT OR IGNORE INTO events (id,session_id,timestamp,event_type,tool_name,input_json,decision,rule_id,reason,simulated,tool_use_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.sessionId, event.timestamp, event.eventType, event.toolName, JSON.stringify(event.input), event.decision, event.ruleId, event.reason, Number(event.simulated),event.toolUseId??null);
  }

  addFinding(finding: Finding): void {
    finding = redact(finding);
    this.db.prepare("INSERT OR IGNORE INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(finding.id, finding.sessionId, finding.eventId, finding.severity, finding.source, finding.title, finding.resource, finding.status, finding.evidence, finding.remediation, finding.createdAt, Number(finding.simulated));
  }

  upsertCoverage(item: CoverageItem): void {
    this.db.prepare(`INSERT INTO coverage (id,name,status,version,summary,last_error,last_run_at,session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,version=excluded.version,
      summary=excluded.summary,last_error=excluded.last_error,last_run_at=excluded.last_run_at,session_id=excluded.session_id`)
      .run(item.id, item.name, item.status, item.version, item.summary, item.lastError, item.lastRunAt, item.sessionId ?? null);
  }

  state(): DashboardState {
    const sessions = this.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100").all().map(mapSession);
    const events = this.db.prepare("SELECT * FROM events ORDER BY timestamp DESC LIMIT 1000").all().map(mapEvent).reverse();
    const findings = this.db.prepare("SELECT * FROM findings ORDER BY created_at DESC LIMIT 500").all().map(mapFinding);
    const coverage = this.db.prepare("SELECT * FROM coverage ORDER BY name").all().map(mapCoverage);
    return { sessions, events, findings, coverage };
  }

  sessionEvidence(id: string): DashboardState {
    const sessions = this.db.prepare("SELECT * FROM sessions WHERE id=?").all(id).map(mapSession);
    const events = this.db.prepare("SELECT * FROM events WHERE session_id=? ORDER BY timestamp DESC, id DESC LIMIT 5000").all(id).map(mapEvent).reverse();
    const findings = this.db.prepare("SELECT * FROM findings WHERE session_id=? ORDER BY created_at DESC LIMIT 1000").all(id).map(mapFinding);
    return {sessions,events,findings,coverage:[]};
  }

  saveSecurityMap(map: SecurityMap): void {
    this.db.prepare("INSERT INTO security_maps VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET snapshot_json=excluded.snapshot_json").run(map.sessionId,JSON.stringify(redact(map)));
  }

  securityMapSnapshot(id: string): SecurityMap | null {
    const row=this.db.prepare("SELECT snapshot_json FROM security_maps WHERE session_id=?").get(id);
    return row ? JSON.parse(String(row.snapshot_json)) as SecurityMap : null;
  }

  close(): void { this.db.close(); }
}

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => row[key] as string;
const nullable = (row: Row, key: string) => (row[key] == null ? null : String(row[key]));
function mapSession(row: Row): Session { return { id: text(row,"id"), projectPath:text(row,"project_path"), projectName:text(row,"project_name"), agent:text(row,"agent"), status:text(row,"status") as Session["status"], startedAt:text(row,"started_at"), endedAt:nullable(row,"ended_at"), simulated:Boolean(row.simulated) }; }
function mapEvent(row: Row): VigilEvent { return { id:text(row,"id"), toolUseId:nullable(row,"tool_use_id"), sessionId:text(row,"session_id"), timestamp:text(row,"timestamp"), eventType:text(row,"event_type") as VigilEvent["eventType"], toolName:nullable(row,"tool_name"), input:JSON.parse(text(row,"input_json")), decision:text(row,"decision") as VigilEvent["decision"], ruleId:nullable(row,"rule_id"), reason:nullable(row,"reason"), simulated:Boolean(row.simulated) }; }
function mapFinding(row: Row): Finding { return { id:text(row,"id"), sessionId:nullable(row,"session_id"), eventId:nullable(row,"event_id"), severity:text(row,"severity") as Finding["severity"], source:text(row,"source"), title:text(row,"title"), resource:text(row,"resource"), status:text(row,"status") as Finding["status"], evidence:text(row,"evidence"), remediation:text(row,"remediation"), createdAt:text(row,"created_at"), simulated:Boolean(row.simulated) }; }
function mapCoverage(row: Row): CoverageItem { return { id:text(row,"id"), sessionId:nullable(row,"session_id"), name:text(row,"name"), status:text(row,"status") as CoverageItem["status"], version:nullable(row,"version"), summary:text(row,"summary"), lastError:nullable(row,"last_error"), lastRunAt:nullable(row,"last_run_at") }; }
