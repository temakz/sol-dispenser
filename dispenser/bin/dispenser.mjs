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
import {
  RECENT_BLOCKHASHES_SYSVAR_ADDRESS,
  buildExecuteTransaction,
  buildFundBundleTransaction,
  buildRecoverTransactions,
  estimateSignatureFeeLamports,
  inspectPrepareAccounts,
  inspectPreparedPair,
  uniqueBundleSigners,
  verifyPreparedAccounts,
} from "../lib/solana-flows.mjs";
import {
  inspectLifecycle,
  preflightStatus,
  reportFileName,
  verifiedStatus,
} from "../lib/report-lifecycle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const configPath = join(repoRoot, "dispenser.config.json");
const runsDir = join(repoRoot, "runs");
const MAX_TRANSACTION_SIZE_BYTES = 1232;

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
  const reportPath = join(runDir, reportFileName("prepare", "secrets"));

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
  const reportPath = join(runDir, reportFileName("prepare", "dryRun"));

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
  const prepareTransactions = buildPrepareTransactions({
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
  let estimatedFeeLamports = 0n;
  for (const item of prepareTransactions) {
    const feeResult = await connection.getFeeForMessage(item.transaction.compileMessage(), "confirmed");
    estimatedFeeLamports += BigInt(feeResult.value ?? estimateSignatureFeeLamports(item.transaction));
  }
  const sourceBalanceLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const totalOutputLamports = BigInt(plan.totalLamports);
  const totalNonceRentLamports = nonceRentLamports * BigInt(bundle.length);
  const totalRequiredLamports = totalOutputLamports + totalNonceRentLamports + estimatedFeeLamports;
  const sourceBalanceOk = sourceBalanceLamports >= totalRequiredLamports;
  const accountPreflight = await inspectPrepareAccounts(connection, bundle, SystemProgram);
  const accountIssues = accountPreflight.filter((account) => !account.ok);

  const simulations = [];

  if (sourceBalanceOk && accountIssues.length === 0) {
    for (const item of prepareTransactions) {
      const simulationResult = await connection.simulateTransaction(item.transaction);
      simulations.push({
        chunk: item.chunk,
        attempted: true,
        ok: simulationResult.value.err === null,
        error: simulationResult.value.err,
        logs: simulationResult.value.logs ?? [],
      });
    }
  }
  const simulation = summarizeSimulations(simulations);

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
      transactionCount: prepareTransactions.length,
      signerCount: prepareTransactions.reduce((sum, item) => sum + item.signers.length, 0),
      instructionCount: prepareTransactions.reduce((sum, item) => sum + item.transaction.instructions.length, 0),
      maxSerializedBytes: Math.max(...prepareTransactions.map((item) => item.serializedBytes)),
    },
    transactions: prepareTransactions.map(reportPrepareTransaction),
    simulation,
    simulations,
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
  console.log(`Prepare transactions: ${prepareTransactions.length}`);
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
  const reportPath = join(runDir, reportFileName("prepare", "confirm"));

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
  const prepareTransactions = buildPrepareTransactions({
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
  let estimatedFeeLamports = 0n;
  for (const item of prepareTransactions) {
    const feeResult = await connection.getFeeForMessage(item.transaction.compileMessage(), "confirmed");
    estimatedFeeLamports += BigInt(feeResult.value ?? estimateSignatureFeeLamports(item.transaction));
  }
  const sourceBalanceBeforeLamports = BigInt(await connection.getBalance(source.publicKey, "confirmed"));
  const totalOutputLamports = BigInt(plan.totalLamports);
  const totalNonceRentLamports = nonceRentLamports * BigInt(bundle.length);
  const totalRequiredLamports = totalOutputLamports + totalNonceRentLamports + estimatedFeeLamports;
  const sourceBalanceOk = sourceBalanceBeforeLamports >= totalRequiredLamports;
  const accountPreflight = await inspectPrepareAccounts(connection, bundle, SystemProgram);
  const accountIssues = accountPreflight.filter((account) => !account.ok);

  const simulations = [];
  if (sourceBalanceOk && accountIssues.length === 0) {
    for (const item of prepareTransactions) {
      const simulationResult = await connection.simulateTransaction(item.transaction);
      simulations.push({
        chunk: item.chunk,
        attempted: true,
        ok: simulationResult.value.err === null,
        error: simulationResult.value.err,
        logs: simulationResult.value.logs ?? [],
      });
    }
  }
  const simulation = summarizeSimulations(simulations);
  if (!simulation.attempted) {
    simulation.ok = false;
  }

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
      transactionCount: prepareTransactions.length,
      signerCount: prepareTransactions.reduce((sum, item) => sum + item.signers.length, 0),
      instructionCount: prepareTransactions.reduce((sum, item) => sum + item.transaction.instructions.length, 0),
      maxSerializedBytes: Math.max(...prepareTransactions.map((item) => item.serializedBytes)),
    },
    transactions: prepareTransactions.map(reportPrepareTransaction),
    simulation,
    simulations,
  };

  if (!sourceBalanceOk || accountIssues.length > 0 || !simulation.ok) {
    writeJson(reportPath, {
      ...baseReport,
      status: "preflight_failed",
      signature: null,
      signatures: [],
    });
    console.log(`Run: ${runId}`);
    console.log("Status: preflight_failed");
    console.log(`Report: ${relative(reportPath)}`);
    process.exitCode = 1;
    return;
  }

  const sent = [];
  try {
    for (const item of prepareTransactions) {
      const signature = await connection.sendRawTransaction(item.transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      }, "confirmed");
      const transactionInfo = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      sent.push({
        chunk: item.chunk,
        signature,
        confirmation,
        actualFeeLamports: String(transactionInfo?.meta?.fee ?? ""),
      });
    }
  } catch (error) {
    writeJson(reportPath, {
      ...baseReport,
      status: "send_failed",
      signature: sent[0]?.signature ?? null,
      signatures: sent,
      sendError: error.stack || error.message,
    });
    console.log(`Run: ${runId}`);
    console.log("Status: send_failed");
    console.log(`Signature: ${sent.at(-1)?.signature ?? "not submitted"}`);
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
  const confirmationOk = sent.length === prepareTransactions.length
    && sent.every((item) => !item.confirmation.value.err);
  const status = verifiedStatus("prepared", confirmationOk, verificationOk);

  writeJson(reportPath, {
    ...baseReport,
    status,
    signature: sent[0]?.signature ?? null,
    signatures: sent,
    actualFeeLamports: sumLamportStrings(sent.map((item) => item.actualFeeLamports)).toString(),
    sourceBalanceAfterLamports: sourceBalanceAfterLamports.toString(),
    sourceBalanceAfterSol: formatLamports(sourceBalanceAfterLamports),
    verification,
  });

  console.log(`Run: ${runId}`);
  console.log(`Status: ${status}`);
  for (const item of sent) {
    console.log(`Signature ${item.chunk}: ${item.signature}`);
  }
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
  const reportPath = join(runDir, reportFileName("inspect"));
  const executeReportPath = join(runDir, reportFileName("execute", "confirm"));
  const recoverReportPath = join(runDir, reportFileName("recover", "confirm"));

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
  const lifecycle = inspectLifecycle({ executeReport, recoverReport });
  const executionComplete = lifecycle === "executed" || lifecycle === "recovered";
  const recoveryComplete = lifecycle === "recovered";

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
    lifecycle,
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
  const reportPath = join(runDir, reportFileName("execute", flags.dryRun ? "dryRun" : "confirm"));

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
    const status = preflightStatus(preflightOk);
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
    if (!execution.ok || !execution.transaction) {
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

  const status = verifiedStatus(
    "executed",
    sent.every((item) => item.confirmation.value.err === null),
    verification.every((item) => item.ok)
  );
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
  const reportPath = join(runDir, reportFileName("recover", flags.dryRun ? "dryRun" : "confirm"));

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
    const status = preflightStatus(preflightOk);
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
  const status = verifiedStatus(
    "recovered",
    sent.every((item) => item.confirmation.value.err === null),
    verification.every((item) => item.ok)
  );

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

function buildPrepareTransactions({
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
  const chunks = [];
  let current = [];

  for (const account of bundle) {
    const candidate = [...current, account];
    let candidateItem = null;
    try {
      candidateItem = buildPrepareTransactionItem({
        plan,
        programId,
        source,
        accounts: candidate,
        chunk: chunks.length + 1,
        recentBlockhash,
        recentBlockhashesSysvar,
        SYSVAR_RENT_PUBKEY,
        SystemProgram,
        Transaction,
        TransactionInstruction,
      });
    } catch (error) {
      if (current.length === 0) {
        throw error;
      }
      chunks.push(buildPrepareTransactionItem({
        plan,
        programId,
        source,
        accounts: current,
        chunk: chunks.length + 1,
        recentBlockhash,
        recentBlockhashesSysvar,
        SYSVAR_RENT_PUBKEY,
        SystemProgram,
        Transaction,
        TransactionInstruction,
      }));
      current = [account];
      continue;
    }

    if (candidateItem.serializedBytes <= MAX_TRANSACTION_SIZE_BYTES) {
      current = candidate;
      continue;
    }

    if (current.length === 0) {
      throw new Error(
        `Prepare transaction for account ${account.index + 1} is too large: ${candidateItem.serializedBytes} bytes`
      );
    }

    chunks.push(buildPrepareTransactionItem({
      plan,
      programId,
      source,
      accounts: current,
      chunk: chunks.length + 1,
      recentBlockhash,
      recentBlockhashesSysvar,
      SYSVAR_RENT_PUBKEY,
      SystemProgram,
      Transaction,
      TransactionInstruction,
    }));
    current = [account];
  }

  if (current.length > 0) {
    chunks.push(buildPrepareTransactionItem({
      plan,
      programId,
      source,
      accounts: current,
      chunk: chunks.length + 1,
      recentBlockhash,
      recentBlockhashesSysvar,
      SYSVAR_RENT_PUBKEY,
      SystemProgram,
      Transaction,
      TransactionInstruction,
    }));
  }

  return chunks;
}

function buildPrepareTransactionItem({
  plan,
  programId,
  source,
  accounts,
  chunk,
  recentBlockhash,
  recentBlockhashesSysvar,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
}) {
  const transaction = buildFundBundleTransaction({
    plan: {
      ...plan,
      recipients: accounts.map((account) => ({
        amountLamports: account.amountLamports.toString(),
      })),
    },
    programId,
    source,
    bundle: accounts,
    recentBlockhash,
    recentBlockhashesSysvar,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
  });
  const signers = [source, ...uniqueBundleSigners(accounts)];
  transaction.sign(...signers);
  return {
    chunk,
    accountIndexes: accounts.map((account) => account.index),
    accountCount: accounts.length,
    outputLamports: accounts.reduce((sum, account) => sum + account.amountLamports, 0n),
    transaction,
    signers,
    serializedBytes: transaction.serialize().length,
  };
}

function summarizeSimulations(simulations) {
  if (simulations.length === 0) {
    return {
      attempted: false,
      ok: false,
      error: null,
      logs: [],
    };
  }

  const failed = simulations.find((item) => !item.ok);
  return {
    attempted: true,
    ok: !failed,
    error: failed?.error ?? null,
    logs: simulations.flatMap((item) => item.logs),
  };
}

function reportPrepareTransaction(item) {
  return {
    chunk: item.chunk,
    accountIndexes: item.accountIndexes,
    accountCount: item.accountCount,
    outputLamports: item.outputLamports.toString(),
    outputSol: formatLamports(item.outputLamports),
    signerCount: item.signers.length,
    instructionCount: item.transaction.instructions.length,
    serializedBytes: item.serializedBytes,
    maxTransactionSizeBytes: MAX_TRANSACTION_SIZE_BYTES,
  };
}

function sumLamportStrings(values) {
  return values.reduce((sum, value) => {
    if (!value) {
      return sum;
    }
    return sum + BigInt(value);
  }, 0n);
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

export {
  MAX_TRANSACTION_SIZE_BYTES,
  buildPrepareTransactions,
};
