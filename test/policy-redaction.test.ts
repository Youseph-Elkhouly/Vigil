import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkProtectedRead, resolveProtectedPaths } from "../src/server/policy.js";
import { redact } from "../src/server/redaction.js";

test("supported direct Codex shell read is denied while ordinary commands pass", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vigil-policy-"));
  try {
    mkdirSync(path.join(root, "secrets"));
    writeFileSync(path.join(root, "secrets", "credentials.env"), "synthetic");
    writeFileSync(path.join(root, "README.md"), "safe");
    const protectedPaths = resolveProtectedPaths(root, { protectedPaths: ["secrets/credentials.env"] });
    assert.equal(checkProtectedRead("exec_command", { cmd: "cat secrets/credentials.env", cwd: root }, protectedPaths).denied, true);
    assert.equal(checkProtectedRead("exec_command", { cmd: "cat README.md", cwd: root }, protectedPaths).denied, false);
    assert.equal(checkProtectedRead("exec_command", { cmd: "pwd", cwd: root }, protectedPaths).denied, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("credential-shaped values and sensitive fields are redacted", () => {
  const secret = "ghp_000000000000000000000000000000000000";
  const value = redact({ token: secret, output: `authorization=Bearer ${secret}` });
  assert.equal(value.token, "[REDACTED]");
  assert.doesNotMatch(value.output, /ghp_/);
});
