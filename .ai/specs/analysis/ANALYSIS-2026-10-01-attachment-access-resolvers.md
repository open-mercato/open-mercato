# Pre-Implementation Analysis: Attachment Access Resolvers

## Executive Summary

The proposed extension, durable protection and Documents adopter form one requested capability. The initial full draft needs the three security clarifications below before implementation. Human Emergency Security Exception acknowledgment remains a before-merge requirement, not permission to write reviewable code.

## Backward Compatibility

| Surface | Assessment |
| --- | --- |
| 1. Discovery | Additive convention/plugin; existing conventions unchanged. |
| 2. Types | Additive types/optional property; no removed required fields. |
| 3. Signatures | Preserve core check and service inputs; optional constructor dependencies. |
| 4. Imports | Existing paths remain; new core domain exports. |
| 5. Events | No identifier/payload change; existing side effects retained. |
| 6. Widgets | No change. |
| 7. HTTP | Intentional Documents access tightening; named-human security waiver required before merge. Success shapes and paths unchanged. |
| 8. Database | Additive nullable JSONB plus historical backfill; review snapshot and SQL. |
| 9. DI | Existing keys preserved. |
| 10. ACL | Existing features reused, no rename. |
| 11. Notifications | No change. |
| 12. AI/tool/override IDs | No change. Existing service consumers inherit policy. |
| 13. CLI | Existing commands/signatures unchanged. |
| 14. Generated contracts | Additive output/registration; no BootstrapData field change. |

Migration/BC section exists with explicit upgrade, disabled-on-upgrade protection and rollback limitations. The current repository has 14 categories; all were checked despite the installed analysis template's older count.

## Spec Completeness

All required design, failure, risk, delivery, coverage and compliance sections are present. No new UI design is needed. Three security details below need clarification.

## AGENTS.md Compliance

Uses module generator plugins, core domain types, DI, current RBAC, Documents-owned queries, existing guards and side effects. No peer ORM relation, new dependency, app-source edits or developer database migration. Logs require telemetry reporting with no provider payload leakage. Public partition requirements are not browser-editable. Test classification must include any cross-package audit in the existing manifest.

## Risk Assessment

### High Risks

- Durable requirements must survive disabled providers and cannot be satisfied by another wildcard resolver.
- Metadata pagination, totals, tags and assignment labels can disclose records omitted from items.
- Reassignment authorization and writes can race without row locking or equivalent atomic verification.
- Legacy assignment normalization must match actual supported data shapes.

### Medium Risks

- Exact authorized counts scan candidates; batches/cache/time budget bound resource cost, with no claimed measurements yet.
- PR #6820 overlaps handlers/public exports and requires final conflict review.

## Gap Analysis

### Critical Gaps (Block Implementation Until Clarified)

1. **Legacy single-object assignment:** `normalizeAttachmentAssignments` accepts an object as one assignment. A migration that expands arrays only misses valid historical Documents ownership. Require equivalent array-or-single-object normalization, whitespace handling, malformed-owner denial and tests.
2. **Mutation check/write race:** snapshot checks before mutation do not alone prevent a concurrent owner/assignment update during an awaited resolver. Require row locking/reload in the mutation transaction, stable lock order for bulk operations, and no policy cache reuse across changed snapshots.
3. **Multi-owner metadata:** permitting any readable Documents target while serializing every assignment label reveals inaccessible document titles/IDs. Require every Documents target for metadata/export (and edits); bytes may retain any-viewable-target semantics. Test a shared file linked to a visible and hidden document.

### Important Gaps (Implementation Checks)

- Confirm declaration sync cannot flush unrelated pending rows and preserves concurrent additions.
- Preserve API-key actor UUID projection when calling Documents permissions; use its existing helper contract rather than trusting a prefixed subject as a user ID.
- List time budget must bound database work as well as callbacks and return no partial count.

## Remediation Plan

Before implementation, amend the spec with the three critical clarifications and obtain independent scope/security review. During implementation, capture regression failures, enforce the stated invariants at real host/service paths, and run the configured gate plus script classification. Do not interpret this analysis as a formal code review or human compatibility waiver.

## Recommendation

Needs the listed spec clarifications first; then ready for implementation with before-merge human waiver and validation gates still pending.

## Resolution Update

2026-10-01: The author amended the design to handle legacy single-object assignments, require locked transactional mutation snapshots, and require all Documents targets for metadata/export. The three critical design gaps are resolved. Recommendation: ready for implementation, pending independent scope review and the explicit before-merge human waiver. This is a design audit; runtime tests and formal code review remain outstanding.

Independent parent review subsequently found no scope/architecture blocker and requested explicit malformed-owner preservation, per-resolver cache namespaces and old-cache purge disclosure. Those clarifications are incorporated. Fresh-agent capacity was unavailable; this bounded independent design inspection is not formal automated approval.
