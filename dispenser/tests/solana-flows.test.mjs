import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  NonceAccount,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  RECENT_BLOCKHASHES_SYSVAR_ADDRESS,
  buildExecuteTransaction,
  buildFundBundleTransaction,
  buildRecoverTransactions,
  encodeFundBundleAccounts,
  inspectPrepareAccounts,
  inspectPreparedPair,
  uniqueBundleSigners,
} from "../lib/solana-flows.mjs";

test("encodeFundBundleAccounts writes Anchor discriminator, length, and lamports", () => {
  const data = encodeFundBundleAccounts([1n, 2_500_000_000n]);

  assert.equal(data.subarray(0, 8).toString("hex"), "f9793043edf441ea");
  assert.equal(data.readUInt32LE(8), 2);
  assert.equal(data.readBigUInt64LE(12), 1n);
  assert.equal(data.readBigUInt64LE(20), 2_500_000_000n);
});

test("buildFundBundleTransaction preserves account order and instruction data", () => {
  const source = keypair(1);
  const disposable = keypair(2);
  const nonce = keypair(3);
  const programId = keypair(4).publicKey;
  const recentBlockhash = keypair(5).publicKey.toBase58();
  const recentBlockhashesSysvar = new PublicKey(RECENT_BLOCKHASHES_SYSVAR_ADDRESS);
  const plan = {
    recipients: [{
      amountLamports: "123",
    }],
  };
  const bundle = [{
    disposable,
    nonce,
  }];

  const transaction = buildFundBundleTransaction({
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
  });

  assert.equal(transaction.feePayer.toBase58(), source.publicKey.toBase58());
  assert.equal(transaction.recentBlockhash, recentBlockhash);
  assert.equal(transaction.instructions.length, 1);

  const [instruction] = transaction.instructions;
  assert.equal(instruction.programId.toBase58(), programId.toBase58());
  assert.deepEqual([...instruction.data], [...encodeFundBundleAccounts([123n])]);
  assertKey(instruction.keys[0], source.publicKey, true, true);
  assertKey(instruction.keys[1], recentBlockhashesSysvar, false, false);
  assertKey(instruction.keys[2], SYSVAR_RENT_PUBKEY, false, false);
  assertKey(instruction.keys[3], SystemProgram.programId, false, false);
  assertKey(instruction.keys[4], disposable.publicKey, true, true);
  assertKey(instruction.keys[5], nonce.publicKey, true, true);
});

test("uniqueBundleSigners deduplicates generated account signers", () => {
  const disposable = keypair(6);
  const firstNonce = keypair(7);
  const secondNonce = keypair(8);

  const signers = uniqueBundleSigners([
    { disposable, nonce: firstNonce },
    { disposable, nonce: secondNonce },
  ]);

  assert.deepEqual(signers.map((signer) => signer.publicKey.toBase58()), [
    disposable.publicKey.toBase58(),
    firstNonce.publicKey.toBase58(),
    secondNonce.publicKey.toBase58(),
  ]);
});

test("inspectPrepareAccounts reports missing generated accounts as safe and initialized nonce accounts as unsafe", async () => {
  const disposable = keypair(9);
  const nonce = keypair(10);
  const connection = new FakeConnection({
    infos: [
      [disposable.publicKey, null],
      [nonce.publicKey, {
        owner: SystemProgram.programId,
        lamports: 1,
        data: Buffer.from([1]),
      }],
    ],
  });

  const checks = await inspectPrepareAccounts(connection, [{
    index: 0,
    disposable,
    nonce,
  }], SystemProgram);

  assert.equal(checks.length, 2);
  assert.equal(checks[0].role, "disposable");
  assert.equal(checks[0].ok, true);
  assert.equal(checks[1].role, "nonce");
  assert.equal(checks[1].ok, false);
});

test("inspectPreparedPair accepts recovered accounts with empty disposable balance and closed nonce", async () => {
  const disposable = keypair(11);
  const nonce = keypair(12);
  const recipient = keypair(13).publicKey;
  const connection = new FakeConnection({
    balances: [
      [disposable.publicKey, 0],
      [recipient, 50],
    ],
    infos: [
      [nonce.publicKey, null],
    ],
  });

  const report = await inspectPreparedPair(
    connection,
    {
      index: 0,
      recipient: recipient.toBase58(),
      amountLamports: 50n,
      disposable,
      nonce,
    },
    NonceAccount,
    PublicKey,
    SystemProgram,
    { executionComplete: true, recoveryComplete: true }
  );

  assert.equal(report.disposable.ok, true);
  assert.equal(report.nonce.ok, true);
  assert.deepEqual(report.mismatches, []);
});

test("buildExecuteTransaction fails safely when nonce account is missing", async () => {
  const source = keypair(14);
  const disposable = keypair(15);
  const nonce = keypair(16);
  const recipient = keypair(17).publicKey;
  const connection = new FakeConnection({
    balances: [
      [disposable.publicKey, 100],
      [recipient, 0],
    ],
    infos: [
      [nonce.publicKey, null],
    ],
  });

  const execution = await buildExecuteTransaction({
    connection,
    account: {
      index: 0,
      recipient: recipient.toBase58(),
      amountLamports: 100n,
      disposable,
      nonce,
    },
    source,
    NonceAccount,
    PublicKey,
    SystemProgram,
    Transaction,
  });

  assert.equal(execution.ok, false);
  assert.equal(execution.detail, "nonce account is missing");
  assert.equal(execution.estimatedFeeLamports, "0");
  assert.equal(Object.hasOwn(execution, "transaction"), false);
});

test("buildRecoverTransactions returns an empty successful plan when nothing is recoverable", async () => {
  const source = keypair(18);
  const disposable = keypair(19);
  const nonce = keypair(20);
  const rescue = keypair(21).publicKey;
  const connection = new FakeConnection({
    balances: [
      [disposable.publicKey, 0],
    ],
    infos: [
      [nonce.publicKey, null],
    ],
  });

  const recovery = await buildRecoverTransactions({
    connection,
    account: {
      index: 0,
      disposable,
      nonce,
    },
    source,
    rescue,
    NonceAccount,
    SystemProgram,
    Transaction,
  });

  assert.equal(recovery.ok, true);
  assert.equal(recovery.recoverableLamports, "0");
  assert.equal(recovery.estimatedFeeLamports, "0");
  assert.deepEqual(recovery.actions, []);
});

function keypair(seedByte) {
  return Keypair.fromSeed(Buffer.alloc(32, seedByte));
}

function assertKey(actual, pubkey, isSigner, isWritable) {
  assert.equal(actual.pubkey.toBase58(), pubkey.toBase58());
  assert.equal(actual.isSigner, isSigner);
  assert.equal(actual.isWritable, isWritable);
}

class FakeConnection {
  constructor({ balances = [], infos = [] } = {}) {
    this.balances = new Map(balances.map(([pubkey, balance]) => [key(pubkey), balance]));
    this.infos = new Map(infos.map(([pubkey, info]) => [key(pubkey), info]));
  }

  async getBalance(pubkey) {
    return this.balances.get(key(pubkey)) ?? 0;
  }

  async getAccountInfo(pubkey) {
    return this.infos.get(key(pubkey)) ?? null;
  }

  async getLatestBlockhash() {
    return {
      blockhash: keypair(31).publicKey.toBase58(),
      lastValidBlockHeight: 1,
    };
  }
}

function key(pubkey) {
  return pubkey.toBase58();
}
