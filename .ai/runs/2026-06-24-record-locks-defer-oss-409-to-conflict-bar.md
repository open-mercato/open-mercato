# Execution plan — record_locks: defer OSS optimistic-lock 409 to conflict bar (#3504)

## Context / Provenance

This re-implements the fix for issue **#3504** ("with enterprise `record_locks` enabled, a
concurrent-edit 409 on a standard `makeCrudRoute`/`CrudForm` screen renders TWO conflict
surfaces — the OSS conflict bar AND the enterprise merge dialog — violating the single-surface
invariant S3"). The problem and root cause were originally diagnosed and a fix proposed by
external contributor **@adeptofvoltron** in PR #3550 (fork PR).

Because `packages/enterprise` is the commercial enterprise package, the maintainer cannot accept
an external fork contribution directly into it. This PR therefore lands an **independent
implementation** of the same fix authored in-house, and **credits @adeptofvoltron** for the
diagnosis and proposed solution. PR #3550 is closed in favor of this one.

## Goal

When the enterprise record-lock widget receives a save-time 409 that carries **no**
`record_lock_conflict` payload but **is** an OSS optimistic-lock-floor conflict
(`code: 'optimistic_lock_conflict'`), the widget must **stand down** and let the shared OSS
conflict bar own the conflict — instead of opening a second, degraded merge dialog. Genuine
`record_lock_conflict` 409s and non-optimistic-lock 409s keep their current behavior.

## Scope

- `packages/enterprise/src/modules/record_locks/` only.
- New helper file `lib/optimisticLockFloor.ts` (pure, React-free, unit-testable).
- One narrowed branch in `widgets/injection/record-locking/widget.client.tsx`.
- New unit test `__tests__/optimisticLockFloor.test.ts`.

## Non-goals

- The degraded "Accept incoming" no-op (issue #3505) — already fixed and merged in #3551.
- Any refactor of the rest of the `onCrudSaveError` listener (relevance gating, record-deleted
  handling) beyond the single contested 409 branch.
- No contract-surface, event-ID, ACL, DI, route, or DB change.

## Independent-implementation note (differs from #3550)

#3550 extracted the **whole** listener decision into a 5-value action enum
(`decideCrudSaveErrorAction` → `record-deleted | open-fallback-dialog | apply-record-lock-payload
| defer-to-oss-conflict-bar | ignore`) and rewired the widget to a `switch`. This implementation
is intentionally narrower and structured differently: it leaves the listener's existing
relevance/record-deleted control flow intact and extracts **only the contested no-payload-409
decision** into `classifyUnmatchedSaveError` (3-value: `fallback-merge-dialog |
defer-to-conflict-bar | ignore`) plus the predicate `isOptimisticLockFloorConflict`. Minimal
blast radius, same behavior.

## Risks

- The widget's `onCrudSaveError` is React-internal; the pure helper is unit-tested but the
  one-line wiring (calling the helper to gate the fallback branch) is verified by reading the
  diff + the existing record_locks suite. Mitigated by keeping the wiring to a single, obvious
  `if`.
- `isOptimisticLockFloorConflict` reuses the canonical OSS detector `extractOptimisticLockConflict`
  (status===409 + `optimistic_lock_conflict` code), so it cannot drift from the OSS bar's own
  classification — the two surfaces decide off the same predicate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implement fix + tests

- [x] 1.1 Add `lib/optimisticLockFloor.ts` (`isOptimisticLockFloorConflict`, `classifyUnmatchedSaveError`) — ad5212870
- [x] 1.2 Gate the widget's no-payload-409 fallback-dialog branch via `classifyUnmatchedSaveError` — ad5212870
- [x] 1.3 Add `__tests__/optimisticLockFloor.test.ts` (predicate + classifier guard, incl. #3504 defer case) — ad5212870 (10 cases; record_locks suite 12/72 green)

### Phase 2: Validate + ship

- [x] 2.1 Targeted validation (enterprise jest + typecheck on changed files) — record_locks 12/72, predicate suite 10/10
- [x] 2.2 Full validation gate (build:packages, generate, i18n, typecheck 21/21, enterprise test 49/417, build:app) — all green
- [x] 2.3 Open PR, close #3550 with explanation + credit, normalize labels — PR #3569; #3550 closed; labels review/bug/enterprise/needs-qa/priority-medium/risk-medium

## Changelog
- PR #3569 opened against develop. Independent re-implementation of #3550's #3504 fix, authored in-house; #3550 closed with credit to @adeptofvoltron. Automated review (2 finders + verify) returned no actionable findings. Left in `review` (not self-routed to merge-queue) because the author is the maintainer — a human reviewer + QA should own the merge given the commercial-enterprise provenance.
