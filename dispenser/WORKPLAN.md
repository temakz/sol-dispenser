# Work Plan

## Phase 0 - Repository Setup

Status: completed

Tasks:

- initialize git repository: done,
- add `.gitignore`: done,
- add docs baseline: done,
- decide package manager: npm,
- confirm Anchor and Solana CLI versions: checked, missing in current shell,
- confirm target cluster policy: local validator -> devnet -> mainnet with explicit confirmation.

Deliverable:

- clean repo with first docs commit pushed to `origin/main`.
- environment baseline recorded in `dispenser/ENVIRONMENT.md`.

## Phase 1 - Program Foundation

Status: in progress

Tasks:

- implement `fund_bundle_accounts`: done,
- validate remaining account pairs: done,
- fund disposable wallets: done,
- create durable nonce accounts: done,
- set nonce authority to disposable wallets: done,
- add error codes: done,
- add Anchor tests: pending,
- run `anchor build`: blocked until toolchain is installed.

Deliverable:

- BPF program builds and passes local tests.

## Phase 2 - CLI Foundation

Status: pending

Tasks:

- create CLI entrypoint,
- add command router,
- add config loader,
- add structured logging,
- add run directory creation,
- add JSON schemas.

Deliverable:

- `dispenser doctor` and `dispenser init` work locally.

## Phase 3 - Planning Flow

Status: pending

Tasks:

- implement interactive `plan`,
- implement non-interactive flags,
- validate Solana addresses,
- support manual split,
- support equal split,
- write `bundle-plan.json`,
- protect against accidental overwrite.

Deliverable:

- reproducible bundle plan file.

## Phase 4 - Secret Vault

Status: pending

Tasks:

- generate disposable keypairs,
- generate nonce keypairs,
- encrypt secrets with passphrase,
- verify decrypt-before-funding,
- never print secret keys,
- add recovery file validation.

Deliverable:

- encrypted key storage with tests.

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
