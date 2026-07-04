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

const FORBIDDEN_REPORT_KEYS = new Set([
  "ciphertext",
  "disposableSeed",
  "iv",
  "nonceSeed",
  "passphrase",
  "privateKey",
  "salt",
  "secretKey",
  "seed",
  "tag",
]);

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

export function assertReportHasNoSecretMaterial(report, path = "report") {
  const issues = [];
  scanReportValue(report, path, issues);
  if (issues.length > 0) {
    throw new Error(`Refusing to write report with secret material: ${issues.join(", ")}`);
  }
}

function scanReportValue(value, path, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanReportValue(item, `${path}[${index}]`, issues));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_REPORT_KEYS.has(key)) {
      issues.push(childPath);
      continue;
    }
    scanReportValue(child, childPath, issues);
  }
}
