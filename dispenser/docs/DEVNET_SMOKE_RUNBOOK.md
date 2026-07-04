# Devnet Smoke Runbook

## Boundary

This runbook is for devnet only. Do not point these commands at `mainnet-beta`.

Use a disposable source wallet with a small devnet balance. Do not use production
wallets, production recipients, or API keys that are not intended for test work.

## Prerequisites

Run from:

```powershell
C:\Code5\sol-contract\dispenser
```

Verify the local project first:

```powershell
npm test
npm run doctor
```

Confirm `dispenser.config.json` uses:

```json
{
  "cluster": "devnet",
  "rpcUrl": "https://api.devnet.solana.com",
  "sourceWalletPath": "./wallet.json",
  "rescueWallet": "<operator-controlled devnet rescue wallet>",
  "programId": "6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6",
  "requireMainnetTypedConfirmation": true
}
```

Set a local passphrase in the current shell:

```powershell
$env:DISPENSER_PASSPHRASE = "<at least 12 characters>"
```

## Smoke Sequence

Create a tiny plan using operator-controlled devnet recipients:

```powershell
npm run dispenser -- plan --total 0.003 --wallets 2 --recipient <RECIPIENT_1>:0.001 --recipient <RECIPIENT_2>:0.002
```

Copy the printed run id and use it for the rest of the sequence:

```powershell
$run = "<RUN_ID>"
npm run dispenser -- prepare --run $run --secrets-only
npm run dispenser -- prepare --run $run --dry-run
npm run dispenser -- prepare --run $run --confirm
npm run dispenser -- inspect --run $run
npm run dispenser -- execute --run $run --dry-run
npm run dispenser -- execute --run $run --confirm
npm run dispenser -- recover --run $run --dry-run
npm run dispenser -- recover --run $run --confirm
npm run dispenser -- inspect --run $run
```

## Expected Results

Reports should show:

- `prepare-report.json`: `status` is `prepared`
- max-size runs may be split into multiple prepare transactions; check `transaction.transactionCount`
- first `inspect-report.json`: `status` is `ok`, lifecycle is `prepared`
- `execute-dry-run-report.json`: `status` is `ok`
- `execute-report.json`: `status` is `executed`
- `recover-dry-run-report.json`: `status` is `ok`
- `recover-report.json`: `status` is `recovered`
- final `inspect-report.json`: `status` is `ok`, lifecycle is `recovered`

On any mismatch, stop and run:

```powershell
npm run dispenser -- inspect --run $run
npm run dispenser -- recover --run $run --dry-run
```

Keep the run artifacts local unless the operator explicitly approves sharing a
redacted report.
