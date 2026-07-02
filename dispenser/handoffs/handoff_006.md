# Handoff 006 - Anchor Test Scaffolding

## Status

Session updated on 2026-07-02 after WSL local validator verification passed.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

No mainnet or real SOL was used.

## What Changed

- Added localnet program config in `Anchor.toml`.
- Switched Anchor provider default to localnet with ignored wallet path `target/test-wallet.json`.
- Added `npm run test:program`.
- Added `bin/anchor-local-test.mjs` to:
  - generate an ignored local test wallet,
  - run `anchor build --ignore-keys`,
  - start `solana-test-validator` with the built program loaded via `--bpf-program`,
  - run mocha tests against `http://127.0.0.1:8899`.
- Added `tests/fund_bundle_accounts.cjs` covering:
  - disposable wallet funding,
  - durable nonce account creation,
  - nonce authority set to the disposable wallet,
  - zero amount rejection,
  - remaining-account mismatch rejection,
  - duplicate account rejection.
- Added npm dev dependencies and lockfile for `@solana/web3.js` and `mocha`.
- Updated the CLI tool runner to include local Cargo and Solana CLI paths when spawning child tools.

Follow-up runner fixes:

- use `anchor build --ignore-keys` so WSL test copies do not rewrite the fixed source program id,
- keep test ledger location configurable with `DISPENSER_TEST_LEDGER_DIR`,
- print a clear Windows filesystem-access hint when validator cannot unpack genesis.

## Commands Run

From `C:\Code5\sol-contract\dispenser`:

```powershell
npm.cmd install
npm.cmd run doctor
npm.cmd run build:program
npm.cmd run test:program
solana-test-validator --help
solana-test-validator --reset --quiet --ledger C:\tmp\dispenser-test-ledger --bpf-program 6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6 target\deploy\sol_dispenser.so
```

Because this Codex sandbox cannot write to npm cache, `.rustup`, or validator ledger/tooling paths without approval, install/build/test attempts were also run with explicit elevated tool access where needed.

## Results

- `npm.cmd install`: passed with approval; generated `package-lock.json`.
- `npm.cmd run doctor`: passed; detects Node, npm, git, Cargo, Solana CLI `3.1.10`, and Anchor CLI `1.1.2`.
- `npm.cmd run build:program`: passed with approval.
- Windows build warning remains:

```text
cargo_build_sbf::post_processing: undefined and not known syscalls ["abort", "sol_log_", "sol_panic_", "sol_memcpy_", "sol_invoke_signed_rust", "sol_get_rent_sysvar", "sol_log_pubkey"]
```

- `npm.cmd run test:program`: blocked before tests execute because `solana-test-validator` exits during startup.
- Direct validator check with ledger under `C:\tmp` failed the same way.
- Both installed Solana validator releases failed with Windows error 1314:

```text
called `Result::unwrap()` on an `Err` value: Os { code: 1314, kind: Uncategorized, message: "Клиент не обладает требуемыми правами." }
```

Additional manual admin PowerShell attempts removed the Windows error 1314 blocker, but `solana-test-validator` still exits before RPC startup while unpacking the genesis archive:

```text
Error: failed to start validator: Failed to create ledger at C:\tmp\sol-dispenser-test-ledger: io error: Error checking to unpack genesis archive: IO error: Отказано в доступе. (os error 5)
```

The runner was updated after those attempts to:

- avoid creating the ledger directory before validator startup,
- use a configurable ledger directory via `DISPENSER_TEST_LEDGER_DIR`,
- pass the test wallet public key to `--mint`,
- print a clear Windows filesystem-access hint when this genesis unpack failure occurs.

WSL verification from `~/sol-dispenser-test`:

```bash
npm ci
npm run doctor
npm run test:program
```

Results:

- `npm ci`: passed in Linux-native project copy.
- `npm run doctor`: passed with Node `v22.23.1`, npm `10.9.8`, Cargo `1.96.1`, Solana CLI `3.1.10`, and Anchor CLI `1.1.2`.
- `npm run test:program`: passed.

Local validator test output:

```text
fund_bundle_accounts
  ✔ funds disposable wallets and creates durable nonce accounts
  ✔ rejects zero disposable amounts before moving funds
  ✔ rejects remaining account count mismatches
  ✔ rejects duplicate bundle accounts

4 passing
```

## Known Blocker

`solana-test-validator` cannot start in the current Windows session. Admin PowerShell gets past the original privilege error 1314, but validator still cannot unpack its genesis archive into either `%TEMP%` or `C:\tmp` because Windows returns access denied.

This is no longer a program blocker because the same local validator test suite passed in WSL/Linux. Keep using WSL/Linux for validator tests unless the Windows filesystem/security issue is fixed.

Likely next environment fixes:

- run the test command from an elevated terminal,
- enable Windows Developer Mode if the failure is symlink-related,
- allow `solana-test-validator.exe` / the Solana release directory in Windows Security if controlled folder access or antivirus is blocking archive unpack,
- or run the local validator test suite in WSL/Linux.

## Exact Next Step

For local validator verification, run from the WSL/Linux project copy:

```bash
cd ~/sol-dispenser-test
npm run test:program
```

The Phase 1 on-chain test gate has passed. Next project step is Phase 5 prepare flow, still local validator/devnet only and no mainnet or real SOL.
