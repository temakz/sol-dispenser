const REPORT_FILES = {
  inspect: {
    default: "inspect-report.json",
  },
  prepare: {
    secrets: "secrets-report.json",
    dryRun: "prepare-dry-run-report.json",
    confirm: "prepare-report.json",
  },
  execute: {
    dryRun: "execute-dry-run-report.json",
    confirm: "execute-report.json",
  },
  recover: {
    dryRun: "recover-dry-run-report.json",
    confirm: "recover-report.json",
  },
};

export function reportFileName(command, mode = "default") {
  const commandReports = REPORT_FILES[command];
  if (!commandReports) {
    throw new Error(`Unknown report command: ${command}`);
  }
  const report = commandReports[mode];
  if (!report) {
    throw new Error(`Unknown ${command} report mode: ${mode}`);
  }
  return report;
}

export function inspectLifecycle({ executeReport = null, recoverReport = null } = {}) {
  if (recoverReport?.status === "recovered") {
    return "recovered";
  }
  if (executeReport?.status === "executed") {
    return "executed";
  }
  return "prepared";
}

export function preflightStatus(preflightOk) {
  return preflightOk ? "ok" : "preflight_failed";
}

export function verifiedStatus(successStatus, confirmationOk, verificationOk) {
  return confirmationOk && verificationOk ? successStatus : "verification_failed";
}
