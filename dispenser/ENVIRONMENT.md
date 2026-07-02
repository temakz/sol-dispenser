# Environment Baseline

## Current Local Check

Checked on 2026-07-02.

Available:

- Node.js: `v22.13.1`
- npm: `10.9.2`
- git: available
- rustup: `1.29.0`, installed at `%USERPROFILE%\.cargo\bin\rustup.exe`

Missing in current shell:

- Anchor CLI: `anchor` not found
- Solana CLI: `solana` not found
- Rust/Cargo toolchain: `cargo` and `rustc` not active because stable toolchain download failed
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

## Installation Attempts

Attempted on 2026-07-02:

- Removed legacy untracked scaffold files: `README.md`, `client/`, `tsconfig.json`.
- Downloaded and ran official Windows `rustup-init.exe`.
- `rustup` installed successfully.
- `rustup default stable` failed because `static.rust-lang.org` timed out with `os error 10060`.
- Added `%USERPROFILE%\.cargo\bin` to User PATH for future shells.
- Checked WSL: WSL component exists, but no usable distro was registered in the current user context.
- `wsl --install -d Ubuntu-24.04 --name solana-ubuntu --no-launch` reported success under elevated context, but the current user context could not see that distro.
- Non-elevated WSL distro install failed because Windows could not reach `raw.githubusercontent.com`.

Do not use unofficial mirrors for Rust, Solana, or Anchor in this project without an explicit security review.

## GitHub

Remote:

```text
https://github.com/temakz/sol-dispenser.git
```

The initial docs baseline has been pushed to `origin/main`.
