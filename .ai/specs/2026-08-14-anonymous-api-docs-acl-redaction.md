# Anonymous API Docs ACL Redaction

## 📝 TLDR

Keep `/api/docs/openapi` and `/api/docs/markdown` publicly reachable while omitting internal ACL feature and role identifiers for anonymous callers. Authenticated staff retain the complete document, and caller-dependent responses are never shared-cacheable.

## 📝 Problem Statement

The public API documentation exports currently publish verbatim `requireFeatures` and `requireRoles` metadata. This reveals deployment-specific authorization vocabulary to anonymous clients even though those identifiers are unnecessary for understanding whether an operation requires authentication.

## 📝 Proposed Solution

Add an additive, default-preserving `includeAccessControlMetadata` document-builder option. The API-docs routes resolve the caller and disable ACL metadata only for anonymous or unresolvable sessions, while the server-rendered Explorer forwards cookies only to the exact serving origin.

## 📝 Overview

The feature changes disclosure, not authorization. Both export routes remain public and continue documenting every enabled operation, schema, example, authentication requirement, and security scheme. Only the verbatim `Requires features: …` / `Requires roles: …` description lines and `x-require-features` / `x-require-roles` extensions vary by caller.

The [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.1.html#specification-extensions) permits application-defined `x-` extensions but does not require their public disclosure. Open Mercato therefore treats its ACL extensions as staff metadata. The response uses `Cache-Control: no-store`, consistent with [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5), because the representation depends on caller authentication.

### Scope boundaries

- Keep `/api/docs/openapi` and `/api/docs/markdown` unauthenticated and publicly reachable.
- Preserve `x-require-auth`, OpenAPI `security`, and inferred `401` responses for anonymous callers.
- Do not add an `api_docs.view` ACL feature, alter tenant role grants, or change operation visibility.
- Do not change the backend API-docs resource page or introduce a new client-side authorization mechanism.

## 📝 Architecture

### Document generation

`buildOpenApiDocument` accepts `OpenApiDocumentOptions.includeAccessControlMetadata?: boolean`. It defaults to enabled by interpreting only an explicit `false` as redaction, so every existing caller keeps the current document byte-for-byte apart from unrelated nondeterminism.

When redaction is enabled, the builder omits both human-readable ACL description fragments and machine-readable ACL vendor extensions. Authentication metadata that does not reveal feature or role identifiers remains present.

### API-docs route boundary

`packages/core/src/modules/api_docs/lib/document.ts` owns the shared API-docs builder and caller policy. App and create-app template routes pass their generated `modules` and `apiRoutes` manifests into this builder; the helper does not resolve a second registry.

`shouldExposeAccessControlMetadata(req)` uses the established staff request-auth resolver. A missing session returns the redacted document. Auth resolution errors fail closed and also return the redacted document.

Both caller-dependent export routes set:

- `Cache-Control: no-store`
- `Vary: Cookie, Authorization`

### Explorer cookie forwarding

The `/docs/api` server component forwards the incoming cookie only when the configured export URL has the exact same origin as the serving request: scheme, host, and effective port must all match. A missing/invalid host, missing cookie, cross-host target, cross-port target, or protocol downgrade returns no forwarded cookie.

This is a server-side header attachment, so the application performs the origin check explicitly rather than relying on browser cookie protections. The Explorer remains a server component and its existing interactive Explorer component remains the only client island.

### Frontend architecture contract

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/docs/api` | `packages/core/src/modules/api_docs/frontend/docs/api/page.tsx` | Existing `Explorer` only | `/api/docs/openapi` | No new `"use client"` boundary; the server root forwards a cookie only to the exact serving origin. |

No new top-level client file, provider, bootstrap registration, or heavy browser dependency is introduced. Budgets are: zero new page-root client boundaries, zero new client files over 300 lines, zero new heavy browser libraries, and a required anonymous/authenticated route smoke test. Build success plus the existing production-browser QA flow provide the runtime evidence.

## 📝 Data Models

No database entity, column, relation, tenant-scoped query, cache record, migration, or backfill is introduced.

## 📝 API Contracts

### `GET /api/docs/openapi`

- Authentication remains optional.
- Anonymous or auth-resolution-error response: the complete OpenAPI JSON document without ACL feature/role description lines or `x-require-features` / `x-require-roles`.
- Authenticated staff response: the complete OpenAPI JSON document including current ACL metadata.
- Both variants retain authentication/security metadata and return caller-scoped no-store headers.

### `GET /api/docs/markdown`

- Authentication remains optional.
- The route renders Markdown from the same caller-scoped OpenAPI document as the JSON route.
- Anonymous output omits `**Features:**` / `**Roles:**` content; authenticated staff output retains it.
- Response remains `text/markdown; charset=utf-8` with caller-scoped no-store headers.

### `OpenApiDocumentOptions.includeAccessControlMetadata`

- Type: optional boolean.
- Default: `true`.
- `false`: omit only operation-level feature/role identifiers and their generated description fragments.
- The option does not alter `requireAuth`, OpenAPI security schemes, responses, paths, schemas, examples, or tags.

## 📝 UI/UX

The Explorer layout and interaction model do not change. Anonymous visitors see the same operation catalog without ACL chips/lines; authenticated staff see the existing ACL details. Loading, error, accessibility, and keyboard behavior remain owned by the existing Explorer implementation.

## 📝 Integration Coverage

The implementation ships coverage for all affected paths:

- Shared unit tests verify ACL metadata is present by default and absent only when explicitly disabled, including JSON and Markdown rendering while preserving auth/security metadata.
- Core unit tests verify anonymous, authenticated, and auth-error caller decisions; exact-origin cookie forwarding; cross-origin rejection; protocol-downgrade rejection; and shared document generation.
- App route tests exercise both export routes as anonymous and authenticated callers, assert JSON/Markdown redaction, and assert `Cache-Control`/`Vary` headers.
- Browser QA covers `/docs/api`, `/api/docs/openapi`, and `/api/docs/markdown` as both anonymous and authenticated staff, including equal path counts and the preserved authentication indicators.
- Create-app template parity is covered by mirroring both app route files and by the repository's create-app/template validation gates.

## 📝 Edge Cases & Failure Scenarios

- Auth lookup throws or its backing data store is unavailable: return the redacted document rather than leaking ACL identifiers or failing open.
- A cache or CDN ignores caller identity: `no-store` forbids storing either variant; `Vary` also names both authentication inputs for intermediaries that inspect the response.
- `NEXT_PUBLIC_API_BASE_URL` points off-origin: do not forward the visitor cookie; the Explorer may receive the anonymous document.
- The configured base URL downgrades HTTPS to HTTP on the same host: do not forward the cookie.
- Host/protocol request headers are missing or malformed: do not forward the cookie.
- A caller of `buildOpenApiDocument` does not know about the new option: default behavior remains unchanged.

## 📝 Risks & Impact Review

#### Authenticated document cached for an anonymous caller
- **Scenario**: A shared cache keys only on the export URL and later serves the full staff document publicly.
- **Severity**: High
- **Affected area**: `/api/docs/openapi`, `/api/docs/markdown`, and `/docs/api`.
- **Mitigation**: Both export responses set `Cache-Control: no-store` and `Vary: Cookie, Authorization`.
- **Residual risk**: A non-compliant intermediary could ignore HTTP cache directives; deployment operators must not override these headers.

#### Session cookie forwarded to an untrusted or plaintext target
- **Scenario**: An operator-configured API base URL points to another origin or downgrades HTTPS to HTTP, and server rendering forwards the staff session cookie.
- **Severity**: Critical
- **Affected area**: `/docs/api` server rendering and staff sessions.
- **Mitigation**: Cookie forwarding requires exact origin equality, including protocol, host, and port; all parse/header failures withhold the cookie.
- **Residual risk**: Correctness depends on the deployment proxy providing trustworthy `Host` / `X-Forwarded-*` headers, as do other absolute-URL decisions in the deployment.

#### Authentication lookup failure exposes metadata
- **Scenario**: Session resolution throws and a permissive fallback returns the staff document.
- **Severity**: High
- **Affected area**: Both docs export routes.
- **Mitigation**: The caller policy catches errors and explicitly selects the redacted variant.
- **Residual risk**: Operators receive less diagnostic information in the public response; server-side observability remains the appropriate failure channel.

#### Shared builder changes existing consumers
- **Scenario**: Adding the option accidentally changes output for callers that do not pass it.
- **Severity**: Medium
- **Affected area**: OpenAPI generation across modules, AI tooling, and generated documents.
- **Mitigation**: The option is optional and defaults to current behavior; focused tests assert the default and redacted variants separately.
- **Residual risk**: Future code could add new ACL-bearing fields without wiring the redaction flag; generator tests must expand with such fields.

### Operational impact and rollback

There is no persistent state and no migration. A code rollback restores the previous public metadata behavior immediately. Once released, the additive public option itself remains governed by the stable contract and cannot be removed in a single release; a rollback may stop using it at the route call sites without removing the type field.

## Migration & Backward Compatibility

This change is additive and default-preserving:

- `OpenApiDocumentOptions.includeAccessControlMetadata` is a new optional field, so existing TypeScript callers compile unchanged.
- Omitting the field is equivalent to `true`, preserving every existing non-docs caller's output.
- Public route URLs, methods, authentication requirement, status codes, and document structure remain stable. Anonymous representations intentionally omit only ACL feature/role identifiers.
- No event ID, widget spot, DI key, ACL feature ID, notification ID, CLI command, schema, migration, or import path changes.
- The create-app template receives the same route behavior in the same change.
- No deprecation bridge or `UPGRADE_NOTES.md` entry is required because nothing is removed, renamed, or reinterpreted for existing builder callers.

## 📋 Phasing

### Phase 1: Caller-scoped ACL metadata

Deliver the additive builder option, shared API-docs policy, both app/template route integrations, exact-origin Explorer forwarding, documentation, and regression coverage as one independently deployable security hardening change.

Future work is explicitly out of scope: gating the export routes behind a new ACL feature, hiding operations entirely, or creating tenant-configurable disclosure policies.

## 📋 Implementation Plan

1. Add the optional builder flag and unit coverage proving default preservation and targeted redaction.
2. Centralize API-docs document generation and fail-closed caller resolution in the `api_docs` module.
3. Apply the shared policy and no-store headers to JSON and Markdown app routes, then mirror the fixed routes into the create-app template.
4. Forward the Explorer cookie only for an exact-origin export URL and cover host/protocol failure cases.
5. Add app route tests, documentation, production-browser evidence, and run the configured validation/CI gates.

## Final Compliance Report — 2026-08-14

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root `AGENTS.md` | Preserve behavior unless explicitly changing it | Compliant | The shared builder defaults to existing behavior; only anonymous docs representations are intentionally redacted. |
| Root `AGENTS.md` | Mirror `apps/mercato/src/app/**` changes into create-app | Compliant | Both export routes are mirrored in the template. |
| Root `AGENTS.md` | New features include API/UI integration coverage | Compliant | JSON, Markdown, and Explorer paths are covered anonymously and authenticated. |
| `packages/shared/AGENTS.md` | Shared utilities remain generic and additive | Compliant | The builder option is optional, default-preserving, and contains no module-specific auth dependency. |
| `packages/core/AGENTS.md` | Module behavior remains self-contained | Compliant | Caller policy and shared API-docs builder live in `api_docs`; manifests are injected by app routes. |
| `packages/create-app/AGENTS.md` | Template sync checklist | Compliant | Route implementations are kept in parity. |
| `BACKWARD_COMPATIBILITY.md` | Stable type/function contracts change additively and reference a migration/BC spec | Compliant | This section documents the optional field and default-preserving behavior; no removal requires deprecation. |
| Frontend architecture contract | Preserve server roots and justify client islands | Compliant | `/docs/api` remains server-rendered with no new client boundary or heavy dependency. |
| Security boundary | Never send a session cookie off-origin or over a protocol downgrade | Compliant | Exact-origin comparison fails closed and has regression coverage. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | No persistent data model exists. |
| API contracts match UI/UX section | Pass | The Explorer consumes the same caller-scoped JSON representation documented here. |
| Risks cover all write operations | Pass | There are no state-changing operations; disclosure, caching, auth failure, and cookie transport risks are covered. |
| Commands defined for all mutations | Pass | No mutation is introduced. |
| Cache strategy covers all read APIs | Pass | Both caller-dependent read routes are explicitly non-storeable and vary on auth inputs. |

### Non-Compliant Items

None.

### Verdict

Fully compliant: approved for implementation.

## Changelog

### 2026-08-14

- Added the implementation-accurate security and backward-compatibility specification for anonymous ACL metadata redaction.
- Recorded exact-origin cookie forwarding, caller-scoped caching, API/UI integration coverage, risks, and final compliance evidence.

### Review — 2026-08-14

- **Reviewer**: Agent
- **Scope cohesion**: Passed by a fresh-context review; the builder flag, caller-aware routes, cache controls, and exact-origin Explorer forwarding are one end-to-end disclosure capability.
- **Security**: Passed after requiring full-origin cookie comparison and protocol-downgrade coverage.
- **Performance**: Passed; no new client boundary or heavy dependency is introduced.
- **Cache**: Passed; caller-dependent responses are `no-store` and vary on both authentication inputs.
- **Commands**: N/A; no mutation exists.
- **Risks**: Passed; disclosure, cache, auth-failure, and cookie-forwarding risks have explicit mitigations.
- **Verdict**: Approved.
