# Environment Baseline

## Current Local Check

Checked on 2026-07-03.

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
- Windows `cargo-build-sbf` still prints a post-processing warning about undefined syscall names.
- The same program flow passed WSL local-validator tests, so the warning is documented as a Windows toolchain/runtime-reporting issue rather than a current Phase 1 blocker.

## WSL Local Validator Environment

Verified again on 2026-07-04 using WSL distro:

```text
solana-ubuntu
Ubuntu 24.04.4 LTS
WSL2
```

Known WSL distros on the operator's Windows account:

```text
Ubuntu-24.04      Stopped         2
docker-desktop    Stopped         2
solana-ubuntu     Stopped         2
```

Use `solana-ubuntu` for Solana/Anchor local-validator tests. If a Codex shell cannot see
that distro and reports `WSL_E_DISTRO_NOT_FOUND`, ask the operator to run the WSL commands
manually from PowerShell. The operator-visible distro exists and was verified on
2026-07-04.

Session rule:

- Codex must not invoke `wsl.exe` directly for this project.
- The operator runs all WSL commands in `solana-ubuntu`.
- Codex should provide exact WSL commands and wait for pasted output when WSL verification is required.

Linux toolchain in WSL:

- Node.js: `v22.23.1`
- npm: `10.9.8`
- cargo: `1.96.1`
- rustc: `1.96.1`
- Solana CLI: `3.1.10`
- solana-test-validator: `3.1.10`
- AVM: `1.1.2`
- Anchor CLI: `1.1.2`

Open the WSL test environment from PowerShell with:

```powershell
wsl.exe -d solana-ubuntu
```

WSL project test copy:

```text
~/sol-dispenser-test
```

The Windows project root remains the source of truth. The WSL copy is only a Linux-native test workspace because:

- Linux `npm ci` on `/mnt/c/...` failed with `EPERM chmod`,
- Windows `solana-test-validator` could not unpack its genesis archive even from admin PowerShell,
- WSL/Linux local validator tests passed.

Refresh the WSL test copy from Windows source with:

```bash
cd ~
rm -rf sol-dispenser-test
mkdir sol-dispenser-test
rsync -a \
  --exclude node_modules \
  --exclude target \
  --exclude runs \
  --exclude dispenser.config.json \
  /mnt/c/Code5/sol-contract/dispenser/ \
  ~/sol-dispenser-test/
cd ~/sol-dispenser-test
npm ci
```

Run local-validator tests in WSL with:

```bash
cd ~/sol-dispenser-test
npm test
npm run doctor
npm run test:program
npm run test:cli:e2e
```

Latest WSL verification on 2026-07-04:

- refreshed `~/sol-dispenser-test` from `/mnt/c/Code5/sol-contract/dispenser/`,
- `npm ci`: passed,
- `npm test`: passed, 20 tests,
- `npm run doctor`: passed; `config` warning is expected because `dispenser.config.json` is excluded from the WSL test copy,
- `npm run test:program`: passed, 4 Anchor/local-validator tests.

Anchor/local-validator result:

```text
fund_bundle_accounts
  funds disposable wallets and creates durable nonce accounts
  rejects zero disposable amounts before moving funds
  rejects remaining account count mismatches
  rejects duplicate bundle accounts

4 passing
```

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
