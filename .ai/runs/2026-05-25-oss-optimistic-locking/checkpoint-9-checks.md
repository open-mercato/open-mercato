# Checkpoint 9 — QA round-5 fixes (steps 30.1–30.6)

**When:** 2026-06-02 (resume 4 — @alinadivante system-wide regression pass, comment 4602798597)
**Branch:** feat/oss-optimistic-locking
**Commits covered:** `17487c39c`..`7025099a6`

## Steps in this window

| Step | Area | Commit | Root cause | Fix |
|------|------|--------|-----------|-----|
| 30.1 | Customer Users | 17487c39c | custom admin route: list omitted updatedAt, PUT/DELETE never enforced, nativeUpdate didn't bump | list returns updatedAt; PUT/DELETE enforceCommandOptimisticLock; bump+return updatedAt |
| 30.2 | Customer Roles | a1f769038 | same as users | same pattern |
| 30.3 | Organizations | f8f028c9e | makeCrudRoute already enforces, but custom 'manage' GET omitted updatedAt → empty header | manage view returns updatedAt |
| 30.4 | Inbox Settings | 96aaea40a | page was optimistic-lock-exempt; route omitted+didn't enforce | GET/PATCH return updatedAt; PATCH enforces; page sends header |
| 30.5 | #2410 boolean selector | b4a672a07 | boolean passed to Select string value → blank | booleanOverrideSelectValue() normalizer |
| 30.6 | Feature Toggles (Global) override | 7025099a6 | override GET omitted updatedAt; card no header; PUT command unguarded | GET returns updatedAt; card sends header + conflict bar; PUT enforces |

## Validation

- **Targeted unit tests (new):** customer_accounts users (4), roles (4), inbox_ops settings (3), feature_toggles override (4), #2410 helper (4) — all green.
- **Touched-module test subsets:** `customer_accounts/api/admin` + `inbox_ops/api/settings` + `feature_toggles` → 12 suites / 65 tests ✅.
- **directory** suite (org fix) → 11 suites / 63 tests ✅.
- **Typecheck:** `yarn turbo run typecheck --filter=@open-mercato/core` ✅ (29s, clean).

## UI / integration verification

- Live Playwright + two-session integration specs for these areas are **queued for a single batched verification pass** at the end of the resume (boot the ephemeral env once, run all). Not run per-fix to avoid repeated full-stack boots. Recorded here per the "UI checks never block development" rule.

## Per-fix pattern established (reused for remaining areas)

1. Ensure the entity's list/detail API returns `updatedAt`.
2. Custom (non-makeCrudRoute) PUT/DELETE/PATCH → `enforceCommandOptimisticLock({ resourceKind, resourceId, current: rec.updatedAt, request })` + catch `isCrudHttpError`.
3. `em.nativeUpdate` paths must bump `updated_at` explicitly (onUpdate hook is bypassed).
4. Client raw handlers → `withScopedApiRequestHeaders(buildOptimisticLockHeader(rec.updatedAt), ...)` + `surfaceRecordConflict(err, t)` (or rely on CrudForm/useGuardedMutation auto-surfacing).
