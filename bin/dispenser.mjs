#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  scryptSync,
} from "node:crypto";

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
  ["plan", commandPlan],
  ["prepare", commandPrepare],
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
  dispenser plan [--total SOL] [--wallets N] [--recipient ADDRESS:SOL]
  dispenser prepare --run RUN_ID --secrets-only
  dispenser help

Current phase:
  Phase 4 secret vault. No command in this phase moves funds.
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

async function commandPlan(args) {
  const flags = parseFlags(args);
  const config = loadConfigIfPresent() ?? defaultConfig;
  const answers = await collectPlanInput(flags);
  const recipients = answers.recipients.map((recipient, index) => ({
    index,
    address: recipient.address,
    amountLamports: parseSolToLamports(recipient.amountSol).toString(),
    amountSol: formatLamports(parseSolToLamports(recipient.amountSol)),
  }));

  const totalLamports = parseSolToLamports(answers.totalSol);
  const recipientTotal = recipients.reduce(
    (sum, recipient) => sum + BigInt(recipient.amountLamports),
    0n
  );

  if (recipientTotal !== totalLamports) {
    throw new Error(
      `Recipient total ${formatLamports(recipientTotal)} SOL does not match total ${formatLamports(totalLamports)} SOL`
    );
  }

  const walletCount = Number.parseInt(answers.wallets, 10);
  if (!Number.isSafeInteger(walletCount) || walletCount <= 0) {
    throw new Error("wallets must be a positive integer");
  }

  if (walletCount !== recipients.length) {
    throw new Error("wallet count must match recipient count in the current Phase 3 plan format");
  }

  const runId = createRunId();
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: false });

  const plan = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    cluster: config.cluster,
    rpcUrl: config.rpcUrl,
    sourceWalletPath: config.sourceWalletPath,
    rescueWallet: config.rescueWallet,
    programId: config.programId,
    durableNonce: true,
    walletCount,
    totalLamports: totalLamports.toString(),
    totalSol: formatLamports(totalLamports),
    recipients,
    status: "planned",
  };

  validatePlan(plan);
  writeJson(join(runDir, "bundle-plan.json"), plan);

  console.log(`Run: ${runId}`);
  console.log(`Plan: ${relative(join(runDir, "bundle-plan.json"))}`);
  console.log(`Cluster: ${plan.cluster}`);
  console.log(`Total: ${plan.totalSol} SOL (${plan.totalLamports} lamports)`);
  for (const recipient of recipients) {
    console.log(`Recipient ${recipient.index + 1}: ${recipient.address} -> ${recipient.amountSol} SOL`);
  }
}

function commandPrepare(args) {
  const flags = parsePrepareFlags(args);
  if (!flags.secretsOnly) {
    throw new Error("Phase 4 supports only: dispenser prepare --run RUN_ID --secrets-only");
  }

  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before generating secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, "secrets-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (existsSync(secretsPath) && !flags.force) {
    throw new Error(`${relative(secretsPath)} already exists. Use --force to overwrite.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);

  const secrets = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    accounts: plan.recipients.map((recipient) => {
      const disposableSeed = randomBytes(32);
      const nonceSeed = randomBytes(32);
      return {
        index: recipient.index,
        recipient: recipient.address,
        amountLamports: recipient.amountLamports,
        disposablePublicKey: publicKeyFromSeed(disposableSeed),
        disposableSeed: disposableSeed.toString("base64"),
        noncePublicKey: publicKeyFromSeed(nonceSeed),
        nonceSeed: nonceSeed.toString("base64"),
      };
    }),
  };

  const encrypted = encryptJson(secrets, passphrase);
  writeJson(secretsPath, encrypted);

  const decrypted = decryptJson(encrypted, passphrase);
  verifySecrets(plan, decrypted);

  const report = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    secretsFile: relative(secretsPath),
    accounts: decrypted.accounts.map((account) => ({
      index: account.index,
      recipient: account.recipient,
      amountLamports: account.amountLamports,
      disposablePublicKey: account.disposablePublicKey,
      noncePublicKey: account.noncePublicKey,
    })),
  };
  writeJson(reportPath, report);

  console.log(`Run: ${runId}`);
  console.log(`Secrets: ${relative(secretsPath)}`);
  console.log(`Report: ${relative(reportPath)}`);
  for (const account of report.accounts) {
    console.log(`Account ${account.index + 1}: disposable=${account.disposablePublicKey} nonce=${account.noncePublicKey}`);
  }
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

async function collectPlanInput(flags) {
  if (flags.total && flags.wallets && flags.recipient.length > 0) {
    return {
      totalSol: flags.total,
      wallets: flags.wallets,
      recipients: flags.recipient.map(parseRecipientFlag),
    };
  }

  const rl = createInterface({ input, output });
  try {
    const totalSol = await rl.question("Total SOL: ");
    const wallets = await rl.question("Disposable wallet count: ");
    const walletCount = Number.parseInt(wallets, 10);
    if (!Number.isSafeInteger(walletCount) || walletCount <= 0) {
      throw new Error("Disposable wallet count must be a positive integer");
    }

    const recipients = [];
    for (let index = 0; index < walletCount; index += 1) {
      const address = await rl.question(`Recipient ${index + 1} address: `);
      const amountSol = await rl.question(`Recipient ${index + 1} SOL amount: `);
      recipients.push({ address, amountSol });
    }

    return { totalSol, wallets, recipients };
  } finally {
    rl.close();
  }
}

function parseFlags(args) {
  const flags = {
    total: "",
    wallets: "",
    recipient: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--total") {
      flags.total = requireValue(args, index);
      index += 1;
    } else if (arg === "--wallets") {
      flags.wallets = requireValue(args, index);
      index += 1;
    } else if (arg === "--recipient") {
      flags.recipient.push(requireValue(args, index));
      index += 1;
    } else {
      throw new Error(`Unknown plan flag: ${arg}`);
    }
  }

  return flags;
}

function parsePrepareFlags(args) {
  const flags = {
    run: "",
    secretsOnly: false,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") {
      flags.run = requireValue(args, index);
      index += 1;
    } else if (arg === "--secrets-only") {
      flags.secretsOnly = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else {
      throw new Error(`Unknown prepare flag: ${arg}`);
    }
  }

  if (!flags.run) {
    throw new Error("prepare requires --run RUN_ID");
  }

  return flags;
}

function requireValue(args, index) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${args[index]} requires a value`);
  }
  return value;
}

function parseRecipientFlag(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Recipient must use ADDRESS:SOL format: ${value}`);
  }
  return {
    address: value.slice(0, separator),
    amountSol: value.slice(separator + 1),
  };
}

function validatePlan(plan) {
  if (plan.schemaVersion !== 1) {
    throw new Error("Unsupported plan schema version");
  }
  if (!["localnet", "devnet", "mainnet-beta"].includes(plan.cluster)) {
    throw new Error("Invalid cluster");
  }
  if (!isSolanaPubkey(plan.programId)) {
    throw new Error("Invalid program id");
  }
  if (plan.rescueWallet && !isSolanaPubkey(plan.rescueWallet)) {
    throw new Error("Invalid rescue wallet");
  }
  if (plan.walletCount !== plan.recipients.length) {
    throw new Error("walletCount must equal recipients length");
  }

  const total = BigInt(plan.totalLamports);
  const recipientTotal = plan.recipients.reduce((sum, recipient) => {
    if (!isSolanaPubkey(recipient.address)) {
      throw new Error(`Invalid recipient address: ${recipient.address}`);
    }
    const amount = BigInt(recipient.amountLamports);
    if (amount <= 0n) {
      throw new Error("Recipient amount must be greater than zero");
    }
    return sum + amount;
  }, 0n);

  if (total <= 0n) {
    throw new Error("Total amount must be greater than zero");
  }
  if (recipientTotal !== total) {
    throw new Error("Recipient amounts must sum to total");
  }
}

function verifySecrets(plan, secrets) {
  if (secrets.schemaVersion !== 1) {
    throw new Error("Unsupported secrets schema version");
  }
  if (secrets.runId !== plan.runId) {
    throw new Error("Secrets runId does not match plan");
  }
  if (!Array.isArray(secrets.accounts) || secrets.accounts.length !== plan.recipients.length) {
    throw new Error("Secrets account count does not match plan");
  }

  for (const account of secrets.accounts) {
    const recipient = plan.recipients[account.index];
    if (!recipient) {
      throw new Error(`Unexpected secret account index: ${account.index}`);
    }
    if (recipient.address !== account.recipient) {
      throw new Error(`Secret recipient mismatch at index ${account.index}`);
    }
    if (recipient.amountLamports !== account.amountLamports) {
      throw new Error(`Secret amount mismatch at index ${account.index}`);
    }

    const disposableSeed = Buffer.from(account.disposableSeed, "base64");
    const nonceSeed = Buffer.from(account.nonceSeed, "base64");
    if (publicKeyFromSeed(disposableSeed) !== account.disposablePublicKey) {
      throw new Error(`Disposable public key mismatch at index ${account.index}`);
    }
    if (publicKeyFromSeed(nonceSeed) !== account.noncePublicKey) {
      throw new Error(`Nonce public key mismatch at index ${account.index}`);
    }
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

function parseSolToLamports(value) {
  const text = String(value).trim();
  if (!/^[0-9]+(\.[0-9]{1,9})?$/.test(text)) {
    throw new Error(`Invalid SOL amount: ${value}`);
  }

  const [whole, fractional = ""] = text.split(".");
  const lamportsText = `${whole}${fractional.padEnd(9, "0")}`.replace(/^0+(?=\d)/, "");
  return BigInt(lamportsText || "0");
}

function formatLamports(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fractional = value % 1_000_000_000n;
  const fractionalText = fractional.toString().padStart(9, "0").replace(/0+$/, "");
  return fractionalText ? `${whole}.${fractionalText}` : whole.toString();
}

function isSolanaPubkey(value) {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

function decodeBase58(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [];

  for (const char of value) {
    const carryStart = alphabet.indexOf(char);
    if (carryStart < 0) {
      throw new Error("Invalid base58 character");
    }

    let carry = carryStart;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char === "1") {
      bytes.push(0);
    } else {
      break;
    }
  }

  return bytes.reverse();
}

function createRunId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function encryptJson(value, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    schemaVersion: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptJson(encrypted, passphrase) {
  const key = scryptSync(passphrase, Buffer.from(encrypted.salt, "base64"), 32);
  const decipher = createDecipheriv(
    encrypted.cipher,
    key,
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function publicKeyFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error("Ed25519 seed must be exactly 32 bytes");
  }

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
  return encodeBase58(publicKey.subarray(publicKeyDerPrefixLength));
}

function encodeBase58(buffer) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];

  for (const byte of buffer) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (const byte of buffer) {
    if (byte === 0) {
      result += "1";
    } else {
      break;
    }
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += alphabet[digits[index]];
  }

  return result;
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
