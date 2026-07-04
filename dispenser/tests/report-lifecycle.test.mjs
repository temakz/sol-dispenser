import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectLifecycle,
  preflightStatus,
  reportFileName,
  verifiedStatus,
} from "../lib/report-lifecycle.mjs";

test("reportFileName keeps command report paths stable", () => {
  assert.equal(reportFileName("prepare", "secrets"), "secrets-report.json");
  assert.equal(reportFileName("prepare", "dryRun"), "prepare-dry-run-report.json");
  assert.equal(reportFileName("prepare", "confirm"), "prepare-report.json");
  assert.equal(reportFileName("inspect"), "inspect-report.json");
  assert.equal(reportFileName("execute", "dryRun"), "execute-dry-run-report.json");
  assert.equal(reportFileName("execute", "confirm"), "execute-report.json");
  assert.equal(reportFileName("recover", "dryRun"), "recover-dry-run-report.json");
  assert.equal(reportFileName("recover", "confirm"), "recover-report.json");
});

test("reportFileName rejects unknown lifecycle states", () => {
  assert.throws(() => reportFileName("unknown"), /Unknown report command/);
  assert.throws(() => reportFileName("execute", "secrets"), /Unknown execute report mode/);
});

test("inspectLifecycle prefers the latest completed lifecycle stage", () => {
  assert.equal(inspectLifecycle(), "prepared");
  assert.equal(inspectLifecycle({
    executeReport: { status: "preflight_failed" },
    recoverReport: { status: "preflight_failed" },
  }), "prepared");
  assert.equal(inspectLifecycle({
    executeReport: { status: "executed" },
  }), "executed");
  assert.equal(inspectLifecycle({
    executeReport: { status: "executed" },
    recoverReport: { status: "recovered" },
  }), "recovered");
  assert.equal(inspectLifecycle({
    recoverReport: { status: "recovered" },
  }), "recovered");
});

test("status helpers preserve report status vocabulary", () => {
  assert.equal(preflightStatus(true), "ok");
  assert.equal(preflightStatus(false), "preflight_failed");
  assert.equal(verifiedStatus("prepared", true, true), "prepared");
  assert.equal(verifiedStatus("executed", false, true), "verification_failed");
  assert.equal(verifiedStatus("recovered", true, false), "verification_failed");
});
