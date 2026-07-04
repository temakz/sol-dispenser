# Handoff 017 - Configurable Source Wallet Guard

## Status

Session updated on 2026-07-04.

Mainnet was not touched. No WSL commands were run.

## What Changed

- Added optional `sourceWallet` to config and plans as the expected source
  public key.
- `mainnet-beta` config and plans now require explicit `sourceWallet` and
  explicit `rescueWallet`.
- `prepare`, `inspect`, `execute`, and `recover` now load `sourceWalletPath` and
  fail if the keypair public key does not match `sourceWallet`.
- `doctor` prints the expected source wallet when configured.
- Updated config and bundle-plan JSON schemas.
- Updated mainnet/devnet docs and the technical spec.
- Added regression coverage for:
  - invalid/missing mainnet source wallet,
  - source keypair mismatch.

## Operator Details Provided

For the upcoming Gate 1 discussion, the operator provided:

- source wallet public key: `Cpe3umG1pQj9TRC9QcF2Js8fLr9bmsNPt5vPzMRUqRMN`
- rescue wallet public key: `HizKAdiBbivBDiv8hojaCcHzoZrVpj8S78M2x5XXQZwn`
- max total SOL cap: `20`
- RPC endpoint preference: public mainnet RPC.

These details were not used for any mainnet RPC call in this slice.

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
git status --short
node --check bin\dispenser.mjs
npm test
npm run doctor
git diff --check
```

Results:

- initial `git status --short`: clean.
- `node --check bin\dispenser.mjs`: passed.
- `npm test`: passed, 35 tests.
- `npm run doctor`: passed.
- `git diff --check`: passed; CRLF warnings only.

## Known Gaps

- A fresh devnet smoke has not yet been run after this runtime guard.
- No mainnet deployment verification or mainnet RPC action has been performed.

## Next Step

Commit this source-wallet guard slice. Before any mainnet send gate, run a fresh
devnet smoke on the new target commit.

Gate 1 mainnet RPC verification still requires explicit operator approval. Gate
1 does not authorize prepare, execute, or recover sends.
