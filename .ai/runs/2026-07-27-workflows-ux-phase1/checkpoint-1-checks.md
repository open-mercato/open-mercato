# Checkpoint 1 — Steps 1.1..1.4 (Phase 1: registry core closed)

**Steps covered:** 1.1 (b69f2b664) · 1.2 (f54f3679a) · 1.3 (7c0036079) · 1.4 (a669adaad)
**Recorded:** 2026-07-27 (UTC) · **Runner:** local

## Touched areas
- `lib/activity-registry.ts` (new core + executeAsync field), `lib/activity-types.ts` (7 built-ins), `lib/activity-registry-bootstrap.ts`, `lib/activity-executor.ts` (sync dispatch + enqueue capability check), `lib/activity-worker-handler.ts` (async dispatch), `data/validators.ts` (5 new config schemas)

## Checks
| Check | Result | Notes |
|---|---|---|
| yarn build:packages | ✅ | |
| yarn generate | ✅ | |
| yarn typecheck | ✅ | 21/21 |
| Scoped jest packages/core → workflows | ✅ | 737 tests (was 704 at branch base; +33 registry/worker/schema tests) |
| Existing activity-executor suite | ✅ unedited | the declared BC proof |
| UI integration | ⏭ skipped | no UI touched in this window; ephemeral suite at final gate |

## Corrections
- Tasks-table SHAs trued up post-amend: 1.1→b69f2b664, 1.2→f54f3679a, 1.3→7c0036079, 1.4→a669adaad.
