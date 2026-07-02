# Handoff 002 - Toolchain Installation Attempt

## Status

The old untracked scaffold was removed locally:

- `README.md`
- `client/`
- `tsconfig.json`

No git commit was needed for this deletion because those files were never tracked.

Rust/Solana/Anchor installation is not complete.

## What Worked

- Official `rustup-init.exe` was downloaded and executed.
- `rustup 1.29.0` is installed at `%USERPROFILE%\.cargo\bin\rustup.exe`.
- `%USERPROFILE%\.cargo\bin` was added to User PATH.
- WSL online distro list is reachable in elevated context.

## What Failed

- `rustup default stable` failed downloading from `static.rust-lang.org` with network timeout `os error 10060`.
- WSL Ubuntu install under elevated context reported success, but the distro was not visible to the current user.
- WSL Ubuntu install under current user failed reaching `raw.githubusercontent.com`.

## Next Step

Open a fresh PowerShell after PATH refresh and retry:

```powershell
rustup default stable
cargo --version
```

If native Rust succeeds, continue with Anchor/Solana install.

If native Rust remains blocked, install and initialize a WSL Ubuntu distro manually from the Windows UI or with working network access, then run the official Solana quick installer inside WSL:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

After toolchain works, return to Phase 1:

```bash
anchor build
```
