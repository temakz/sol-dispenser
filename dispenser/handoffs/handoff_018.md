# Handoff 018 - Fresh Devnet Smoke After Source Guard

## Status

Session updated on 2026-07-04.

Mainnet was not touched. No WSL commands were run.

Fresh devnet smoke passed on runtime commit:

```text
5f09acd cli: verify configured source wallet
```

Run id:

```text
20260704T171606Z
```

## Smoke Summary

- cluster: `devnet`
- expected source wallet: `6c1STbfjnRkEXa1AoBoWWsGDEDGyAH5kGQhavsoedbDg`
- source keypair check: passed
- total output: `0.003 SOL`
- recipients: `2`
- prepare dry-run: passed
- prepare confirm: `prepared`
- first inspect: `ok`
- execute dry-run: `ok`
- execute confirm: `executed`
- recover dry-run: `ok`
- recover confirm: `recovered`
- final inspect: `ok`
- final recoverable amount: `0 SOL`
- final source balance: `0.76138824 SOL`

## Notes

- `dispenser.config.json` was updated locally to include the devnet
  `sourceWallet` so the smoke exercised the new source keypair guard.
- `dispenser.config.json` and `runs/` remain ignored and were not staged.
- The first plan attempt failed with sandbox `EPERM` while creating `runs/`.
  The command was rerun with escalated filesystem permission and succeeded.

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
git status --short
git log --oneline -1
Get-Content -Path dispenser.config.json
solana address -k wallet.json
npm run doctor
npm run dispenser -- plan --total 0.003 --wallets 2 --recipient <SOURCE>:0.001 --recipient <SOURCE>:0.002
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T171606Z --secrets-only
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T171606Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T171606Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- inspect --run 20260704T171606Z
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- execute --run 20260704T171606Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- execute --run 20260704T171606Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- recover --run 20260704T171606Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- recover --run 20260704T171606Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- inspect --run 20260704T171606Z
```

## Next Step

Commit this smoke result note. Gate 1 mainnet RPC verification can be considered
next, but still requires separate explicit operator approval. Gate 1 does not
authorize prepare, execute, or recover sends.
