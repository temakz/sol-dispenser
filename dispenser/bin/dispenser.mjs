#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { randomBytes } from "node:crypto";
import {
  checkedNumberFromLamports,
  createRunId,
  decryptJson,
  encryptJson,
  formatLamports,
  parseExecuteFlags,
  parsePrepareFlags,
  parseRecipientFlag,
  parseSolToLamports,
  publicKeyFromSeed,
  requireValue,
  validateConfig,
  validatePlan,
  verifySecrets,
} from "../lib/cli-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const configPath = join(repoRoot, "dispenser.config.json");
const runsDir = join(repoRoot, "runs");
const RECENT_BLOCKHASHES_SYSVAR_ADDRESS = "SysvarRecentB1ockHashes11111111111111111111";
const FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR = Buffer.from([249, 121, 48, 67, 237, 244, 65, 234]);

const defaultConfig = {
  cluster: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  sourceWalletPath: "./wallet.json",
  rescueWallet: "",
  programId: "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6",
  maxSolPerRun: "1.0",
  requireMainnetTypedConfirmation: true,
};

const commands = new Map([
  ["help", commandHelp],
  ["doctor", commandDoctor],
  ["init", commandInit],
  ["plan", commandPlan],
  ["prepare", commandPrepare],
  ["inspect", commandInspect],
  ["execute", commandExecute],
  ["recover", commandRecover],
  ["build-program", commandBuildProgram],
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
  dispenser prepare --run RUN_ID --dry-run
  dispenser prepare --run RUN_ID --confirm
  dispenser inspect --run RUN_ID
  dispenser execute --run RUN_ID --dry-run
  dispenser execute --run RUN_ID --confirm
  dispenser recover --run RUN_ID --dry-run
  dispenser recover --run RUN_ID --confirm
  dispenser build-program
  dispenser help

Current phase:
  Phase 6 inspect flow. Prepare remains gated by --dry-run and --confirm.
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
    checkTool("anchor", anchorCandidates(), false),
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

function commandBuildProgram() {
  const anchor = findRunnableTool(anchorCandidates());
  if (!anchor) {
    log("error", "Anchor CLI not found. Run dispenser doctor and fix the Anchor toolchain first.");
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(anchor.command, ["build"], {
    cwd: repoRoot,
    env: toolEnv(),
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  process.exitCode = result.status ?? 1;
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

async function commandPrepare(args) {
  const flags = parsePrepareFlags(args);
  const modeCount = [flags.secretsOnly, flags.dryRun, flags.confirm].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error("prepare accepts only one mode at a time: --secrets-only, --dry-run, or --confirm");
  }
  if (flags.dryRun) {
    await commandPrepareDryRun(flags);
    return;
  }
  if (flags.confirm) {
    await commandPrepareSubmit(flags);
    return;
  }
  if (!flags.secretsOnly) {
    throw new Error("Phase 5 supports: dispenser prepare --run RUN_ID --dry-run or --confirm");
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

async function commandPrepareDryRun(flags) {
  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before decrypting secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, "prepare-dry-run-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (!existsSync(secretsPath)) {
    throw new Error(`Secrets not found: ${relative(secretsPath)}. Run prepare --secrets-only first.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);
  const encrypted = JSON.parse(readFileSync(secretsPath, "utf8"));
  const secrets = decryptJson(encrypted, passphrase);
  verifySecrets(plan, secrets);

  const {
    Connection,
    Keypair,
    NONCE_ACCOUNT_LENGTH,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
  } = await loadWeb3();
  const connection = new Connection(plan.rpcUrl, "confirmed");
  const source = loadSourceKeypair(plan.sourceWalletPath, Keypair);
  const sourceWallet = source.publicKey.toBase58();
  const programId = new PublicKey(plan.programId);
  const recentBlockhashesSysvar = new PublicKey(RECENT_BLOCKHASHES_SYSVAR_ADDRESS);
  const bundle = secrets.accounts.map((account) => ({
    index: account.index,
    recipient: account.recipient,
    amountLamports: BigInt(account.amountLamports),
    disposable: keypairFromSeed(account.disposableSeed, Keypair),
    nonce: keypairFromSeed(account.nonceSeed, Keypair),
  }));

  const nonceRentLamports = BigInt(
    await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, "confirmed")
  );
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = buildFundBundleTransaction({
    plan,
    programId,
    source,
    bundle,
    recentBlockhash: latestBlockhash.blockhash,
    recentBlockhashesSysvar,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
  });
  const feeResult = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  const estimatedFeeLamports = BigInt(feeResult.value ?? estimateSignatureFeeLamports(transaction));
  const sourceBalanceLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const totalOutputLamports = BigInt(plan.totalLamports);
  const totalNonceRentLamports = nonceRentLamports * BigInt(bundle.length);
  const totalRequiredLamports = totalOutputLamports + totalNonceRentLamports + estimatedFeeLamports;
  const sourceBalanceOk = sourceBalanceLamports >= totalRequiredLamports;
  const accountPreflight = await inspectPrepareAccounts(connection, bundle, SystemProgram);
  const accountIssues = accountPreflight.filter((account) => !account.ok);

  let simulation = {
    attempted: false,
    ok: false,
    error: null,
    logs: [],
  };

  if (sourceBalanceOk && accountIssues.length === 0) {
    const simulationResult = await connection.simulateTransaction(transaction, [
      source,
      ...uniqueBundleSigners(bundle),
    ]);
    simulation = {
      attempted: true,
      ok: simulationResult.value.err === null,
      error: simulationResult.value.err,
      logs: simulationResult.value.logs ?? [],
    };
  }

  const report = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    mode: "dry-run",
    cluster: plan.cluster,
    rpcUrl: plan.rpcUrl,
    sourceWallet,
    programId: plan.programId,
    walletCount: plan.walletCount,
    totalOutputLamports: totalOutputLamports.toString(),
    totalOutputSol: formatLamports(totalOutputLamports),
    nonceRentLamports: nonceRentLamports.toString(),
    totalNonceRentLamports: totalNonceRentLamports.toString(),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    totalRequiredLamports: totalRequiredLamports.toString(),
    totalRequiredSol: formatLamports(totalRequiredLamports),
    sourceBalanceLamports: sourceBalanceLamports.toString(),
    sourceBalanceSol: formatLamports(sourceBalanceLamports),
    sourceBalanceOk,
    accountPreflight,
    transaction: {
      signerCount: 1 + uniqueBundleSigners(bundle).length,
      instructionCount: transaction.instructions.length,
    },
    simulation,
  };
  writeJson(reportPath, report);

  console.log(`Run: ${runId}`);
  console.log("Mode: dry-run");
  console.log(`Cluster: ${plan.cluster}`);
  console.log(`Source: ${sourceWallet}`);
  console.log(`Program: ${plan.programId}`);
  console.log(`Total output: ${formatLamports(totalOutputLamports)} SOL (${totalOutputLamports} lamports)`);
  console.log(`Nonce rent: ${formatLamports(totalNonceRentLamports)} SOL (${totalNonceRentLamports} lamports)`);
  console.log(`Estimated fees: ${formatLamports(estimatedFeeLamports)} SOL (${estimatedFeeLamports} lamports)`);
  console.log(`Total required: ${formatLamports(totalRequiredLamports)} SOL (${totalRequiredLamports} lamports)`);
  console.log(`Source balance: ${formatLamports(sourceBalanceLamports)} SOL (${sourceBalanceLamports} lamports)`);
  console.log(`Report: ${relative(reportPath)}`);

  if (!sourceBalanceOk) {
    log("error", "Source balance is too low for total output, nonce rent, and estimated fees.");
    process.exitCode = 1;
  }
  if (accountIssues.length > 0) {
    log("error", `Account preflight failed for ${accountIssues.length} generated account(s).`);
    process.exitCode = 1;
  }
  if (simulation.attempted && !simulation.ok) {
    log("error", "Transaction simulation failed. Inspect prepare-dry-run-report.json for details.");
    process.exitCode = 1;
  }
  if (simulation.ok) {
    log("info", "Transaction simulation passed. No transaction was sent.");
  }
}

async function commandPrepareSubmit(flags) {
  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before decrypting secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, "prepare-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (!existsSync(secretsPath)) {
    throw new Error(`Secrets not found: ${relative(secretsPath)}. Run prepare --secrets-only first.`);
  }
  if (existsSync(reportPath) && !flags.force) {
    throw new Error(`${relative(reportPath)} already exists. Use --force to overwrite.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);
  requirePrepareConfirmation(plan, flags);

  const encrypted = JSON.parse(readFileSync(secretsPath, "utf8"));
  const secrets = decryptJson(encrypted, passphrase);
  verifySecrets(plan, secrets);

  const {
    Connection,
    Keypair,
    NONCE_ACCOUNT_LENGTH,
    NonceAccount,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
  } = await loadWeb3();
  const connection = new Connection(plan.rpcUrl, "confirmed");
  const source = loadSourceKeypair(plan.sourceWalletPath, Keypair);
  const sourceWallet = source.publicKey.toBase58();
  const programId = new PublicKey(plan.programId);
  const recentBlockhashesSysvar = new PublicKey(RECENT_BLOCKHASHES_SYSVAR_ADDRESS);
  const bundle = secrets.accounts.map((account) => ({
    index: account.index,
    recipient: account.recipient,
    amountLamports: BigInt(account.amountLamports),
    disposable: keypairFromSeed(account.disposableSeed, Keypair),
    nonce: keypairFromSeed(account.nonceSeed, Keypair),
  }));

  const nonceRentLamports = BigInt(
    await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, "confirmed")
  );
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = buildFundBundleTransaction({
    plan,
    programId,
    source,
    bundle,
    recentBlockhash: latestBlockhash.blockhash,
    recentBlockhashesSysvar,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
  });
  const feeResult = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  const estimatedFeeLamports = BigInt(feeResult.value ?? estimateSignatureFeeLamports(transaction));
  const sourceBalanceBeforeLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const totalOutputLamports = BigInt(plan.totalLamports);
  const totalNonceRentLamports = nonceRentLamports * BigInt(bundle.length);
  const totalRequiredLamports = totalOutputLamports + totalNonceRentLamports + estimatedFeeLamports;
  const sourceBalanceOk = sourceBalanceBeforeLamports >= totalRequiredLamports;
  const accountPreflight = await inspectPrepareAccounts(connection, bundle, SystemProgram);
  const accountIssues = accountPreflight.filter((account) => !account.ok);
  const signers = [source, ...uniqueBundleSigners(bundle)];

  transaction.sign(...signers);
  const simulationResult = sourceBalanceOk && accountIssues.length === 0
    ? await connection.simulateTransaction(transaction, signers)
    : null;
  const simulation = simulationResult
    ? {
      attempted: true,
      ok: simulationResult.value.err === null,
      error: simulationResult.value.err,
      logs: simulationResult.value.logs ?? [],
    }
    : {
      attempted: false,
      ok: false,
      error: null,
      logs: [],
    };

  const baseReport = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    mode: "prepare",
    cluster: plan.cluster,
    rpcUrl: plan.rpcUrl,
    sourceWallet,
    programId: plan.programId,
    walletCount: plan.walletCount,
    totalOutputLamports: totalOutputLamports.toString(),
    totalOutputSol: formatLamports(totalOutputLamports),
    nonceRentLamports: nonceRentLamports.toString(),
    totalNonceRentLamports: totalNonceRentLamports.toString(),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    totalRequiredLamports: totalRequiredLamports.toString(),
    totalRequiredSol: formatLamports(totalRequiredLamports),
    sourceBalanceBeforeLamports: sourceBalanceBeforeLamports.toString(),
    sourceBalanceBeforeSol: formatLamports(sourceBalanceBeforeLamports),
    sourceBalanceOk,
    accountPreflight,
    transaction: {
      signerCount: signers.length,
      instructionCount: transaction.instructions.length,
    },
    simulation,
  };

  if (!sourceBalanceOk || accountIssues.length > 0 || !simulation.ok) {
    writeJson(reportPath, {
      ...baseReport,
      status: "preflight_failed",
      signature: null,
    });
    console.log(`Run: ${runId}`);
    console.log("Status: preflight_failed");
    console.log(`Report: ${relative(reportPath)}`);
    process.exitCode = 1;
    return;
  }

  let signature = null;
  let confirmation = null;
  let transactionInfo = null;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    confirmation = await connection.confirmTransaction({
      signature,
      ...latestBlockhash,
    }, "confirmed");
    transactionInfo = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (error) {
    writeJson(reportPath, {
      ...baseReport,
      status: "send_failed",
      signature,
      sendError: error.stack || error.message,
    });
    console.log(`Run: ${runId}`);
    console.log("Status: send_failed");
    console.log(`Signature: ${signature ?? "not submitted"}`);
    console.log(`Report: ${relative(reportPath)}`);
    process.exitCode = 1;
    return;
  }

  const sourceBalanceAfterLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const verification = await verifyPreparedAccounts(
    connection,
    bundle,
    nonceRentLamports,
    NonceAccount,
    SystemProgram
  );
  const verificationOk = verification.every((check) => check.ok);
  const confirmationOk = !confirmation.value.err;
  const status = confirmationOk && verificationOk ? "prepared" : "verification_failed";

  writeJson(reportPath, {
    ...baseReport,
    status,
    signature,
    confirmation,
    actualFeeLamports: String(transactionInfo?.meta?.fee ?? ""),
    sourceBalanceAfterLamports: sourceBalanceAfterLamports.toString(),
    sourceBalanceAfterSol: formatLamports(sourceBalanceAfterLamports),
    verification,
  });

  console.log(`Run: ${runId}`);
  console.log(`Status: ${status}`);
  console.log(`Signature: ${signature}`);
  console.log(`Report: ${relative(reportPath)}`);

  if (status !== "prepared") {
    process.exitCode = 1;
  }
}

async function commandInspect(args) {
  const flags = parseRunFlags(args, "inspect");
  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before inspecting encrypted run secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, "inspect-report.json");
  const executeReportPath = join(runDir, "execute-report.json");
  const recoverReportPath = join(runDir, "recover-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (!existsSync(secretsPath)) {
    throw new Error(`Secrets not found: ${relative(secretsPath)}. Run prepare --secrets-only first.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);
  const encrypted = JSON.parse(readFileSync(secretsPath, "utf8"));
  const secrets = decryptJson(encrypted, passphrase);
  verifySecrets(plan, secrets);
  const executeReport = existsSync(executeReportPath)
    ? JSON.parse(readFileSync(executeReportPath, "utf8"))
    : null;
  const recoverReport = existsSync(recoverReportPath)
    ? JSON.parse(readFileSync(recoverReportPath, "utf8"))
    : null;
  const executionComplete = executeReport?.status === "executed";
  const recoveryComplete = recoverReport?.status === "recovered";

  const {
    Connection,
    Keypair,
    NonceAccount,
    PublicKey,
    SystemProgram,
  } = await loadWeb3();
  const connection = new Connection(plan.rpcUrl, "confirmed");
  const source = loadSourceKeypair(plan.sourceWalletPath, Keypair);
  const sourceBalanceLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const bundle = secrets.accounts.map((account) => ({
    index: account.index,
    recipient: account.recipient,
    amountLamports: BigInt(account.amountLamports),
    disposable: keypairFromSeed(account.disposableSeed, Keypair),
    nonce: keypairFromSeed(account.nonceSeed, Keypair),
  }));

  const accounts = [];
  for (const account of bundle) {
    accounts.push(await inspectPreparedPair(
      connection,
      account,
      NonceAccount,
      PublicKey,
      SystemProgram,
      { executionComplete, recoveryComplete }
    ));
  }

  const disposableTotalLamports = accounts.reduce(
    (sum, account) => sum + BigInt(account.disposable.balanceLamports),
    0n
  );
  const nonceTotalLamports = accounts.reduce(
    (sum, account) => sum + BigInt(account.nonce.balanceLamports),
    0n
  );
  const mismatches = accounts.flatMap((account) => account.mismatches);
  const status = mismatches.length === 0 ? "ok" : "mismatch";

  const report = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    status,
    lifecycle: recoveryComplete ? "recovered" : executionComplete ? "executed" : "prepared",
    cluster: plan.cluster,
    rpcUrl: plan.rpcUrl,
    sourceWallet: source.publicKey.toBase58(),
    sourceBalanceLamports: sourceBalanceLamports.toString(),
    sourceBalanceSol: formatLamports(sourceBalanceLamports),
    programId: plan.programId,
    walletCount: plan.walletCount,
    plannedOutputLamports: plan.totalLamports,
    plannedOutputSol: plan.totalSol,
    disposableTotalLamports: disposableTotalLamports.toString(),
    disposableTotalSol: formatLamports(disposableTotalLamports),
    nonceTotalLamports: nonceTotalLamports.toString(),
    nonceTotalSol: formatLamports(nonceTotalLamports),
    recoverableLamports: (disposableTotalLamports + nonceTotalLamports).toString(),
    recoverableSol: formatLamports(disposableTotalLamports + nonceTotalLamports),
    accounts,
    mismatches,
  };
  writeJson(reportPath, report);

  console.log(`Run: ${runId}`);
  console.log(`Status: ${status}`);
  console.log(`Cluster: ${plan.cluster}`);
  console.log(`Source: ${source.publicKey.toBase58()} -> ${formatLamports(sourceBalanceLamports)} SOL`);
  console.log(`Disposable total: ${formatLamports(disposableTotalLamports)} SOL (${disposableTotalLamports} lamports)`);
  console.log(`Nonce rent total: ${formatLamports(nonceTotalLamports)} SOL (${nonceTotalLamports} lamports)`);
  console.log(`Recoverable total: ${formatLamports(disposableTotalLamports + nonceTotalLamports)} SOL`);
  for (const account of accounts) {
    console.log(
      `Account ${account.index + 1}: disposable=${account.disposable.publicKey} balance=${account.disposable.balanceSol} SOL nonce=${account.nonce.publicKey} nonceOk=${account.nonce.ok}`
    );
  }
  console.log(`Report: ${relative(reportPath)}`);

  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

async function commandExecute(args) {
  const flags = parseExecuteFlags(args);
  const modeCount = [flags.dryRun, flags.confirm].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error("execute requires exactly one mode: --dry-run or --confirm");
  }

  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before executing encrypted run secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, flags.dryRun ? "execute-dry-run-report.json" : "execute-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (!existsSync(secretsPath)) {
    throw new Error(`Secrets not found: ${relative(secretsPath)}. Run prepare --secrets-only first.`);
  }
  if (existsSync(reportPath) && !flags.force) {
    throw new Error(`${relative(reportPath)} already exists. Use --force to overwrite.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);
  if (flags.confirm) {
    requireExecuteConfirmation(plan, flags);
  }

  const encrypted = JSON.parse(readFileSync(secretsPath, "utf8"));
  const secrets = decryptJson(encrypted, passphrase);
  verifySecrets(plan, secrets);

  const {
    Connection,
    Keypair,
    NonceAccount,
    PublicKey,
    SystemProgram,
    Transaction,
  } = await loadWeb3();
  const connection = new Connection(plan.rpcUrl, "confirmed");
  const source = loadSourceKeypair(plan.sourceWalletPath, Keypair);
  const bundle = secrets.accounts.map((account) => ({
    index: account.index,
    recipient: account.recipient,
    amountLamports: BigInt(account.amountLamports),
    disposable: keypairFromSeed(account.disposableSeed, Keypair),
    nonce: keypairFromSeed(account.nonceSeed, Keypair),
  }));

  const sourceBalanceBeforeLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const executions = [];
  let estimatedFeeLamports = 0n;
  let preflightOk = true;

  for (const account of bundle) {
    const execution = await buildExecuteTransaction({
      connection,
      account,
      source,
      NonceAccount,
      PublicKey,
      SystemProgram,
      Transaction,
    });
    estimatedFeeLamports += BigInt(execution.estimatedFeeLamports);
    if (!execution.ok) {
      preflightOk = false;
    }
    executions.push(execution);
  }

  if (sourceBalanceBeforeLamports < estimatedFeeLamports) {
    preflightOk = false;
    executions.push({
      index: null,
      ok: false,
      detail: "source balance is too low to pay execute fees",
      estimatedFeeLamports: estimatedFeeLamports.toString(),
    });
  }

  const baseReport = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    mode: flags.dryRun ? "dry-run" : "execute",
    cluster: plan.cluster,
    rpcUrl: plan.rpcUrl,
    sourceWallet: source.publicKey.toBase58(),
    feePayer: source.publicKey.toBase58(),
    feePayerPolicy: "source",
    sourceBalanceBeforeLamports: sourceBalanceBeforeLamports.toString(),
    sourceBalanceBeforeSol: formatLamports(sourceBalanceBeforeLamports),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    estimatedFeeSol: formatLamports(estimatedFeeLamports),
    executions: executions.map(stripExecuteRuntimeFields),
  };

  if (flags.dryRun || !preflightOk) {
    const status = preflightOk ? "ok" : "preflight_failed";
    writeJson(reportPath, {
      ...baseReport,
      status,
      signatures: [],
    });
    printExecuteSummary(runId, status, baseReport, reportPath);
    if (!preflightOk) {
      process.exitCode = 1;
    }
    return;
  }

  const sent = [];
  for (const execution of executions) {
    if (!execution.ok) {
      continue;
    }
    const signature = await connection.sendRawTransaction(execution.transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    sent.push({
      index: execution.index,
      signature,
      confirmation,
    });
  }

  const verification = [];
  for (const account of bundle) {
    const recipientBalanceAfterLamports = BigInt(
      await connection.getBalance(new PublicKey(account.recipient), "confirmed")
    );
    const disposableBalanceAfterLamports = BigInt(
      await connection.getBalance(account.disposable.publicKey, "confirmed")
    );
    verification.push({
      index: account.index,
      recipient: account.recipient,
      recipientBalanceAfterLamports: recipientBalanceAfterLamports.toString(),
      recipientBalanceAfterSol: formatLamports(recipientBalanceAfterLamports),
      disposablePublicKey: account.disposable.publicKey.toBase58(),
      disposableBalanceAfterLamports: disposableBalanceAfterLamports.toString(),
      disposableBalanceAfterSol: formatLamports(disposableBalanceAfterLamports),
      ok: disposableBalanceAfterLamports === 0n,
    });
  }

  const status = sent.every((item) => item.confirmation.value.err === null)
    && verification.every((item) => item.ok)
    ? "executed"
    : "verification_failed";
  writeJson(reportPath, {
    ...baseReport,
    status,
    signatures: sent,
    verification,
  });
  printExecuteSummary(runId, status, baseReport, reportPath);
  if (status !== "executed") {
    process.exitCode = 1;
  }
}

async function commandRecover(args) {
  const flags = parseExecuteFlags(args);
  const modeCount = [flags.dryRun, flags.confirm].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error("recover requires exactly one mode: --dry-run or --confirm");
  }

  const passphrase = process.env.DISPENSER_PASSPHRASE;
  if (!passphrase || passphrase.length < 12) {
    throw new Error("Set DISPENSER_PASSPHRASE to at least 12 characters before recovering encrypted run secrets");
  }

  const runId = flags.run;
  const runDir = join(runsDir, runId);
  const planPath = join(runDir, "bundle-plan.json");
  const secretsPath = join(runDir, "secrets.enc.json");
  const reportPath = join(runDir, flags.dryRun ? "recover-dry-run-report.json" : "recover-report.json");

  if (!existsSync(planPath)) {
    throw new Error(`Plan not found: ${relative(planPath)}`);
  }
  if (!existsSync(secretsPath)) {
    throw new Error(`Secrets not found: ${relative(secretsPath)}. Run prepare --secrets-only first.`);
  }
  if (existsSync(reportPath) && !flags.force) {
    throw new Error(`${relative(reportPath)} already exists. Use --force to overwrite.`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  validatePlan(plan);
  if (flags.confirm) {
    requireRecoverConfirmation(plan, flags);
  }

  const encrypted = JSON.parse(readFileSync(secretsPath, "utf8"));
  const secrets = decryptJson(encrypted, passphrase);
  verifySecrets(plan, secrets);

  const {
    Connection,
    Keypair,
    NonceAccount,
    PublicKey,
    SystemProgram,
    Transaction,
  } = await loadWeb3();
  const connection = new Connection(plan.rpcUrl, "confirmed");
  const source = loadSourceKeypair(plan.sourceWalletPath, Keypair);
  const rescueWallet = plan.rescueWallet || source.publicKey.toBase58();
  const rescue = new PublicKey(rescueWallet);
  const bundle = secrets.accounts.map((account) => ({
    index: account.index,
    recipient: account.recipient,
    amountLamports: BigInt(account.amountLamports),
    disposable: keypairFromSeed(account.disposableSeed, Keypair),
    nonce: keypairFromSeed(account.nonceSeed, Keypair),
  }));

  const sourceBalanceBeforeLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const rescueBalanceBeforeLamports = BigInt(await connection.getBalance(rescue, "confirmed"));
  const recoveries = [];
  let estimatedFeeLamports = 0n;
  let recoverableLamports = 0n;
  let preflightOk = true;

  for (const account of bundle) {
    const built = await buildRecoverTransactions({
      connection,
      account,
      source,
      rescue,
      NonceAccount,
      SystemProgram,
      Transaction,
    });
    recoverableLamports += BigInt(built.recoverableLamports);
    estimatedFeeLamports += BigInt(built.estimatedFeeLamports);
    if (!built.ok) {
      preflightOk = false;
    }
    recoveries.push(built);
  }

  if (sourceBalanceBeforeLamports < estimatedFeeLamports) {
    preflightOk = false;
    recoveries.push({
      index: null,
      ok: false,
      detail: "source balance is too low to pay recovery fees",
      actions: [],
      recoverableLamports: "0",
      estimatedFeeLamports: estimatedFeeLamports.toString(),
    });
  }

  const baseReport = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    mode: flags.dryRun ? "dry-run" : "recover",
    cluster: plan.cluster,
    rpcUrl: plan.rpcUrl,
    sourceWallet: source.publicKey.toBase58(),
    feePayer: source.publicKey.toBase58(),
    rescueWallet,
    sourceBalanceBeforeLamports: sourceBalanceBeforeLamports.toString(),
    sourceBalanceBeforeSol: formatLamports(sourceBalanceBeforeLamports),
    rescueBalanceBeforeLamports: rescueBalanceBeforeLamports.toString(),
    rescueBalanceBeforeSol: formatLamports(rescueBalanceBeforeLamports),
    recoverableLamports: recoverableLamports.toString(),
    recoverableSol: formatLamports(recoverableLamports),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    estimatedFeeSol: formatLamports(estimatedFeeLamports),
    recoveries: recoveries.map(stripRecoverRuntimeFields),
  };

  if (flags.dryRun || !preflightOk) {
    const status = preflightOk ? "ok" : "preflight_failed";
    writeJson(reportPath, {
      ...baseReport,
      status,
      signatures: [],
    });
    printRecoverSummary(runId, status, baseReport, reportPath);
    if (!preflightOk) {
      process.exitCode = 1;
    }
    return;
  }

  const sent = [];
  for (const recovery of recoveries) {
    if (!recovery.ok) {
      continue;
    }
    for (const action of recovery.actions) {
      const signature = await connection.sendRawTransaction(action.transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      sent.push({
        index: recovery.index,
        action: action.kind,
        signature,
        confirmation,
      });
    }
  }

  const verification = [];
  for (const account of bundle) {
    const disposableBalanceAfterLamports = BigInt(
      await connection.getBalance(account.disposable.publicKey, "confirmed")
    );
    const nonceInfoAfter = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
    verification.push({
      index: account.index,
      disposablePublicKey: account.disposable.publicKey.toBase58(),
      disposableBalanceAfterLamports: disposableBalanceAfterLamports.toString(),
      disposableBalanceAfterSol: formatLamports(disposableBalanceAfterLamports),
      noncePublicKey: account.nonce.publicKey.toBase58(),
      nonceExistsAfter: Boolean(nonceInfoAfter),
      nonceBalanceAfterLamports: String(nonceInfoAfter?.lamports ?? 0),
      ok: disposableBalanceAfterLamports === 0n && !nonceInfoAfter,
    });
  }
  const rescueBalanceAfterLamports = BigInt(await connection.getBalance(rescue, "confirmed"));
  const status = sent.every((item) => item.confirmation.value.err === null)
    && verification.every((item) => item.ok)
    ? "recovered"
    : "verification_failed";

  writeJson(reportPath, {
    ...baseReport,
    status,
    signatures: sent,
    rescueBalanceAfterLamports: rescueBalanceAfterLamports.toString(),
    rescueBalanceAfterSol: formatLamports(rescueBalanceAfterLamports),
    verification,
  });
  printRecoverSummary(runId, status, baseReport, reportPath);
  if (status !== "recovered") {
    process.exitCode = 1;
  }
}

function checkCommand(command, args, required) {
  return checkTool(command, [{ command, args }], required);
}

function anchorCandidates() {
  return [
    { command: "anchor", args: ["--version"] },
    {
      command: join(process.env.USERPROFILE ?? "", ".avm", "bin", "anchor-1.1.2.exe"),
      args: ["--version"],
      label: "avm anchor-1.1.2",
    },
  ];
}

function checkTool(name, candidates, required) {
  const runnable = findRunnableTool(candidates);
  if (runnable) {
    return {
      name,
      ok: true,
      required,
      detail: runnable.label ? `${runnable.detail} (${runnable.label})` : runnable.detail,
    };
  }

  return { name, ok: false, required, detail: "not found or not runnable" };
}

function findRunnableTool(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: toolEnv(),
      shell: process.platform === "win32",
    });

    if (result.status === 0) {
      return {
        ...candidate,
        detail: firstLine(result.stdout) || firstLine(result.stderr) || "ok",
      };
    }
  }

  return null;
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

function parseRunFlags(args, commandName) {
  const flags = {
    run: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") {
      flags.run = requireValue(args, index);
      index += 1;
    } else {
      throw new Error(`Unknown ${commandName} flag: ${arg}`);
    }
  }

  if (!flags.run) {
    throw new Error(`${commandName} requires --run RUN_ID`);
  }

  return flags;
}

function requirePrepareConfirmation(plan, flags) {
  if (!flags.confirm) {
    throw new Error("prepare send requires --confirm");
  }
  if (plan.cluster === "mainnet-beta") {
    if (flags.confirmMainnet !== "MAINNET") {
      throw new Error("mainnet prepare requires --confirm-mainnet MAINNET");
    }
    if (flags.confirmTotal !== plan.totalSol) {
      throw new Error(`mainnet prepare requires --confirm-total ${plan.totalSol}`);
    }
  }
}

function requireExecuteConfirmation(plan, flags) {
  if (!flags.confirm) {
    throw new Error("execute send requires --confirm");
  }
  if (plan.cluster === "mainnet-beta") {
    if (flags.confirmMainnet !== "MAINNET") {
      throw new Error("mainnet execute requires --confirm-mainnet MAINNET");
    }
    if (flags.confirmTotal !== plan.totalSol) {
      throw new Error(`mainnet execute requires --confirm-total ${plan.totalSol}`);
    }
  }
}

function requireRecoverConfirmation(plan, flags) {
  if (!flags.confirm) {
    throw new Error("recover send requires --confirm");
  }
  if (plan.cluster === "mainnet-beta") {
    if (flags.confirmMainnet !== "MAINNET") {
      throw new Error("mainnet recover requires --confirm-mainnet MAINNET");
    }
    if (flags.confirmTotal !== plan.totalSol) {
      throw new Error(`mainnet recover requires --confirm-total ${plan.totalSol}`);
    }
  }
}

async function loadWeb3() {
  try {
    return await import("@solana/web3.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Missing dependency @solana/web3.js. Run npm ci from the dispenser project root.");
    }
    throw error;
  }
}

function loadSourceKeypair(sourceWalletPath, Keypair) {
  const resolvedPath = resolve(repoRoot, sourceWalletPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Source wallet not found: ${relative(resolvedPath)}`);
  }

  const secret = JSON.parse(readFileSync(resolvedPath, "utf8"));
  if (!Array.isArray(secret) || secret.length !== 64) {
    throw new Error("Source wallet must be a Solana keypair JSON array with 64 bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function keypairFromSeed(seedBase64, Keypair) {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) {
    throw new Error("Stored account seed must decode to exactly 32 bytes");
  }
  return Keypair.fromSeed(seed);
}

function buildFundBundleTransaction({
  plan,
  programId,
  source,
  bundle,
  recentBlockhash,
  recentBlockhashesSysvar,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
}) {
  const remainingAccounts = bundle.flatMap((account) => [
    {
      pubkey: account.disposable.publicKey,
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: account.nonce.publicKey,
      isSigner: true,
      isWritable: true,
    },
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source.publicKey, isSigner: true, isWritable: true },
      { pubkey: recentBlockhashesSysvar, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ],
    data: encodeFundBundleAccounts(plan.recipients.map((recipient) => BigInt(recipient.amountLamports))),
  });

  return new Transaction({
    feePayer: source.publicKey,
    recentBlockhash,
  }).add(instruction);
}

function encodeFundBundleAccounts(amounts) {
  const data = Buffer.alloc(FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length + 4 + amounts.length * 8);
  FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.copy(data, 0);
  data.writeUInt32LE(amounts.length, FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length);

  for (const [index, amount] of amounts.entries()) {
    data.writeBigUInt64LE(BigInt(amount), FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length + 4 + index * 8);
  }

  return data;
}

function uniqueBundleSigners(bundle) {
  const signerMap = new Map();
  for (const account of bundle) {
    signerMap.set(account.disposable.publicKey.toBase58(), account.disposable);
    signerMap.set(account.nonce.publicKey.toBase58(), account.nonce);
  }
  return [...signerMap.values()];
}

async function inspectPrepareAccounts(connection, bundle, SystemProgram) {
  const checks = [];
  for (const account of bundle) {
    checks.push(await inspectGeneratedAccount(connection, {
      index: account.index,
      role: "disposable",
      publicKey: account.disposable.publicKey,
      mustBeMissing: false,
    }, SystemProgram));
    checks.push(await inspectGeneratedAccount(connection, {
      index: account.index,
      role: "nonce",
      publicKey: account.nonce.publicKey,
      mustBeMissing: true,
    }, SystemProgram));
  }
  return checks;
}

async function inspectGeneratedAccount(connection, account, SystemProgram) {
  const info = await connection.getAccountInfo(account.publicKey, "confirmed");
  if (!info) {
    return {
      index: account.index,
      role: account.role,
      publicKey: account.publicKey.toBase58(),
      exists: false,
      ok: true,
      detail: "account is not initialized",
    };
  }

  const owner = info.owner.toBase58();
  const systemOwned = owner === SystemProgram.programId.toBase58();
  const dataEmpty = info.data.length === 0;
  const zeroLamports = info.lamports === 0;
  const ok = account.mustBeMissing
    ? false
    : systemOwned && dataEmpty && zeroLamports;

  return {
    index: account.index,
    role: account.role,
    publicKey: account.publicKey.toBase58(),
    exists: true,
    owner,
    lamports: String(info.lamports),
    dataLength: info.data.length,
    ok,
    detail: ok
      ? "existing empty system account"
      : "generated account is already initialized or funded",
  };
}

async function verifyPreparedAccounts(connection, bundle, nonceRentLamports, NonceAccount, SystemProgram) {
  const checks = [];
  for (const account of bundle) {
    const disposableBalance = BigInt(
      await connection.getBalance(account.disposable.publicKey, "confirmed")
    );
    checks.push({
      index: account.index,
      role: "disposable",
      publicKey: account.disposable.publicKey.toBase58(),
      expectedLamports: account.amountLamports.toString(),
      observedLamports: disposableBalance.toString(),
      ok: disposableBalance === account.amountLamports,
    });

    checks.push(await verifyNonceAccount(
      connection,
      account,
      nonceRentLamports,
      NonceAccount,
      SystemProgram
    ));
  }
  return checks;
}

async function verifyNonceAccount(connection, account, nonceRentLamports, NonceAccount, SystemProgram) {
  const info = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
  if (!info) {
    return {
      index: account.index,
      role: "nonce",
      publicKey: account.nonce.publicKey.toBase58(),
      ok: false,
      detail: "nonce account is missing",
    };
  }

  const owner = info.owner.toBase58();
  const expectedOwner = SystemProgram.programId.toBase58();
  const lamports = BigInt(info.lamports);
  let nonceState = null;
  let nonceError = "";
  try {
    nonceState = NonceAccount.fromAccountData(info.data);
  } catch (error) {
    nonceError = error.message;
  }

  const authority = nonceState?.authorizedPubkey?.toBase58() ?? "";
  const expectedAuthority = account.disposable.publicKey.toBase58();
  const ok = owner === expectedOwner
    && lamports >= nonceRentLamports
    && authority === expectedAuthority
    && Boolean(nonceState?.nonce);

  return {
    index: account.index,
    role: "nonce",
    publicKey: account.nonce.publicKey.toBase58(),
    owner,
    expectedOwner,
    lamports: lamports.toString(),
    minimumRentLamports: nonceRentLamports.toString(),
    authority,
    expectedAuthority,
    nonce: nonceState?.nonce ?? "",
    ok,
    detail: ok ? "nonce account initialized" : nonceError || "nonce account verification failed",
  };
}

async function inspectPreparedPair(
  connection,
  account,
  NonceAccount,
  PublicKey,
  SystemProgram,
  options = {}
) {
  const expectedDisposableLamports = options.executionComplete ? 0n : account.amountLamports;
  const disposableBalanceLamports = BigInt(
    await connection.getBalance(account.disposable.publicKey, "confirmed")
  );
  const recipientBalanceLamports = BigInt(
    await connection.getBalance(new PublicKey(account.recipient), "confirmed")
  );
  const nonceInfo = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
  const expectedAuthority = account.disposable.publicKey.toBase58();
  const mismatches = [];

  if (disposableBalanceLamports !== expectedDisposableLamports) {
    mismatches.push({
      index: account.index,
      role: "disposable",
      expected: expectedDisposableLamports.toString(),
      observed: disposableBalanceLamports.toString(),
      detail: options.executionComplete
        ? "disposable balance should be empty after execute"
        : "disposable balance does not match planned amount",
    });
  }

  let nonce = {
    publicKey: account.nonce.publicKey.toBase58(),
    exists: false,
    ok: false,
    owner: "",
    balanceLamports: "0",
    balanceSol: "0",
    authority: "",
    expectedAuthority,
    nonce: "",
    detail: "nonce account is missing",
  };

  if (nonceInfo) {
    const owner = nonceInfo.owner.toBase58();
    let nonceState = null;
    let nonceError = "";
    try {
      nonceState = NonceAccount.fromAccountData(nonceInfo.data);
    } catch (error) {
      nonceError = error.message;
    }

    const authority = nonceState?.authorizedPubkey?.toBase58() ?? "";
    const nonceOk = owner === SystemProgram.programId.toBase58()
      && authority === expectedAuthority
      && Boolean(nonceState?.nonce);
    nonce = {
      publicKey: account.nonce.publicKey.toBase58(),
      exists: true,
      ok: nonceOk,
      owner,
      balanceLamports: String(nonceInfo.lamports),
      balanceSol: formatLamports(BigInt(nonceInfo.lamports)),
      authority,
      expectedAuthority,
      nonce: nonceState?.nonce ?? "",
      detail: nonceOk ? "nonce account initialized" : nonceError || "nonce account mismatch",
    };

    if (!nonceOk) {
      mismatches.push({
        index: account.index,
        role: "nonce",
        expected: expectedAuthority,
        observed: authority || owner,
        detail: nonce.detail,
      });
    }
  } else if (options.recoveryComplete) {
    nonce = {
      ...nonce,
      ok: true,
      detail: "nonce account closed after recovery",
    };
  } else {
    mismatches.push({
      index: account.index,
      role: "nonce",
      expected: expectedAuthority,
      observed: "missing",
      detail: "nonce account is missing",
    });
  }

  return {
    index: account.index,
    recipient: {
      publicKey: account.recipient,
      plannedLamports: account.amountLamports.toString(),
      plannedSol: formatLamports(account.amountLamports),
      currentBalanceLamports: recipientBalanceLamports.toString(),
      currentBalanceSol: formatLamports(recipientBalanceLamports),
    },
    disposable: {
      publicKey: account.disposable.publicKey.toBase58(),
      expectedLamports: expectedDisposableLamports.toString(),
      balanceLamports: disposableBalanceLamports.toString(),
      balanceSol: formatLamports(disposableBalanceLamports),
      ok: disposableBalanceLamports === expectedDisposableLamports,
    },
    nonce,
    mismatches,
  };
}

async function buildExecuteTransaction({
  connection,
  account,
  source,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
}) {
  const recipient = new PublicKey(account.recipient);
  const disposableBalanceLamports = BigInt(
    await connection.getBalance(account.disposable.publicKey, "confirmed")
  );
  const recipientBalanceBeforeLamports = BigInt(await connection.getBalance(recipient, "confirmed"));
  const nonceInfo = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
  if (!nonceInfo) {
    return {
      index: account.index,
      ok: false,
      detail: "nonce account is missing",
      disposablePublicKey: account.disposable.publicKey.toBase58(),
      recipient: account.recipient,
      amountLamports: account.amountLamports.toString(),
      disposableBalanceLamports: disposableBalanceLamports.toString(),
      recipientBalanceBeforeLamports: recipientBalanceBeforeLamports.toString(),
      estimatedFeeLamports: "0",
    };
  }

  let nonceState = null;
  try {
    nonceState = NonceAccount.fromAccountData(nonceInfo.data);
  } catch (error) {
    return {
      index: account.index,
      ok: false,
      detail: `nonce account parse failed: ${error.message}`,
      disposablePublicKey: account.disposable.publicKey.toBase58(),
      recipient: account.recipient,
      amountLamports: account.amountLamports.toString(),
      disposableBalanceLamports: disposableBalanceLamports.toString(),
      recipientBalanceBeforeLamports: recipientBalanceBeforeLamports.toString(),
      estimatedFeeLamports: "0",
    };
  }

  const expectedAuthority = account.disposable.publicKey.toBase58();
  const observedAuthority = nonceState.authorizedPubkey.toBase58();
  if (observedAuthority !== expectedAuthority) {
    return {
      index: account.index,
      ok: false,
      detail: "nonce authority does not match disposable wallet",
      disposablePublicKey: account.disposable.publicKey.toBase58(),
      recipient: account.recipient,
      amountLamports: account.amountLamports.toString(),
      disposableBalanceLamports: disposableBalanceLamports.toString(),
      recipientBalanceBeforeLamports: recipientBalanceBeforeLamports.toString(),
      noncePublicKey: account.nonce.publicKey.toBase58(),
      nonce: nonceState.nonce,
      observedAuthority,
      expectedAuthority,
      estimatedFeeLamports: "0",
    };
  }

  const transaction = new Transaction({
    feePayer: source.publicKey,
    recentBlockhash: nonceState.nonce,
  }).add(
    SystemProgram.nonceAdvance({
      noncePubkey: account.nonce.publicKey,
      authorizedPubkey: account.disposable.publicKey,
    }),
    SystemProgram.transfer({
      fromPubkey: account.disposable.publicKey,
      toPubkey: recipient,
      lamports: account.amountLamports,
    })
  );
  const signers = [source, account.disposable];
  const feeResult = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  const estimatedFeeLamports = BigInt(feeResult.value ?? estimateSignatureFeeLamports(transaction));

  let simulation = {
    attempted: false,
    ok: false,
    error: null,
    logs: [],
  };
  let ok = disposableBalanceLamports >= account.amountLamports;
  let detail = ok ? "ready" : "disposable balance is below planned transfer amount";
  if (ok) {
    const simulationResult = await connection.simulateTransaction(transaction, signers);
    simulation = {
      attempted: true,
      ok: simulationResult.value.err === null,
      error: simulationResult.value.err,
      logs: simulationResult.value.logs ?? [],
    };
    ok = simulation.ok;
    detail = ok ? "simulation passed" : "simulation failed";
  }

  if (ok) {
    transaction.sign(...signers);
  }

  return {
    index: account.index,
    ok,
    detail,
    disposablePublicKey: account.disposable.publicKey.toBase58(),
    noncePublicKey: account.nonce.publicKey.toBase58(),
    nonce: nonceState.nonce,
    recipient: account.recipient,
    amountLamports: account.amountLamports.toString(),
    amountSol: formatLamports(account.amountLamports),
    disposableBalanceLamports: disposableBalanceLamports.toString(),
    disposableBalanceSol: formatLamports(disposableBalanceLamports),
    recipientBalanceBeforeLamports: recipientBalanceBeforeLamports.toString(),
    recipientBalanceBeforeSol: formatLamports(recipientBalanceBeforeLamports),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    estimatedFeeSol: formatLamports(estimatedFeeLamports),
    simulation,
    transaction,
  };
}

function stripExecuteRuntimeFields(execution) {
  const { transaction, ...reportable } = execution;
  return reportable;
}

function printExecuteSummary(runId, status, report, reportPath) {
  console.log(`Run: ${runId}`);
  console.log(`Status: ${status}`);
  console.log(`Cluster: ${report.cluster}`);
  console.log(`Fee payer: ${report.feePayer}`);
  console.log(`Estimated fees: ${report.estimatedFeeSol} SOL (${report.estimatedFeeLamports} lamports)`);
  for (const execution of report.executions) {
    if (execution.index === null) {
      console.log(`Preflight: ${execution.detail}`);
    } else {
      console.log(
        `Transfer ${execution.index + 1}: ${execution.disposablePublicKey} -> ${execution.recipient} amount=${execution.amountSol ?? formatLamports(execution.amountLamports)} SOL ok=${execution.ok}`
      );
    }
  }
  console.log(`Report: ${relative(reportPath)}`);
}

async function buildRecoverTransactions({
  connection,
  account,
  source,
  rescue,
  NonceAccount,
  SystemProgram,
  Transaction,
}) {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const disposableBalanceLamports = BigInt(
    await connection.getBalance(account.disposable.publicKey, "confirmed")
  );
  const nonceInfo = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
  const actions = [];
  let estimatedFeeLamports = 0n;
  let recoverableLamports = disposableBalanceLamports;
  let ok = true;
  const issues = [];

  if (disposableBalanceLamports > 0n) {
    const transaction = new Transaction({
      feePayer: source.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: account.disposable.publicKey,
        toPubkey: rescue,
        lamports: disposableBalanceLamports,
      })
    );
    const signers = [source, account.disposable];
    const feeResult = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
    const actionFeeLamports = BigInt(feeResult.value ?? estimateSignatureFeeLamports(transaction));
    estimatedFeeLamports += actionFeeLamports;
    const simulationResult = await connection.simulateTransaction(transaction, signers);
    const simulation = {
      attempted: true,
      ok: simulationResult.value.err === null,
      error: simulationResult.value.err,
      logs: simulationResult.value.logs ?? [],
    };
    if (!simulation.ok) {
      ok = false;
      issues.push("disposable transfer simulation failed");
    } else {
      transaction.sign(...signers);
    }
    actions.push({
      kind: "disposable-transfer",
      amountLamports: disposableBalanceLamports.toString(),
      amountSol: formatLamports(disposableBalanceLamports),
      estimatedFeeLamports: actionFeeLamports.toString(),
      estimatedFeeSol: formatLamports(actionFeeLamports),
      simulation,
      transaction,
    });
  }

  if (nonceInfo) {
    const nonceLamports = BigInt(nonceInfo.lamports);
    recoverableLamports += nonceLamports;
    let nonceState = null;
    try {
      nonceState = NonceAccount.fromAccountData(nonceInfo.data);
    } catch (error) {
      ok = false;
      issues.push(`nonce account parse failed: ${error.message}`);
    }

    const expectedAuthority = account.disposable.publicKey.toBase58();
    const observedAuthority = nonceState?.authorizedPubkey?.toBase58() ?? "";
    if (nonceState && observedAuthority !== expectedAuthority) {
      ok = false;
      issues.push("nonce authority does not match disposable wallet");
    }

    if (nonceState && observedAuthority === expectedAuthority && nonceLamports > 0n) {
      const nonceWithdrawLamports = checkedNumberFromLamports(nonceLamports, "nonce withdraw lamports");
      const transaction = new Transaction({
        feePayer: source.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
      }).add(
        SystemProgram.nonceWithdraw({
          noncePubkey: account.nonce.publicKey,
          authorizedPubkey: account.disposable.publicKey,
          toPubkey: rescue,
          lamports: nonceWithdrawLamports,
        })
      );
      const signers = [source, account.disposable];
      const feeResult = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
      const actionFeeLamports = BigInt(feeResult.value ?? estimateSignatureFeeLamports(transaction));
      estimatedFeeLamports += actionFeeLamports;
      const simulationResult = await connection.simulateTransaction(transaction, signers);
      const simulation = {
        attempted: true,
        ok: simulationResult.value.err === null,
        error: simulationResult.value.err,
        logs: simulationResult.value.logs ?? [],
      };
      if (!simulation.ok) {
        ok = false;
        issues.push("nonce withdraw simulation failed");
      } else {
        transaction.sign(...signers);
      }
      actions.push({
        kind: "nonce-withdraw",
        amountLamports: nonceLamports.toString(),
        amountSol: formatLamports(nonceLamports),
        estimatedFeeLamports: actionFeeLamports.toString(),
        estimatedFeeSol: formatLamports(actionFeeLamports),
        noncePublicKey: account.nonce.publicKey.toBase58(),
        nonceAuthority: observedAuthority,
        simulation,
        transaction,
      });
    }
  }

  return {
    index: account.index,
    ok,
    detail: ok ? "recovery ready" : issues.join("; "),
    disposablePublicKey: account.disposable.publicKey.toBase58(),
    noncePublicKey: account.nonce.publicKey.toBase58(),
    rescueWallet: rescue.toBase58(),
    disposableBalanceLamports: disposableBalanceLamports.toString(),
    disposableBalanceSol: formatLamports(disposableBalanceLamports),
    nonceBalanceLamports: String(nonceInfo?.lamports ?? 0),
    nonceBalanceSol: formatLamports(BigInt(nonceInfo?.lamports ?? 0)),
    recoverableLamports: recoverableLamports.toString(),
    recoverableSol: formatLamports(recoverableLamports),
    estimatedFeeLamports: estimatedFeeLamports.toString(),
    estimatedFeeSol: formatLamports(estimatedFeeLamports),
    actions,
  };
}

function stripRecoverRuntimeFields(recovery) {
  return {
    ...recovery,
    actions: recovery.actions.map((action) => {
      const { transaction, ...reportable } = action;
      return reportable;
    }),
  };
}

function printRecoverSummary(runId, status, report, reportPath) {
  console.log(`Run: ${runId}`);
  console.log(`Status: ${status}`);
  console.log(`Cluster: ${report.cluster}`);
  console.log(`Rescue: ${report.rescueWallet}`);
  console.log(`Recoverable: ${report.recoverableSol} SOL (${report.recoverableLamports} lamports)`);
  console.log(`Estimated fees: ${report.estimatedFeeSol} SOL (${report.estimatedFeeLamports} lamports)`);
  for (const recovery of report.recoveries) {
    if (recovery.index === null) {
      console.log(`Preflight: ${recovery.detail}`);
      continue;
    }
    console.log(
      `Account ${recovery.index + 1}: disposable=${recovery.disposableBalanceSol} SOL nonce=${recovery.nonceBalanceSol} SOL actions=${recovery.actions.length} ok=${recovery.ok}`
    );
  }
  console.log(`Report: ${relative(reportPath)}`);
}

function estimateSignatureFeeLamports(transaction) {
  return transaction.compileMessage().header.numRequiredSignatures * 5000;
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log("error", error.stack || error.message);
    process.exitCode = 1;
  });
}
