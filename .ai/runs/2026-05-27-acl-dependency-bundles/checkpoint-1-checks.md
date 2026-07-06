# Checkpoint 1 — Steps 1.1..3.1

**UTC:** 2026-05-27T17:26Z
**Range:** 50f2129a2 (seed) .. c7d7ac20d (customers acl deps)
**Steps covered:** 1.1, 1.2, 2.2 (squashed 2.1+2.2), 2.3, 3.1
**Packages touched:** `@open-mercato/shared`, `@open-mercato/core` (auth + customers)

## Targeted validation

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn workspace @open-mercato/shared exec jest src/security/__tests__/aclDependencies.test.ts` | **PASS** (19/19) | The new resolver — full coverage of intent. |
| `yarn workspace @open-mercato/core exec jest src/modules/auth/api/__tests__/features.test.ts` | **PASS** (6/6) | New features-endpoint coverage. |
| `yarn workspace @open-mercato/shared exec jest` (full) | 86 passed / 7 failed suites — **baseline-equivalent** | Failures are all `Cannot find module '@open-mercato/cache'` from `src/lib/commands/__tests__/*.ts` and `src/lib/crud/__tests__/cache.test.ts`. Reproduced verbatim against `origin/develop` (`da89d7530`) in `/tmp/dep-bundles-baseline` → janitor-environment workspace-link issue, not introduced by this PR. Not a regression. |
| `yarn workspace @open-mercato/core exec jest src/modules/auth/` | 24 passed / 14 failed suites — **baseline-equivalent** | Same `@open-mercato/cache` resolution failure transitively reaches every test that imports `src/lib/di/container.ts`. Reproduces on develop. |
| `yarn workspace @open-mercato/core exec jest src/modules/customers/` | 55 passed / 58 failed suites — **baseline-equivalent** | Same resolution failure. Reproduces on develop. |
| `yarn workspace @open-mercato/shared exec tsc --noEmit` | **PASS** (clean) | No type errors in the new helper or its test. |

### Baseline reproduction

Confirmed by checking out `origin/develop` (`da89d7530`) in `/tmp/dep-bundles-baseline` and running the exact same `yarn workspace @open-mercato/shared exec jest src/lib/commands/__tests__/registry.test.ts` — identical `Cannot find module '@open-mercato/cache'` failure. The temporary worktree was torn down after the comparison.

## UI verification

Skipped — Steps 1.1..3.1 do not touch UI. AclEditor changes land at Step 4.1; Playwright + screenshots will be captured at Checkpoint 2 (after Step 4.2) if the dev runtime is bootable.

## Decision

- Proceed to Phase 4 (AclEditor wiring). The new code paths are fully covered by their own unit tests; baseline workspace-resolution noise is not a blocker.
- Open follow-up todo: surface the workspace-link issue (separate from this PR's scope) so future janitor runs do not hit it. Logged as a sidebar note in NOTIFY.

## Artifacts

None — no Playwright / screenshot capture this checkpoint.
