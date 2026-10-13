import test from "node:test";
import assert from "node:assert/strict";
import { restoreToolChoices, toolOptions, toolStatus } from "../src/ui/tools.js";
import type { CoverageItem } from "../src/shared/types.js";

test("restored tool choices accept only known tools and tolerate unavailable browser data", () => {
  assert.deepEqual(restoreToolChoices(null), []);
  assert.deepEqual(restoreToolChoices("not-json"), []);
  assert.deepEqual(restoreToolChoices('{"docker-sandboxes":true}'), []);
  assert.deepEqual(restoreToolChoices('["docker-sandboxes", "unknown", "docker-sandboxes", 5, "langfuse"]'), ["docker-sandboxes", "langfuse"]);
});

test("tool selections do not claim real activation or protection", () => {
  const docker = toolOptions.find(tool => tool.id === "docker-sandboxes")!;
  const snyk = toolOptions.find(tool => tool.id === "snyk-agent-scan")!;
  assert.equal(toolStatus(docker, true, false, []), "Selected · setup needed");
  assert.equal(toolStatus(docker, true, true, []), "Active in demo");
  assert.equal(toolStatus(docker, false, true, []), "Off in demo");
  const check: CoverageItem = { id: "session:snyk-agent-scan", name: "Snyk", status: "active", version: null, summary: "Imported results", lastError: null, lastRunAt: null };
  assert.equal(toolStatus(snyk, true, false, [check]), "Results available");
  assert.equal(toolStatus(docker, true, false, [check]), "Selected · setup needed");
});
