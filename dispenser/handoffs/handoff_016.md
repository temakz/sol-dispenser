# Handoff 016 - Fresh Devnet Smoke for Phase 10

## Status

Session updated on 2026-07-04.

Mainnet was not touched. No WSL commands were run.

Fresh devnet smoke passed on runtime commit:

```text
24778aa docs: add mainnet operator checklist
```

Run id:

```text
20260704T132636Z
```

## Smoke Summary

- cluster: `devnet`
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
- final source balance: `0.76145324 SOL`

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
git status --short
git log --oneline -1
npm run doctor
npm run dispenser -- plan --total 0.003 --wallets 2 --recipient <SOURCE>:0.001 --recipient <SOURCE>:0.002
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T132636Z --secrets-only
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T132636Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- prepare --run 20260704T132636Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- inspect --run 20260704T132636Z
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- execute --run 20260704T132636Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- execute --run 20260704T132636Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- recover --run 20260704T132636Z --dry-run
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- recover --run 20260704T132636Z --confirm
$env:DISPENSER_PASSPHRASE='<devnet smoke passphrase>'; npm run dispenser -- inspect --run 20260704T132636Z
```

Notes:

- The first `plan` attempt failed with `EPERM` while creating `runs/<run-id>` in
  the sandbox. The same command was rerun with escalated filesystem permission
  and succeeded.
- Devnet config had an empty `rescueWallet`, so recover used the non-mainnet
  source-wallet fallback as expected.
- The run artifacts remain ignored under `runs/`.

## Next Step

Phase 10 is complete pending explicit mainnet approval.

Next gate is Gate 1 from `docs/MAINNET_READINESS.md`: mainnet RPC verification
only, requiring a separate explicit operator approval that names the target
commit, cluster, RPC endpoint, source wallet, rescue wallet, and maximum total
SOL. Mainnet send actions remain separate later gates.
