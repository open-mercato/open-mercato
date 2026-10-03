# Customer task count badge

Source doc: .ai/specs/2026-10-03-customer-task-count-badge.md
Spec PR: #6885
Issue: #6068

## Goal and Scope

Make the existing profile task total count the same merged tasks as the compatibility list. Add one customers helper and use it in person/company overview APIs. Keep UI, data model, permissions and response shapes unchanged.

## Implementation Plan

### Phase 1: Accurate task totals

1.1 Add the scoped merged-task count helper with storage-mode, bridge and pagination regression coverage.
1.2 Wire both profile overview APIs and cover the missing badge count through route and tab tests.
1.3 Validate, review and publish the completed implementation.

## Risks

Compatibility mode reads adapter task identities to suppress bridged legacy links; memory is proportional to this set. Every read must retain entity, tenant and organization scope. Record any validation blocker here.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Accurate task totals

- [ ] 1.1 Add the scoped merged-task count helper with storage-mode, bridge and pagination regression coverage.
- [ ] 1.2 Wire both profile overview APIs and cover the missing badge count through route and tab tests.
- [ ] 1.3 Validate, review and publish the completed implementation.
