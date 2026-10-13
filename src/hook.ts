import { checkProtectedRead } from "./server/policy.js";

const DENIAL_REASON = "Vigil's policy service is unavailable, so this supported direct Codex shell read of a configured protected path was denied (fail closed). Shell indirection, interpreters, subprocesses, and MCP tools are outside this rule's guarantee.";

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function failClosed(payload: Record<string, unknown>): object {
  let protectedPaths: string[] = [];
  try {
    const parsed = JSON.parse(process.env.VIGIL_PROTECTED_PATHS ?? "[]");
    if (Array.isArray(parsed)) protectedPaths = parsed.filter((item): item is string => typeof item === "string");
  } catch { /* malformed launcher state leaves no guarded path */ }
  const toolInput = payload.tool_input && typeof payload.tool_input === "object"
    ? { ...(payload.tool_input as Record<string, unknown>), cwd: payload.cwd ?? process.env.VIGIL_PROJECT_PATH }
    : payload.tool_input;
  const policy = checkProtectedRead(String(payload.tool_name ?? ""), toolInput, protectedPaths);
  if (!policy.denied) return {};
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: DENIAL_REASON } };
}

async function main(): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    const raw = await stdin();
    if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("oversize");
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    process.stdout.write("{}");
    return;
  }
  const endpoint = process.env.VIGIL_HOOK_URL;
  const token = process.env.VIGIL_HOOK_TOKEN;
  if (!endpoint || !token) {
    process.stdout.write(JSON.stringify(failClosed(payload)));
    return;
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) throw new Error(`policy service returned ${response.status}`);
    const result = await response.json() as { hookOutput?: unknown };
    process.stdout.write(JSON.stringify(result.hookOutput ?? {}));
  } catch {
    process.stdout.write(JSON.stringify(failClosed(payload)));
  }
}

void main();
