# Handoff 019 - Phase 10 Gate 1 Mainnet RPC Verification

## Status

Session updated on 2026-07-04.

Gate 1 was explicitly approved by the operator for mainnet RPC verification
only. No `prepare`, `execute`, `recover`, or send transaction commands were run.
No WSL commands were run.

Approved scope:

```text
commit 212c129
cluster mainnet-beta
rpc https://api.mainnet-beta.solana.com
source 4Z5eSsw3eTn95g3rxp3SSJerREbvAJAC5WDV5urhvHiS
rescue HizKAdiBbivBDiv8hojaCcHzoZrVpj8S78M2x5XXQZwn
max total SOL 20
no send transactions
```

## Local Setup Confirmed

- HEAD: `212c129`
- working tree before Gate 1: clean
- `wallet-mainnet.json`: created locally from `.env`
- source wallet guard: passed
- `dispenser.config.json`: materialized from `.env`
- `npm run doctor`: passed and showed `mainnet-beta` config

The local wallet and config files remain ignored and were not staged.

## Mainnet RPC Read-Only Results

- RPC URL: `https://api.mainnet-beta.solana.com`
- cluster: `mainnet-beta`
- genesis hash: `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`
- genesis check: passed
- solana-core: `4.1.0`
- feature-set: `3345198602`
- confirmed slot: `430789659`
- block height: `408861271`
- source wallet: `4Z5eSsw3eTn95g3rxp3SSJerREbvAJAC5WDV5urhvHiS`
- source balance: `0.100001 SOL` (`100001000` lamports)
- rescue wallet: `HizKAdiBbivBDiv8hojaCcHzoZrVpj8S78M2x5XXQZwn`
- rescue balance: `0 SOL` (`0` lamports)
- configured program id: `6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5`
- program account exists on mainnet: `false`
- max SOL per run: `20`

## Gate 1 Outcome

Gate 1 confirms the configured RPC endpoint is mainnet-beta.

Do not advance to mainnet planning or any mainnet dry-run/send step yet:

- the configured program id does not exist on mainnet.

The source wallet has `0.100001 SOL`. The configured `20 SOL` value is a policy
ceiling for future runs, not a required balance for a small test. For any later
mainnet test, only the specific planned total plus nonce rent, estimated fees,
and operator margin must be covered.

## Commands Run

Windows, from `C:\Code5\sol-contract\dispenser`:

```powershell
git status --short
git rev-parse --short HEAD
Get-Content -Path dispenser.config.json
npm run dispenser -- wallet-from-env --force
npm run dispenser -- config-from-env --force
npm run doctor
node --input-type=module <read-only mainnet RPC verification script>
```

`connection.getHealth()` was not available in the installed
`@solana/web3.js` version, so the final verification used `getGenesisHash`,
`getVersion`, `getEpochInfo`, `getBalance`, and `getAccountInfo`.

## Next Step

Before any mainnet plan, dry-run, or send, deploy the program to mainnet or
replace `programId` with an operator-approved existing executable mainnet
program id, then rerun readonly verification that `getAccountInfo(programId)`
exists and is executable. Any next mainnet action still requires a separate
explicit operator approval.
