# SPEC: Protected Roles and Audit Log Interceptor Context Seam

## TL;DR
Prevent lockout in tenants by enforcing a minimum active holder floor constraint for critical roles (e.g. `'admin'`), and enable seamless audit log enrichment by allowing command interceptors to atomically contribute metadata.

## Overview
1. **Protected Roles**: Ensure that a tenant cannot drop below the configured minimum active holder count (e.g., 1 admin) due to user deletes, role updates, or user deactivations.
2. **Audit Seam**: Merge interceptor `beforeExecute` metadata `context` into `ActionLog.contextJson` with priority ordering and collision resolution.

## Proposed Changes

### Data Model
- Add `minActiveHolders` (column `min_active_holders`, `int not null default 0`) to `Role`.
- Migration `Migration20260728134212_auth` backfills live `admin` roles to `1`.

### API & Command Contracts
- `updateUserCommand` accepts `isConfirmed` payload field.
- Floor check asserts tenant isolation and pessimistic locks role rows inside user mutation transaction.

### Interceptor Metadata Context Precedence
- Merging order: `options.metadata.context` -> `interceptorContexts` -> `logMeta.context`.
