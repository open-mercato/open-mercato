# Pre-implementation analysis: access log durability and retention

**Specification:** `.ai/specs/2026-08-21-access-log-durability-retention.md`

**Date:** 2026-08-21
**Verdict:** Ready for implementation with the constraints below.

## Existing implementation

- `AccessLogService` already supports encrypted single and batched inserts, list queries and an in-flight flush registry.
- The CRUD factory is the main access-log call site. It already passes authenticated tenant, organization, actor, resource IDs, selected fields, result count and path.
- CRUD logging is asynchronous unless `OM_CRUD_ACCESS_LOG_BLOCKING=1`; both modes currently swallow write failures.
- Rotation runs inside `AccessLogService` after successful writes. Defaults are seven days for `auth.user` and `auth.role`, and eight hours for other resources.
- Action logs already have a tenant-scoped CSV export. Access logs only have a list route.
- `getClientIp` already implements trusted-proxy-depth handling and must be reused.
- Scheduler registration and bounded continuation workers already have reference implementations in `payment_gateways`.

## Placement decision

This is a Core modification, not an external extension.

- Generic access logging, retention and CSV export belong in MIT Core `audit_logs`.
- Shared request-context extraction belongs in the existing shared CRUD logger.
- No Enterprise package dependency is introduced.
- Future evidence packaging and AI trace export may extend this floor from Enterprise without changing the Core contracts.

The primary risk is added read latency from blocking audit writes. This is accepted because an unaudited successful response would violate the control. Existing batch insertion keeps the cost bounded.

## Contract audit

| Contract surface | Change | Compatibility |
|---|---|---|
| `AccessLogService` | Add retention method; keep existing methods | Additive |
| CRUD logging configuration | Default becomes blocking; explicit async opt-out added | Behavioral hardening; documented |
| Access-log context JSON | Add normalized keys | Additive |
| API routes | Add access export route | Additive |
| Worker discovery | Add worker file | Additive |
| Module setup | Add optional scheduler registration | Additive; module works without scheduler |
| Environment variables | Add new names; retain old names temporarily | Backward compatible |
| Database schema | No change | Compatible |

No frozen route, event, ACL, DI or schema identifier is removed or renamed.

## Required implementation constraints

1. Blocking mode must await the original write promise and rethrow failures. Logging-only catch handlers may observe the promise but must not replace it with a resolved promise.
2. Source IP must be `null` unless trusted proxy depth is positive and the forwarded chain satisfies it.
3. The retention service must require explicit tenant scope for scheduled jobs and may accept an organization narrowing filter. Global CLI cleanup must require an explicit `--all-scopes` flag.
4. Retention queries must be parameterized, bounded and retry-safe. A continuation job is enqueued only after a full deletion batch.
5. Dry-run must not mutate data or enqueue continuation jobs.
6. Retention days below 90 must be rejected. Existing short defaults must not remain effective.
7. The optional scheduler dependency must be resolved defensively. Its absence cannot break tenant setup or logging.
8. Export must apply the same tenant, organization and actor rules as the list route.
9. Existing encrypted `context_json` handling must remain intact.
10. App environment example changes must be mirrored in the create-app template.

## Test coverage required before commit

- Shared unit tests: blocking default, explicit async mode, write failure propagation, request context and trusted proxy behavior.
- Core unit tests: retention floor, scope predicates, dry-run, bounded delete and continuation condition.
- Core route tests: access export authentication, tenant scope and CSV columns.
- Worker tests: invalid/unscoped job rejection and idempotent execution.
- Module-local Playwright integration test: generate a real CRUD access, verify normalized fields, export the row and confirm tenant scope cannot be widened.
- Generation, targeted tests, typecheck and relevant package builds.

## Final assessment

The design reuses existing services and framework contracts, does not create cross-module ORM coupling, and has a clear rollback path through explicit async mode. Implementation may proceed.
