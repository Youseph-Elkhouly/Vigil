import type { CoverageItem, Session, VigilEvent } from "../shared/types";

export function sessionStatus(status: Session["status"]): string {
  return { starting: "Starting", running: "Working", ended: "Done", failed: "Stopped", simulated: "Example" }[status];
}

function exampleCopy(event: VigilEvent): { title: string; description: string } | null {
  if (!event.simulated || !event.input || typeof event.input !== "object" || !("demo" in event.input)) return null;
  const demo = event.input.demo;
  if (!demo || typeof demo !== "object" || !("title" in demo) || !("description" in demo)) return null;
  return typeof demo.title === "string" && typeof demo.description === "string" ? { title: demo.title, description: demo.description } : null;
}

export function activityTitle(event: VigilEvent): string {
  const example = exampleCopy(event);
  if (example) return example.title;
  if (event.eventType === "session_start") return "Agent session started";
  if (event.eventType === "session_end") return "Agent session ended";
  if (event.decision === "denied") return event.ruleId === "VIGIL-CODEX-PATH-001" ? "Vigil blocked a protected-file read" : "Vigil blocked an action";
  if (event.decision === "error") return "An action reported an error";
  const command = event.toolName === "exec_command" || event.toolName === "shell_command";
  if (event.eventType === "tool_result") return command ? "A command returned a result" : "An action returned a result";
  return command ? "Agent asked to run a command" : "Agent asked to use a tool";
}

export function activityExplanation(event: VigilEvent): string {
  const example = exampleCopy(event);
  if (example) return example.description;
  if (event.decision === "denied") return event.ruleId === "VIGIL-CODEX-PATH-001" ? "The request matched a protected-file rule and was denied before execution." : "The request was denied before execution. See the reported reason in the details.";
  if (event.decision === "error") return "Review the details to understand what went wrong.";
  if (event.eventType === "session_start") return "Vigil began recording this session’s activity.";
  if (event.eventType === "session_end") return "This agent session has ended.";
  if (event.eventType === "tool_result") return "Vigil recorded the tool’s response. A response alone does not confirm success.";
  return "Vigil did not block this request. The agent’s other permission checks still apply.";
}

export function checkCopy(item: CoverageItem): { name: string; status: string; description: string } {
  const kind = item.id.split(":").at(-1);
  const statuses = { active: "Results available", checking: "Checking…", failed: "Could not check", not_installed: "Tool not installed", not_configured: "Setup needed", unsupported: "Not available" };
  if (item.id.startsWith("demo-") && item.version === "Example") return { name: item.name, status: item.status === "active" ? "On in this example" : statuses[item.status], description: item.summary };
  if (kind === "protected-read") return { name: "Protected-file reads", status: item.status === "active" ? "Rule enabled" : statuses[item.status], description: "Vigil blocks supported direct commands that try to read protected files. This rule does not cover every way to read a file." };
  if (kind === "bash-gap") return { name: "Scripts and indirect file access", status: statuses[item.status], description: "This rule does not block reads through scripts, dynamically built commands, or child processes." };
  if (kind === "mcp-gap") return { name: "Connected tools", status: statuses[item.status], description: "File access through connected tools is not blocked by Vigil’s protected-file rule." };
  const purpose = kind === "gitleaks" ? "Looks for exposed passwords and access tokens in project files." : kind === "snyk-agent-scan" ? "Shows imported security results for connected agent tools." : "";
  const description = item.status === "checking" ? "Checking this session’s project. Results will appear here." : item.status === "unsupported" ? "This check is not supported by this version of Vigil." : item.status === "not_configured" ? "This check needs setup before it can be used." : item.status === "not_installed" ? "This check is unavailable. See technical details for the reported reason." : item.status === "failed" ? "The check did not finish successfully. Its results should not be treated as a clean scan." : item.summary;
  return { name: item.name, status: statuses[item.status], description: [purpose, description].filter(Boolean).join(" ") };
}
