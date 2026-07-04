# Dispenser CLI - Technical Specification

## Goal

Build a production-ready Solana CLI app that can reproduce the operational chain:

```text
source wallet
  -> custom BPF splitter/forwarder program
  -> disposable wallets
  -> durable nonce accounts
  -> final recipient wallets or later bundle actions
```

The app must let the operator enter:

- total SOL amount,
- number of disposable wallets,
- recipient addresses,
- amount per recipient,
- RPC/cluster,
- source wallet,
- safety limits.

The app must automatically prepare the accounts, build transactions, run validations, send transactions only after explicit confirmation, and preserve enough encrypted recovery data to rescue funds.

## Non-Goals

This project is not a mixer, tumbler, laundering tool, or promise of privacy. Solana is public. The purpose is controlled funding and bundle preparation for wallets owned by the operator.

The app must not hide risk from the operator. Every step must show what will happen, what accounts will be created, what funds will move, and what can be recovered.

## Core Flow

1. User creates or loads a plan.
2. CLI validates input and estimates costs.
3. CLI generates disposable wallet keypairs locally.
4. CLI generates durable nonce account keypairs locally.
5. CLI encrypts and stores secret keys before sending any transaction.
6. CLI calls the custom BPF program to fund disposable wallets and initialize nonce accounts.
7. CLI verifies on-chain balances and nonce state.
8. CLI optionally sends final transfers from disposable wallets to recipients using durable nonce.
9. CLI writes an audit report.
10. CLI can recover unused SOL back to a rescue wallet.

## CLI Commands

```bash
dispenser init
dispenser plan
dispenser prepare
dispenser execute
dispenser inspect
dispenser recover
dispenser verify
dispenser doctor
```

### init

Creates local config:

- cluster,
- RPC URL,
- source wallet public key,
- source wallet path,
- program id,
- default output directory,
- rescue wallet,
- max SOL per run,
- confirmation policy.

Output:

- `dispenser.config.json`

### plan

Creates or updates a bundle plan interactively or from flags.

Inputs:

- total SOL,
- number of disposable wallets,
- distribution mode: manual, equal split, weighted split,
- recipients,
- per-recipient amounts,
- durable nonce enabled,
- memo label,
- mainnet confirmation mode.

Output:

- `runs/<run-id>/bundle-plan.json`

### prepare

Generates local keypairs and sends the funding/setup transaction.

Responsibilities:

- generate disposable wallets,
- generate nonce accounts,
- encrypt secrets before sending funds,
- call BPF `fund_bundle_accounts`,
- verify balances,
- verify nonce accounts are initialized,
- write report.

Outputs:

- `runs/<run-id>/secrets.enc.json`
- `runs/<run-id>/prepare-report.json`
- transaction signatures

### execute

Sends planned final transfers from disposable wallets.

Responsibilities:

- load encrypted secrets,
- validate plan against current chain state,
- build one or more transactions,
- use durable nonce when configured,
- submit transactions,
- verify recipient balances or transaction status,
- write execution report.

Output:

- `runs/<run-id>/execute-report.json`

### inspect

Shows current state:

- source wallet balance,
- disposable wallet balances,
- nonce account state,
- recipient payment status,
- recoverable SOL,
- unexpected deltas.

### recover

Returns unused SOL to a rescue wallet.

Requirements:

- never close or drain accounts unless explicitly requested,
- support dry-run,
- show exact estimated fees,
- preserve nonce account rent unless user asks to close accounts.

### verify

Runs local consistency checks:

- plan schema,
- encrypted secrets can be decrypted,
- public keys match saved secret keys,
- all amounts sum correctly,
- no duplicate recipients unless explicitly allowed,
- no accidental mainnet run without confirmation.

### doctor

Checks local environment:

- Node.js version,
- Anchor CLI,
- Solana CLI,
- RPC connectivity,
- wallet file readability,
- program id consistency,
- cluster consistency.

## On-Chain Program

The custom BPF program must expose:

```rust
fund_bundle_accounts(disposable_amounts: Vec<u64>)
```

Remaining accounts are passed as repeating pairs:

```text
[disposable_wallet, nonce_account]
```

For each pair, the program:

1. validates disposable wallet is writable and signer,
2. validates nonce account is writable, signer, empty, and system-owned,
3. transfers the requested lamports from funder to disposable wallet,
4. creates the nonce account,
5. initializes durable nonce authority to the disposable wallet,
6. emits logs for audit.

## Data Files

Each run gets its own folder:

```text
runs/<run-id>/
  bundle-plan.json
  secrets.enc.json
  prepare-report.json
  execute-report.json
  recover-report.json
  audit-log.ndjson
```

Secrets must never be stored in plaintext by default.

## Key Management

The CLI must:

- generate keypairs locally,
- encrypt keypairs before funding,
- never print private keys,
- support passphrase-based encryption,
- support optional OS keychain later,
- verify encrypted secrets can be decrypted before sending funds,
- support recovery from `secrets.enc.json`.

## Validation Rules

Before prepare:

- total amount must be greater than zero,
- each output amount must be greater than zero,
- total output must equal expected total unless dust is explicitly configured,
- source wallet must have amount + nonce rent + estimated fees + buffer,
- source wallet keypair file must match configured source wallet public key when configured,
- all recipients must be valid Solana pubkeys,
- all generated accounts must be unique,
- mainnet requires explicit typed confirmation.

Before execute:

- disposable wallet balances must match plan within fee tolerance,
- nonce accounts must be initialized,
- nonce authorities must match disposable wallets,
- recipients must match the saved plan,
- secrets must match generated public keys,
- no transaction is sent if the plan was modified after prepare unless re-approved.

## Testing Requirements

Minimum test suite:

- Rust unit tests for amount validation,
- Anchor integration tests on local validator,
- CLI schema validation tests,
- dry-run test with generated wallets,
- prepare flow test on local validator,
- execute flow test on local validator,
- recover flow test on local validator,
- failure test: wrong accounts length,
- failure test: insufficient balance,
- failure test: duplicate generated accounts,
- failure test: invalid recipient,
- failure test: modified plan after prepare.

Devnet smoke test must be run before any mainnet usage.

## Done Definition

The project is ready for first devnet use when:

- `dispenser doctor` passes,
- `dispenser plan` creates a valid plan,
- `dispenser prepare --dry-run` shows exact cost,
- `dispenser prepare` funds disposable wallets and creates nonce accounts,
- `dispenser inspect` confirms state,
- `dispenser execute --dry-run` builds final transactions,
- `dispenser execute` sends final transfers,
- `dispenser recover --dry-run` shows recoverable funds,
- all tests pass locally.
