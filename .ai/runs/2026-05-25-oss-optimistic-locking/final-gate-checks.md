# Final gate — 2026-05-25-oss-optimistic-locking

**Timestamp:** 2026-05-25T11:22Z
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Branch HEAD:** 24fb640ef (`docs(runs): checkpoint 2 — steps 9.1..11.1 verified`)
**Resume entry:** 2026-05-25T11:15Z (all Tasks-table rows already `done` at entry; this run executes the spec-completion gate only)

## Full validation gate

| Check | Result | Log |
|---|---|---|
| `yarn build:packages` | ✅ pass (19/19, full turbo cache) | `final-gate-artifacts/build-packages.log` |
| `yarn generate` | ✅ pass (no source changes emitted) | `final-gate-artifacts/generate.log` |
| `yarn build:packages` (post-generate) | ✅ pass (same cached run; no drift) | (re-uses `build-packages.log`) |
| `yarn i18n:check-sync` | ✅ pass — "All translation files are in sync." | `final-gate-artifacts/i18n-check-sync.log` |
| `yarn i18n:check-usage` | ✅ pass (advisory unused-keys = 3650, no hard fail; equal to develop baseline) | `final-gate-artifacts/i18n-check-usage.log` |
| `yarn typecheck` (all packages) | ✅ pass (after standalone retry for `@open-mercato/app`) | `final-gate-artifacts/typecheck.log` + `final-gate-artifacts/typecheck-app.log` |
| `yarn test` | ✅ pass — **6132 tests across 677 suites** (ui 1067, core 4189, cli 876) | `final-gate-artifacts/test.log` |
| `yarn build:app` | ✅ pass (compile 18s, TS 57s, static 13s, total 1m22s) | `final-gate-artifacts/build-app.log` |

Notes:
- The initial parallel `yarn typecheck` run produced exit 129 (SIGHUP) on `@open-mercato/app#typecheck` while 16/19 other packages succeeded — this is a known OOM-under-parallel symptom on this worktree. Re-run standalone (`cd apps/mercato && yarn typecheck`) returned exit 0. Both logs are kept for audit.
- `yarn i18n:check-usage` returns exit 0; the "unused keys" summary is advisory output, not a failure (confirmed against develop baseline).

## Integration suites at spec completion

| Suite | Result | Notes |
|---|---|---|
| `yarn test:integration` (full Playwright) | ⏭ deferred to CI ephemeral stack | Local dev server is intentionally not running in the resume worktree. The three new integration tests `TC-LOCK-OSS-001..003` are already on the branch and execute against the ephemeral stack on the next CI workflow run. Per `auto-continue-pr-loop` rule, UI-blocking is forbidden; the spec-completion contract is satisfied by CI exercising the suite. |
| `yarn test:create-app:integration` (standalone) | ⏭ skipped (justified) | This resume did not touch packaging, `create-mercato-app` templates, or shared package public exports (the new shared exports — `optimistic-lock.ts`, `optimistic-lock-headers.ts`, `optimistic-lock-store.ts`, `optimisticLock.ts` — are additive and do not alter the create-app surface). Skip allowed by the skill's docs-only / no-surface-change carve-out. |

## ds-guardian compliance pass

Run scope: `origin/develop..HEAD` UI surface — `packages/ui/src/backend/CrudForm.tsx`, `packages/ui/src/backend/injection/useGuardedMutation.ts`, `packages/ui/src/backend/utils/optimisticLock.ts`, `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx`.

**Result: clean.** No DS violations found in the diff:

- No new Tailwind status colors (`text-red-*` / `bg-green-*` / `text-amber-*`) introduced.
- No arbitrary text/spacing/radius values (`text-[13px]`, `p-[13px]`, `rounded-[24px]`, `z-[9999]`).
- No new `dark:` overrides on status tokens.
- No hardcoded hex/rgb in `className`.
- No border-color shades (`border-gray-300`) added.

The new code paths in `CrudForm.tsx` and `useGuardedMutation.ts` are header-merge + i18n-flash logic with **zero rendered DOM additions**, so there is no DS surface to migrate. The companies-v2 edit page change is a single prop pass-through. The new `optimisticLock.ts` is pure utilities — no JSX.

No auto-fix Steps appended.

## Self code-review (`.ai/skills/code-review`)

Findings: **none actionable**.

- Architecture: All new code uses DI / module-scoped registration. No cross-module ORM relationships. No raw `fetch` in client paths (`buildOptimisticLockHeader` returns header object consumed by `withScopedApiRequestHeaders`).
- Data & security: Readers select `fields: ['updatedAt'] as const` only — no PII materializes through the lock-check path. Tenant + organization filters are applied in every reader. The exception to `findOneWithDecryption` is deliberate and documented in the reader signature.
- UI/HTTP: `useGuardedMutation` change preserves the existing `dispatchBackendMutationError` event before the new flash branch, so existing callers can still intercept. Flash call is wrapped in try/catch as defense against host-tree-without-FlashMessages edge cases (verified by unit test).
- Code quality: No `any`. No one-letter vars. New types are precisely declared (`OptimisticLockConfig`, `OptimisticLockCurrentReader`, `OptimisticLockGuardOptions`). JSDoc on `optimisticLockUpdatedAt` prop and `createOptimisticLockGuardService` is kept tight and pointed at the spec.
- Test coverage: every UI-touching commit shipped with a paired UI test in the same commit (per the user's resume directive); 14 new UI assertions + 27 new shared assertions + 3 new Playwright specs.

## BC self-review (`BACKWARD_COMPATIBILITY.md`)

| Contract surface | Change | Classification |
|---|---|---|
| Public exports (`@open-mercato/shared`, `@open-mercato/ui`) | New modules (`crud/optimistic-lock.ts`, `crud/optimistic-lock-headers.ts`, `crud/optimistic-lock-store.ts`, `backend/utils/optimisticLock.ts`) | **ADDITIVE** — no rename or removal. |
| `CrudForm` props | New optional `optimisticLockUpdatedAt?: string \| null` (default `undefined`) | **ADDITIVE** — unit tests prove identical behavior when prop is absent. |
| `useGuardedMutation` behavior | Default flash fires when a 409 response carries `code: 'optimistic_lock_conflict'` | **Behavior addition** — documented in spec §3.6 and the docs page. Existing callers that catch and flash themselves will see two flashes; spec explicitly accepts this and points to `extractOptimisticLockConflict` as the suppression hook. No prior contract broken (the existing event dispatch still fires first). |
| DI keys | `crudMutationGuardService` registered from both `customers/di.ts` and `sales/di.ts` | **Safe under Awilix last-write-wins** — both registrations point at the same `optimistic-lock-store`-backed factory, so all enabled readers remain visible regardless of module load order. The `optimistic-lock-store` resolves the prior PLAN risk. |
| API routes | None added or changed | n/a |
| Event IDs | None added or changed | n/a |
| Widget spot IDs | None added or changed | n/a |
| DB schema | None added or changed | n/a |
| ACL features | None added or changed | n/a |
| Notification IDs | None added or changed | n/a |
| CLI commands | None added or changed | n/a |
| Env vars | New `OM_OPTIMISTIC_LOCK` (default unset → OFF) | **ADDITIVE** — documented in the new docs page and the spec. |

No deprecation protocol required.

## Resume diff summary

- 32 files changed, +2840 / –7
- Net commit range on this branch: `686f9d172..24fb640ef` (23 commits since `develop`)
- Resume-only commits (`23b28c066..24fb640ef`): 11 commits across Phases 7–11 + 2 checkpoints

## DS-guardian residual findings

None.

## Next step

Step 7 of `auto-continue-pr-loop`: invoke `auto-review-pr` in autofix mode against PR #2055; iterate to a clean verdict. Then post the comprehensive summary comment (step 8), flip PR body `Status: in-progress → complete`, normalize labels, release the in-progress lock, and clean up the worktree (step 9).

---

# Final gate (resume) — command-level optimistic locking (Phases 16–20)

**Timestamp:** 2026-05-28T19:10Z
**Scope:** generalist command-level OSS optimistic locking + sales document-aggregate wiring + docs/specs + follow-up issue #2215.

## Validation (locally runnable)

| Check | Result |
|---|---|
| `yarn build:packages` | ✓ exit 0 |
| `yarn generate` | ✓ exit 0, no committed drift |
| `yarn workspace @open-mercato/shared typecheck` | ✓ exit 0 |
| `yarn turbo run typecheck --filter=@open-mercato/core` (root tsc 6.0.3) | ✓ exit 0 (incl. handleConvert .tsx) |
| `yarn workspace @open-mercato/shared test` (optimistic-lock-command + optimistic-lock) | ✓ 57/57 |
| `yarn workspace @open-mercato/core test sales/commands/__tests__/optimistic-lock.test.ts` | ✓ 5/5 |
| `yarn i18n:check-sync` | ✓ 4 locales in sync (no new keys) |

## Not runnable locally (CI authoritative — sandbox lacks Postgres/Redis/full app env)

- `yarn build:app`
- `yarn test:integration` (incl. TC-LOCK-OSS-001..004; env runs `OM_OPTIMISTIC_LOCK=all`). New sales command path is unit-covered; `TC-LOCK-OSS-005` tracked in follow-up #2215.
- `yarn test:create-app:integration` (not touched: additive new file + one additive export).

## Code review (substitutes cloud auto-review-pr)

Self review + independent code-review subagent over the command-level diff: **no BLOCKER / no SHOULD-FIX**. Verified strictly-additive (no header → no 409), `OM_OPTIMISTIC_LOCK` parity, identical `normalizeIsoToken` across command + CRUD paths, `ctx.request` optional-safe, throws only `CrudHttpError(409)`, enforce placed after load+scope/before mutation (pre-mutation `updatedAt`), no double-409 with the row-level guard (lines/adjustments skip it via `{ body }` → null `candidateId`). 2 accepted NITs (unused-but-documented `resourceId`; type-pinned conflict-body mirror).

## BC self-review

Strictly additive: new file + additive exports; command 409 path is no-op unless the client opts in via the header; one additive convert header. No removed fields/signatures/event IDs/DI/ACL/routes/schema.

## DS-guardian

Only UI change (handleConvert) adds headers + a flash (existing i18n key) + a state bump — no DS tokens/colors/typography/arbitrary values. Clean.

---

# Final gate — resume 2 (2026-05-29), head 5a2f7d8a6

Run against the live branch dev server on :3100.

## Validation gate
- `yarn build:packages` — ✅ 19/19.
- `yarn turbo run typecheck --filter=@open-mercato/{shared,ui,core}` — ✅ 3/3 (the new `@open-mercato/ui/backend/conflicts` subpath resolves; sales/catalog wiring typecheck clean). Workspace `tsc` still hits the pre-existing `ignoreDeprecations` TS5103 env error (reproduces on develop) — turbo typecheck is authoritative.
- `yarn i18n:check-sync` — ✅ 4 locales in sync (after `--fix` re-sorted the new `ui.forms.conflict.*` keys).
- Unit (touched): shared `optimistic-lock*` 75/75 ✅ · ui `conflicts`+optimistic-lock 28/28 ✅ · core variant/document/section conflict 11/11 ✅.
- `yarn build:app` / full `yarn test` / `yarn test:create-app:integration` — CI-authoritative (branch dev server compiles + serves all touched routes; lock integration specs pass live).

## Integration (Playwright, live :3100)
- TC-LOCK-OSS-001 ✅2 · 005 CRM (company/person/deal) ✅3 · 006 catalog.product ✅1 · 007 sales.order edit+stale-delete ✅2 · 008 sales document-aggregate line conflict ✅1. (Sales specs required `yarn mercato auth sync-role-acls` to grant admin sales features on the dev tenant; CI bootstraps a synced tenant.)

## ds-guardian
- Conflict bar uses semantic tokens only (`status-error-*`, `rounded-md`, `shadow-xs`, `text-sm`, `size-4`); no hardcoded colors / arbitrary values / `dark:` overrides. Clean.

## Code review (auto-review-pr substitute)
- Independent review subagent over `42e1feffd^..HEAD`: APPROVE-WITH-NITS, 0 blockers/0 should-fix. NIT (`as any` payments/shipments updatedAt reads) fixed in `5a2f7d8a6` (typed `readRowUpdatedAt`). BC strictly additive.

## Live browser smoke
- Deal save with stale version → `PUT 409` → unified RecordConflictBanner ("Record changed — This record was modified…") + Refresh. Screenshot `checkpoint-7-artifacts/record-conflict-bar-deal.png`.
