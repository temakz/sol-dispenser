# Mainnet Program Deployment Plan

## Boundary

This is the Gate 0.5 deployment plan. It is not approval to deploy.

Do not run any command that contacts `mainnet-beta`, deploys a program, writes a
buffer, upgrades a program, sets an authority, creates a mainnet plan, runs a
mainnet dry-run, or sends any transaction until the operator gives a separate
explicit approval for that exact action.

No WSL commands are required for this gate. Codex must not run `wsl.exe`.

## Current State

- Plan drafted from starting commit `8b4a11a`.
- Any deployment approval must name the current HEAD commit at approval time.
- Current branch: `main`.
- Local tracking state: `main` matches local `origin/main`.
- Gate 1 previously verified `https://api.mainnet-beta.solana.com` as
  mainnet-beta, but the then-configured program id
  `6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5` did not exist on mainnet.
- Repo-local program id policy points to
  `6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6`.
- The local ignored deployment keypair at
  `target/deploy/sol_dispenser-keypair.json` derives to
  `6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6`.

The current source balance from the previous Gate 1 check was `0.100001 SOL`.
That may be enough for a small dispenser test later, but it is probably not
enough for initial program deployment rent, buffer writes, and fees. Recheck the
deployment payer balance before approving deployment.

## Program Id Decision

Preferred path:

- Deploy the current program under
  `6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6`, because this id matches:
  `bin/dispenser.mjs`, `Anchor.toml`, `programs/sol-vault/src/lib.rs`,
  `docs/DEVNET_SMOKE_RUNBOOK.md`, and the local deploy keypair public key.

Alternative path:

- If the operator wants to use any other mainnet program id, stop and update the
  repo-local program id policy first. That means reviewing and changing the CLI
  default, Anchor config, Rust `declare_id!`, docs, tests, `.env` values, and the
  program-id keypair policy before building or deploying.

Do not deploy the current binary under the previously configured missing id
`6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5` unless the operator explicitly
chooses that id and supplies a matching program-id keypair or approves the full
repo consistency update.

## Pre-Approval Local Checks

Allowed without mainnet approval because they are local-only:

```powershell
cd C:\Code5\sol-contract\dispenser
git status --short
git rev-parse --short HEAD
node --check bin\dispenser.mjs
npm test
npm run doctor
npm run build:program
solana address -k target\deploy\sol_dispenser-keypair.json
```

Expected program-id output:

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

Before approval, the operator should also verify offline that the program-id
keypair and upgrade authority policy are acceptable. Keep all keypair files out
of git and out of chat.

## Approval Required For Deployment

Deployment approval must name all of:

- commit hash,
- cluster: `mainnet-beta`,
- RPC endpoint,
- deployment payer keypair path and public key,
- source wallet public key if the payer is the source wallet,
- target program id,
- program-id keypair policy,
- upgrade authority policy,
- allowed action: initial deploy only, upgrade only, or deploy/upgrade,
- whether `--final` is allowed; default is not final so emergency upgrade remains possible.

Example approval shape:

```text
Approve Gate 0.5 only:
commit <CURRENT_HEAD_COMMIT>
cluster mainnet-beta
rpc https://api.mainnet-beta.solana.com
payer/source <PUBLIC_KEY> using <LOCAL_KEYPAIR_PATH>
target program id 6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
program id keypair target/deploy/sol_dispenser-keypair.json
upgrade authority <PUBLIC_KEY_OR_POLICY>
allowed action: initial program deploy
do not run plan, prepare, execute, or recover
```

## Deployment Command Template

Run only after explicit approval. This command sends mainnet transactions.

```powershell
solana program deploy `
  --url https://api.mainnet-beta.solana.com `
  --keypair <PAYER_KEYPAIR_PATH> `
  --program-id target\deploy\sol_dispenser-keypair.json `
  --upgrade-authority <UPGRADE_AUTHORITY_SIGNER_OR_KEYPAIR> `
  target\deploy\sol_dispenser.so
```

Use `--final` only if the operator explicitly approves making the program
non-upgradeable. Do not use `--skip-preflight` for this gate unless the operator
explicitly approves it after a failed preflight review.

## Readonly Verification After Deployment

After deployment completes, run readonly verification only after explicit
approval for mainnet RPC contact:

```powershell
solana program show `
  6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6 `
  --url https://api.mainnet-beta.solana.com `
  --output json
```

Also verify the exact `getAccountInfo(programId)` gate:

```powershell
node --input-type=module -e "import {Connection,PublicKey} from '@solana/web3.js'; const rpc='https://api.mainnet-beta.solana.com'; const programId='6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6'; const account=await new Connection(rpc,'confirmed').getAccountInfo(new PublicKey(programId)); console.log(JSON.stringify({programId,exists:Boolean(account),executable:account?.executable ?? false,owner:account?.owner?.toBase58() ?? null,lamports:account?.lamports ?? null},null,2));"
```

The required result is:

- account exists,
- `getAccountInfo(programId)` returns `exists: true`,
- `getAccountInfo(programId)` returns `executable: true`,
- program id equals the operator-approved id,
- upgrade authority matches the operator-approved policy,
- no dispenser plan, dry-run, prepare, execute, or recover has been run.

Only after this verification passes can Gate 0.5 be marked complete and Gate 1
readonly RPC verification be considered again under a fresh separate approval.
