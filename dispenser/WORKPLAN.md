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

Status: completed

Tasks:

- implement `fund_bundle_accounts`: done,
- validate remaining account pairs: done,
- fund disposable wallets: done,
- create durable nonce accounts: done,
- set nonce authority to disposable wallets: done,
- add error codes: done,
- add Anchor tests: done; WSL local validator tests passed,
- run `anchor build`: done with Anchor `1.1.2` and Solana CLI `3.1.10`,
- investigate `cargo-build-sbf` post-processing syscall warning: Windows toolchain warning documented; WSL local validator flow passed.

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

Status: completed

Tasks:

- estimate rent and fees: done,
- preflight source wallet balance: done,
- build `fund_bundle_accounts` transaction: done,
- support dry-run: done,
- send transaction: done,
- verify balances: done,
- verify nonce state: done,
- write prepare report: done.

Deliverable:

- devnet-ready account preparation.

## Phase 6 - Inspect Flow

Status: completed

Tasks:

- show source wallet balance: done,
- show disposable balances: done,
- show nonce account state: done,
- show recipient status: done,
- show recoverable funds: done,
- detect mismatch from plan: done.

Deliverable:

- reliable state dashboard in CLI.

## Phase 7 - Execute Flow

Status: completed

Tasks:

- build recipient transfers from disposable wallets: done,
- use durable nonce: done,
- sign with stored disposable keys: done,
- support dry-run: done,
- submit transactions: done,
- verify transaction confirmation: done,
- write execution report: done.

Deliverable:

- full chain execution on local validator and devnet.

## Phase 8 - Recover Flow

Status: completed

Tasks:

- detect unspent balances: done,
- build rescue transfers: done,
- support dry-run: done,
- send funds to rescue wallet: done,
- close nonce accounts: done,
- write recovery report: done.

Deliverable:

- no stranded SOL after failed or partial runs.

## Phase 9 - Testing and Hardening

Status: completed

Tasks:

- add unit tests: done with CLI helper, Solana flow, report lifecycle, and failure-mode coverage,
- add Anchor integration tests: done for `fund_bundle_accounts`; Windows runner still blocked, WSL path documented,
- add CLI dry-run tests: done via local-validator CLI E2E and report lifecycle regression coverage,
- add local validator end-to-end test: added repeatable CLI prepare/execute/recover E2E script for WSL/local-validator,
- add devnet smoke runbook: added `docs/DEVNET_SMOKE_RUNBOOK.md`,
- add failure-mode tests: added Solana flow nonce authority and partial execute resume coverage,
- add CI workflow after GitHub repo exists: added `.github/workflows/dispenser-ci.yml`.

Deliverable:

- repeatable safety test suite.

## Phase 10 - Mainnet Readiness

Status: in progress

Tasks:

- audit configs: in progress; added stricter local config validation,
- verify program id consistency: repo-local test added,
- run devnet smoke test,
- review secret handling,
- add mainnet typed confirmation: existing send gates covered by tests,
- document emergency recovery: initial checklist added.

Deliverable:

- mainnet checklist complete, pending explicit user approval.
