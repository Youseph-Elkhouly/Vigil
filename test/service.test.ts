import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startService } from "../src/server/service.js";
import type { Session } from "../src/shared/types.js";
import type { DashboardState } from "../src/shared/types.js";
import { WebSocket } from "ws";

test("hook service authenticates, denies protected Codex shell reads, and returns no override for permitted actions", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vigil-service-"));
  mkdirSync(path.join(root, "secrets"));
  const protectedFile = path.join(root, "secrets", "credentials.env");
  writeFileSync(protectedFile, "GITHUB_TOKEN=ghp_000000000000000000000000000000000000");
  const session: Session = { id: "test-session", projectPath: root, projectName: "test", agent: "codex-cli test", status: "starting", startedAt: new Date().toISOString(), endedAt: null, simulated: false };
  const hookToken = "service-session-token-123";
  const service = await startService({ port: 0, token: hookToken, databasePath: path.join(root, "vigil.db"), session, protectedPaths: [protectedFile], uiDirectory: path.join(root, "missing-ui") });
  const endpoint = `http://127.0.0.1:${service.port}/api/hooks`;
  const send = (payload: unknown, token = hookToken) => fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  try {
    assert.equal((await send({ session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: {} }, "wrong")).status, 401);
    assert.equal((await send({ session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { padding: "x".repeat(300_000) } })).status, 413);
    const allowed = await (await send({ session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { cmd: "cat README.md" }, cwd: root })).json() as { hookOutput: object };
    assert.deepEqual(allowed.hookOutput, {});
    const denied = await (await send({ session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { cmd: "cat secrets/credentials.env" }, cwd: root })).json() as { hookOutput: { hookSpecificOutput?: { permissionDecision: string } } };
    assert.equal(denied.hookOutput.hookSpecificOutput?.permissionDecision, "deny");
    await send({ session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { command: "echo token=ghp_000000000000000000000000000000000000" } });
    await send({ session_id: "codex", hook_event_name: "PostToolUse", tool_name: "exec_command", tool_input: {}, tool_response: hookToken });
    const serialized = JSON.stringify(service.database.state());
    assert.doesNotMatch(serialized, /ghp_000/);
    assert.match(serialized, /\[REDACTED\]/);
    assert.doesNotMatch(serialized, /service-session-token/);
    assert.equal(service.database.state().findings.length, 1);
    const repeated={session_id:"codex",hook_event_name:"PreToolUse",tool_use_id:"retry-id",tool_name:"exec_command",tool_input:{cmd:"cat README.md"},cwd:root};
    await send(repeated);await send(repeated);
    assert.equal(service.database.state().events.filter(e=>e.toolUseId==="retry-id").length,1);
    const mapUrl=`http://127.0.0.1:${service.port}/api/security-map?session=${session.id}`;
    const mapped=await (await fetch(mapUrl)).json() as {map:import("../src/shared/giotto.js").SecurityMap;events:import("../src/shared/types.js").VigilEvent[]};
    const deniedEvent=mapped.events.find(e=>e.decision==="denied")!;
    const deniedNode=mapped.map.diagram.elements.find(e=>e.id.startsWith("action-")&&mapped.map.evidence[e.id]?.eventIds.includes(deniedEvent.id))!;
    assert.equal(mapped.map.evidence[deniedNode.id].status,"denied");
    assert.deepEqual(service.database.securityMapSnapshot(session.id),mapped.map);
    for(const format of ["json","svg"]){const exported=await fetch(`${mapUrl}&format=${format}`);assert.equal(exported.status,200);const output=await exported.text();assert.doesNotMatch(output,/ghp_000|service-session-token/);}
    // A missing diagram/finding never changes the next supported direct-read policy decision.
    assert.equal((await fetch(`${mapUrl}&finding=missing`)).status,404);
    const stillDenied=await (await send({session_id:"codex",hook_event_name:"PreToolUse",tool_name:"exec_command",tool_input:{cmd:"cat secrets/credentials.env"},cwd:root})).json() as {hookOutput:{hookSpecificOutput:{permissionDecision:string}}};
    assert.equal(stillDenied.hookOutput.hookSpecificOutput.permissionDecision,"deny");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dashboard receives other sessions' updates while each hook retains its own policy", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vigil-multiple-services-"));
  const session: Session = { id: "first-session", projectPath: root, projectName: "same-project", agent: "Codex", status: "starting", startedAt: new Date().toISOString(), endedAt: null, simulated: false };
  let first: Awaited<ReturnType<typeof startService>> | undefined;
  let second: Awaited<ReturnType<typeof startService>> | undefined;
  let socket: WebSocket | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const databasePath = path.join(root, "vigil.db");
    first = await startService({ port: 0, token: "first-token", databasePath, session, protectedPaths: [] });
    second = await startService({ port: 0, token: "second-token", databasePath, session: { ...session, id: "second-session" }, protectedPaths: [path.join(root, "credentials.env")] });
    assert.equal(first.database.state().coverage.filter((item) => item.sessionId === "first-session").length, 3);
    assert.equal(first.database.state().coverage.filter((item) => item.sessionId === "second-session").length, 3);
    socket = new WebSocket(`ws://127.0.0.1:${first.port}/ws`, { origin: `http://127.0.0.1:${first.port}` });
    const update = new Promise<DashboardState>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Other session did not reach the dashboard")), 8000);
      socket!.on("error", reject);
      socket!.on("message", (message) => {
        const payload = JSON.parse(String(message)) as { type: string; data: DashboardState };
        if (payload.type === "state" && payload.data.events.some((event) => event.sessionId === "second-session")) resolve(payload.data);
      });
    });
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
    const endpoint = `http://127.0.0.1:${second.port}/api/hooks`;
    const request = { session_id: "codex", hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { cmd: "cat credentials.env" }, cwd: root };
    assert.equal((await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer first-token" }, body: JSON.stringify(request) })).status, 401);
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer second-token" }, body: JSON.stringify(request) });
    assert.equal(response.status, 200);
    const state = await update;
    assert.equal(state.events.find((event) => event.sessionId === "second-session")?.decision, "denied");
    assert.equal(state.findings[0]?.sessionId, "second-session");
  } finally {
    if (timeout) clearTimeout(timeout);
    socket?.terminate();
    await second?.close();
    await first?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
