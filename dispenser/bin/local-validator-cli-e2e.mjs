#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Connection, Keypair } from "@solana/web3.js";

const PROGRAM_ID = "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6";
const PASSPHRASE = "local-validator-e2e-passphrase";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const walletDir = join(repoRoot, "target");
const walletPath = join(walletDir, "test-wallet.json");
const configPath = join(repoRoot, "dispenser.config.json");
const ledgerDir = process.env.DISPENSER_TEST_LEDGER_DIR || join(tmpdir(), "sol-dispenser-cli-e2e-ledger");
const rpcUrl = "http://127.0.0.1:8899";

ensureTestWallet();
const source = readTestWallet();
const sourceWallet = source.publicKey.toBase58();
const anchor = findAnchor();
if (!anchor) {
  console.error("Anchor CLI not found. Run `npm run doctor` and fix the Anchor toolchain first.");
  process.exit(1);
}

const solanaTestValidator = findTool("solana-test-validator");
if (!solanaTestValidator) {
  console.error("solana-test-validator not found. Run `npm run doctor` and fix the Solana toolchain first.");
  process.exit(1);
}

const buildResult = spawnSync(anchor, ["build", "--ignore-keys"], {
  cwd: repoRoot,
  env: toolEnv(),
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

resetLedgerDir();
console.log(`Using test ledger: ${ledgerDir}`);
const validator = spawn(
  solanaTestValidator,
  [
    "--reset",
    "--quiet",
    "--ledger",
    ledgerDir,
    "--mint",
    sourceWallet,
    "--bpf-program",
    PROGRAM_ID,
    join(repoRoot, "target", "deploy", "sol_dispenser.so"),
  ],
  {
    cwd: repoRoot,
    env: toolEnv(),
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let validatorOutput = "";
let runDirToCleanup = "";
let succeeded = false;
const originalConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;

validator.stdout.on("data", (chunk) => {
  validatorOutput += chunk.toString();
});
validator.stderr.on("data", (chunk) => {
  validatorOutput += chunk.toString();
});

try {
  await waitForValidator(rpcUrl, validator);
  writeTestConfig();

  const recipientOne = Keypair.generate().publicKey.toBase58();
  const recipientTwo = Keypair.generate().publicKey.toBase58();
  const planOutput = runCli([
    "plan",
    "--total",
    "0.003",
    "--wallets",
    "2",
    "--recipient",
    `${recipientOne}:0.001`,
    "--recipient",
    `${recipientTwo}:0.002`,
  ]);
  const runId = parseRunId(planOutput);
  runDirToCleanup = join(repoRoot, "runs", runId);

  runCli(["prepare", "--run", runId, "--secrets-only"]);
  runCli(["prepare", "--run", runId, "--dry-run"]);
  runCli(["prepare", "--run", runId, "--confirm"]);
  runCli(["inspect", "--run", runId]);
  runCli(["execute", "--run", runId, "--dry-run"]);
  runCli(["execute", "--run", runId, "--confirm"]);
  runCli(["recover", "--run", runId, "--dry-run"]);
  runCli(["recover", "--run", runId, "--confirm"]);
  runCli(["inspect", "--run", runId]);

  assertReport(runId, "prepare-report.json", { status: "prepared" });
  assertReport(runId, "execute-dry-run-report.json", { status: "ok" });
  assertReport(runId, "execute-report.json", { status: "executed" });
  assertReport(runId, "recover-dry-run-report.json", { status: "ok" });
  assertReport(runId, "recover-report.json", { status: "recovered" });
  assertReport(runId, "inspect-report.json", { status: "ok", lifecycle: "recovered" });

  console.log(`CLI local-validator E2E passed for run ${runId}`);
  succeeded = true;
} catch (error) {
  console.error(error.stack || error.message);
  if (validatorOutput.trim()) {
    console.error(validatorOutput);
    printValidatorHint(validatorOutput);
  }
  process.exitCode = 1;
} finally {
  validator.kill();
  restoreConfig(originalConfig);
  if (succeeded && runDirToCleanup) {
    rmSync(runDirToCleanup, { recursive: true, force: true });
  }
}

function runCli(args) {
  console.log(`$ dispenser ${args.join(" ")}`);
  const result = spawnSync(process.execPath, [join(repoRoot, "bin", "dispenser.mjs"), ...args], {
    cwd: repoRoot,
    env: {
      ...toolEnv(),
      DISPENSER_PASSPHRASE: PASSPHRASE,
    },
    encoding: "utf8",
  });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  if (result.status !== 0) {
    throw new Error(`dispenser ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

function parseRunId(output) {
  const match = output.match(/^Run:\s+(\S+)$/m);
  if (!match) {
    throw new Error("Plan output did not contain a run id");
  }
  return match[1];
}

function assertReport(runId, fileName, expected) {
  const reportPath = join(repoRoot, "runs", runId, fileName);
  if (!existsSync(reportPath)) {
    throw new Error(`Expected report was not written: ${reportPath}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  for (const [key, value] of Object.entries(expected)) {
    if (report[key] !== value) {
      throw new Error(`${fileName} expected ${key}=${value}, observed ${report[key]}`);
    }
  }
}

function writeTestConfig() {
  writeJson(configPath, {
    cluster: "localnet",
    rpcUrl,
    sourceWalletPath: "./target/test-wallet.json",
    rescueWallet: sourceWallet,
    programId: PROGRAM_ID,
    maxSolPerRun: "0.01",
    requireMainnetTypedConfirmation: true,
  });
}

function restoreConfig(original) {
  if (original === null) {
    rmSync(configPath, { force: true });
    return;
  }
  writeFileSync(configPath, original);
}

function ensureTestWallet() {
  mkdirSync(walletDir, { recursive: true });
  if (existsSync(walletPath)) {
    return;
  }

  const seed = randomBytes(32);
  const publicKey = publicKeyFromSeed(seed);
  const secretKey = [...seed, ...publicKey];
  writeFileSync(walletPath, `${JSON.stringify(secretKey)}\n`, { mode: 0o600 });
}

function readTestWallet() {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8"))));
}

function resetLedgerDir() {
  rmSync(ledgerDir, { recursive: true, force: true });
}

function printValidatorHint(output) {
  if (
    output.includes("Failed to create ledger") &&
    output.includes("Error checking to unpack genesis archive") &&
    output.includes("os error 5")
  ) {
    console.error(
      [
        "",
        "solana-test-validator could not unpack its genesis archive because Windows denied filesystem access.",
        "Run this test under WSL/Linux using the solana-ubuntu path in SESSION_PROTOCOL.md.",
      ].join("\n")
    );
  }
}

function findAnchor() {
  const candidates = [
    "anchor",
    join(process.env.USERPROFILE ?? "", ".avm", "bin", "anchor-1.1.2.exe"),
  ];

  return findToolFromCandidates(candidates);
}

function findTool(name) {
  return findToolFromCandidates([name]);
}

function findToolFromCandidates(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: toolEnv(),
      shell: process.platform === "win32",
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

async function waitForValidator(url, childProcess) {
  const connection = new Connection(url, "confirmed");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (childProcess.exitCode !== null) {
      throw new Error(`solana-test-validator exited early with code ${childProcess.exitCode}`);
    }
    try {
      await connection.getVersion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for solana-test-validator");
}

function toolEnv() {
  const pathEntries = [
    join(process.env.USERPROFILE ?? "", ".cargo", "bin"),
    join(
      process.env.USERPROFILE ?? "",
      ".local",
      "share",
      "solana",
      "install",
      "releases",
      "3.1.10",
      "solana-release",
      "bin"
    ),
  ];
  const currentPath = process.env.PATH || process.env.Path || "";
  const pathValue = [...pathEntries, currentPath].filter(Boolean).join(delimiter);
  return {
    ...process.env,
    PATH: pathValue,
    Path: pathValue,
  };
}

function publicKeyFromSeed(seed) {
  const privateKeyDerPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const publicKeyDerPrefixLength = 12;
  const privateKey = createPrivateKey({
    key: Buffer.concat([privateKeyDerPrefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  return [...publicKey.subarray(publicKeyDerPrefixLength)];
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
