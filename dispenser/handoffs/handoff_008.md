# Handoff 008 - Phase 5 Dry-Run Started

## Status

Session closed on 2026-07-03.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

The parent directory `C:\Code5\sol-contract` remains only the git container.

## Current State

- Phase 5 is complete on devnet.
- Phase 6 inspect flow is complete on devnet.
- Phase 7 execute flow is complete on devnet.
- Phase 8 recover flow is complete on devnet.
- Phase 9 testing and hardening is in progress.
- Added `prepare --run RUN_ID --dry-run` CLI path.
- Added `prepare --run RUN_ID --confirm` send path behind explicit confirmation.
- `prepare --secrets-only` still works.
- No transaction sending was added.
- No mainnet or real SOL was used.
- Ignored test run artifacts were created under `dispenser/runs/`.

## What Changed In This Session

- Added lazy `@solana/web3.js` loading so `doctor`, `plan`, and `prepare --secrets-only` still work before dependencies are installed.
- Added dry-run transaction construction for `fund_bundle_accounts`.
- Added source wallet balance preflight.
- Added nonce rent and fee estimation.
- Added generated disposable/nonce account preflight checks.
- Added transaction simulation when balance and account preflight pass.
- Added `prepare-dry-run-report.json` output for dry-run reports.
- Added `prepare-report.json` output for confirmed prepare attempts.
- Added preflight failure handling that writes a report and sends no transaction.
- Added post-send verification for disposable balances and nonce account state.
- Added mainnet typed gates: `--confirm-mainnet MAINNET` and `--confirm-total <exact SOL>`.
- Added CLI validation for the on-chain wallet count limit of 16.
- Added `inspect --run RUN_ID`.
- Added `inspect-report.json` with source balance, disposable balances, nonce state, recipient status, recoverable total, and mismatch detection.
- Added `execute --run RUN_ID --dry-run`.
- Added `execute --run RUN_ID --confirm`.
- Execute uses the prepared durable nonce and signs with the stored disposable key; the source wallet is the fee payer so disposable wallets can transfer the exact planned recipient amount.
- Added `execute-dry-run-report.json` and `execute-report.json`.
- Updated inspect to understand executed runs, where disposable balances are expected to be zero.
- Added `recover --run RUN_ID --dry-run`.
- Added `recover --run RUN_ID --confirm`.
- Recover transfers disposable leftovers and withdraws nonce rent to the rescue wallet; if `rescueWallet` is empty, the source wallet is used.
- Added `recover-dry-run-report.json` and `recover-report.json`.
- Updated inspect to understand recovered runs, where nonce accounts are expected to be closed.
- Added `npm test` using Node's built-in test runner.
- Added `tests/cli-helpers.test.mjs` covering SOL parsing/formatting, flag parsing, plan validation, key vault encryption/decryption, and secret verification.
- Updated CLI help text for Phase 5.
- Updated `WORKPLAN.md` to mark Phase 5, Phase 6, Phase 7, and Phase 8 completed.

## Verified Commands

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
node --check bin\dispenser.mjs
npm.cmd run doctor
npm.cmd run dispenser -- plan --total 0.001 --wallets 1 --recipient 11111111111111111111111111111111:0.001
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T175916Z --secrets-only
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T175916Z --dry-run
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T175916Z --confirm --force
npm.cmd run test:program
solana program deploy --program-id target\deploy\sol_dispenser-keypair.json --keypair wallet.json --url https://api.devnet.solana.com target\deploy\sol_dispenser.so
solana program show 6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6 --url https://api.devnet.solana.com --keypair wallet.json
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- inspect --run 20260703T175916Z
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- execute --run 20260703T175916Z --dry-run
npm.cmd run dispenser -- plan --total 0.001 --wallets 1 --recipient 6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg:0.001
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T183306Z --secrets-only
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T183306Z --dry-run
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- prepare --run 20260703T183306Z --confirm
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- inspect --run 20260703T183306Z
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- execute --run 20260703T183306Z --dry-run
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- execute --run 20260703T183306Z --confirm
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- inspect --run 20260703T183306Z
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- recover --run 20260703T183306Z --dry-run
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- recover --run 20260703T183306Z --confirm
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- inspect --run 20260703T183306Z
npm.cmd test
git diff --check
```

Results:

- `node --check bin\dispenser.mjs`: passed.
- `npm.cmd run doctor`: passed.
- `plan`: passed after sandbox escalation allowed writing ignored `runs/` artifacts.
- `prepare --secrets-only`: passed after sandbox escalation allowed writing ignored `runs/` artifacts.
- `npm ci`: passed after user approval.
- `prepare --dry-run`: reached devnet RPC, wrote `prepare-dry-run-report.json`, and stopped because the ignored test source wallet had 0 SOL.
- `prepare --confirm --force`: wrote `prepare-report.json` with `status: preflight_failed`, `signature: null`, and sent no transaction.
- `solana airdrop 1 ... --url https://api.devnet.solana.com`: failed due faucet/rate limit.
- User funded the devnet wallet to 2.5 SOL.
- `solana program deploy ...`: passed.
- Devnet program deploy signature: `3N8ZKz1Hj1X41MCrfwxk9P2y1gcQvdvyypYUpxCA45466cHVLanRjHjcjAArmE7qvEUMf8QbhBSLKcKrCWhP64pM`.
- `prepare --dry-run`: passed after program deploy.
- `prepare --confirm --force`: passed and wrote `status: prepared`.
- Prepare signature: `55epyEtFAtxUT8iBFpP9k5ozYe9ithqpnAXF19wjcixLY8jwwvnnskMvTGmvznYskRKESoc4a6V6dp3pwbD9rhvx`.
- `inspect --run 20260703T175916Z`: passed with `status: ok`.
- `execute --run 20260703T175916Z --dry-run`: correctly failed preflight because the smoke-test recipient was `11111111111111111111111111111111`, producing `ReadonlyLamportChange`; no transaction was sent.
- Created a second devnet run `20260703T183306Z` with recipient set to the source wallet for successful execute verification.
- `prepare --dry-run`, `prepare --confirm`, and `inspect` passed for run `20260703T183306Z`.
- `execute --dry-run` passed for run `20260703T183306Z`.
- First `execute --confirm` attempt for run `20260703T183306Z` failed before sending due a transient devnet RPC `fetch failed`.
- Retried `execute --confirm`; it passed with `status: executed`.
- Final `inspect --run 20260703T183306Z`: passed with `status: ok`, disposable balance `0`, nonce rent still recoverable.
- `recover --dry-run` passed for run `20260703T183306Z`; recoverable amount was `0.00144768 SOL`.
- `recover --confirm` passed with `status: recovered`.
- Recover signature: `48w5o29ey6FunmNjozr8rHtDgKfMD2EaDpbCvoa3bmL18kJuoDuA6YCZqWJtVQHV6N5iQqjC2rtDWUn89oc4DagZ`.
- Final `inspect --run 20260703T183306Z`: passed with `status: ok`, disposable balance `0`, nonce account closed, recoverable total `0`.
- `npm.cmd test`: passed, 9 tests.
- `npm.cmd run test:program`: still failed on Windows; after escalation it reached `solana-test-validator`, which exited with code 101 because the Windows client lacks required privileges (`os code 1314`).
- `git diff --check`: passed.

## Known Notes

- `npm ci` succeeded after user approval.
- npm reported 6 audit findings in installed dependencies. No `npm audit fix --force` was run because it can rewrite dependency versions and is outside this focused Phase 5 slice.
- A first `solana-keygen new` attempt printed a seed phrase for a test wallet. That wallet was immediately treated as compromised and deleted. A replacement ignored `wallet.json` was created with `--silent`; do not fund or reuse the deleted wallet.
- The current Windows user context cannot see the documented WSL distro:

```text
wsl.exe -l -v
wsl.exe -d solana-ubuntu ...
```

Both failed; `solana-ubuntu` reported `WSL_E_DISTRO_NOT_FOUND`.

- Docs still say WSL local-validator testing is the reliable path, but this session cannot access that distro from the current user context.
- Windows local validator still needs WSL or OS privilege fix, but devnet Phase 5/6 verification is complete.

## Devnet Prepared Run

```text
Run: 20260703T175916Z
Source: 6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg
Program: 6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
Disposable: EzW56M8G1CLS8nkpExFdvLPPCf2zb4oArU28rfjGJyk7
Nonce: 2PogHe5Ug8xUDpnnq2r7YPaL6SZS6sMtkpeeaV8yXZx4
Recipient: 11111111111111111111111111111111
Disposable balance: 0.001 SOL
Nonce rent: 0.00144768 SOL
Nonce authority: EzW56M8G1CLS8nkpExFdvLPPCf2zb4oArU28rfjGJyk7
Recoverable total from prepared accounts: 0.00244768 SOL
```

## Devnet Executed Run

```text
Run: 20260703T183306Z
Source / recipient: 6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg
Disposable: EB8qwN1UGsuvVKEsTmTAAZ8o7c2rMXSfpoY5xykBgBtu
Nonce: EtfHXsMdpAhWakB8k9vH5bL1S1rwSpKCYPfA87K3oJq3
Prepare signature: 2ay8bgiBiaK4ucpr4UQCffAam5K8NJDWESsZDNBU7i3f4hc82ZtoyuF7mqCb7cmegy68vRsja6oKB7nHEFvG894B
Execute status: executed
Execute signature: 4LyPWGAUr2MPvsxyzMJzMgXUWCU6mqRJsT86mTcJbSGrtuY93jn9RyFmiwGH8bWX5kcMfoza89vqyjiFMooi2Pkz
Recover signature: 48w5o29ey6FunmNjozr8rHtDgKfMD2EaDpbCvoa3bmL18kJuoDuA6YCZqWJtVQHV6N5iQqjC2rtDWUn89oc4DagZ
Disposable balance after execute: 0 SOL
Nonce account after recover: closed
Recoverable total after recover: 0 SOL
```

## Next Exact Step

Continue Phase 9 testing and hardening:

```powershell
cd C:\Code5\sol-contract\dispenser
$env:DISPENSER_PASSPHRASE='<test passphrase>'; npm.cmd run dispenser -- inspect --run 20260703T175916Z
```

Recommended next slice: add focused CLI regression tests for prepare/inspect/execute/recover pure logic and report lifecycle handling, then address the Windows local-validator/WSL testing path separately.
