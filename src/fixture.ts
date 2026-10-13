import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoState } from "./demo.js";
import { startService } from "./server/service.js";

const directory = mkdtempSync(path.join(tmpdir(), "vigil-demo-"));
const state = demoState();
const session = state.sessions[0]!;
const service = await startService({
  port: 4317, token: randomBytes(32).toString("base64url"), databasePath: path.join(directory, "demo.db"),
  session, protectedPaths: [], uiDirectory: path.resolve("dist/ui"),
}).catch((error: unknown) => { rmSync(directory, { recursive: true, force: true }); throw error; });
state.events.forEach(event => service.database.addEvent(event));
state.findings.forEach(finding => service.database.addFinding(finding));
state.coverage.forEach(check => service.database.upsertCoverage(check));
service.broadcastState();
console.log("One fictional Vigil demo session: http://127.0.0.1:4317");
console.log("Open the café website card under Vulnerable. No real files are read or changed. Press Ctrl+C to stop.");
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await service.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
