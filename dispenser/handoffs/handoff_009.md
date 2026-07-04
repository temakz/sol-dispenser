# Handoff 009 - WSL Local Validator Path Reconfirmed

## Status

Session updated on 2026-07-04.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

The parent directory `C:\Code5\sol-contract` remains only the git container.

## Current State

- Phase 5 through Phase 8 remain complete on devnet.
- Phase 9 testing and hardening remains in progress.
- Refactor commit `b442a86` extracted Solana transaction builders and on-chain inspection helpers into `lib/solana-flows.mjs`.
- Test commit `a58eccf` added Solana flow regression tests and report lifecycle tests.
- WSL local-validator path is reconfirmed and should be used for Anchor/local-validator tests.

## WSL Environment

Operator-visible WSL distros:

```text
Ubuntu-24.04      Stopped         2
docker-desktop    Stopped         2
solana-ubuntu     Stopped         2
```

Use:

```powershell
wsl.exe -d solana-ubuntu
```

Verified Linux toolchain in `solana-ubuntu`:

```text
Node.js: v22.23.1
npm: 10.9.8
rustc: 1.96.1
cargo: 1.96.1
Solana CLI: 3.1.10
solana-test-validator: 3.1.10
Anchor CLI: 1.1.2
```

Important note:

- The Codex Windows shell may not see `solana-ubuntu` and may return `WSL_E_DISTRO_NOT_FOUND`.
- The operator's PowerShell can see and launch it.
- If Codex cannot run WSL directly, ask the operator to run WSL commands and paste output.

## WSL Test Copy

The WSL test copy is:

```text
~/sol-dispenser-test
```

Refresh from Windows source:

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

## Commands Verified

WSL, from `~/sol-dispenser-test`:

```bash
npm test
npm run doctor
npm run test:program
```

Results:

- `npm ci`: passed.
- `npm test`: passed, 20 tests.
- `npm run doctor`: passed. `WARN config optional not initialized` is expected because `dispenser.config.json` is excluded from the WSL test copy.
- `npm run test:program`: passed.

Anchor/local-validator output summary:

```text
fund_bundle_accounts
  funds disposable wallets and creates durable nonce accounts
  rejects zero disposable amounts before moving funds
  rejects remaining account count mismatches
  rejects duplicate bundle accounts

4 passing
```

## Known Notes

- Keep Windows as the normal workspace for CLI/unit-test work.
- Use WSL/Linux as the local-validator garage for on-chain tests.
- Do not retry Windows `solana-test-validator` unless the user explicitly asks to fix the Windows-specific validator problem.
- The WSL test copy is disposable; the Windows project root remains source of truth.

## Next Exact Step

Continue Phase 9 by adding a local-validator end-to-end test for prepare/execute/recover using the confirmed WSL path.
