import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  CoverageItem,
  DashboardState,
  Finding,
  Session,
  Severity,
  VigilEvent,
} from "../shared/types";
import { dashboardScope } from "./dashboard";
import { activityTitle, activityExplanation, checkCopy, sessionStatus } from "./labels";
import type { EvidenceLink } from "../shared/giotto";
import { SecurityMapView } from "./SecurityMap";

const EMPTY_STATE: DashboardState = { sessions: [], events: [], findings: [], coverage: [] };

const severityRank: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function relativeTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  const seconds = Math.round((date.valueOf() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function exactTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function SessionTag({ id, sessions, onSelect }: { id: string | null | undefined; sessions: Session[]; onSelect?: (id: string) => void }) {
  const session = sessions.find((item) => item.id === id);
  const label = id ? `${session?.projectName || "Unknown project"}${session ? ` · ${exactTime(session.startedAt)}` : ""}${session?.simulated ? " · Simulated" : ""}` : "Session not recorded";
  const title = session ? `${session.projectPath}\n${session.agent}\nStarted ${exactTime(session.startedAt)}\n${session.id}` : id || "No session recorded";
  return onSelect && id && session ? (
    <button type="button" className="session-tag" title={title} onClick={() => onSelect(id)} aria-label={`Show session ${label}`}>{label}</button>
  ) : <span className="session-tag" title={title}>{label}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

function SessionBoard({ state, onSelect }: { state: DashboardState; onSelect: (id: string) => void }) {
  const columns: { title: string; statuses: Session["status"][] }[] = [
    { title: "Working", statuses: ["starting", "running", "simulated"] },
    { title: "Done", statuses: ["ended"] },
    { title: "Stopped", statuses: ["failed"] },
  ];
  if (!state.sessions.length) return <Empty>No sessions yet. Start a monitored agent session to see it here.</Empty>;
  return (
    <div className="session-board">
      {columns.map(({ title, statuses }) => {
        const sessions = state.sessions.filter((session) => statuses.includes(session.status))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return (
          <section className="board-column" key={title} aria-labelledby={`column-${title.replaceAll(" ", "-")}`}>
            <div className="board-column__heading"><h2 id={`column-${title.replaceAll(" ", "-")}`}>{title}</h2><span className="count">{sessions.length}</span></div>
            <div className="board-column__cards">
              {!sessions.length && <p className="board-empty">No {title.toLowerCase()} sessions</p>}
              {sessions.map((session) => {
                const openFindings = state.findings.filter((finding) => finding.sessionId === session.id && finding.status === "open").length;
                return (
                  <button type="button" className="session-card" key={session.id} id={`session-card-${session.id}`} onClick={() => onSelect(session.id)} aria-label={`Open ${session.projectName || "Unnamed project"} session started ${exactTime(session.startedAt)}`}>
                    <span className="session-card__top"><span className={`badge badge--${session.status}`}>{sessionStatus(session.status)}</span></span>
                    <strong className="session-card__name">{session.projectName || "Unnamed project"}</strong>
                    <span className="session-card__summary">{openFindings ? `${openFindings} ${openFindings === 1 ? "thing" : "things"} to review` : "Nothing to review"}</span>
                    <span className="session-card__bottom"><span>Open session</span><span aria-hidden="true">→</span></span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Timeline({ events, sessions, onSelect }: { events: VigilEvent[]; sessions: Session[]; onSelect: (id: string) => void }) {
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading timeline-heading">
        <div>
          <h2 id="timeline-title">What happened</h2>
        </div>
        <span className="count">{events.length} activities</span>
      </div>
      <div className="timeline" role="region" aria-label="Session activity" tabIndex={0}>
        {events.length === 0 ? (
          <Empty>No activity in this view. Start a monitored session to see its events here.</Empty>
        ) : (
          events.map((event) => (
            <article className="event" id={`event-${event.id}`} key={event.id} tabIndex={-1}>
              <div className={`event__marker event__marker--${event.decision}`} aria-hidden="true" />
              <div className="event__body">
                <div className="event__titleline">
                  <strong>{activityTitle(event)}</strong>
                  {(event.decision === "denied" || event.decision === "error") && <span className={`decision decision--${event.decision}`}>{event.decision === "denied" ? "Blocked" : "Stopped"}</span>}
                </div>
                <p className="event__reason">{activityExplanation(event)}</p>
                <details className="technical-details">
                  <summary>Technical details</summary>
                  <dl>
                    {event.toolName && <div><dt>Tool</dt><dd><code>{event.toolName}</code></dd></div>}
                    {event.reason && <div><dt>Reported reason</dt><dd>{event.reason}</dd></div>}
                    {event.ruleId && <div><dt>Rule</dt><dd><code>{event.ruleId}</code></dd></div>}
                    <div><dt>Recorded input or response</dt><dd><pre>{JSON.stringify(event.input, null, 2)}</pre></dd></div>
                  </dl>
                </details>
                {!event.simulated && <time dateTime={event.timestamp} title={exactTime(event.timestamp)}>
                  {relativeTime(event.timestamp)}
                </time>}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function FindingDetail({ finding, sessions, onClose, onShowEvent, onExplain }: { finding: Finding; sessions: Session[]; onClose: () => void; onShowEvent: (finding: Finding) => void; onExplain?: (finding: Finding) => void }) {
  return (
    <aside className="finding-detail" aria-labelledby="finding-detail-title">
      <div className="detail-heading">
        <span className="eyebrow">Needs attention</span>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close finding details">
          ×
        </button>
      </div>
      <h3 id="finding-detail-title">{finding.title}</h3>
      {finding.simulated && <div className="simulation-notice"><strong>Simulated issue</strong> — shown for demonstration. This is not a confirmed problem.</div>}
      {onExplain && finding.sessionId && <button type="button" className="text-button" onClick={() => onExplain(finding)}>Explain visually</button>}
      <dl>
        <div><dt>Affected file or tool</dt><dd><code>{finding.resource}</code></dd></div>
        <div><dt>Why it was flagged</dt><dd>{finding.title === "Protected path read denied" ? "The agent asked to read a file marked as protected. Vigil blocked the request." : finding.evidence || "No explanation was supplied."}</dd></div>
        <div><dt>What to do next</dt><dd>{finding.title === "Protected path read denied" ? "Check whether the agent needs this file. Keep private files outside its workspace, or review the protected-file settings if access is intentional." : finding.remediation || "No next step was supplied."}</dd></div>
        {finding.eventId && <div><dt>Related activity</dt><dd><button type="button" className="text-button" onClick={() => onShowEvent(finding)}>Show what happened</button></dd></div>}
      </dl>
      <details className="technical-details"><summary>Technical details</summary><p>Reported by: {finding.source}</p><p>Priority: {finding.severity} · Status: {finding.status}</p><p>{finding.evidence}</p><p>{finding.remediation}</p></details>
    </aside>
  );
}

function EventDetail({event, link}: {event: VigilEvent; link: EvidenceLink}) {
  return <aside className="finding-detail" aria-label="Event evidence">
    <h3>{activityTitle(event)}</h3>
    <span className={`decision decision--${event.decision}`}>{link.status === "completed_tool" ? "Tool returned; resource outcome unknown" : link.status}</span>
    {event.simulated && <div className="simulation-notice">Simulated event</div>}
    <dl>
      <div><dt>Evidence ID</dt><dd><code>{event.id}</code></dd></div>
      <div><dt>Affected resource reference</dt><dd>{link.resource ?? "Unavailable in this selection"}</dd></div>
      <div><dt>Policy decision</dt><dd>{event.decision} · {event.ruleId ?? "No rule recorded"}<p>{event.reason}</p></dd></div>
      <div><dt>Recorded tool data</dt><dd><pre>{JSON.stringify(event.input,null,2)}</pre></dd></div>
      <div><dt>Observed</dt><dd>{exactTime(event.timestamp)}</dd></div>
    </dl>
  </aside>;
}

function Findings({ findings, sessions, onSelect, onShowEvent, onExplain }: { findings: Finding[]; sessions: Session[]; onSelect: (id: string) => void; onShowEvent: (finding: Finding) => void; onExplain?: (finding: Finding) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...findings].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]),
    [findings],
  );
  const selected = findings.find((finding) => finding.id === selectedId);

  return (
    <section className="panel findings-panel" aria-labelledby="findings-title">
      <div className="panel-heading">
        <div><h2 id="findings-title">Needs attention</h2></div>
        <span className="count count--alert">{findings.filter((item) => item.status === "open").length} open</span>
      </div>
      <div className={`findings-layout ${selected ? "findings-layout--detail" : ""}`}>
        <div className="issue-list">
          {sorted.length === 0 ? <Empty>Nothing needs your attention here.</Empty> : sorted.map((finding) => (
            <button type="button" className="issue-row" key={finding.id} aria-expanded={selectedId === finding.id} onClick={() => setSelectedId(selectedId === finding.id ? null : finding.id)}>
              <strong>{finding.title}</strong><span>What to do <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
        {selected && <FindingDetail finding={selected} sessions={sessions} onClose={() => setSelectedId(null)} onShowEvent={onShowEvent} onExplain={onExplain} />}
      </div>
    </section>
  );
}

function Coverage({ items, sessions, onSelect }: { items: CoverageItem[]; sessions: Session[]; onSelect: (id: string) => void }) {
  const gaps = items.filter((item) => item.status !== "active" && item.status !== "checking");
  return (
    <section className="panel coverage-panel" aria-labelledby="coverage-title">
      <div className="panel-heading">
        <div><p className="eyebrow">Results for each session</p><h2 id="coverage-title">Security checks</h2></div>
        <span className={`count ${gaps.length ? "count--alert" : "count--ok"}`}>{items.filter((item) => item.status === "checking").length} checking · {gaps.length} {gaps.length === 1 ? "unavailable check" : "unavailable checks"}</span>
      </div>
      {gaps.length > 0 && <div className="gap-callout"><strong>Some checks are unavailable.</strong> Review the statuses below to see which activity may be unchecked.</div>}
      <div className="coverage-list">
        {items.length === 0 ? <Empty>No checks have been reported yet. We cannot tell what has been checked.</Empty> : items.map((item) => { const copy = checkCopy(item); return (
          <article className="coverage-item" key={item.id}>
            <SessionTag id={item.sessionId} sessions={sessions} onSelect={onSelect} />
            <div className="coverage-item__main">
              <span className={`coverage-icon coverage-icon--${item.status}`} aria-hidden="true">{item.status === "active" ? "✓" : item.status === "checking" ? "…" : "!"}</span>
              <div><strong>{copy.name}</strong><p>{copy.description}</p></div>
            </div>
            <div className="coverage-item__status">
              <span className={`integration integration--${item.status}`}>{copy.status}</span>
              <span title={item.lastRunAt ?? undefined}>{item.status === "checking" ? "Check in progress" : item.lastRunAt ? `Checked ${relativeTime(item.lastRunAt)}` : "Never checked"}</span>
            </div>
            <details className="technical-details">
              <summary>Technical details</summary>
              <p>{item.summary}</p>
              {item.version && <p>Version: {item.version}</p>}
              {item.lastError && <p className="coverage-error">{item.lastError}</p>}
            </details>
          </article>
        ); })}
      </div>
    </section>
  );
}

export function App() {
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => new URLSearchParams(window.location.hash.slice(1)).get("session"));

  const previousSessionId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousSessionId.current;
    previousSessionId.current = selectedSessionId;
    if (previous === selectedSessionId) return;
    const frame = requestAnimationFrame(() => {
      const target = selectedSessionId ? document.getElementById("session-title") : document.getElementById(`session-card-${previous}`) ?? document.getElementById("sessions-title");
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedSessionId]);

  const [view, setView] = useState<"dashboard" | "map">(() => new URLSearchParams(window.location.hash.slice(1)).get("view") === "map" ? "map" : "dashboard");
  const [explainFindingId, setExplainFindingId] = useState<string | null>(null);
  useEffect(() => {
    if(explainFindingId && !state.findings.some(f=>f.id===explainFindingId&&f.sessionId===selectedSessionId)) setExplainFindingId(null);
  },[explainFindingId,selectedSessionId,state.findings]);
  useEffect(() => {
    const hash=new URLSearchParams(); if(selectedSessionId) hash.set("session",selectedSessionId); if(view==="map") hash.set("view",view);
    window.history.replaceState(null,"",`${window.location.pathname}${window.location.search}${hash.size?`#${hash}`:""}`);
  }, [selectedSessionId]);
  useEffect(() => {
    const hash=new URLSearchParams(window.location.hash.slice(1)); if(view==="map") hash.set("view",view); else hash.delete("view");
    window.history.replaceState(null,"",`${window.location.pathname}${window.location.search}${hash.size?`#${hash}`:""}`);
  }, [view]);
  const explainFinding = (finding: Finding): void => {
    if (!finding.sessionId) return;
    setSelectedSessionId(finding.sessionId); setExplainFindingId(finding.id); setView("map");
  };

  const showRelatedEvent = (finding: Finding): void => {
    if (!finding.eventId) return;
    setView("dashboard");
    if (finding.sessionId) setSelectedSessionId(finding.sessionId);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const event = document.getElementById(`event-${finding.eventId}`);
      event?.focus({ preventScroll: true });
      event?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    }));
  };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/state", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`State request failed (${response.status})`);
        return response.json() as Promise<DashboardState>;
      })
      .then((data) => { if (active) { setState(data); setLoadError(null); } })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (active) setLoadError(error instanceof Error ? error.message : "Unable to load dashboard state");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: number | undefined;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.addEventListener("message", (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as { type?: string; data?: unknown };
          if (payload.type === "state" && payload.data) setState(payload.data as DashboardState);
          if (payload.type === "event" && payload.data) {
            const event = payload.data as VigilEvent;
            setState((current) => ({ ...current, events: [event, ...current.events.filter((item) => item.id !== event.id)] }));
          }
        } catch { /* Ignore malformed messages and retain the last trusted state. */ }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        reconnect = window.setTimeout(connect, 3000);
      });
    };
    connect();
    return () => { disposed = true; if (reconnect) window.clearTimeout(reconnect); socket?.close(); };
  }, []);

  useEffect(() => {
    if (!loading && selectedSessionId && !state.sessions.some((item) => item.id === selectedSessionId)) {
      setSelectedSessionId(null);
    }
  }, [selectedSessionId, state.sessions, loading]);

  const liveState: DashboardState = useMemo(() => {
    const sessions = state.sessions.filter(session => !session.simulated);
    const sessionIds = new Set(sessions.map(session => session.id));
    return {
      sessions,
      events: state.events.filter(event => !event.simulated && sessionIds.has(event.sessionId)),
      findings: state.findings.filter(finding => !finding.simulated && (!finding.sessionId || sessionIds.has(finding.sessionId))),
      coverage: state.coverage.filter(item => !item.sessionId || sessionIds.has(item.sessionId)),
    };
  }, [state]);
  const selectedSession = liveState.sessions.find((session) => session.id === selectedSessionId);
  const scope = dashboardScope(liveState, selectedSessionId);
  return (
    <div className="app-shell">
      <main id="main">
        {loadError && <div className="error-banner" role="alert"><strong>Sessions could not be loaded.</strong> {loadError}. Waiting for live updates.</div>}
        {selectedSession ? (
          <>
            <button type="button" className="back-button" onClick={() => setSelectedSessionId(null)}><span aria-hidden="true">←</span> Sessions</button>
            <div className="session-detail-heading">
              <div><h1 id="session-title" tabIndex={-1}>{selectedSession.projectName || "Unnamed project"}</h1></div>
              <span className={`badge badge--${selectedSession.status}`}>{sessionStatus(selectedSession.status)}</span>
            </div>
            <div className="session-detail-grid">
              {view === "map" ? <SecurityMapView session={selectedSession} revision={JSON.stringify([scope.events.map(e => e.id), scope.findings])} findingId={explainFindingId} onCloseExplanation={() => setExplainFindingId(null)}
                onFinding={(finding,onClose) => <FindingDetail finding={finding} sessions={liveState.sessions} onClose={onClose} onShowEvent={showRelatedEvent} onExplain={explainFinding} />}
                onEvent={(event, link) => <EventDetail event={event} link={link} />}
              /> : <Timeline events={scope.events} sessions={liveState.sessions} onSelect={setSelectedSessionId} />}
              <Findings key={selectedSession.id} findings={scope.findings} sessions={liveState.sessions} onSelect={setSelectedSessionId} onShowEvent={showRelatedEvent} onExplain={explainFinding} />
              <details className="more-details" open={view === "map" ? true : undefined}>
                <summary>More details</summary>
                <nav className="view-tabs" aria-label="Session views">
                  <button type="button" className="text-button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>Activity</button>
                  <button type="button" className="text-button" aria-pressed={view === "map"} onClick={() => { setView("map"); setExplainFindingId(null); }}>Visual explanation</button>
                </nav>
                <Coverage items={scope.coverage} sessions={liveState.sessions} onSelect={setSelectedSessionId} />
                <details className="technical-details session-technical">
                  <summary>Technical details</summary>
                  <p>Project: {selectedSession.projectPath}</p><p>Agent: {selectedSession.agent}</p><p>Session ID: <code>{selectedSession.id}</code></p>
                  <p>Started {exactTime(selectedSession.startedAt)}{selectedSession.endedAt ? ` · Ended ${exactTime(selectedSession.endedAt)}` : ""}</p>
                </details>
              </details>
            </div>
          </>
        ) : (
          <>
            <div className="board-heading"><div><h1 id="sessions-title" tabIndex={-1}>Sessions</h1><p className="board-intro">Pick a task to see how it’s going.</p></div><span className="count">{liveState.sessions.length}</span></div>
            {loading ? <div className="loading" role="status"><span className="spinner" />Loading sessions…</div> : <SessionBoard state={liveState} onSelect={setSelectedSessionId} />}
          </>
        )}
      </main>
    </div>
  );
}
