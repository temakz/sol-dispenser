# Handoff 011 - Phase 9 Devnet Max-Capacity Smoke

## Status

Session updated on 2026-07-04.

Active project root:

```text
C:\Code5\sol-contract\dispenser
```

## What Changed

- Added chunked `prepare` support so max-size runs are split into multiple Solana transactions under the 1232-byte transaction limit.
- Added execute resume handling for partial runs:
  - empty disposable wallet plus funded recipient is treated as `already executed`,
  - missing funds before recipient funding remains a hard preflight failure.
- Added regression tests for partial execute resume.
- Added GitHub Actions CI at `.github/workflows/dispenser-ci.yml`.
- Marked Phase 9 completed in `WORKPLAN.md`.

## Devnet Smoke

Run id:

```text
20260704T090339Z
```

Source wallet:

```text
6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg
```

Devnet max-capacity smoke:

- 16 recipients,
- total output `0.693 SOL`,
- prepare split into 4 transactions,
- final inspect status `ok`,
- final recoverable amount `0`.

Important failure-mode observed and handled:

- initial 16-recipient prepare dry-run exposed Solana transaction size limit,
- chunked prepare fixed it,
- devnet RPC 429/connect timeout interrupted execute after 15 transfers,
- execute resume sent only the remaining 16th transfer,
- devnet RPC 429 interrupted recover after all nonce accounts were closed,
- idempotent recover rerun wrote `recover-report.json`.

Final source balance observed:

```text
0.76151824 SOL
```

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
npm test
node --check bin\dispenser.mjs
npm run dispenser -- plan --total 0.693 --wallets 16 ...
npm run dispenser -- prepare --run 20260704T090339Z --secrets-only
npm run dispenser -- prepare --run 20260704T090339Z --dry-run
npm run dispenser -- prepare --run 20260704T090339Z --confirm
npm run dispenser -- inspect --run 20260704T090339Z
npm run dispenser -- execute --run 20260704T090339Z --dry-run
npm run dispenser -- execute --run 20260704T090339Z --confirm
npm run dispenser -- execute --run 20260704T090339Z --dry-run --force
npm run dispenser -- execute --run 20260704T090339Z --confirm
npm run dispenser -- recover --run 20260704T090339Z --dry-run
npm run dispenser -- recover --run 20260704T090339Z --confirm
npm run dispenser -- recover --run 20260704T090339Z --confirm
npm run dispenser -- inspect --run 20260704T090339Z
```

Latest local unit result:

- `npm test`: passed, 24 tests.
- After adding prepare chunking coverage, Windows `npm test`: passed, 25 tests.
- Operator WSL `npm test`: passed, 25 tests.
- Operator-provided `bundler.txt` shows `npm run test:cli:e2e` passed for local-validator run `20260704T085025Z`.

## Remaining Verification

Codex must not run WSL commands directly.

Operator should refresh WSL copy and run:

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
npm test
npm run doctor
npm run test:program
npm run test:cli:e2e
```
