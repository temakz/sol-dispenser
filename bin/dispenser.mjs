#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const configPath = join(repoRoot, "dispenser.config.json");
const runsDir = join(repoRoot, "dispenser", "runs");

const defaultConfig = {
  cluster: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  sourceWalletPath: "./wallet.json",
  rescueWallet: "",
  programId: "11111111111111111111111111111111",
  maxSolPerRun: "1.0",
  requireMainnetTypedConfirmation: true,
};

const commands = new Map([
  ["help", commandHelp],
  ["doctor", commandDoctor],
  ["init", commandInit],
]);

async function main() {
  const command = process.argv[2] ?? "help";
  const handler = commands.get(command);

  if (!handler) {
    log("error", `Unknown command: ${command}`);
    commandHelp();
    process.exitCode = 1;
    return;
  }

  await handler(process.argv.slice(3));
}

function commandHelp() {
  console.log(`sol-dispenser

Usage:
  dispenser doctor
  dispenser init [--force]
  dispenser help

Current phase:
  Phase 2 CLI foundation. No command in this phase moves funds.
`);
}

function commandDoctor() {
  const config = loadConfigIfPresent();
  const checks = [
    checkCommand("node", ["--version"], true),
    checkCommand("npm", ["--version"], true),
    checkCommand("git", ["--version"], true),
    checkCommand("cargo", ["--version"], false),
    checkCommand("solana", ["--version"], false),
    checkCommand("anchor", ["--version"], false),
  ];

  const configCheck = {
    name: "config",
    ok: Boolean(config),
    required: false,
    detail: config ? `found ${relative(configPath)}` : "not initialized",
  };
  checks.push(configCheck);

  const requiredFailed = checks.some((check) => check.required && !check.ok);

  printChecks(checks);
  console.log();
  console.log(`Runs directory: ${relative(ensureRunsDir())}`);

  if (config) {
    console.log(`Cluster: ${config.cluster}`);
    console.log(`RPC: ${config.rpcUrl}`);
    console.log(`Program: ${config.programId}`);
  }

  process.exitCode = requiredFailed ? 1 : 0;
}

function commandInit(args) {
  const force = args.includes("--force");

  if (existsSync(configPath) && !force) {
    log("error", `${relative(configPath)} already exists. Use --force to overwrite.`);
    process.exitCode = 1;
    return;
  }

  ensureRunsDir();
  writeJson(configPath, defaultConfig);

  log("info", `Wrote ${relative(configPath)}`);
  log("info", `Created ${relative(runsDir)}`);
  log("warn", "Review sourceWalletPath, rescueWallet, programId, and maxSolPerRun before using later phases.");
}

function checkCommand(command, args, required) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status === 0) {
    return {
      name: command,
      ok: true,
      required,
      detail: firstLine(result.stdout) || firstLine(result.stderr) || "ok",
    };
  }

  return {
    name: command,
    ok: false,
    required,
    detail: "not found or not runnable",
  };
}

function printChecks(checks) {
  for (const check of checks) {
    const mark = check.ok ? "OK " : check.required ? "ERR" : "WARN";
    const required = check.required ? "required" : "optional";
    console.log(`${mark} ${check.name.padEnd(10)} ${required.padEnd(8)} ${check.detail}`);
  }
}

function loadConfigIfPresent() {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    validateConfig(config);
    return config;
  } catch (error) {
    log("error", `Invalid ${relative(configPath)}: ${error.message}`);
    return null;
  }
}

function validateConfig(config) {
  const requiredStrings = [
    "cluster",
    "rpcUrl",
    "sourceWalletPath",
    "rescueWallet",
    "programId",
    "maxSolPerRun",
  ];

  for (const key of requiredStrings) {
    if (typeof config[key] !== "string") {
      throw new Error(`${key} must be a string`);
    }
  }

  if (!["localnet", "devnet", "mainnet-beta"].includes(config.cluster)) {
    throw new Error("cluster must be localnet, devnet, or mainnet-beta");
  }

  if (config.requireMainnetTypedConfirmation !== true) {
    throw new Error("requireMainnetTypedConfirmation must be true");
  }
}

function ensureRunsDir() {
  mkdirSync(runsDir, { recursive: true });
  return runsDir;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function log(level, message) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
  }));
}

function relative(path) {
  return path.replace(`${repoRoot}\\`, "").replace(`${repoRoot}/`, "");
}

function firstLine(value) {
  return String(value ?? "").trim().split(/\r?\n/)[0] ?? "";
}

main().catch((error) => {
  log("error", error.stack || error.message);
  process.exitCode = 1;
});
