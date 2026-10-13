import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

function runHook(payload: object, protectedPaths: string[]): Promise<object> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/hook.ts")], {
      cwd: path.resolve("."),
      env: { ...process.env, VIGIL_HOOK_URL: "http://127.0.0.1:1/api/hooks", VIGIL_HOOK_TOKEN: "unavailable", VIGIL_PROTECTED_PATHS: JSON.stringify(protectedPaths) },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify(payload));
  });
}

test("unavailable policy service fails closed only for supported protected Codex reads", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "vigil-hook-"));
  const protectedFile = path.join(root, "credentials.env");
  writeFileSync(protectedFile, "synthetic");
  try {
    const denied = await runHook({ hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { cmd: `cat ${protectedFile}` } }, [protectedFile]) as { hookSpecificOutput?: { permissionDecision: string } };
    assert.equal(denied.hookSpecificOutput?.permissionDecision, "deny");
    const pass = await runHook({ hook_event_name: "PreToolUse", tool_name: "exec_command", tool_input: { command: "pwd" } }, [protectedFile]);
    assert.deepEqual(pass, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});
