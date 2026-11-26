# Audit logs: check `view_tenant` against the organization being read

## Goal

`audit_logs.view_tenant` widens a read to other actors' rows only when the caller holds it for the organization the query reads.

## Scope

- `packages/core/src/modules/audit_logs/api/audit-logs/readScope.ts`: new `canViewTenantAuditLogs` helper.
- `actions`, `actions/export`, `access` routes: call the helper after `?organizationId=` narrowing.
- Unit tests with the real `RbacService` and real scope resolution; integration test for the three routes.
- `UPGRADE_NOTES.md` / `BACKWARD_COMPATIBILITY.md`: record the tightening.

## Non-goals

- No `ReadScope` work (spec PR #10631).
- No change to how API keys or roles are granted.
- No multi-organization reads in `ActionLogService` (#6337).
- No change to which organization is read, to status codes or to response shapes.

## Implementation Plan

### Phase 1: Route fix
1. Add `canViewTenantAuditLogs` and use it in the three routes, after narrowing.
2. Unit tests: restricted grant with and without a read organization; unrestricted grant unchanged.

### Phase 2: Coverage and notes
1. Integration test over the three routes.
2. Compatibility notes.

## Risks

- A caller whose `view_tenant` grant is limited to some organizations and who reads without an organization now gets its own rows only; it selects an organization with `?organizationId=` to see other actors there. Intended.
- One extra RBAC resolution for reads without an organization by a non-superadmin `view_tenant` holder.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Route fix

- [x] 1.1 Add the helper and use it in the three routes — 391e872f38
- [x] 1.2 Unit tests — ce69aa9457

### Phase 2: Coverage and notes

- [x] 2.1 Integration test — ef86f3b684
- [x] 2.2 Compatibility notes — 846a75f4aa
