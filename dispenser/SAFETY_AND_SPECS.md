# Safety, Specs, and Engineering Rules

## Prime Directive

The app must never send funds unless the operator can see:

- source wallet,
- destination wallets,
- exact lamports,
- estimated rent,
- estimated fees,
- recoverable amount,
- irreversible actions.

## Legal and Ethical Boundary

Build only for wallets and funds controlled by the operator.

Do not add features whose primary purpose is theft, evasion, laundering, credential capture, or hiding unauthorized fund movement.

## Security Rules

1. Never print private keys.
2. Never commit private keys.
3. Never store generated keypairs in plaintext by default.
4. Encrypt secrets before sending funds to generated wallets.
5. Verify encrypted secrets can be decrypted before funding.
6. Every run must have a rescue path.
7. Mainnet requires typed confirmation.
8. Dry-run must be available for every command that can move funds.
9. Validate all public keys before transaction construction.
10. Validate all balances before and after transaction submission.
11. Treat RPC responses as untrusted until confirmed.
12. Prefer confirmed/finalized commitment for post-transaction verification.

## File Safety

Must be ignored by git:

```text
wallet.json
*.keypair.json
bundle-accounts.json
runs/
*.enc.json
.env
.env.*
```

Reports may be committed only if they contain no secrets and no sensitive operational data.

## Amount Safety

All amounts must use integer lamports internally.

Do not use floating point for transaction amounts after parsing user input.

Rules:

- parse SOL strings into lamports safely,
- reject more than 9 decimal places,
- reject negative values,
- reject zero output amounts,
- reject total mismatch unless explicit dust policy is configured,
- show both SOL and lamports in confirmation screens.

## Transaction Safety

Before sending:

- simulate transaction when possible,
- verify all signers are present,
- verify all writable accounts are expected,
- verify program id matches config,
- verify cluster matches config,
- verify nonce authority,
- verify source balance includes rent and fee buffer.

After sending:

- wait for confirmation,
- fetch transaction,
- verify expected balance deltas,
- write report,
- stop on mismatch.

## Durable Nonce Rules

Each disposable wallet gets one nonce account by default.

Nonce authority must be the disposable wallet unless a specific alternate authority is explicitly configured.

The app must inspect nonce account state before using it.

The app must not reuse a stale nonce without advancing it.

## Recovery Rules

Recovery must be possible after:

- prepare succeeded but execute failed,
- one disposable transfer failed,
- RPC timeout occurred,
- local process crashed,
- user interrupted the run.

Recovery must use saved encrypted secrets and the saved plan.

## Git Rules

Commit only coherent steps.

Before each commit:

```bash
git status
git diff --check
```

When tests exist, run the relevant tests before commit.

Never commit:

- source wallet,
- generated wallet secrets,
- encrypted run secrets unless user explicitly asks,
- RPC API keys,
- `.env`,
- local run outputs.

## Dependency Rules

Prefer boring, maintained dependencies:

- `@coral-xyz/anchor`
- `@solana/web3.js`
- `commander` or `yargs`
- `zod`
- Node built-in `crypto` for encryption unless a stronger need appears.

Do not add a dependency for trivial helpers.

## Test Spec

Required test categories:

- pure amount parsing tests,
- schema validation tests,
- key vault encrypt/decrypt tests,
- transaction construction tests,
- Anchor local validator tests,
- recovery tests,
- devnet smoke test checklist.

Mainnet is never part of automated tests.

## UX Rules

The CLI should be boring and explicit.

Every dangerous command must show:

```text
Cluster:
Source:
Program:
Total output:
Nonce rent:
Estimated fees:
Recipients:
Recoverable path:
```

For mainnet:

```text
Type MAINNET to continue:
```

For large transfers:

```text
Type the exact total SOL amount to continue:
```

## Failure Policy

On any unexpected mismatch:

1. stop,
2. print what was expected,
3. print what was observed,
4. write failure report,
5. suggest `dispenser inspect`,
6. suggest `dispenser recover --dry-run`.

Do not continue automatically after an unexpected fund movement mismatch.
