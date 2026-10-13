import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ProtectedPathPolicy, Session } from "./shared/types.js";
import { resolveProtectedPaths } from "./server/policy.js";
import { startService } from "./server/service.js";
import { scannerAdapters } from "./server/scanners/index.js";
import { parseSnykAgentScanJson } from "./server/scanners/snyk-agent-scan.js";
import { VigilDatabase } from "./server/database.js";
import { redactString } from "./server/redaction.js";
import { agentDirectory, assertOutsideProject } from "./server/agent-diagrams.js";

interface RunOptions { project: string; port: number; policyPath: string; noOpen: boolean; giottoMcp: boolean; codexArgs: string[]; }

const vigilHome = process.env.VIGIL_HOME ? path.resolve(process.env.VIGIL_HOME) : path.join(homedir(), ".vigil");

function usage(): never {
  console.error(`Vigil local agent security\n\nUsage:\n  vigil run --project <path> [--policy <path>] [--port 4317] [--no-open] [--giotto-mcp] [-- <codex args>]\n  vigil import-snyk --file <report.json> --session <session-id>\n  vigil version\n\nPolicy defaults to ~/.vigil/policy.json. All Vigil runtime files stay outside the selected project.`);
  process.exit(2);
}

function importSnyk(args: string[]): void {
  let file = "";
  let sessionId = "";
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--file") file = path.resolve(args[++index] ?? "");
    else if (args[index] === "--session") sessionId = args[++index] ?? "";
    else usage();
  }
  if (!file || !sessionId) usage();
  if (statSync(file).size > 20 * 1024 * 1024) throw new Error("Snyk import exceeds 20 MiB limit");
  const findings = parseSnykAgentScanJson(readFileSync(file, "utf8"), sessionId);
  const database = new VigilDatabase(path.join(vigilHome, "vigil.db"));
  const now = new Date().toISOString();
  try {
    findings.forEach((finding) => database.addFinding({ ...finding, id: randomUUID(), createdAt: now }));
    database.upsertCoverage({
      id: `${sessionId}:snyk-agent-scan`, sessionId, name: "Snyk Agent Scan", status: "active", version: null,
      summary: `Imported ${findings.length} finding${findings.length === 1 ? "" : "s"} from JSON.`,
      lastError: null, lastRunAt: now
    });
  } finally { database.close(); }
  console.log(`Imported ${findings.length} redacted Snyk Agent Scan finding${findings.length === 1 ? "" : "s"}. Live dashboards update automatically.`);
}

function parseRun(args: string[]): RunOptions {
  let project = "";
  let port = 4317;
  let policyPath = path.join(vigilHome, "policy.json");
  let noOpen = false;
  let giottoMcp = false;
  const separator = args.indexOf("--");
  const own = separator >= 0 ? args.slice(0, separator) : args;
  const codexArgs = separator >= 0 ? args.slice(separator + 1) : [];
  for (let index = 0; index < own.length; index++) {
    const arg = own[index];
    if (arg === "--project") project = own[++index] ?? "";
    else if (arg === "--port") port = Number(own[++index]);
    else if (arg === "--policy") policyPath = path.resolve(own[++index] ?? "");
    else if (arg === "--no-open") noOpen = true;
    else if (arg === "--giotto-mcp") giottoMcp = true;
    else usage();
  }
  if (!project || !Number.isInteger(port) || port < 1024 || port > 65535) usage();
  return { project: path.resolve(project), port, policyPath, noOpen, giottoMcp, codexArgs };
}

function loadPolicy(policyPath: string): ProtectedPathPolicy {
  if (!existsSync(policyPath)) {
    mkdirSync(path.dirname(policyPath), { recursive: true, mode: 0o700 });
    writeFileSync(policyPath, JSON.stringify({ protectedPaths: ["secrets/credentials.env"] }, null, 2), { mode: 0o600 });
  }
  const raw = JSON.parse(readFileSync(policyPath, "utf8")) as Record<string, unknown>;
  if (!Array.isArray(raw.protectedPaths) || raw.protectedPaths.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("Policy must contain a protectedPaths array of non-empty strings");
  }
  return { protectedPaths: raw.protectedPaths as string[] };
}

function hookEntry(): string {
  const built = path.resolve(import.meta.dirname, "hook.js");
  if (!existsSync(built)) throw new Error(`Hook bridge not found at ${built}. Run npm run build before launching Vigil.`);
  return built;
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }

function writeSessionProfile(directory: string, hookPath: string): { profileName: string; profilePath: string } {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const command = `${shellQuote(process.execPath)} ${shellQuote(hookPath)}`;
  const profileName = `vigil-${path.basename(directory)}`;
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(homedir(), ".codex");
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const profilePath = path.join(codexHome, `${profileName}.config.toml`);
  const handler = `{ type = "command", command = ${JSON.stringify(command)}, timeout = 5 }`;
  const profile = `[features]\nhooks = true\n\n[hooks]\nSessionStart = [{ hooks = [${handler}] }]\nPreToolUse = [{ matcher = ".*", hooks = [${handler}] }]\nPostToolUse = [{ matcher = ".*", hooks = [${handler}] }]\nSessionEnd = [{ hooks = [${handler}] }]\n`;
  writeFileSync(path.join(directory, "codex-profile.toml"), profile, { mode: 0o600 });
  writeFileSync(profilePath, profile, { mode: 0o600, flag: "wx" });
  return { profileName, profilePath };
}

async function runScanners(service: Awaited<ReturnType<typeof startService>>, project: string, sessionId: string): Promise<void> {
  await Promise.all(scannerAdapters.map(async (adapter) => {
    service.database.upsertCoverage({ id: `${sessionId}:${adapter.id}`, sessionId, name: adapter.name, status: "checking", version: null, summary: "Checking this session’s project…", lastError: null, lastRunAt: null });
    service.broadcastState();
    let result;
    try { result = await adapter.scan(project, sessionId); }
    catch (error) { result = { status: "failed" as const, version: null, findings: [], error: redactString(error instanceof Error ? error.message : String(error)) }; }
    const now = new Date().toISOString();
    service.database.upsertCoverage({
      id: `${sessionId}:${adapter.id}`,
      sessionId,
      name: adapter.name,
      status: result.status,
      version: result.version,
      summary: result.status === "active"
        ? (result.findings.length ? `${result.findings.length} finding${result.findings.length === 1 ? "" : "s"} detected.` : "Scan completed with no findings.")
        : (result.error ?? "Integration is unavailable."),
      lastError: result.status === "failed" ? result.error : null,
      lastRunAt: result.status === "active" || result.status === "failed" ? now : null
    });
    for (const finding of result.findings) {
      service.database.addFinding({ ...finding, id: randomUUID(), createdAt: now });
    }
    service.broadcastState();
  }));
}

async function run(options: RunOptions): Promise<void> {
  if (!existsSync(options.project)) throw new Error(`Project does not exist: ${options.project}`);
  const codex = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (codex.error || codex.status !== 0) throw new Error("Codex CLI is not installed or is not available on PATH");

  const policy = loadPolicy(options.policyPath);
  const protectedPaths = resolveProtectedPaths(options.project, policy);
  const id = randomUUID();
  const runtime = path.join(vigilHome, "sessions", id);
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const session: Session = { id, projectPath: options.project, projectName: path.basename(options.project), agent: String(codex.stdout).trim(), status: "starting", startedAt: now, endedAt: null, simulated: false };
  const uiDirectory = path.resolve(import.meta.dirname, "ui");
  const serviceOptions = { port: options.port, token, databasePath: path.join(vigilHome, "vigil.db"), session, protectedPaths, uiDirectory };
  let service;
  try { service = await startService(serviceOptions); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
    service = await startService({ ...serviceOptions, port: 0 });
  }
  const hookUrl = `http://127.0.0.1:${service.port}/api/hooks`;
  let profileName: string;
  let profilePath: string;
  try {
    ({ profileName, profilePath } = writeSessionProfile(runtime, hookEntry()));
  } catch (error) {
    await service.close();
    throw error;
  }
  const dashboard = `http://127.0.0.1:${service.port}`;
  const mcpArgs: string[] = [];
  if (options.giottoMcp) {
    try {
      const dir=agentDirectory(path.join(vigilHome,"vigil.db"),id);
      assertOutsideProject(dir,options.project);
      const entry=path.resolve(import.meta.dirname,"giotto-mcp.js");
      if(!existsSync(entry)) throw new Error("Run npm run build to create the Giotto sidecar");
      mkdirSync(dir,{recursive:true,mode:0o700});
      writeFileSync(path.join(dir,"enabled"),"Session-scoped stdio; no canvas or port",{mode:0o600});
      for(const [key,value] of Object.entries({
        "mcp_servers.vigil_giotto.command":process.execPath,
        "mcp_servers.vigil_giotto.args":[entry],
        "mcp_servers.vigil_giotto.env":{GIOTTO_DIR:dir,VIGIL_PROJECT_PATH:options.project},
        "mcp_servers.vigil_giotto.enabled_tools":["list_diagrams","create_diagram","get_diagram","edit_diagram"],
        "mcp_servers.vigil_giotto.startup_timeout_sec":10,
        "mcp_servers.vigil_giotto.required":false
      })) {
        // TOML inline tables use '='; JSON strings/arrays are valid TOML values.
        const encoded=key.endsWith(".env") ? `{ GIOTTO_DIR = ${JSON.stringify(dir)}, VIGIL_PROJECT_PATH = ${JSON.stringify(options.project)} }` : JSON.stringify(value);
        mcpArgs.push("-c",`${key}=${encoded}`);
      }
      console.log("Giotto: restricted session-scoped stdio enabled. Authored diagrams are inferred and separate from security evidence.");
    } catch(error) {console.error(`Giotto unavailable: ${error instanceof Error?error.message:"setup failed"}. Monitoring continues.`);}
  }
  console.log(`Vigil dashboard: ${dashboard}`);
  console.log(`Policy: ${options.policyPath}`);
  console.log(`Protected paths for supported direct Codex shell reads: ${protectedPaths.join(", ") || "none"}`);
  console.log("Coverage note: shell indirection, interpreters, subprocesses, and MCP tools are not comprehensively blocked by this lexical rule.");
  console.log("Vigil enables Codex's hook-trust bypass only for this launch so its generated session hook can run; Codex approval and sandbox settings remain unchanged.\n");
  void runScanners(service, options.project, id).catch((error) => {
    console.error(`Scanner update failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!options.noOpen) {
    const opener = process.platform === "darwin" ? ["open", [dashboard]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", dashboard]] : ["xdg-open", [dashboard]];
    const child = spawn(opener[0] as string, opener[1] as string[], { stdio: "ignore", detached: true });
    child.unref();
  }

  const child = spawn("codex", ["-p", profileName, "--dangerously-bypass-hook-trust", "-C", options.project, ...mcpArgs, ...options.codexArgs], {
    cwd: options.project,
    stdio: "inherit",
    env: { ...process.env, VIGIL_HOOK_URL: hookUrl, VIGIL_HOOK_TOKEN: token, VIGIL_PROTECTED_PATHS: JSON.stringify(protectedPaths), VIGIL_PROJECT_PATH: options.project }
  });
  const removeProfile = (): void => { rmSync(profilePath, { force: true }); };
  const shutdown = async (): Promise<void> => { if (!child.killed) child.kill("SIGTERM"); removeProfile(); await service.close(); };
  process.once("SIGINT", () => void shutdown().then(() => process.exit(130)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(143)));
  const code = await new Promise<number>((resolve) => { child.once("error", () => resolve(1)); child.once("exit", (value) => resolve(value ?? 1)); });
  removeProfile();
  const endedAt = new Date().toISOString();
  service.database.upsertSession({ ...session, status: code === 0 ? "ended" : "failed", endedAt });
  service.broadcastState();
  console.log(`\nCodex exited (${code}). Vigil remains at ${dashboard}; press Ctrl+C to stop.`);
  await new Promise<void>((resolve) => process.once("SIGINT", resolve));
  await service.close();
  process.exitCode = code;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "version" || command === "--version" || command === "-v") return console.log("0.1.0");
  if (command === "import-snyk") return importSnyk(args);
  if (command !== "run") usage();
  await run(parseRun(args));
}

main().catch((error) => { console.error(`vigil: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
