# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-05-28T16:05Z
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** Phase 15 (QA #2055 fix increment) — all rows 15.1..15.5 `done`. PR head `5c9ceeeb0` (+ pending checkpoint-4 docs commit).
**Last code commit:** 5c9ceeeb0 (`docs(specs): record optimistic-lock coverage implementation status`)

## What just happened (this resume)

Resumed PR #2055 to fix the issues @alinadivante reported in QA (PR comment 2026-05-27T22:11):

- A prior session (commits `f79cc3e7c`, `6c5956367`, `99c9f851c`) had already (a) fixed the raw `record_modified` flash → now `ui.forms.flash.recordModified` with a human fallback in both `CrudForm` (CrudForm.tsx:2610) and `useGuardedMutation`, and (b) wired the `optimisticLockUpdatedAt` prop into ~40 CrudForm edit pages (covers company-v2 / people-v2 / catalog products **update**).
- This resume closed the remaining gaps: the **custom (non-CrudForm) handlers** that issued `updateCrud`/`deleteCrud` without the lock header.
  - 15.1 `8c35339d5` — deals update + delete (`useDealFormHandlers.ts`).
  - 15.2 `49f25480b` — company-v2 + people-v2 custom **delete** handlers.
  - 15.3 `32fb756f8` — sales channels list **delete** (+ 409 → conflict flash + refresh, fixing the broken-list scenario).
  - 15.4 `ed4efbdd0` — TC-LOCK-OSS-004 stale-DELETE→409 integration coverage.
  - 15.5 `5c9ceeeb0` — coverage-completion spec implementation-status table.
- Validation: build:packages ✓, generate ✓, i18n:check-sync ✓, touched core unit tests 9/9 ✓, root-tsc 6.0.3 typecheck ✓ (workspace tsc 5.9.3 env-fails on `ignoreDeprecations` — pre-existing; lint env-crashes on eslint-plugin-react — pre-existing). See `checkpoint-4-checks.md`.

## The same-user-two-tabs mystery (QA issue #1) — resolution

@alinadivante saw 409 for two **different** users but silent overwrite for the **same** user in two tabs on `customers.company`. That signature is the enterprise **pessimistic** record-lock (same user owns the lock in both tabs → no block). The OSS **version-compare** guard is per-record-version, not per-user, so once company-v2 sends the header (wired in `6c5956367`, after her test), same-user-two-tabs now 409s too. No additional code needed for this — it is covered by the company update wiring + TC-LOCK-OSS-001.

## Next concrete action

1. **Re-QA** by @alinadivante against PR head: deal/company/person/channel concurrent update + delete should now 409 with the localized "record modified" flash.
2. CI `ephemeral-integration` (with `OM_OPTIMISTIC_LOCK=all`) runs TC-LOCK-OSS-004 incl. the new DELETE cases — confirm green.
3. Optional follow-up (DEFERRED, not blocking this PR): `sales.order` document command-endpoint version checks (Phase 4) and nested panels (Phase 3) per `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`.

## Blockers / open questions

- Local Playwright/integration could not run (no Postgres/Redis/.env in the janitor sandbox). CI is authoritative for integration.
- `auto-review-pr` cloud pass not run as a separate step this resume — substituted a focused self code-review + a background code-review subagent on the Phase 15 diff (`99c9f851c..HEAD`).

## Environment caveats

- `gh` binary is at `~/.local/bin/gh` — `export PATH="$HOME/.local/bin:$PATH"` each fresh Bash.
- Janitor **autosave race**: a periodic timer commits working-tree edits as `janitor: autosave (periodic)` commits. Recover with `git reset --soft <last-clean-sha>` then re-commit cleanly. Happened once this resume (recovered into 15.2 `49f25480b`).
- Workspace tsc is 5.9.3 (env-fails `ignoreDeprecations:"6.0"`); use root `./node_modules/.bin/tsc` (6.0.3) for a real typecheck.

## Worktree

- Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/a7d67a13-7d0c-436e-a4c0-b05b13114f36/` (janitor-managed; detached HEAD on the PR head; do NOT `git worktree remove`). The branch `feat/oss-optimistic-locking` itself is checked out in sibling worktree `bdaa81a3-…` at the stale `4259ee34b` — push via `git push origin HEAD:feat/oss-optimistic-locking`.
