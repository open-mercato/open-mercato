# Enforce current privilege ceilings on staff and ACL changes

## Goal

Require the current target to be within the acting principal's grant ceiling before staff identity changes and ACL replacement.

## Scope

Staff user update and delete and the user-ACL and role-ACL update commands. Reuse the existing transaction-bound grant checks and authorization-state locks.

## Implementation Plan

Check the target's current roles and direct ACL at the staff mutation boundary. Check the stored ACL before a replacement mutates it. Add defensive integration tests for denied and permitted actors and document the existing forbidden response.

## Risks

Security-sensitive permission checks. Verify current grants inside the write transaction. Retain existing system invocation and self-service behavior where appropriate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Current target authority

- [ ] 1.1 Gate staff identity changes and ACL replacement.
- [ ] 1.2 Cover the permission boundaries and add upgrade documentation.
- [ ] 1.3 Validate and review the patch.
