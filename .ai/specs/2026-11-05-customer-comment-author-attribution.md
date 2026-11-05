# Customer comment update attribution (#8759)

Status: implemented candidate; blocked on security-exception approval and validation.

## TLDR and Overview

Preserve customer note authors during ordinary body editing. Only an authenticated non-API-key superadmin may explicitly change attribution. This is a focused correction to the existing update command, with no startup, configuration, architecture or database changes.

## Problem Statement

`PUT /api/customers/comments` dispatches `customers.comments.update`. Unlike creation, update accepted caller-selected attribution without checking actor privilege. Activity-management permission must continue to permit body editing without allowing impersonation.

## Proposed Solution and Architecture

Keep the existing API-to-command dispatch, tenant and organization guards, audit/indexing side effects and undo snapshots. Ignore author input for ordinary actors and API keys, including keys whose context has superadmin privileges. Omission always preserves the persisted author, including null and historical/offboarded users. Do not normalize omission to the editor.

For non-key superadmins, an explicit UUID changes attribution and explicit null clears it. Validate a changed non-null target through the existing encrypted query helper, with a tenant and non-deleted predicate, and the comment scope for decryption, before modifying any scalar. A user with a different home organization in the same tenant remains a valid target, following the established customer user-reference rules. Resending the current author preserves historical attribution without requiring an active user.

## Data Models and API Contracts

No entity or response changes. PUT retains `{ ok: true }` and `customers.activities.manage`. The update validator additively accepts `authorUserId: null`; create validation is unchanged. Ordinary callers' author fields are ignored while authorized body edits succeed. An invalid newly assigned privileged author returns the existing localized user-not-found error with status 400. Target scope is the persisted comment scope, never a submitted scope.

## Migration & Backward Compatibility

The STABLE command/API author-update behavior is intentionally narrowed. Clients using ordinary users or API keys for reassignment must omit `authorUserId` for body edits and use an explicitly authorized non-key superadmin session for intentional corrections. Existing author data is not rewritten. Operators must review prior attribution against independent records; existing history cannot prove which attribution changes were legitimate.

Keeping the old unauthorized assignment behind an alias, toggle or bridge would retain the vulnerability itself. This qualifies for consideration under the Emergency Security Exception, but **the exception is not approved**. Before merge, a named human maintainer must acknowledge waiving steps 1–3, and a dated entry must be added to `BACKWARD_COMPATIBILITY.md` describing this STABLE surface, argument and migration path. That file is outside this task's authorized scope. The UPGRADE_NOTES entry is supplied; neither automated review nor an automerge label replaces human approval.

## Implementation and Coverage

1. Guard only the update author assignment and validate changed privileged targets before scalar mutation.
2. Command regressions cover ordinary actors, API keys, key/superadmin contexts, omission, null authors, scoped privileged changes, invalid/deleted/foreign targets, tenant/org denial, snapshots and undo.
3. Route mapping regressions cover explicit/omitted/null author intent, unchanged permissions and response. Extend `TC-UNDO-001-comments.spec.ts` to exercise PUT plus list readback and undo/redo attribution using self-created person/comment fixtures and cleanup.

## Risks & Impact Review

- High: retaining the vulnerable path as a compatibility bridge permits continued impersonation; no bridge is proposed, and merge remains blocked pending named approval.
- Medium: accidentally normalizing omitted author to editor corrupts attribution; explicit omission regressions cover ordinary, key and privileged contexts.
- Medium: privileged cross-scope assignment links unrelated users; changed targets require active same-tenant users before writes.
- Medium: historical attribution may already be unreliable; no speculative data repair is attempted. Operators review independently.

## Final Compliance Report

Focused customers-only implementation; no schema migration, dependency, discovery registration or UI changes. Existing mutation lifecycle and undo stay intact. Compatibility waiver and ledger entry remain open, so this candidate must not merge. Runtime integration and full-gate results are recorded in the PR, including environment limits.

## Changelog

- 2026-11-05: Documented guarded update semantics, migration, regressions and unresolved human compatibility gate.
