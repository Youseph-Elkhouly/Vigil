import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ProtectedPathPolicy } from "../shared/types.js";

export const PROTECTED_READ_RULE = "VIGIL-CODEX-PATH-001";

const CODEX_SHELL_TOOLS = new Set(["exec_command", "shell", "unified_exec", "local_shell"]);
const DIRECT_READ_COMMAND = /(?:^|[;&|]\s*|\s)(?:\/?(?:usr\/)?bin\/)?(?:cat|head|tail|less|more|bat|sed|awk|grep|rg|xxd|strings|wc|cp)\s/;

function canonical(candidate: string): string {
  const resolved = path.resolve(candidate);
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
}

function contains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

export function resolveProtectedPaths(projectPath: string, policy: ProtectedPathPolicy): string[] {
  return policy.protectedPaths.map((entry) => canonical(path.isAbsolute(entry) ? entry : path.join(projectPath, entry)));
}

export function checkProtectedRead(
  toolName: string,
  toolInput: unknown,
  protectedPaths: string[]
): { denied: boolean; ruleId: string | null; reason: string | null; resource: string | null } {
  if (!toolInput || typeof toolInput !== "object") {
    return { denied: false, ruleId: null, reason: null, resource: null };
  }
  const input = toolInput as Record<string, unknown>;
  if (toolName === "Read") {
    const filePath = input.file_path;
    if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 16_384) {
      return { denied: false, ruleId: null, reason: null, resource: null };
    }
    const requested = canonical(filePath);
    const protectedRoot = protectedPaths.map(canonical).find((entry) => contains(entry, requested));
    if (!protectedRoot) return { denied: false, ruleId: null, reason: null, resource: requested };
    return {
      denied: true,
      ruleId: PROTECTED_READ_RULE,
      reason: "Vigil denied a direct protected-file read. This compatibility path is not used by Codex's normal shell tool.",
      resource: requested
    };
  }
  if (!CODEX_SHELL_TOOLS.has(toolName)) return { denied: false, ruleId: null, reason: null, resource: null };
  const rawCommand = input.command ?? input.cmd;
  const command = Array.isArray(rawCommand)
    ? rawCommand.filter((part): part is string => typeof part === "string").join(" ")
    : typeof rawCommand === "string" ? rawCommand : "";
  if (!command || command.length > 64_000 || !DIRECT_READ_COMMAND.test(command)) {
    return { denied: false, ruleId: null, reason: null, resource: null };
  }
  const cwd = typeof input.cwd === "string" ? canonical(input.cwd) : null;
  const normalizedCommand = command.replace(/["']/g, "");
  const protectedRoot = protectedPaths.map((original) => ({ original, resolved: canonical(original) })).find(({ original, resolved }) => {
    if (normalizedCommand.includes(original) || normalizedCommand.includes(resolved)) return true;
    if (!cwd) return false;
    const relative = path.relative(cwd, resolved);
    const originalRelative = path.relative(cwd, original);
    return (relative !== "" && normalizedCommand.includes(relative))
      || (originalRelative !== "" && normalizedCommand.includes(originalRelative));
  });
  if (!protectedRoot) return { denied: false, ruleId: null, reason: null, resource: null };
  return {
    denied: true,
    ruleId: PROTECTED_READ_RULE,
    reason: "Vigil denied a supported direct Codex shell read of a protected path. Shell indirection, interpreters, subprocesses, and MCP tools are not comprehensively covered.",
    resource: protectedRoot.resolved
  };
}
