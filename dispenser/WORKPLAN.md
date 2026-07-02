# Work Plan

## Phase 0 - Repository Setup

Status: completed

Tasks:

- initialize git repository: done,
- add `.gitignore`: done,
- add docs baseline: done,
- decide package manager: npm,
- confirm Anchor and Solana CLI versions: done,
- confirm target cluster policy: local validator -> devnet -> mainnet with explicit confirmation.

Deliverable:

- clean repo with first docs commit pushed to `origin/main`.
- environment baseline recorded in `ENVIRONMENT.md`.

## Phase 1 - Program Foundation

Status: in progress

Tasks:

- implement `fund_bundle_accounts`: done,
- validate remaining account pairs: done,
- fund disposable wallets: done,
- create durable nonce accounts: done,
- set nonce authority to disposable wallets: done,
- add error codes: done,
- add Anchor tests: added; local validator execution blocked by Windows privilege error 1314,
- run `anchor build`: done with Anchor `1.1.2` and Solana CLI `3.1.10`,
- investigate `cargo-build-sbf` post-processing syscall warning: pending.

Deliverable:

- BPF program builds and passes local tests.

## Phase 2 - CLI Foundation

Status: completed

Tasks:

- create CLI entrypoint: done,
- add command router: done,
- add config loader: done,
- add structured logging: done,
- add run directory creation: done,
- add JSON schemas: done.

Deliverable:

- `npm run doctor` and `npm run init` work locally.

## Phase 3 - Planning Flow

Status: completed

Tasks:

- implement interactive `plan`: done,
- implement non-interactive flags: done,
- validate Solana addresses: done,
- support manual split: done,
- support equal split: deferred until weighted distribution mode,
- write `bundle-plan.json`: done,
- protect against accidental overwrite: done via unique run directories.

Deliverable:

- reproducible bundle plan file in `runs/<run-id>/bundle-plan.json`.

## Phase 4 - Secret Vault

Status: completed

Tasks:

- generate disposable keypairs: done,
- generate nonce keypairs: done,
- encrypt secrets with passphrase: done,
- verify decrypt-before-funding: done,
- never print secret keys: done,
- add recovery file validation: done.

Deliverable:

- `dispenser prepare --run <run-id> --secrets-only` writes encrypted key storage and verifies it before any funding exists.

## Phase 5 - Prepare Flow

Status: pending

Tasks:

- estimate rent and fees,
- preflight source wallet balance,
- build `fund_bundle_accounts` transaction,
- support dry-run,
- send transaction,
- verify balances,
- verify nonce state,
- write prepare report.

Deliverable:

- devnet-ready account preparation.

## Phase 6 - Inspect Flow

Status: pending

Tasks:

- show source wallet balance,
- show disposable balances,
- show nonce account state,
- show recipient status,
- show recoverable funds,
- detect mismatch from plan.

Deliverable:

- reliable state dashboard in CLI.

## Phase 7 - Execute Flow

Status: pending

Tasks:

- build recipient transfers from disposable wallets,
- use durable nonce,
- sign with stored disposable keys,
- support dry-run,
- submit transactions,
- verify transaction confirmation,
- write execution report.

Deliverable:

- full chain execution on local validator and devnet.

## Phase 8 - Recover Flow

Status: pending

Tasks:

- detect unspent balances,
- build rescue transfers,
- support dry-run,
- send funds to rescue wallet,
- optionally close nonce accounts later,
- write recovery report.

Deliverable:

- no stranded SOL after failed or partial runs.

## Phase 9 - Testing and Hardening

Status: pending

Tasks:

- add unit tests,
- add Anchor integration tests,
- add CLI dry-run tests,
- add local validator end-to-end test,
- add devnet smoke runbook,
- add failure-mode tests,
- add CI workflow after GitHub repo exists.

Deliverable:

- repeatable safety test suite.

## Phase 10 - Mainnet Readiness

Status: pending

Tasks:

- audit configs,
- verify program id consistency,
- run devnet smoke test,
- review secret handling,
- add mainnet typed confirmation,
- document emergency recovery.

Deliverable:

- mainnet checklist complete, pending explicit user approval.
