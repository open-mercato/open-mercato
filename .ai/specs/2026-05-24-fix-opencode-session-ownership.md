# Fix OpenCode Session Ownership (Security)

- **Date**: 2026-05-24
- **Scope**: `packages/ai-assistant`, `packages/core/src/modules/api_keys`
- **Type**: Security fix
- **Source**: `report-high.md` finding #1 (cross-user OpenCode session continuation enables privilege escalation)

## Problem

`handleOpenCodeMessage`, `handleOpenCodeMessageStreaming`, and `handleOpenCodeAnswer` accepted a user-supplied `sessionId` and `questionId` and resumed the matching OpenCode session without verifying ownership. The chat route only minted a fresh session-token API key when `!sessionId`, so an existing OpenCode session kept user A's `_sessionToken` baked into its conversation context. Any authenticated user with `ai_assistant.view` could pass user A's `sessionId` and have the AI agent continue executing MCP tools under user A's identity (cross-tenant data access, privilege escalation).

The exported `getPendingQuestions()` helper additionally returned every pending question across the entire OpenCode server, leaking cross-user / cross-tenant question text.

## Root Cause

The chat route persisted `(sessionUserId, tenantId, organizationId)` on the api_key row when minting a session token, but no field on that row pointed back at the OpenCode session id. Without that backlink the handlers had nothing to verify on resume, so the cross-user check was simply absent.

## Fix Summary

1. Add an additive nullable column `api_keys.opencode_session_id` with a partial unique index. The api_key row created for a chat now becomes the authoritative `opencodeSessionId → (userId, tenantId, organizationId)` mapping.
2. Add two service helpers in `apiKeyService.ts`:
   - `bindOpencodeSessionToApiKey(em, sessionToken, opencodeSessionId)` — wired into the chat route's `done` handler so freshly-minted sessions get bound atomically with the first response.
   - `findApiKeyByOpencodeSessionId(em, opencodeSessionId)` — uses `findOneWithDecryption` and filters out expired/deleted rows, matching the contract of `findApiKeyBySessionToken`.
3. Add `OpenCodeAuthContext`, `OpenCodeSessionOwnershipError`, and a private `assertOpencodeSessionOwnership(em, opencodeSessionId, auth)` helper in `opencode-handlers.ts`. The error message is opaque (`'Session not available'`) for both `session_unbound` and `session_owner_mismatch` to avoid leaking the discriminator.
4. Thread an optional `auth` + `em` pair through `handleOpenCodeMessage`, `handleOpenCodeMessageStreaming`, and `handleOpenCodeAnswer` request shapes. **Resume now fails closed when those are missing** — the field is optional at the type level only for source-compatibility.
5. `handleOpenCodeAnswer` additionally resolves the question's actual `sessionID` via OpenCode's own pending-question list, refuses when the caller-supplied `sessionId` does not match, and only then asserts ownership against the resolved id.
6. Replace the exported `getPendingQuestions()` with the new owner-scoped `getOwnedPendingQuestions(em, auth)`. The legacy zero-arg overload is kept as `@deprecated`, returns `[]`, and logs a single warning per process.
7. Chat route (`/api/chat`) wiring:
   - Build `opencodeAuth` once from `auth.sub`/`auth.tenantId`/`auth.orgId`.
   - Resolve `em` for every request (lifted out of the `!sessionId` branch).
   - In the `answerQuestion` short-circuit, look up the question's `sessionID` via the OpenCode client, cross-check against the caller-supplied id, look up the api_key row bound to that session, and respond `403 { error: 'Session not available' }` on any mismatch.
   - In the streaming branch, always pass `{ auth, em }` to `handleOpenCodeMessageStreaming`.
   - On the `done` event for a freshly minted session token, call `bindOpencodeSessionToApiKey(em, sessionToken, doneEvent.sessionId)`.

## Migration & Backward Compatibility

- **Database**: `Migration20260523234901_opencode_session_id` is additive — one nullable column plus one partial unique index. No backfill. Pre-existing api_key rows have `opencode_session_id = NULL` and resolve to "unowned"; any chat session in flight when the migration lands becomes unresumable on the next request and the user gets the opaque `Session not available` error. Acceptable trade-off: session tokens already expire after 120 minutes.
- **`OpenCodeTestRequest` shape (STABLE per BC §3)**: gains two optional fields (`auth`, `em`). Pre-existing callers compile unchanged; pre-existing callers that resume an existing `sessionId` now fail closed at runtime. New code MUST always pass both. Documented in JSDoc with `@since 0.6.0`.
- **`handleOpenCodeAnswer` signature (STABLE per BC §3)**: gains an optional fifth parameter `ownership?: OpenCodeAnswerOwnershipOptions`. Pre-existing callers compile; resume without ownership context fails closed.
- **`getPendingQuestions()` (STABLE per BC §3)**: kept as a deprecated zero-arg overload returning `[]` with a single `console.warn` per process. New callers MUST use `getOwnedPendingQuestions(em, auth)`. The deprecated overload will be removed no earlier than the next minor (0.7.0).
- **No event IDs, ACL features, DI keys, widget spot IDs, or API route URLs changed.**

## Test Coverage

- `packages/core/src/modules/api_keys/__tests__/apiKeyService.opencodeBinding.test.ts` — 5 cases: bind writes, idempotent on same id, throws on different id, lookup returns null for expired/deleted rows.
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/opencode-handler-ownership.test.ts` — 10 cases covering all three handlers plus `getOwnedPendingQuestions` (owner match → proceeds; userId / tenantId / orgId mismatches → opaque error; missing binding → opaque error; no sessionId → bypasses check; `handleOpenCodeAnswer` foreign / stale question id → opaque error; `getOwnedPendingQuestions` filters foreign sessions out).
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/chat-route-ownership.test.ts` — 8 chat-route wiring cases covering the `answerQuestion` short-circuit's three-step verification (unknown question, mismatched sessionId, foreign api_key owner, no binding, happy path) and the post-`done` `bindOpencodeSessionToApiKey` call (fresh session binds, resumed session does not re-bind), plus the `auth`+`em` payload threaded into `handleOpenCodeMessageStreaming`.
- `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-CHAT-OWNERSHIP-001-opencode-session.spec.ts` — Playwright integration coverage hitting `POST /api/ai_assistant/api/chat` end-to-end: unauthenticated callers receive 401; the `answerQuestion` short-circuit returns the opaque `{ error: 'Session not available' }` 403 for unknown question ids and mismatched sessionIds; the input-validation gate rejects malformed bodies before the ownership-checked path runs. The streaming-branch SSE rejection is not asserted at this layer because it requires a running OpenCode container; the unit and chat-route tests above cover it exhaustively.

## Local validation note

The repository's jest configuration on the implementing machine sets `ignoreDeprecations: '6.0'` while the installed TypeScript is 5.9.3 (which accepts only `'5.0'`). This produces `TS5103` on every package's test runner and is unrelated to the changes in this fix. The diff was reviewed manually; CI should validate the test runs once the runner is on a TS version that accepts `'6.0'`, or after the project bumps `ignoreDeprecations` to `'5.0'`.


## Session role revocation follow-up (#7599, 2026-10-18)

### Problem and solution

Session ownership alone does not constrain the roles snapshotted when the key was issued.
Session-bound keys now authorize only the intersection of `rolesJson` and the owner's current,
nondeleted `UserRole` memberships in the key's tenant. The related user and role must also remain
nondeleted and in that tenant. Roles added after issuance do not widen an existing key.
Any of `sessionToken`, `sessionUserId`, `sessionSecretEncrypted`, or `opencodeSessionId` marks a
session-bound key; a missing or blank owner, missing tenant, or mismatched evaluated tenant grants
no roles. Independent API keys continue using their own assigned role policy.

### Architecture and cache policy

`api_keys/services/sessionKeyRoles.ts` centralizes marker detection and the issued/current role
intersection through `findWithDecryption`. RBAC uses it for ordinary ACL resolution, exact
transaction-EntityManager resolution, and feature-specific organization grants. Authentication
uses the same intersection before projecting role names and the superadmin flag.
The API-key principal service uses it when projecting role IDs for role-based resource shares.
Business-rule API calls resolve the same intersection before minting their temporary child key,
so a stored session-key profile cannot convert a revoked role into independent access.

Session-derived authentication, ACL, and feature-organization results bypass cross-request caches.
The optional Directory organization-scope cache also bypasses session-bound keys; request-local
memoization remains intact. Each worker reads current memberships on its next request, so role
removal does not depend on process-local invalidation messages reaching other workers. Ordinary
keys retain their existing cache policy. Existing last-used write debouncing remains enabled.

### Migration & Backward Compatibility

Endpoint URLs, token formats, response fields, database schema, event IDs, ACL IDs, and DI keys
are unchanged. This fixes revoked-role authorization; it intentionally removes privileges from
already-issued session keys immediately after the membership change commits. Still-held issued
roles remain usable, and a newly granted role requires a new session key. No migration or stored-key
rewrite is needed. Operators must deploy and restart every application/worker process that can
resolve these credentials; old running code continues authorizing snapshots until replaced.
No deprecation bridge is required because no existing public shape or identifier is removed.

### Risks and validation

- **High — stale grants:** validate cold and warm ACLs, feature-organization projections, raw
  authentication superadmin flags, and independently warmed worker caches. Live membership reads
  prevent session projections from surviving a committed removal.
- **High — scope drift:** tenant/owner mismatch, deleted memberships, deleted roles, and malformed
  session markers deny grants; test these independently from ordinary API-key policy.
- **Medium — request cost:** session requests perform live membership queries and repeat secret
  verification. Keep ordinary-key caches and last-used write debouncing. No new services or events.
- **Residual risk:** authorization already evaluated by an in-flight request is not retroactively
  cancelled; the next request revalidates. Staff deactivation and infrastructure-key fallback are
  separate issues (#7223 and #5173). Rolling back reintroduces snapshot-based authorization.

Coverage: `rbacService.session-role-revocation.test.ts` covers cold/warm authorization and scope
projections, old cached entries, exact-EM isolation, role ceilings, tenant isolation, deleted links
and roles, malformed owners, and ordinary-key compatibility. `server.apiKeyCache.test.ts` covers
repeated authentication before/after revocation, removal of the raw superadmin flag, surviving
roles, and unchanged ordinary-key caching. `organizationScopeCache.test.ts` covers the opt-in
cross-request scope cache. Component integration coverage exercises issuance, authentication,
and independently warmed RBAC services together; persistence is simulated, not a live database.
`api_keys/services/__tests__/principalService.test.ts` covers share-role projection after revocation,
issuance ceilings, and independent keys. Business-rule action tests verify temporary child keys
receive only still-held issued roles and that an empty intersection stops before any API call.

### Changelog

- 2026-10-18: Add live session-key role revalidation and cache-bypass design for #7599.
