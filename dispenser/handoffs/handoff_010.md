# Handoff 010 - Phase 9 Local Validator CLI E2E

## Status

Session updated on 2026-07-04.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

## What Changed

- Added `npm run test:cli:e2e`.
- Added `bin/local-validator-cli-e2e.mjs`, a repeatable local-validator CLI scenario:
  `plan -> prepare --secrets-only -> prepare --dry-run -> prepare --confirm -> inspect -> execute --dry-run -> execute --confirm -> recover --dry-run -> recover --confirm -> inspect`.
- Added failure-mode unit coverage for wrong durable nonce authority in execute and recover helpers.
- Added `docs/DEVNET_SMOKE_RUNBOOK.md`.
- Updated Phase 9 task notes in `WORKPLAN.md`.

## Current Status

- Phase 9 remains in progress.
- Mainnet was not touched.
- WSL commands are operator-only. Codex must not invoke `wsl.exe`; provide commands and wait for pasted output.

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
npm test
npm run doctor
git diff --check
```

Results:

- `npm test`: passed, 22 tests.
- `npm run doctor`: passed.
- `git diff --check`: passed; Git printed expected LF/CRLF working-copy warnings only.

An attempted direct Codex `wsl.exe` run was stopped by operator policy. Do not repeat direct WSL execution.

WSL, run by operator from `~/sol-dispenser-test` in `solana-ubuntu`:

```bash
npm ci
npm test
npm run doctor
npm run test:program
npm run test:cli:e2e
```

Results:

- `npm ci`: passed.
- `npm test`: passed, 22 tests.
- `npm run doctor`: passed; `WARN config optional not initialized` is expected because `dispenser.config.json` is excluded from the WSL copy.
- `npm run test:program`: passed in the earlier operator WSL run, 4 Anchor/local-validator tests. The later refreshed WSL confirmation focused on `npm test`, `doctor`, and `test:cli:e2e`.
- `npm run test:cli:e2e`: passed for run `20260704T085025Z`.

CLI E2E covered:

```text
plan -> prepare --secrets-only -> prepare --dry-run -> prepare --confirm -> inspect ->
execute --dry-run -> execute --confirm -> recover --dry-run -> recover --confirm -> inspect
```

Observed final status:

- prepare report: `prepared`
- execute dry-run report: `ok`
- execute report: `executed`
- recover dry-run report: `ok`
- recover report: `recovered`
- final inspect: `ok`

## Exact Next Step

Decide whether to commit this Phase 9 slice, then continue with CI workflow or additional hardening.
