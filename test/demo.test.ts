import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoState } from "../src/demo.js";
import { VigilDatabase } from "../src/server/database.js";
import { dashboardScope } from "../src/ui/dashboard.js";
import { activityTitle, activityExplanation } from "../src/ui/labels.js";

test("everyday demo survives storage and each card opens only its own example", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vigil-demo-test-"));
  const database = new VigilDatabase(path.join(directory, "demo.db"));
  try {
    const demo = demoState();
    demo.sessions.forEach(s => database.upsertSession(s));
    demo.events.forEach(e => database.addEvent(e));
    demo.findings.forEach(f => database.addFinding(f));
    demo.coverage.forEach(c => database.upsertCoverage(c));
    const stored = database.state();
    assert.equal(stored.sessions.length, 3);
    assert.deepEqual(new Set(stored.sessions.map(s => s.status)), new Set(["running", "ended", "failed"]));
    assert.ok(stored.sessions.every(s => s.simulated));
    assert.ok(stored.events.every(e => e.simulated));
    assert.ok(stored.findings.every(f => f.simulated));
    for (const session of stored.sessions) {
      const scope = dashboardScope(stored, session.id);
      assert.ok(scope.events.length > 0);
      assert.ok(scope.coverage.length > 0);
      for (const finding of scope.findings) assert.ok(scope.events.some(e => e.id === finding.eventId));
      for (const event of scope.events) {
        assert.doesNotMatch(activityTitle(event), /exec_command|tool|policy|credential/);
        assert.ok(activityExplanation(event).length > 0);
      }
    }
    const party = dashboardScope(stored, "demo-birthday");
    assert.equal(party.events.find(e => e.id === "demo-birthday-private")?.decision, "denied");
    assert.equal(dashboardScope(stored, "demo-photos").findings.length, 0);
    assert.match(dashboardScope(stored, "demo-newsletter").findings[0]!.evidence, /not a security alert/);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("demo wording cannot hide the recorded outcome of a live event", () => {
  const event = demoState().events.find(e => e.decision === "denied")!;
  const live = { ...event, simulated: false, input: { demo: { title: "Everything is fine", description: "Access granted" } } };
  assert.match(activityTitle(live), /blocked/);
  assert.match(activityExplanation(live), /denied/);
});
