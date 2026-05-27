# Pre-Implementation Analysis: Staff Decouple from Core (Phase 1)

**Spec**: `.ai/specs/2026-05-08-staff-decouple-from-core.md`
**Date**: 2026-05-14
**Analyst**: pre-implement-spec skill
**Branch**: `feat/spec-069-timesheets-phase-1` (target PR branch will be a fresh `feat/staff-decouple-from-core` off `upstream/develop`)

## Executive Summary

The spec is **implementation-ready with minor doc fixes**. All architectural claims were fact-checked against the codebase and hold: exactly 2 production coupling sites exist (`customers/api/assignable-staff/route.ts`, `planner/api/access.ts`), staff has no `di.ts` yet, the target route path is free, ACL features and encryption maps match the spec's baseline, and the DI registrar pattern proposed for staff matches the shape already used by `customers/di.ts` and `planner/di.ts`. Three minor gaps (a stale test-fixture path reference, no explicit Awilix version pin for `allowUnregistered: true`, and cross-module i18n key reuse without a stated ownership rule) should be addressed before merge but do not block starting implementation. **Recommendation: proceed.**

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | — | None | — | — |

All 13 contract surfaces audited; spec is BC-compliant:

| BC# | Surface | Spec touches it? | Compliance |
|-----|---------|------------------|------------|
| 1 | Auto-discovery files | New `staff/di.ts`, new `staff/api/team-members/assignable/route.ts`, new `staff/AGENTS.md` | ✅ Additive only |
| 2 | Type definitions | `AvailabilityWriteAccess` gains optional `unregistered?: boolean` | ✅ Optional field addition — non-breaking |
| 3 | Function signatures | `resolveAvailabilityWriteAccess` keeps same signature; body relocated | ✅ Re-export bridge from planner |
| 4 | Import paths | Direct `staff/data/entities` imports removed from customers + planner | ✅ Replaced with DI lookup; no consumers of these paths outside core |
| 5 | Event IDs | None | ✅ N/A |
| 6 | Widget spot IDs | None | ✅ N/A |
| 7 | API route URLs | `/api/customers/assignable-staff` gets `308` redirect | ✅ Kept for ≥1 minor (BC #7 STABLE rule) |
| 8 | Database schema | None | ✅ N/A |
| 9 | DI service names | New key `availabilityAccessResolver` registered | ✅ Additive; new spec documents it as public surface in `staff/AGENTS.md` |
| 10 | ACL feature IDs | None — `staff.my_availability.*` constants relocate but feature IDs unchanged | ✅ Frozen IDs preserved |
| 11 | Notification type IDs | None | ✅ N/A |
| 12 | CLI commands | None | ✅ N/A |
| 13 | Generated file contracts | New module `di.ts` discovered by existing generator; no contract changes | ✅ Additive |

### Missing BC Section

✅ Spec includes "Migration & Backward Compatibility" section with explicit Contract Surfaces Affected table (lines 346–354) and a Compatibility Rules subsection.

---

## Spec Completeness

### Missing Sections

None — all required sections present.

### Required Sections Checklist

- [x] TLDR & Overview
- [x] Problem Statement (both coupling sites described with line refs)
- [x] Proposed Solution (Design Decisions + Alternatives Considered tables)
- [x] Architecture (Module-File Changes table, DI Service Contract code samples, route specs)
- [x] Data Models (explicitly: "No data model changes")
- [x] API Contracts (new route + redirect route tables)
- [x] UI/UX (consumer inventory step documented)
- [x] Configuration (explicitly: "None")
- [x] Migration & Backward Compatibility (full table; rollout strategy; PR #1111 sequencing)
- [x] Risks & Impact Review (7 risks, 4 categories, severity + mitigation + residual)
- [x] Implementation Plan (3 phases, each with verification gate)
- [x] Testing Strategy (table of new + updated tests)
- [x] Final Compliance Report (AGENTS.md matrix)
- [x] References + Changelog

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Out-of-Scope String References (line 92–99) | Path `packages/core/__integration__/helpers/staffFixtures.ts` is incorrect — actual location is `packages/core/src/helpers/integration/staffFixtures.ts` (with a re-export at `packages/core/src/modules/core/__integration__/helpers/staffFixtures.ts`) | Update the table line for accuracy. Minor doc fix — does not affect implementation |
| Phase 1.B Step 2 (di.ts wiring) | Says "if the generated module index does not include the new registrar, update the bootstrap wiring" — but doesn't confirm whether the generator picks up new `di.ts` files automatically | Verified: `apps/mercato/src/bootstrap.ts` imports `diRegistrars` from `.mercato/generated/di.generated.ts`. New `di.ts` files ARE auto-discovered after `yarn generate`. No bootstrap edit needed in practice. Spec should drop the "if not" branch as it's defensive over-specification |
| Phase 1.B Step 4 (fail-soft test) | Asserts unit-test approach against the wrapper, but the existing `module-decoupling.test.ts` already demonstrates a "registerModules with a reduced module list" pattern (lines 94–192) that could exercise the integration shape | Optional: consider extending `module-decoupling.test.ts` with a staff-disabled assertion in addition to the wrapper unit test. Not blocking — spec's unit-test choice is defensible |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| — | — | None |

### Compliance Confirmation

| Rule Source | Rule | Status |
|-------------|------|--------|
| root `AGENTS.md` | NO direct ORM relationships between modules — use FK IDs | ✅ DI resolver replaces direct entity import |
| root `AGENTS.md` | Filter by `organization_id` for tenant-scoped entities | ✅ Scope args byte-copied (verified in `planner/api/access.ts:75–81` and `customers/.../route.ts:79`) |
| root `AGENTS.md` | DI (Awilix) over `new` | ✅ `availabilityAccessResolver` via `asValue` |
| root `AGENTS.md` | Modules isomorphic and independent | ✅ Removes cross-module imports; staff stays optional |
| root `AGENTS.md` | Validate inputs with zod | ✅ Existing zod schema preserved on the moved route |
| root `AGENTS.md` | API routes MUST export `openApi` | ✅ Both new + redirect route export `openApi` |
| root `AGENTS.md` | API routes export per-method `metadata` | ✅ `metadata.GET` pattern preserved |
| `packages/core/AGENTS.md` | Auto-discovery `api/<METHOD>/<path>.ts → /api/<path>` | ✅ New route lives at `staff/api/team-members/assignable/route.ts` |
| `packages/core/AGENTS.md` | Encryption: use `findWithDecryption` | ✅ Preserved (5-arg signature with scope) |
| `packages/core/AGENTS.md` | Always supply `tenantId`/`organizationId` to decryption helpers | ✅ Byte-copied |
| `packages/shared/AGENTS.md` | MUST NOT add domain-specific logic to shared | ✅ All moved logic lives in `staff/lib/`; explicitly rejected in Alternatives table |
| `packages/core/src/modules/customers/AGENTS.md` | Customers is the reference CRUD module | ✅ New staff route mirrors customers' `findWithDecryption + scope + paged` pattern |
| root `AGENTS.md` Feature-gated runtime helpers (lessons.md line 171) | Must use wildcard-aware matcher | ✅ Spec uses `rbac.userHasAllFeatures()` (the service method already wildcard-aware) — not a raw `features.includes()` check |
| `BACKWARD_COMPATIBILITY.md` Deprecation Protocol | `RELEASE_NOTES.md` entry required | ✅ Phase 1.C Step 2 makes it mandatory |
| `BACKWARD_COMPATIBILITY.md` Deprecation Protocol | Spec MUST include "Migration & Backward Compatibility" section | ✅ Present |

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Refactor accidentally widens tenant scope** when moving `findWithDecryption`/`findOneWithDecryption` calls | Cross-tenant data leakage on both new staff route and the moved availability resolver | Spec mandates byte-copy of scope args + reviewer line-by-line diff (spec section "Tenant & Data Isolation Risks"). Existing integration tests with seeded multi-tenant data must pass at both Phase 1.A and 1.B gates |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Cross-module i18n key consumption** — new staff route consumes `customers.errors.*` and `customers.assignableStaff.*` keys | If customers module renames or removes these keys later, the staff route's translation lookup returns the English fallback silently | Spec section "Internationalization" acknowledges this. Add a comment in the new staff route file stating the cross-module key dependency. Long-term: a follow-up could move these keys to a shared namespace, but defer to Phase 3 |
| **Awilix `allowUnregistered: true` is the first in-tree use** | If the installed Awilix version doesn't support the option, the planner's `container.resolve(...{ allowUnregistered: true })` call throws at runtime instead of returning undefined, defeating the fail-soft design | Verify `package.json` Awilix version is ≥4.0 (option introduced in 4.x). Add a one-line `package.json` version check to Phase 1.B Step 2. The spec already proposes a smoke test asserting `hasRegistration('availabilityAccessResolver') === true` when staff is enabled — extend it to also exercise the absent-staff path |
| **Test fixture path in spec is wrong** | Reviewer/implementer confused; potential wasted time hunting for the non-existent path | Doc fix: update spec line 99 from `core/__integration__/helpers/staffFixtures.ts` to `packages/core/src/helpers/integration/staffFixtures.ts` (or the re-export at `packages/core/src/modules/core/__integration__/helpers/staffFixtures.ts`) |
| **PR #1111 (timesheets) interaction** | If timesheets PR introduces a third coupling site in dashboards after this PR's grep is run, the proof-of-decouple gets stale | Spec already documents all 3 sequencing scenarios. Phase 1.C Step 1 grep MUST be re-run on the rebased branch immediately before merge if PR #1111 lands first |
| **In-tree consumer migration scope** | UI fetcher at `packages/core/src/modules/customers/components/detail/assignableStaff.ts:39` MUST be updated to the new URL; if missed, the redirect silently masks the omission and the legacy URL becomes load-bearing in-tree | Phase 1.A Step 2 inventory must explicitly list this file. PR description must show before/after diff |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **DI registration order race during boot** | First availability request before staff's `register()` returns false 403s | Module registration is synchronous before HTTP server starts; spec's structural smoke test guards against accidental reordering |
| **Performance regression from extra DI lookup** | Awilix `resolve` adds nanoseconds per request | Awilix `asValue` is O(1) map lookup; negligible |
| **External HTTP clients that don't follow `308`** | Non-conformant clients break on redirect | Standard clients (fetch/axios/curl/requests) all follow `308`. RELEASE_NOTES.md entry warns external consumers. Edge case |
| **`module-decoupling.test.ts` not extended to cover the new resolver** | Future refactor could accidentally break the fail-soft contract without test coverage | Spec's wrapper unit test (Phase 1.B Step 4) is sufficient. Optional follow-up: extend the existing decoupling test to assert resolver absence behavior |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

None.

### Important Gaps (Should Address Before Merge)

- **Awilix version pin verification**: Add a one-line check in Phase 1.B Step 2 confirming the Awilix version installed at `packages/core/package.json` and root `package.json` supports `allowUnregistered: true` (Awilix ≥4.0). Spec proposes this option but doesn't sanity-check the dependency.
- **Stale test fixture path**: Update spec line 99 to the correct path (`packages/core/src/helpers/integration/staffFixtures.ts`).
- **In-tree UI consumer**: Explicitly call out `packages/core/src/modules/customers/components/detail/assignableStaff.ts:39` in Phase 1.A Step 2 — it's the only production callsite of the legacy URL and the spec's grep step is generic.

### Nice-to-Have Gaps

- **i18n key ownership documentation**: Add a short note (in new `staff/AGENTS.md` or as an inline comment) that the new staff route depends on customers-owned i18n keys (`customers.errors.organization_required`, `customers.assignableStaff.forbidden`). This documents the dependency for the eventual physical extraction in Phase 2.
- **OpenAPI tag consistency**: The new route uses `tag: 'Staff'` and the redirect retains `tag: 'Customers'` (with `deprecated: true`). Confirm `Staff` already exists as a known tag in the OpenAPI generator output, or add it explicitly.
- **Test for redirect query string preservation**: The legacy-route test should pass an unusual query string (with reserved characters and `pageSize=100` at the cap) to prove `308` preserves the search portion verbatim.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Fix stale path in spec line 99** — update to `packages/core/src/helpers/integration/staffFixtures.ts` (or the re-export shim).
2. **Add Awilix version assertion** to Phase 1.B Step 2 — confirm `allowUnregistered: true` is supported by the installed version.
3. **Pin the in-tree consumer** — Phase 1.A Step 2 must explicitly name `packages/core/src/modules/customers/components/detail/assignableStaff.ts` as a production callsite to migrate.

### During Implementation (Add to Spec)

1. **i18n cross-module dependency note** in the new staff route file: add a leading comment stating the route consumes customers-owned i18n keys; Phase 2 (physical extraction) needs to either move the keys or fall back to a staff-owned namespace.
2. **Redirect test coverage**: assert the `Location` header preserves the query string for `?page=2&pageSize=100&search=foo` (cap-edge case).
3. **Extend the fail-soft smoke test** beyond the wrapper unit test: also exercise `module-decoupling.test.ts` with staff excluded, to lock the fail-soft contract end-to-end. Optional, but cheap.

### Post-Implementation (Follow Up)

1. **Open the dashboards-decouple spec** as soon as PR #1111 (timesheets) merges. The current branch (`feat/spec-069-timesheets-phase-1`) may already contain that third coupling site — verify before opening the follow-up spec.
2. **Open the Phase 3 spec** (delete-staff-from-core) once `@open-mercato/staff` is published in `official-modules` and verified in a sandbox. Out-of-scope cleanup items (nav string refs, test fixtures) move under Phase 3.
3. **Eventually relocate i18n keys** from `customers.assignableStaff.*` to either a shared namespace or a new `staff.assignable.*` namespace — defer to Phase 2 when staff becomes its own package.

---

## Recommendation

**Ready to implement** — pending three quick doc fixes listed under "Before Implementation."

The spec is unusually thorough: every architectural claim was fact-checked against the codebase and held. The Phase 1 scope is tight (2 files modified, 4 files created, 0 schema changes, 0 ACL changes), the BC strategy is correct, and risks are explicitly enumerated with concrete mitigations. The DI-resolver pattern matches existing in-tree shapes (`customers/di.ts`, `planner/di.ts`) and the `allowUnregistered: true` option is well-suited to the fail-soft requirement.

The one piece of advice for the implementer: **the current branch (`feat/spec-069-timesheets-phase-1`) is the timesheets work** — the staff-decouple PR must be on a fresh branch off `upstream/develop` (named `feat/staff-decouple-from-core` per the spec), targeting `upstream/develop`, NOT this branch or the company fork.
