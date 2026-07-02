# Environment Baseline

## Current Local Check

Checked on 2026-07-02.

Project root:

- `C:\Code5\sol-contract\dispenser`
- Run project commands from this directory.
- The parent `C:\Code5\sol-contract` is only the git container and should not contain app source files.

Available:

- Node.js: `v22.13.1`
- npm: `10.9.2`
- git: available
- rustup: `1.29.0`
- cargo: `1.96.1`
- rustc: `1.96.1`
- Solana CLI: `3.1.10`
- agave-install: `3.1.10`
- cargo-build-sbf: `3.1.10`
- platform-tools: `v1.52`
- AVM: `1.1.2`
- Anchor CLI: `1.1.2`, runnable through `%USERPROFILE%\.avm\bin\anchor-1.1.2.exe`
- Visual Studio Build Tools 2026: `18.7.3`
- MSVC tools: `14.51.36231`

Missing:

- GitHub CLI: `gh` not found

Windows AVM note:

- AVM symlink creation can fail without Developer Mode/admin symlink privileges.
- Use the direct binary when needed: `%USERPROFILE%\.avm\bin\anchor-1.1.2.exe`.
- The project `doctor` command checks this direct AVM binary as an Anchor fallback.

Program build:

- Run from `C:\Code5\sol-contract\dispenser`.
- `anchor-1.1.2.exe build` completes and emits `target/deploy/sol_dispenser.so`.
- IDL generation completes and emits `target/idl/sol_dispenser.json`.
- `cargo-build-sbf` still prints a post-processing warning about undefined syscall names. Treat that as a Phase 1 follow-up before any devnet/mainnet funding flow; local validator tests must prove runtime behavior before real SOL is used.

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
rustup default stable
solana --version
agave-install --version
avm --version
%USERPROFILE%\.avm\bin\anchor-1.1.2.exe --version
cargo-build-sbf --version
cargo --version
```

Exact install commands may vary by OS. The project `doctor` command verifies these automatically where possible.

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
