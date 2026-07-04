import assert from "node:assert/strict";
import test from "node:test";

import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  MAX_TRANSACTION_SIZE_BYTES,
  buildPrepareTransactions,
} from "../bin/dispenser.mjs";
import { RECENT_BLOCKHASHES_SYSVAR_ADDRESS } from "../lib/solana-flows.mjs";

const PROGRAM_ID = new PublicKey("6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6");

test("buildPrepareTransactions chunks a 16 account prepare below Solana transaction size limits", () => {
  const source = keypair(41);
  const recentBlockhash = keypair(42).publicKey.toBase58();
  const bundle = Array.from({ length: 16 }, (_, index) => ({
    index,
    recipient: keypair(80 + index).publicKey.toBase58(),
    amountLamports: 1_000_000n,
    disposable: keypair(100 + index * 2),
    nonce: keypair(101 + index * 2),
  }));
  const plan = {
    recipients: bundle.map((account) => ({
      amountLamports: account.amountLamports.toString(),
    })),
  };

  const chunks = buildPrepareTransactions({
    plan,
    programId: PROGRAM_ID,
    source,
    bundle,
    recentBlockhash,
    recentBlockhashesSysvar: new PublicKey(RECENT_BLOCKHASHES_SYSVAR_ADDRESS),
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
  });

  assert.deepEqual(chunks.map((chunk) => chunk.accountCount), [4, 4, 4, 4]);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.accountIndexes), Array.from({ length: 16 }, (_, index) => index));
  assert.ok(chunks.every((chunk) => chunk.serializedBytes <= MAX_TRANSACTION_SIZE_BYTES));
});

function keypair(seedByte) {
  return Keypair.fromSeed(Buffer.alloc(32, seedByte));
}
