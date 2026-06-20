# Checkpoint 12 — CI stabilization + 2nd develop merge

**When:** 2026-06-02 (resume 4 — final)
**Commits:** 4d9cf35af (CI fix: customers inline-edit lock-token refresh), 457a59623 (merge develop 0.6.4)

## CI failure root-caused + fixed (TC-CRM-003)
The Standalone App Integration Tests job failed on `TC-CRM-003` (edit company detail → persist). Reproduced locally against a real app build. Root cause: **default-ON optimistic locking exposed a real regression** — company/person detail inline editors read `data.updatedAt` for the version header but the page never refreshed `updatedAt` after a save, so the 2nd sequential inline edit sent a stale version → 409 → silent rejection (failed on the Website edit after Display name).

**Fix:** companies/people update commands return the freshly-bumped `updatedAt`; the CRUD update response surfaces it; the detail pages capture it and refresh `data.{company,person}.updatedAt` after every inline save (base + custom fields).

**Verified:** booted a real app build (next build + next start against a migrated DB) and ran the suite via `BASE_URL` (the ephemeral harness app-start was flaky locally; manual boot worked `✓ Ready`):
- `TC-CRM-003` ✅ pass (was failing)
- `TC-CRM-006` ✅ pass
- 64 customers unit tests ✅; 201 touched-area unit tests ✅ post-merge.

## 2nd develop merge (0.6.4)
- Conflicts: only `CHANGELOG.md` (kept my `# Unreleased` block + develop's `# 0.6.4`). All code auto-merged.
- develop now includes: **#2415 "Persist metadata changes for system entities on save (fixes #2411)"** → my deferred #2411 is now RESOLVED upstream and merged in. Also **#2348 roles/users `updated_at` migration** (fixes fresh-install boot).
- Post-merge: typecheck (core/ui/shared) clean; 201 unit tests green; `updatedAt` returns survived the auto-merge of develop's atomic-write refactor in `companies.ts`.
- PR is MERGEABLE.

## Verification summary (cumulative this resume)
- TC-LOCK-OSS full suite: 23/23 on ephemeral env.
- TC-CRM-003 + TC-CRM-006: green on a real app build.
- Unit: 201 tests across all touched modules + lock guards.
- Typecheck: core/ui/shared/checkout/webhooks clean.
