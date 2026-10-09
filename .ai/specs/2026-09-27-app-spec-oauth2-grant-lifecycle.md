# App Spec: OAuth2 Grant Lifecycle for Integrations (platform capability)

> A business architecture document above feature specs, for a **platform capability**: the part of Open Mercato that lets an integration obtain, keep, refresh and give up delegated OAuth2 access to a third-party API on behalf of a tenant (or a user). It is the SINGLE SOURCE OF TRUTH for the capability; if a feature spec contradicts it, this document wins. It states the decisions; mechanics, line-level evidence, the commit plan and the labelled test criteria are in the Phase 1 feature spec (`2026-10-01-oauth2-grant-lifecycle-core.md`, proposed in PR [#6910](https://github.com/open-mercato/open-mercato/pull/6910)).\
> **Status:** Draft — for maintainer review. **Date:** 2026-09-27. **Code baseline:** `develop` @ `4bdabd8bb`; `open-mercato/official-modules`, all branches (`main` @ `2d548d6`): no OAuth2 authorization-code clients (§1.4.1).

## 0. Executive summary

**Question:** how should Open Mercato handle OAuth2 grants for integrations (the tokens a third-party system issues when a tenant admin grants access), what should the platform own, and where should it live?\
**Answer:** the platform owns **one correct, tested way to hold and use an OAuth2 grant**: a narrow grant-lifecycle core (12 atomic commits) that every new OAuth integration builds on instead of re-implementing. It is not a full toolkit.

**Why a platform standard.** **It is the hard part:** cross-process-safe refresh (workers always run as separate processes), a failure classification that keeps "needs reconnect" trustworthy, token storage admin edits can't clobber, a disconnect that erases and revokes, and a PKCE-protected code exchange (RFC 7636; recommended by RFC 9700 for confidential clients, required by OAuth 2.1). None of it exists as a reusable core at the baseline. **The one implementation is not reusable:** the channel hub's token call and refresh (Gmail; Microsoft 365 in PR [#5898](https://github.com/open-mercato/open-mercato/pull/5898)) are per-user, channel-bound and coordinated within one process only. **The next integration is cheaper and safer:** a provider supplies a descriptor and its own screens, and inherits refresh, a trustworthy reconnect signal, PKCE and a real disconnect.

**Why Phase 1:** with strict refresh-token rotation (RFC 9700 §4.14.2), two processes refreshing the same grant concurrently lose it. The hub coordinates within one process only; its two providers don't rotate strictly, so the defect is latent at the baseline and surfaces with the first strict-rotation provider (§1.4.6).

**Scope and reuse:** Gmail and Microsoft 365 don't change in Phase 1, so until the optional Phase 3 hub migration the platform has two refresh implementations and the core is the standard for new integrations. The first consumer is an official module in [`open-mercato/official-modules`](https://github.com/open-mercato/official-modules), specified separately; Phase 1 ships with no consumer in this repository, and a test provider built only on exported package paths is the in-tree proof (§7). The connect UX (routes, a generic Connect button, the `oauth` credential field type, account picking) stays provider-owned until Phase 3; the protocol pieces and a normative route contract (§1.4.3) are in the core.

**Key decisions:** hand-roll the protocol with no new production dependency (§4.5.3); keep SSO separate (§4.5.4); the advisory-lock helper goes in `packages/shared`, everything else (including the fake authorization server) in `packages/core/src/modules/integrations`; no DB migration, no new production API route, no new ACL feature; real-Postgres suites run as steps of the existing `documents-multi-instance` CI job (Q3).\
**The alternative is real** (§4.6 A): the first consumer implements all of this itself and the platform adds only the lock helper and an erase function, about 5 commits cheaper up front, but the next OAuth integration re-implements the hardest part.

## 1. Business Context `PM`

### 1.1 Business Model

Open Mercato is an open-source commerce/ERP platform; the maintainers' revenue depends on adoption (a hosted offering, enterprise modules, services), and integrations with systems customers already run are a primary driver. More and more of those systems offer only OAuth2 authorization-code access with long-lived refresh tokens (Google, Microsoft, most accounting and CRM SaaS APIs; Akeneo uses the password grant). An integration that gets OAuth wrong costs a support ticket ("sync stopped, says reconnect") and lost trust.

**Who pays:** the **upstream Open Mercato maintainers**. The capability has no direct payer: they carry the review, support and maintenance cost of every OAuth integration, decide whether this capability is accepted, and get one tested implementation instead of a copy per integration. **First consumer:** an official module in `open-mercato/official-modules`, specified separately.\
**Flywheel:** a correct, shared grant lifecycle → the next OAuth integration is cheaper and ships without its own locking/refresh bugs → more integrations, fewer false "needs reconnect" → more adopters trust background sync → more contributors build on the same core.

#### Checklist

- [x] Paying customer identified (cost-bearer for a platform capability); flywheel articulated

### 1.2 Business Goals

**Primary goal: correct grant handling by default for every new OAuth integration.** An integration built on the core never loses a valid grant because of the platform (no false "needs reconnect", no lost rotated refresh token), with a web process plus worker processes and several replicas. Measured against the fake authorization server's ground truth: **0** grants end `invalidated` while the fake server still holds their refresh token as valid (the §1.4.6 persist window aside), **at most 1** non-forced refresh per grant per expiry window (from one stored `expiresAt − minValidityMs` to the next) in the concurrency test matrix (§7), and **0** "pool exhausted" failures with waiters ≥ pool size.

**Secondary goal: reuse.** The OAuth part of a new tenant-level provider costs **≤ 5 atomic commits** on top of the core, with no provider-local lock, refresh or PKCE code: (1) descriptor and client fields; (2) initiate and callback routes; (3) External Account picker and tab; (4) adapter, health check and keep-alive; (5) disconnect hook. Self-contained it costs about **9** (§4.6).

**Not in scope** (nothing speculative): user login / SSO / OIDC relying-party work (`packages/enterprise/src/modules/sso`; only the boundary, §4.5.4); acting as an OAuth *server* (`agent_orchestrator`, MCP OAuth 2.1, [#6218](https://github.com/open-mercato/open-mercato/issues/6218)); the `client_credentials`, `password`, device-code and JWT-bearer grants; customer-portal users connecting accounts; generic connect routes, a generic Connect UI, rendering the `oauth` field type and generalizing the hub's state cookie (Phase 3, triggered); migrating the Gmail/MS365 hub (Phase 3, optional: the race is benign for them, §1.4.6); DPoP, PAR, JAR, mTLS sender-constraining, dynamic client registration; several External Accounts of one provider per organization (one grant per Grant Owner); incremental authorization (adding scopes is a full Reconnect); any specific provider.

#### Checklist

- [x] Measurable primary goal; scope exclusions listed

### 1.3 Ubiquitous Language

> One term = one meaning. Two collisions are resolved here:
> - **"tenant"** is always the Open Mercato tenant. A provider's own "tenant" or "organization" concept is an **External Account**. **"Tenant-level"** (grant, row, provider) means "not per user": one per Open Mercato **organization**.
> - **"Disconnect"** (tenant-level grant: erases and revokes, not undoable) is not the hub's **channel disconnect** (per-user, keeps the row, undoable).

| Term | Definition | Source of data | Period |
|------|-----------|----------------|--------|
| **Integration** | A registered `IntegrationDefinition` (e.g. `channel_gmail`). | `integration.ts` registry | — |
| **Bundle** | An integration grouping child integrations (`bundleId`) that share the bundle's Client Configuration; grants belong to the child. | `integration.ts` registry | — |
| **Integration Project** | A planned grouping of an integration's configuration (Draft spec, §8); a future `projectId?` Grant Owner dimension. | — | — |
| **Client Configuration** | The OAuth app registration the admin copied from the provider console (`clientId`, `clientSecret`, optional `scopes`); per organization, admin-edited, read child-then-bundle (the `resolve()` fallthrough order, never through a `bundleId` ending in `__oauth_grant`) under the operation's pinned DEK; an unreadable row is `platform_unavailable`. | `integration_credentials` row, `user_id IS NULL` (or the bundle's) | — |
| **Grant Owner** / **Tenant-level grant** | The Grant Owner is who the delegated access belongs to: `(integrationId, tenantId, organizationId, userId \| null)`, passed as an object so later dimensions are additive (§8). A tenant-level grant has `userId = null`: one per Open Mercato **organization** (`organizationId` is required). | `IntegrationScope` + integration id | — |
| **OAuth Grant** | The aggregate for one Grant Owner (Token Set plus status and metadata): at most one **live** row per owner, the source of truth for usability, owned by the child integration in a bundle. | Grant Store | from Connect until Disconnect (organization deletion leaves it unused) |
| **Live grant / tombstone** | The grant row with `deleted_at IS NULL` / the blanked, soft-deleted row a Disconnect leaves. Tombstones are never read. | Grant Store | — |
| **Grant Status** / **Grant Read Status** | Grant Status is `active` or `invalidated` (a terminal outcome confirmed under the Grant Lock; unusable until the next Connect). Grant Read Status is what a read reports, not stored: `active`, `invalidated`, `unavailable` (the grant can't be read; may be transient) or `none` (`null` in the API), via `readGrantStatus` (the only descriptor-free read) or `inspectGrant`. "Needs reconnect" always means Grant Status `invalidated`. | OAuth Grant; reads | per read |
| **Grant Revision** | `revisedAt`: the time of the last admin-driven change (Connect, External Account selection), never moved by Refresh; the optimistic-lock version for `updateProviderData` and Disconnect (§1.4.2). | OAuth Grant | — |
| **Token Set** | `accessToken`, `refreshToken`, `expiresAt`, `tokenType`, `grantedScopes` from the token endpoint; the grant adds `clientId`, `obtainedAt` and `refreshedAt`. | token endpoint response | provider-defined |
| **Grant Store** | An encrypted `integration_credentials` row **separate from** the Client Configuration row (§1.4.2). | `integration_credentials` | — |
| **Provider Descriptor** | The code-level declaration per integration (endpoints, client auth, PKCE mode, scopes, hooks); never tenant-supplied, passed per call, no global registry (§1.4.3). | provider package | — |
| **PKCE** | Proof Key for Code Exchange (RFC 7636): binds an authorization code to the session that requested it. | core helpers + provider state | per Connect |
| **Refresh** / **Rotation** | Refresh exchanges the stored refresh token for a new Token Set and never sends `scope`. Rotation is the provider returning a new refresh token on Refresh: **strict** (the old one stops working, possibly after a reuse-grace window, RFC 9700 §4.14.2), **non-revoking** (it keeps working; Microsoft) or **none** (no new token; Google, typically). | token endpoint; provider docs | — |
| **Grant Lock** | Cluster-wide mutual exclusion for one Grant Owner, taken by every grant write: a transaction-scoped Postgres advisory lock under the namespaced key of §10.1, whose waiters hold no connection. | Postgres | waiter ≤ 15 s (≤ 5 s for Disconnect) |
| **Token Provider** / **Degraded token** | The Token Provider is the consumer-facing call "give me an access token valid for at least N ms for this Grant Owner" (`minValidityMs`, default the descriptor's `refreshSkewMs`), refreshing lazily under the Grant Lock. A degraded token is a stored access token still valid at call time but below `minValidityMs`, returned with `degraded: true` when no refresh is possible; an expired token is never returned. | `integrationOAuthGrantService` | per call |
| **Token Failure** / **Resource Challenge outcome** | A Token Failure is the outcome of a failed Token Provider call: exactly one of `transient`, `grant_invalidated`, `client_misconfigured`, `not_connected`, `platform_unavailable` (§1.4.5). The Resource Challenge outcome `scope_insufficient` is the caller's classification (`classifyResourceChallenge`) of a resource-API `401`/`403` that signals insufficient scope, not a Token Failure. | Token Provider; provider adapter | per call |
| **Connect Failure** | The outcome of a failed Connect: exactly one of `connect_cancelled`, `connect_state_invalid`, `connect_exchange_failed`, `connect_grant_unreadable`, `connect_persist_failed`, `client_misconfigured`, `organization_scope_required`, `oauth_base_url_not_configured`, `connect_origin_rejected`. Never changes an existing grant. | provider callback | — |
| **Reauth Flag** | `IntegrationState.reauthRequired`, the existing column. Not written by the grant service and not read by the banner in Phase 1; the projection is Phase 3 (§1.4.2). | `integration_states` | — |
| **Connect** / **Reconnect** | Connect is the consent round trip (PKCE authorize redirect → callback → code exchange → grant persisted as `active`), creating the live grant when none exists. Reconnect is a Connect over an existing live grant, updated in place under the Grant Lock (never a second live row); an unreadable grant is overwritten only with the admin's `replaceUnreadable` confirmation (§1.4.5). | provider-owned routes on core helpers | ≤ 5 min state TTL |
| **Account pending** | A live `active` grant whose provider requires an External Account not yet chosen. The Token Provider works; the provider's adapter refuses to sync. Every Connect, including the WF3 Reconnect, starts in it. The core emits no signal for it (health stays `oauth.connected`, no banner): the provider tab shows it, and the adapter's refusals appear as run errors. | `providerData` empty | after Connect until selection |
| **Connection State** | What the provider tab shows, derived by `inspectGrant`, never stored. In precedence order: `not_configured` > `not_connected` > `unavailable` > `invalidated` > `active`. A missing `APP_URL` is the separate flag `baseUrlMissing`, never a state. `not_configured` (no Client Configuration, or an empty `clientId` or `clientSecret`; an unreadable one is `unavailable`, ranked in `not_configured`'s place, §1.4.2) is distinct from the Token Failure reason `client_not_configured` and the platform health status `unconfigured`; `not_connected` corresponds to Grant Read Status `none`. | `inspectGrant` | per read |
| **Provider tab** | The provider-owned tab on the integration detail page with Connect, Reconnect, Disconnect, the redirect URI and the External Account picker; its id is `detailPage.connectTabId` (§3.5). | provider widget | — |
| **Disconnect** | Admin-initiated end of a grant: local erasure under the lock, then best-effort provider cleanup and revocation. Aborts when the tokens can't be read unless `force: true` (§1.4.5). | admin action | — |
| **External Account** / **Provider Authorization** | The External Account is the provider-side thing the grant is used against, chosen after consent (an organization in an accounting system, a mailbox), never called "tenant". The Provider Authorization is the provider-side consent record behind a grant; it can be **shared** by grants of different Grant Owners. | provider API | — |
| **Keep-alive** | A provider-owned scheduled job that force-refreshes idle grants before the provider expires an unused refresh token (§1.4.4). | provider | provider-defined |

#### Checklist
- [x] Terms defined once; collisions resolved
- [x] Sources and periods specified

### 1.4 Domain Model

#### 1.4.1 Current state (from the code)

| Question | Finding | Evidence |
|---|---|---|
| OAuth2 **client** flows | Three families, four implementations, each with its own token POST: the hub's per-user auth-code (Gmail; MS365 PR #5898), Akeneo's in-memory password grant (not a consumer), SSO OIDC login via `openid-client` (enterprise, ESM-only). `agent_orchestrator` is a **server**. PKCE: SSO always, Gmail never, the hub only as an adapter opt-in; no reusable helper. | `communication_channels/lib/oauth-token.ts` |
| Refresh across processes | The hub's single-flight is an in-process `Map` that swallows refresh and persistence errors, and workers are separate OS processes. Benign for Google and Microsoft (no strict rotation); the first strict-rotation provider is the first harmful case. | `credential-refresh.ts` |
| Disconnect | The hub keeps the token row decryptable (no sweep exists), never revokes, and its disconnect is undoable; `CredentialsService` has no delete. | `commands/disconnect-channel.ts` |
| Generic admin OAuth UI | None: the declared `oauth` field type is filtered out of the detail and bundle pages; `useConnectChannel` is hub-only. | `integrations/backend/integrations/[id]/page.tsx` |
| `reauthRequired` and state `upsert` | The admin PUT writes the column, but `setReauthRequired()` is never called and no UI renders it. Defect: `upsert` creates a missing row with `isEnabled: false`, ignoring `defaultState.isEnabled`. Today it is reachable only through direct API calls in an organization without a state row (a state PUT carrying only `reauthRequired` disables `webhook_custom`); a runtime `setReauthRequired` would make it common. Fixed separately, tracked in issue [#6915](https://github.com/open-mercato/open-mercato/issues/6915) (§4.1). | `state-service.ts` |
| Advisory locks on the bare connection | Four sites take an xact lock inside `em.transactional` but run its SQL on the bare connection, so the lock is released at once. Out-of-scope follow-up. | `tillio/lib/locking.ts:19`; `sso/services/ssoConfigService.ts:366`; `record_locks/lib/recordLockService.ts:1558`; `scheduler/lib/localLockStrategy.ts:61`; contrast `documents/lib/folderHierarchySerialization.ts:26-27` |
| Locking and DB constraints | `pg_advisory_xact_lock` is hand-rolled at ≥ 8 sites (no shared wrapper; the module-level ones, tillio's `createTillioLock` and documents' `acquireFolderHierarchyMutationLock`, are blocking). Pool max 20, 6 s acquire timeout, worker concurrency budgeted to the pool; `isTransientDbError` misses the pool timeout, `55P03` and `57014`. | `shared/src/lib/db/mikro.ts`; `shared/src/lib/db/pg-errors.ts` |
| Credential encryption and KMS | Each credentials call resolves the DEK separately; with tenant data encryption switched off (`TENANT_DATA_ENCRYPTION=no`) it stores plaintext by design, and a blob sealed earlier stays unreadable (`sealed-while-disabled`); a Vault timeout looks like a missing DEK; a fallback hands out a derived key; a second, field-level layer has its own DEK cache. | `integrations/lib/credentials-service.ts:151-162`; `shared/src/lib/encryption/kms.ts:46-48,65-74`; `tenantDataEncryptionService.ts:43,273-275` |
| Outbound timeouts | `fetchWithTimeout` bounds only the response headers; `withTimeout` doesn't bound a task that ignores its signal. | `shared/src/lib/http/fetchWithTimeout.ts:47-57,62-84` |
| Access control | Logs, health and state PUT need `integrations.manage`; credentials `integrations.credentials.manage`; the detail page `integrations.view`. | `integrations/setup.ts` |
| Base URL | `getAppBaseUrl` falls back to the request origin; `getSecurityEmailBaseUrl` reads `APP_URL` only. | `shared/src/lib/url.ts` |
| Credential storage | The admin save is a full replacement that drops undeclared keys, versioned by the row's `updated_at`; Tillio keeps runtime tokens under its own integration id; tenant-level reads are strict (`userId = null`), with no DB uniqueness. | `credentials-masking.ts` |
| Health and detail page | A provider `healthCheck.service`, a 15-min probe for enabled integrations registered once per tenant (it covers one organization), a manual health check on the detail page ("Run Check"), a badge from the stored result; a no-DEK read fails the run before the check; `?tab=<id>` opens any visible tab. | `integrations/lib/health-service.ts` |
| Testing | No real OAuth round-trip test (unit tests stub `fetch`, no fake OAuth server); precedents exist for a flag-gated test-only route (`test-seed`) and a `testcontainers` real-Postgres suite run by the `documents-multi-instance` CI job (`packages/documents`); core's real-Postgres suites (`query_index/__tests__/*.pg.test.ts`) are gated on a database URL and no workflow runs them; `develop` requires no status checks. | `.github/workflows/ci.yml` |
| Consumers | data_sync resolves credentials once per run, and adapters can call a Token Provider with no engine change; `official-modules` has no OAuth2 auth-code client and consumes core through published packages; Package Previews is maintainer-dispatched, same-repository only. | `data_sync/lib/sync-engine.ts` |

#### 1.4.2 Entities

**ClientConfiguration** (existing storage, unchanged), read child-then-bundle (the `resolve()` fallthrough order) with the layered read under the operation's pinned DEK: `clientId` (text, required), `clientSecret` (secret, masked, required), `scopes` (text; blank → descriptor defaults). A configuration that exists but doesn't decrypt or parse is `platform_unavailable` (Connection State `unavailable`), never `client_not_configured`. Rotating `clientSecret` needs no Reconnect (the grant stores only `clientId`).

**OAuthGrant** (aggregate root; existing table, new row key), an encrypted blob in `integration_credentials`:
- **Row key:** tenant-level `integration_id = '<integrationId>__oauth_grant'`, `user_id IS NULL` (a sibling key, as Tillio does; the admin credentials route can't address it). Per-user (hub, Phase 3): unchanged, so no data migration.
- **Uniqueness and schema:** uniqueness among live rows is enforced by the Grant Lock around every write (I2; a partial unique index is Phase 3, R4); the blob schema is validated on every read, independently of the descriptor (`requiresRefreshToken` applies at Connect only).
- **Lifecycle:** Connect updates the live row in place or inserts one, never restoring a tombstone; Disconnect blanks the blob and soft-deletes the row; every lookup filters `deleted_at IS NULL`. Organization deletion (an undoable command) doesn't touch the grant in Phase 1: the row stays encrypted and unused, and revoking on organization deletion is out of scope.

| Field | Type | Required |
|---|---|---|
| `version` / `status` | integer (starts at `1`) / `active` \| `invalidated` | yes |
| `invalidatedReason` / `invalidatedAt` | `grant_rejected` \| `no_refresh_token` / datetime (UTC) | when `invalidated` |
| `accessToken` / `refreshToken` | text (secret) | yes / at Connect, when `requiresRefreshToken` |
| `expiresAt` / `tokenType` | datetime (UTC) / `Bearer` | yes |
| `clientId` / `grantedScopes` | text / text, multi | yes / no |
| `obtainedAt` / `refreshedAt` / `refreshCount` / `revisedAt` | datetime / datetime / integer / datetime (UTC) | yes / no / yes / yes |
| `lastFailureClass` / `lastFailureAt` | `transient` \| `client_misconfigured` / datetime (UTC) | no |
| `providerData` / `previousProviderData` | json / json | no |

Field rules: `providerData` is provider-owned and non-secret, cleared by every Connect (a non-empty value moves to `previousProviderData`) and set with `updateProviderData`, which also clears `previousProviderData`; the core reads it only as empty or not (`hasExternalAccount`). A Refresh without `refresh_token` keeps the stored one, and without `scope` keeps `grantedScopes`. `lastFailureClass`/`lastFailureAt` are diagnostics, written only under the lock, never authoritative, cleared by the next successful Refresh or Connect (so after the admin fixes the Client Configuration, an idle grant keeps `oauth.client_misconfigured` until its next Refresh). Per-field notes: Phase 1 feature spec.

**Invariants**
- **I1 Single refresher.** At most one Refresh of a live grant per Grant Owner is in flight, cluster-wide.
- **I2 Serialized writes.** Every grant write (Connect, `updateProviderData`, Refresh, Disconnect) takes the Grant Lock, re-reads the grant and does all its DB I/O in the lock transaction; the write, its log entries and the lock release commit atomically.
- **I3 Trustworthy status.** A grant becomes `invalidated` only from a terminal outcome observed under the lock (`invalid_grant`, or an expired access token with no stored refresh token), and `active` only through a successful Connect.
- **I4 Secret isolation.** Grant secrets never appear in the admin credentials API, logs or telemetry, health `details`, or `sync_runs.parameters`.
- **I5 Real disconnect (live database).** Once a Disconnect's lock section commits, the live database holds no decryptable refresh token for the owner, whatever happens to revocation; an unreadable grant is erased only with `force: true`. Access tokens already handed to running work stay valid until their `expiresAt`; Disconnect ends the ability to obtain new ones. Earlier backups and replicas keep the encrypted blob until their retention expires; provider-side revocation is the only control over that residue, and security reviews are told exactly this.
- **I6 Bounded lock.**
  - The holder makes at most one token-endpoint call, bounded at 10 s for the whole exchange, body included; waiters hold no connection, and their deadline is 15 s (5 s for Disconnect), then `transient`.
  - The holder keeps one extra pooled connection (the lock transaction) for at most that exchange, outside the stalled-holder cases of §1.4.6, so concurrent holders per process are bounded (Phase 1 feature spec).
  - The DEK is pinned once per operation and resolved before the lock; the decrypt and the encrypt under the lock use the same DEK.
  - Encryption switched off (`TENANT_DATA_ENCRYPTION=no`) is a supported mode, not an outage: nothing is pinned, and the grant is written and read as plaintext at both layers, like the Client Configuration. "No DEK" in this document always means encryption is on and the KMS supplied no key. A grant sealed while encryption was on counts as "no DEK" once it is switched off: `platform_unavailable`, never overwritten by a Connect, replaced only by a forced Disconnect followed by a Connect (§1.4.5).
  - No token call without a readable grant: the token endpoint is called only if the grant decrypted with the pinned DEK (or was stored as plaintext with encryption off) and validated.
  - The lock fork is detached from the caller's context: never nested in a caller's transaction, it keeps the request's subscribers (including tenant field encryption) and runs the lock SQL in the lock transaction.
  - The field-level encryption layer follows platform behaviour and isn't pinned (§1.4.6). Mechanics: Phase 1 feature spec.
- **I7 Strict ownership.** A lookup for owner X never returns owner Y's grant; per-user lookups (Phase 3) must not use `getRaw`'s user→tenant fallback. Owners are independent locally; coupling through a shared Provider Authorization is outside the core's control (Q8).
- **Transaction-bound services.** Inside the lock the grant service builds the credentials and log services from the core factories bound to the lock transaction, so DI overrides of `integrationCredentialsService` don't apply to grant rows (a contract note, §10.1); Disconnect erases through `eraseIntegrationCredentials`.
- **No command bus.** Grant writes are service-direct, like the module's credentials and state writes (the integrations module has no commands): a command's undo snapshot and action log would carry token material (I4), and the lock transaction owns the write. The integration log is the audit trail; Connect, External Account selection and Disconnect entries carry the acting user's id.

**Revision rule.** `updateProviderData` and `disconnect` take `expectedRevisedAt` (the value the admin's screen was built from) and compare it with the stored `revisedAt` under the lock, after decrypt, with the platform's `assertOptimisticLock` (`resourceKind: 'integrations.oauth_grant'`); a mismatch writes nothing and returns the standard 409 (`surfaceRecordConflict` on the tab). Connect is last-writer-wins and takes no revision; Refresh never moves `revisedAt`, so background refreshes don't invalidate open screens. A forced Disconnect over an unreadable blob erases without the check. Provider routes MUST send the value (§1.4.3). **`IntegrationState.reauthRequired`** is not written in Phase 1: the grant service never touches `integration_states` and the banner reads the grant status. Projecting Grant Status onto the flag is a Phase 3 item shipped with the notification, and depends on the independent `upsert` defaults fix; stored rows are not remediated.

#### 1.4.3 Provider Descriptor

The code-level contract; values are provider-owned. Passed to every grant-service call except `readGrantStatus`; no global registry. Every descriptor-taking entry point validates the whole descriptor and checks `descriptor.integrationId === owner.integrationId`, throwing `OAuthDescriptorError` (a programming error, not a Connect Failure) before any I/O.

| Field | Type | Default |
|---|---|---|
| `integrationId` | text (= the Grant Owner's) | required |
| `authorizationEndpoint`, `tokenEndpoint` / `revocationEndpoint` | url / url (RFC 7009; absent ⇒ `oauth_revocation_unsupported`) | required / — |
| `clientAuthMethod` | `client_secret_basic` \| `client_secret_post` | `client_secret_basic` |
| `pkce` | `S256` \| `none` (only for a provider that rejects PKCE) | `S256` |
| `defaultScopes` / `extraAuthorizeParams` | text, multi / json | required / `{}` |
| `requiresRefreshToken` | boolean (checked at Connect only) | `true` |
| `defaultAccessTokenTtlSec` / `refreshSkewMs` | integer (TTL when `expires_in` is missing) / integer (default `minValidityMs`) | `3600` / `120000` |
| `onAfterDisconnect(ctx)` | hook, run after release within an 8 s budget; MUST honour `ctx.signal` | — |

The exported `IntegrationCredentialFieldOauth` is a form-field declaration and stays untouched (STABLE); Phase 3's generic renderer derives the `oauth` field from a descriptor. Endpoints are code constants, so the token and revoke calls need no SSRF guard; tenant-configurable endpoints would require `safeOutboundFetch` and a mix-up review (R1). Each call bounds the whole exchange, body included (Phase 1 feature spec). **Protocol helpers** (P2a): `createPkcePair()`, `resolveOAuthRedirectUri(req | undefined, path)` (`APP_URL` only, never the request origin, Q9), `buildAuthorizationUrl(...)` (requires a `codeChallenge` unless `pkce` is `none`), `exchangeAuthorizationCode(...)`. Signatures: Phase 1 feature spec.

**Provider route contract (normative; the long-form contract is a P6 docs page).** The core owns the helpers; the provider owns the routes and the tab. Every provider implementation MUST:
1. Require `integrations.credentials.manage` on initiate, callback, External Account save and Disconnect. Run the platform's registry mutation guards with `runRouteMutationGuards` (`@open-mercato/shared/lib/crud/route-mutation-guard`; `resourceKind: 'integrations.oauth_grant'`; operation `custom` for the callback, `update` for External Account save, `delete` for Disconnect), return its response when blocked, and call `runAfterSuccess()` only after the grant write commits. On initiate, External Account save and Disconnect, in this order: reject with 403 a super admin acting in another tenant (the auth context carries an `actorTenantId` that differs from `tenantId`; never decided by role name); reject with 403 an explicitly empty organization scope (`resolveOrganizationScopeForRequest` and `isExplicitlyEmptyOrganizationScope`, `UPGRADE_NOTES.md`); resolve the organization with `resolveActiveOrganizationId(auth)`, as the credentials route does ("all organizations" falls back to the admin's own organization), answering `organizationScopeRequiredResponse()` (400) only when it returns `null`; then reject with 403 a user without `integrations.credentials.manage` in that organization (`rbacService.userHasAllFeatures`, wildcard-aware), because the dispatcher checks the feature in the switcher's organization.
2. Bind the state to the Grant Owner: the callback takes the owner from the verified state, never the current organization selection, and checks that the state's tenant is the session's tenant and that the user still holds `integrations.credentials.manage` in the state's organization (mismatch → `connect_state_invalid`).
3. Verify the state with `expectedProviderKey` and `expectedState` set, then, before the code exchange, call `consumeOAuthStateOnce` with the request container's `cache`: the state is single-use and expires after ≤ 5 min. A replayed state, a `cache` that can't be resolved or a failing store call → `connect_state_invalid` (fail closed). Single use holds across replicas only with `CACHE_STRATEGY=redis`.
4. Store the PKCE verifier in the state `extra` and pass it to `exchangeAuthorizationCode`.
5. Use a provider-specific cookie name, never the hub's `om_cc_oauth_state`.
6. Build the redirect URI with `resolveOAuthRedirectUri(req, path)` in both legs, passing the request.
7. On External Account save and Disconnect, carry the Grant Revision (`buildOptimisticLockHeader` → `readOptimisticLockExpected` → `expectedRevisedAt`) and return the grant service's standard 409 body.
8. Show the redirect URI on the tab with a copy button; disable Connect and Reconnect while `inspectGrant().baseUrlMissing`.
9. Not declare `defaultState.isEnabled: true` until the `upsert` defaults fix (issue [#6915](https://github.com/open-mercato/open-mercato/issues/6915)) lands (otherwise the first health run, or any state write without `isEnabled`, silently disables the integration).
10. In state `unavailable`, offer "Replace unreadable connection" behind a confirm dialog only when `inspectGrant` reports an unreadable envelope; with no DEK or an unopened field-level layer (including a grant sealed before encryption was switched off), offer "Disconnect anyway" (`force: true`) instead, behind a confirm dialog saying that the app must also be removed at the provider. Carry `replaceUnreadable` only in the encrypted state, strictly parsed from `extra`, never as a callback query parameter; every other Connect passes `false`.
11. Before `updateProviderData`, compare the selection with `previousProviderData`: a different External Account is saved only after the admin confirms a warning that existing sync cursors and external-id mappings refer to the previous one. With no `previousProviderData` but existing cursors or mappings (after `replaceUnreadable` or a Disconnect), warn that the account can't be verified.

#### 1.4.4 Domain events and signals

Deliberately **not** added (each ID is frozen once added, so each arrives with its first consumer in Phase 3):
- `integrations.oauth_grant.invalidated`: the Phase 1 signals are the banner (`readGrantStatus`) and the health badge (`mapInspectionToHealth`).
- `integrations.oauth_grant.connected` / `.disconnected`: no consumer yet; the integration log is the audit trail.
- Notification `integrations.integration.reauth_required`: the banner and the badge cover Phase 1.
- Emissions of `integrations.state.updated` and `integrations.credentials.updated`: grant writes emit neither.

**Log codes:** written with `integrationLogService.write` under the plain `integrationId`, full code `integrations.oauth_<reason>`, no secrets (I4); every disconnect entry carries a `disconnectId`.

| Log code | Level | Written by | On |
|---|---|---|---|
| `integrations.oauth_connected` / `integrations.oauth_external_account_selected` | info | `completeConnect` / `updateProviderData` | the lock transaction |
| `integrations.oauth_connect_persist_failed` | warn | `completeConnect`, after a rollback or a failed DEK resolution | a context-detached fork |
| `integrations.oauth_invalidated` | warn | the refresh that observed the terminal outcome, exactly once | the lock transaction |
| `integrations.oauth_disconnected` + `integrations.oauth_revocation_pending` | info + warn | `disconnect` | the erase transaction |
| `integrations.oauth_revocation_confirmed` / `integrations.oauth_revocation_unsupported` / `integrations.oauth_revocation_skipped_reconnected` / `integrations.oauth_revocation_skipped_invalidated` | info | `disconnect`, after release (the skips attempt nothing) | a context-detached fork |
| `integrations.oauth_revocation_failed` | error | `disconnect`, after release: provider error, `hook_failed` or `undecryptable` | a context-detached fork |

**Reported errors:** every path that records a failure without rethrowing also reports it through the platform's `reportError` (code `integrations.oauth_<reason>`, no token material); `oauth_revocation_failed` is reported through its `error`-level entry. Call sites: Phase 1 feature spec.

**Health codes** (`OAUTH_HEALTH_CODES`): the provider's health check returns `mapInspectionToHealth(await inspectGrant(...))`, a pure mapping that never puts a token in `details`; the grant service never writes health.

| Health code | Status | From `inspectGrant` (precedence top to bottom) |
|---|---|---|
| `oauth.platform_unavailable` | unhealthy | `status: 'unavailable'`, or `connectionState: 'unavailable'` (an unreadable Client Configuration) |
| `oauth.not_connected` | unhealthy | `status: 'none'` |
| `oauth.invalidated` | unhealthy | `status: 'invalidated'` |
| `oauth.client_changed` | unhealthy | `clientChanged` |
| `oauth.client_misconfigured` | unhealthy | `lastFailureClass: 'client_misconfigured'` |
| `oauth.transient` | degraded | `lastFailureClass: 'transient'` |
| `oauth.scope_drift` | degraded | `missingScopes` non-empty |
| `oauth.connected` | healthy | otherwise |
| `oauth.scope_insufficient` | unhealthy | never from `inspectGrant`; only from the provider's own resource call |

A missing DEK shows through the existing platform path (the health run fails, the detail page shows `unconfigured`), not through these codes. The badge reads the last probe: up to 15 min behind a grant change in the organization the scheduled probe covers (it is registered once per tenant); in the tenant's other organizations it changes when an admin runs the manual health check ("Run Check"). The banner (§3.5) reads the grant live. **The health check is not a refresher:** `inspectGrant` makes no token call, takes no lock and writes nothing (R10). **Keep-alive is explicit (Q6):** a provider-owned job calls `getAccessToken({ forceRefresh: true })` for enabled integrations whose grant has idled past a provider-chosen threshold; enumeration is the consumer's (`listGrantOwners` is Phase 3). **Revocation state** is derived, not stored: with no live grant, `inspectGrant` returns `lastDisconnect: { at, disconnectId, revocation: 'pending' | 'confirmed' | 'failed' | 'unsupported' | 'skipped' }` from the disconnect log entries; the tab treats `pending` older than 5 minutes as "revocation not confirmed".

#### 1.4.5 Failure classification (the trust contract)

**Token Provider (`getAccessToken`).** Observations are made under the Grant Lock after a re-read, unless noted. "Unchanged" means status and tokens; diagnostics follow §1.4.2.

| Token Failure | Meaning | Grant effect | Retry |
|---|---|---|---|
| `grant_invalidated` | the grant is `invalidated` (no network call), or Refresh got `invalid_grant` (`grant_rejected`), or the access token expired with no refresh token stored (`no_refresh_token`) | `invalidated`, in the same commit as `oauth_invalidated` | no; Reconnect |
| `client_misconfigured` | `invalid_client` / `unauthorized_client`; another permanent 4xx (`token_endpoint_rejected`, with the provider code); the grant's `clientId` differs from the Client Configuration (`client_changed`, on read); no Client Configuration, or an empty `clientId` or `clientSecret` (`client_not_configured`) | unchanged, `active` | no; the admin fixes the configuration |
| `transient` | network error, timeout, 5xx, 429, non-JSON, `temporarily_unavailable`, `server_error`, lock deadline, or a transient DB error; a `rejectedAccessToken` call over an unexpired grant with no stored refresh token | unchanged | back off; a stored token still valid at call time is returned `degraded` (never for a `rejectedAccessToken` call) |
| `platform_unavailable` | no DEK (including a grant sealed before encryption was switched off), a field-level layer that couldn't be opened, or a blob that doesn't decrypt or validate; no token call (I6) | unchanged, never invalidated | fail closed; may be transient (a KMS outage) |
| `not_connected` | no live grant | — | no; "Connect first", never "reconnect" |

- **After a resource `401`** the caller passes `rejectedAccessToken`: one forced Refresh only if the stored token still equals it and wasn't refreshed since the call started; a second `401` is a resource error, never `grant_invalidated`.
- **One refresh per window:** no call refreshes if `refreshedAt ?? obtainedAt` is at or after its start, which bounds `forceRefresh`, `rejectedAccessToken` and a large `minValidityMs` alike (I1). A `minValidityMs` at or above the access-token lifetime still refreshes on every later call, so providers keep it below the lifetime.
- **No retry storm:** a waiter returns a holder's `transient` or `client_misconfigured` recorded after its own start, without calling the token endpoint.
- **Anti-corruption:** token responses are validated at the boundary; a Refresh 200 carrying a `refresh_token` with an unusable access token persists only the refresh token and returns `transient`.
- **Scope:** Refresh never sends `scope`; scope drift is advisory (`oauth.scope_drift`). An insufficient-scope challenge (`scope_insufficient`) triggers no refresh, leaves the grant `active` and is recorded nowhere in Phase 1; the run ends run-terminal (§6), and recovery is adding the scope to the Client Configuration and reconnecting. A consent granting fewer scopes than requested shows `oauth.scope_drift`.

**Connect Failures** (provider initiate and callback); none changes an existing grant:
- `connect_cancelled`: `error=access_denied`. `connect_state_invalid`: missing, expired, replayed or mismatched state (rules 2–3), a state store that can't record the single use (rule 3), or a missing PKCE verifier.
- `connect_exchange_failed`: the code exchange fails (`invalid_grant`, a verifier or redirect-URI mismatch, network, an invalid response), or no `refresh_token` while `requiresRefreshToken`, except on a Reconnect over an `active` grant with the same `clientId`, which keeps the stored one (over an `invalidated` grant it stays `invalidated`).
- `connect_grant_unreadable`: a plain Reconnect over a grant whose blob envelope doesn't decrypt or validate with the pinned DEK. `connect_persist_failed`: the exchange succeeded but `completeConnect` couldn't commit (lock deadline, no DEK, an unopened field-level layer, DB); logged on a context-detached fork.
- `client_misconfigured`: `invalid_client` / `unauthorized_client` on the exchange, or no Client Configuration at initiate. `organization_scope_required`: no organization could be resolved (rule 1). `oauth_base_url_not_configured`: no `APP_URL` in production. `connect_origin_rejected`: the request's origin isn't an allowed app origin (Q9).
- Tokens obtained by a failed Connect are discarded, not revoked: revoking could also revoke a Provider Authorization shared with an existing grant (Q8).

**`replaceUnreadable`.** Only a blob envelope that doesn't decrypt or validate with the pinned DEK counts as an unreadable grant, and only the admin's explicit confirmation, `completeConnect(..., { replaceUnreadable: true })` carried in the verified state (rule 10), overwrites it like a first Connect (no refresh token kept, no `previousProviderData`). An unopened field-level layer or a missing DEK (including a grant sealed before encryption was switched off) is never overwritten, flag or not: Connect fails `connect_persist_failed`, and only a forced Disconnect followed by a Connect replaces such a grant. How the read tells the layers apart: Phase 1 feature spec (layered read).

**Grant writes** (`updateProviderData`, `disconnect`), in check order: DEK (before the lock; nothing to pin with encryption off), lock, live row, decrypt and validate, revision. With readable tokens, `force` changes nothing; the tab offers it only in state `unavailable` (rule 10).

| Operation | Observation | Result | Grant after |
|---|---|---|---|
| both | lock deadline (15 s; 5 s for `disconnect`) or a transient DB error | `transient` | unchanged |
| `updateProviderData` / `disconnect` | no live grant | `not_connected` (for `disconnect` a no-op with no log entries) | — |
| `updateProviderData` | no DEK, unopened field-level layer, or unreadable blob | `platform_unavailable` | unchanged |
| `disconnect` (default) | no DEK, unopened field-level layer, or unreadable blob | `disconnect_tokens_unreadable` (retryable; nothing erased, no revoke) | unchanged |
| `disconnect({ force: true })` | same | erased without the tokens and without a revision check; `oauth_revocation_failed` (`undecryptable`) | tombstone |
| both | readable grant, stale `expectedRevisedAt` | 409 (standard conflict body) | unchanged |

#### 1.4.6 Provider rotation semantics (provider documentation)

| Rotation | Access TTL | Refresh token on refresh | Old refresh token after use | Concurrent-refresh race |
|---|---|---|---|---|
| **Strict** (RFC 9700 §4.14.2) | provider-defined | a new one every time | invalid, possibly after a short reuse-grace window; some providers also expire unused refresh tokens | **Harmful.** Which child of the same parent survives a double redemption is generally undocumented, so two concurrent refreshes can lose the grant. Must lock. |
| **Non-revoking** (Microsoft, MS365 PR) | ~1 h | a new one every time | **not revoked**; 90-day lifetime | benign (a wasted call) |
| **None** (Google, Gmail) | 1 h | usually none | valid until revoked or expired | benign (a wasted call) |

Residual risks (accepted; the stalled holder and the field-level layer are detailed in the Phase 1 feature spec):
- **Persist window (Q1):** a crash or DB failure between a successful Refresh and its commit loses the rotated token; recovery relies on the provider's reuse-grace window, otherwise the grant becomes `invalidated` (visible, not silent). Probability ≈ failure rate × the ~200 ms persist window, longer only on a write that repairs the scope's credentials encryption map while another transaction holds that row (stalled lock holder, below).
- **KMS fallback:** a Connect during a Vault outage with a fallback key seals the grant with the derived key; after recovery it reads `unavailable` and needs a Reconnect confirmed with `replaceUnreadable` (or a forced Disconnect). The reverse also holds while the field-level DEK cache is warm: an operation that starts during the outage pins the derived key, so a healthy grant sealed with the Vault DEK reads as an unreadable envelope, and confirming Replace would seal it under the derived key again. Pre-existing platform behaviour.
- **Field-level layer:** not pinned; a fallback-derived DEK cached up to 15 minutes can make healthy grants read `unavailable` and seal writes with the derived key, after which only a forced Disconnect followed by a Connect replaces them. Without a fallback the layer may be skipped on write; the blob envelope still encrypts every secret.
- **Stalled lock holder:** the backstop is `idle_in_transaction_session_timeout` (120 s). It is reachable through a field-level KMS response whose body stalls (a Refresh in that transaction then loses its rotated token, the Q1 path), or through a caller that ignores the Token Provider rule after creating or repairing the scope's credentials encryption map in its own transaction (the caller's session is ended instead and the grant write commits; with a shorter `DB_LOCK_TIMEOUT_MS` or `DB_STATEMENT_TIMEOUT_MS` the holder fails `transient` first, the Q1 path; Phase 1 feature spec).

#### Checklist

- [x] Entities with ownership; invariants I1–I7; failure contract; precise fields; access control (§2)

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---|---|---|---|---|---|
| Tenant Admin | features `integrations.view` + `integrations.manage` + `integrations.credentials.manage` (default `admin` role) | internal | the active organization ("all organizations" → the admin's own; never another tenant's, rule 1) | integration detail, reauth banner, the provider tab, logs, health | enters the Client Configuration; enables the integration; Connect / Reconnect / Disconnect; chooses the External Account |
| Integration Viewer | `integrations.view` (default `employee` role) | internal | active organization | status, the health badge and the banner (without the Reconnect link); no logs, no secrets | nothing mutating |
| Operator | n/a (deployment) | — | — | health `details.code`, server logs | configures `APP_URL`, KMS/Vault and the encryption keys |
| Background Worker | system (job scope) | internal (no user) | the job payload's scope | — | calls the Token Provider |
| Integration Developer | n/a (code author) | — | — | core APIs, AGENTS.md | writes a descriptor, provider routes and a health check |
| Mailbox User (Phase 3 only) | `communication_channels.connect_user_channel` | internal | own user | own channels | per-user connect (hub unchanged) |

A single authenticated surface (the backend); **Portal: NOT USED.** Connecting a tenant's third-party system is an administrative act gated by the existing `integrations.credentials.manage` (403 otherwise); no new ACL feature (it would be FROZEN, and the default `admin` and `superadmin` roles already hold `integrations.*`); a grant is always scoped to one organization (unresolvable → 400 `organization_scope_required`). The Token Provider is not an authorization boundary: it trusts the Grant Owner it is given, so callers take the owner from a platform-built job payload or from a route that already checked `integrations.credentials.manage` and the organization (rule 1), never from request input.

#### Checklist

- [x] One identity type per persona; justified; organization scoping; single surface recorded

## 3. Workflows `PM`

### WF1: Connect a provider (tenant-level)

**Journey:**
1. The admin copies the redirect URI shown on the provider tab, registers the app in the provider console, then enters the Client ID and Secret and enables the integration (until the Connect, health reports `oauth.not_connected`). Each organization of a tenant connects separately.
2. Connect: the provider's initiate route creates a PKCE pair, stores the verifier and the Grant Owner in the single-use state, and redirects to the provider's consent screen.
3. The callback verifies the state, takes the Grant Owner from it, exchanges the code with the verifier and calls `completeConnect` under the Grant Lock: the grant is stored `active` (in place over a live grant), `providerData` is cleared, `revisedAt` is set, `oauth_connected` is logged.
4. If the provider has External Accounts, the admin chooses one (automatically when there is one), stored with `updateProviderData(..., { expectedRevisedAt })`; the admin starts the first sync (or the next scheduled run does), and it succeeds.

**ROI:** time-to-first-sync ≤ 5 min (Phase 2 sandbox QA, excluding the provider's screens), with no manual token handling.\
**Boundaries:** starts when the admin opens the provider tab; ends when the first sync after the Connect succeeds. NOT this: sync scheduling and retry (data_sync); changing the External Account later (provider-owned, via `updateProviderData`).\
**Edge cases:**
1. Abandoned consent or a wrongly registered redirect URI: the state expires in 5 min, nothing is written. An abandoned account choice leaves the grant Account pending (the adapter refuses with its own precondition error, never a reauth).
2. A replayed callback fails `connect_state_invalid` (single-use state, `consumeOAuthStateOnce`, rule 3); an injected code without the verifier fails `connect_exchange_failed`. Reconnect updates the live row in place and doesn't revoke the previous refresh token (the Provider Authorization may be shared); over an `invalidated` grant, a response without a refresh token fails `connect_exchange_failed`.
3. Concurrent admins: a selection against a since-reconnected grant gets 409; two Reconnects are last-writer-wins; the owner comes from the state, so an organization switch mid-consent doesn't matter.
4. `connect_persist_failed`, or an unreadable live grant (`connect_grant_unreadable` unless confirmed with `replaceUnreadable`): the existing grant is untouched.

### WF2: Obtain a valid access token in background work

**Journey:**
1. A sync worker (any process) calls `getAccessToken(descriptor, owner, { minValidityMs })`; the DEK is resolved and pinned once (none → `platform_unavailable`, no lock; nothing to pin with encryption off), and an `active`, fresh token is returned with no lock.
2. Otherwise the worker tries the lock: acquired → re-read → still stale and not refreshed since the call started → Refresh → commit; not acquired → back off and re-read, holding no connection.
3. The token is returned and used; on a `401` the worker calls once more with `rejectedAccessToken`, and on an insufficient-scope challenge it stops that call.

**ROI:** at most one non-forced token-endpoint call per grant per expiry window, whatever the number of processes; false invalidations only through the §1.4.6 persist window; 0 pool exhaustion from waiting.\
**Boundaries:** starts at any API call that needs a token; ends when a token is returned or a Token Failure is raised. NOT this: sync retry policy (data_sync).\
**Edge cases:**
1. Five import workers across two processes hit expiry together (pool max 20): one refresher, the rest wait without connections; a keep-alive colliding with an expiry refresh skips (one refresh per window).
2. The token endpoint hangs: the 10 s whole-exchange bound gives `transient`; a still-valid token is returned `degraded`, and waiters don't retry the call. A failure between Refresh and commit is the §1.4.6 residual risk.
3. Vault times out, or the grant was sealed with another key: no token call, `platform_unavailable`, grant unchanged.
4. The token endpoint answers `invalid_grant`: the grant is invalidated under the lock (start of WF3).

### WF3: Lost consent, from provider rejection to resumed sync

**Journey:**
1. A refresh under the lock gets a terminal outcome; the grant becomes `invalidated` with `oauth_invalidated` in that transaction; the call returns `grant_invalidated`.
2. The banner appears on the integration detail page, and the health check reports `oauth.invalidated` (the badge follows at that organization's next scheduled probe or a manual health check, §1.4.4).
3. The admin follows the banner's link (`?tab=<connectTabId>`) and reconnects (WF1); the provider pre-selects the previous External Account from `previousProviderData`, and until the admin confirms it the grant is Account pending; the next sync succeeds.

**ROI:** every invalidation is a provider-confirmed terminal response or a missing refresh token, shown within one sync interval for scheduled integrations; recovery time is unbounded in Phase 1 (no push notification until Phase 3).\
**Boundaries:** starts at the provider's terminal response; ends when the first sync after the Reconnect succeeds. NOT this: transient outages and misconfiguration (US-3.2, US-3.3).\
**Edge cases:**
1. The user removes the app at the provider, or the refresh token idles out (prevented for enabled integrations by the keep-alive): `invalid_grant`, invalidated. A mistyped Client ID or a revoked secret gives `client_misconfigured`, never reauth; flapping never touches the status.
2. Scheduled syncs keep running and fail fast with `grant_invalidated` (no token call); pausing them needs the Phase 3 event, and until then the provider keeps them from failing with an error report on every tick (Phase 2 acceptance).
3. A Viewer sees the banner without the link ("ask an administrator").
4. An unreadable grant shows no banner: the tab shows `unavailable` and offers the confirmed replacement or a forced Disconnect (rule 10).

### WF4: Disconnect

**Journey:**
1. The admin confirms Disconnect; the route requires `integrations.credentials.manage`, runs the mutation guards and passes the Grant Revision as `expectedRevisedAt`. The DEK is pinned before the lock (nothing to pin with encryption off); with none, a default Disconnect returns `disconnect_tokens_unreadable`.
2. Under the lock (5 s waiter deadline), in one transaction: no live grant → `not_connected` no-op; read the tokens (unreadable → `disconnect_tokens_unreadable` unless `force: true`); check the revision; blank and soft-delete the row; log `oauth_disconnected` + `oauth_revocation_pending` with a new `disconnectId`. I5 holds from the commit.
3. After release, within budgets (hook ≤ 8 s, revoke ≤ 8 s), re-read before each external call: skip if a live grant exists again (`oauth_revocation_skipped_reconnected`) or the captured grant was `invalidated` (`oauth_revocation_skipped_invalidated`); a forced erase without tokens logs `oauth_revocation_failed` (`undecryptable`).
4. Otherwise run `onAfterDisconnect(ctx)`, then RFC 7009-revoke the most recent refresh token, even if the hook failed (core never persists a token `ctx.refresh` returned), and log the outcome (`oauth_revocation_confirmed`, `oauth_revocation_failed` with the provider code or `hook_failed`, or `oauth_revocation_unsupported`); the response carries it.

**ROI:** 0 decryptable refresh tokens in the live database once Disconnect commits, and a recorded revocation outcome on every Disconnect; the hub's mailbox tokens are unchanged until Phase 3 (Q5).\
**Boundaries:** starts when the admin confirms; ends when the erase has committed and cleanup has finished or been logged, or the Disconnect aborted with nothing changed. NOT this: deleting business data, disabling the integration (it stays enabled, so health reports `oauth.not_connected`), pausing schedules.\
**Edge cases:**
1. The provider is unreachable, or the process dies after the erase: the erase stands; `oauth_revocation_failed`, or `revocation: 'pending'` shown as "revocation not confirmed" after 5 minutes.
2. Disconnect races a refresh: whichever is second re-reads, so an erased grant is never resurrected. A quick Connect (or one whose consent started before the Disconnect) inserts a new row and the cleanup skips: the newer consent wins, because it is the admin's latest intent and a Disconnect can't cancel a consent the provider has already granted. Residual race: a Connect that commits after the re-read but before the provider processes the revoke can still lose its new grant at a provider that revokes the whole authorization (the window is the revoke call, ≤ 8 s).
3. Not undoable, unlike the hub's channel disconnect (Q5); a Provider Authorization shared with another Grant Owner (another organization, or another integration on the same OAuth client and provider account) may break for all of them (Q8, detected only through the provider's API, never another owner's grant, I7).
4. Unreadable tokens abort with `disconnect_tokens_unreadable` (a forced Disconnect erases and logs `undecryptable`); scheduled runs afterwards fail `not_connected`, without an error report on every tick (Phase 2 acceptance).

### WF5: Build a new OAuth provider integration (developer journey)

**Journey:**
1. Declare the Client Configuration fields and a Provider Descriptor, plus provider-owned env preconfiguration when the Client Configuration is deployment-managed (`integrations/AGENTS.md`); write the initiate and callback routes (≈ 30 lines each) on the core helpers and `completeConnect`, under the route contract (§1.4.3).
2. Inject the provider tab (`detailPage.widgetSpotId`), declare `detailPage.connectTabId` equal to the tab widget's `placement.groupId` (a mismatch silently drops the banner link; a provider unit test asserts it), show the redirect URI, and add the External Account picker if needed.
3. Implement the health check as `mapInspectionToHealth(await inspectGrant(...))` and, if needed, a keep-alive; the adapter calls the Token Provider outside its own transactions and `classifyResourceChallenge` on a `401`/`403`. The OAuth health check is network-free by design (R10), an exception to `om-integration-builder`'s real-connectivity rule that P6 documents.
4. Test in Jest against the published fake authorization server, and run the round trip in the provider's E2E suite (Phase 1 feature spec).

**ROI:** ≤ 5 commits for the OAuth part (vs about 9 self-contained); 0 provider-local lock, refresh or PKCE code.\
**Boundaries:** starts when a provider package needs delegated OAuth2 access with a refresh token; ends when connect, token use, health and disconnect run on the core with tests. NOT this: static-key or password-grant providers (Akeneo, InPost, KSeF); user login (SSO).\
**Edge cases:**
1. No rotation (Google-like): no descriptor change; a refresh without `refresh_token` keeps the stored one.
2. No revocation endpoint: Disconnect erases locally and logs `oauth_revocation_unsupported`.
3. The provider rejects PKCE: `pkce: 'none'` (Q2). No External Account: `updateProviderData` is never called.
4. A provider in `official-modules` consumes the published packages, so it starts only after a release containing Phase 1.

#### Checklist

- [x] 5 workflows with journey, ROI, boundaries, edge cases (commits per workflow: §4.2); > 200 new lines only for WF2 (the grant service), justified

## 3.5 UI Architecture `PM + UX`

Navigation unchanged (Settings → Integrations → *provider*); no dashboard widgets; no platform-owned custom pages. **Widget injection (provider-owned):** the provider tab (Connect / Reconnect / Disconnect, the redirect URI with a copy button, the External Account picker) is injected into the integration detail page at `buildIntegrationDetailWidgetSpotId('<integrationId>')`, as a tab whose id is `detailPage.connectTabId`.

**Platform UI change: a reauth banner** in the integration detail header, shown only when the integration's live OAuth grant is `invalidated`:
- **Data source:** the detail API gains an optional `oauthGrant: { status: 'active' | 'invalidated' | 'unavailable' } | null` for the active organization's tenant-level grant (`userId = null`, never a per-user grant), read with `readGrantStatus` (no lock, no provider call, no writes; `unavailable` instead of a 500). It never reads `reauthRequired`, so integrations without a grant never show it.
- **Copy and styling:** "Access to <title> was revoked or expired. Reconnect to resume.", the `Alert` primitive (status `error`), DS tokens only; keys `integrations.detail.oauthGrant.{invalidated,reconnect,askAdmin}` in all five locale files.
- **Link:** to `/backend/integrations/<id>?tab=<connectTabId>` when the definition declares `detailPage.connectTabId` (already returned with `detailPage`), the tab is visible and the viewer has `integrations.credentials.manage`; otherwise no link, and Viewers read "ask an administrator to reconnect". The tab explains any state that blocks Reconnect (`not_configured`, `baseUrlMissing`).
- **`unavailable`:** no banner (a plain Reconnect doesn't replace an unreadable grant); the tab and health show it. **Bundles:** the banner is on the child's page; a child's `not_configured` points to the bundle's Client Configuration. The `oauth` field type stays unrendered (Phase 3).

| Key flows: persona | Task | Flow (from the Integrations list; the detail page opens on the Credentials tab) | Clicks |
|---|---|---|---|
| Tenant Admin | first connect | *provider* → provider tab (copy URI, register) → Credentials (ID, Secret) → Save → enable → provider tab → Connect (→ consent → account) | 9 + typing + provider screens |
| Tenant Admin | recover | *provider* → banner link → Reconnect (→ consent) → confirm the pre-selected account | 4 + provider screens |
| Tenant Admin | disconnect | *provider* → provider tab → Disconnect → confirm | 4 |
| Tenant Admin | replace an unreadable connection | *provider* → provider tab → Replace unreadable connection → confirm (→ consent → account) | 4 + provider screens |
| Integration Viewer | check status | health badge on the list; *provider* for the banner | 0–1 |

**Provider tab states**, headed by the Connection State in precedence order:
- `not_configured`: register the redirect URI, then add the Client ID and Secret. `not_connected`: "Not connected." with the redirect URI. `unavailable`: "This connection can't be read right now", with "Replace unreadable connection" or "Disconnect anyway" behind a confirm dialog (rule 10). Disconnect stays available in every state while a live grant exists.
- `invalidated`: "Access was revoked or expired. Reconnect." `active`, refined by the provider: account pending, or `client_changed` ("revert the Client ID or reconnect").
- After a Disconnect, `revocation` `failed` or `pending` for over 5 minutes: "The provider could not confirm revocation — remove the app in its connected-apps screen." `baseUrlMissing`, in any state: Connect and Reconnect disabled with "Set APP_URL before connecting"; a working grant keeps its state.

#### Checklist

- [x] Click counts from the Integrations list, above the ≤ 3 target (first connect is one-time setup that includes the provider console); recovery via the `?tab=` deep link; platform building blocks only; empty states; portal N/A

## 4. Workflow Gap Analysis `Architect`

### 4.1 Platform commit plan (Phase 1)

The detailed plan (scope, files and tests per commit) is in the Phase 1 feature spec. **Related, independent:** the `upsert` defaults fix is a separate bug fix with its own regression tests (issue [#6915](https://github.com/open-mercato/open-mercato/issues/6915)); the Phase 3 `reauthRequired` projection depends on it, Phase 1 doesn't.

| ID | Commit | Package | Commits |
|---|---|---|---|
| P1a | `withAdvisoryXactLock` helper: namespaced key, context-detached fork, back-off without a held connection, exported transient-DB matcher | `shared/src/lib/db/advisoryLock.ts` | 1 |
| P1b | Real-Postgres lock suite (`testcontainers`, `OM_PG_INTEGRATION`) and its step in the existing `documents-multi-instance` CI job | `packages/shared`, `.github/workflows/ci.yml` | 1 |
| P2a | Hand-rolled protocol client: token endpoint, revoke, PKCE, authorization URL, code exchange, resource challenge, descriptor validation, redirect URI | `core/.../integrations/lib/oauth/*` | 1 |
| P2b | Fake authorization server and the `oauthGrantFixtures` re-export | `integrations/lib/oauth/testing`, `core/src/helpers/integration` | 1 |
| P3 | `eraseIntegrationCredentials`, an optional third `kms` option on `createCredentialsService`, the layered read, the latest-log-by-code query; core's real-Postgres gate and its step in `documents-multi-instance` | `integrations/lib/{credentials,log}-service.ts`, `packages/core`, `.github/workflows/ci.yml` | 1 |
| P4a | Test-only route `POST /api/integrations/test-oauth-grants`, flag-gated test integration, Playwright wrapper | `integrations`, `cli`, `.github/workflows/ci.yml` | 1 |
| P4b | `integrationOAuthGrantService` with `completeConnect`; the shared `pgTestOrm` harness | `integrations/lib/oauth/grant-service.ts` | 1 |
| P4c | `getAccessToken` and Refresh under the lock with the full classification | `integrations/lib/oauth/grant-service.ts` | 1 |
| P4d | `updateProviderData`, `inspectGrant`, `readGrantStatus`, `OAUTH_HEALTH_CODES`, `mapInspectionToHealth` | `integrations/lib/oauth/{grant-service,health}.ts` | 1 |
| P4e | `disconnect` with `force` and the `onAfterDisconnect` hook | `integrations/lib/oauth/grant-service.ts` | 1 |
| P5 | Detail GET `oauthGrant` field, reauth banner, i18n | `integrations` (+ `IntegrationDetailPageConfig` in `shared`) | 1 |
| P6 | Docs page (route contract, health mapping, test harness), BC section, publish-shape check | docs, `scripts`, `.github/workflows/ci.yml` | 1 |

### 4.2–4.5 Per-workflow totals

| Workflow | Platform | First provider (official module) |
|---|---|---|
| WF1 Connect | P1a, P2a, P4b, P4d | 3: routes on the core helpers; External Account picker + tab; descriptor + client fields |
| WF2 Token | P1a, P1b, P2a, P3 (KMS), P4c | 1: adapter via the Token Provider; health check via `inspectGrant`; keep-alive if needed |
| WF3 Lost consent | P4c (invalidation), P4d (health map), P5 (banner) | 0 |
| WF4 Disconnect | P1a, P3, P4e | 1: `onAfterDisconnect` cleanup + disconnect button |
| WF5 Developer | P2b (fake server, `oauthGrantFixtures`), P4a (test route, Playwright wrapper), P6 | — |
| | **12** | **~5** |

### 4.6 Options compared

| Option | Platform | First provider's OAuth | Next tenant-level provider | Risk |
|---|---|---|---|---|
| **A. Narrow fix:** the platform adds only the lock (P1a/P1b) and erase (P3); the first provider is self-contained | 3 | ~9 | ~9 (a copy) | the hardest code (I1–I3, I6) re-implemented per provider; no shared reauth banner or health mapping |
| **B. Grant-lifecycle core (recommended)** | 12 | ~5 | ~5 | one DI service + one import surface to maintain |
| **C. Full toolkit:** B + generic routes and Connect UI, hub migration, state generalization | ~17 | ~2 | ~2 | account picking and an external callback URL fixed from a single example |

A is right only if maintainers want no new platform surface before a second tenant-level consumer; B makes correct grant handling the standard and saves about 4 commits per later provider; C is premature. Cumulative commits for 1, 2 and 3 tenant-level providers are 12/21/30 under A and 17/22/27 under B, so B costs more until the third provider; before that, its case is risk: I1–I3 and I6 written and tested once. Detailed plan: Phase 1 feature spec.

#### Checklist

- [x] Commits counted per workflow (§4.2); architect checkpoint done

## 4.5 Module Architecture `Architect`

### 4.5.1 Platform capabilities used

- **Credential store, DI `kmsService` and `tenantEncryptionService`:** extended with the erase function, an optional third `kms` option on `createCredentialsService` (after its existing `encryptionService`), the grant-path `CredentialsWriteOptions.ensureEncryptionMap`, the layered read and the sibling key; grant rows use the core factory bound to the lock transaction, with one KMS instance per operation in the internal `pinTenantDek` adapter (I6).
- **Health, logs, state:** used; core adds `OAUTH_HEALTH_CODES`, `mapInspectionToHealth` and a latest-entries-by-code query; `setReauthRequired` is unused in Phase 1. **Detail page:** extended with the banner and `detailPage.connectTabId`; the provider tab uses `detailPage.widgetSpotId` and `?tab=`.
- **Optimistic locking:** `assertOptimisticLock` on `revisedAt` in the grant service (the only source of the 409), with `buildOptimisticLockHeader`, `readOptimisticLockExpected` and `surfaceRecordConflict`.
- **Used as-is:** the hub state cookie (`communication_channels/lib/oauth-state`), `getSecurityEmailBaseUrl`, the tenant encryption subscriber (carried into each lock transaction), data_sync (adapters call the Token Provider), `reportError` (every recorded failure, §1.4.4), `runRouteMutationGuards` and `resolveActiveOrganizationId` (provider routes, rule 1); the real-Postgres suites run as steps of the existing `documents-multi-instance` CI job (P1b, no new job).

### 4.5.2 Where it lives, justified against each charter

| Candidate | Decision | Why |
|---|---|---|
| `packages/shared` | **lock helper only** | pure DB infrastructure with ≥ 8 potential users; grant storage needs a core module's service, and protocol code has no consumer outside core |
| `packages/core` → `integrations` | **everything else** | owns the credential store, state, health, logs and detail page; the fake server follows the runtime-fake precedent (module code never imports `helpers/`) |
| `packages/core` → `helpers/integration` | **fixtures only** | `oauthGrantFixtures` (re-export, free of `@playwright/test`) and `oauthGrantTestRoute` (Playwright wrappers) |
| `communication_channels`; a new `@open-mercato/oauth` package | untouched; rejected | not a channel concern (provider routes import its state cookie read-only); a package is justified only to isolate a third-party dependency, which hand-rolling removes |

The new runtime surfaces are server-only (under `lib/`); a test asserts that no `.tsx` imports `integrations/lib/oauth`.

### 4.5.3 Library vs hand-rolled

**Hand-roll** the client side of authorization-code + PKCE + refresh + revoke (≈ 150 lines; `requestOAuthToken` already runs in production). Libraries add what isn't needed (discovery, ID tokens, DPoP, PAR, JAR, JARM), don't solve storage, locking or classification, and `openid-client`/`oauth4webapi` are ESM-only (a Jest config change in core and every provider package, plus a production dependency of core; `oauth4webapi` is already in the lockfile only through enterprise `openid-client`). **Revisit trigger:** a consumer needs DPoP, PAR, `private_key_jwt`, ID-token validation or tenant-configurable endpoints; then adopt `oauth4webapi` behind the same interface. The hub's `requestOAuthToken` stays untouched until the Phase 3 migration.

### 4.5.4 Boundary with SSO: two deliberate layers

SSO (enterprise) is an OIDC relying party for **login**; the grant core is an OAuth client for **delegated API access**. They would share about 40 lines (PKCE, the state cookie), and core may not import enterprise. **Keep them separate**; extracting the PKCE and state-cookie crypto into `shared` is a Phase 3 option.

### 4.5.5 Shared modules

PROPOSED, all new: `shared/lib/db/advisoryLock` (generic; existing sites may adopt it), `integrations/lib/oauth` (integration-generic, no provider logic), and the published test infrastructure `integrations/lib/oauth/testing/fakeAuthorizationServer` + `core/helpers/integration/oauthGrantFixtures` + `core/helpers/integration/oauthGrantTestRoute`.

### 4.5.6 App modules

None in this repository; the first consumer is an official module with its own spec. Delivery order under the recommended gate (Q7, pending sign-off): the Phase 1 PR, kept open → a package preview of `@open-mercato/shared` and `@open-mercato/core` (maintainer-dispatched, same-repository branch only; otherwise `yarn pack` tarballs or Verdaccio) → an official-module draft PR passing against it → the Phase 1 merge → a release → the official module bumps its peer dependencies and merges.

#### Checklist

- [x] All items; the modifications to `integrations` are the upstream contribution itself (flagged)

## 5. User Stories `PM`

> Stories describe a generic tenant-level provider; a provider-specific spec adds its External Account and cleanup details. Every write story fails with 403 without `integrations.credentials.manage`.

### WF1

| Story | Happy outcome | Key failure | Commits |
|---|---|---|---|
| **US-1.1** As a Tenant Admin, I connect a provider for my organization so that scheduled syncs can run. | exactly one live `active` grant and one `oauth_connected` entry; the chosen External Account in `providerData` with one `oauth_external_account_selected` entry | any Connect Failure leaves an existing grant untouched; a selection against a since-reconnected grant gets 409 | P1a, P2a, P4b, P4d + 3 provider |
| **US-1.2** As an Integration Developer, I build the initiate and callback routes from core primitives so that I write no PKCE, token-POST, lock or storage code. | each route ≤ ~30 lines under the route contract; every grant write via `completeConnect` / `updateProviderData` | a malformed or mismatched descriptor throws `OAuthDescriptorError` before consent and any I/O | P2a, P4b, P6 |

### WF2

| Story | Happy outcome | Key failure | Commits |
|---|---|---|---|
| **US-2.1** As the Background Worker, I get a valid access token however many processes ask, so that a rotation race never costs the grant. | 1 refresh for 20 concurrent callers over ≥ 2 sessions, all get the same token, 0 `invalid_grant`, 0 acquire timeouts with `poolMax=4` and 10 waiters | timeout → `transient` (a valid token `degraded`); unreadable grant → `platform_unavailable`, no token call | P1a, P1b, P2a, P3, P4c + 1 provider |
| **US-2.2** As the Background Worker, after an API `401` I retry once with a fresh token, so that an early-revoked token doesn't fail the batch. | one forced refresh only if the stored token still equals `rejectedAccessToken` and is older than the call | the forced refresh fails `transient` → `transient`, never the rejected token; an insufficient-scope challenge stops the call without refresh | same as US-2.1 |

### WF3

| Story | Happy outcome | Key failure | Commits |
|---|---|---|---|
| **US-3.1** As a Tenant Admin, the integration page and the health badge show when access was revoked, so that I reconnect before data goes stale. | grant `invalidated` and one `oauth_invalidated` in one commit; banner at once; badge at the next probe of that organization or a manual check | the log write fails → neither commits, `transient` | P4c, P4d, P5 |
| **US-3.2** As a Tenant Admin, a provider outage never tells me to reconnect. | every `transient` outcome (§1.4.5) leaves status and tokens untouched | an outage beyond the refresh token's life ends in a genuine `invalid_grant` (US-3.1) | P4c, P4d + provider health check |
| **US-3.3** As a Tenant Admin, a bad Client ID or Secret tells me to fix the configuration, not to reconnect. | `client_misconfigured` / `client_changed` via `inspectGrant` and health; status stays `active` | never fixed → runs fail `client_misconfigured`, health unhealthy, no banner | P4c, P4d + provider health check |

### WF4

| Story | Happy outcome | Key failure | Commits |
|---|---|---|---|
| **US-4.1** As a Tenant Admin, I disconnect a provider so that Open Mercato no longer holds access to my data there. | blank + soft-delete and `oauth_disconnected` + `oauth_revocation_pending` in one commit; then hook, revoke and an outcome entry; access tokens already handed out stay valid until they expire (I5) | stale screen → 409; unreadable tokens → `disconnect_tokens_unreadable` (or erased with `force`); provider unreachable → erased locally, "revocation not confirmed" | P1a, P3, P4e + 1 provider |

### WF5

| Story | Happy outcome | Key failure | Commits |
|---|---|---|---|
| **US-5.1** As an Integration Developer, I test my provider against a fake authorization server so that CI covers the protocol and a full round trip. | Jest against the published fake server (PKCE, three rotation modes, revoke, error and delay injection); the E2E connect → token → disconnect round trip runs in the first provider's suite (Phase 2); Phase 1's Playwright tests cover the banner and the detail GET through the test route | an injected `invalid_grant` → `grant_invalidated`; a delay beyond the timeout → `transient`; a wrong verifier → `connect_exchange_failed` | P2b, P4a, P6 |

### Default stories

**US-0.1 and US-0.2: N/A.** A platform capability with no demo users or data; the fixtures (US-5.1) take their place.

### Cross-story impact matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|---|---|---|---|---|
| US-1.1 reconnect | live grant updated in place | US-2.1 refresh in flight | refresh writes the old chain | I2: re-read under the lock |
| US-1.1 reconnect / concurrent choice | `providerData`, `revisedAt` | another admin's open picker | a selection on the wrong grant | `expectedRevisedAt` → 409 |
| US-1.1 reconnect | Provider Authorization | another Grant Owner's grant | revoking kills the other grant | the previous token is never revoked on Reconnect; Q8 |
| US-1.1 reconnect over an unreadable grant | live grant replaced | the stored refresh token | a healthy grant overwritten on a transient key problem | only an envelope failure counts, and only with confirmed `replaceUnreadable`; a healthy grant read with a fallback-derived key during a Vault outage is not covered (§1.4.6) |
| US-2.1 refresh | rotated tokens | US-4.1 disconnect | an erased grant resurrected | shared lock + re-read → `not_connected` |
| US-2.1 refresh with Vault down | none | lock waiters | a rotation sealed with another key | DEK pinned once before the lock; no token call without a readable grant (I6) |
| US-4.1 cleanup → US-1.1 quick connect | Provider Authorization | the new grant | revocation kills the new grant | re-read before each external call and skip |

#### Checklist

- [x] All stories with happy outcome, key failure and commits; matrix trimmed to the highest-impact rows

## 6. User Story Gap Analysis `Architect`

The story-to-commit mapping is the **Commits** column of the §5 tables; "provider" commits are the first consumer's (§4.2). **Upstream dependencies / merge order:**
- Recommended gate (Q7, pending sign-off) for the Phase 1 merge: an official-module draft PR passes against a package preview built from the Phase 1 PR (§4.5.6). PR [#6267](https://github.com/open-mercato/open-mercato/pull/6267) (single-use state cookie, `consumeOAuthStateOnce`) merged on 2026-10-07, so every release containing Phase 1 contains it. The `upsert` defaults fix (issue [#6915](https://github.com/open-mercato/open-mercato/issues/6915)) gates the Phase 3 projection, not Phase 1.
- [#6333](https://github.com/open-mercato/open-mercato/issues/6333), PR [#6478](https://github.com/open-mercato/open-mercato/pull/6478) (merged on 2026-10-07) and PR [#6433](https://github.com/open-mercato/open-mercato/pull/6433) change `credential-refresh.ts` (Phase 3 rebases on them); PR [#6266](https://github.com/open-mercato/open-mercato/pull/6266) is independent; PR [#5898](https://github.com/open-mercato/open-mercato/pull/5898) is a Phase 3 candidate.
- PR [#5450](https://github.com/open-mercato/open-mercato/pull/5450) run taxonomy, applied by the provider's adapter: `transient` and `platform_unavailable` → run-transient; `grant_invalidated`, `client_misconfigured`, `not_connected`, `scope_insufficient` and the adapter's Account-pending refusal → run-terminal.

#### Checklist

- [x] Mapped; architect checkpoint done

## 7. Phasing & Rollout `PM`

### Phase 1: Grant-lifecycle core (platform) — 12 commits

**Goal:** any integration can hold a tenant-level grant that is obtained through a PKCE-protected code exchange, refreshes safely across processes without starving the pool, reports a trustworthy status (banner and health badge), and can be truly disconnected. **Why this order:** it sets the standard before a second copy of the logic appears and before the first strict-rotation provider makes the race real.\
It ships **dark**: no existing integration holds a grant (the only always-on path is one existence lookup in the detail GET); the banner renders only for an `invalidated` grant; no migration, no new production route, no new ACL feature, no new CI job (the real-Postgres suites run in `documents-multi-instance`, Q3); no consumer in this repository, and under the recommended gate (Q7) the merge waits for the official module's draft PR.

**Acceptance** (the labelled test criteria and where each runs: Phase 1 feature spec).

*Domain criteria (DDD):*
- [ ] 20 concurrent callers over ≥ 2 DB sessions against a strict-rotation fake cause exactly one refresh (I1).
- [ ] Interleaved Connect, Refresh and Disconnect never store an older refresh token, resurrect an erased grant (make it read as live again) or create a second live row (I2); a tombstone never satisfies a read, and Refresh never moves `revisedAt`.
- [ ] Every §1.4.5 outcome is tested for its class, grant status and stored tokens; nothing else invalidates a grant, and an expired access token is never returned (I3).
- [ ] No token value reaches the admin credentials API, logs, health `details`, error reports or the `oauthGrant` field (I4).
- [ ] After Disconnect the live database holds no decryptable refresh token, even with revocation down; a crash after the erase leaves `revocation: 'pending'` (I5).
- [ ] Waiters hold no connection (0 acquire timeouts with `poolMax=4` and 10 waiters), and Grant Owners at least as many as the pool, refreshing at once against a token endpoint delayed to its 10 s bound, cause no acquire timeout for an unrelated request; the lock commits independently of an outer rollback; rows written under the lock are stored like admin rows at both layers: encrypted, or plaintext with encryption switched off (I6).
- [ ] No token call without a readable grant; no-DEK outcomes return without taking the lock; the DEK is resolved once per operation (I6). Owners differing only by organization, tenant or integration are independent (I7).
- [ ] With encryption switched off, Connect, Refresh, `updateProviderData` and Disconnect work on a plaintext grant; a grant sealed before the switch reads `platform_unavailable`, is never overwritten by a Connect and is replaced only through a forced Disconnect followed by a Connect (I6).
- [ ] An unreadable grant is never overwritten without `replaceUnreadable`, and an unopened field-level layer or a missing DEK never is; a stale Grant Revision gets the standard 409 on External Account selection and Disconnect.
- [ ] `inspectGrant` makes no token call, takes no lock and writes nothing; `mapInspectionToHealth` follows the §1.4.4 precedence.
- [ ] PKCE matches the RFC 7636 Appendix B vector, and the redirect URI never comes from the request origin; a Disconnect hook that ignores its signal can't hold the Disconnect past its budget, and the revoke is still attempted.

*Business criteria (PM):*
- [ ] A minimal test provider is built from exported package paths alone, and every §10.1 import path resolves against the built packages.
- [ ] The admin sees the banner for an invalidated grant with a link to `?tab=<connectTabId>`, a Viewer sees it without the link, and a flag set through the state PUT without a grant shows no banner.

**Value delivered:** one tested standard for new OAuth integrations. **ROI metric:** the OAuth part of a tenant-level provider falls from ~9 to ~5 commits. **Copy test:** a provider copied from this teaches "descriptor + two thin routes on core helpers + health check + Token Provider", not "write your own refresh".\
**PM's challenges to the DDD criteria:** cross-session locking is verified with several connections in one process (advisory locks are per session, so it is the same mechanism); pool starvation is tested on real Postgres; deferred to Phase 3 because none has a consumer and each would become STABLE: `reportResourceChallenge`, a `tryOnce` lock mode, revoking the previous refresh token on Reconnect, `listGrantOwners`, the `reauthRequired` projection.

### Phase 2: First consumer (official module, owned by its own spec) — ~5 commits

**Goal:** an admin connects the first tenant-level OAuth provider, chooses an External Account where needed, and syncs run on schedule and survive token expiry. **Shape:** the five provider commits of §1.2 in `open-mercato/official-modules`, merged after a release containing Phase 1 (which contains #6267).\
**Acceptance:** the OAuth part takes ≤ 5 commits; no `pg_advisory`, `grant_type=refresh_token` or `code_challenge` construction in the provider package; Jest tests for route-contract rules 1–11 against the published fake server; an E2E connect → token → disconnect round trip; after a Disconnect or an invalidation, scheduled runs don't report an error or fire `data_sync.run.failed` on every tick (whether the provider disables its schedules in `onAfterDisconnect` or ends such runs early is its spec's choice); timed sandbox QA (time-to-first-sync ≤ 5 min, a sync longer than the access-token lifetime, a disconnect).\
**Value delivered:** the first tenant-level OAuth provider runs on the core. **ROI metric:** time-to-first-sync ≤ 5 min; the OAuth part ≤ 5 commits.

### Phase 3: Triggered extractions (not scheduled)

| Item | Trigger | Est. |
|---|---|---|
| Generic `/api/integrations/[id]/oauth/*` routes (provider in the path), a generic Connect UI deriving the `oauth` field from the descriptor, the state cookie moved to core with hub bridges | a second tenant-level OAuth provider is committed (e.g. the Google Workspace spec) | ~5 |
| Hub delegates to the grant service; fix `isReauthError`; per-user strict reads; PKCE for Gmail | a strict-rotation per-user provider, or consolidation; after #6433 (#6478 merged) | ~3 |
| `reportResourceChallenge` (`tryOnce` lock mode), `revokePreviousOnReconnect`, `listGrantOwners` | a consumer needs them | ~1–2 |
| A per-integration holder sub-cap under the grant service's 4-slot ceiling, as an optional lock-helper option (additive, BC §2) | a second provider uses the grant service: a second tenant-level OAuth provider is committed, or the hub delegates to it | ~1 |
| `integrations.oauth_grant.invalidated` event + `integrations.integration.reauth_required` notification, with the `reauthRequired` projection and its runtime `integrations.state.updated` emission | admins miss revoked grants, or a second consumer needs the event; the projection after the `upsert` fix | ~2–3 |
| `integrations.oauth_grant.connected` / `.disconnected` events with a data_sync subscriber that pauses schedules | a consumer needs schedules paused | ~1–2 |
| A partial unique index on live `…__oauth_grant` rows (R4); PKCE and state-cookie crypto moved into `shared` (§4.5.4) | grants exist in production; the generic routes, or a third PKCE user | ~2 |
| Hand-rolled locks: the four bare-connection sites as a separate follow-up issue; others may adopt `withAdvisoryXactLock` | the follow-up issue; opportunistic | 0–8 |
| Operator guidance: a separate OAuth client for integrations and for login at the same provider (scopes, verification, blast radius) | the first provider offering both (Google Workspace, Microsoft 365) | 0 (docs) |

### Rollout summary

```
Related: upsert defaults fix         1 PR        (issue #6915, independent bug fix; gates the Phase 3 projection)
Phase 1: grant-lifecycle core      12 commits   capabilities for WF2–WF4 (+ WF1/WF5 primitives incl. PKCE)
Phase 2: first consumer            ~5 commits   WF1–WF4 end-to-end (official module, own spec)
Phase 3: triggered            ~15–26 commits   each item only when its trigger fires (many are optional)
Total to production-ready:         ~17 commits  (Phases 1–2)
```

#### Checklist

- [x] Ordered by priority × gap × blockers; Phase 1 complete but dark (ROI realized with Phase 2, a deliberate deviation); workarounds (§4.6 A); DDD + PM criteria

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs | Resolution |
|---|---|---|
| **SPEC-045a §8 "OAuth 2.0 Credential Type"** (implemented spec; its OAuth part, Step 7, was never built): tokens inside the credentials row, generic start and callback routes, a scheduled refresh worker, `integrations.oauth.*` events and the `IntegrationState` reauth flag as the signal | `implemented/SPEC-045a-foundation.md` §8 | **Superseded by this App Spec.** Tokens in the credentials row → R3 (sibling grant row); generic routes → R2 (provider-owned until Phase 3); the refresh worker → lazy refresh in the Token Provider plus a provider-owned keep-alive (Q6); the events (never declared) → R9; the reauth flag → R8. `IntegrationCredentialFieldOauth` stays an unrendered form-field declaration (§1.4.3). |
| **Integration projects** (Draft): a project dimension, `UNIQUE(project_id)` (one credential row per project) and projects scoped at the bundle level | `2026-03-29-integration-projects.md` §"Modified Entity: IntegrationCredentials" | **Conflict, resolved by shape.** A sibling grant row per project would violate `UNIQUE(project_id)`, and the Grant Owner gains a dimension. This spec keeps the owner an object, so a later `projectId?` is additive. Grant Owner canonicalization is an invariant: an absent `projectId` and the organization's default project are the same owner, normalized before both the row lookup and the lock key, so a Phase 1 owner keeps its key. The integration-projects owners must keep `integration_id` in the uniqueness (so a project can hold its Client Configuration row and its `__oauth_grant` row), keep grants on the child integration, and strip `__oauth_grant` before resolving a row's scope from the integration definition in their backfill. Whichever lands second records the merge in its changelog. |
| Google Workspace (Draft) plans provider-owned OAuth (`oauth.ts`, `oauth-session.ts`), stores `oauthTokens` inside the project credentials row, and shares one Google connection across the bundle's children | `2026-03-29-google-workspace-integration.md` | **Conflict.** Connect UX staying provider-owned is consistent. Tokens in the credentials row are this spec's R3 (lost updates under the admin full-replace save), and a bundle-shared grant contradicts "a grant belongs to the child integration, never the bundle". When it is implemented, Google Workspace should use the Phase 1 core: the sibling grant row, child ownership, PKCE and the Token Provider. Child ownership means one consent per child for the same Google account; whether a bundle may share one grant is Q11. Until Q11 is answered, one child holds the grant and its siblings call the Token Provider with that child's Grant Owner. Its arrival is the Phase 3 trigger. |
| Integration commands and events (Draft) plans per-project Google account connections shared by the bundle's children | `2026-03-29-integration-commands-events.md` (lines 1166-1169) | Same resolution as Google Workspace: child ownership, Q11. Its planned `isReady()` ("enabled, configured, and has valid credentials") must read Grant Read Status for OAuth integrations, not credentials presence. |
| Workflow integration flows (Draft) needs project-aware OAuth and account resolution in the provider runtime | `2026-03-29-workflow-integration-flows.md` (line 554) | Consistent: a workflow targeting a different Google account needs a different consent, so a different Grant Owner (`projectId?`, additive, see integration projects), not an External Account in `providerData`. |
| The email foundation made the hub the OAuth home | `2026-05-21-email-integration-foundation.md` | Phase 1 doesn't touch the hub; Phase 3 migrates with bridges. |
| Disconnect retention: the hub keeps tokens (for undo), this spec erases | email specs vs. this spec | Different aggregates: channel disconnect stays undoable and unchanged; tenant-level grant disconnect erases. Q5 goes to the hub owners. |
| data_sync error taxonomy | PR #5450 series | mapped in §6 |
| First consumer in `official-modules` | its own spec (not yet written) | This spec owns the descriptor contract, the protocol helpers, the provider route contract, the Token Provider, the failure contract and disconnect semantics. The consumer's spec owns its routes, picker, health check, keep-alive, its Playwright seam, provider API specifics and Q1, Q2, Q8 and the Q10 UX. |

#### Checklist

- [x] All identified; conflicts resolved by shape or routed to the owning spec

## 9. Reference App Quality Gate `Architect`

N/A: this is a platform capability. Anti-patterns to avoid: provider-local refresh locks or an in-process `Map` as the only guard; lock waiters holding a pooled connection, or a lock section not detached from the caller's context; tokens in the admin-edited credentials row, logs, error reports or run parameters; any `401` or "unauthorized" text mapped to reauth; a health check that calls `getAccessToken`; a token or revoke call bounded only up to the response headers; a token call before the grant decrypted with the DEK that will seal the result; overwriting an unreadable grant without the verified `replaceUnreadable`; a redirect URI from the request origin, or a Grant Owner from the current organization selection; a code exchange without PKCE where the provider supports it; round-trip tests with stubbed `fetch`.

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|---|---|---|---|---|
| Q1 | For a strict-rotation provider: when one refresh token is redeemed twice within its reuse-grace window, which successor refresh token stays valid? | the earlier one / the later one / unknown (treated as lost), settled by a sandbox test per provider | the residual-risk recovery path (§1.4.6); the design doesn't depend on it | the provider's spec | OPEN per provider |
| Q2 | Does a given provider accept S256 PKCE from a confidential client that also sends a secret? | yes → `S256`; no → `none` | low (a descriptor flag) | the provider's spec (sandbox) | OPEN per provider |
| Q3 | Maintainer sign-off on the new contract surfaces listed in §10.1 (every row marked "yes"), including the real-Postgres steps in the `documents-multi-instance` CI job and the CI runner env change | approve / trim | **BLOCKER** for the Phase 1 merge | maintainers | OPEN |
| Q4 | Merge order vs. #6267, #6478, #6433 and the `upsert` fix (#6915) | Phase 1 before or after each of them | medium | contributor | **Decided** per §6 (the recommended gate (Q7, pending sign-off) before the Phase 1 merge; #6267 and #6478 merged on 2026-10-07; hard gate: the `upsert` fix before the Phase 3 projection); re-checked at merge |
| Q5 | Should the hub's channel disconnect erase tokens? (It conflicts with undo.) | keep / erase-on-delete / erase after N days | privacy | hub owners | OPEN (out of scope) |
| Q6 | Idle-grant keep-alive for providers that expire unused refresh tokens | explicit scheduled refresh / health probe as implicit keep-alive | medium | core (rule) / the provider's spec (threshold, enumeration) | **Decided:** an explicit provider-owned job refreshes a grant whose `refreshedAt ?? obtainedAt` is older than a provider-chosen threshold, via `getAccessToken({ forceRefresh: true })`; it can prefilter candidates by the row's plaintext `updated_at`, which every grant write moves, before decrypting. The health probe is deliberately **not** a keep-alive (§1.4.4): it would refresh on most probes, compete for the lock, and exceed the 10 s health timeout. |
| Q7 | Option A vs. B, and whether to gate the Phase 1 merge on the first consumer | A / B; gate (the core PR merges only after an official-module draft PR passes against a package preview of core: the maintainer-dispatched Package Previews workflow on a same-repository branch, or `yarn pack` tarballs / Verdaccio, §4.5.6) / no gate | scope; the published surface is frozen only after a real provider has used it | maintainers | OPEN (with Q3); RECOMMEND B with the gate |
| Q8 | Provider Authorization shared across Grant Owners: does revoking or deleting provider-side authorization for one Grant Owner break another? | sandbox test per provider; UI warning from the provider's own API | data availability | the provider's spec | OPEN per provider |
| Q9 | `getAppBaseUrl` falls back to the request origin when no base URL is configured (`shared/src/lib/url.ts:240-250`); RFC 9700 requires exact redirect-URI matching | require a configured base URL / keep fallback | connect breaks behind proxies | core (`resolveOAuthRedirectUri`, P2a) | **Decided:** OAuth initiate and callback routes build the redirect URI with `resolveOAuthRedirectUri`, built on `getSecurityEmailBaseUrl` (`url.ts:252-263`): `APP_URL` only, required in production, `http://localhost:3000` outside production, never the request origin. In production without `APP_URL` they fail with `oauth_base_url_not_configured`, and when the request's origin isn't an allowed app origin with `connect_origin_rejected`; the provider tab shows a missing `APP_URL` before Connect. Other routes are unchanged. |
| Q10 | Reconnect selects a **different** External Account → existing external-id mappings point at the old one | `previousProviderData` kept by the core; the provider compares at selection time and warns or refuses before `updateProviderData` | data integrity | core + the provider's spec (detection and UX) | **Decided:** data_sync cursors and external-id mappings belong to one External Account. Reconnect moves a non-empty `providerData` to `previousProviderData`; `updateProviderData` clears it and is serialized under the lock with `expectedRevisedAt`; rule 11 makes the comparison mandatory, and the warning UX is the provider's. |
| Q11 | Bundle-shared grant vs per-child grant: should one consent serve all children of a bundle (Google Workspace, integration commands and events)? | per-child (one consent per child; the Phase 1 rule) / an additive `bundleId` Grant Owner dimension / one child holds the grant for its siblings (the interim rule) | consent UX for bundles; Provider Authorization sharing (Q8) | this spec + the Google Workspace and integration-projects spec owners | OPEN. Until answered, one child holds the grant and its siblings call the Token Provider with that child's Grant Owner: the provider names the holder child in code, disconnecting it disconnects every sibling, and a sibling's tab shows the holder's Connection State. |

### 10.1 Migration & Backward Compatibility

Contract surfaces touched (`BACKWARD_COMPATIBILITY.md`). All changes are additive except the reserved `__oauth_grant` suffix, an intentional security narrowing (I4) that no first-party integration or bundle id hits; **migration path: none required** for first-party code (no data migration, no deprecation). P6 adds a dated section to `BACKWARD_COMPATIBILITY.md` (⚠️ rows for the reservation) and an `UPGRADE_NOTES.md` entry. Full signatures and paths: Phase 1 feature spec.

| Surface | What | Class | Sign-off? |
|---|---|---|---|
| Auto-discovery files (§1), Generated files (§14) | test-only route file (not a contract, see below), `integrations/integration.ts` (flag-gated test integration in the generic module), DI registration; additive registry regeneration | ADDITIVE | **yes** (`integrations/integration.ts`: integrations "Ask First"; precedent `test-seed`) |
| Types (§2) | descriptor, Grant Owner, results, inspection, hook context, error classes, closed unions (consumers keep a default branch), `IntegrationDetailPageConfig.connectTabId`, the optional `CredentialsWriteOptions.ensureEncryptionMap` (default `'always'`); the `CredentialsService` type and `IntegrationCredentialFieldOauth` unchanged | ADDITIVE | **yes** (shared "Ask First") |
| Function signatures (§3) | lock helper and its transient-DB matcher (`isTransientLockDbError`), protocol helpers, erase function, log query, grant service, hook, health map, fake server; an optional third `kms` option on `createCredentialsService` (after its existing `encryptionService`); `pinTenantDek` and `readCredentialRowLayered` are internal | ADDITIVE (STABLE once released) | **yes** |
| Import paths (§4) | `@open-mercato/shared/lib/db/advisoryLock`; exact file paths under `@open-mercato/core/modules/integrations/lib/oauth/`; `oauthGrantFixtures`, `oauthGrantTestRoute` | ADDITIVE | **yes** |
| API routes (§7) | `GET /api/integrations/:id` gains optional `oauthGrant` and returns `detailPage.connectTabId`; `GET`/`PUT /api/integrations/:id/credentials` answer 404 for ids ending in `__oauth_grant` | ADDITIVE (`oauthGrant`, `connectTabId`); ⚠️ intentional security narrowing (the 404, I4; also for a registered id; no first-party integration id ends in the suffix) | **yes** |
| DI names (§9) | `integrationOAuthGrantService`; credentials DI overrides don't apply to grant rows | ADDITIVE (becomes STABLE) + contract note | **yes** |
| Credential resolution (§3, §9; integrations "Ask First") | `integrationCredentialsService.resolve()` and `resolveUpdatedAt()` don't fall through to a `bundleId` ending in `__oauth_grant`; the grant service's Client Configuration read skips it too | ⚠️ intentional narrowing (I4, I7; no first-party bundle id ends in the suffix) | **yes** |
| Widget injection context (§6) | spot IDs unchanged; the `integrations.detail.v1` context gains the optional `detail.oauthGrant` and `integration.detailPage.connectTabId` | ADDITIVE | with the API route row |
| Unchanged: Event IDs (§5), DB schema (§8), ACL features (§10), Notification types (§11), AI agent and tool IDs (§12), CLI commands (§13) | none new | — | — |
| Log and health codes | `integrations.oauth_<reason>`, `OAUTH_HEALTH_CODES`, `mapInspectionToHealth` | ADDITIVE (STABLE once released) | **yes** |
| Persisted formats | `__oauth_grant` suffix, blob `version`, lock-key string `oauth_grant:<integrationId>:<tenantId>:<organizationId>:<userId or ->`, `resourceKind` `integrations.oauth_grant`; the disconnect log codes and their `disconnectId` payload key, read back to derive `lastDisconnect` | ADDITIVE-ONLY; the lock key FROZEN for every existing Grant Owner (§8) | **yes** |
| Behaviour; External dependency | OAuth routes require `APP_URL` in production (Q9); provider routes import the hub-owned `communication_channels/lib/oauth-state` (`verifyOAuthState`, `consumeOAuthStateOnce`, `OAuthStateError`), documented as a STABLE import by P6 and in its publish-shape check (a Phase 3 move to core keeps a `@deprecated` re-export for one minor) | behaviour addition for OAuth routes; dependency on an existing path | **yes** (the dependency: hub owners) |
| CI | real-Postgres suites as named steps of the existing `documents-multi-instance` job (no new job; `develop` requires no status checks, so no branch-protection change); the P6 publish-shape check as a CI step; `OM_ENABLE_TEST_OAUTH_GRANTS` in the integration job env | pipeline change (root "Ask First") | **yes** |
| Test-only route and flag; Dependencies | `POST /api/integrations/test-oauth-grants`, `OM_ENABLE_TEST_OAUTH_GRANTS`; dev dependencies `testcontainers`, `cross-env` | not a contract (like `test-seed`); dev only | — |

#### Checklist

- [x] Options, impact, owner, status
- [ ] Q3 and Q7 resolved before the Phase 1 merge

## 11. Rejected Alternatives `Architect`

| # | Alternative | Why rejected |
|---|---|---|
| R1 | Adopt `openid-client` (or `oauth4webapi`) in core | Wrong problem (storage, locking, classification), ESM tooling cost and a production dependency, and its mix-up defence doesn't apply to code-constant endpoints; revisit per §4.5.3. |
| R2 | Generic `/api/integrations/oauth/[provider]/*` routes, an `oauth` field renderer and an account-selection hook in Phase 1 | The callback URL is an external contract fixed in every tenant's provider console; it waits for a second shape (Phase 3). |
| R3 | Tokens inside the admin-edited credentials row | The admin full-replace save would overwrite rotated tokens (a lost grant) and every refresh would 409 the admin form; the sibling row removes the class. |
| R4 | A partial unique index for tenant-level rows in Phase 1 | Across all rows it touches every deployment; a narrow index on grant rows is Phase 3 defence in depth, and the lock enforces uniqueness. |
| R5 | A refresh-grace descriptor field with "persist failure ⇒ reauth" | It produces false reconnects for non-rotating providers; persisting in the lock transaction makes the next call retry with the old token. |
| R6 | Migrating Gmail/MS365 onto the core in Phase 1 | The race is benign for them, the same file is under change in other PRs, and per-user reauth would need a migration. |
| R7 | Blocking lock waiters, or an in-process `Map` first tier | Waiters holding connections can starve the 20-connection pool. |
| R8 | `reauthRequired` as the source of truth or the banner's input | The admin PUT writes it without the lock, in another aggregate; grant `status` is authoritative. |
| R9 | Events and a reauth notification in Phase 1 | The banner and badge suffice; frozen IDs arrive with their first consumer. |
| R10 | The health probe as an implicit keep-alive | It would refresh on most probes, compete for the lock and exceed the 10 s health timeout. |
| R11 | Provider HTTP calls inside the Disconnect lock | Two or three external calls exceed the waiters' deadline; erase under the lock, revoke after release. |
| R12 | The fake authorization server in the Playwright process, or in `helpers/integration` imported by module code | The app would accept test endpoint URLs, loopback breaks in containers, and `@playwright/test` could reach the app bundle. |
| R13 | An optional `erase` method on the `CredentialsService` type | A standalone `eraseIntegrationCredentials` adds the capability without changing an exported DI type. |
| R14 | A dedicated `integration_oauth_grants` table | A migration, a new encryption map and a second credential store to cover; revisit when grant enumeration or status queries must avoid decryption. |
| R15 | A core route-handler factory called from provider-owned route files in Phase 1 | It would fix the route shape from a single consumer, like the generic routes (R2); the route contract (§1.4.3) and its Phase 2 tests cover the routes until a second shape exists. |
| R16 | Revocation as a queue job with retries | The job payload would carry the refresh token (I4, I5); revocation is best-effort by design, and its outcome is logged (WF4). |
| R17 | A refresh lease instead of the lock transaction across the token call: a short transaction marks the grant as being refreshed, the token call runs with no transaction open, and the result commits with a compare-and-set on the lease | It would hold no pooled connection during the call, but a lease expires on its own clock, not with its holder: a holder paused past it (an event-loop or GC pause, a stalled KMS or DB step around the bounded call) is still alive when a second refresher takes over and redeems the same refresh token. The compare-and-set keeps the stale result out of the row, but strict rotation (RFC 9700 §4.14.2) can answer the double redemption by revoking the grant. The lock transaction is freed at once when its holder's process exits, and its only clock is the 120 s `idle_in_transaction_session_timeout` backstop (§1.4.6); a lease that long would block a crashed holder's grant for 120 s, and a shorter one lets a shorter pause cause the double redemption. The connection the lock costs is bounded by I6 and the per-process holder cap. |

## Production Readiness `PM`

| Workflow | Deployable after | Blocker | What the client would say |
|---|---|---|---|
| WF1 Connect | Phase 2 | Q3 sign-off; the recommended gate (Q7, pending sign-off); the provider routes and picker | "Where's the Connect button?" (until Phase 2) |
| WF2 Token | Phase 1 (capability); Phase 2 (a caller) | Q3 sign-off; the recommended gate (Q7, pending sign-off) | "Syncs never asked me to reconnect while the provider was fine." |
| WF3 Lost consent | Phase 1 (signal); Phase 2 (reachable) | Q3 sign-off; the recommended gate (Q7, pending sign-off); the provider's health check; the Phase 2 criterion against per-tick run failures | "The page told me why to reconnect when I opened it; nothing told me earlier." (push notification: Phase 3) |
| WF4 Disconnect | Phase 2 (the provider's route, button and hook) | Q3 sign-off; the recommended gate (Q7, pending sign-off); the Phase 2 criterion against per-tick run failures | "Did it really cut access?" The copy states the revocation outcome. |
| WF5 Developer journey | Phase 1 (validated by Phase 2) | Q3 sign-off; the recommended gate (Q7, pending sign-off); a release containing Phase 1 for official modules | "I only wrote the provider-specific parts." |

## 12. Sources

Repository evidence: file references in §1.4.1 (line-level in the Phase 1 feature spec). Upstream tracker: #5450, #5898, #6218, #6266, #6267, #6333, #6433, #6478, #6910, #6915, #6916. External sources:
- RFC 6749 (OAuth 2.0; §2.3.1 client authentication, §5.2 error response): https://www.rfc-editor.org/rfc/rfc6749.html
- RFC 7636 (PKCE; §4.1 verifier, Appendix B test vector): https://www.rfc-editor.org/rfc/rfc7636.html
- RFC 7009 (token revocation; §2.2 200 for an invalid token): https://www.rfc-editor.org/rfc/rfc7009.html
- RFC 6750 (bearer tokens; §3.1 `insufficient_scope`, SHOULD be 403): https://www.rfc-editor.org/rfc/rfc6750.html
- RFC 9700 (OAuth 2.0 Security BCP, Jan 2025; §2.1 exact redirect matching, §2.1.1 PKCE, §4.4 mix-up, §4.14.2 refresh-token rotation for public clients): https://www.rfc-editor.org/rfc/rfc9700.html
- OAuth 2.1, draft-ietf-oauth-v2-1-16 (2026-09-03), §4.1.1 (`code_challenge` REQUIRED unless §7.5.1): https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/
- Microsoft refresh tokens: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server

**PKCE policy:** **on (S256) by default** for every auth-code grant, including confidential clients. RFC 9700 §2.1.1 recommends it for confidential clients (and requires it for public ones) and OAuth 2.1 (draft) requires it; it binds the authorization code to the session that requested it, so an intercepted or injected code can't be redeemed; it costs one verifier in the already-encrypted state. Providers can opt out via the descriptor only when the provider rejects PKCE. Gmail (hub) keeps its current behaviour until Phase 3.

## Changelog

### 2026-10-09
- §11 R17: a refresh lease with a compare-and-set commit is rejected; a lease as safe as the lock, whose only clock is the 120 s idle-in-transaction backstop, would block a crashed holder's grant that long, so the lock keeps one pooled connection per holder, bounded by I6 and the holder cap.
- §7 Phase 3: a per-integration holder sub-cap, triggered when a second provider uses the grant service.

### 2026-10-08
- §4.1 (P3), §4.5.1 and §10.1: `createCredentialsService` takes `{ kms }` as an optional third parameter, after the existing `encryptionService`; grant writes use `CredentialsWriteOptions.ensureEncryptionMap: 'when-not-canonical'`.
- §10.1: the `__oauth_grant` reservation is an intentional narrowing (credentials-route 404, bundle-fallthrough skip), with ⚠️ rows and an `UPGRADE_NOTES.md` entry in P6; `oauth-state` is in the publish-shape check.
- Rule 1: the order of the organization checks, including an explicitly empty scope and the feature in the resolved organization. Rule 3 and `connect_state_invalid`: `consumeOAuthStateOnce` before the code exchange, fail closed.
- §1.4.6 and I6: the second stalled-holder path; the Client Configuration is read child-then-bundle with the layered read.
- #6267 and #6478 merged on 2026-10-07; the `upsert` fix is tracked in issue #6915.
- §1.4.5: a `rejectedAccessToken` call over an unexpired grant with no stored refresh token is `transient` with no token.

### 2026-10-04

- Provider routes run the registry mutation guards with `runRouteMutationGuards`; `integrations/api/guards` is not a contract surface (rule 1, §10.1).
- Organization resolution follows `resolveActiveOrganizationId`; a super admin acting in another tenant gets 403; the callback checks access to the state's organization, not the current selection (rules 1–2, §2).
- SPEC-045a §8 (OAuth credential type, never built) is superseded (§8); Grant Owner canonicalization keeps the Phase 1 lock key under integration projects (§8, §10.1).
- The scheduled health probe covers one organization per tenant; elsewhere the badge changes on a manual health check, and the banner reads the grant live (§1.4.4, WF3, US-3.1).
- "Replace unreadable connection" is offered only for an unreadable envelope; otherwise the tab offers a forced Disconnect. A Vault outage with a fallback key can make a healthy grant read unreadable (§1.4.6, rule 10).
- A different External Account is saved only after a warning about existing cursors and mappings (rule 11, Q10); `connect_origin_rejected` is split from `oauth_base_url_not_configured` (Q9).
- The primary goal is measured against the fake server's ground truth; acceptance is split into domain and business criteria, and Phase 2 gains a value line and a criterion against per-tick run failures (§1.2, §7).
- Encryption switched off (`TENANT_DATA_ENCRYPTION=no`) is a supported mode: grants are stored and read as plaintext, and a grant sealed before the switch counts as "no DEK" (I6, §1.4.5, §7).
- The real-Postgres suites run as steps of the existing `documents-multi-instance` CI job: no new job and no branch-protection change, since `develop` requires no status checks (§4.1 P1b, Q3, §10.1).
- The `upsert` defaults defect is reachable today through direct API calls, not latent; its fix is issue #6915 and PR #6916 (§1.4.1, §4.1, rule 9).

### 2026-10-03

- Provider-neutral: no named provider; the first consumer is an official module in `open-mercato/official-modules`, specified separately (§0, §4.5.6, Q7).
- The DEK is pinned once per operation before the lock, and no token call happens without a readable grant (I6).
- An unreadable grant is overwritten only with the admin's confirmed `replaceUnreadable` (§1.4.5, rule 10).
- The Grant Revision (`revisedAt`) gives the standard 409 on External Account selection and Disconnect (§1.4.2).
- The `reauthRequired` projection moves to Phase 3; the banner reads grant status and links to `detailPage.connectTabId` (§3.5).
- Mechanics, line-level evidence, the commit plan and the labelled test criteria move to the Phase 1 feature spec.

### 2026-09-27

- Initial App Spec.
