import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  requireExecuteConfirmation,
  requirePrepareConfirmation,
  requireRecoverConfirmation,
} from "../bin/dispenser.mjs";
import {
  decryptJson,
  encryptJson,
  formatLamports,
  parseExecuteFlags,
  parsePrepareFlags,
  parseRecipientFlag,
  parseSolToLamports,
  publicKeyFromSeed,
  validateConfig,
  validatePlan,
  validateRpcUrlForCluster,
  verifySecrets,
} from "../lib/cli-core.mjs";

const PROGRAM_ID = "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6";
const SOURCE = "6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg";
const RECIPIENT = "11111111111111111111111111111111";

test("parseSolToLamports accepts precise SOL values", () => {
  assert.equal(parseSolToLamports("0.000000001"), 1n);
  assert.equal(parseSolToLamports("1"), 1_000_000_000n);
  assert.equal(parseSolToLamports("2.500000009"), 2_500_000_009n);
});

test("parseSolToLamports rejects invalid values", () => {
  assert.throws(() => parseSolToLamports("-1"), /Invalid SOL amount/);
  assert.throws(() => parseSolToLamports("0.0000000001"), /Invalid SOL amount/);
  assert.throws(() => parseSolToLamports("1."), /Invalid SOL amount/);
  assert.throws(() => parseSolToLamports("abc"), /Invalid SOL amount/);
});

test("formatLamports trims fractional dust zeros", () => {
  assert.equal(formatLamports(0n), "0");
  assert.equal(formatLamports(1n), "0.000000001");
  assert.equal(formatLamports(1_230_000_000n), "1.23");
});

test("flag parsers keep prepare and execute modes explicit", () => {
  assert.deepEqual(parsePrepareFlags(["--run", "run-1", "--dry-run"]), {
    run: "run-1",
    secretsOnly: false,
    dryRun: true,
    confirm: false,
    confirmMainnet: "",
    confirmTotal: "",
    force: false,
  });

  assert.deepEqual(parseExecuteFlags(["--run", "run-1", "--confirm", "--force"]), {
    run: "run-1",
    dryRun: false,
    confirm: true,
    force: true,
    confirmMainnet: "",
    confirmTotal: "",
  });
});

test("recipient flag requires ADDRESS:SOL", () => {
  assert.deepEqual(parseRecipientFlag(`${RECIPIENT}:0.1`), {
    address: RECIPIENT,
    amountSol: "0.1",
  });
  assert.throws(() => parseRecipientFlag(RECIPIENT), /ADDRESS:SOL/);
});

test("validatePlan accepts a minimal valid plan", () => {
  assert.doesNotThrow(() => validatePlan(validPlan()));
});

test("validateConfig rejects inconsistent mainnet-ready settings", () => {
  assert.doesNotThrow(() => validateConfig(validConfig()));

  assert.throws(() => validateConfig({
    ...validConfig(),
    cluster: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rescueWallet: "",
  }), /mainnet-beta requires an explicit rescueWallet/);

  assert.throws(() => validateConfig({
    ...validConfig(),
    programId: "not-a-pubkey",
  }), /programId must be a Solana public key/);

  assert.throws(() => validateConfig({
    ...validConfig(),
    rescueWallet: "not-a-pubkey",
  }), /rescueWallet must be empty or a Solana public key/);

  assert.throws(() => validateConfig({
    ...validConfig(),
    maxSolPerRun: "0",
  }), /maxSolPerRun must be greater than zero/);
});

test("validateRpcUrlForCluster rejects obvious cluster mismatches", () => {
  assert.doesNotThrow(() => validateRpcUrlForCluster("https://api.devnet.solana.com", "devnet"));
  assert.doesNotThrow(() => validateRpcUrlForCluster("https://api.mainnet-beta.solana.com", "mainnet-beta"));
  assert.doesNotThrow(() => validateRpcUrlForCluster("http://127.0.0.1:8899", "localnet"));
  assert.doesNotThrow(() => validateRpcUrlForCluster("http://[::1]:8899", "localnet"));

  assert.throws(
    () => validateRpcUrlForCluster("https://api.devnet.solana.com", "mainnet-beta"),
    /mainnet-beta rpcUrl/
  );
  assert.throws(
    () => validateRpcUrlForCluster("https://api.mainnet-beta.solana.com", "devnet"),
    /devnet rpcUrl/
  );
  assert.throws(
    () => validateRpcUrlForCluster("https://api.devnet.solana.com", "localnet"),
    /localnet rpcUrl/
  );
});

test("mainnet plans require an explicit rescue wallet", () => {
  assert.throws(() => validatePlan({
    ...validPlan(),
    cluster: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rescueWallet: "",
  }), /mainnet-beta plans require an explicit rescue wallet/);
});

test("validatePlan rejects mismatched totals and too many wallets", () => {
  assert.throws(() => validatePlan({
    ...validPlan(),
    totalLamports: "2",
  }), /Recipient amounts must sum to total/);

  assert.throws(() => validatePlan({
    ...validPlan(),
    walletCount: 17,
    recipients: Array.from({ length: 17 }, (_, index) => ({
      index,
      address: RECIPIENT,
      amountLamports: "1",
      amountSol: "0.000000001",
    })),
    totalLamports: "17",
    totalSol: "0.000000017",
  }), /walletCount must not exceed/);
});

test("mainnet send confirmations require exact typed guards", () => {
  const plan = {
    ...validPlan(),
    cluster: "mainnet-beta",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    rescueWallet: SOURCE,
    totalSol: "0.000000001",
  };
  const flags = {
    confirm: true,
    confirmMainnet: "MAINNET",
    confirmTotal: plan.totalSol,
  };

  assert.doesNotThrow(() => requirePrepareConfirmation(plan, flags));
  assert.doesNotThrow(() => requireExecuteConfirmation(plan, flags));
  assert.doesNotThrow(() => requireRecoverConfirmation(plan, flags));

  assert.throws(
    () => requirePrepareConfirmation(plan, { ...flags, confirmMainnet: "mainnet" }),
    /mainnet prepare requires --confirm-mainnet MAINNET/
  );
  assert.throws(
    () => requireExecuteConfirmation(plan, { ...flags, confirmTotal: "0.1" }),
    /mainnet execute requires --confirm-total/
  );
  assert.throws(
    () => requireRecoverConfirmation(plan, { ...flags, confirm: false }),
    /recover send requires --confirm/
  );
});

test("program id stays consistent across CLI, Anchor, Rust, and docs", () => {
  const files = [
    "bin/dispenser.mjs",
    "Anchor.toml",
    "programs/sol-vault/src/lib.rs",
    "docs/DEVNET_SMOKE_RUNBOOK.md",
  ];

  for (const file of files) {
    assert.match(readFileSync(file, "utf8"), new RegExp(PROGRAM_ID), file);
  }
});

test("encryptJson round-trips without exposing plaintext fields", () => {
  const encrypted = encryptJson({ hello: "world" }, "test-passphrase-12345");
  assert.equal(encrypted.cipher, "aes-256-gcm");
  assert.equal(encrypted.kdf, "scrypt");
  assert.equal(Object.hasOwn(encrypted, "hello"), false);
  assert.deepEqual(decryptJson(encrypted, "test-passphrase-12345"), { hello: "world" });
});

test("verifySecrets validates generated account public keys", () => {
  const disposableSeed = Buffer.alloc(32, 7);
  const nonceSeed = Buffer.alloc(32, 8);
  const plan = validPlan();
  const secrets = {
    schemaVersion: 1,
    runId: plan.runId,
    createdAt: "2026-07-03T00:00:00.000Z",
    accounts: [{
      index: 0,
      recipient: RECIPIENT,
      amountLamports: "1",
      disposablePublicKey: publicKeyFromSeed(disposableSeed),
      disposableSeed: disposableSeed.toString("base64"),
      noncePublicKey: publicKeyFromSeed(nonceSeed),
      nonceSeed: nonceSeed.toString("base64"),
    }],
  };

  assert.doesNotThrow(() => verifySecrets(plan, secrets));
  assert.throws(() => verifySecrets(plan, {
    ...secrets,
    accounts: [{
      ...secrets.accounts[0],
      amountLamports: "2",
    }],
  }), /Secret amount mismatch/);
});

function validPlan() {
  return {
    schemaVersion: 1,
    runId: "test-run",
    createdAt: "2026-07-03T00:00:00.000Z",
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    sourceWalletPath: "./wallet.json",
    rescueWallet: SOURCE,
    programId: PROGRAM_ID,
    durableNonce: true,
    walletCount: 1,
    totalLamports: "1",
    totalSol: "0.000000001",
    recipients: [{
      index: 0,
      address: RECIPIENT,
      amountLamports: "1",
      amountSol: "0.000000001",
    }],
    status: "planned",
  };
}

function validConfig() {
  return {
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    sourceWalletPath: "./wallet.json",
    rescueWallet: SOURCE,
    programId: PROGRAM_ID,
    maxSolPerRun: "1.0",
    requireMainnetTypedConfirmation: true,
  };
}
