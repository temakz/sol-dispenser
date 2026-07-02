# Environment Baseline

## Current Local Check

Checked on 2026-07-02.

Available:

- Node.js: `v22.13.1`
- npm: `10.9.2`
- git: available

Missing in current shell:

- Anchor CLI: `anchor` not found
- Solana CLI: `solana` not found
- Rust/Cargo: `cargo` not found
- GitHub CLI: `gh` not found

## Package Manager

Use npm for the CLI workspace.

Rules:

- commit `package-lock.json`,
- do not mix npm, pnpm, and yarn in this repo,
- use `npm ci` in CI once lockfile exists.

## Cluster Policy

Default development flow:

1. local validator for automated tests,
2. devnet for smoke tests,
3. mainnet only after explicit typed confirmation.

Mainnet must never be the default cluster.

## Required Toolchain

Install before Phase 1 verification:

```bash
rustup toolchain install stable
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
solana --version
anchor --version
cargo --version
```

Exact install commands may vary by OS. The project `doctor` command will eventually verify these automatically.

## GitHub

Remote:

```text
https://github.com/temakz/sol-dispenser.git
```

The initial docs baseline has been pushed to `origin/main`.
