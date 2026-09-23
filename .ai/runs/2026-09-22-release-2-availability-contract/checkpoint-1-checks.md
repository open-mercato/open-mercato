# Checkpoint 1 — Steps 1.1 – 2.4

**Range:** Step 1.1 through Step 2.4 (6 Steps).
**Commits:** `1a931b822` .. `c35f1b334` (see PLAN.md Tasks table for per-Step SHAs).
**Touched areas:** `packages/shared/src/lib/availability/` (new), `packages/core/src/modules/availability/` (new module — index/acl/events/entities/validators/migration/policyResolution/commands/api), `apps/mercato/src/modules.ts` + `packages/create-app/template/src/modules.ts` (module registration), `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` and `record-locks-coverage.test.ts` (curated-entity guard updates), `packages/core/src/modules/auth/i18n/*.json` (ACL feature title keys, all 5 locales).

## Validation run (runner: local, no Docker `app` container running)

| Check | Scope | Result |
|---|---|---|
| `npx tsc --noEmit` | `packages/shared` | ✅ pass, 0 errors |
| `npx tsc --noEmit` | `packages/core` | ✅ pass, 0 errors |
| `npx jest` (full suite) | `packages/shared` | ✅ 212/213 suites, 2417/2424 tests pass. 1 suite fails only under the cezar worktree's default `TMPDIR` (`dynamicLoader.generatedCacheRecovery.test.ts` — `tsx` child-process Unix-socket path too long); confirmed passing with `TMPDIR=/private/var/tmp`. Not caused by this change; verified by isolating on a clean stash of this branch's prior state (same failure). |
| `npx jest` (full suite) | `packages/core` | ✅ 1954/1956 suites, 17655/17661 tests pass after fixes. 2 remaining failures (`catalog/.../page.doubleSave.test.tsx`, `page.scrollRestoration.test.tsx`) are pre-existing and unrelated — both fail on a `useLocale is not a function` error inside `catalog`'s own product edit page component, a file this branch never touches. Verified pre-existing by stashing this branch's uncommitted delta and re-running: identical failure. |
| `yarn generate` | full | ✅ — `E.availability.availability_policy` generated; `availability.policies.{create,update,delete}` commands registered in `command-loaders.generated.ts`; 575 API paths (was 574). |
| `yarn db:generate` | full | ✅ no-op for `availability` (schema matches the committed migration + snapshot). `wms` emits an unrelated pre-existing migration (idempotency-key columns already present in `entities.ts` but missing from its stale `.snapshot-open-mercato.json`) on every run regardless of this branch — deleted per `packages/core/AGENTS.md`'s coding-agent exception; not committed, `wms`'s snapshot left untouched since this branch does not modify `wms`. |
| `TMPDIR=/private/var/tmp npx tsx scripts/i18n-check-sync.ts` | full | ✅ all 5 locales in sync |

## Regressions found and fixed during this checkpoint

Two full-suite-only guard failures surfaced by the new module (not caught by the availability-scoped test runs used per-Step):

1. `auth/__tests__/acl-feature-catalog.i18n.test.ts` — every declared `acl.ts` feature title needs a matching `auth.acl.features.<id>` key in `auth/i18n/en.json` (and, per `i18n:check-sync`, all other locales). Fixed by adding the 3 `availability.*` keys to all 5 locale files.
2. `__tests__/record-locks-coverage.test.ts` — the enterprise record_locks coverage guard requires an explicit `enabled`/`exempt` decision for every entity curated in the OSS `optimistic-lock-editable-entities.test.ts` list. Added `'availability:AvailabilityPolicy': { status: 'enabled', ... }` (standard `makeCrudRoute` entity, no special wiring needed — matches the documented default).

## Design-decision audit (Step 2.4)

Caught and fixed before commit: the `create` command was missing `ensureAvailabilityPolicyCommandScope(ctx, parsed)` on the client-supplied `organizationId`/`tenantId` — the currencies reference command validates this on create; my first draft only validated it on update/delete (post-fetch). Fixed; a client can no longer create a policy row under an arbitrary tenant/org by spoofing the create payload.

## UI verification

Not applicable at this checkpoint — no UI has been touched yet (Steps 2.7/2.8 are the backend UI Steps). The new `TC-AVAIL-001-policies-crud.spec.ts` Playwright integration spec (CRUD happy path, ACL gating via the employee/admin persona pair, tenant isolation via a superadmin + `om_selected_tenant` cookie cross-tenant read, and an optimistic-lock 409 case) is written and typechecks cleanly against the real helper signatures, but **could not be executed in this environment** — no container runtime is available here for the ephemeral Postgres + live app server the `__integration__/*.spec.ts` suite requires (documented constraint of this sandbox). It will run for real at the final gate once the QA environment is stood up alongside the UI Steps' own Playwright coverage.

## Next Step

2.5 — admin check API route (`POST /api/availability/check`) + tests.
