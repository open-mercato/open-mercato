# Access log durability and retention

## TLDR

Open Mercato will record CRUD data access with a complete request context and will wait for the audit write before returning the business response. Access logs will be retained for at least 90 days by default. Cleanup moves out of the request path into an idempotent queue worker and an operator CLI that supports `--dry-run` and tenant or organization scope.

This specification covers access logs in the MIT Core `audit_logs` module. Unified evidence packages and tamper-evidence are separate work.

## Overview

The existing access log captures actor, tenant, organization, resource, access type, selected fields, path and result count. Writes are asynchronous by default and failures are swallowed. Cleanup runs after writes and defaults to seven days for selected resources and eight hours for other resources.

The change makes the existing mechanism suitable for security audit evidence without introducing a second logging system.

## Problem Statement

- A successful read response can be returned before its access log is durable.
- Failed asynchronous writes are logged but do not fail the request.
- Request context lacks a normalized source IP, user agent, request ID, session ID, HTTP method and response outcome.
- Forwarded IP headers cannot be trusted without the configured proxy depth.
- Current retention defaults are shorter than 90 days.
- Cleanup in the write path adds latency and is neither operator-controlled nor available as a dry run.

## Proposed Solution

1. Make access-log writes blocking by default. An explicit compatibility setting may retain best-effort asynchronous mode for low-assurance deployments.
2. Build normalized request context in the shared CRUD access logger:
   - `sourceIp`, derived with the existing trusted-proxy helper;
   - `userAgent`;
   - `requestId`, accepting `x-request-id` or generating a UUID;
   - `sessionId` from the verified authentication context;
   - `method`, `path`, `operation`, `result`, `statusCode`, and `resultCount`.
3. Set access-log retention to 90 days by default. Configuration may increase the period but values below 90 days are rejected or clamped.
4. Remove automatic deletion from `AccessLogService.log()` and `logMany()`.
5. Add a bounded, idempotent retention service operation, a queue worker and a CLI command with dry-run and scope filters.
6. Add a tenant-scoped access-log CSV export using the existing audit permissions and export helpers.

### Design Decisions

| Decision | Rationale |
|---|---|
| Modify the MIT Core `audit_logs` module | Every deployment needs the same audit floor. Enterprise code may add evidence packaging later. |
| Blocking write is the default | An audit record must not be silently lost after a successful response. |
| Reuse `getClientIp` and configured trusted-proxy depth | Prevents spoofed forwarded headers from becoming audit evidence. |
| Cleanup uses the queue worker contract | Removes deletion work from requests and supports retries without a custom scheduler loop. |
| Minimum retention is 90 days | A lower value would break the assurance this control is intended to provide. |
| Access export is a separate additive route | Keeps the existing action export contract unchanged. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Fire-and-forget writes | Process exit or a failed write can lose evidence after the response succeeds. |
| Delete old rows after every access write | Adds request latency, couples availability to cleanup and has no dry-run. |
| Trust the first `x-forwarded-for` value | A client can spoof it when proxy trust is not configured. |
| Add a second security log table | Duplicates the existing access-log model and creates two incomplete sources. |

## Architecture

```text
HTTP CRUD read
  -> authenticated CRUD handler
  -> normalized access context
  -> AccessLogService.logMany()
  -> durable database insert
  -> business response

scheduler / operator CLI
  -> audit_logs.retention queue
  -> bounded scoped delete or dry-run count
```

The scheduler is optional. If it is unavailable, logging continues and the operator can invoke the CLI. Missing cleanup increases storage use but never removes audit evidence prematurely.

## Data Models

No new access-log columns are required. Request metadata remains in the encrypted `context_json` field. Existing tenant, organization, actor, resource and timestamp columns remain unchanged.

The scheduled retention query is scoped by `tenant_id` and may be narrowed to `organization_id` for manual runs. It processes rows older than the resolved cutoff in bounded batches ordered by `created_at` and `id`.

## API Contracts

### Access log list

The existing `GET /api/audit_logs/audit-logs/access` response remains backward compatible. Its `context` object may contain these additive keys:

- `sourceIp: string | null`
- `userAgent: string | null`
- `requestId: string`
- `sessionId: string | null`
- `method: string`
- `path: string`
- `operation: string`
- `result: "success" | "failure"`
- `statusCode: number`
- `resultCount: number`

### Access log export

`GET /api/audit_logs/audit-logs/access/export`

- Authentication: required.
- Feature: `audit_logs.view_self`; `audit_logs.view_tenant` may widen actor and organization filters inside the resolved tenant.
- Filters: the same scope, actor, resource, access type, `before`, `after`, and `limit` rules as the list route.
- Response: CSV attachment containing normalized scope, actor, resource, operation, request context and timestamp fields.
- Limit: 1000 rows per request.

## Configuration

- `OM_CRUD_ACCESS_LOG_MODE=blocking|async`, default `blocking`.
- `AUDIT_LOGS_RETENTION_DAYS`, default `90`, minimum `90`.
- `AUDIT_LOGS_RETENTION_BATCH_SIZE`, default `1000`, maximum `10000`.
- Trusted proxy depth reuses the existing rate-limiter configuration and `getClientIp` helper.

Legacy `AUDIT_LOGS_CORE_RETENTION_DAYS` and `AUDIT_LOGS_NON_CORE_RETENTION_HOURS` remain accepted as deprecated input for one minor release, but cannot reduce retention below 90 days.

## Migration & Backward Compatibility

- Existing rows and columns remain unchanged.
- The list route and current action-log export route remain unchanged.
- The new access export route is additive.
- `AccessLogService` keeps its current public methods. New retention methods are additive.
- Asynchronous CRUD logging remains available only through explicit configuration.
- Existing short-retention variables remain accepted with a 90-day floor and deprecation guidance.
- No database migration is required.

## Implementation Plan

1. Add request-context normalization and unit tests in the shared CRUD logger.
2. Make blocking persistence the default and propagate write failures.
3. Replace write-path rotation with bounded retention methods.
4. Add retention worker, scheduler registration and CLI dry-run.
5. Add tenant-scoped access export and route tests.
6. Add a self-contained integration test that reads a fixture through CRUD, verifies request fields, and exports the same scoped row.
7. Update environment examples and audit-log documentation.

## Testing Strategy

- Unit tests for trusted and untrusted proxy headers, request ID, session ID, method/path/result metadata and blocking failure propagation.
- Unit tests for the 90-day floor, tenant and organization filters, batch bounds, dry-run and idempotent retries.
- Route tests for access export authorization, tenant scope and CSV fields.
- Worker tests for dry-run and deletion modes.
- Integration test in `packages/core/src/modules/audit_logs/__integration__/` using API-created fixtures and cleanup in `finally`.
- Run the relevant Core, Shared and Queue test suites, `yarn generate`, typecheck and build.

## Risks & Impact Review

#### Audit insert failure blocks a read
- **Scenario**: The audit table or database is unavailable during a CRUD read.
- **Severity**: High
- **Affected area**: CRUD list and detail APIs with access logging.
- **Mitigation**: Blocking is intentional for the secure default; the error is visible to monitoring and the caller does not receive an unaudited successful response. Explicit async mode remains for low-assurance deployments.
- **Residual risk**: Database latency is added to reads.

#### Spoofed source IP
- **Scenario**: A client sends forged forwarded headers.
- **Severity**: High
- **Affected area**: Access-log evidence.
- **Mitigation**: Resolve IP only through `getClientIp` and configured trusted-proxy depth. Record `null` when the chain cannot be trusted.
- **Residual risk**: Incorrect operator proxy configuration can still produce incomplete evidence.

#### Retention deletes the wrong tenant's rows
- **Scenario**: A broad or malformed cleanup job omits scope.
- **Severity**: Critical
- **Affected area**: Audit evidence across tenants.
- **Mitigation**: Scheduled jobs carry server-derived tenant scope, service inputs are validated, deletes are bounded and dry-run reports counts before manual execution. Cross-tenant runs require an explicit CLI all-scope flag.
- **Residual risk**: A superadmin can intentionally invoke a global cleanup.

#### Cleanup backlog grows storage
- **Scenario**: The optional scheduler or worker is not running.
- **Severity**: Medium
- **Affected area**: Database storage and query performance.
- **Mitigation**: Logging remains correct; CLI cleanup is available; indexes support cutoff scans; monitoring logs the deleted or pending count.
- **Residual risk**: Operator action is required when no scheduler is installed.

#### Blocking writes reduce throughput
- **Scenario**: High-volume list reads create many access rows.
- **Severity**: Medium
- **Affected area**: CRUD read latency and database write load.
- **Mitigation**: Keep the existing bounded batch insert, deduplicate resource IDs and cap result page sizes.
- **Residual risk**: Secure logging has an unavoidable write cost.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root | Preserve tenant and organization scope | Compliant | Retention and export are explicitly scoped. |
| root | Use the queue package for workers | Compliant | Cleanup uses the discovered worker contract. |
| core | Preserve API and service contracts | Compliant | Existing routes and methods remain; additions are optional. |
| core | Export OpenAPI metadata | Compliant | The new export route will declare metadata and `openApi`. |
| core | Use encryption maps and helpers | Compliant | Request context stays in the existing encrypted field. |
| queue | Worker must be idempotent and bounded | Compliant | Cutoff deletion is retry-safe and batch-limited. |
| QA | Integration fixtures must be self-contained | Compliant | Test creates and removes its own data. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Additive context keys use the existing JSON field. |
| API contracts match UI | Pass | No UI change is required. |
| Risks cover write and delete operations | Pass | Insert failure, spoofing, scope and cleanup risks are covered. |
| Commands defined for mutations | N/A | Append-only audit writes and retention maintenance are operational logs, not undoable domain mutations. |
| Cache strategy covers reads | N/A | Audit reads are uncached to avoid stale evidence. |

### Non-Compliant Items

None identified in the design.

### Verdict

Fully compliant: approved for implementation.

## Implementation Review

Implemented in MIT Core with no database migration or new production dependency.

- CRUD access writes are blocking by default and propagate persistence failures.
- Request context records the trusted source IP, user agent, request and session identifiers, method, path, operation, result and status.
- Retention is separated from writes, enforces a 90-day floor, and runs in bounded tenant-scoped batches through a worker or CLI dry run.
- Access logs have a scoped CSV export and a `resourceId` list filter.
- Existing tenant and organization scope rules remain unchanged.

Validation completed:

- targeted Shared and Core unit tests passed;
- `yarn generate` passed;
- Shared and Core package builds passed;
- lint passed with existing application warnings and no errors;
- `yarn test:integration:ephemeral TC-AUD-010` passed against a fresh isolated database and application build;
- the full repository typecheck remains blocked by the pre-existing Redis constructor overload error in `packages/shared/src/lib/ratelimit/service.ts:25`.

## Changelog

### 2026-08-21

- Initial specification for durable access logging, 90-day minimum retention, controlled cleanup and access-log export.
- Review: security passed; performance passed with bounded batch inserts and cleanup; cache N/A; commands N/A; risks passed; verdict approved.
- Implemented and verified durable request-context logging, bounded retention, worker/CLI execution and scoped CSV export.
