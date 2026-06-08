# Pre-Implementation Analysis: Organization-Scope Fail-Open Authorization Hardening

> Target spec: `.ai/specs/2026-05-29-org-scope-fail-open-authorization-hardening.md`
> Analysis date: 2026-05-29 · Analysis only — no code or spec modified.

## Executive Summary
The spec is well-scoped and architecturally sound; the read-path fix (#2245) fully closes the audited 10 detail-route guards, and the write-path fix (#2239) closes the hole for all CRUD-factory / explicit-scope command paths (which include the named example, customers people update/delete). **One material gap:** the proposed "legacy `currentOrg` fallback when `organizationScope` is absent" is *load-bearing* for ~40 "Pattern C" command call sites that build the command context with `organizationScope: null`. For those, hole-closure depends on `selectedOrganizationId` being correctly populated, not on the new `allowedIds` check. This is not a regression (behavior is preserved there), but it means #2239 is **not universally closed** by the central fix alone. **Recommendation: proceed to implementation** with two spec additions (Pattern C contract note + a tracked follow-up), and a mandatory regression test asserting the allow-path is unchanged.

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | 3. Function Signatures | `ensureOrganizationScope(ctx, organizationId)` signature is **unchanged**; behavior tightens (deny where it previously skipped). Not listed in the BC STABLE function table, and signature-stable. Security hardening of behavior is explicitly permitted. | None (informational) | No bridge needed. Document behavior change in `RELEASE_NOTES.md` (already in spec). |
| — | 2. Type Definitions | `OrganizationScope` consumed read-only; no field removed/narrowed. Two new exports are additive. | None | — |
| — | 7. API Route URLs | No URL/response-shape change; only a `200 → 403` behavioral change for the attack precondition. | None | Document as security behavior change. |

No Critical or Warning BC violations. All 13 surfaces checked: auto-discovery (n/a), types (additive), signatures (stable), import paths (additive new files), event IDs (n/a), spot IDs (n/a), API URLs (behavior-only), DB schema (n/a), DI names (n/a), ACL features (n/a), notification IDs (n/a), CLI commands (n/a), generated files (n/a).

### Missing BC Section
Spec includes a "Migration & Compatibility" section that correctly classifies the change as a permitted security-hardening behavior change. **Adequate.** Recommend it explicitly name the Pattern C contract (see Gap G1).

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Integration Test Coverage | Present but light on the Pattern C dimension | Add a scenario asserting a Pattern C path (e.g. `sales.quotes.convert_to_order` via `/api/sales/quotes/accept`) is unaffected and a CRUD-factory path (people update) is denied for the floating restricted user. |

All other required sections (TLDR, Overview, Problem, Proposed Solution, Architecture, Data Models, API Contracts, UI/UX, Risks, Phasing, Implementation Plan, Final Compliance Report, Changelog) are present.

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Proposed Solution §2 (write path) | Does not state that the legacy fallback is load-bearing for ~40 Pattern C call sites, nor that #2239 closure for those depends on `selectedOrganizationId` | Add the Pattern C contract note (G1) so implementers don't mistakenly switch absent-scope to deny and break system/worker/checkout flows. |
| Testing Strategy | No explicit "allow-path unchanged" regression assertion | Per `.ai/lessons.md` ("preserve exact RBAC inclusion semantics"), add a test proving restricted-in-scope and super-admin still succeed. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| None | — | — |

Verified compliant:
- **`packages/shared/AGENTS.md` — no core/domain imports from shared.** The primitive predicate `isOrganizationAccessAllowed` takes plain `string[]`/`boolean`/`string` args; the `OrganizationScope`-typed read guard correctly lives in `packages/core/src/modules/directory`, not shared. ✅
- **No `any`.** Predicate and guard use explicit types. ✅
- **`requireFeatures` over `requireRoles`** (lessons.md): no role-name checks introduced; uses immutable org-id membership. ✅
- **Writes via commands / shared guards** (`packages/core/AGENTS.md`): no new write path; guards centralized rather than copy-pasted. ✅
- **i18n**: reuses existing `customers.errors.access_denied`; shared `CrudHttpError(403, { error: 'Forbidden' })` matches existing internal contract surface (not a translatable user string in shared). ✅
- **DS / UI / encryption / cache / events**: n/a — no UI, no entities, no events, no cache changes. ✅

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Over-denial via switching absent-scope to deny | If an implementer "tidies up" by making `organizationScope == null` deny, ~40 Pattern C sites (checkout payment subscribers, scheduler workers, messages, inbox_ops, enterprise security, `feature_toggles` CLI, notifications) — many system/worker contexts with no user — would break, including payment and scheduled-command flows. | Spec MUST pin the legacy fallback for absent scope (G1). Add unit test: `organizationScope=null` ⇒ legacy `currentOrg` behavior, not deny. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| #2239 not closed for Pattern C user-facing routes | A floating restricted user hitting a Pattern C *user* route (e.g. `customers/api/people/[id]/companies/route.ts`, `sales/quotes/accept`) still relies on `selectedOrganizationId`, not the new `allowedIds` check. | These routes already guard `if (!selectedOrganizationId) return` and set `organizationIds: [selectedOrganizationId]`, and the upstream read guard (Phase 2) runs first. Document residual; open follow-up to migrate Pattern C user routes to populate real scope. |
| Allow-path regression for legitimately scoped users | A scoped user with `allowedIds=[orgA]` acting on an orgA record must still succeed. | Mandatory regression test (lessons.md rule). |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Unaudited fail-open copy outside `packages/**`/`apps/**` | A guard with the same pattern in an unsearched location stays open. | Audit covered both trees; only the 10 listed `size && !has` deny guards found. Predicate makes future fixes one-line. |
| `entity-roles-factory` behavior shift | Refactoring `collectAllowedOrganizationIds`/`ensureRouteOrganizationAccess` to the shared guard could subtly change which entity-role routes deny. | Keep allowed-set derivation identical; only flip empty-set to deny. Add a unit test for the factory guard. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- None.

### Important Gaps (Should Address — fold into spec before coding)
- **G1 — Pattern C contract**: Spec §Proposed Solution must state that `ensureOrganizationScope` keeps the legacy `currentOrg` fallback whenever `ctx.organizationScope` is `null`/absent, and that this branch is load-bearing for ~40 call sites (list them by module: messages, checkout, scheduler, inbox_ops, enterprise/security, workflows, notifications, feature_toggles CLI, customers people-companies link routes, sales quotes accept). The new restricted-`allowedIds` deny applies only when `organizationScope` is present.
- **G2 — #2239 closure scope statement**: Spec must explicitly say the central fix closes the hole for CRUD-factory (Pattern A) and explicit-`resolveOrganizationScopeForRequest` (Pattern B) command paths (incl. the named people update/delete example), and that Pattern C user routes remain on `selectedOrganizationId` pending the follow-up.
- **G3 — Follow-up issue**: Track "populate real `organizationScope` (or assert correct `selectedOrganizationId`) on Pattern C *user-facing* command routes" + the deferred WHERE-clause record-load scoping (Q2-b) as one or two follow-up issues, referenced from the spec.

### Nice-to-Have Gaps
- A short truth-table comment in the predicate file documenting the four decision cases.
- Consider exporting the predicate from a stable shared path and noting it in `BACKWARD_COMPATIBILITY.md` as a new STABLE function (additive) if third-party guards should reuse it.

## Remediation Plan

### Before Implementation (Must Do)
1. **Add G1 + G2 to the spec** (Pattern C contract + #2239 closure-scope statement). This prevents the High-risk over-denial mistake and sets correct expectations for what the central fix closes.
2. **Confirm Pattern A for the #2239 named example**: verify `customers/api/people/route.ts` update/delete dispatch through `makeCrudRoute` so `organizationScope` is populated (factory.ts:1251). Expected true; confirm during Phase 1.

### During Implementation (Add to Spec / Code)
1. Implement `isOrganizationAccessAllowed` predicate + unit truth-table test first.
2. Rewrite `ensureOrganizationScope`; keep absent-scope legacy fallback (G1). Unit tests MUST include: `organizationScope=null` ⇒ legacy behavior (not deny); restricted `allowedIds=[A]` + target B ⇒ 403; `allowedIds=null` ⇒ allow; superadmin ⇒ allow; `allowedIds=[A]` + target A ⇒ allow.
3. Add `assertOrganizationReadAccess`; migrate the 10 guards + `entity-roles-factory`; keep allowed-set derivation identical.
4. Add the allow-path regression integration test (scoped user succeeds, super-admin succeeds) alongside the deny tests.

### Post-Implementation (Follow Up)
1. Open G3 follow-up issue(s): Pattern C user-route scope population + deferred WHERE-clause single-record load scoping (Q2-b).
2. Re-audit `packages/enterprise/**` and any provider packages for the same `size && !has` guard once the shared helpers exist.

## Recommendation
**Ready to implement — after folding G1 and G2 into the spec** (small text additions; no architectural change). The design is sound, BC-clean, and AGENTS.md-compliant; the only real exposure is the over-denial trap, fully mitigated by pinning the absent-scope legacy fallback and the mandatory allow-path regression test.
