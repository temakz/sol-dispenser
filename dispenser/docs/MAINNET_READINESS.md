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

As of 2026-07-04, Phase 10 has started but is not complete. Local guards and
documentation can be reviewed without touching mainnet. A mainnet deployment and
any mainnet RPC action remain pending separate explicit operator approval.
