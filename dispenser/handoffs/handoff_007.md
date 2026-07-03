# Handoff 007 - Phase 1 Closed

## Status

Session closed on 2026-07-03.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

The parent directory `C:\Code5\sol-contract` remains only the git container.

## Current State

- Repository is on `main`.
- Phase 1 is complete.
- Phase 2, Phase 3, and Phase 4 are already complete.
- Next project phase is Phase 5 prepare flow.
- Current program id:

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

- No mainnet or real SOL was used.
- Local ignored config remains `dispenser.config.json`.
- Run artifacts remain under ignored `runs/`.

## What Changed In This Session

- Added local-validator integration tests for `fund_bundle_accounts`.
- Added `npm run test:program`.
- Added `bin/anchor-local-test.mjs`.
- Added localnet Anchor config.
- Added npm lockfile and test dependencies.
- Verified WSL local-validator flow.
- Updated `WORKPLAN.md` to mark Phase 1 completed.
- Updated `ENVIRONMENT.md` with WSL local-validator setup.

## Verified Commands

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
npm.cmd run doctor
npm.cmd run build:program
node --check bin\anchor-local-test.mjs
git diff --check
git diff --cached --check
```

WSL, from `~/sol-dispenser-test`:

```bash
npm ci
npm run doctor
npm run test:program
```

WSL local-validator test result:

```text
fund_bundle_accounts
  PASS funds disposable wallets and creates durable nonce accounts
  PASS rejects zero disposable amounts before moving funds
  PASS rejects remaining account count mismatches
  PASS rejects duplicate bundle accounts

4 passing
```

## Known Notes

- Windows `solana-test-validator` still cannot unpack its genesis archive in this environment, even from admin PowerShell.
- WSL/Linux validator tests are the reliable local-validator path for now.
- Windows `cargo-build-sbf` may still print undefined syscall post-processing warnings.
- The WSL local-validator test passing means the tested `fund_bundle_accounts` runtime path is not blocked by that warning.
- Do not run `anchor keys sync`; the program id is intentionally fixed in source.
- The test runner uses `anchor build --ignore-keys` for WSL test copies.

## Next Session Start

Read first:

1. `WORKPLAN.md`
2. `SAFETY_AND_SPECS.md`
3. `SESSION_PROTOCOL.md`
4. `ENVIRONMENT.md`
5. `handoffs/handoff_007.md`

Then continue Phase 5:

- estimate nonce rent and fees,
- preflight source wallet balance,
- build the `fund_bundle_accounts` transaction from a saved run plan and encrypted secrets,
- support dry-run first,
- verify expected disposable balances and nonce account state,
- write prepare report.

Keep the safety boundary:

- no mainnet,
- no real SOL,
- dry-run first,
- local validator before devnet,
- never print or commit private keys.
