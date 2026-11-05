# Pre-Implementation Analysis: Consolidated Feature Policy and Nulled ACL Denials

## Executive Summary

The specification is ready to implement. It is a high-risk authorization change across several packages, but it introduces no database, route, DI-key, feature-ID, or import-path removal. The intentional browser/JWT feature-array semantic change is covered by an explicit compatibility section, upgrade documentation, concrete-payload regression tests, and a fail-closed projection.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | API/JWT response behavior | Existing `grantedFeatures` and `resolvedFeatures` arrays keep their types but replace wildcard values with concrete effective IDs | Warning | Retain field names and schemas; document the semantic change in the spec, `BACKWARD_COMPATIBILITY.md`, and `UPGRADE_NOTES.md`; add integration assertions |
| 2 | RBAC behavior | Nulled feature overrides newly deny existing explicit/wildcard/admin grants | Warning | Treat as the approved security behavior; retain stored grants and document that removing the override restores them |

All 13 protected contract categories were checked. There are no changes to auto-discovery conventions, required type fields, existing required function parameters, import paths, event IDs, widget spot IDs, route URLs, database schema, DI service names, declared ACL IDs, notification IDs, CLI commands, or generated export contracts.

### Missing BC Section

None. The specification includes a Migration & Backward Compatibility section.

## Spec Completeness

### Missing Sections

None. Non-applicable data-model/UI sections explicitly state that no schema or new UI is introduced.

### Incomplete Sections

None blocking. Implementation must update the status table and final review result as phases complete.

## AGENTS.md Compliance

### Violations

No blocking violations found.

| Rule | Location | Fix |
|------|----------|-----|
| Shared package must remain domain-independent | Shared policy | Import only shared registry/override/matcher modules; enforce through package build |
| App/template module registries stay aligned | Null probe fixture | Apply identical override changes to both registries and run `yarn template:sync` |
| Server ACL checks must be wildcard-aware | Audited consumers | Route all authoritative checks through the policy or realm services |
| Customer portal auth semantics require explicit approval | Whole change | The user explicitly requested and confirmed the core implementation |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missed secondary gate | Removed feature remains usable through one runtime | Repository-wide audit, consumer migration, architectural test |
| Incomplete concrete catalog | Admin/portal UI loses valid capabilities | Include ACL, customer defaults, and portal route requirements; assert non-empty projections |
| Authorization ordering regression | Admin bypass runs before removal/scope | One shared policy with order-specific unit tests |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| External wildcard consumers | Existing client code stops detecting `*` | Preserve response fields, document concrete semantics, upgrade note |
| Registry unavailable | Wildcard projection cannot resolve | Fail closed for wildcards and retain explicit grants |
| Broad package edits | Type/build regressions across modules | Phase changes, targeted tests, full validation gate |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Larger capability payloads | More browser/JWT bytes for unrestricted principals | Stable deduplication and representative tests |
| Existing raw ACL cache | Stale storage values remain cached | Policy executes after raw load; no policy result is persisted |

## Gap Analysis

### Critical Gaps (Block Implementation)

None.

### Important Gaps (Should Address)

- The architectural allowlist must distinguish browser/ACL-editor matching from authoritative server matching.
- Portal effective-feature tests must prove the set is non-empty, not merely that a denied ID is absent.
- Staff and customer service tests must cover both explicit literal and unrestricted grants.

### Nice-to-Have Gaps

- Record representative staff/portal effective feature counts during tests for future payload monitoring.

## Remediation Plan

### Before Implementation (Must Do)

1. Create the pending OSS spec with compatibility and integration sections.
2. Preserve existing raw ACL loading and DI contracts.
3. Define the shared policy as domain-independent infrastructure.

### During Implementation (Add to Spec)

1. Track phase completion and exact validation results.
2. Record any audited raw ACL matcher retained by an explicit allowlist.
3. Update guides to establish the policy/service boundary.

### Post-Implementation (Follow Up)

1. Move the spec to `implemented/` only after deployment evidence exists.

## Recommendation

Ready to implement.
