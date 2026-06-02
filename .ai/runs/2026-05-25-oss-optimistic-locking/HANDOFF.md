# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-06-02 (resume 4 — QA round-5 system-wide regression, Phase 30)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** Phase 30 (QA round-5). 30.1–30.6 done (checkpoint 9). Next: 30.7 Pay Links + Checkout Templates.
**Last code commit:** 7025099a6 (feature_toggles global override lock).

## QA round-5 source
@alinadivante comment https://github.com/open-mercato/open-mercato/pull/2055#issuecomment-4602798597 — ~19 "missing conflict protection" areas + 3 separate bugs (#2409, #2410, #2411). User directive: fix each, atomic commit + check + Alina comment per fix; add integration tests; verify with Playwright.

## Done this resume (30.1–30.6)
- Customer Users / Customer Roles (custom admin routes): list returns updatedAt; PUT/DELETE enforceCommandOptimisticLock; nativeUpdate bumps updated_at + returns it.
- Organizations: manage GET returns updatedAt (PUT/DELETE already enforce via makeCrudRoute; edit page + list already read updatedAt).
- Inbox Settings: removed exempt; GET/PATCH return updatedAt; PATCH enforces; page sends header.
- #2410: feature-toggle boolean override selector display normalizer.
- Feature Toggles (Global) override: GET returns updatedAt; card sends header + conflict bar; overrides PUT enforces.

## Remaining (todo) — 30.7..30.15
- 30.7 Pay Links + Checkout Templates (checkout pkg, LinkTemplateForm raw PUT no header).
- 30.8 Sidebar Customization (auth/api/sidebar/preferences — omit updatedAt + unguarded saves).
- 30.9 Saved table Views ("My Views") — LOCATE first (perspectives module?).
- 30.10 System Entities + User Entities records (entities module — records API custom CRUD).
- 30.11 #2411 System Entities save no-op (entities user/[entityId]/page.tsx + definitions.batch — system-source entities not persisted).
- 30.12 #2409 Availability Schedule delete false success toast on 409 (planner AvailabilitySchedule.tsx — success flash fires even when deleteCrud throws; wrap in try/catch).
- 30.13 Webhooks / Integrations / Data Sync / Notification Delivery / Scheduled Jobs / Dictionaries config — triage said several already OK or need updatedAt exposure; VERIFY each against live before claiming.
- 30.14 Workflow visual editor — triage said already protected; QA says broken → re-verify the save path (node/edge save may bypass the protected PUT).
- 30.15 Batched integration + Playwright verification: boot ephemeral env once and run two-session specs for fixed areas.

## Per-fix pattern (PROVEN — reuse)
1. List/detail API must return `updatedAt`.
2. Custom PUT/DELETE/PATCH → `enforceCommandOptimisticLock({ resourceKind, resourceId, current: rec.updatedAt ?? null, request: req })` + `catch (e) { if (isCrudHttpError(e)) return NextResponse.json(e.body,{status:e.status}); throw e }`.
3. `em.nativeUpdate` bypasses onUpdate → set `updatedAt: new Date()` explicitly + return it.
4. Client raw handler → `withScopedApiRequestHeaders(buildOptimisticLockHeader(rec.updatedAt), () => apiCall(...))`; surface via `surfaceRecordConflict(err, t)` from `@open-mercato/ui/backend/conflicts` (CrudForm/useGuardedMutation auto-surface).
5. Per-fix check = focused jest route test mirroring `auth/api/roles/acl/__tests__/optimistic-lock.test.ts`.

## Environment / build (worktree)
- Worktree: `.ai/tmp/auto-continue-pr/pr-2055-20260602-155021`. Ran `yarn install --mode=skip-build` → `yarn build:packages` (cache-shared) → `yarn generate`. Tests + turbo typecheck work.
- `yarn workspace @open-mercato/core test <path>` for focused tests. `yarn turbo run typecheck --filter=@open-mercato/core` for the real typecheck (workspace tsc has pre-existing TS6.0 ignoreDeprecations noise).
- Ephemeral integration env: `yarn test:integration:ephemeral:start` (base :5001, admin@acme.com/secret) — for 30.15.
