# Handoff 021 - Gate 0.5 Mainnet Deployment Plan

## Status

Session updated on 2026-07-16.

Phase 10 remains in progress. Gate 0.5 is planned but not approved and not
executed. No mainnet deployment, mainnet dry-run, mainnet plan, prepare,
execute, recover, upgrade, buffer write, authority change, or other mainnet
transaction command was run. No WSL commands were run by Codex.

## Repository State Reviewed

- Project root: `C:\Code5\sol-contract\dispenser`
- Git container: `C:\Code5\sol-contract`
- Starting working tree: clean
- Current branch: `main`
- Starting HEAD: `8b4a11a docs: add mainnet deployment handoff`
- Local tracking state at session start: `main` matched local `origin/main`

## What Changed

- Added `docs/MAINNET_PROGRAM_DEPLOYMENT_PLAN.md`.
- Linked the Gate 0.5 plan from `docs/MAINNET_READINESS.md`.
- Updated `WORKPLAN.md` to record that the Gate 0.5 deployment plan exists.
- Updated tracked `.env.example` so `MAINNET_PROGRAM_ID` matches the
  repo-local expected program id.
- Updated the env materialization unit test to use the repo-local expected
  program id.
- Ran the full local Gate 0.5 pre-approval check set. `build:program` required
  elevated local toolchain access because the sandbox could not remove a stale
  Rust SBF toolchain directory under the user profile.

## Program Id Decision Captured

Preferred deployment target:

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

This id matches:

- `bin/dispenser.mjs`
- `Anchor.toml`
- `programs/sol-vault/src/lib.rs`
- `docs/DEVNET_SMOKE_RUNBOOK.md`
- `target/deploy/sol_dispenser-keypair.json` public address

The previously configured mainnet id
`6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5` remains documented as the id that
Gate 1 found missing on mainnet. It should not be used for deployment unless
the operator explicitly chooses that id and approves a matching keypair or full
repo-local consistency update.

## Commands Run

Windows, from `C:\Code5\sol-contract` unless noted:

```powershell
git status --short
git status -sb
git rev-parse --short HEAD
git log -1 --oneline --decorate
git branch -vv
git remote -v
```

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
Get-Content -Path WORKPLAN.md
Get-Content -Path SAFETY_AND_SPECS.md
Get-Content -Path SESSION_PROTOCOL.md
Get-Content -Path ENVIRONMENT.md
Get-Content -Path docs\MAINNET_READINESS.md
Get-Content -Path handoffs\handoff_019.md
Get-Content -Path handoffs\handoff_020.md
Get-Content -Path package.json
Get-Content -Path Anchor.toml
Get-Content -Path programs\sol-vault\src\lib.rs
Get-Content -Path .env.example
rg -n "programId|program id|declare_id|anchor|deploy|upgrade|config-from-env|wallet-from-env|mainnet" bin lib tests docs WORKPLAN.md Anchor.toml programs package.json
solana program deploy --help
solana program show --help
solana rent --help
solana program dump --help
solana address -k target\deploy\sol_dispenser-keypair.json
node --check bin\dispenser.mjs
npm.cmd test
npm.cmd run build:program
git diff --check
git status --short
```

## Verification

- `solana address -k target\deploy\sol_dispenser-keypair.json`: printed the
  expected public program id
  `6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6`.
- `node --check bin\dispenser.mjs`: passed.
- `npm.cmd test`: passed, 38 tests.
- `npm.cmd run build:program`: passed after user-approved escalated local
  toolchain access. It emitted the known Windows SBF post-processing syscall
  warning already documented in `ENVIRONMENT.md`.
- `git diff --check`: passed; PowerShell emitted expected CRLF normalization
  warnings only.

## Known Blockers

- Mainnet deployment still requires a separate explicit operator approval.
- Mainnet RPC contact for post-deploy readonly verification still requires a
  separate explicit operator approval.
- The prior Gate 1 source balance was `0.100001 SOL`, which may be too low for
  initial program deployment rent, buffer writes, and fees. Recheck the payer
  balance before approving deployment.
- The ignored local `dispenser.config.json` still points at the previously
  missing mainnet program id
  `6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5`. After the operator chooses the
  target program id, update/re-materialize local ignored config before any
  mainnet RPC verification or deployment.
- Local ignored `.env`, `wallet-mainnet.json`, `dispenser.config.json`, `runs/`,
  and `target/` artifacts must not be committed.

## Exact Next Step

Review `docs/MAINNET_PROGRAM_DEPLOYMENT_PLAN.md`.

If the operator wants Codex to continue, first decide whether the target mainnet
program id is:

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

Then provide a separate explicit Gate 0.5 approval naming:

- commit hash,
- cluster `mainnet-beta`,
- RPC endpoint,
- deployment payer keypair path and public key,
- source wallet public key if the payer is the source wallet,
- target program id,
- program-id keypair policy,
- upgrade authority policy,
- allowed action,
- whether `--final` is allowed.

Do not create a mainnet plan, dry-run, prepare, execute, recover, deploy,
upgrade, write a buffer, or set an authority until that approval is given.
