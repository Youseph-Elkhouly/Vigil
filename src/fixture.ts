import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startService } from "./server/service.js";
import { demoState } from "./demo.js";

// Fresh demo data on each launch; live sessions and old fixtures are untouched.
const directory = mkdtempSync(path.join(tmpdir(), "vigil-demo-"));
const state = demoState();
const session = state.sessions[0]!;
const service = await startService({
  port: 4317,
  token: randomBytes(32).toString("base64url"),
  databasePath: path.join(directory, "demo.db"),
  session,
  protectedPaths: [path.join(session.projectPath, "private/guest-list.csv")],
  uiDirectory: path.resolve("dist/ui"),
}).catch((error: unknown) => {
  rmSync(directory, { recursive: true, force: true });
  throw error;
});
state.sessions.forEach((item) => service.database.upsertSession(item));
state.events.forEach((item) => service.database.addEvent(item));
state.findings.forEach((item) => service.database.addFinding(item));
state.coverage.forEach((item) => service.database.upsertCoverage(item));
service.broadcastState();
console.log("Vigil example sessions: http://127.0.0.1:4317");
console.log("Birthday party, holiday photos, and school newsletter. All activity is fictional. Press Ctrl+C to stop.");
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
