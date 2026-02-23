# SPEC-036: Application & Request Lifecycle Events

- **Date**: 2026-02-21
- **Status**: Implemented (backfilled spec)
- **Scope**: OSS
- **Related Changes**: `637dd8d8` (runtime lifecycle events), `04bf632f` / this patch (generator stability)

## TLDR
Add a formal runtime lifecycle event contract for application bootstrap and API request handling, emitted via the global event bus as best-effort observability hooks. This spec documents the event IDs, payloads, emission points, and integration coverage for both monorepo app runtime and standalone app template runtime.

## Overview
Runtime-level lifecycle events were added in code but not captured in a dedicated specification. This creates a documentation gap for platform-level consumers (subscribers, workflows, telemetry overlays) that need a stable contract.

This spec defines:
- Canonical lifecycle event IDs in shared runtime constants.
- Application bootstrap lifecycle emissions in app DI registration.
- Request lifecycle emissions in API catch-all route execution flow.
- Integration test coverage expectations for affected API and key UI paths.

## Problem Statement
Without a spec for these lifecycle events:
- Event consumers lack a versioned contract for IDs/payload shape.
- Future changes may silently break subscribers and observability integrations.
- Runtime behavior differences between app runtime and create-app template are undocumented.

## Proposed Solution
1. Standardize lifecycle event IDs in shared runtime constants:
   - `application.bootstrap.started`
   - `application.bootstrap.completed`
   - `application.bootstrap.failed`
   - `application.request.received`
   - `application.request.auth_resolved`
   - `application.request.authorization_denied`
   - `application.request.rate_limited`
   - `application.request.not_found`
   - `application.request.completed`
   - `application.request.failed`
2. Emit bootstrap lifecycle events from app `register(container)` with process-level idempotency guards.
3. Emit request lifecycle events from `src/app/api/[...slug]/route.ts` around routing/auth/rate-limit/handler execution boundaries.
4. Keep all lifecycle emits best-effort: failures must never block request handling.

## Architecture
### Components
- `packages/shared/src/lib/runtime/events.ts`
  - Declares canonical `applicationLifecycleEvents` map and `ApplicationLifecycleEventId` type.
- `apps/mercato/src/di.ts`
  - Emits bootstrap events (`started`, `completed`, `failed`) once per process per event kind.
- `apps/mercato/src/app/api/[...slug]/route.ts`
  - Emits request lifecycle events across request processing stages.
- `packages/create-app/template/src/di.ts`
  - Mirrors bootstrap lifecycle emission behavior for generated standalone apps.
- `packages/create-app/template/src/app/api/[...slug]/route.ts`
  - Mirrors request lifecycle behavior for generated standalone apps.

### Emission Semantics
- Event bus resolution order for requests:
  1. `getGlobalEventBus()`
  2. fallback `createRequestContainer().resolve('eventBus')`
- Emission API fallback:
  1. `eventBus.emit(...)`
  2. `eventBus.emitEvent(...)`
- All runtime lifecycle emits are non-fatal; errors are swallowed (or logged for bootstrap helper).

### App vs Template Note
- Main app route currently emits `application.request.rate_limited` when metadata-based rate limiting blocks a request.
- Template route currently does not include the metadata rate-limit branch and therefore does not emit `application.request.rate_limited` in that path.

## Data Models
No persistent entities or schema changes.

Runtime payload fields are structured records (`Record<string, unknown>`) with the following common fields:
- `requestId` (request events)
- `method` (request events)
- `pathname` (request events)
- `receivedAt` (request events)
- `durationMs` (terminal request events)
- `status` (where response is available)
- `userId`, `tenantId` (when auth context is resolved)
- `errorMessage` (failed terminal events)
- `source`, `emittedAt` (bootstrap events)

## API Contracts
### Affected API Paths
- `ALL /api/*` via `apps/mercato/src/app/api/[...slug]/route.ts`
- `ALL /api/*` via `packages/create-app/template/src/app/api/[...slug]/route.ts` in generated standalone apps

### Contract Impact
- HTTP request/response semantics are unchanged.
- Additional side-effect: lifecycle events are emitted during request processing.
- Emission is explicitly best-effort and must not change status codes or response bodies.

## Integration Coverage
### API Coverage (required)
1. `ALL /api/*` unknown route emits:
   - `application.request.received`
   - `application.request.not_found`
2. `ALL /api/*` protected route without permission emits:
   - `application.request.received`
   - `application.request.auth_resolved`
   - `application.request.authorization_denied`
3. `ALL /api/*` successful handler emits:
   - `application.request.received`
   - `application.request.auth_resolved`
   - `application.request.completed`
4. `ALL /api/*` handler throwing error emits:
   - `application.request.received`
   - `application.request.auth_resolved`
   - `application.request.failed`
5. Main app only: metadata rate-limited route emits `application.request.rate_limited` before early return.

### Application Bootstrap Coverage (required)
1. App DI register happy path emits:
   - `application.bootstrap.started`
   - `application.bootstrap.completed`
2. App DI register bootstrap failure emits:
   - `application.bootstrap.started`
   - `application.bootstrap.failed`
3. Repeated register calls in same process do not duplicate bootstrap emissions due to global idempotency keys.

### Key UI Path Coverage
- `N/A` for direct UI rendering changes.
- Indirect UI impact path to validate manually:
  - `apps/docs/docs/framework/events/overview.mdx` event listings stay aligned with runtime constants.
  - Any backend/event configuration UI using lifecycle event IDs remains compatible.

## Risks & Impact Review
1. **Risk**: Event storm on high-throughput APIs
   - Severity: Medium
   - Area: Event bus throughput / subscriber load
   - Mitigation: Keep subscribers lightweight; prefer persistent queue consumers for heavy processing.
   - Residual risk: Moderate in deployments with broad wildcard subscribers.

2. **Risk**: Payload drift between app and template runtimes
   - Severity: Medium
   - Area: Generated app behavior consistency
   - Mitigation: Keep shared helper patterns aligned and covered by integration tests for both surfaces.
   - Residual risk: Low-medium until parity tests are added.

3. **Risk**: Emission failure impacts request path
   - Severity: Low
   - Area: Runtime reliability
   - Mitigation: Best-effort emission with guarded error handling.
   - Residual risk: Low.

## Final Compliance Report
- Module isolation: PASS (no cross-module ORM relationships added).
- Tenant safety: PASS (auth/tenant context emitted as metadata only, no widening of access).
- API compatibility: PASS (no response contract changes).
- Spec completeness: PASS (includes TLDR, architecture, data model, API contract, risk review, compliance, changelog).
- Integration coverage declaration: PASS (all affected API paths and key UI paths listed).

## Changelog
- **2026-02-21**: Initial backfilled spec for runtime application/request lifecycle events introduced in codebase.
