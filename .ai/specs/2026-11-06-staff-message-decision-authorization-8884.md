# Staff leave decision authorization (#8884)

Status: implemented bug fix; locally verified, awaiting PR review and deployment.

The existing native accept/reject routes require `staff.leave_requests.manage`.
The owning commands must enforce that same permission when generic message actions
invoke them. `messages.actions` authorizes acting on a message, not deciding leave.

## Implementation

Both decision handlers check the authenticated command principal through the native
wildcard-aware `rbacService.userHasAllFeatures`, using the context tenant and selected
organization. API-key subjects remain `api_key:<id>`; an owner's identity, payload
features, role names and decision attribution cannot substitute for the principal.
Missing auth/scope or grants deny before business reads or writes. RBAC failures
abort without mutation. Existing recipient checks, command allowlists, mutation
guards, tenant/organization checks, pending status checks and planner effects remain.
Staff stays optional; messages takes no dependency on staff internals.

## Migration & Backward Compatibility

Command IDs, feature IDs, input/output shapes, routes and database schema are unchanged.
This corrects enforcement of the existing staff permission; it introduces no new
permission or shape. Message recipients without `staff.leave_requests.manage` can
no longer approve/reject leave. Clients should handle the existing 403 and keep the
action available for an authorized manager. Operators should grant the existing
feature only to intended decision makers through scoped custom role/user ACLs.
`staff.*` and `*` retain native wildcard semantics. API keys use their own effective
ACL, including delegated restrictions. No data migration or credential rotation is
required. Previously unauthorized finalized decisions are not retroactively undone;
operators should audit them. No compatibility bypass or emergency waiver is proposed.

## Regression coverage

- Command tests: deny ordinary recipients and forged payload/auth grant hints;
  fail closed without auth/scope/RBAC; preserve wildcard/custom role checks,
  API-key principal identity, scoped reads and successful planner effects.
- Self-contained API tests: create a custom role/user, own pending request and
  self-addressed message; exercise both native and message refusals, retryability,
  unchanged request/planner/completed-action state, ordinary acknowledgment,
  explicit/wildcard managers and foreign tenant/organization denial. Clean fixtures.
- Existing message recipient, allowlist, terminal concurrency and mutation guard tests.
- Local verification: 69 focused Jest tests pass; all 16 isolated API cases pass
  in 23.9 seconds, including native API-key ACL checks.

## Enterprise mutation compatibility

With enterprise record locking enabled, post-mutation cleanup must not query human lock ownership using an API-key subject. API keys cannot own user locks, so their successful mutations skip only the user-lock release operation; authorization, optimistic-lock validation, competing-lock checks and notification handling remain active. A record-lock service regression and the existing API-key accept/reject cases cover this production-mode path.

## Changelog

- 2026-11-06: Document existing permission enforcement at the owning command boundary.

- 2026-11-10: source re-review replaces the new permission guard's raw HTTP error with the shared forbidden helper; scoped authorization and translated403 body remain identical.

## Native decision version guard

Complex QA with two distinct scoped managers found that accept/reject's existing `staff.leave_request` mutation-guard key had no optimistic-lock reader: generic CRUD registration uses canonical `staff.leave.request`. Staff DI now registers a scoped `StaffLeaveRequest` reader for the existing custom-route key before requests run. Stable resource-kind strings, generic message-header scope, API shapes and no-header clients are unchanged; stale native decision headers receive the existing structured409 before any mutation. Unit coverage proves reader lookup/scoping without importing a CRUD route; the native API regression covers stale refusal and a fresh-version successful control for both decisions.

- 2026-11-10: repair the native decision reader registration discovered by actual second-actor browserQA; retain both the source authorization fix and command/guard side effects.
