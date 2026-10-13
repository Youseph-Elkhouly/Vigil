import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { VigilDatabase } from "../src/server/database.js";
import type { CoverageItem } from "../src/shared/types.js";

test("legacy coverage migrates and concurrent database connections preserve each session's scanner results", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vigil-db-sessions-"));
  const file = path.join(root, "vigil.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE coverage (id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,version TEXT,summary TEXT NOT NULL,last_error TEXT,last_run_at TEXT); INSERT INTO coverage VALUES ('gitleaks','Gitleaks','active',NULL,'Legacy result',NULL,NULL)");
  old.close();
  const first = new VigilDatabase(file);
  const second = new VigilDatabase(file);
  const check: CoverageItem = { id: "a:gitleaks", sessionId: "a", name: "Gitleaks", status: "checking", version: null, summary: "Checking", lastError: null, lastRunAt: null };
  try {
    assert.equal(first.state().coverage[0]?.sessionId, null);
    first.upsertCoverage(check);
    second.upsertCoverage({ ...check, id: "b:gitleaks", sessionId: "b", status: "failed", lastError: "Scanner failed" });
    first.upsertCoverage({ ...check, status: "active", summary: "No findings" });
    const results = second.state().coverage;
    assert.equal(results.length, 3);
    assert.equal(results.find((item) => item.sessionId === "a")?.status, "active");
    assert.equal(results.find((item) => item.sessionId === "b")?.status, "failed");
    assert.equal(results.find((item) => item.sessionId === "b")?.lastError, "Scanner failed");
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
});
