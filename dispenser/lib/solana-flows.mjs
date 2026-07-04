import {
  checkedNumberFromLamports,
  formatLamports,
} from "./cli-core.mjs";

export const RECENT_BLOCKHASHES_SYSVAR_ADDRESS = "SysvarRecentB1ockHashes11111111111111111111";
export const FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR = Buffer.from([249, 121, 48, 67, 237, 244, 65, 234]);

export function buildFundBundleTransaction({
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

export function encodeFundBundleAccounts(amounts) {
  const data = Buffer.alloc(FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length + 4 + amounts.length * 8);
  FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.copy(data, 0);
  data.writeUInt32LE(amounts.length, FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length);

  for (const [index, amount] of amounts.entries()) {
    data.writeBigUInt64LE(BigInt(amount), FUND_BUNDLE_ACCOUNTS_DISCRIMINATOR.length + 4 + index * 8);
  }

  return data;
}

export function uniqueBundleSigners(bundle) {
  const signerMap = new Map();
  for (const account of bundle) {
    signerMap.set(account.disposable.publicKey.toBase58(), account.disposable);
    signerMap.set(account.nonce.publicKey.toBase58(), account.nonce);
  }
  return [...signerMap.values()];
}

export async function inspectPrepareAccounts(connection, bundle, SystemProgram) {
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

export async function inspectGeneratedAccount(connection, account, SystemProgram) {
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

export async function verifyPreparedAccounts(connection, bundle, nonceRentLamports, NonceAccount, SystemProgram) {
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

export async function verifyNonceAccount(connection, account, nonceRentLamports, NonceAccount, SystemProgram) {
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

export async function inspectPreparedPair(
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

export async function buildExecuteTransaction({
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

export async function buildRecoverTransactions({
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

export function estimateSignatureFeeLamports(transaction) {
  return transaction.compileMessage().header.numRequiredSignatures * 5000;
}
