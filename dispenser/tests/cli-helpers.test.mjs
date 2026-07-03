import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptJson,
  encryptJson,
  formatLamports,
  parseExecuteFlags,
  parsePrepareFlags,
  parseRecipientFlag,
  parseSolToLamports,
  publicKeyFromSeed,
  validatePlan,
  verifySecrets,
} from "../bin/dispenser.mjs";

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
