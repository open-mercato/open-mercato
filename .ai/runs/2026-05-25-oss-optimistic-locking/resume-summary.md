## 🤖 `auto-continue-pr-loop` — resume summary

**Tracking plan:** `.ai/runs/2026-05-25-oss-optimistic-locking/PLAN.md`
**Run folder:** `.ai/runs/2026-05-25-oss-optimistic-locking/`
**Branch:** `feat/oss-optimistic-locking` @ `24fb640ef`
**Resume point:** 7.1 → 11.1 (Phases 7–11 of the spec) + spec-completion gate
**Final status:** **complete** — every row in the Tasks table is `done`, the validation gate is green

### Summary of changes in this resume

- **Phase 7 — `customers.person` reference** (`23b28c066..7374b65ea`): added a `customers.person` reader to `customers/di.ts` and an integration test `TC-LOCK-OSS-002.spec.ts` that races two updates on a person record and asserts the structured 409 body.
- **Phase 8 — `sales.order` reference + reader store** (`31d4c3a1d..ff7841453`): introduced `packages/shared/src/lib/crud/optimistic-lock-store.ts` (`registerOptimisticLockReaders` / `getAllOptimisticLockReaders`) so multiple modules can contribute readers without Awilix last-write-wins eating one of them; migrated `customers/di.ts` to the store; added a `sales.order` reader in `sales/di.ts` via the store; added `TC-LOCK-OSS-003.spec.ts` for the sales race.
- **Phase 9 — `CrudForm` auto-injection** (`a3d13cc5b`): added optional `optimisticLockUpdatedAt?: string | null` prop. When set, the form merges `buildOptimisticLockHeader(...)` into the scoped-request headers used for both submit AND delete. Strictly additive when the prop is absent / null / empty. Paired UI test `CrudForm.optimisticLock.test.tsx` (4 cases) lands in the same commit per the user's resume directive.
- **Phase 10 — `useGuardedMutation` default 409 flash** (`ca507bad5`): after `dispatchBackendMutationError(...)`, the hook now detects optimistic-lock conflicts via `extractOptimisticLockConflict(err)` and surfaces the localized `ui.forms.flash.recordModified`. Strict — only fires for `status === 409 && code === 'optimistic_lock_conflict'`. Paired test `useGuardedMutation.optimisticLock.test.tsx` (4 cases).
- **Phase 11 — `customers.company` edit page wired end-to-end** (`4e4438ad6`): `companies-v2/[id]/page.tsx` passes `optimisticLockUpdatedAt={data?.company.updatedAt}`; the page test grew a prop-capturing CrudForm mock asserting both the happy path and the missing-`updatedAt` fallback.

Resume-only diff: 11 commits across Phases 7–11 + checkpoint 1 + checkpoint 2 + this final-gate batch. 32 files changed on the branch overall (+2840 / –7).

### External references honored

The spec under `.ai/specs/2026-05-25-oss-optimistic-locking.md` retains its original "External References" list (issue #1981 thread, the project's existing `umes/extension-headers.ts` convention, and the data-integrity docs page). No new external skills, libraries, or sources were consulted during this resume — all work was driven by the spec + the existing in-repo conventions.

### Verification phases completed (this resume)

- **Checkpoint verification (every ~5 Steps in this resume):**
  - `checkpoint-1-checks.md` — Steps 7.1, 7.2, 8.1, 8.2 verified (SHA range `23b28c066..ff7841453`). 27/27 shared optimistic-lock + 10/10 ui helpers; i18n in sync; 0 new typecheck errors. UI verification skipped — no UI files in window.
  - `checkpoint-2-checks.md` — Steps 9.1, 9.2, 10.1, 10.2, 11.1 verified (SHA range `a3d13cc5b..4e4438ad6`). UI-touch window: 66/66 ui suites + 4/4 page test pass; i18n in sync; 0 new typecheck errors.
- **Per-checkpoint validation:** typecheck (scoped) + unit tests (scoped to ui, shared, core/customers) + i18n sync after every checkpoint. Generate + build:packages were no-ops between checkpoints (no module-structure changes after Phase 8).
- **Focused integration tests per checkpoint (UI-touched windows):** contract-pinning unit tests with prop-capture mocks for `CrudForm`, `useGuardedMutation`, and the companies-v2 edit page. Playwright integration tests for the API path (`TC-LOCK-OSS-001`, `-002`, `-003`) run against the ephemeral CI stack on the next workflow run — local dev server is intentionally not running in the resume worktree, and the skill forbids letting UI verification block development.
- **Full validation gate (at spec completion):**
  - `yarn build:packages` ✅
  - `yarn generate` ✅ (no source emitted)
  - `yarn build:packages` post-generate ✅
  - `yarn i18n:check-sync` ✅
  - `yarn i18n:check-usage` ✅ (3650 unused-keys advisory, equal to develop baseline)
  - `yarn typecheck` ✅ (initial parallel run got SIGHUP/OOM on `@open-mercato/app#typecheck`; standalone retry from `apps/mercato` returned exit 0)
  - `yarn test` ✅ — **6132 tests across 677 suites pass** (ui 1067, core 4189, cli 876)
  - `yarn build:app` ✅ (compile 18s, TS 57s, static 13s, total 1m22s)
- **Full integration suite:** ⏭ deferred to CI ephemeral stack (per skill rule for resumes without a local dev env).
- **Standalone integration:** ⏭ skipped (justified — this resume did not touch packaging, `create-mercato-app` templates, or shared package public exports beyond pure additive new files).
- **ds-guardian pass:** clean — no DS violations introduced. The new UI code paths are header-merge + i18n-flash logic with zero rendered DOM additions; the page-level change is a single prop pass-through; the new utility files contain no JSX.
- **Self code-review:** applied `.ai/skills/code-review/SKILL.md` — clean.
- **BC self-review:** applied `BACKWARD_COMPATIBILITY.md` — every change is ADDITIVE; one documented behavior addition (`useGuardedMutation` default 409 flash) called out in the spec §3.6 and the docs page. No FROZEN / STABLE contract surface broken.
- **`auto-review-pr` autofix pass:** independent code-review subagent returned **APPROVE** with zero blocking findings. One docs nit (stale JSDoc path) was flagged and verified as a false positive — the referenced path `packages/shared/src/lib/umes/extension-headers.ts` actually exists. No follow-up commits required.

### How to verify

**Manual smoke test (admin app):**

1. `export OM_OPTIMISTIC_LOCK=customers.company,customers.person,sales.order` and start the dev stack.
2. Open a company in two browser tabs side-by-side: `/backend/customers/companies-v2/<id>`.
3. Edit a field in tab A and save → success, the company updates.
4. Edit a field in tab B (which still has the **stale** form) and save → expect the localized "Record modified — refresh and try again" flash; no destructive overwrite occurs.
5. Repeat the race with a person record (`/backend/customers/people/<id>`) and a sales order to confirm `customers.person` + `sales.order` readers.
6. With `OM_OPTIMISTIC_LOCK` unset / empty, the form should behave exactly as before (no header sent, no 409, no flash).

**Areas to spot-check in the diff:**

- `packages/shared/src/lib/crud/optimistic-lock.ts:178-232` — the `validateMutation` flow (off-fast-path, allowlist match, header read, normalize, current-read, compare).
- `packages/shared/src/lib/crud/optimistic-lock-store.ts` — the process-global reader registry that resolves the Awilix `last-write-wins` risk.
- `packages/core/src/modules/customers/di.ts:50-84` and `packages/core/src/modules/sales/di.ts:48-140` — both modules register the same `crudMutationGuardService` key, but both point at the shared store, so all readers stay visible.
- `packages/ui/src/backend/CrudForm.tsx:1200-1208` (delete) and `:2540-2548` (submit) — header-merge order: optimistic-lock header wins over injection headers if same key.
- `packages/ui/src/backend/injection/useGuardedMutation.ts:43-60` — default flash only fires for the strict optimistic-lock 409 shape.

**Commands the reviewer can re-run:**

```bash
yarn build:packages && yarn generate && yarn i18n:check-sync && yarn i18n:check-usage && yarn typecheck && yarn test && yarn build:app
# Integration tests (CI runs them automatically with OM_OPTIMISTIC_LOCK set):
OM_OPTIMISTIC_LOCK=customers.company,customers.person,sales.order yarn test:integration .ai/qa/tests   # if local stack is running
```

**Rollback plan:**

- Single revert: `git revert 24fb640ef^..24fb640ef` (and the resume-phase commit range `23b28c066^..ff7841453`, `a3d13cc5b^..4e4438ad6`).
- Soft rollback (no code revert needed): leave `OM_OPTIMISTIC_LOCK` unset — every guard is fail-open when the env is absent, so the feature is effectively disabled at runtime without a deploy.
- DB rollback: **none required** — this change adds no migrations or schema changes.

### What can go wrong (risk analysis)

- **Most likely regression:** a caller of `useGuardedMutation` that already catches 409 and flashes its own message will see two toasts (the default + their own). **Mitigation:** the spec calls this out (§3.6) and points callers at `extractOptimisticLockConflict(err)` to detect and suppress before re-throwing. The default flash is the right UX for the long tail of callers that previously had silent 409 handling.
- **Second-order effects:** any module that registers its own `crudMutationGuardService` Awilix key (today only the new `customers/di.ts` and `sales/di.ts`) is composed via the shared `optimistic-lock-store`. Future third-party modules MUST follow the same pattern (`registerOptimisticLockReaders({...})` + factory that calls `getAllOptimisticLockReaders()`); if they register a different factory shape, the last-write-wins risk returns. The docs page at `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` and the spec call this out.
- **Tenant/isolation risks:** readers filter on `tenantId` + (when present) `organizationId` + `deletedAt: null`. The lock check never returns data — only an ISO timestamp — and a missing record short-circuits the guard (return `ok: true`, lock skipped). No tenant-leak surface exists.
- **BC impact:** every public-surface change is ADDITIVE (new exports, new optional prop, new env var defaulting to OFF). One behavior addition (`useGuardedMutation` default flash) is documented in the spec and the docs page; no contract was broken.
- **Residual risk accepted:** the OSS layer is intentionally **last-writer-wins by default** when `OM_OPTIMISTIC_LOCK` is unset. Enterprise tenants who need pessimistic / record-lock behavior get that from the existing `record_locks` enterprise module; this PR doesn't try to compete with it.
