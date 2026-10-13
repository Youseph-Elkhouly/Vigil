import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { CoverageItem, Finding, Session, VigilEvent } from "../shared/types.js";
import { VigilDatabase } from "./database.js";
import { checkProtectedRead } from "./policy.js";
import { redactKnown } from "./redaction.js";
import { buildSecurityMap } from "./security-map.js";
import { exportMap } from "./diagram-export.js";
import { agentDirectory, AgentDiagrams, assertOutsideProject } from "./agent-diagrams.js";

const BODY_LIMIT = 256 * 1024;

interface HookPayload {
  session_id: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  error?: string;
  tool_use_id?: string;
  reason?: string;
  cwd?: string;
}

export interface ServiceOptions {
  port: number;
  token: string;
  databasePath: string;
  session: Session;
  protectedPaths: string[];
  uiDirectory?: string;
}

export interface VigilService {
  port: number;
  database: VigilDatabase;
  close(): Promise<void>;
  broadcastState(): void;
}

function safeToken(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validHookPayload(value: unknown): value is HookPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.session_id === "string" && record.session_id.length <= 200
    && typeof record.hook_event_name === "string" && record.hook_event_name.length <= 100
    && (record.tool_name === undefined || (typeof record.tool_name === "string" && record.tool_name.length <= 200))
    && (record.tool_use_id === undefined || (typeof record.tool_use_id === "string" && record.tool_use_id.length > 0 && record.tool_use_id.length <= 200));
}

function mapEventType(name: string): VigilEvent["eventType"] | null {
  if (name === "SessionStart") return "session_start";
  if (name === "PreToolUse") return "tool_attempt";
  if (name === "PostToolUse" || name === "PostToolUseFailure") return "tool_result";
  if (name === "SessionEnd") return "session_end";
  return null;
}

function mime(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

export async function startService(options: ServiceOptions): Promise<VigilService> {
  const database = new VigilDatabase(options.databasePath);
  database.upsertSession(options.session);
  const allowedOrigins = new Set([
    `http://127.0.0.1:${options.port}`, `http://localhost:${options.port}`,
    "http://127.0.0.1:5173", "http://localhost:5173"
  ]);
  const clients = new Set<WebSocket>();

  const broadcast = (message: unknown): void => {
    const body = JSON.stringify(message);
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(body);
  };
  const broadcastState = (): void => broadcast({ type: "state", data: database.state() });

  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:");
    const host = request.headers.host ?? `127.0.0.1:${options.port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);

    if (request.method === "POST" && url.pathname === "/api/hooks") {
      const auth = request.headers.authorization ?? "";
      if (!auth.startsWith("Bearer ") || !safeToken(auth.slice(7), options.token)) return json(response, 401, { error: "unauthorized" });
      try {
        const raw = await readJson(request);
        if (!validHookPayload(raw)) return json(response, 400, { error: "invalid_hook_payload" });
        const eventType = mapEventType(raw.hook_event_name);
        if (!eventType) return json(response, 202, { hookOutput: {} });

        const policy = raw.hook_event_name === "PreToolUse"
          ? checkProtectedRead(raw.tool_name ?? "", raw.tool_input && typeof raw.tool_input === "object"
            ? { ...(raw.tool_input as Record<string, unknown>), cwd: raw.cwd ?? options.session.projectPath }
            : raw.tool_input, options.protectedPaths)
          : { denied: false, ruleId: null, reason: null, resource: null };
        const failed = raw.hook_event_name === "PostToolUseFailure";
        const event: VigilEvent = {
          id: raw.tool_use_id ? createHash("sha256").update(JSON.stringify([options.session.id,raw.hook_event_name,raw.tool_use_id])).digest("hex") : randomUUID(),
          toolUseId:raw.tool_use_id ? redactKnown(raw.tool_use_id,[options.token]):null,
          sessionId: options.session.id, timestamp: new Date().toISOString(), eventType,
          toolName: raw.tool_name ?? null,
          input: redactKnown(eventType === "tool_result" ? { input: raw.tool_input, result: raw.tool_response, error: raw.error } : (raw.tool_input ?? {}), [options.token]),
          decision: policy.denied ? "denied" : failed ? "error" : eventType.startsWith("session_") ? "observed" : "allowed",
          ruleId: policy.ruleId, reason: policy.reason, simulated: false
        };
        database.addEvent(event);

        if (eventType === "session_start") database.upsertSession({ ...options.session, status: "running" });
        if (eventType === "session_end") database.upsertSession({ ...options.session, status: "ended", endedAt: event.timestamp });
        if (policy.denied) {
          const finding: Finding = {
            id: `policy-${event.id}`, sessionId: options.session.id, eventId: event.id, severity: "high", source: "Vigil policy",
            title: "Protected path read denied", resource: policy.resource ?? "protected path", status: "open",
            evidence: "A supported direct Codex shell-read attempt matched the configured protected-path rule. No file content was persisted by Vigil.",
            remediation: "Remove the protected file from the requested workflow or explicitly revise Vigil's policy. Use OS sandbox controls for comprehensive shell, interpreter, and subprocess coverage.",
            createdAt: event.timestamp, simulated: false
          };
          database.addFinding(finding);
        }
        broadcastState();
        const hookOutput = policy.denied ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: policy.reason
          }
        } : {};
        return json(response, 200, { hookOutput });
      } catch (error) {
        return json(response, error instanceof Error && error.message === "request_too_large" ? 413 : 400, { error: "invalid_request" });
      }
    }

    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return json(response, 403, { error: "origin_not_allowed" });
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, database.state());
    if (request.method === "GET" && url.pathname === "/api/architecture") {
      try {
        const sessionId=url.searchParams.get("session")??"";
        const session=database.sessionEvidence(sessionId).sessions[0];
        if(!session) return json(response,404,{error:"session_not_found"});
        const dir=agentDirectory(options.databasePath,sessionId); assertOutsideProject(dir,session.projectPath);
        if(!existsSync(path.join(dir,"enabled"))) return json(response,200,{status:"not_configured",diagrams:[]});
        let status=Date.now()-statSync(path.join(dir,"enabled")).mtimeMs>15000?"unavailable":"waiting_for_agent";
        try {const health=JSON.parse(readFileSync(path.join(dir,"status.json"),"utf8"));status=health.state==="active"&&Date.now()-Date.parse(health.at)<6000?"active":health.state==="stopped"?"stopped":"unavailable";}catch{/* waiting or startup failure */}
        const store=new AgentDiagrams(dir,[options.token]);
        const id=url.searchParams.get("id");
        return json(response,200,{status,diagrams:store.list(),...(id?{diagram:store.get(id)}:{})});
      }catch{return json(response,503,{error:"authored_diagrams_unavailable",hint:"Monitoring and enforcement remain active."});}
    }
    if (request.method === "GET" && url.pathname === "/api/security-map") {
      try {
        const id=url.searchParams.get("session") ?? "";
        const source=database.sessionEvidence(id);
        const finding=url.searchParams.get("finding") ?? undefined;
        const map=buildSecurityMap(source,id,finding,[options.token]);
        if (source.events.length===5000) map.notices.push("Session evidence query is capped at 5,000 events; earlier records remain in SQLite.");
        if (source.findings.length===1000) map.notices.push("Session evidence query is capped at 1,000 findings.");
        if (!finding) database.saveSecurityMap(map);
        const format=url.searchParams.get("format");
        if (format) {
          if (format!=="json" && format!=="svg") return json(response,400,{error:"unsupported_export_format"});
          const output=await exportMap(map,format,[options.token]);
          response.writeHead(200,{"content-type":format==="svg"?"image/svg+xml":"application/json","content-disposition":`attachment; filename="vigil-security-map.${format}"`,"cache-control":"no-store"});
          return response.end(output);
        }
        const eventIds=new Set(Object.values(map.evidence).flatMap(l=>l.eventIds));
        const findingIds=new Set(Object.values(map.evidence).flatMap(l=>l.findingIds));
        return json(response,200,redactKnown({map,events:source.events.filter(e=>eventIds.has(e.id)),findings:source.findings.filter(f=>findingIds.has(f.id))},[options.token]));
      } catch (error) {
        const message=error instanceof Error ? error.message : "diagram_unavailable";
        return json(response,message.endsWith("_not_found")?404:503,{error:message.endsWith("_not_found")?message:"diagram_unavailable",hint:"Monitoring and policy enforcement remain active."});
      }
    }
    if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });

    const uiDirectory = options.uiDirectory ?? path.resolve(import.meta.dirname, "ui");
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let filePath = path.resolve(uiDirectory, relative);
    if (!filePath.startsWith(`${path.resolve(uiDirectory)}${path.sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) filePath = path.join(uiDirectory, "index.html");
    if (!existsSync(filePath)) return json(response, 503, { error: "dashboard_not_built", hint: "Run npm run build" });
    response.writeHead(200, { "content-type": mime(filePath), "cache-control": relative === "index.html" ? "no-cache" : "public, max-age=31536000, immutable" });
    createReadStream(filePath).pipe(response);
  });

  const websocket = new WebSocketServer({ noServer: true, maxPayload: BODY_LIMIT });
  server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    if (request.url !== "/ws" || !origin || !allowedOrigins.has(origin)) return socket.destroy();
    websocket.handleUpgrade(request, socket, head, (client) => websocket.emit("connection", client, request));
  });
  websocket.on("connection", (client) => {
    clients.add(client);
    client.send(JSON.stringify({ type: "state", data: database.state() }));
    client.on("close", () => clients.delete(client));
  });

  try { await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  }); } catch (error) { websocket.close(); database.close(); throw error; }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  allowedOrigins.add(`http://127.0.0.1:${port}`);
  allowedOrigins.add(`http://localhost:${port}`);

  const baseline: CoverageItem[] = [
    { id: "protected-read", name: "Supported direct shell reads", status: "active", version: null, summary: "Pre-execution lexical denial for direct Codex shell reads using common read utilities and an explicit protected path.", lastError: null, lastRunAt: new Date().toISOString() },
    { id: "bash-gap", name: "Indirect shell and subprocess access", status: "unsupported", version: null, summary: "Shell indirection, interpreters, dynamically constructed paths, and subprocesses are not comprehensively enforced. Use an OS sandbox for this boundary.", lastError: null, lastRunAt: null },
    { id: "mcp-gap", name: "MCP tool enforcement", status: "unsupported", version: null, summary: "MCP inventory may be scanned, but protected-path access by MCP tools is not blocked.", lastError: null, lastRunAt: null }
  ];
  baseline.forEach((item) => database.upsertCoverage({ ...item, id: `${options.session.id}:${item.id}`, sessionId: options.session.id }));

  // Other Vigil processes write to the same SQLite database.
  let lastState = "";
  const refresh = setInterval(() => {
    if (!clients.size) return;
    const data = database.state();
    const serialized = JSON.stringify(data);
    if (serialized !== lastState) {
      lastState = serialized;
      broadcast({ type: "state", data });
    }
  }, 1000);
  refresh.unref();

  return {
    port, database, broadcastState,
    close: () => new Promise<void>((resolve) => {
      clearInterval(refresh);
      for (const client of clients) client.close();
      websocket.close();
      server.close(() => { database.close(); resolve(); });
    })
  };
}
