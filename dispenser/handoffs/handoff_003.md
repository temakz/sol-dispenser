# Handoff 003 - Native Solana Stack Build

## Status

Native Windows toolchain is installed and the Anchor program builds.

Verified on 2026-07-02:

- Rust/Cargo: `1.96.1`
- Solana CLI: `3.1.10`
- agave-install: `3.1.10`
- cargo-build-sbf: `3.1.10`
- platform-tools: `v1.52`
- AVM: `1.1.2`
- Anchor CLI: `1.1.2`
- Visual Studio Build Tools: `18.7.3`
- MSVC tools: `14.51.36231`

## Working Build Command

Use the direct AVM binary on Windows:

```powershell
$env:PATH += ";$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\.local\share\solana\install\releases\3.1.10\solana-release\bin"
& "$env:USERPROFILE\.avm\bin\anchor-1.1.2.exe" build
```

Outputs:

- `target/deploy/sol_dispenser.so`
- `target/idl/sol_dispenser.json`

## Code Changes

- Updated the program to `anchor-lang = "1.1.2"`.
- Added `idl-build` feature required by Anchor 1.1 IDL generation.
- Switched durable nonce creation to `system_program::create_nonce_account`.
- Restored a strict `recent_blockhashes` sysvar address check through `solana-sysvar`.
- Added workspace resolver `2`.
- Updated `doctor` to detect `%USERPROFILE%\.avm\bin\anchor-1.1.2.exe`.

## Known Warning

`cargo-build-sbf` prints a post-processing warning about undefined syscall names while still returning success.

Do not use real SOL until local validator tests prove runtime behavior for:

- disposable wallet funding,
- durable nonce account creation,
- nonce authority set to the disposable wallet,
- failure paths and recovery paths.

## Next Step

Continue Phase 1 by adding Anchor integration tests around `fund_bundle_accounts`.
