# Handoff 004 - Dispenser Project Root

## Status

The working project root is now:

```text
C:\Code5\sol-contract\dispenser
```

The parent directory `C:\Code5\sol-contract` is only the git container.

## What Changed

- Moved Anchor workspace files into `dispenser/`.
- Moved CLI files into `dispenser/bin/`.
- Moved BPF program files into `dispenser/programs/`.
- Moved local ignored `dispenser.config.json` into `dispenser/`.
- Updated CLI run paths so run artifacts are written to `runs/`, not `dispenser/runs/`.
- Updated docs to use paths relative to `dispenser/`.
- Cleaned old top-level build artifacts and empty folders from the parent directory.

## Verified Commands

Run from `C:\Code5\sol-contract\dispenser`:

```powershell
npm.cmd run doctor
npm.cmd run build:program
```

Both commands complete successfully.

## Current Program Id

```text
6t1gxhDe9rm2JjNrwaaL941hfik3GgxY2AiYpxfugRy6
```

## Next Step

Continue Phase 1 with Anchor/local-validator integration tests from the `dispenser` directory.
