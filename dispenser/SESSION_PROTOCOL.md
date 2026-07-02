# Session Protocol

## Purpose

This file defines how we split work across Codex sessions so the context window stays clean and every session has a clear outcome.

## Session Rule

Each session must do one focused slice:

- one feature,
- one bugfix,
- one test layer,
- one documentation update,
- or one verification pass.

Avoid mixing unrelated refactors with feature work.

## Session Start Checklist

At the start of each session, read:

1. `dispenser/WORKPLAN.md`
2. `dispenser/SAFETY_AND_SPECS.md`
3. latest handoff note, if present
4. current git status

Then state:

- current objective,
- files likely to change,
- verification planned.

## Session End Checklist

Before ending a session:

1. run relevant tests or explain why they could not run,
2. run formatting/lint checks if available,
3. inspect git diff,
4. update `dispenser/WORKPLAN.md` statuses if needed,
5. create or update a handoff note when work is incomplete,
6. commit finished work when git is available and user approved the scope.

## Handoff Notes

Use:

```text
dispenser/handoffs/handoff_001.md
dispenser/handoffs/handoff_002.md
...
```

Each handoff must include:

- what changed,
- current status,
- commands run,
- tests passed/failed,
- known blockers,
- exact next step.

## Commit Policy

When git is initialized, use small commits.

Recommended commit phases:

```text
docs: add dispenser specification
program: add bundle account funding instruction
cli: add plan command
cli: add prepare command
cli: add inspect command
cli: add execute command
cli: add recover command
test: add local validator flow tests
docs: add devnet runbook
```

Do not commit secrets, wallets, encrypted secrets, run output, or local configs.

## Context Hygiene

Prefer persistent docs over repeating context in chat.

When context grows, summarize the current state into a handoff note and continue from that file in the next session.

## Branching

Default branch strategy:

```text
main
feature/dispenser-cli
```

If a risky refactor is needed, use a separate branch:

```text
refactor/dispenser-program-layout
```

## Verification Levels

Use the smallest sufficient level:

- docs only: markdown review
- CLI pure logic: unit tests
- transaction building: local validator tests
- on-chain behavior: Anchor tests
- live behavior: devnet smoke test
- mainnet: explicit user approval only
