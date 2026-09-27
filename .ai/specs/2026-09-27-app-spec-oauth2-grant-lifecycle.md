# App Spec: OAuth2 Grant Lifecycle for Integrations (platform capability)

> The App Spec is a business architecture document that sits above feature specs.
> This one describes a **platform capability**, not an end-user app: the "app" is the
> part of Open Mercato that lets an integration obtain, keep, refresh, and give up
> delegated OAuth2 access to a third-party API on behalf of a tenant (or a user).
>
> This document is the SINGLE SOURCE OF TRUTH for the capability. Feature specs are
> generated from it. If a feature spec contradicts it, this document wins.
>
> **Status:** Draft — for maintainer review. **Date:** 2026-09-27.
> **Code baseline:** `develop` @ `67605e74f`; `open-mercato/official-modules`, all branches (`main` @ `2d548d6`):
> no OAuth2 authorization-code clients (§1.4.1).

---

## 0. Executive summary

**Question:** how should Open Mercato handle OAuth2 grants for integrations, meaning the tokens a third-party system issues when a tenant admin grants access? What should the platform own, and where should it live?

**Answer:** the platform should own **one correct, tested way to hold and use an OAuth2 grant**: a narrow grant-lifecycle core (10 atomic commits) that every OAuth integration builds on instead of re-implementing. It is not a full toolkit.

**Why a platform standard rather than per-integration code:**
- **It is the part that is hard to get right.** Correct grant handling needs four things:
  - cross-process-safe refresh: workers always run as separate processes from the web app;
  - a failure classification that keeps "needs reconnect" trustworthy;
  - token storage that admin edits can't clobber;
  - a disconnect that erases tokens and revokes them at the provider.

  None of this exists today, and every integration that writes it itself is another chance to get it subtly wrong.
- **The same logic is already duplicated.** The Gmail adapter (merged) and the Microsoft 365 adapter (open PR [open-mercato/open-mercato#5898](https://github.com/open-mercato/open-mercato/pull/5898)) each implement the token-endpoint call, expiry maths and refresh-and-persist on top of the channel hub. The next integration would be a third copy. One implementation, tested once, is the better practice.
- **It makes the next integration cheaper and safer by default.** A new provider supplies a descriptor and its provider-specific screens, and inherits correct refresh, a trustworthy reconnect signal and a real disconnect.

**Why now: the upcoming Xero integration will be the first consumer and makes it urgent.**
- Xero rotates refresh tokens strictly: the old token dies after a 30-minute grace period.
- Its sync jobs run in worker processes.

Without a cross-process lock, Xero grants would get lost at random. The Xero integration (planned, not started yet) will need this logic either way; building it in the platform instead of the Xero package costs about 4 extra commits and gives every later integration the same guarantees.

**Scope and honesty about reuse:**
- Existing integrations (Gmail, Microsoft 365) **don't change now**. The race is harmless for them (§1.4.6), and they can move onto the core later (Phase 3).
- When Phase 1 ships, the core has no consumer yet; Xero will be the first. Reuse is the design goal; it becomes real with the next OAuth integration after Xero.
- The connect UX (initiate/callback routes, a generic "Connect" button, the declared-but-unrendered `oauth` credential field type, post-consent account picking) stays **provider-owned** for now. Only one planned integration (Xero) connects from the admin panel. The callback URL is an external contract each tenant pastes into the provider's console, so it should be standardized once a second such integration shows the right shape.

**Key decisions:**
- **Library.** Hand-roll the protocol and add no new dependency:
  - the protocol surface is about 150 lines and a version already runs in production;
  - libraries don't solve storage, locking or classification, which are the actual failure modes;
  - `openid-client` and `oauth4webapi` are ESM-only and would need Jest config changes in core and in every provider package.
- **SSO.** Kept deliberately separate (login is a different problem).
- **Where it lives.** The generic advisory-lock helper goes in `packages/shared`; everything else in `packages/core/src/modules/integrations`.
- **Footprint.** No DB migration, no new production API route, no new ACL feature.

**The alternative is real** (§4.6): Xero implements all of this inside its own package, and the platform adds only a lock helper. That is about 4 commits cheaper today. The cost is that the next OAuth integration re-implements the hardest part again, without a shared tested standard.

---

## 1. Business Context `PM`

### 1.1 Business Model

Open Mercato is an open-source commerce/ERP platform. The maintainers' revenue depends on adoption: a hosted offering, enterprise modules, and services. Integrations with systems customers already run (email, accounting, PIM, payments) are a primary adoption driver.

More and more of those systems only offer OAuth2 authorization-code access with long-lived refresh tokens: Google, Microsoft and Xero do. Akeneo is the exception; it uses the password grant.

Every integration that gets OAuth wrong costs the platform twice:
- a support ticket ("sync stopped, says reconnect");
- lost trust ("the integration is flaky").

**Who pays:** the **upstream Open Mercato maintainers**. They carry the review, support and maintenance cost of every OAuth integration, and they decide whether this capability is accepted. What they get is one standard, tested implementation instead of a hand-written copy per integration. **First consumer:** the upcoming Xero accounting integration (specified, implementation not started). It is the forcing function, not the whole reason.

**Flywheel:**
```
correct, shared grant lifecycle
  → next OAuth integration is cheaper and ships without its own locking/refresh bugs
    → more integrations, fewer "needs reconnect" false alarms
      → more adopters trust background sync with their accounting/email data
        → more contributors build integrations on the same core → (loop)
```

#### Checklist
- [x] Paying customer identified
- [x] Flywheel articulated

### 1.2 Business Goals

**Primary goal: correct grant handling by default for every OAuth integration.** An integration built on the core never loses a valid grant because of the platform: no false "needs reconnect", and no lost rotated refresh token. This must hold with a web process plus worker processes, and with several replicas. Measured by:
- **0** spurious `reauthRequired` flips;
- **exactly 1** token-endpoint refresh per grant per expiry window in the concurrency test matrix (§7);
- **0** "pool exhausted" failures with waiters ≥ pool size.

**Secondary goal: reuse.** The OAuth part of any new tenant-level provider costs **≤ 5 atomic commits** on top of the core (descriptor and client fields; PKCE, authorize URL and connect routes; External Account picker and tab; adapter, health check and keep-alive; disconnect hook), with no provider-local lock or refresh code. Self-contained, it costs about **9** (§4.6). Xero will be the first provider measured against this.

**What is NOT in scope.** Only what the core must provide for integrations like Xero; nothing built speculatively for providers that don't exist yet.
- User login / SSO / OIDC relying-party work (`packages/enterprise/src/modules/sso`). Only the boundary is covered (§4.5.4).
- Acting as an OAuth *server*: `agent_orchestrator` identity and MCP OAuth 2.1 ([open-mercato/open-mercato#6218](https://github.com/open-mercato/open-mercato/issues/6218)).
- The `client_credentials`, `password`, device-code and JWT-bearer grants. Xero's discovery document lists `client_credentials` for "Custom Connections", but Xero doesn't need it here.
- Customer-portal users connecting accounts.
- Generic connect routes, a generic admin Connect UI, rendering the `oauth` credential field type, and generalizing the hub's state cookie. All go to Phase 3, with a trigger.
- Migrating the live Gmail/MS365 hub onto the core. This is Phase 3 and optional, because the race it would fix is benign for those providers today (§1.4.6).
- DPoP, PAR, JAR, mTLS sender-constraining and dynamic client registration.

#### Checklist
- [x] Measurable primary goal
- [x] Scope exclusions listed

### 1.3 Ubiquitous Language

> One term = one meaning. Three collisions are resolved here: **"tenant"** (Open Mercato tenant vs
> Xero tenant), **"connection"** (Xero's `/connections` resource vs "connected integration") and
> **"organization"** (the Open Mercato organization in the Grant Owner key vs a Xero organisation, which
> this spec always calls "Xero organisation" or External Account, never "org").

| Term | Definition | Source of data | Period |
|------|-----------|----------------|--------|
| **Integration** | A registered `IntegrationDefinition` (e.g. `sync_xero`, `channel_gmail`). | `integration.ts` registry | — |
| **Client Configuration** | The OAuth app registration the admin copied from the provider console: `clientId`, `clientSecret`, optional `scopes`. Tenant-wide and admin-edited. Read with `resolve()`, so the bundle fallthrough applies. | `integration_credentials` row, `integration_id = <integration>`, `user_id IS NULL` (or the bundle's row) | — |
| **Grant Owner** | Who the delegated access belongs to: `(integrationId, tenantId, organizationId, userId \| null)`. `userId = null` means a tenant-level grant (Xero). `userId` set means a per-user grant (Gmail/MS365 mailbox). | `IntegrationScope` + integration id | — |
| **OAuth Grant** | The aggregate for one Grant Owner: the Token Set plus status and metadata. There is at most one **live** grant row per Grant Owner. It is the **source of truth** for usability. In a bundle, the grant belongs to the child integration id, never to the bundle. | Grant Store | from Connect until Disconnect |
| **Grant Status** | `active` or `invalidated`. `invalidated` = a terminal outcome was confirmed under the Grant Lock (the token endpoint returned `invalid_grant`, or a refresh was needed and no refresh token is stored); the grant is unusable until the next Connect. | OAuth Grant | — |
| **Token Set** | `accessToken`, `refreshToken`, `expiresAt`, `grantedScopes`, `clientId` (the client that obtained it), `obtainedAt`, `refreshedAt`. | token endpoint response | access ≈ 30 min (Xero); refresh ≤ 60 days unused (Xero) |
| **Grant Store** | Where an OAuth Grant is persisted: an encrypted `integration_credentials` row **separate from** the Client Configuration row (§1.4.2). | `integration_credentials` | — |
| **Provider Descriptor** | Code-level declaration for each integration: endpoints, client-auth method, PKCE mode, scopes and hooks (§1.4.3). Never tenant-supplied. Passed per call; there is no global registry. | provider package | — |
| **Refresh** | Exchanging the stored refresh token for a new Token Set at the token endpoint. Never sends `scope`. | token endpoint | — |
| **Rotation** | The provider returns a new refresh token on Refresh. **Strict** = the old one stops working (Xero, after a 30-min retry grace). **Non-revoking** = the old one keeps working (Microsoft). **None** = no new token is returned (Google, typically). | provider docs | — |
| **Grant Lock** | Cluster-wide mutual exclusion for one Grant Owner, taken by every grant write (Connect, External Account selection, Refresh, Disconnect, diagnostics). A transaction-scoped Postgres advisory lock, acquired with try-and-back-off so waiters hold no connection. Key: `hashtextextended('oauth_grant:' \|\| integrationId \|\| ':' \|\| tenantId \|\| ':' \|\| organizationId \|\| ':' \|\| coalesce(userId, '-'), 0)`. The explicit `oauth_grant:` namespace makes collisions with the other advisory-lock users (same bigint key space, some via `hashtext`) unlikely; a collision would only cause a spurious wait, never a wrong result. | Postgres | holder: ≤ one token-endpoint call (10 s default); waiter: ≤ 15 s |
| **Token Provider** | The consumer-facing call: "give me an access token valid for at least N ms for this Grant Owner". Refreshes lazily under the Grant Lock. | `integrationOAuthGrantService` | per call |
| **Token Failure** | The outcome of a failed Token Provider call, or of a resource-API failure the caller reports with `reportResourceChallenge`. Exactly one of `transient`, `grant_invalidated`, `client_misconfigured`, `scope_insufficient`, `not_connected`, `platform_unavailable` (§1.4.5). | Token Provider | — |
| **Connect Failure** | The outcome of a failed Connect. Exactly one of `connect_cancelled`, `connect_state_invalid`, `connect_exchange_failed`, `client_misconfigured`, `organization_scope_required`, `oauth_base_url_not_configured`. Never sets `reauthRequired`. | provider callback | — |
| **Reauth Flag** | `IntegrationState.reauthRequired`: a projection of Grant Status (`invalidated` ⇒ true, `active` or no grant ⇒ false) for tenant-level grants, written by the grant service in the same transaction as a status change, and only when the value actually changes. For OAuth-grant integrations the grant service is its only intended writer. It is not authoritative, and the banner doesn't read it (§3.5); it is kept for API compatibility. | `integration_states` | — |
| **Connect** | The consent round trip: authorize redirect → callback → code exchange → grant persisted as `active`. The External Account may still be unselected at this point; it is chosen afterwards (`updateProviderData`). |
| **Reconnect** | A Connect for a Grant Owner that already has a live grant (active or invalidated). It updates the live row in place under the Grant Lock; it never creates a second live row. | provider-owned routes (Phase 2) | ≤ 5 min state TTL |
| **Disconnect** | Owner-initiated end of a grant. Local erasure happens under the lock; best-effort provider-side cleanup and revocation happen afterwards with the captured tokens. | admin action | — |
| **External Account** | The provider-side thing the grant is used against, chosen after consent: a Xero organisation ("Xero tenant" in Xero's docs) or a Gmail mailbox. Never called "tenant" in this spec. | provider API | — |
| **Provider Authorization** | The provider-side consent record behind a grant (Xero: the user's app authorization, visible as one or more Xero Connections). It can be **shared** by grants of different Grant Owners if the same provider user connects twice. | provider | — |
| **Xero Connection** | Xero's `/connections` record linking a Provider Authorization to one Xero organisation (`id`, `tenantId`, `tenantType`, `tenantName`, `authEventId`). Provider-specific; owned by the Xero spec. | `GET https://api.xero.com/connections` | — |

#### Checklist
- [x] Terms defined once; collisions resolved
- [x] Sources and periods specified

### 1.4 Domain Model

#### 1.4.1 Current state (from the code)

| Question | Finding | Evidence |
|---|---|---|
| How many OAuth2 **client** flows exist? | **Three families, four implementations.** (a) Hub per-user auth-code: the `communication_channels` routes plus the Gmail adapter. MS365 (PR #5898) reuses the hub with "no packages/core changes". (b) Akeneo **password grant** + refresh; tokens live in memory per client instance and are never persisted, so Akeneo is not a consumer. (c) SSO OIDC login via `openid-client` v6 (enterprise). Separately, `agent_orchestrator` is an OAuth **server** (`client_credentials`, JWT-bearer). | `communication_channels/api/{post,get}/oauth/[provider]/*`; `channel-gmail/.../lib/oauth.ts`; `sync-akeneo/.../lib/client.ts:343-418`; `enterprise/src/modules/sso/lib/oidc-provider.ts` |
| Consistent? | No. The token POST code differs: Gmail uses form-urlencoded via the hub's `requestOAuthToken`; Akeneo uses a JSON body with its own SSRF-guarded fetch; SSO uses a library. The hub's state cookie is a **port** of SSO's, because core may not import enterprise. | `communication_channels/lib/oauth-state.ts:1-22` |
| Grant types (`grant_type` search) | `authorization_code` and `refresh_token` (Gmail/hub). `password` and `refresh_token` (Akeneo). `client_credentials` and `urn:ietf:params:oauth:grant-type:jwt-bearer` (agent_orchestrator, **server** side). | repo-wide search |
| PKCE | **SSO: always** (S256). **Gmail: never.** The hub supports PKCE only as an adapter opt-in via the state `extra` field; MS365 opts in. | `sso/lib/state-cookie.ts:66`; `channel_gmail/lib/oauth.ts:64-76` |
| OAuth/OIDC libraries | Only `packages/enterprise` has one: `openid-client ^6.8.4` (pulling in `oauth4webapi` and `jose`). Both are **ESM-only**, and neither is in core's Jest `transformIgnorePatterns`. | every `package.json`; `yarn.lock:29751`; `core/jest.config.cjs:44-46` |
| Refresh handling | Hub `refreshCredentialsIfNeeded`: 60 s skew window. Single-flight uses an **in-process `Map`**. Refresh errors and persistence errors are both **swallowed**; the old credentials are returned. | `credential-refresh.ts:60,140,152-156` |
| Correct across processes? | **No.** Workers run as a separate OS process: the eager default spawns one `queue worker --all` process, and opt-in lazy per-queue mode spawns one process per queue. A web route (`test-send`) also refreshes. The `Map` coordinates none of these, and there is no lock and no re-read. | `cli/src/mercato.ts:2354,2566`; `auto-spawn-workers.ts:19-42`; `api/post/channels/[id]/test-send/route.ts:217` |
| Harmful today? | **Mostly benign for current providers.** Google documents refresh tokens as valid until revoked or expired, and the Gmail adapter keeps the old token when none is returned. Microsoft "doesn't revoke old refresh tokens when used". The code comment calling Gmail "rotating" is inaccurate. **Xero will be the first strict-rotation consumer.** | `credential-refresh.ts:52-59`; §12 |
| Disconnect | The channel gets `status='disconnected'` and `credentialsRef=null`. The **token row stays, decryptable**. The comment says "the integrations module's retention policy sweeps it", but **no such sweep exists**: the only workers are the health probe and the log pruner. There is no provider-side revocation anywhere. `CredentialsService` has **no delete**. The disconnect command is *undoable*, and undo relies on the row surviving. | `commands/disconnect-channel.ts:48-57,135-138`; `integrations/workers/*` |
| Generic admin UI for OAuth | **None.** `CredentialFieldType` declares `'oauth'` (with `authUrl`, `tokenUrl`, `scopes`, `clientIdField`, `clientSecretField`), and masking treats it as secret. The detail page and the bundle page both **silently filter it out**. No provider declares it; Gmail declares `clientId` as `text`. The hub's `useConnectChannel` hook is hard-wired to `/api/communication_channels/oauth/<provider>/initiate`, so it doesn't serve tenant-level providers. The detail page does support `type: 'custom'` fields, which a generic renderer could use. | `shared/src/modules/integrations/types.ts:37-102`; `integrations/backend/integrations/[id]/page.tsx:67-76,292,324`; `bundle/[id]/page.tsx:34-37`; `communication_channels/lib/use-connect-channel.ts:41` |
| `IntegrationState.reauthRequired` | The column exists, the API returns it, and admin PUT can set it. `setReauthRequired()` exists but is **never called**, and **no UI renders the flag**. The live reauth signal is the per-channel `requires_reauth` status. `integrations.state.updated` is emitted only by the admin route. | `state-service.ts:125-127`; `api/[id]/state/route.ts:111-116` |
| Real OAuth round-trip test | **None.** Unit tests stub `global.fetch`, and the in-process single-flight test is the only concurrency test. `TC-CHANNEL-EMAIL-A01` only checks that the initiate route doesn't return 404 or 5xx, and its comments still name the phantom `oauth_gmail` id. SSO's test mocks `openid-client` entirely. No fake OAuth/HTTP server fixture exists (`pushFake.ts` replaces SDKs; it doesn't run a server). | `TC-CHANNEL-EMAIL-A01-token-refresh.spec.ts`; `sso/lib/__tests__/oidc-provider.test.ts:1-4` |
| Cluster-wide locking | `pg_advisory_xact_lock` is hand-rolled at **≥ 8 call sites**: attachments quota, notifications, query_index coverage, documents folders, sso config, record_locks (×2) and tillio. The only wrapper, `createTillioLock`, is package-private. It already holds the lock across remote HTTP calls. The scheduler's `LocalLockStrategy` locks only the *claim* and is single-instance. Cache has no lock primitive. | search `pg_advisory`; `tillio/lib/locking.ts`; `scheduler/lib/localLockStrategy.ts:7-43` |
| DB constraints | `idle_in_transaction_session_timeout` defaults to 120 s. The pool defaults to **max 20** with a **6 s acquire timeout**. Worker concurrency is budgeted against the pool max on the assumption of one connection per in-flight job. `DB_STATEMENT_TIMEOUT_MS` is opt-in (57014). | `shared/src/lib/db/mikro.ts:118-133`; `cli/src/mercato.ts:575-590`; `worker-connection-budget.ts:58-66` |
| Base URL / safe fetch | `getAppBaseUrl(req)` and `toAbsoluteUrl(req, path)` exist and are used by the hub callback. `safeOutboundFetch` exists. | `shared/src/lib/url.ts:240-250`; `shared/src/lib/url-safety.ts:223` |
| Admin credential save | A **full replacement** (`{...incoming}`). Only *declared* secret fields are restored from the stored blob, so stored undeclared keys are dropped. The row's `updated_at` is the admin form's optimistic-lock version. So tokens stored beside `clientSecret` would be wiped by any admin save, and every refresh would 409 an open admin form. | `credentials-masking.ts:88-116`; `api/[id]/credentials/route.ts:185-228` |
| Runtime-secret precedent | Tillio stores operator tokens under **its own integration id** (`tillio_operators`) in the same encrypted store. | `tillio/lib/operators-store.ts:5-8` |
| Credential lookups | Tenant-level reads are strict: `buildCredentialsFilter` pins `userId = null`. `getRaw` falls back from the user row to the tenant row **only when `userId` is set**. There is no DB-level uniqueness for tenant-level rows: the partial unique index covers only `user_id IS NOT NULL`. | `credentials-service.ts:90-102,220-228`; `data/entities.ts:47-51` |
| Health-check path | Providers declare `healthCheck.service`. Results persist via `health-service.ts`, a 15-min probe worker runs, and the detail page shows `details.code`. | `integrations/lib/health-service.ts`; `workers/health-probe.ts`; `page.tsx:953-956` |
| Notification dedupe | `groupKey` dedupe runs under an advisory lock. There's an existing event → subscriber → notification pattern for channel reauth. | `notifications/lib/notificationService.ts:194-219`; `communication_channels/subscribers/channel-requires-reauth-notification.ts` |
| data_sync consumer view | The engine resolves credentials **once per run** and passes a static blob. Import workers run at concurrency 5. Adapters already build their own container (`createRequestContainer()`), so they can resolve a Token Provider **without engine changes**. The run error taxonomy is pending upstream (PR #5450). | `data_sync/lib/sync-engine.ts:41-45,672-675`; `sync-akeneo/.../lib/adapter.ts:18` |
| `official-modules` (all branches) | No OAuth2 authorization-code client and no persisted, background-refreshed tokens. `carrier-inpost` uses a static API token. `financial-pl` (KSeF, feature branch only) derives a short-lived access token per operation from a durable KSeF token or certificate; its `refreshToken` client method is never called and nothing is persisted. The DHL Parcel spec (no code yet) keeps its JWT pair in process memory and explicitly rejects persisting it. Neither is a consumer of this core; both follow the Akeneo shape. | `open-mercato/official-modules`: `packages/carrier-inpost/.../lib/client.ts`, `packages/financial-pl/.../lib/ksef-auth.ts` (branch `feat/financial-pl-invoice-ux`), `.ai/specs/SPEC-004-2026-03-25-carrier-dhl-parcel.md` |

#### 1.4.2 Entities

**ClientConfiguration** (existing storage, unchanged). Read via `integrationCredentialsService.resolve()`, so the bundle fallthrough applies.

| Field | Type | Multi | Required | Notes |
|---|---|---|---|---|
| `clientId` | text | no | yes | declared `type: 'text'` |
| `clientSecret` | secret | no | yes | masked on read |
| `scopes` | text | no | no | blank → descriptor defaults |

**OAuthGrant** (aggregate root; existing table, new row key). An encrypted blob in `integration_credentials`:
- **Row key, tenant-level:** `integration_id = '<integrationId>__oauth_grant'`, `user_id IS NULL`. This is a sibling key, following the Tillio precedent. It isolates grant writes from the admin row's full-replace save, its masking merge and its optimistic-lock version. The admin credentials route cannot address it: `getIntegration` returns nothing, so the route answers 404.
- **Row key, per-user (hub, Phase 3 only):** unchanged, `channel_<provider>` + `user_id`. Adopting the core therefore needs **no data migration**.
- **Uniqueness:** there is no DB constraint for tenant-level rows. Uniqueness among **live** rows (`deleted_at IS NULL`) is enforced by the Grant Lock around every write (tested; see I2).
- **Row lifecycle.**
  - Disconnect blanks the blob and soft-deletes the row, which becomes a tombstone.
  - `completeConnect` writes through `save()`, under the Grant Lock:
    - **with a live row** (Reconnect), it updates that row in place (`credentials-service.ts:289-292`);
    - **without one** (first Connect, or after a Disconnect), it inserts a new row.

    It never restores a tombstone, because `save()` filters `deleted_at IS NULL` (`credentials-service.ts:95`).
  - Every grant lookup filters `deleted_at IS NULL`, so tombstones are never read.
  - Tombstones hold no secrets and accumulate one per disconnect cycle.

| Field | Type | Multi | Required | Notes |
|---|---|---|---|---|
| `version` | integer | no | yes | blob schema version, starts at `1` |
| `status` | select `active`\|`invalidated` | no | yes | source of truth for usability |
| `invalidatedReason` | select `grant_rejected`\|`no_refresh_token` | no | when `invalidated` | |
| `invalidatedAt` | datetime (UTC) | no | when `invalidated` | |
| `accessToken` | text (secret) | no | yes | never returned by any admin API, never logged |
| `refreshToken` | text (secret) | no | yes for offline grants | a Refresh response without `refresh_token` (rotation "None") keeps the stored one |
| `expiresAt` | datetime (UTC) | no | yes | from `expires_in`, else the descriptor's default TTL |
| `tokenType` | select `Bearer` | no | yes | case-insensitive compare |
| `grantedScopes` | text | yes | no | at Connect: the response `scope`, else the requested scopes; on Refresh: the response `scope` if present, else the previous value (Refresh never sends `scope`) |
| `clientId` | text | no | yes | the client that obtained the grant |
| `obtainedAt` | datetime | no | yes | set at Connect; immutable |
| `refreshedAt` | datetime | no | no | |
| `refreshCount` | integer | no | yes | diagnostics |
| `lastFailureClass` | select (Token Failure) | no | no | the most recent non-terminal failure (`transient`, `client_misconfigured`, `scope_insufficient`); diagnostics for `inspectGrant`/health. Never authoritative. Written only while the Grant Lock is held (a failed token-endpoint call, or `reportResourceChallenge`); a failure that prevents taking the lock or writing (lock deadline, DB, encryption) is not recorded. |
| `lastFailureAt` | datetime (UTC) | no | no | set with `lastFailureClass`; **both** are cleared on the next successful Refresh or Connect |
| `providerData` | json | no | no | provider-owned and non-secret (e.g. the chosen Xero organisation id and name). Empty after `completeConnect` until the provider sets it with `updateProviderData`. The core never interprets it. |

**IntegrationState.reauthRequired** (existing). A projection written by the grant service **inside the same transaction** as a status change (Connect, invalidation, Disconnect), via `setReauthRequired` on a transaction-bound state service: `invalidated ⇒ true`, `active`/no grant ⇒ `false`.

Rules for the projection write:
- **Only on change.** Compare with the current value and skip the write if equal. Each write bumps `integration_states.updated_at`, which is the optimistic-lock version of the admin state PUT (`state/route.ts:94-97`). An admin who has the enable toggle open across a status change gets a 409 and retries; that residual is accepted.
- **A missing state row is created with the definition defaults.** Today `setReauthRequired` → `upsert` creates a missing row with `isEnabled: input.isEnabled ?? false` (`state-service.ts:106`), ignoring `defaultState.isEnabled`, which only `resolveState` honours (`:22`). `sync_excel` and `webhooks` declare `defaultState.isEnabled: true`, so a first projection write would silently disable such an integration. P5 fixes `upsert` to create missing rows with the resolved defaults. It is a bug fix, not a contract change (§10.1).
  - **Existing callers it also affects** (each omits `isEnabled` on a possibly missing row): the health service (`health-service.ts:130`), the API-version route (`api/[id]/version/route.ts:128`), the data_sync engine's health write (`data_sync/lib/sync-engine.ts:439`), run cancel (`data_sync/api/runs/[id]/cancel.ts:97`) and the admin state PUT when the body omits `isEnabled` (`state/route.ts:107`). For all of them, a missing row now gets the definition default instead of `false`; existing rows are unchanged.
  - **No remediation of stored rows.** A row already created with `isEnabled = false` by one of these callers can't be told apart from a deliberate disable, so it is left as is.

For integrations that hold an OAuth grant, the grant service is the only intended writer. The existing admin PUT can still write the flag (the API contract is STABLE: `updateStateSchema` accepts `reauthRequired`), but that **never changes the grant**. Because the banner reads the grant status and not the flag (§3.5), a manually written flag has no UI effect; it is overwritten at the next status change.

The hot path (`getAccessToken` with a fresh token) never reads or writes state.

**Invariants**
- **I1 Single refresher.** At most one Refresh per Grant Owner is in flight, cluster-wide.
- **I2 Serialized writes.** Every grant write (Connect, `updateProviderData`, Refresh, Disconnect, diagnostics from `reportResourceChallenge`) takes the Grant Lock, re-reads the grant, and does all its DB I/O on the lock transaction's EntityManager. The grant write, the flag projection and the lock release commit atomically.
- **I3 Trustworthy flag.** Grant Status becomes `invalidated` only from a terminal outcome observed while holding the lock: `invalid_grant` from the token endpoint, or a needed refresh with no stored refresh token (§1.4.5). It becomes `active` only through a successful Connect. The flag follows the status within the same commit.
- **I4 Secret isolation.** Grant secrets never appear in the admin credentials API, in logs or telemetry, or in `sync_runs.parameters`.
- **I5 Real disconnect (live database).** When Disconnect's lock section commits, the **live database** holds no decryptable refresh token for the owner (blob blanked, row soft-deleted), whatever happens to provider revocation.
  - **Scope limit:** backups, snapshots and replicas taken earlier still hold the previous encrypted blob. It stays decryptable while the tenant's DEK exists, until backup retention expires.
  - The platform does not purge backups. **Provider-side revocation is the only control over that residue**, which is why revocation is attempted and its outcome recorded (WF4).
  - Security reviews should be told exactly this, not "tokens are gone".
- **I6 Bounded lock.**
  - The holder performs at most one external HTTP call (the token endpoint, 10 s timeout) while holding the lock.
  - Waiters hold **no** connection while waiting (`pg_try_advisory_xact_lock` + back-off + re-read). The waiter deadline is 15 s, then the call fails `transient`.
  - SQLSTATE `55P03` and `57014` both map to `transient`.
  - The lock key always carries the `oauth_grant:` namespace (§1.3).
  - **The lock transaction is never nested in a caller's transaction.** The container `em` is forked with `useContext: true`, so inside an open `em.transactional` MikroORM redirects every operation into that outer transaction (`workflows/lib/activity-executor.ts:1640-1659`). A nested lock transaction would become a savepoint: the lock would be held until the outer commit, and a rotated refresh token would commit only with the outer transaction, so an outer rollback would lose a token the provider has already rotated. The lock helper therefore always runs on a context-detached fork (`em.fork({ clear: true, freshEventManager: true, useContext: false })`, the query_index/webhooks/workflows convention) and commits on its own connection.
  - A caller that is itself inside a transaction still holds that transaction's connection while it waits, and uses a second one for the lock transaction. Adapters call the Token Provider outside their own transactions; the worker connection budget (one connection per in-flight job) assumes this.
- **I7 Strict ownership.** A grant lookup for owner X never returns owner Y's grant. Tenant-level lookups are strict by construction. Per-user grant lookups (Phase 3) must not use `getRaw`'s user→tenant fallback.
- **Transaction-bound services.** Inside the lock, the grant service builds the credentials, state and log services from the core factories bound to the lock transaction's EntityManager. Consequences:
  - DI overrides of `integrationCredentialsService` are **not** used for grant rows; this is deliberate, because the write must be in the lock transaction;
  - `erase` is always present on that instance;
  - if it were somehow missing, Disconnect fails closed instead of skipping the erase.

#### 1.4.3 Provider Descriptor

This is the code-level contract; the values are provider-owned. It is passed to every grant-service call; there is no global registry.

| Field | Type | Required | Default | Xero value (Xero spec verifies) |
|---|---|---|---|---|
| `integrationId` | text | yes | — | `sync_xero` (name owned by the Xero spec) |
| `authorizationEndpoint` | url | yes | — | `https://login.xero.com/identity/connect/authorize` |
| `tokenEndpoint` | url | yes | — | `https://identity.xero.com/connect/token` |
| `revocationEndpoint` | url | no | — | `https://identity.xero.com/connect/revocation` |
| `clientAuthMethod` | select `client_secret_basic`\|`client_secret_post` | yes | `client_secret_basic` | basic (both advertised) |
| `pkce` | select `S256`\|`none` | no | `S256` | `S256` (acceptance for web-app clients to be verified, Q2) |
| `defaultScopes` | text, multi | yes | — | `offline_access` + granular accounting scopes (apps created on or after 2026-03-02 cannot get `accounting.transactions`) |
| `extraAuthorizeParams` | json | no | `{}` | — |
| `defaultAccessTokenTtlSec` | integer | no | `3600` | 1800 |
| `refreshSkewMs` | integer | no | `120000` | 120000 |
| `revokePreviousOnReconnect` | boolean | no | `false` | `false` (a shared Provider Authorization could be killed; Q8) |
| `onAfterDisconnect(captured)` | hook | no | — | `DELETE https://api.xero.com/connections/{id}`, run after the lock is released |

**Relationship to `IntegrationCredentialFieldOauth`.** That exported type (`authUrl`, `tokenUrl`, `scopes`, `clientIdField`, `clientSecretField`) is a *form-field* declaration for the admin UI, and no one uses it. The descriptor is *runtime protocol* configuration (auth method, PKCE, hooks, TTLs) that the form cannot express. The two diverge deliberately. Phase 3's generic renderer derives the `oauth` field from a descriptor rather than the reverse. The type is left untouched (STABLE).

Endpoints are code constants, never tenant input, so the token client uses `fetch` with a timeout. A future descriptor with tenant-configurable endpoints must inject `safeOutboundFetch`.

#### 1.4.4 Domain events and signals

| Signal | Status | When | Notes |
|---|---|---|---|
| `integrations.oauth_grant.invalidated` | **not added in Phase 1** | — | The banner (flag) is the Phase 1 signal. An event ID is frozen once added, so it arrives with its first consumer (the notification, Phase 3). |
| `…oauth_grant.connected` / `…disconnected` | **not added** | — | No consumer yet, and an event ID is frozen once added. Add when a consumer appears (e.g. a data_sync subscriber pausing schedules on disconnect). The audit trail is covered by integration log entries. |
| `integrations.state.updated` | existing | emitted **after commit** for every projection change of `reauthRequired` | Same payload shape and the same fields. Runtime emissions send `userId: null` (the admin route sends `auth.sub`); the field is never omitted, so subscribers see a new value, not a missing field. The event has no `clientBroadcast`, so it doesn't reach the browser; the detail page shows the new state on its next load. It is not `excludeFromTriggers`, so workflow triggers on it now also fire from workers. |
| `integrations.credentials.updated` | existing | **not** emitted for grant writes | a refresh every ~30 min is not an admin credential edit |
| Notification `integrations.integration.reauth_required` | **not added in Phase 1** | — | A new notification type is frozen once added. The banner covers Phase 1; the notification is a Phase 3 item. |
| Integration log entries | existing (`integrationLogService.write`, append-only; `write` because the `scoped()` helpers take no `code`) | `oauth.connected`, `oauth.external_account_selected`, `oauth.invalidated`, `oauth.disconnected` + `oauth.revocation_pending` (written **in the erase transaction**), then one of `oauth.revocation_confirmed`, `oauth.revocation_failed`, `oauth.revocation_skipped_reconnected`, `oauth.revocation_skipped_invalidated` (after release) | A `revocation_pending` with no outcome entry **older than 5 minutes** means the process died between erase and revoke. It is shown as "revocation not confirmed" in the Logs tab and the provider tab, and can be found by query. Before the 5 minutes, the revoke may still be in flight. No secrets in payloads (I4). |
| Health status | existing (provider `healthCheck.service`) | the provider's health check calls **`inspectGrant`** (below) and maps the result to `details.code` | **single writer:** the grant service never writes health |

**Log codes and levels.** Each entry's `code` uses the `module.reason` shape that telemetry groups on (`shared/src/lib/telemetry/error-code.ts:12`): `integrations.oauth_connected`, `integrations.oauth_invalidated`, `integrations.oauth_revocation_failed`, and so on (the short names above are the reasons). An `error`-level entry is also reported to telemetry right after its flush (`log-service.ts:112-113`), so levels are chosen deliberately:
- `info`: connected, external_account_selected, disconnected, revocation_confirmed, revocation_skipped_*;
- `warn`: invalidated (an expected external event, e.g. the user removed the app) and revocation_pending;
- `error`: only revocation_failed, which is written after the lock is released, outside any transaction that could still roll back.

**Health check is not a refresher.**

The probe runs every 15 min, for **enabled** integrations only (`workers/health-probe.ts:49-50`). If the health check called `getAccessToken`, it would become a hidden refresher:
- a 30-min Xero token would be refreshed about every 30 min for every enabled tenant, idle or not;
- the probe would compete for the Grant Lock;
- a 15 s lock wait plus a 10 s token call exceeds `HEALTH_CHECK_TIMEOUT_MS` (10 s), so the probe would report "timed out" while the refresh carried on in the background.

So the health check calls **`inspectGrant(descriptor, owner)`** instead:
- **No token-endpoint call, no blocking lock.**
- It returns `{ status, expiresAt, refreshedAt, obtainedAt, lastFailureClass, clientChanged, hasExternalAccount }` and, only if the stored access token is still valid, that token (for an optional cheap provider call).
- It takes no lock and writes nothing.
- On a decrypt failure it returns `{ status: 'unavailable' }` rather than throwing.

**Idle-grant keep-alive is explicit, not a side effect of the probe (Q6).** The provider owns a scheduled job, daily for Xero. When `inspectGrant().refreshedAt` is older than 7 days and the integration is enabled, it calls `getAccessToken({ forceRefresh: true })`. A disabled integration is not kept alive; its grant may idle out, and re-enabling it may then require a Reconnect. That keeps a Xero refresh token far from its 60-day idle expiry at a cost of about 1 refresh per week per idle tenant.

#### 1.4.5 Failure classification (the trust contract)

**Token Provider (`getAccessToken`):**

"Grant after: unchanged" means **status and tokens** are unchanged. Diagnostics (`lastFailureClass`, `lastFailureAt`) follow the rule in §1.4.2.

| Observation (under the Grant Lock after re-read, unless noted) | Token Failure | Grant after | Flag | Caller action |
|---|---|---|---|---|
| Grant `status = invalidated` (no network call; lock not needed) | `grant_invalidated` | unchanged | unchanged | stop; Reconnect |
| Refresh → `400 invalid_grant` | `grant_invalidated` (`grant_rejected`) | `invalidated` | **true** (same commit) | stop; Reconnect |
| Access token expired, no refresh token stored | `grant_invalidated` (`no_refresh_token`) | `invalidated` | **true** | Reconnect |
| Refresh → `invalid_client` / `unauthorized_client` (400/401) | `client_misconfigured` | unchanged, `active` | unchanged | admin fixes Client ID/Secret |
| Grant `clientId` ≠ current ClientConfiguration `clientId` (checked on read, no network call) | `client_misconfigured` (`client_changed`) | unchanged, `active` | unchanged | revert the Client ID, or Reconnect with the new client |
| Network error, timeout, DNS, 5xx, 429, non-JSON, `temporarily_unavailable`, `server_error`, other 4xx `error` codes, lock deadline, `55P03`, `57014`, and any DB error for which `isTransientDbError` is true (connection loss, pool acquire timeout; `shared/src/lib/db/pg-errors.ts:137`) | `transient` | unchanged | unchanged | Back off. If the stored access token is still valid **now**, return it with `degraded: true`. It may be below the requested `minValidityMs`, so callers that can't accept that treat `degraded` as `transient`. |
| `CredentialsEncryptionUnavailableError` (reasons `no-dek` and `sealed-while-disabled`), or a grant blob that decrypts to nothing or fails schema validation | `platform_unavailable` | unchanged | unchanged | Operator configuration problem; fail closed. Never treated as `not_connected`, because a corrupt or unreadable grant is not a disconnect. |
| No live grant row | `not_connected` | — | unchanged | "Connect first", never "reconnect" |
| Resource API `401` whose `WWW-Authenticate` carries `insufficient_scope` or Xero's `insufficent_scope`. Xero sends it as a bare token (`WWW-Authenticate:insufficent_scope`, `developer.xero.com/faq/granular-scopes`), not as RFC 6750 `Bearer error="insufficient_scope"`, so match both forms case-insensitively. The caller reports it with `reportResourceChallenge(descriptor, owner, challenge)`, which uses a non-blocking try-lock (skipped if busy) and records `lastFailureClass = scope_insufficient`. | `scope_insufficient` | unchanged, `active` — **no refresh** (the token is valid; refreshing re-grants the same too-narrow scopes) | unchanged | stop that call; health `oauth.scope_insufficient` ("this integration needs additional permissions — update scopes and reconnect"); not runtime-recoverable without a descriptor/config scope change |
| Resource API `401` with token T (any other challenge) → the caller passes `rejectedAccessToken: T` | — | If, after the re-read under the lock, the stored `accessToken == T` **and** `refreshedAt` is earlier than the call's start: one forced Refresh. Otherwise return the stored token. | — | Retry once. A second `401` is a **resource error**, never `grant_invalidated`. A caller must not loop by passing each new token back as `rejectedAccessToken`. |

Notes:
- Refresh never sends `scope`. **Scope drift** (configured scopes ⊄ `grantedScopes`) is *advisory*: the health check reports `oauth.scope_drift` ("reconnect to grant new permissions"). The grant stays usable.
- Because every writer takes the lock and re-reads, "the stored refresh token changed while I waited" is handled by the re-read, not by a failure row.
- **Forced refresh is bounded.** `forceRefresh` (keep-alive) and `rejectedAccessToken` refresh only if, after the re-read under the lock, `refreshedAt` is earlier than the start of the call. A refresh that happened meanwhile satisfies them, so I1 (one refresh per window) holds for forced calls too.
- **Anti-corruption for token responses.** Token responses are parsed and validated at the boundary; a response without `access_token` or with a non-`Bearer` `token_type` is `connect_exchange_failed` (Connect) or `transient` (Refresh), and nothing partial is stored.
- Current hub defects this contract avoids:
  - `isReauthError` matches `/unauthorized/`, and so also `unauthorized_client`.
  - A swallowed transient refresh error lets an expired token reach the API, whose `401` is then read as reauth.

  (`error-classification.ts:125-129`, `credential-refresh.ts:140`.)

**Connect (provider callback):**
- `connect_cancelled`: `error=access_denied`.
- `connect_state_invalid`: missing, expired, replayed or mismatched state.
- `connect_exchange_failed`:
  - `invalid_grant` on the code exchange;
  - a redirect-URI mismatch;
  - a network failure;
  - an invalid token response;
  - a response without `refresh_token` when the descriptor's scopes request offline access (for Xero, `offline_access`). Otherwise that grant would "expire" 30 minutes later with a misleading reconnect prompt.
- `client_misconfigured`: `invalid_client`.
- `organization_scope_required`.
- `oauth_base_url_not_configured`: neither `NEXT_PUBLIC_APP_URL` nor `APP_URL` is set (Q9).

None of these touches an existing grant or the flag.

#### 1.4.6 Provider rotation semantics (provider documentation)

| Provider | Access TTL | Refresh token on refresh | Old refresh token after use | Concurrent-refresh race |
|---|---|---|---|---|
| Xero | 30 min | a new one every time | usable for a **30-min retry grace**, then invalid; unused tokens expire after **60 days** | **Harmful / undocumented.** Xero does not document which child of the same parent survives; vendor reports describe sporadic `invalid_grant` under concurrent workers. Must lock. |
| Microsoft (MS365 PR) | ~1 h | a new one every time | **not revoked**; 90-day lifetime | benign (a wasted call) |
| Google (Gmail) | 1 h | usually none | valid until revoked or expired | benign (a wasted call) |

**Residual risk (depends on Q1).** A process that dies after a successful Refresh but before its commit loses the rotated token. Recovery relies on redeeming the old refresh token inside Xero's grace window. What Xero returns on that second redemption is undocumented. If it fails, the grant becomes `invalidated` (a correct, visible outcome, not silent corruption). Probability ≈ crash rate × the ~200 ms persist window.

#### Checklist
- [x] Entities with ownership (grant aggregate: grant service; client config: admin; flag: projection)
- [x] Invariants I1–I7; failure contract
- [x] Precise fields
- [x] Access control (§2); data ownership stated

---

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---|---|---|---|---|---|
| Tenant Admin | feature `integrations.credentials.manage` (+ `integrations.view`) | internal | the active organization (never "all organizations") | integration detail, reauth banner, the provider's Connect tab | enters the Client Configuration; Connect / Reconnect / Disconnect |
| Integration Viewer | `integrations.view` | internal | active organization | status, banner, logs; no secrets | nothing mutating |
| Background Worker | system (job scope) | internal (no user) | the job payload's scope | — | calls the Token Provider |
| Integration Developer | n/a (code author) | — | — | core APIs, AGENTS.md | writes a descriptor, provider routes and a health check |
| Mailbox User (Phase 3 only) | `communication_channels.connect_user_channel` | internal | own user | own channels | per-user connect (hub unchanged) |

There is a single authenticated surface (the backend). **Portal: NOT USED.** No external persona connects providers.

Decision log:
- Connecting a tenant's accounting system is an administrative act, gated by the existing, immutable `integrations.credentials.manage`.
- No new ACL feature is added: it would be FROZEN and would need role backfills.
- If the admin's selection is "all organizations", Connect returns `organizationScopeRequiredResponse()` (400). A grant is always scoped to one Open Mercato organization.

#### Checklist
- [x] One identity type per persona; justified; organization scoping; single surface recorded

---

## 3. Workflows `PM`

### WF1: Connect a provider (tenant-level)

**Journey:**
1. The admin enters the Client ID and Secret and saves.
2. The admin clicks Connect on the provider tab.
3. The provider shows its consent screen.
4. The callback exchanges the code and calls `completeConnect` under the Grant Lock.
   - The grant is stored as `active`, with no External Account yet.
   - `reauthRequired` is projected to `false` if it was set, and an `oauth.connected` log entry is written.
   - With a live grant, it is updated in place (Reconnect); otherwise a new row is inserted.
5. A provider post-consent step runs. For Xero, the admin chooses the Xero organisation (the External Account). If Xero reports exactly one, it is chosen automatically.
6. The provider stores the choice with `updateProviderData` under the Grant Lock, and an `oauth.external_account_selected` log entry is written. `completeConnect` returned the previous `providerData`, so the provider can detect a different Xero organisation than before (Q10).
7. The first sync can run.

**ROI:** time-to-first-sync ≤ 5 min once the admin has provider credentials, with no manual token handling. Today, a tenant-level OAuth integration is impossible without bespoke code.

**Boundaries:**
- Starts when Connect is clicked with a saved Client Configuration.
- Ends when the grant is persisted **and** the External Account is chosen.
- NOT this workflow: editing the Client Configuration; running syncs.

**Edge cases:**
1. The admin abandons consent. The state expires in 5 min and nothing is written. (Risk: an orphaned half-grant.)
2. The admin abandons the Xero organisation choice after consent.
   - The grant exists (`active`) with no External Account.
   - The provider tab shows "Connected — choose a Xero organisation to finish".
   - The provider's adapter refuses to sync with its own precondition error ("no Xero organisation selected"). That is not a Token Failure and never a reauth.
   - (Risk: syncs run against no organisation.)
3. A callback is replayed. The state is single-use (aligned with PR #6267): `connect_state_invalid`. (Risk: a grant bound to the wrong session.)
4. Reconnect while a grant exists. The live row is updated in place under the lock. The previous refresh token is **not** revoked by default (`revokePreviousOnReconnect=false`), because the same Provider Authorization may back the new grant. (Risk: killing the grant just created.)
5. The selection is "all organizations": 400 `organization_scope_required`.
6. The redirect URI differs behind a proxy. The OAuth routes require a configured base URL (Q9), otherwise `oauth_base_url_not_configured`. Any exchange failure is `connect_exchange_failed`, never `grant_invalidated`.

**Platform readiness:**

| Step | Capability | Gap? | Notes |
|---|---|---|---|
| Save client config | integrations credentials form + masking | no | existing |
| State cookie | hub `oauth-state.ts`: provider-agnostic `providerKey` + `extra`, userId-bound | **no** (reuse) | single-use arrives with PR #6267; generalization is Phase 3 |
| Authorize URL + PKCE | none generic (~20 lines) | yes | provider-owned in Phase 2; moves to core in Phase 3 |
| Callback + exchange | the hub route is per-user and channel-specific | yes | provider-owned route calling `grantService.completeConnect` |
| Persist grant under the lock | none | **yes** | P1 + P4 (`completeConnect`) |
| External Account picker | none | yes | UI provider-owned (Xero spec); persistence through `updateProviderData` (P4) |

### WF2: Obtain a valid access token in background work

**Journey:**
1. A sync worker (any process) calls `getAccessToken(descriptor, owner, {minValidityMs})`.
2. If the grant is `active` and the token is fresh, it is returned with no lock.
3. Otherwise the worker tries the lock:
   - acquired → re-read → still stale? → Refresh → commit grant + projection;
   - not acquired → back off → re-read (usually refreshed by then).
4. The token is returned and the API call is made.
5. On a `401`, the worker calls once with `rejectedAccessToken`, or, for an `insufficient_scope` challenge, calls `reportResourceChallenge` and stops.

**ROI:**
- exactly one token-endpoint call per grant per expiry window, whatever the number of processes;
- 0 false flag flips;
- syncs longer than 30 min never fail on token expiry;
- 0 pool exhaustion caused by waiting.

**Boundaries:**
- Starts at any API call that needs a token.
- Ends when a token is returned or a Token Failure is raised.
- NOT this workflow: sync retry policy (data_sync engine).

**Edge cases:**
1. Five import workers across two processes hit expiry together, with pool max 20. One refresher; the rest back off without holding connections.
2. A process dies after Refresh but before commit: residual risk (§1.4.6).
3. The token endpoint hangs: 10 s timeout → `transient`. A still-valid stored token is returned `degraded`.
4. The DB fails at commit: `transient`; same recovery path as case 2.
5. A run spans token expiry. The adapter calls the provider per request or batch, not once per run.
6. The keep-alive job forces a refresh while a worker refreshes because of expiry. Whichever takes the lock second sees `refreshedAt` later than its call start and skips (§1.4.5, forced refresh is bounded).

### WF3: Detect lost consent and recover

**Journey:**
1. The Token Provider observes a terminal outcome under the lock.
2. It sets `invalidated` and projects the flag in one commit.
3. After commit, `integrations.state.updated` is emitted; an `oauth.invalidated` integration log entry is written in the transaction.
4. The banner appears on the integration detail page (it reads `oauthGrant.status`).
5. The admin reconnects (WF1), which sets `active` and clears the flag.

**ROI:**
- Signal precision is 100%: every invalidation traces to one of two causes in §1.4.5 (`invalid_grant` from the token endpoint, or a needed refresh with no stored refresh token).
- The grant is invalidated within one sync interval of the revocation and shown on the integration page, instead of the problem surfacing only in logs. Today the flag is dead for tenant integrations. Active push to the admin (notification) is Phase 3.

**Boundaries:**
- Starts at the first confirmed terminal outcome.
- Ends at a successful Connect.
- NOT this workflow: transient outages and misconfiguration (both go to health and logs).

**Edge cases:**
1. The Xero user removes the app in Xero. The next refresh returns `invalid_grant` and the grant is invalidated.
2. The refresh token sits idle for more than 60 days: same as case 1. Prevented for enabled integrations by the explicit weekly keep-alive (§1.4.4, Q6), not by the health probe.
3. The admin mistypes the Client ID. On read this gives `client_misconfigured` (`client_changed`), with no persistent state; fixing the typo recovers.
4. The admin rotates only the secret. If Xero revokes the old secret: `client_misconfigured`, not reauth.
5. Flapping (transient ↔ ok) never touches the grant status or the flag.
6. Scheduled syncs keep running after invalidation. Each run fails fast with `grant_invalidated` (no token-endpoint call; §1.4.5 first row) and is logged. Pausing schedules on invalidation needs the Phase 3 event.

### WF4: Disconnect

**Journey:**
1. The admin clicks Disconnect and confirms. The provider's Disconnect route runs the integrations mutation guards like `api/[id]/state/route.ts`. It is deliberately **exempt from optimistic locking**: the grant row's `updated_at` moves on every refresh (about every 30 min for Xero), so a version header would cause spurious 409s, and Disconnect is idempotent and serialized by the Grant Lock.
2. **Under the lock, one transaction:**
   - capture the tokens;
   - blank the blob and soft-delete the row;
   - project the flag to `false` if it was set;
   - append `oauth.disconnected` and `oauth.revocation_pending` log entries (tx-bound log service, no secrets);
   - commit. I5 holds from here.
3. **After release (best-effort):** re-read the owner's grant first.
   - **If a live grant exists again** (a Reconnect committed in between), skip provider cleanup and log `oauth.revocation_skipped_reconnected`. Revoking or deleting could destroy the new grant's Provider Authorization.
   - **If the captured grant was already `invalidated`**, skip the hook's refresh and Connections delete (access is already dead), attempt only the RFC 7009 revoke, and log `oauth.revocation_skipped_invalidated` if that isn't possible.
   - **Otherwise**, run the provider hook with the captured tokens. For Xero: refresh once if the access token has expired, then `DELETE /connections/{id}`. Then RFC 7009-revoke the **most recent** refresh token (the one the hook's refresh returned, if it refreshed).
4. Append `oauth.revocation_confirmed` or `oauth.revocation_failed` (with the provider error code) unless step 3 already logged a skip.

**ROI:** 0 decryptable refresh tokens in the live database after disconnect (today, 100% are retained indefinitely). Backups keep older encrypted copies until their retention expires (I5), so provider-side access actually ending, whenever the provider is reachable, is the part that removes the residual risk.

**Boundaries:**
- Starts when the admin confirms Disconnect.
- Ends when the local erase has committed and the provider cleanup has either finished or been logged as failed or skipped.
- NOT this workflow: deleting the integration's business data, disabling the integration (`isEnabled` is unchanged), pausing schedules.

**Edge cases:**
1. The provider is unreachable. The local erase is already committed. The log says `oauth.revocation_failed`, and the UI copy says so too.
2. The process dies between the erase commit and the revoke. The captured tokens are lost with it, so revocation cannot be retried by the platform. After 5 minutes, the `oauth.revocation_pending` entry without an outcome makes this **detectable**: the UI and the Logs tab show "revocation not confirmed", and the admin is pointed to the provider's Connected Apps screen.
3. A sync is running. Its next `getAccessToken` gets `not_connected`, and the run fails with a clear code, never reauth.
4. Disconnect races a refresh. Whichever gets the lock second re-reads: a refresh after the erase finds no live row and returns `not_connected`, so an erased grant is never resurrected.
5. Disconnect, then quick Reconnect.
   - The Reconnect inserts a **new** row; the tombstone is never read (it's filtered by `deleted_at IS NULL`).
   - A refresh right after sees exactly one live row (I2 test).
   - The post-release cleanup of the old grant sees the new live grant and skips (step 3).
6. Undo: tenant-level Disconnect is **not undoable** (the secrets are gone). This differs from the hub's undoable channel disconnect, which stays unchanged (Q5).
7. Two OM organizations connected the same Xero organisation through the same Provider Authorization. Revocation for one OM organization may break the other (Q8). The UI warns when `providerData` shows a shared authorization, and Xero verifies in its sandbox.
8. The grant was already `invalidated` (e.g. the app was removed in Xero). The local erase happens as usual, and provider cleanup is skipped as in step 3, so the admin doesn't see a misleading "could not confirm revocation".

### WF5: Build a new OAuth provider integration (developer journey)

**Journey:**
1. Declare the Client Configuration fields and a Provider Descriptor.
2. Write the initiate and callback routes (≈ 60 lines) using the hub state cookie plus the core's `completeConnect`. Write routes (callback, External Account save, Disconnect) run the integrations mutation guards like `api/[id]/state/route.ts`; the tab wraps its writes in `useGuardedMutation`, and the Disconnect confirm dialog handles Cmd/Ctrl+Enter and Escape.
3. Inject a Connect tab via `detailPage.widgetSpotId`; if the provider has an External Account, add the picker and persist the choice with `updateProviderData`.
4. Implement the health check via `inspectGrant` (never `getAccessToken`) and, if needed, a keep-alive job.
5. Have the adapter call the Token Provider (and `reportResourceChallenge` on `insufficient_scope`).
6. Test against the fake authorization server.

**ROI:** ≤ 5 commits for the OAuth part (vs about 9 self-contained); 0 provider-local lock or refresh code.

**Boundaries:**
- Starts when a provider package needs delegated OAuth2 access with a refresh token.
- Ends when its connect, token use, health check and disconnect run on the core with tests against the fake authorization server.
- NOT this workflow: providers that authenticate with a static key or a password grant (Akeneo, InPost, KSeF); user login (SSO).

**Edge cases:**
1. The provider doesn't rotate refresh tokens (Google-like). No descriptor change needed; a refresh without `refresh_token` keeps the stored one.
2. The provider has no revocation endpoint. `revocationEndpoint` is omitted; Disconnect erases locally and logs `oauth.revocation_failed` with reason `unsupported`. The UI says access was cleared locally only.
3. The provider rejects PKCE for confidential clients. The descriptor sets `pkce: 'none'` (Q2 for Xero).
4. The provider needs no External Account. The developer never calls `updateProviderData`, and `hasExternalAccount` is irrelevant.
5. The provider's token response omits `expires_in`. `defaultAccessTokenTtlSec` applies.

#### Checklist
- [x] 5 workflows with journey, ROI, boundaries, edge cases. Per-step platform readiness is tabulated for WF1; for WF2–WF5 it is the commit mapping in §4.2.
- [x] > 200 lines of new code only for WF2 (grant service ≈ 300 lines incl. classification). Justified: no existing capability does cross-process refresh; it reuses the P1 helper.

---

## 3.5 UI Architecture `PM + UX`

- **Navigation:** unchanged (Settings → Integrations → *provider*).
- **Dashboard widgets:** none.
- **Custom pages:** none owned by the platform.

**Widget injections (provider-owned):**

| Widget | Injects into | Spot | Owner |
|---|---|---|---|
| Connect / Reconnect / Disconnect + External Account picker | integration detail page (tab) | `buildIntegrationDetailWidgetSpotId('<integrationId>')` | provider (Xero spec) |

**Platform UI change:** a **reauth banner** in the integration detail header, shown only when the integration's live OAuth grant has `status = invalidated`.
- **Data source:** the detail API gains an optional response field `oauthGrant: { status: 'active' | 'invalidated' | 'unavailable' } | null` (additive; `null` = no live grant). The generic route has no Provider Descriptor (there is no registry, §1.4.3), so it reads the status with **`readGrantStatus(integrationId, scope)`**: a descriptor-free read of the grant row's `status`, with no lock, no network call and no writes. It returns `'unavailable'` instead of throwing, so a decrypt failure never turns the detail GET into a 500. `inspectGrant(descriptor, owner)` stays the provider's health-check read, because `clientChanged` needs the descriptor's Client Configuration.
- **Not the flag:** the banner doesn't read `reauthRequired`. Integrations without a grant (Stripe, S3, the channel hub, …) never show it, whatever their stored flag. A manually written flag can't show or hide it.
- **Copy:** "Access to <title> was revoked or expired. Reconnect to resume."
- **Link:** to the provider tab when the integration declares a `detailPage.widgetSpotId`, otherwise plain text.
- **Styling:** `role=alert`, DS status tokens only.

The `oauth` field type stays unrendered (Phase 3 decides whether to render it or remove it from docs).

**Key flows:**

| Persona | Task | Flow | Clicks |
|---|---|---|---|
| Tenant Admin | first connect | Integrations → Xero → Connect tab → Connect (→ consent → choose Xero organisation) | 3 + provider screens |
| Tenant Admin | recover | Integrations → Xero (banner) → Reconnect | 3 |
| Tenant Admin | disconnect | Integrations → Xero → Disconnect → confirm | 3–4 |
| Integration Viewer | check status | Integrations → Xero (status, banner, logs) | 2 |

**Empty states:**
- Connect tab without a Client Configuration: "Add your Client ID and Secret on the Credentials tab first."
- Connect tab without a grant: "Not connected."
- Connect tab with a grant but no External Account: "Connected — choose a Xero organisation to finish."

#### Checklist
- [x] Flows ≤ 3 clicks; platform building blocks only; empty states; portal N/A

---

## 4. Workflow Gap Analysis `Architect`

### 4.1 Platform commit plan (Phase 1)

| ID | Commit | Package | Score |
|---|---|---|---|
| P1 | `withAdvisoryXactLock(em, key, fn, { waitDeadlineMs, tryOnce? })`. Callers pass a namespaced key (`<namespace>:<parts>`); the helper rejects keys without a namespace prefix. Always runs on a context-detached fork (`useContext: false`), never nested in a caller's transaction (I6). Explicit `exports` entry in `packages/shared/package.json`. Uses `pg_try_advisory_xact_lock(hashtextextended(key,0))` with jittered back-off (no connection held while waiting), an optional `onWait` re-check callback, and a single-attempt mode (`tryOnce`, used by `reportResourceChallenge`). `fn(txEm)` must do all DB I/O on `txEm`. `55P03`/`57014` and `isTransientDbError` → typed `transient`. Tests: Jest unit tests of the loop, back-off, deadline and error mapping on a mocked connection; real contention (2 connections, waiters ≥ pool size) is covered by the P4 Playwright suite. | `shared/src/lib/db/advisoryLock.ts` | 1 |
| P2 | Token-endpoint client (basic/post, timeout, RFC 6749 §5.2 structured error) + RFC 7009 revoke. No hub changes. | `core/.../integrations/lib/oauth/token-endpoint.ts` | 1 |
| P3 | `integrationCredentialsService.erase(integrationId, scope)`: blank + soft-delete. The exported `CredentialsService` type becomes an explicit type (today `ReturnType<typeof createCredentialsService>`) declaring `erase?` as optional; a type-level test asserts the factory's return type still satisfies it, so the explicit type can't drift narrower. DI overrides and test doubles typed as `CredentialsService` keep compiling. The grant service always uses the core factory bound to the lock transaction, where `erase` exists (§1.4.2). | `integrations/lib/credentials-service.ts` | 1 |
| P4 | `integrationOAuthGrantService` (DI, scoped). Operations: `getAccessToken` (options `minValidityMs`, `rejectedAccessToken`, `forceRefresh`, all bounded by the `refreshedAt`-vs-call-start rule), `inspectGrant` (no network, no lock, no writes; never throws on decrypt failure), `readGrantStatus` (descriptor-free status read for the detail route), `completeConnect` (update in place over a live grant, insert otherwise; returns the previous `providerData`), `updateProviderData`, `reportResourceChallenge` (non-blocking), and `disconnect` (erase + `revocation_pending` log in one tx; after release, re-read and skip cleanup if reconnected or already invalidated). Implements the §1.4.5 contract. It builds tx-bound credentials, state and log services inside the lock. Includes a fake authorization-server fixture (rotation none / non-revoking / strict + grace; error injection; counters). Classification and ordering tests run in Jest. Concurrency, interleaving, crash (fault-injection hook), outer-transaction rollback and ownership tests run against real Postgres through test-only routes, which use a dedicated small ORM pool (`poolMax=4`) for the pool test (see §7, "How the criteria are verified"). Decoupling test (no `.tsx` import). | `integrations/lib/oauth/grant-service.ts`, `core/src/helpers/integration/fakeOAuthServer.ts` | 5 |
| P5 | Projection + banner: `setReauthRequired` only on change, in the same transaction as each status change; fix `upsert` so a missing state row is created with the definition defaults (`defaultState.isEnabled`); `integrations.state.updated` emitted after commit. Optional `oauthGrant: { status }` field on the integration detail response, read with `readGrantStatus`. Detail-page reauth banner gated on `oauthGrant.status === 'invalidated'`; i18n. No new event or notification type. | `integrations` | 1 |
| P6 | Docs: integrations `AGENTS.md` "OAuth grants" section (budget check) + docs page. | docs | 1 |
| | **Phase 1 total** | | **10** |

### 4.2–4.5 Per-workflow totals

| Workflow | Platform | Provider (Xero) |
|---|---|---|
| WF1 Connect | P1, P4 | 3: PKCE + authorize URL + initiate/callback routes (1); Xero organisation picker + tab (1); descriptor + client fields (1) |
| WF2 Token | P1, P2, P4 | 1: adapter + health check via Token Provider |
| WF3 Reauth | P5 | 0 |
| WF4 Disconnect | P3, P4 | 1: `onAfterDisconnect` Connections delete + disconnect button |
| WF5 Developer | P6 | — |
| | **10** | **~5** |

### 4.6 Options compared

| Option | Platform | Xero OAuth | Next tenant-level provider | Risk |
|---|---|---|---|---|
| **A. Narrow fix.** Platform adds only P1 (lock) and P3 (erase). Xero is self-contained: its own token client, lock-and-re-read refresh, classification and in-tab reauth UI. | 2 | ~9 | ~9 (copy of Xero) | third copy of the token POST; `reauthRequired` stays dead for everyone else; the hardest code (I1–I3, I6 pool behaviour) re-implemented per provider |
| **B. Grant-lifecycle core (recommended)** | 10 | ~5 | ~5 | one DI service + one import surface to maintain |
| **C. Full toolkit.** B + generic `/api/integrations/[id]/oauth/*`, generic Connect UI honouring `oauth`, hub migration, state generalization. | ~15 | ~2 | ~2 | a generic account-picking abstraction and an externally registered callback URL, both fixed from a single example |

- **A** costs 11 commits in total vs 15 for B. It is the right choice only if maintainers don't want new platform surface before a second tenant-level consumer.
- **B** makes correct grant handling a platform standard: the correctness-critical parts live in one tested place, and every later provider inherits them and saves about 4 commits.
- **C** standardizes the connect UX from a single example; premature.

Detailed plan: `app-spec-notes/commits-oauth2-core.md`.

#### Checklist
- [x] Every step scored
- [x] Architect checkpoint done

---

## 4.5 Module Architecture `Architect`

### 4.5.1 Platform capabilities used

| Capability | Usage | Extension points |
|---|---|---|
| integrations credential store (encryption, KMS) | extend: optional `erase`, explicit exported type, sibling key | DI `integrationCredentialsService` for everyone else; grant rows use the core factory bound to the lock transaction (DI overrides deliberately not used there) |
| integrations state (`setReauthRequired`) | use (currently dead code); fix `upsert` defaults | DI `integrationStateService`, event `integrations.state.updated` |
| integrations health (`healthCheck.service`, probe worker, `details.code`) | use as-is | provider-declared health check |
| integrations logs | use as-is | `integrationLogService.write` (with `code`; §1.4.4) |
| Integration detail page | extend (banner) + provider tab | `detailPage.widgetSpotId` |
| Hub state cookie | use as-is (Phase 2) | `communication_channels/lib/oauth-state` |
| `shared/lib/url` | use as-is | — |
| data_sync | use as-is | adapter calls the Token Provider via `createRequestContainer()` |
| Error reporting | use | `reportError` for swallowed/best-effort paths |

### 4.5.2 Where it lives, justified against each charter

| Candidate | Charter (own AGENTS.md) | Fit | Decision |
|---|---|---|---|
| `packages/shared` | "infrastructure only… zero domain dependencies"; already hosts server-only `lib/db` | Fits the advisory-lock helper: pure DB infrastructure with ≥ 8 potential users. Protocol code could fit too, but its only consumers already depend on core, and it would create a shared cross-package contract (an "Ask First" item) with no consumer outside core. Grant storage **cannot** live here: it needs a core module's service. | **lock helper only** |
| `packages/core` → `integrations` | "foundation layer for all external connectors… Credentials API"; "providers import from integrations" | Owns the credential store, state, health, logs and detail page. | **everything else** |
| `communication_channels` | channel hub | Xero isn't a channel. Phase 1 leaves the hub untouched (Phase 2 imports its state cookie read-only). | untouched |
| New `@open-mercato/oauth` package | — | Justified only for isolating a third-party dependency, and hand-rolling removes that need. | rejected |

**Client-side reachability:** `shared` subpaths and core `.tsx` pages reach client bundles. Both new surfaces are server-only: they use `node:crypto` and MikroORM and sit under `lib/`. P4 adds a test asserting that no `.tsx` imports `integrations/lib/oauth`.

### 4.5.3 Library vs hand-rolled

**Hand-roll** the client side of authorization-code + refresh + revoke.
- *What we need:* an authorize URL, a PKCE S256 pair, a form POST with basic or post client authentication, RFC 6749 §5.2 error parsing, and an RFC 7009 revoke. That is about 150 lines, and the existing `requestOAuthToken` (81 lines) is already in production.
- *What libraries add that we don't need:* discovery, ID-token/JWT validation, DPoP, PAR, JAR, JARM.
- *What libraries don't solve:* storage, cross-process locking, classification.
- *Cost of adopting one:*
  - `openid-client` and `oauth4webapi` are ESM-only, and none of core's or the provider packages' Jest `transformIgnorePatterns` allowlist them. That's doable (precedent: `ai`, `kysely`) but touches every provider's config.
  - Core would gain a production dependency (an "Ask First" item).
  - The build is not a blocker (esbuild ESM, `bundle:false`).
  - SSO's only test mocks the whole library.
- **Revisit trigger:** a consumer needs DPoP, PAR, `private_key_jwt` or ID-token validation. Then adopt `oauth4webapi` behind the same interface.

### 4.5.4 Boundary with SSO: two deliberate layers

The two layers do different jobs:
- **SSO** (enterprise) is an OIDC relying party for **login**. It handles discovery against tenant-supplied issuers with SSRF guards, nonce and ID-token validation, sessions and JIT provisioning.
- **The grant core** is an OAuth client for **delegated API access**. It handles persisted refresh tokens, background use, locking and revocation.

What they would share is about 40 lines (PKCE and the state cookie), and core may not import enterprise anyway. **Keep them separate.** A later option: extract the AES-GCM state-cookie crypto into `shared` for both (Phase 3).

### 4.5.5 Shared modules

| Module | Status | Usage | Rationale |
|---|---|---|---|
| `shared/lib/db/advisoryLock` | PROPOSED | create | generic; existing hand-rolled sites may adopt it opportunistically |
| `integrations/lib/oauth` | PROPOSED | create | integration-generic, no provider logic |

### 4.5.6 App modules
None. The Xero module (owned by the Xero spec, not started yet) will be the first consumer.

#### Checklist
- [x] All items; the modifications to `integrations` are the upstream contribution itself (flagged)

---

## 5. User Stories `PM`

> Stories use Xero, the planned first consumer, as the concrete example. Everything except the Xero-specific details (Xero organisation picker, Connections API) applies to any tenant-level OAuth integration built on the core.

### WF1

**US-1.1** As a Tenant Admin, I connect Xero for my Open Mercato organization so that scheduled syncs can run.
**Success:**
- After consent, exactly one live `active` grant row exists for `(sync_xero, tenant, organization, null)`.
- `reauthRequired=false`, and one `oauth.connected` log entry is written.
- After the Xero organisation is chosen, `providerData` holds it and one `oauth.external_account_selected` entry is written.

**Happy path:** Connect → Xero consent → choose the Xero organisation → "Connected to <Xero organisation name>".
**Alternate paths:**
- Exactly one Xero organisation: it is chosen automatically.
- Reconnect over a live grant: the live row is updated in place under the lock. The previous refresh token is kept unrevoked (default). The log entry records `reconnect: true`.
- Reconnect after a disconnect: a new row is inserted; the tombstone stays unread.
- The admin abandons the Xero organisation choice: the grant stays `active` without an External Account. The tab shows "Connected — choose a Xero organisation to finish", and syncs are refused by the provider with "no Xero organisation selected" (not a reauth).
- A different Xero organisation than last time: `completeConnect` returned the previous `providerData`, so the provider warns before `updateProviderData` (Q10).

**Failure paths:**
- `connect_cancelled`: "Connection cancelled".
- `connect_state_invalid`: "Connection expired, try again".
- `client_misconfigured`: "Client ID or Secret rejected by Xero".
- `connect_exchange_failed`: "Xero did not complete the connection" (logged with the provider error code), including a response without a refresh token.
- `organization_scope_required` ("All organizations" selected): 400.
- `oauth_base_url_not_configured`: "Set APP_URL before connecting" (operator error).

In every failure case, any existing grant and the flag are untouched.

**US-1.2** As an Integration Developer, I build the initiate and callback routes from core primitives, so that I write no token-POST, lock or storage code.
**Success:** each route is ≤ ~60 lines, and every grant write goes through `completeConnect` or `updateProviderData`.
**Happy path:** the callback exchanges the code, calls `completeConnect`, and redirects to the picker.
**Alternate:**
- `pkce: 'none'` in the descriptor for a provider that rejects PKCE.
- No External Account step for a provider that doesn't need one.

**Failure:** a malformed descriptor (missing `tokenEndpoint`) throws on first use with a typed error (unit-tested). Nothing is written.

### WF2

**US-2.1** As the Background Worker, I get a valid access token no matter how many processes ask at once, so that a rotation race never costs the tenant its grant.
**Success:**
- The strict-rotation fake sees exactly 1 refresh for 20 concurrent callers over 2 connections.
- All callers get the same new token.
- There are 0 `invalid_grant` responses.
- With `poolMax=4` and 10 waiters, there are 0 acquire timeouts.

**Happy path:** the token is fresh and is returned without the lock.
**Alternate:** the token is stale and another process already refreshed it. The back-off re-read returns the new token with no network call.
**Failure paths:**
- Token-endpoint timeout → `transient`. If the stored token is still valid now, it is returned with `degraded: true`; the grant status and tokens are unchanged.
- Wait deadline or a transient DB error → `transient`; nothing is written.
- Commit failure after Refresh → `transient` (residual risk, §1.4.6).
- The grant can't be decrypted → `platform_unavailable`; nothing is written.

**US-2.2** As the Background Worker, after an API `401` I retry once with a fresh token, so that an early-revoked access token doesn't fail the batch.
**Success:** a forced refresh happens only if, after the re-read, the stored token still equals `rejectedAccessToken` and `refreshedAt` is earlier than the call's start.
**Happy path:** API `401` → `getAccessToken({ rejectedAccessToken })` → one refresh → the retry succeeds.
**Alternate paths:**
- Another process refreshed meanwhile: the stored newer token is returned without a refresh.
- The `401` carries `insufficient_scope` / `insufficent_scope`: no refresh. The caller calls `reportResourceChallenge` and stops that call (§1.4.5).

**Failure paths:**
- A second `401` is a resource error; the grant status and flag are untouched.
- The forced refresh returns `invalid_grant` → `grant_invalidated` (US-3.1).

### WF3

**US-3.1** As a Tenant Admin, I'm told when Xero access was revoked, so that I reconnect before data goes stale.
**Success:** on the first confirmed terminal outcome:
- the grant is `invalidated` and the flag projected, in one commit;
- an `oauth.invalidated` log entry is written;
- the banner shows on the integration page (it reads `oauthGrant.status`).

**Alternate:** several workers hit it at once. The first under the lock invalidates; the others see `invalidated` on read, so there is one log entry.
**Failure:** the state write fails. It's in the same transaction as the invalidation, so neither commits, and no event is emitted (the event goes out after commit). The next call re-evaluates.

**US-3.2** As a Tenant Admin, a Xero outage never tells me to reconnect.
**Success:** every `transient` row in §1.4.5 is tested to leave the grant status, the tokens and the flag untouched.
**Happy path:** Xero returns 503 → the call is `transient`; a still-valid token is used `degraded`; the next scheduled run succeeds.
**Alternate:** the outage outlasts the access token → runs fail `transient` until Xero recovers, then the next refresh succeeds with the stored refresh token.
**Failure:** if the outage exceeds the refresh token's lifetime, the next refresh returns `invalid_grant` → US-3.1 (a genuine expiry, not a false alarm).

**US-3.3** As a Tenant Admin, a bad Client ID or Secret tells me to fix the configuration, not to reconnect.
**Success:**
- `invalid_client` on a real refresh records `lastFailureClass = client_misconfigured`, and `client_changed` is computed on read.
- `inspectGrant` exposes both, and the health check reports `oauth.client_misconfigured` without calling the token endpoint.
- The grant status stays `active`, and the flag is unchanged.

**Happy path:** the admin fixes the secret → the next refresh succeeds and clears `lastFailureClass`/`lastFailureAt`.
**Alternate:** the admin changed the Client ID on purpose → Reconnect with the new client replaces the grant.
**Failure:** the admin never fixes it → runs keep failing `client_misconfigured` and the health check stays unhealthy; no reauth banner is shown, because reconnecting would not help.

### WF4

**US-4.1** As a Tenant Admin, I disconnect Xero so that Open Mercato no longer holds access to my books.
**Success:**
- In one commit: the grant row is blanked and soft-deleted, the flag cleared if set, and `oauth.disconnected` + `oauth.revocation_pending` logged.
- After that, the Xero Connection is deleted and the refresh token revoked when reachable, and the outcome entry is appended.
- In the live database no decryptable refresh token remains; backups are covered by revocation, not by erasure (I5).

**Alternate paths:**
- No grant exists → no-op success.
- The grant was already `invalidated` → local erase; provider cleanup skipped (`oauth.revocation_skipped_invalidated`).
- A Reconnect committed before the cleanup ran → cleanup skipped (`oauth.revocation_skipped_reconnected`).

**Failure paths:**
- Xero is unreachable. Local erase is done; the UI says: "Disconnected here. Xero could not confirm revocation — remove the app in Xero's Connected Apps to be sure."
- The process crashes after the erase commit: after 5 minutes, `revocation_pending` with no outcome → same UI message.

### WF5

**US-5.1** As an Integration Developer, I test my provider against a fake authorization server so that CI covers a full round trip.
**Success:** the fixture supports auth-code, refresh (none / non-revoking / strict + grace), revoke, error injection and call counters. It is used by the P4 tests and by the Xero integration tests.
**Happy path:** a provider test runs connect → getAccessToken → disconnect against the fixture.
**Alternate:** the fixture runs in rotation-"none" mode to mimic a Google-like provider.
**Failure:** a fixture configured to return `invalid_grant` makes the test observe `grant_invalidated` and the banner status; a fixture delay beyond the timeout makes it observe `transient`.

### Default stories
**US-0.1 and US-0.2: N/A.** This is a platform capability with no demo users or demo data; the fixtures (US-5.1) take their place.

### Cross-story impact matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|---|---|---|---|---|
| US-1.1 reconnect | live grant updated in place, `active` | US-2.1 refresh in flight | refresh writes the old chain | I2: the refresh re-reads under the lock; the second writer sees the new grant |
| US-1.1 reconnect | Provider Authorization | the same Xero organisation in another OM organization | revoking the previous token kills the other grant | `revokePreviousOnReconnect=false` by default; Q8 |
| US-1.1 abandoned picker | grant `active`, no External Account | scheduled syncs | syncs against no organisation | the provider adapter refuses with its own precondition error; the tab asks to finish |
| US-1.2 malformed descriptor | none | every operation of that provider | runtime failure mid-connect | typed error on first use, before any write |
| US-2.1 refresh | rotated tokens | US-4.1 disconnect | refresh resurrects an erased grant | shared lock + re-read: no live row → `not_connected` |
| US-2.2 forced refresh / keep-alive | rotated tokens | US-2.1 | double refresh in one window | forced refresh skips if `refreshedAt` is later than the call's start |
| US-3.1 invalidated | grant status + flag | admin PUT clears the flag (API only) | the flag disagrees with the grant | no effect: the banner reads the grant status, and `getAccessToken` still returns `grant_invalidated` |
| Admin PUT sets `reauthRequired=true` (API only) | flag | grant `active` | a stale flag in the API | no UI effect (the banner reads the grant status); overwritten at the next status change |
| US-3.1 invalidated | status | scheduled data_sync runs | a failed run every interval | each run fails fast with `grant_invalidated` (no token call) and is logged; pausing schedules needs the Phase 3 event |
| US-3.2 transient | `lastFailureClass`/`At` only | US-3.3 health | a stale "misconfigured" after recovery | both diagnostics are cleared on the next successful Refresh |
| Health probe (existing, every 15 min) | none on tokens | US-2.1 | a probe that refreshed would compete for the lock and exceed its 10 s timeout | the health check calls `inspectGrant` only (no refresh); keep-alive is an explicit weekly job |
| Keep-alive job | rotated tokens | disabled integrations | an idle grant expires while the integration is disabled | keep-alive skips disabled integrations by design; re-enabling may need a Reconnect (§1.4.4) |
| Admin state PUT `isEnabled=false` (existing) | integration disabled | US-2.1, keep-alive | tokens stop being used and refreshed | intended; the grant is kept; Disconnect is the way to erase it |
| Projection write (runtime) | `integration_states.updated_at` | admin state PUT open in a browser | a 409 on the enable toggle | written only on change; the residual 409 is accepted (§1.4.2) |
| Projection on a missing state row | new `integration_states` row | integrations enabled by definition default | silently disabled | `upsert` creates missing rows with the definition defaults (P5) |
| US-4.1 disconnect → US-1.1 reconnect | tombstone + new row | US-2.1 | a stale row read as live | every lookup filters `deleted_at IS NULL`; I2 test covers disconnect → reconnect → refresh |
| US-4.1 post-release cleanup → US-1.1 quick reconnect | Provider Authorization | the new grant | revoking the old token or deleting the Connection kills the new grant | cleanup re-reads and skips when a live grant exists (`revocation_skipped_reconnected`) |
| US-3.1 invalidated | status | US-1.1 | a stale flag after reconnect | `completeConnect` sets `active` and clears the flag in the same commit |
| US-4.1 disconnect | grant erased | running data_sync | a run fails mid-way | `not_connected`, an explicit run error, never reauth |
| Admin credential save (existing), Client ID changed | client config | US-2.1 | the client id changed under a live grant | `client_changed` on read (non-persistent) |
| Admin credential save (existing), secret only | client config | US-2.1 | the next refresh uses the new secret | works if the secret is valid; `client_misconfigured` if not (US-3.3); never reauth |
| US-5.1 fixture | none | all P4 tests | tests depend on fixture fidelity | the fixture covers the three rotation modes documented in §1.4.6 |
| Health probe (existing) | health status | US-3.3 | two writers | only the health service writes health; the grant service never does |

#### Checklist
- [x] All stories complete with alternate and failure paths; matrix covers all stories and the existing platform behaviours they touch

---

## 6. User Story Gap Analysis `Architect`

| Story | Platform match | Commits |
|---|---|---|
| US-1.1 | P1, P4 (`completeConnect`, `updateProviderData`) + Xero routes/picker/tab | (P) + 3 Xero |
| US-1.2 | P4 `completeConnect` | (P4) |
| US-2.1 / 2.2 | P1, P2, P4 (incl. `reportResourceChallenge`) | (P) |
| US-3.1 | P5 | (P5) |
| US-3.2 / 3.3 | P4 + provider health check | (P4) + (Xero 1) |
| US-4.1 | P3, P4 + Xero hook | (P) + 1 Xero |
| US-5.1 | P4 fixture | (P4) |

**Upstream dependencies / merge order** (read-only tracker check, 2026-09-27):
- [#6333](https://github.com/open-mercato/open-mercato/issues/6333), PR [#6478](https://github.com/open-mercato/open-mercato/pull/6478) and PR [#6433](https://github.com/open-mercato/open-mercato/pull/6433) change `credential-refresh.ts`. Phase 1 doesn't touch the hub; Phase 3 rebases on them.
- PR [#6267](https://github.com/open-mercato/open-mercato/pull/6267) (single-use state cookie) should merge before Xero's Phase 2 routes rely on the hub cookie.
- PR [#6266](https://github.com/open-mercato/open-mercato/pull/6266): independent.
- PR [#5898](https://github.com/open-mercato/open-mercato/pull/5898) (MS365): second hub consumer; a Phase 3 candidate.
- PR [#5450](https://github.com/open-mercato/open-mercato/pull/5450): error-taxonomy alignment for data_sync runs:
  - `transient` → run-transient;
  - `grant_invalidated`, `client_misconfigured`, `scope_insufficient`, `not_connected` and `platform_unavailable` → run-terminal.

#### Checklist
- [x] Mapped; architect checkpoint done

---

## 7. Phasing & Rollout `PM`

### Phase 1: Grant-lifecycle core (platform) — 10 commits

**Goal:** any integration can hold a tenant-level grant that:
- refreshes safely across processes without starving the pool;
- reports a trustworthy reauth signal;
- can be truly disconnected.

**Why this order:** it sets the platform's standard way to hold and use a grant before a second copy of that logic appears. Xero, the planned first consumer, can't ship reliably without it.

It ships **dark**:
- Nothing existing calls the new code.
- The banner renders only for an integration whose live OAuth grant is `invalidated`, and no integration has one until a provider adopts the core.
- There is no migration, no new production route and no new ACL feature.

**Domain criteria** `DDD`:
- [ ] I1: 20 concurrent callers over 2 connections against a strict-rotation fake → exactly 1 refresh.
- [ ] I2: interleaved reconnect/refresh/disconnect (injected delays) never leaves an older refresh token stored, never resurrects an erased grant, and never creates a second **live** tenant-level row. Explicit case: disconnect → reconnect → refresh leaves exactly one live row plus one tombstone, and the refresh uses the new row.
- [ ] I3:
  - each §1.4.5 row has a test asserting the class, the grant status and the flag;
  - the grant and flag always agree after every grant-service commit;
  - a first projection write on an integration without a state row and with `defaultState.isEnabled: true` leaves it enabled.
- [ ] I4:
  - the admin credentials GET for `<integrationId>__oauth_grant` answers 404;
  - the `oauthGrant` response field carries only `{ status }`;
  - integration log payloads, error reports and `sync_runs.parameters` written during the P4 suites contain no token value (asserted by scanning for the fake server's issued tokens).
- [ ] I5:
  - after `disconnect`, a raw query on the live database finds no decryptable refresh token for the owner, even when the fake revocation endpoint is down;
  - a crash injected right after the erase commit (test-only fault-injection hook) leaves `revocation_pending` without an outcome entry;
  - a quick Reconnect before the cleanup makes the cleanup log `revocation_skipped_reconnected` and leaves the new grant working.
- [ ] `inspectGrant` on a grant whose access token has expired makes **no** token-endpoint call (fake AS counter = 0), takes no lock and writes nothing.
- [ ] Forced refresh: `forceRefresh` and `rejectedAccessToken` issued concurrently with an expiry refresh produce exactly one token-endpoint refresh.
- [ ] I6: with `poolMax=4` (a dedicated pool created by the test-only route) and 10 waiters, there are 0 acquire timeouts; the holder performs exactly one external call under the lock; `55P03`/`57014` are classified `transient`; a `getAccessToken` that refreshes inside an outer transaction which then rolls back still leaves the rotated token persisted.
- [ ] I7: two owners that differ only by organization, and two that differ only by tenant, are refreshed and disconnected independently; neither operation reads, changes or erases the other's row.
- [ ] Reconnect over a live grant updates that row in place (still one live row); `updateProviderData` is serialized with refresh under the Grant Lock.

**How the criteria are verified.** Classification and ordering run as Jest unit tests against an in-process fake authorization server (a real HTTP server, not a stubbed `fetch`). The database-bound criteria (I1, I2, I3, I4, I5, I6, I7 and the reconnect/forced-refresh criteria) run as Playwright integration tests against real Postgres (in `packages/core/src/modules/integrations/__integration__/`), through **test-only routes**. The routes:
- register a test OAuth provider;
- expose the fake authorization server's endpoints and counters;
- offer a fault-injection hook (e.g. "crash after the erase commit");
- run the pool test on a dedicated small ORM pool. They are gated by an environment flag and return 404 without it, following the `communication_channels` `test-seed` precedent (`OM_ENABLE_TEST_CHANNEL_SEEDING`). Concurrent requests use separate DB connections, which exercises the same advisory-lock mechanism as separate processes. The detailed test design belongs to the feature spec.

**Business criteria** `PM`:
- [ ] A minimal provider (fake AS) can be built from exported APIs alone, following the integrations `AGENTS.md`.
- [ ] The admin sees the banner when a grant is invalidated (component test + one Playwright check that invalidates a test grant through the test-only routes), and a flag set through the existing state PUT on an integration **without** a grant shows no banner.

**Value delivered:** the platform has one tested standard for OAuth grants (refresh, reconnect signal, disconnect), and `reauthRequired` means something.
**ROI metric:** the OAuth part of a tenant-level provider falls from ~9 to ~5 commits (Xero will be the first, every later provider after it); 0 new hand-rolled locks or refresh loops.
**Copy test:** a provider copied from this teaches "descriptor + two thin routes + health check + Token Provider", not "write your own refresh".
**PM's challenges to the DDD criteria:**
- The multi-*process* test is cut in favour of multiple DB connections in one process. Advisory locks are per-session, so the mechanism is identical at a fraction of the CI cost.
- The pool-starvation test is **kept**: waiters holding pooled connections is a real failure mode under the default pool (§1.4.1, DB constraints).

### Phase 2: Xero on the core (owned by the Xero spec) — ~5 commits

**Goal:** the admin connects Xero, chooses a Xero organisation, and syncs run on schedule and survive token expiry.
**Commits:**
1. descriptor + client fields;
2. PKCE + authorize URL + initiate/callback (require a configured base URL, Q9);
3. Xero organisation picker + tab (persisted with `updateProviderData`);
4. adapter + health check (`inspectGrant`) + daily keep-alive job (Q6);
5. disconnect hook.
**Acceptance:** integration tests against the fake AS; manual sandbox QA of connect → a sync longer than 35 minutes → disconnect.

### Phase 3: Triggered extractions (not scheduled)

| Item | Trigger | Est. |
|---|---|---|
| Generic `/api/integrations/[id]/oauth/*`, generic Connect UI deriving the `oauth` field from the descriptor, and PKCE/authorize-URL/state-cookie moved to core with hub bridges | a second tenant-level OAuth provider is committed (e.g. the Google Workspace spec) | ~5 |
| Hub delegates to the grant service; fix `isReauthError`; per-user strict reads | a strict-rotation per-user provider appears, or maintainers want consolidation; after #6478/#6433 merge | ~3 |
| Existing hand-rolled locks adopt `withAdvisoryXactLock` | opportunistic | 0–8 |
| Notification on invalidation (`integrations.oauth_grant.invalidated` event + `integrations.integration.reauth_required` notification type) and automatic repair of manually set `reauthRequired` | admins miss revoked grants in practice, or a second consumer needs the event | ~1–2 |
| Operator guidance: register a **separate OAuth client** (client ID) for integrations and for login (SSO) at the same provider. Reasons: login needs only `openid email profile` while an integration needs API scopes (e.g. mail), so users aren't asked for mailbox access at every login; Google's verification of restricted scopes (Gmail, with a third-party security assessment) can't block login; a leaked secret of one client doesn't open the other area. The core already stores the two configurations separately (§4.5.4); this is documentation only | the first provider that offers both login and an integration (Google Workspace, Microsoft 365) | 0 (docs, within that provider's commits) |

### Rollout summary
```
Phase 1: grant-lifecycle core  10 commits    WF2, WF3, WF4 (+ WF1/WF5 primitives)
Phase 2: Xero consumer          ~5 commits   WF1 end-to-end (Xero spec)
Phase 3: triggered          ~9–18 commits   each item only when its trigger fires (many are optional)
                                ----------
                                ~15 commits to production-ready (Phases 1–2)
```

#### Checklist
- [x] Ordered by priority × gap × blockers. Phase 1 is complete but dark: it has testable acceptance and no user-facing half-state, but its business ROI is realized only with Phase 2 (a deliberate deviation for a platform capability).
- [x] Workarounds (§4.6 A); commits; DDD + PM criteria; ROI

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs | Resolution |
|---|---|---|
| Google Workspace lists "Generic core OAuth renderer" as out of scope and plans provider-owned OAuth (`oauth.ts`, `oauth-session.ts`) | `2026-03-29-google-workspace-integration.md` | Consistent: connect UX stays provider-owned here too. Google Workspace should use the Phase 1 core for tokens. Its arrival is the Phase 3 trigger. |
| The email foundation made the hub the OAuth home | `2026-05-21-email-integration-foundation.md` | Phase 1 doesn't touch the hub; Phase 3 migrates with bridges. |
| Disconnect retention: the hub keeps tokens (for undo), this spec erases | email specs vs. this spec | Different aggregates: channel disconnect stays undoable and unchanged; tenant-level grant disconnect erases. Q5 goes to the hub owners. |
| data_sync error taxonomy | PR #5450 series | mapped in §6 |
| Xero integration spec (implementation not started) | Xero spec | This spec owns the descriptor contract, Token Provider, failure contract and disconnect semantics. The Xero spec owns routes, PKCE/URL, picker, health check, keep-alive and Xero API specifics. |

#### Checklist
- [x] All resolved

---

## 9. Reference App Quality Gate `Architect`

N/A: this is a platform capability. Anti-patterns to avoid:
- provider-local refresh locks, or an in-process `Map` as the only guard;
- tokens stored in the admin-edited credentials row;
- any `401` or "unauthorized" text mapped to reauth;
- lock waiters that hold a pooled connection;
- DB I/O inside a lock section on a non-transaction EntityManager;
- a lock transaction nested in a caller's transaction (a context-bound fork);
- round-trip tests with stubbed `fetch` and no fake authorization server.

---

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|---|---|---|---|---|
| Q1 | Xero: when one refresh token is redeemed twice within the grace window, which child stays valid? | sandbox test | the residual-risk recovery path (§1.4.6); the design doesn't depend on it | Xero spec | OPEN — not stated in Xero's documentation |
| Q2 | Does Xero accept S256 PKCE from a *web app* client that also sends a secret? | yes → `S256`; no → `none` | low (a descriptor flag) | Xero spec (sandbox) | OPEN |
| Q3 | Maintainer sign-off on new contract surfaces (§10.1): new import paths `@open-mercato/shared/lib/db/advisoryLock` and `@open-mercato/core/modules/integrations/lib/oauth/*`; DI name `integrationOAuthGrantService`; the explicit exported `CredentialsService` type with optional `erase`; the optional `oauthGrant` response field; runtime emission of `integrations.state.updated` with `userId: null`; the `upsert` defaults fix | approve / trim | **BLOCKER** for the Phase 1 merge | maintainers | OPEN |
| Q4 | Merge order vs. #6267, #6478, #6433 | per §6 | medium | contributor | OPEN |
| Q5 | Should the hub's channel disconnect erase tokens? (It conflicts with undo.) | keep / erase-on-delete / erase after N days | privacy | hub owners | OPEN (out of scope) |
| Q6 | Idle-grant keep-alive: a Xero refresh token dies after 60 days unused | explicit scheduled refresh / health probe as implicit keep-alive | medium | provider (Xero spec) | **Decided:** an explicit provider-owned daily job refreshes a grant whose `refreshedAt` is older than 7 days, via `getAccessToken({ forceRefresh: true })`. The health probe is deliberately **not** a keep-alive (§1.4.4): it would refresh every ~30 min, compete for the lock, and exceed the 10 s health timeout. |
| Q7 | Option A vs. B | A / B | scope | maintainers | RECOMMEND B |
| Q8 | Provider Authorization shared across Grant Owners: does revoking or deleting a Xero Connection for one Open Mercato organization break another? | sandbox test; UI warning | data availability | Xero spec | OPEN |
| Q9 | `redirect_uri` falls back to the request origin when `NEXT_PUBLIC_APP_URL`/`APP_URL` are unset (`shared/src/lib/url.ts:240-250`); RFC 9700 requires exact matching | require a configured base URL / keep fallback | connect breaks behind proxies | Xero spec implements; Phase 3 generic routes inherit | **Decided:** OAuth initiate and callback routes **require** `NEXT_PUBLIC_APP_URL` or `APP_URL`. Without either, they fail with an explicit configuration error (`oauth_base_url_not_configured`) and never fall back to the request origin. Other routes are unchanged. |
| Q10 | Reconnect selects a **different** External Account (another Xero organisation) → existing external-id mappings point at the old one | `completeConnect` returns the previous `providerData`; the provider compares at selection time and warns or refuses before `updateProviderData` | data integrity | Xero spec (detection and UX) | **Decided** for the core (return value + serialized `updateProviderData`); the Xero UX is open |

### 10.1 Migration & Backward Compatibility

Contract surfaces touched (`BACKWARD_COMPATIBILITY.md`). All changes are additive. **Migration path: none required**; there is no data migration and no deprecation, and existing integrations behave as before (except the `upsert` defaults fix below).

| Surface | Change | Class | Sign-off? |
|---|---|---|---|
| Import paths (§4) | new `@open-mercato/shared/lib/db/advisoryLock` (with an explicit `exports` entry), new `@open-mercato/core/modules/integrations/lib/oauth/*` | ADDITIVE | **yes**: shared "Ask First" (a shared public type becomes a cross-package contract) |
| DI names (§9) | new `integrationOAuthGrantService` | ADDITIVE | yes (becomes STABLE) |
| Service interface (§9) | `integrationCredentialsService.erase`, declared optional in the exported `CredentialsService` type (BACKWARD_COMPATIBILITY.md §9: "MAY add optional methods") | ADDITIVE | integrations "Ask First" (credential semantics) |
| Event IDs (§5) | none new in Phase 1. `integrations.state.updated` is now also emitted by runtime code, after commit, with the same fields; runtime emissions carry `userId: null` (no field is removed). No in-repo subscribers today | ADDITIVE (new emitter; a new value for an existing field) | yes (workflow triggers see new emissions) |
| Notification types (§11) | none new in Phase 1 | — | — |
| Types (§2) | `IntegrationCredentialFieldOauth` untouched. The exported `CredentialsService` becomes an explicit type (was `ReturnType<typeof createCredentialsService>`) that stays a superset of the factory return, with `erase?` optional; a type-level test guards it | ADDITIVE (no member removed or narrowed) | yes (DI interface, §9) |
| API routes (§7) | no new production route; `GET /api/integrations/:id` gains an optional response field `oauthGrant: { status: 'active' \| 'invalidated' \| 'unavailable' } \| null` | ADDITIVE (new optional response field) | — |
| DB schema, ACL features, CLI | none | — | — |
| Test-only routes | flag-gated routes for the test OAuth provider and fake authorization server; 404 unless the test flag is set | not a contract (like `test-seed`) | — |
| Production dependencies | none | — | avoided |
| Behaviour | `reauthRequired` written by runtime code for OAuth-grant integrations (only on change); the banner reads `oauthGrant.status`, so a flag stored earlier on any integration changes nothing in the UI. `upsert` now creates a missing state row with the definition defaults instead of `isEnabled: false`: a bug fix that also protects `sync_excel`/`webhooks`-style default-enabled integrations and changes the missing-row case for the existing callers listed in §1.4.2; stored rows are not remediated | behaviour addition on OAuth-grant integrations; defaults fix | yes (integrations "Ask First") |

#### Checklist
- [x] Options, impact, owner, status
- [ ] Q3 resolved before the Phase 1 merge

---

## 11. Rejected Alternatives `Architect`

| # | Alternative | Why rejected |
|---|---|---|
| R1 | Adopt `openid-client` (or `oauth4webapi`) in core | The failure modes are storage, locking and classification, and no library addresses them. Both libraries are ESM-only: core **and** every provider package that imports the toolkit in tests would need a Jest `transformIgnorePatterns` change, and core would gain a production dependency (Ask First). The one in-repo use (SSO) is tested only with the library fully mocked (`sso/lib/__tests__/oidc-provider.test.ts:1-4`). The main extra protection, RFC 9207 `iss` checking, doesn't apply to Xero: its discovery document doesn't advertise `authorization_response_iss_parameter_supported`. The mix-up precondition (an attacker-influenced AS among the client's ASes) doesn't hold when endpoints are code constants bound to a provider key in the encrypted state. Revisit trigger: §4.5.3. |
| R2 | Generic `/api/integrations/oauth/[provider]/*` routes, a generic `oauth` field renderer and an account-selection hook now | Xero is the only tenant-level consumer. The callback URL is pasted into each tenant's provider console, so it is an external contract that can't be changed later without every tenant re-registering. It should be fixed when a second shape exists (Phase 3 trigger). |
| R3 | Store tokens inside the admin-edited credentials row (with compare-and-set on a refresh generation) | The admin PUT is a full replace (`credentials-masking.ts:98`) that reads `existing` and saves **without the grant lock**. An admin saving a new secret can therefore write back a refresh token a worker rotated milliseconds earlier: a lost update, and for Xero a lost grant. Every refresh would also bump the admin row's `updated_at`, the admin form's optimistic-lock version, causing spurious 409s. The sibling row (§1.4.2) removes the whole class; Tillio already uses the pattern (`tillio/lib/operators-store.ts:5-8`). |
| R4 | A partial unique index for tenant-level `integration_credentials` rows now | It would touch every tenant-level credential row in every deployment (Stripe, Akeneo, S3…) and needs duplicate reconciliation first. The grant lock already enforces uniqueness for the only writer. DB-level uniqueness is stronger defence in depth, so it stays a reasonable follow-up, not a Phase 1 prerequisite. |
| R5 | A descriptor field for the refresh grace window, with "persist failure outside the window ⇒ reauth" | For providers that don't rotate (Google), the old token keeps working, so such a rule produces a **false** "needs reconnect". It would also set a DB flag at the moment a DB write just failed. Instead, persistence happens in the lock transaction: on failure the stored token is still the old one, the next caller retries with it, and the grant is invalidated only on an actual `invalid_grant` (§1.4.6). |
| R6 | Migrate Gmail/MS365 onto the core now (with per-user reauth on `IntegrationState`) | The concurrent-refresh race is benign for Google and Microsoft (§1.4.6). Behaviour is preserved unless a change is requested. PRs #6478, #6433 and #6266 are changing the same file. A per-user reauth column would be a migration on a shared entity needed only for the migration itself. Phase 3, triggered. |
| R7 | Blocking lock waiters, or an in-process `Map` as a first tier | Pool max 20, a 6 s acquire timeout, and worker concurrency budgeted to the pool max (`mikro.ts:118-121`, `worker-connection-budget.ts:58-66`). Waiters that hold connections, plus a holder that needs a second connection, can starve the pool. Waiters must hold no connection, and the holder does all I/O on the transaction EM (I2, I6). |
| R8 | `IntegrationState.reauthRequired` as the source of truth, or as the banner's input | The admin PUT can write it without the lock (`state/route.ts:111`), and it sits in a different aggregate from the tokens. Grant `status` is authoritative and drives the banner; the flag is a projection kept for API compatibility (§1.4.2). |
| R9 | Events (`oauth_grant.invalidated`, `.connected`, `.disconnected`) and a reauth notification in Phase 1 | The banner is enough of a signal for Phase 1. Event IDs and notification types are frozen once added and each needs sign-off, so they arrive with their first consumer (Phase 3). The audit trail is the integration log (§1.4.4). |
| R10 | The health probe as an implicit keep-alive | It would refresh every ~30 min for every enabled tenant, compete for the lock, and exceed the 10 s health timeout. The keep-alive is explicit and weekly (Q6). |
| R11 | Disconnect performing provider HTTP calls inside the lock | Two or three external calls exceed the waiters' 15 s deadline (I6). Erase under the lock; revoke after release, with `revocation_pending` recorded (WF4). |

---

## Production Readiness `PM`

| Workflow | Deployable after | Blocker | What the client would say |
|---|---|---|---|
| WF1 Connect | Phase 2 | Xero routes and picker | "Where's the Connect button?" (until Phase 2) |
| WF2 Token | Phase 1 | — | — |
| WF3 Reauth | Phase 1 (signal); Phase 2 (reachable) | — | "It told me exactly when and why to reconnect." |
| WF4 Disconnect | Phase 1 + the Xero hook | Q5 for channels | "Did it really cut access?" The copy states the revocation outcome. |
| WF5 Developer journey | Phase 1 (validated by Phase 2) | — | "I only wrote the provider-specific parts." |

---

## 12. Sources

Repository evidence: file references in §1.4.1. External sources:
- Xero OAuth FAQ (30-min access token, 60-day refresh expiry, rotation, 30-min retry grace): https://developer.xero.com/faq/oauth2
- Xero discovery document (endpoints, `client_secret_basic`/`post`, S256, revocation, grant types): https://identity.xero.com/.well-known/openid-configuration
- Xero identity OpenAPI (`/connections` GET/DELETE; Connection schema): https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-identity.yaml
- Xero Node SDK (openid-client, `/connections`, revoke): https://github.com/XeroAPI/xero-node/blob/master/src/XeroClient.ts
- Xero granular scopes (apps created on or after 2026-03-02; `offline_access`): https://developer.xero.com/faq/granular-scopes , https://www.apideck.com/blog/xero-scopes
- Vendor report on Xero concurrent-refresh `invalid_grant` (non-authoritative): https://nango.dev/blog/xero-oauth-refresh-token-invalid-grant/
- Microsoft refresh tokens: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- RFC 9700 §2.1.1 (PKCE: public clients MUST, confidential clients RECOMMENDED), Jan 2025: https://www.rfc-editor.org/rfc/rfc9700.html
- OAuth 2.1, draft-ietf-oauth-v2-1-16 (2026-09-03), §4.1.1 (`code_challenge` REQUIRED unless §7.5.1): https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/
- Upstream tracker: #5450, #5898, #6218, #6266, #6267, #6333, #6433, #6478

**PKCE policy:** **on (S256) by default** for every auth-code grant, including confidential clients:
- RFC 9700 recommends it, and OAuth 2.1 (draft) requires it.
- All three providers advertise S256.
- It costs one verifier in the already-encrypted state cookie.

Providers can opt out via the descriptor. Gmail (hub) keeps its current behaviour until Phase 3.

---

## Changelog

### 2026-09-27
- Initial App Spec.
