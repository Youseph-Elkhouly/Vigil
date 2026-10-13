import type { CoverageItem } from "../shared/types";

export interface ToolOption { id: string; name: string; purpose: string; audience: string; guide: string; setup: string; coverageId?: string; }
export const toolOptions: readonly ToolOption[] = [
  { id: "claude-controls", name: "Claude permissions + sandbox", purpose: "Control what Claude can do and which files and networks it can access.", audience: "Claude Code", guide: "https://code.claude.com/docs/en/sandboxing", setup: "In Claude Code, use /permissions to review allowed actions and /sandbox to configure shell isolation." },
  { id: "snyk-agent-scan", name: "Snyk Agent Scan", purpose: "Check connected tools and agent skills for security risks.", audience: "Security checks", guide: "https://github.com/snyk/agent-scan", setup: "Install Agent Scan using the official guide. Run the scan separately; Vigil currently supports importing a saved report, rather than starting the scan from this switch.", coverageId: "snyk-agent-scan" },
  { id: "lasso", name: "Lasso Claude Hooks", purpose: "Warn Claude about suspicious instructions in files, pages, and command results.", audience: "Claude Code", guide: "https://github.com/lasso-security/claude-hooks", setup: "Install the prompt-injection defender in your Claude Code project using the Lasso guide. Vigil does not install or manage these hooks.", coverageId: "lasso" },
  { id: "docker-sandboxes", name: "Docker Sandboxes", purpose: "Run coding agents in an isolated environment with limited access to your machine.", audience: "Isolation", guide: "https://docs.docker.com/ai/sandboxes/", setup: "Follow Docker's setup guide and launch your agent inside its sandbox. Choosing it here does not move an already running agent into a sandbox.", coverageId: "docker-sandboxes" },
  { id: "superset", name: "Superset", purpose: "Run agents in parallel and review their changes in one place.", audience: "Agent workflow", guide: "https://docs.superset.sh/first-workspace", setup: "Install Superset and create a workspace for your agent. It organizes work; it does not fix the vulnerability shown above." },
  { id: "conductor", name: "Conductor", purpose: "Give each agent task its own workspace, branch, and review process.", audience: "Agent workflow", guide: "https://www.conductor.build/docs", setup: "Install Conductor and create a task workspace. Review and merge its changes using Conductor's workflow." },
  { id: "langfuse", name: "Langfuse", purpose: "Trace agents you build, track costs, and investigate failed or poor results.", audience: "Your own agent apps", guide: "https://langfuse.com/docs", setup: "Connect your agent application's tracing SDK to a Langfuse project. Credentials and application instrumentation are required.", coverageId: "langfuse" },
];

export function restoreToolChoices(value: string | null): string[] {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string" && toolOptions.some(tool => tool.id === id)))] : []; } catch { return []; }
}

export function toolStatus(tool: ToolOption, selected: boolean, demo: boolean, coverage: CoverageItem[]): string {
  if (demo) return selected ? "Active in demo" : "Off in demo";
  const check = coverage.find(item => item.id.split(":").at(-1) === tool.coverageId);
  if (check?.status === "active") return "Results available";
  if (check?.status === "checking") return "Checking";
  return selected ? "Selected · setup needed" : "Not selected";
}
