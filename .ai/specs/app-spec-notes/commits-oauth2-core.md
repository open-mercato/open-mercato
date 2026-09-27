# Commit plan — OAuth2 grant-lifecycle core (Phase 1, 10 commits)

Companion to `../2026-09-27-app-spec-oauth2-grant-lifecycle.md` §4.1.

## P1 — `withAdvisoryXactLock` (shared)
- `packages/shared/src/lib/db/advisoryLock.ts`: `withAdvisoryXactLock<T>(em, key, fn: (txEm) => Promise<T>, { waitDeadlineMs = 15000, onWait?, tryOnce? })` — `key` must be `<namespace>:<parts>` (rejected otherwise); `tryOnce` = one non-blocking attempt (used by `reportResourceChallenge`)
  - Always on a context-detached fork: `em.fork({ clear: true, freshEventManager: true, useContext: false })`, so the lock transaction is never nested in (or a savepoint of) a caller's transaction and commits on its own connection.
  - Loop: `fork.transactional(tx => select pg_try_advisory_xact_lock(hashtextextended(key,0)))`; acquired → run `fn(tx)` in that same transaction; not acquired → end tx (release connection), jittered back-off (50→1000 ms), call `onWait()` (caller re-reads; may return a result to short-circuit), retry until deadline.
  - `55P03` / `57014` / `isTransientDbError` / deadline → `AdvisoryLockUnavailableError` (transient).
  - JSDoc: `fn` MUST do all DB I/O on `txEm`, MUST be bounded (≤ one external call), xact-scoped only (safe under transaction pooling).
- Tests (Jest, mocked connection): loop, back-off, deadline, error mapping, fn error releases, onWait short-circuit. Real contention (2 connections, waiters ≥ pool size) runs in the P4 Playwright suite.
- Explicit `exports` entry `./lib/db/advisoryLock` in `packages/shared/package.json` (precedent `./lib/db/duplicateEntityClassNames`).
- `packages/shared/AGENTS.md` lib table row (budget check).

## P2 — token-endpoint client + revoke (core/integrations/lib/oauth)
- `requestTokenEndpoint({ url, clientAuthMethod, clientId, clientSecret, params, timeoutMs })` → typed response | `OAuthTokenEndpointError { status?, error?, errorDescription?, kind: 'protocol'|'network'|'timeout'|'invalid_response' }`.
- `revokeToken({ url, clientAuthMethod, clientId, clientSecret, token, tokenTypeHint })` (RFC 7009; 200 on unknown token is success).
- Basic auth: form-urlencode id/secret before base64 (RFC 6749 §2.3.1).
- No hub changes.

## P3 — `integrationCredentialsService.erase(integrationId, scope)`
- Strict row; `credentials = {}` then `deletedAt = now()`; flush on the service's em (grant service passes a tx-bound instance).
- The exported `CredentialsService` becomes an explicit type (superset of the factory return) with `erase?` optional; a type-level test asserts the factory satisfies it. The grant service uses the core factory bound to the lock transaction, where `erase` always exists; Disconnect fails closed if it were missing.
- Tests incl. encryption-disabled mode.

## P4 — `integrationOAuthGrantService` + fake AS + test-only routes (5 commits)
- DI (scoped). API: `getAccessToken(descriptor, owner, { minValidityMs?, rejectedAccessToken?, forceRefresh? })`, `inspectGrant(descriptor, owner)` (no network; returns status/expiry/refreshedAt/lastFailureClass/clientChanged and the access token only if still valid; no lock, no writes), `readGrantStatus(integrationId, scope)` (descriptor-free; `'active' | 'invalidated' | 'unavailable' | null`; no lock, no network, no writes, never throws), `completeConnect(descriptor, owner, tokenResponse)` (update in place over a live grant, insert otherwise; returns the previous `providerData`), `updateProviderData(descriptor, owner, data)` (lock-taking grant write), `reportResourceChallenge(descriptor, owner, challenge)` (non-blocking `tryOnce`; records `scope_insufficient`), `disconnect(descriptor, owner)`.
- Forced refresh (`forceRefresh`, `rejectedAccessToken`) only if, after the re-read, `refreshedAt` is earlier than the call's start.
- Lock key: `oauth_grant:${integrationId}:${tenantId}:${organizationId}:${userId ?? '-'}`.
- Inside the lock: `createCredentialsService(txEm)`, `createIntegrationStateService(txEm)`, `createIntegrationLogService(txEm)`; grant blob `status` + projection `setReauthRequired` in the same commit.
- Log entries via `write()` with codes `integrations.oauth_<reason>`; levels per spec §1.4.4 (`error` only for `revocation_failed`, written after release).
- Classification per spec §1.4.5; `client_changed` on read only.
- Disconnect: lock → capture → erase + flag clear + `oauth.disconnected` + `oauth.revocation_pending` log entries (tx-bound log service) → commit → release → re-read: live grant again → `revocation_skipped_reconnected`; captured grant invalidated → revoke only / `revocation_skipped_invalidated`; else `onAfterDisconnect(captured)` → revoke the most recent refresh token → append `oauth.revocation_confirmed|failed`.
- Grant key `${integrationId}__oauth_grant`.
- `packages/core/src/helpers/integration/fakeOAuthServer.ts` (node `http`): modes none / non-revoking / strict(+grace ms), error injection, counters, revocation endpoint.
- Classification per §1.4.5 incl. `platform_unavailable` (encryption unavailable, undecryptable blob) and `isTransientDbError` → `transient`; token-response validation at the boundary.
- Tests (Playwright via test-only routes unless noted):
  - I1 concurrency (20 callers, 2 connections);
  - I2 interleavings incl. disconnect → reconnect → refresh (one live row + one tombstone) and reconnect in place;
  - I3 per-row classification (Jest) plus flag agreement and the `upsert` defaults case;
  - I4 no token in logs/responses/run parameters;
  - I5 erase with revocation down, crash hook after erase leaves `revocation_pending`, quick reconnect → `revocation_skipped_reconnected`;
  - I6 dedicated `poolMax=4` pool; a refresh inside an outer transaction that rolls back still persists the rotated token;
  - I7 owners differing only by organization / only by tenant;
  - forced-refresh bound;
  - `inspectGrant` never calls the token endpoint and never throws on decrypt failure.
- Playwright specs live in `packages/core/src/modules/integrations/__integration__/`.
- Test-only routes (flag-gated, 404 without the flag; precedent `communication_channels` `test-seed` / `OM_ENABLE_TEST_CHANNEL_SEEDING`): register a test OAuth provider, expose the fake authorization server's token/revoke endpoints and counters, drive connect / updateProviderData / getAccessToken / disconnect, offer a fault-injection hook, and run the pool test on a dedicated small ORM pool.
- Decoupling test: no `.tsx` imports `integrations/lib/oauth`.

## P5 — flag projection + banner
- `setReauthRequired` only on change, in the same transaction as each status change; `integrations.state.updated` emitted after commit (`userId: null` for runtime emissions).
- Fix `upsert`: a missing state row is created with the definition defaults (`defaultState.isEnabled`), not `isEnabled: false`. Also affects existing callers that omit `isEnabled` (health service, version route, sync engine health write, run cancel, state PUT); stored rows are not remediated.
- Optional `oauthGrant: { status: 'active' | 'invalidated' | 'unavailable' } | null` on the integration detail response (additive; read via `readGrantStatus`, never 500 on decrypt failure).
- Detail-page reauth banner (Alert primitive, status tokens) shown when `oauthGrant.status === 'invalidated'`; links to the provider tab; i18n.
- No new event ID or notification type in Phase 1 (both are Phase 3).

## P6 — docs
- integrations `AGENTS.md` "OAuth grants" section; docs mdx page.
- Provider guidance: write routes run the integrations mutation guards (like `api/[id]/state/route.ts`); tab writes use `useGuardedMutation`; the Disconnect confirm handles Cmd/Ctrl+Enter and Escape; Disconnect is exempt from optimistic locking (the grant's `updated_at` moves on every refresh).
