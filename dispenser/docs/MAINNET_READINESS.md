# Mainnet Readiness Checklist

## Boundary

This document is a readiness checklist only. Do not run `mainnet-beta` commands,
mainnet dry-runs, or mainnet RPC checks without a separate explicit operator
approval for that exact action.

Mainnet is never part of automated tests.

## Required Local Gates

Run from:

```powershell
C:\Code5\sol-contract\dispenser
```

Before any mainnet approval is considered:

```powershell
node --check bin\dispenser.mjs
npm test
npm run doctor
```

Before any mainnet transaction approval is considered, run one fresh devnet
smoke test on the exact commit intended for mainnet review. Record the run id,
final recoverable amount, final source balance, and report statuses in the
handoff note or operator log.

If WSL/local-validator verification is required, Codex must not run `wsl.exe`.
The operator runs the WSL commands documented in `SESSION_PROTOCOL.md`.

## Program Id Consistency

The expected program id is:

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

Before mainnet approval, verify it matches:

- `bin/dispenser.mjs` default config,
- `Anchor.toml` `[programs.devnet]` and `[programs.localnet]`,
- `programs/sol-vault/src/lib.rs` `declare_id!`,
- operator-approved deployed program id for the target cluster.

The automated unit test `program id stays consistent across CLI, Anchor, Rust,
and docs` covers the repo-local files. It does not prove a mainnet deployment.

## Config Policy

`dispenser.config.json` must be reviewed by the operator before planning:

```json
{
  "cluster": "mainnet-beta",
  "rpcUrl": "<operator-approved mainnet RPC URL>",
  "sourceWallet": "<operator-controlled mainnet source wallet public key>",
  "sourceWalletPath": "./wallet.json",
  "rescueWallet": "<operator-controlled mainnet rescue wallet>",
  "programId": "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6",
  "maxSolPerRun": "<operator-approved cap>",
  "requireMainnetTypedConfirmation": true
}
```

Rules enforced by local validation:

- `requireMainnetTypedConfirmation` must be `true`.
- `programId` must be a Solana public key.
- `sourceWallet` must be a Solana public key when `cluster` is `mainnet-beta`.
- `sourceWalletPath` must load a keypair whose public key equals `sourceWallet`.
- `rescueWallet` must be a Solana public key when `cluster` is `mainnet-beta`.
- `maxSolPerRun` must be greater than zero.
- obvious RPC/cluster mismatches are rejected.
- plans cannot exceed `maxSolPerRun`.

## Source and Rescue Wallet Policy

Use only operator-controlled wallets.

The source wallet pays prepare funding and later execute/recover fees. The rescue
wallet receives all recoverable leftovers and nonce rent. For mainnet, the rescue
wallet must be explicit; falling back to the source wallet is allowed only for
non-mainnet runs.

Set the public source wallet in `sourceWallet`, and set the local keypair file
in `sourceWalletPath`. The CLI derives the public key from `sourceWalletPath`
before prepare, inspect, execute, and recover. If it does not match
`sourceWallet`, the command fails before building or sending transactions.

Before approval, record offline:

- source wallet public key,
- rescue wallet public key,
- expected recipient list,
- total SOL and lamports,
- max SOL cap,
- RPC provider,
- recovery contact/process.

Do not commit wallet files, `.env`, encrypted run secrets, or run outputs.

Report files are protected by a local runtime secret scan. The CLI refuses to
write report JSON if a report object contains seed, private key, passphrase, or
encrypted-secret payload fields. This does not make reports public-safe; treat
wallet addresses, balances, recipients, RPC URLs, signatures, and timing as
operationally sensitive unless the operator explicitly approves sharing a
redacted report.

## Final Operator Checklist

Complete this section offline before creating any mainnet plan. The operator
should keep the completed checklist out of git because it contains operational
wallet and recipient details.

### Source Wallet

- Public key recorded.
- Wallet file path recorded.
- Wallet file is outside git tracking.
- Wallet is operator-controlled.
- Wallet balance is enough for total output, nonce rent, estimated fees, and a
  margin chosen by the operator.
- Wallet is not a cold-storage key unless the operator explicitly accepts using
  it as an online signer.
- Wallet public key matches the source shown by `prepare --dry-run`.

### Rescue Wallet

- Public key recorded.
- Wallet is operator-controlled.
- Wallet is not one of the disposable wallets.
- Wallet is not one of the final recipient wallets unless intentionally chosen
  and recorded.
- Wallet is valid on the target cluster.
- Wallet public key matches the rescue wallet shown by `recover --dry-run`.
- Mainnet config does not rely on source-wallet fallback.

### Recipients

- Every recipient is operator-approved.
- Every recipient address is copied from a trusted source.
- Per-recipient lamports and SOL amounts are recorded.
- Sum of recipient lamports equals plan total lamports.
- Duplicate recipients are intentional and recorded.
- The exact plan total is available for `--confirm-total`.

### Limits and Fees

- `maxSolPerRun` is operator-approved.
- Plan total is less than or equal to `maxSolPerRun`.
- Nonce rent estimate is reviewed.
- Fee estimate is reviewed.
- Operator accepts that final live fees can vary from estimates.
- Operator accepts that Solana transactions and balances are public.

### Files and Secrets

- `DISPENSER_PASSPHRASE` is available to the operator.
- Passphrase is not written to disk, chat, shell history, docs, or reports.
- `wallet.json`, `.env`, `runs/`, and `*.enc.json` are ignored by git.
- `secrets.enc.json` exists before funding.
- `secrets-report.json` contains public keys only, not generated seeds.
- Reports are treated as operationally sensitive even after the secret scan.

### Config Checklist

Review `dispenser.config.json` before planning:

- `cluster` is exactly `mainnet-beta`.
- `rpcUrl` is the operator-approved mainnet RPC endpoint.
- `rpcUrl` does not point at devnet, testnet, localhost, or 127.0.0.1.
- `sourceWallet` is non-empty and matches the recorded source wallet.
- `sourceWalletPath` points at the intended operator-controlled keypair file.
- the keypair at `sourceWalletPath` derives to `sourceWallet`.
- `rescueWallet` is non-empty and matches the recorded rescue wallet.
- `programId` matches the operator-approved deployed mainnet program id.
- `maxSolPerRun` matches the approved cap.
- `requireMainnetTypedConfirmation` is `true`.

Then run local checks only:

```powershell
npm test
npm run doctor
```

`doctor` reads local config and toolchain state. Treat any configured
`mainnet-beta` RPC connectivity check as a separate approval item if such a
check is added later.

## Approval Stages

Mainnet approval is split into separate gates. Approval for one gate does not
approve later gates.

### Gate 0 - Local Readiness

Allowed actions:

- local tests,
- local docs review,
- local config file review,
- devnet smoke test.

Required before passing Gate 0:

- tests pass,
- latest devnet smoke passes,
- final recoverable amount is zero after devnet recover,
- current commit hash is recorded,
- operator has reviewed this checklist.

### Gate 1 - Mainnet RPC Verification

Requires explicit operator approval naming:

- target commit,
- `mainnet-beta`,
- RPC endpoint,
- source wallet public key,
- rescue wallet public key,
- maximum total SOL.

Allowed actions after Gate 1 approval:

- run local commands that contact the approved mainnet RPC without sending
  transactions,
- create or inspect a mainnet plan,
- run dry-runs only if the operator explicitly includes dry-runs in the approval.

Not allowed:

- `prepare --confirm`,
- `execute --confirm`,
- `recover --confirm`.

### Gate 2 - Prepare Send

Requires a separate explicit approval after reviewing `prepare --dry-run`.

Approval must include:

- run id,
- exact total SOL,
- exact total lamports,
- source wallet,
- rescue wallet,
- program id,
- `--confirm-mainnet MAINNET`,
- `--confirm-total <exact plan total SOL>`.

Allowed action:

- `prepare --confirm` for that run id only.

### Gate 3 - Execute Send

Requires a separate explicit approval after `inspect` and `execute --dry-run`.

Allowed action:

- `execute --confirm` for that run id only.

### Gate 4 - Recover Send

Requires a separate explicit approval after `inspect` and `recover --dry-run`.

Allowed action:

- `recover --confirm` for that run id only.

After Gate 4, run `inspect` and record final recoverable amount. A healthy
completed run has final recoverable amount `0`.

## Typed Confirmation Guards

Mainnet send paths require all of:

```text
--confirm
--confirm-mainnet MAINNET
--confirm-total <exact plan total SOL>
```

This applies to:

- `prepare --confirm`,
- `execute --confirm`,
- `recover --confirm`.

Dry-runs and inspection still contact the configured RPC. Treat any
`mainnet-beta` RPC contact as requiring separate operator approval.

## Emergency Recovery

When any prepare, execute, or recover operation fails:

1. Stop immediately.
2. Preserve `runs/<run-id>/bundle-plan.json`, `secrets.enc.json`, and reports.
3. Keep `DISPENSER_PASSPHRASE` available to the operator, but do not write it to
   disk or paste it into logs.
4. Run inspect only after explicit approval for the configured cluster.
5. Run recover dry-run only after explicit approval for the configured cluster.
6. Run recover confirm only after reviewing exact recoverable lamports, rescue
   wallet, source fee payer, and typed mainnet confirmation flags.

Operator command sequence after approval:

```powershell
$env:DISPENSER_PASSPHRASE = "<operator passphrase>"
npm run dispenser -- inspect --run <RUN_ID>
npm run dispenser -- recover --run <RUN_ID> --dry-run
npm run dispenser -- recover --run <RUN_ID> --confirm --confirm-mainnet MAINNET --confirm-total <exact plan total SOL>
npm run dispenser -- inspect --run <RUN_ID>
```

If recover preflight reports a nonce authority mismatch, missing secrets, or an
unexpected balance delta, stop and preserve reports for manual review.

### Partial Prepare

If `prepare --confirm` fails or is interrupted:

1. Do not rerun with `--force` until inspecting the existing `prepare-report.json`.
2. If the report contains submitted signatures, preserve it and run `inspect`
   after explicit approval for the configured cluster.
3. If inspect shows funded disposable wallets or initialized nonce accounts,
   run `recover --dry-run` before any new prepare attempt.
4. If no signatures were submitted and generated accounts are still empty, a
   fresh run is usually safer than forcing the existing one.

### Partial Execute

If `execute --confirm` fails or is interrupted:

1. Preserve `execute-report.json`, especially any `send_in_progress` signatures.
2. Run `inspect` after explicit approval and compare recipient balances,
   disposable balances, and nonce states.
3. Rerun `execute --dry-run` only after inspect; the execute helper treats
   already-funded recipients with empty disposable wallets as already executed.
4. Run `recover --dry-run` after execute is complete or no remaining execute
   action can safely proceed.

### Partial Recover

If `recover --confirm` fails or is interrupted:

1. Preserve `recover-report.json`.
2. Run `inspect` after explicit approval and check which nonce accounts are
   closed and which disposable balances remain.
3. Rerun `recover --dry-run`; recovered accounts should be idempotent because
   closed nonce accounts and empty disposable wallets are reported as no-op.
4. Rerun `recover --confirm` only after reviewing the new dry-run report and
   typed mainnet confirmation flags.

## Current Readiness Status

As of 2026-07-04, Phase 10 local guard and checklist work is complete pending
explicit mainnet approval. The latest fresh devnet smoke run passed on runtime
commit `24778aa` using run `20260704T132636Z`:

- total output: `0.003 SOL`,
- recipients: `2`,
- `prepare-report.json`: `prepared`,
- first `inspect-report.json`: `ok`,
- `execute-dry-run-report.json`: `ok`,
- `execute-report.json`: `executed`,
- `recover-dry-run-report.json`: `ok`,
- `recover-report.json`: `recovered`,
- final `inspect-report.json`: `ok`,
- final recoverable amount: `0 SOL`,
- final source balance: `0.76145324 SOL`.

After that smoke run, an additional source-wallet guard was added: mainnet
configs and plans must include `sourceWallet`, and the CLI verifies that
`sourceWalletPath` derives to that public key before prepare, inspect, execute,
or recover. Run a fresh devnet smoke on the new target commit before any
mainnet send gate.

A mainnet deployment, mainnet RPC verification, mainnet dry-run, and every
mainnet send action each require separate explicit operator approval.
