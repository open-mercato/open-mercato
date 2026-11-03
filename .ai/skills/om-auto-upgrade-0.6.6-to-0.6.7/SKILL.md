---
name: om-auto-upgrade-0.6.6-to-0.6.7
description: Migrate downstream Open Mercato user code from 0.6.6 to 0.6.7. Applies the pg-errors import move, safely unwraps proven scheduler queue payload consumers, audits query-index callbacks and removed scheduler metadata, then typechecks and reports manual follow-up. Use for "upgrade Open Mercato to 0.6.7", "migrate 0.6.6 to 0.6.7", or "apply the 0.6.7 upgrade notes".
---

# Auto upgrade 0.6.6 to 0.6.7

Apply the mechanical parts of the Open Mercato `0.6.6 → 0.6.7` upgrade to a downstream app. Treat the matching section of `UPGRADE_NOTES.md` as the source of truth.

## Scope

Operate on a standalone app or downstream repository that depends on `@open-mercato/*`. Never modify the framework monorepo's `packages/`, dependency pins, lockfile, generated output, or vendored dependencies. Run after the user has selected and installed `0.6.7`.

## Arguments

- `--path <dir>`: downstream repository root; defaults to the current directory.
- `--dry-run`: detect, classify, and report without editing or running mutating commands.
- `--only <id[,id...]>`: limit work to named checks.
- `--skip <id[,id...]>`: omit named checks and record the omission in the report.

Reject unknown flags and combining `--only` with `--skip`.

## Upgrade checks

| ID | Classification | Detect | Action |
| --- | --- | --- | --- |
| `pg-errors-import` | Automatic | Exact module specifier `@open-mercato/core/modules/communication_channels/lib/pg-errors` | Replace only the module specifier with `@open-mercato/shared/lib/db/pg-errors`; preserve imported names and formatting |
| `scheduler-flat-payload` | Automatic when proven; otherwise report | Member access shaped as `<job>.payload.payload.<field>` | Unwrap to `<job>.payload.<field>` only after proving the consumer handles a queue targeted by a scheduler registration in this repository |
| `scheduler-removed-metadata` | Detect and report | Scheduler queue consumers reading `scheduleId`, `scheduleName`, `scopeType`, or `triggeredAt` from the job payload | Identify the matching schedule registration and tell the user to include each required value explicitly in `targetPayload`; never invent values |
| `query-index-callback-errors` | Detect and report | Direct `upsertIndexBatch` callers with custom `encryptDoc` or `decryptDoc` callbacks that catch and suppress errors | Report the callback and swallowed branch; do not rewrite error policy automatically |
| `query-index-result-awareness` | No code action | Direct reindex orchestration that assumes partial writes can never fail | Explain that `QueryIndexBatchWriteError` now makes previously hidden loss fail the job/CLI and point to existing error handling/tests |

## Workflow

### 1. Gate the target

Resolve `--path`, require a regular `package.json`, and confirm at least one dependency or dev dependency starts with `@open-mercato/`. Refuse to run when the target contains this framework monorepo's `packages/core` and `packages/shared` workspaces.

Inspect installed/pinned Open Mercato versions. Continue when they resolve to `0.6.7`; otherwise warn with the detected versions and require explicit user confirmation before edits. A dry run may continue without confirmation.

Exclude `node_modules/`, `.yarn/`, `.git/`, `.next/`, `dist/`, `build/`, `coverage/`, `.mercato/generated/`, and other generated or vendored paths from every scan.

### 2. Build and show the plan

Run all selected detections before editing. Report each match as `{checkId, file, line, classification, proposedAction}` and show totals by check.

For `scheduler-flat-payload`, prove ownership before classifying a match as automatic:

1. Find the worker's queue name from its exported metadata or registration.
2. Find a scheduler definition in the same repository targeting that queue and using `targetPayload`.
3. Confirm the nested member is reading a field supplied by that `targetPayload`.

If any link is missing or multiple schedules disagree, downgrade the match to detect-and-report. Never perform a repository-wide `payload.payload` replacement.

With `--dry-run`, print the complete plan plus manual review and stop without edits.

### 3. Apply bounded edits

Ask for confirmation of the displayed plan. Apply one minimal edit per file:

- `pg-errors-import` changes only the exact string-literal module specifier and is idempotent.
- `scheduler-flat-payload` removes exactly one redundant `.payload` segment for each proven field access. Preserve optional chaining, whitespace, and surrounding logic.

Re-scan after editing. Exact old imports and proven nested accesses must be absent; manual findings remain listed.

### 4. Verify

Use scripts from the downstream app's `package.json`; do not assume monorepo-only commands exist. Run, in order when present:

1. `yarn generate`
2. `yarn typecheck`
3. the smallest affected test command, otherwise `yarn test`
4. `yarn build`

Stop at the first new failure caused by an edit, revert only that edit, and move it to manual follow-up. Preserve and report pre-existing failures rather than rewriting unrelated code or weakening checks.

### 5. Report

Report:

- detected Open Mercato versions;
- every edited file grouped by check ID;
- no-match and skipped checks;
- exact manual findings for removed scheduler metadata and swallowed query-index callback errors;
- validation commands and outcomes;
- a reminder that reindex jobs may now fail where `0.6.6` silently lost records.

If no code changes were required, still report that all four detection categories ran. Recommend reviewing the `0.6.6 → 0.6.7` section of `UPGRADE_NOTES.md` before deployment.

## Rules

- Every automatic edit must be bounded, minimal, and idempotent.
- Never change dependency versions or regenerate a lockfile.
- Never edit framework-owned `packages/` or generated/vendor directories.
- Never invent replacements for removed scheduler metadata.
- Never make custom encryption/decryption callbacks swallow errors to preserve old behavior.
- Never weaken typecheck, tests, or build to make the upgrade appear green.
- Always show the edit plan before mutation and the exact changed-file list afterward.
