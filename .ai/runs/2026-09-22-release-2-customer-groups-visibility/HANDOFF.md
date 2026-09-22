# Handoff — 2026-09-22-release-2-customer-groups-visibility

**Last updated:** 2026-09-22T10:35:00Z
**Branch:** feat/release-2-customer-groups-visibility
**PR:** https://github.com/open-mercato/open-mercato/pull/6338 (draft)
**Current phase/step:** Phase 1, Step 1.9 (next todo row)
**Last commit:** c2d483322 — feat(customer_groups): add group list admin page with drag-reorder

## What just happened
- Checkpoint 1 complete: Steps 0.1 through 1.8 landed and verified (typecheck, unit tests, codegen, migration-drift check, package build, strict DS lint all clean — see `checkpoint-1-checks.md`).
- customer_groups module scaffolded; `CustomerGroup`/`CustomerGroupMembership` entities + migration; `resolveGroups()` service; full CRUD for groups + memberships; priority reorder command/route; admin list page (drag-reorder) and create/edit pages.
- Two real gaps found mid-implementation and fixed as appended Steps: default-group clear-and-set semantics (1.5-fix) and a non-partial priority unique index that would have permanently blocked reuse of a deleted group's priority value (1.3-fix).

## Next concrete action
- Step 1.9: membership assignment UI/section on the customer detail page (in `customers` module's person detail — needs research into the right widget-injection/section host, see `packages/core/AGENTS.md` § Widget Injection).
- Then Group B (1.10 reconciliation CLI + orphan banner data + 1.11 group-picker widget injected into `catalog`/`sales` CrudForms — hard constraint: never edit `catalog`/`sales` files directly, ship as an injected widget only).
- Then 1.12 (i18n sweep for every `t('customer_groups...', 'fallback')` call already in the code), 1.13/1.14 (Phase 1 integration tests — API tenant isolation + behavioral cases, then UI paths).

## Blockers / open questions
- None blocking. Logged (not blocking): the pricing.ts group-priority tie-break is deliberately unimplemented (see PLAN.md Risks); the drag-reorder full-row-lift limitation is an accepted "Ask First" primitive boundary (see checkpoint-1-checks.md).

## Environment caveats
- Dev runtime runnable: not attempted yet this run (no Docker `app` container; would need a disposable local Postgres per repo memory notes). UI verification deferred to Step 1.14/final gate once the Phase 1 UI surface is feature-complete.
- Browser / UI checks: skipped this checkpoint, reason recorded in `checkpoint-1-checks.md`.
- Database/migration state: `customer_groups` migration + snapshot are self-consistent (`yarn db:generate` reports "no changes"). No migrations applied to any real DB.

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/18501eb5-8b15-41ac-929d-0633b3aa3903
- Created this run: no (pre-existing cezar worktree, reused)
- node_modules: installed this run (`yarn install`); `yarn build:packages` has been run multiple times and is current.
