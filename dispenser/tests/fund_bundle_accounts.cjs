const assert = require("node:assert/strict");
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");

const idl = require("../target/idl/sol_dispenser.json");

const PROGRAM_ID = new PublicKey(idl.address);
const RECENT_BLOCKHASHES_SYSVAR = new PublicKey("SysvarRecentB1ockHashes11111111111111111111");
const FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR = Buffer.from([249, 121, 48, 67, 237, 244, 65, 234]);

describe("fund_bundle_accounts", () => {
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899", "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(require(process.env.ANCHOR_WALLET || "../target/test-wallet.json"))
  );

  before(async () => {
    await airdropIfNeeded(connection, payer.publicKey, 5 * LAMPORTS_PER_SOL);
  });

  it("funds disposable wallets and creates durable nonce accounts", async () => {
    const bundle = newBundle(2);
    const amounts = [1_000_000n, 2_500_000n];
    const rent = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);

    const signature = await sendFundBundle(connection, payer, amounts, bundle);
    assert.match(signature, /^[1-9A-HJ-NP-Za-km-z]+$/);

    for (const [index, account] of bundle.entries()) {
      const disposableBalance = await connection.getBalance(account.disposable.publicKey, "confirmed");
      assert.equal(disposableBalance, Number(amounts[index]));

      const nonceInfo = await connection.getAccountInfo(account.nonce.publicKey, "confirmed");
      assert.ok(nonceInfo, "nonce account should exist");
      assert.equal(nonceInfo.owner.toBase58(), SystemProgram.programId.toBase58());
      assert.equal(nonceInfo.lamports, rent);

      const nonceState = NonceAccount.fromAccountData(nonceInfo.data);
      assert.equal(nonceState.authorizedPubkey.toBase58(), account.disposable.publicKey.toBase58());
      assert.ok(nonceState.nonce, "nonce account should contain a durable nonce value");
    }
  });

  it("rejects zero disposable amounts before moving funds", async () => {
    const bundle = newBundle(1);
    await assertProgramError(
      () => sendFundBundle(connection, payer, [0n], bundle),
      "ZeroAmount"
    );

    assert.equal(await connection.getBalance(bundle[0].disposable.publicKey, "confirmed"), 0);
    assert.equal(await connection.getAccountInfo(bundle[0].nonce.publicKey, "confirmed"), null);
  });

  it("rejects remaining account count mismatches", async () => {
    const bundle = newBundle(1);
    await assertProgramError(
      () => sendFundBundle(connection, payer, [1_000_000n], bundle, { omitLastRemainingAccount: true }),
      "BundleAccountMismatch"
    );
  });

  it("rejects duplicate bundle accounts", async () => {
    const bundle = newBundle(2);
    bundle[1].disposable = bundle[0].disposable;

    await assertProgramError(
      () => sendFundBundle(connection, payer, [1_000_000n, 1_000_000n], bundle),
      "DuplicateBundleAccount"
    );
  });
});

async function airdropIfNeeded(connection, publicKey, minimumLamports) {
  const currentBalance = await connection.getBalance(publicKey, "confirmed");
  if (currentBalance >= minimumLamports) {
    return;
  }

  const signature = await connection.requestAirdrop(publicKey, minimumLamports - currentBalance);
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
}

function newBundle(count) {
  return Array.from({ length: count }, () => ({
    disposable: Keypair.generate(),
    nonce: Keypair.generate(),
  }));
}

async function sendFundBundle(connection, payer, amounts, bundle, options = {}) {
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

  if (options.omitLastRemainingAccount) {
    remainingAccounts.pop();
  }

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: RECENT_BLOCKHASHES_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ],
    data: encodeFundBundleAccounts(amounts),
  });

  const signers = [payer, ...uniqueSigners(bundle, options)];
  const transaction = new Transaction().add(instruction);
  return sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: "confirmed",
  });
}

function uniqueSigners(bundle, options = {}) {
  const signerMap = new Map();
  for (const account of bundle) {
    signerMap.set(account.disposable.publicKey.toBase58(), account.disposable);
    signerMap.set(account.nonce.publicKey.toBase58(), account.nonce);
  }
  if (options.omitLastRemainingAccount) {
    signerMap.delete(bundle[bundle.length - 1].nonce.publicKey.toBase58());
  }
  return [...signerMap.values()];
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

async function assertProgramError(action, expectedName) {
  try {
    await action();
  } catch (error) {
    const errorText = [
      error.message,
      ...(error.logs || []),
    ].join("\n");
    assert.match(errorText, new RegExp(expectedName));
    return;
  }

  assert.fail(`Expected program error ${expectedName}`);
}
