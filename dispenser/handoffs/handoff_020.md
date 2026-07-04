# Handoff 020 - Session Closeout Before Mainnet Program Deployment

## Status

Session closed on 2026-07-04.

Phase 10 remains in progress. Gate 1 mainnet RPC verification passed for the
approved RPC endpoint, but the configured mainnet program id does not exist on
mainnet-beta. Do not create a mainnet plan, dry-run, prepare, execute, or
recover until mainnet program deployment is completed and verified.

No WSL commands were run by Codex.

## Latest Commits

```text
f9441bf docs: add mainnet program deployment gate
885b066 docs: record phase 10 gate 1 rpc check
212c129 cli: materialize mainnet config from env
860ff72 docs: clarify env source wallet setup
fa38f17 cli: materialize source wallet from env
```

## Current Local Mainnet Setup

Local-only ignored files were prepared from `.env`:

- `wallet-mainnet.json` exists locally and is ignored.
- `dispenser.config.json` was materialized from `.env` and is ignored.
- source wallet guard passed.

Current public config values:

```text
cluster: mainnet-beta
rpc: https://api.mainnet-beta.solana.com
source: 4Z5eSsw3eTn95g3rxp3SSJerREbvAJAC5WDV5urhvHiS
rescue: HizKAdiBbivBDiv8hojaCcHzoZrVpj8S78M2x5XXQZwn
maxSolPerRun: 20
configured programId: 6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5
```

Gate 1 read-only result:

- mainnet genesis hash matched,
- source balance was `0.100001 SOL`,
- rescue balance was `0 SOL`,
- `getAccountInfo(programId)` returned no account,
- no transaction was sent.

The `20 SOL` value is a policy ceiling for future runs, not a required balance
for the small mainnet test. A future test only needs enough source balance for
the specific planned total plus nonce rent, estimated fees, and operator margin.

## Next Session Objective

Start with Gate 0.5: mainnet program deployment.

Before doing anything, read:

- `WORKPLAN.md`
- `SAFETY_AND_SPECS.md`
- `SESSION_PROTOCOL.md`
- `ENVIRONMENT.md`
- `docs/MAINNET_READINESS.md`
- `handoffs/handoff_019.md`
- `handoffs/handoff_020.md`

Then:

1. Check `git status --short`.
2. Confirm the current commit and pushed state.
3. Review the existing devnet/local deployment tooling and program id policy.
4. Prepare a mainnet program deployment plan.
5. Do not run any mainnet deployment command until the operator gives a separate
   explicit approval naming the commit, cluster, RPC, payer/source wallet, target
   program id or keypair policy, and allowed action.
6. After deployment, run readonly verification that `getAccountInfo(programId)`
   exists and `executable=true`.
7. Only after that, consider the next explicitly approved gate.

## Suggested Prompt For New Session

```text
Продолжаем проект C:\Code5\sol-contract\dispenser.

Прочитай:
- WORKPLAN.md
- SAFETY_AND_SPECS.md
- SESSION_PROTOCOL.md
- ENVIRONMENT.md
- docs/MAINNET_READINESS.md
- handoffs/handoff_019.md
- handoffs/handoff_020.md

Текущее состояние:
- Phase 10 in progress.
- Gate 1 mainnet RPC verification completed.
- Latest commit should include f9441bf docs: add mainnet program deployment gate.
- Mainnet RPC verified: https://api.mainnet-beta.solana.com.
- Source wallet: 4Z5eSsw3eTn95g3rxp3SSJerREbvAJAC5WDV5urhvHiS.
- Rescue wallet: HizKAdiBbivBDiv8hojaCcHzoZrVpj8S78M2x5XXQZwn.
- Max SOL cap: 20, policy ceiling only.
- Configured mainnet program id 6t1gxhFQqjRj3W6uTJM9xwzPbDv9QyWGNu2f9FEv6j5 does not exist on mainnet.
- Local .env, wallet-mainnet.json, dispenser.config.json are ignored and must not be committed.
- WSL commands are operator-only. Codex must not run wsl.exe.

Новая цель:
Начать Gate 0.5 - Mainnet Program Deployment.

Важно:
- Mainnet deployment requires a separate explicit approve before any deploy command.
- Do not create mainnet plan, dry-run, prepare, execute, recover, or send transactions.
- First only audit/docs/config/deploy-plan review.
- Перед любыми изменениями проверить git status.
```
