#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Connection } from "@solana/web3.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const walletDir = join(repoRoot, "target");
const walletPath = join(walletDir, "test-wallet.json");

ensureTestWallet();

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

const buildResult = spawnSync(anchor, ["build"], {
  cwd: repoRoot,
  env: toolEnv(),
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const rpcUrl = "http://127.0.0.1:8899";
const validator = spawn(
  solanaTestValidator,
  [
    "--reset",
    "--quiet",
    "--ledger",
    join(repoRoot, "target", "test-ledger"),
    "--bpf-program",
    "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6",
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
validator.stdout.on("data", (chunk) => {
  validatorOutput += chunk.toString();
});
validator.stderr.on("data", (chunk) => {
  validatorOutput += chunk.toString();
});

try {
  await waitForValidator(rpcUrl);
  const mocha = process.platform === "win32" ? "npx.cmd" : "npx";
  const testResult = spawnSync(mocha, ["mocha", "--timeout", "1000000", "tests/**/*.cjs"], {
    cwd: repoRoot,
    env: {
      ...toolEnv(),
      ANCHOR_PROVIDER_URL: rpcUrl,
      ANCHOR_WALLET: walletPath,
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  process.exitCode = testResult.status ?? 1;
} catch (error) {
  console.error(error.stack || error.message);
  if (validatorOutput.trim()) {
    console.error(validatorOutput);
  }
  process.exitCode = 1;
} finally {
  validator.kill();
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

async function waitForValidator(rpcUrl) {
  const connection = new Connection(rpcUrl, "confirmed");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (validator.exitCode !== null) {
      throw new Error(`solana-test-validator exited early with code ${validator.exitCode}`);
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
