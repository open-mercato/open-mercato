# Entra ID token authentication for the Open Mercato API

- Scope: Enterprise — extends `packages/enterprise/src/modules/sso` + one additive seam in `packages/shared/src/lib/auth`.
- Status: Design complete — Open Questions resolved, security review + pre-implement corrections folded in. Ready for `om-implement-spec`.
- Date: 2026-06-23
- Related code: `packages/shared/src/lib/auth/server.ts` (auth chokepoint), `packages/shared/src/lib/auth/jwt.ts` (HS256-only), `apps/mercato/src/app/api/[...slug]/route.ts` (dispatcher), `packages/core/src/modules/auth/services/rbacService.ts` (feature resolution), `packages/core/src/modules/api_keys/**` (non-user principal model), `packages/enterprise/src/modules/sso/**` (OIDC login, account linking, role grants, deactivation), `packages/core/src/modules/directory/data/entities.ts` (tenants/organizations).
- Related docs: `BACKWARD_COMPATIBILITY.md`, `packages/core/AGENTS.md` → Access Control / Encryption / Migrations, `.ai/qa/AGENTS.md`, Microsoft Entra access-token & claims-validation docs.

## TLDR

Allow an inbound Open Mercato API request to authenticate with a **Microsoft Entra ID access token** (RS256, validated against Entra's JWKS) in addition to the existing OM HS256 JWT and OM API key. Validation and identity mapping happen inside the single existing request-auth chokepoint, `resolveAuthFromRequestDetailed`, via a new **additive, fail-open external-auth strategy hook** in `packages/shared`; the Entra verifier and identity mapping live in the enterprise `sso` module and reuse its account-linking, role-grant, deactivation, and config machinery. Two flows are supported — **app-only / client-credentials** (the Entra service principal links to an OM API-key record and authorizes via the existing api-key RBAC branch) and **delegated / user** (the Entra user links to a real OM user, hybrid JIT). The deployment is **multi-tenant Entra, v2.0 tokens**, with audience pinned to this API's client-id, issuer matched against the templated v2.0 issuer with the **verified** `tid` substituted, and `tid` checked against an explicit OM-org allowlist. Eleven mandatory security invariants (INV-1..INV-11) harden the cross-tenant, takeover, revocation, and cookie-clobber paths a literal implementation would otherwise leave open.

## Overview

Microsoft-ecosystem customers want their own services and applications to call the OM API using tokens their Entra tenant already issues, without OM minting and distributing separate API keys out of band, and without standing up a second identity system. Today OM can sign a user in through Entra interactively, but it cannot accept an Entra-issued token at the API boundary. This spec closes that gap on the existing auth chokepoint, reusing the enterprise SSO module's identity plumbing, and treats the result as security-critical surface: the design's correctness rests on pinning audience, binding issuer to a verified tenant, and never letting an Entra principal's effective tenant/org drift from the OM record that carries its permissions.

## Problem statement

An inbound API request can be authenticated today only by an OM-issued HS256 JWT (`Authorization: Bearer` or the `auth_token` cookie) or an OM API key (`x-api-key` / `Authorization: ApiKey`), both resolved in `resolveAuthFromRequestDetailed` (`packages/shared/src/lib/auth/server.ts:296-350`); `verifyJwt` is HMAC-SHA256 only (`jwt.ts:155,168-193`). Entra is wired into the enterprise `sso` module only for interactive browser login (OIDC authorization-code grant) and SCIM directory sync; the SCIM bearer is an OM-minted `omscim_` token, not an Entra token. There is no JWKS-based (jose) token verifier in shared auth or the `sso` module; the only asymmetric-JWT precedent is a hand-rolled, cert-based RS256 verifier in `communication_channels` (Gmail Pub/Sub push, `lib/gmail-pubsub-jwt.ts`, `node:crypto` + x509-cert-by-kid) — not reusable for Entra's rotating JWKS. A service using client-credentials, or a user-delegated application, therefore cannot present an Entra token to the OM API.

## User stories

- As an operator of a customer's backend service, I register the service's Entra app in OM (link its `(tid, appid)` to a least-privilege OM API key) so the service can call the OM API with its client-credentials token and act with exactly that key's permissions.
- As an administrator, I maintain an allowlist of Entra tenants (`tid`) mapped to OM organizations, so only approved directories can authenticate, and I can revoke a directory or a single service principal instantly.
- As a user of a partner application, I call the OM API with my delegated Entra token and am authorized as my linked OM user, with my own roles — never another user's, and never a service principal's.

## Resolved decisions (from the Open Questions gate)

Decisions were taken by the maintainer at the Open-Questions gate; each rationale below explains why the alternative was rejected.

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| Q1 | Token flow | Both app-only (client-credentials) and delegated (user) | Customers run both machine-to-machine services and user-facing apps in the Microsoft ecosystem; supporting only one flow would push the other back onto out-of-band OM API keys — exactly the friction this feature removes. |
| Q2 | Provisioning of unknown principals | Hybrid — JIT for delegated users (gated by `allowedDomains` + `email_verified === true`); strict pre-provisioned link for app-only callers | Delegated users carry a verifiable email domain, so JIT is safe and low-friction. App-only callers carry no email and cannot be domain-gated, so they must be explicitly linked by an admin before they can authenticate — auto-provisioning a machine principal would be an open door. |
| Q3 | RBAC mapping | Follow the existing architecture — authorize only via `rbacService.loadAcl(auth.sub)`; app-only → api-key principal (`sub = api_key:<id>`), delegated → real OM user (`sub = User.id`) | OM's authorizer never reads the JWT `roles[]` claim, so a new permission source would be both non-functional and a second security surface to defend. Reusing the two existing principal shapes keeps Entra callers inside the audited RBAC path with zero new core branches. |
| Q4 | Tenancy & token version | Multi-tenant Entra, v2.0 | The customer base spans multiple Entra directories, so single-tenant is insufficient. v2.0 gives one issuer/audience shape and avoids the v1/v2 dual-path surface. Multi-tenant forces the explicit `tid`-allowlist + templated-issuer binding that is the core tenant-isolation control (INV-2). |
| Q5 | Route scope | All routes via the chokepoint | The seam is identity-source-agnostic and sits at the one resolver both API consumers reach; per-route `requireFeatures` already bounds authorization, so a dedicated Entra-only surface would add maintenance without adding safety. |

## Architecture

### The single insertion point

Both API consumers reach one resolver: the dispatcher calls `resolveAuthFromRequestDetailed(req)` directly (`apps/mercato/src/app/api/[...slug]/route.ts:360`), and `makeCrudRoute` reaches it via `getAuthFromRequest` → `resolveAuthFromRequestDetailed` (`packages/shared/src/lib/crud/factory.ts:1279-1308`, `server.ts:348-350`). The resolver returns `{ auth, status: 'authenticated' | 'missing' | 'invalid' }`; everything downstream only reads `AuthContext` fields and is identity-source-agnostic. Adding the Entra branch here covers both paths (Q5).

### Seam: an additive external-auth strategy hook (Seam A)

The interceptor seam is rejected: interceptors run strictly after the 401 gate and `InterceptorBeforeResult` exposes no field to inject a subject (`factory.ts:1356-1383`, `route.ts:142-161`, `packages/core/AGENTS.md` → API Interceptors). A DI override alone is inert: the resolver binds `verifyJwt` as a plain ES import and never reads the container (`server.ts:3,317`; import sites at `route.ts:5`, `factory.ts:5`, `packages/shared/src/lib/api/context.ts:3`).

The change is a small additive code change in `packages/shared/src/lib/auth`, modeled on the existing `TRUSTED_AUTH_CONTEXT_SYMBOL` envelope (`server.ts:32-59`) and the `crudMutationGuardService` no-op-default → enterprise-override pattern (`packages/shared/src/lib/di/container.ts:160-219`, `packages/enterprise/src/modules/record_locks/di.ts:26-28`):

- A new dependency-free **`ExternalAuthStrategy`** interface and a module-scoped registry (`registerExternalAuthStrategy`/`getExternalAuthStrategies`) live in `packages/shared/src/lib/auth`. A module-scoped global registry is required because the resolver does not receive the container.
- `resolveAuthFromRequestDetailed` consults the registered strategy on an `Authorization: Bearer` token routed by a cheap discriminator (decode the JWT header **without** verifying; route to the strategy when `alg` is `RS256` and a `kid` is present and the unverified `iss` host is in an exact Microsoft-host allowlist). A strategy returns `{ auth }`, `{ status: 'invalid' }`, or `null` (not applicable → fall through).
- **Fail-open default:** with no strategy registered, the resolver behaves exactly as today (INV-11 preserves cookie behavior). No existing export in `server.ts` changes signature or return shape; the registry consult is internal; `registerExternalAuthStrategy`/`ExternalAuthStrategy` are additive STABLE-import-path additions.

The strategy implementation lives in enterprise (it needs core/auth and directory lookups). **Registration requires a net-new process-level hook:** the `sso` module has no `bootstrap.ts`, and its `SsoProviderRegistry` is constructed **per-request** inside `di.ts#register` (`new SsoProviderRegistry()` on every `createRequestContainer()`, `di.ts:12-24`) — the wrong lifetime for the shared strategy registry, which must be a persistent module-scoped global because `resolveAuthFromRequestDetailed(req)` receives only a `Request`, no container (`server.ts:296`). Register the strategy **once at enterprise-module load**, guarded for idempotency (e.g. a `let registered = false` latch or registry-keyed dedupe), so it is live before the first API auth and is **not** re-run from the per-request `register()`. `packages/shared` must not import from `core`/`enterprise`.

### Entra token verification (net-new, enterprise)

`jose` is added as an explicit, version-pinned dependency of `@open-mercato/enterprise`. The verifier:

1. Discovers the v2.0 OIDC metadata (`.well-known/openid-configuration`) for the configured authority and derives `jwks_uri`; the keys URL is never hardcoded. Locked to v2.0 (Q4).
2. Verifies with `createRemoteJWKSet` (self-caching, kid-selecting, auto-rotating; refetch-on-unknown-kid; **fail closed** on fetch failure) + `jwtVerify(token, jwks, { audience, algorithms: ['RS256'], clockTolerance: '60s' })`.
3. Pins `aud` to the API's client-id (INV-3). This is the confused-deputy boundary; it rejects Graph and other-resource tokens on audience alone.
4. Applies the multi-tenant binding `jose` cannot (INV-1, INV-2): all of `tid`/`iss`/`oid`/`appid`/`scp`/`roles`/`idtyp` come from the **verified** payload; `iss` must equal the templated v2.0 issuer with the verified `tid` substituted; `tid` must be a GUID and present in the active allowlist; `tid` values `common`/`organizations`/the MSA tenant `9188040d-6c67-4c5b-b112-36a304b66dad` are rejected.
5. Classifies the flow strictly (INV-6): app-only iff `idtyp === 'app'` AND `scp` absent; delegated iff `idtyp === 'user'` OR `scp` present; `idtyp` absent or contradictory → reject.

The verifier emits `EntraVerifiedToken { tid, oid, appid?, scp?, roles?, email?, preferredUsername?, idtyp }`. Claim→identity extraction reuses the SSO `mapClaimsToIdentity` logic, factored out of `OidcProvider.handleCallback` (`packages/enterprise/src/modules/sso/lib/oidc-provider.ts:68-75`).

### Identity mapping → AuthContext

Authorization resolves only via `rbacService.userHasAllFeatures(auth.sub, …)` → `loadAcl(sub)` (`rbacService.ts:457-468,253-368`), which branches on the string shape of `sub`: a `api_key:`-prefixed sub loads an `ApiKey` and reads its `rolesJson` (`rbacService.ts:270-305`); otherwise `sub` is a `User.id` UUID resolving `UserRole`→`RoleAcl` (`rbacService.ts:308-367`). The JWT `roles[]` claim is never read for authorization.

**App-only (strict, Q2).** A pre-provisioned `EntraServicePrincipalLink` maps the verified `(tid, appid|oid)` to an existing OM API-key record. The resolved `AuthContext.sub` is `api_key:<id>`, so authorization rides the existing api-key RBAC branch with zero change to core RBAC. **The resolver does not call `resolveApiKeyAuth`, so it must re-assert that path's integrity itself (INV-4):** `AuthContext.tenantId`/`orgId` are taken from the **api-key record** (the principal of record), and the resolver asserts `apiKey.tenantId === EntraTenantMapping(tid).tenantId` and `apiKey.organizationId === EntraTenantMapping(tid).organizationId`; any mismatch fails closed (prevents the `tid`→orgA / key→orgB cross-tenant escalation). The api-key must be live (not soft-deleted, not expired) and both the link and the tenant mapping `is_active`; otherwise the resolver returns `status:'invalid'` (unauthenticated), never an empty-feature `auth`. Linking to a superadmin api-key is refused unless an explicit, audited opt-in flag is set on the link (INV-5).

**Delegated (hybrid JIT, Q2).** The Entra user resolves to a real OM user through a **new read-only resolution path** (`EntraDelegatedResolutionService`); the request hot path does **not** reuse `AccountLinkingService.resolveUser`, which writes on nearly every branch (updates `identity.lastLoginAt` + flush at `accountLinkingService.ts:80-81`, soft-deletes orphans `:75-77`, `syncMappedRoles` writes `UserRole`/`SsoRoleGrant` `:208-283`, `linkByEmail`/`jitProvision` create rows and emit events `:109-181`). Per INV-7: email-based auto-linking is never performed — note `autoLinkByEmail` is a **persisted `SsoConfig` column** (`sso/data/entities.ts:36-37`, DB default `true`), not a per-call flag, so the read-only path ignores it by construction rather than "forcing it off"; linking is by `(ssoConfigId, idpSubject=oid, tid)` only; JIT-create is gated by `allowedDomains` AND `email_verified === true` (strict, not "not false"); the path never binds to an OM user that has a `passwordHash`; first-time link/JIT may write once, but a repeat request for an already-linked user performs **reads only**. `SsoIdentity` gains a `tid` column that must match on every resolve (INV-10 prevents `oid` aliasing across tenants sharing one config). `SsoUserDeactivation` is checked on the hot path (INV-9). The resolved `AuthContext.sub` is `User.id`; `tenantId`/`orgId` are real UUIDs derived from the tenant mapping / the user's tenant, never `?? ''` (INV-8). Roles come from the persisted `UserRole`→`RoleAcl` graph via the pure `authService.getUserRoles` (`authService.ts:74-94`).

**No login side effects on the hot path.** `syncMappedRoles` (writes `UserRole`/`SsoRoleGrant`, `accountLinkingService.ts:208-295`), `invalidateUserCache`, `updateLastLoginAt`, `createSession`, and `emitSsoEvent` are login-only. Per-request the delegated path (the new `EntraDelegatedResolutionService`, **not** `resolveUser`) performs at most a one-time link/JIT on first contact and a pure read on every repeat request; role reconciliation from Entra app-roles runs at first link or via a separate periodic sync.

**Hard `AuthContext` invariants** (or routes silently 401): `tenantId` must be a real UUID — `ensureAuth` rejects a non-UUID `tenantId` in `makeCrudRoute` even when the dispatcher accepted it (`factory.ts:1279-1284`); the field is `orgId`, not `organizationId` (`server.ts:11-23,226-236`); `auth.sub` must resolve in `RbacService`.

### Tenant and config resolution (multi-tenant)

No pre-auth tenant signal exists; tenant is always carried by the credential (`packages/shared/src/lib/api/context.ts:24-36`). The Entra path resolves the OM org/tenant from the verified `tid`/`aud`: pin `aud` → find the accepting `SsoConfig` → check `tid` against the allowlist → org/tenant → map the principal (app-only → `EntraServicePrincipalLink`; delegated → `SsoIdentity`/`AccountLinkingService`). Any miss fails closed. Validation uses only public material (issuer-derived JWKS + `aud`/`iss`); the encrypted `client_secret` is never read on the request path.

### Security hardening — mandatory invariants

These are non-negotiable; each maps to a test in Phase 4.

- **INV-1 Verified-payload only.** Every claim used for any decision (`tid`, `iss`, `oid`, `appid`, `azp`, `scp`, `roles`, `idtyp`, `email`) is read from the jose-verified payload. The unverified header is used only to route the discriminator.
- **INV-2 Issuer/tenant binding.** Require `iss === https://login.microsoftonline.com/{tid}/v2.0` (verified `tid`), `tid` matching the GUID pattern, `tid` ∈ active allowlist; reject `common`/`organizations`/MSA tid. A validly-signed token from a non-allowlisted tenant (same common JWKS) MUST be rejected. The chosen authority (common vs per-tenant) and JWKS endpoint are documented; for single-tenant configs `entra_tenant_id` is pinned and a `tid` mismatch is rejected before allowlist lookup.
- **INV-3 Audience pin.** `aud` must equal `expected_audience` exactly; reject arrays containing other audiences and any other-resource/Graph token.
- **INV-4 App-only tenant/org consistency + liveness.** Derive scope from the api-key; assert `apiKey.tenant/org === EntraTenantMapping(tid).tenant/org`; require api-key live + link/mapping `is_active`; dead ⇒ unauthenticated (`status:'invalid'`), not feature-less `auth`.
- **INV-5 No superadmin link by default.** Refuse to link an Entra SP to a superadmin api-key unless an explicit audited opt-in flag is set; warn at link creation.
- **INV-6 Strict flow classification.** `idtyp` mandatory; app-only iff `idtyp==='app'` AND no `scp`; delegated iff `idtyp==='user'` OR `scp` present; reject absent/ambiguous. Authorize on `appid`/`azp` only when `idtyp==='app'`, matching `EntraServicePrincipalLink.entra_app_id`.
- **INV-7 Delegated linking discipline.** `autoLinkByEmail` off on the token path; link only by `(ssoConfigId, oid, tid)`; JIT gated by `allowedDomains` AND `email_verified===true`; never bind to a `passwordHash`-bearing user.
- **INV-8 Real-UUID tenant.** Delegated `tenantId` is a real UUID from the mapping/user; reject null/empty.
- **INV-9 Revocation / kill-switch.** Per-config `entra_api_auth_enabled` flag + a global env kill-switch; `SsoUserDeactivation` checked on the hot path (**net-new wiring** — today only the SCIM path reads `SsoUserDeactivation` via `scimService`/`scim-mapper.ts`; there is no login-hot-path check to reuse, so add one using the `(userId, ssoConfigId)` lookup + the active-derivation that matches `scim-mapper.ts:30` exactly: **active iff there is no deactivation row, OR the row's `reactivatedAt != null`** — a deactivation row with `reactivatedAt == null` means *currently deactivated* and MUST be rejected); any disabled link/mapping/config/user ⇒ unauthenticated. (Access tokens cannot be revoked at the issuer, so these OM-side switches are the only revocation.)
- **INV-10 Cache invalidation + short TTL.** Admin mutations on `EntraServicePrincipalLink`/`EntraTenantMapping` and any role change call `rbacService.invalidateUserCache(sub)` (`api_key:<id>` or `userId`); Entra-derived principals use a short ACL TTL (≤60s) given the absence of token revocation. **Net-new seam:** `RbacService` today has only a single **process-wide** `cacheTtlMs` (`rbacService.ts:30`, mutated globally by `setCacheTtl`, applied unconditionally in `setCache` at `:121`); there is no per-principal TTL. The short TTL therefore requires an additive per-`sub` override (optional `ttlMs` threaded `loadAcl → setCache`, defaulting to the global value so all current callers are unchanged), selected by the Entra resolution path. Globally lowering `cacheTtlMs` is **not** acceptable — it would shorten caching for every interactive/api-key principal. Built in Phase 3.0.
- **INV-11 No staff-cookie clobber.** An Entra-shaped invalid Bearer MUST NOT clear staff `auth_token`/`session_token`. The strategy's `invalid` must not set `hadInvalidInteractiveToken`, and the resolver must evaluate a present staff cookie before surfacing `invalid`. Implement by scoping `clearStaffAuthCookies` (`route.ts:371-373`) to failures whose origin was the **cookie**, not an `Authorization` Bearer — this also fixes a pre-existing footgun (any junk Bearer alongside a valid cookie clears it today); call this out to the team.

## Access control (new ACL features)

New feature IDs in `sso/acl.ts` (additive, FROZEN once shipped — finalize the spelling now), gating the admin CRUD: `sso.entra_tenant_mapping.view`, `sso.entra_tenant_mapping.manage`, `sso.entra_service_principal_link.view`, `sso.entra_service_principal_link.manage` (each `manage` `dependsOn` its `view`). They match the existing `sso.<resource>.<action>` style (existing: `sso.config.view/manage`, `sso.scim.manage`) and do not collide. Route metadata uses `requireFeatures` with these IDs, and the new `manage` features are mirrored into `sso/setup.ts` `defaultRoleFeatures` for the admin role (superadmin is already covered by the existing `sso.*` wildcard grant).

## Data model

New tables (**plural snake_case**, per the house convention — existing sso tables are `sso_configs`, `sso_identities`, `sso_user_deactivations`; entity **class** names stay singular PascalCase, e.g. `EntraTenantMapping`), in the `sso` module's `data/entities.ts`, with uuid PKs (`defaultRaw: 'gen_random_uuid()'`) and `organization_id`/`tenant_id` carried as plain uuid columns referencing `organizations.id` / `tenants.id` (no `@ManyToOne`, no cross-module `defineLink`; ids resolved by the owning module's service, no snapshot denormalization), `updated_at` (so the `makeCrudRoute` optimistic-lock default applies), soft-delete + partial unique index `WHERE deleted_at IS NULL`:

- `entra_tenant_mappings` (class `EntraTenantMapping`) — `id`, `entra_tenant_id` (tid), `organization_id`, `tenant_id?`, `sso_config_id?`, `is_active`, `created_at`, `updated_at`, `deleted_at`. Partial unique on `(entra_tenant_id)`.
- `entra_service_principal_links` (class `EntraServicePrincipalLink`) — `id`, `entra_tenant_id` (tid), `entra_app_id` (appid) and/or `entra_oid`, `api_key_id`, `allow_superadmin` (default `false`, INV-5), `is_active`, `created_at`, `updated_at`, `deleted_at`. Partial unique on `(entra_tenant_id, entra_app_id)`.

Additive nullable columns on `sso_configs` (reusing existing `issuer`/`client_id`): `expected_audience`, `entra_tenant_id`, `token_version`, `multi_tenant` (boolean), `entra_api_auth_enabled` (boolean, INV-9). Additive nullable `tid` column on `sso_identities` (INV-10). Boolean column defaults are declared as plain values (`default: false`, never a pre-quoted SQL fragment, per the MikroORM defaults lesson). Reads of the new entities default to `findWithDecryption`/`findOneWithDecryption` even though no column is encrypted (module-read convention); if the resolution service creates rows that reference each other before flush, assign `id: randomUUID()` explicitly (MikroORM 6 does not generate UUIDs client-side).

**Events.** No new module events are emitted for these admin entities (no `clientBroadcast`/subscriber need); CRUD goes through `makeCrudRoute` command/undo plumbing. If events are later wanted, declare singular IDs (`sso.entra_tenant_mapping.created`, etc.) per the FROZEN event-id contract.

**Encryption: none required.** The new columns hold only non-secret directory identifiers (`tid`/`appid`/`oid` GUIDs, audience = a public client-id). `email`/`upn` are transient verifier inputs persisted only via the existing `SsoIdentity` path (governed by the sso module's existing rules; the pre-existing plaintext `idp_email` storage is unchanged and out of scope here). No `<module>/encryption.ts` change; the encrypted `client_secret_enc` is never read on the request path.

**Admin CRUD (canonical mechanisms).** These two new entities are simple allowlist records, so they use the canonical CRUD factory rather than the sso module's existing hand-rolled, service-backed routes + bespoke React pages (the `SsoConfig` wizard is hand-rolled because it is multi-step; that does not apply here). This is a deliberate, documented divergence from the module's current style, chosen so the new entities inherit optimistic-locking and query-index coverage for free. Each entity gets a route via `makeCrudRoute({ entity, entityId: E('sso','entra_tenant_mapping'|'entra_service_principal_link'), operations, schema, indexer: { entityType } })` (the entity-id slug stays singular even though the table is plural), zod create/update schemas added to `sso/data/validators.ts`, per-method `metadata` (`requireAuth`/`requireFeatures`) and `openApi` exported on each route file, list UI via `<DataTable entityId apiPath columns />`, form UI via `<CrudForm>` with `createCrud`/`updateCrud`/`deleteCrud`, HTTP via `apiCall`/`apiCallOrThrow`. UI strings route through `useT()`/`resolveTranslations()` under `sso.entra.*` locale keys (no hardcoded labels); the UI follows the design system (`is_active` rendered via `<StatusBadge>`, `LoadingMessage`/`ErrorMessage` states, dialogs with `Cmd/Ctrl+Enter` submit + `Escape` cancel, lucide icons). Soft-delete makes link/mapping revocation reversible; per INV-9/INV-10 a soft-delete or `is_active=false` fails closed for new requests immediately (cache invalidated on write).

## Threat model

| Risk | Mitigation |
|------|------------|
| Tenant confusion via shared common JWKS | INV-1, INV-2: verified-payload `tid`/`iss`, templated-issuer match, GUID + allowlist; non-allowlisted-tenant token rejected. |
| Audience confusion / confused-deputy (Graph) | INV-3: pin `aud` to the API client-id. |
| App-only tenant/org drift → cross-tenant escalation | INV-4: scope from api-key, assert equality with the `tid` mapping, fail closed. |
| Over-privileged / superadmin api-key link | INV-5: refuse superadmin link without audited opt-in. |
| Flow misclassification (delegated↔app-only) | INV-6: mandatory `idtyp`, strict conjunctive predicate. |
| Delegated account takeover via `autoLinkByEmail`/`upn` | INV-7: autolink off, link by `oid+tid`, `email_verified===true`, never bind a password user. |
| Non-UUID tenant → silent CRUD 401 / null-tenant ACL | INV-8: real-UUID tenant, reject null. |
| No token revocation; stale/disabled principal | INV-9: per-config + env kill-switch, deactivation check, dead ⇒ unauthenticated. |
| Stale RBAC cache after role/link change | INV-10: invalidate on mutation, short TTL. |
| DoS clearing a victim's staff cookies via crafted Bearer | INV-11: scope cookie-clear to cookie-origin failures. |
| alg confusion (none / HS256-as-RS256) | `jwtVerify({ algorithms:['RS256'] })`; explicit test vectors in Phase 1.2. |
| Ordering collision on `Authorization: Bearer` | Entra branch runs before `verifyJwt`; invalid returns without the interactive flag (INV-11). |

## Backward compatibility

Additive / low BC-risk. `@open-mercato/shared/lib/auth/server` is a STABLE import path; `resolveAuthFromRequestDetailed`/`getAuthFromRequest` are not in the frozen Function Signatures table; DI Service Names are STABLE with new registrations allowed (`BACKWARD_COMPATIBILITY.md:86-126,176-184`). The change adds a new exported registrar + interface and an internal branch; **no existing export changes signature or return shape**, and the no-strategy-registered path is byte-for-byte today's behavior. New entities/columns and ACL feature IDs are additive (new boolean columns ship with plain `false` defaults; new tables/columns are non-breaking). No deprecation protocol is triggered. The INV-11 cookie-clear scoping is a **behavioral change** to a pre-existing footgun (junk `Authorization: Bearer` + valid `auth_token` cookie clears the cookie today, verified at `route.ts:371-374,414-415` + `server.ts:307-331`): document it in `RELEASE_NOTES.md` and cover it with a dedicated regression test (valid staff cookie + bogus Entra Bearer ⇒ cookie preserved). Migrations are authored + snapshot-updated only — **do not run `yarn db:migrate`** (coding-agent migration exception); use `yarn db:generate` as a diff probe and keep only intended SQL.

## Phasing

### Phase 0 — Shared external-auth strategy seam (`packages/shared`, additive)

- 0.1 Define `ExternalAuthStrategy` (`tryResolve(req) → { auth } | { status:'invalid' } | null`) + registry. Verify: registry unit test; types compile.
- 0.2 Consult the registry inside `resolveAuthFromRequestDetailed` before `verifyJwt`, gated on the header discriminator; map results into `{ auth, status }`; implement INV-11 (scope `clearStaffAuthCookies` to cookie-origin failures; Entra `invalid` does not set `hadInvalidInteractiveToken`; evaluate a present staff cookie before surfacing `invalid`). Verify: existing auth tests pass with no strategy registered; new tests cover three outcomes, the discriminator, and the cookie-clobber regression (valid cookie + bogus Entra Bearer ⇒ cookies preserved).

### Phase 1 — Entra token verifier (`sso`, net-new)

- 1.1 Add pinned `jose` dep to `@open-mercato/enterprise`. Verify: `yarn build:packages`.
- 1.2 `EntraTokenVerifier`: v2.0 discovery, `createRemoteJWKSet`, `jwtVerify({ audience, algorithms:['RS256'], clockTolerance:'60s' })`, INV-1/INV-2/INV-3 post-verify checks, fail-closed JWKS, **test-configurable** JWKS source + issuer. Verify: unit matrix — valid / expired / wrong-aud / wrong-iss / non-allowlisted-but-validly-signed-tenant / `alg:none` / HS256-signed-with-RSA-public-key / RS384 / attacker-hosted-`kid` / unknown-kid — modeled on the existing RS256 unit-test scaffold `communication_channels/lib/__tests__/gmail-pubsub-jwt.test.ts` (`generateKeyPairSync` + fetch-mocked signing keys + valid/tampered/expired/wrong-aud/wrong-iss matrix). That verifier is cert-based; here use `jose` `createRemoteJWKSet` for JWKS rotation rather than extending the hand-rolled one.
- 1.3 Factor `mapClaimsToIdentity` out of `OidcProvider.handleCallback`; add strict flow classification (INV-6). Verify: unit tests both flows + `idtyp`-absent rejection + delegated-with-app-roles classified delegated.

### Phase 2 — Config and data model (multi-tenant)

- 2.1 Additive `sso_configs` columns (`expected_audience`, `entra_tenant_id`, `token_version`, `multi_tenant`, `entra_api_auth_enabled`) + `sso_identities.tid` + migration + `.snapshot-open-mercato.json` update (pattern: `Migration20260222000000_sso_add_name.ts`). Verify: `yarn db:generate` diff probe; typecheck.
- 2.2 `entra_tenant_mapping` entity + CREATE-TABLE migration + snapshot; admin CRUD (`makeCrudRoute` + `CrudForm`/`DataTable` + validators + `apiCall` + `metadata`/`openApi`), feature-gated. INV-10 cache invalidation on mutation. Verify: CRUD integration + ACL 403 without feature.
- 2.3 `entra_service_principal_link` entity (incl. `allow_superadmin`) + migration + snapshot; admin CRUD linking `(tid, appid|oid)` → api-key; INV-5 superadmin guard at create. Verify: CRUD integration; uniqueness; superadmin-link refusal.
- 2.4 `EntraIdentityResolutionService`: verified token → `SsoConfig` (by `aud`) → org/tenant (by `tid` allowlist) → principal, with INV-4/INV-8/INV-9 assertions. Verify: unit tests for each branch + negative paths (drift, disabled, dead key).

### Phase 3 — Identity mapping and strategy registration

- 3.0 **(core)** Per-principal ACL TTL override in `RbacService` (INV-10): optional `ttlMs` threaded `loadAcl → setCache` (`rbacService.ts:121`), defaulting to the existing global `cacheTtlMs` so every current caller is byte-for-byte unchanged; the Entra resolution path passes ≤60s. Verify: unit test — override shortens only the targeted `sub`'s entry; default path unchanged.
- 3.1 Delegated path: **new `EntraDelegatedResolutionService`** (read-only; does **not** call `AccountLinkingService.resolveUser`) implementing INV-7 (link by `(ssoConfigId, oid, tid)`; never bind-by-email; JIT gated by `allowedDomains` + `email_verified===true`; never bind a `passwordHash` user) + the corrected `SsoUserDeactivation` check (active iff no row or `reactivatedAt != null`); pure role read on repeats; UUID tenant; no hot-path side effects. Factor the claim→identity extraction out of `OidcProvider.handleCallback` (`oidc-provider.ts:61-86`, currently **inline**, not a named function) into a pure helper shared by both flows. Verify: unit test no `UserRole`/`Session`/event writes on a repeat request; deactivated user rejected; takeover vector (allowlisted-tenant token with `upn==existingAdmin@domain`, no `email_verified`) rejected.
- 3.2 App-only path: `EntraServicePrincipalLink` → `api_key_id` → `sub = api_key:<id>` with INV-4 consistency + liveness. Verify: unit test linked-key features resolve; drift (`tid`→orgA, key→orgB) ⇒ denied; soft-deleted key ⇒ unauthenticated.
- 3.3 `EntraAuthStrategy` wires verifier + resolution + mapping; register into the shared registry via a **net-new idempotent module-load-time hook** (not the per-request `di.ts#register`; guarded against double-registration), live before first API auth. Verify: end-to-end with strategy registered; registering N times yields exactly one strategy; unchanged behavior without the enterprise module loaded.

### Phase 4 — Integration tests and docs

- 4.1 Module-local `__integration__/TC-ENTRA-*.spec.ts` (`yarn test:integration`, ephemeral, local JWKS + test issuer), modeled on `TC-AUTH-017`: app-only authorized by linked key; delegated authorized by linked/JIT user; negatives — wrong-aud, unlisted-tid, non-allowlisted-but-signed tenant, expired, drift (cross-tenant), revoked link within TTL (proves INV-10), Entra principal hitting a `requireFeatures` route without grants → 403, cookie-clobber regression. Self-contained fixtures + teardown. Verify: suite green.
- 4.2 Docs: enterprise SSO doc page section (config, app-only vs delegated, multi-tenant allowlist, revocation, security notes). Verify: docs build.

## Integration coverage (required)

| Surface | Coverage |
|---------|----------|
| Strategy seam | Unit: three outcomes + discriminator + fail-open; OM HS256 token unaffected; INV-11 cookie regression. |
| Entra verifier | Unit RS256/JWKS matrix incl. non-allowlisted-signed-tenant, alg-confusion vectors, attacker-`kid`. |
| App-only API auth | Integration: linked-key principal authorizes a `requireFeatures` route; unlisted `tid`/`aud` → 401; drift → 401; dead key → 401. |
| Delegated API auth | Integration: linked/JIT user authorizes; domain-not-allowed/`email_verified!=true` → denied; takeover vector denied; deactivated user denied; no per-request side effects. |
| Revocation | Integration: soft-delete link / `is_active=false` → next request denied within TTL (INV-10). |
| CRUD vs dispatcher consistency | Integration: a `makeCrudRoute` route accepts the same Entra token the dispatcher accepts (UUID `tenantId`). |
| Tenant isolation | Integration: an Entra token for org A cannot read org B data. |
| Admin CRUD — tenant mapping | Integration: create/list/soft-delete, ACL-gated (403 without feature). |
| Admin CRUD — SP link | Integration: create/list/soft-delete, ACL-gated; superadmin-link refusal. |

## Out of scope

- Changing the interactive browser SSO login flow.
- Group-claim overage resolution via Microsoft Graph (prefer app-roles).
- Acting as an IdP / issuing Entra tokens.
- v1.0 tokens and non-Entra OIDC bearer tokens (the seam is generic; only the Entra strategy ships here).
- Encrypting the pre-existing plaintext `idp_email` (separate concern).

## Design decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Seam | Additive strategy hook in `resolveAuthFromRequestDetailed` | Interceptors run after the 401 gate and cannot inject a subject; DI-only is inert (plain import). |
| App-only principal | Link to an existing `api_keys` record (`sub=api_key:<id>`) | Reuses the api-key RBAC branch with zero core change; a dedicated `EntraServicePrincipal` + new `loadAcl` branch was rejected as more invasive. |
| Module placement | `sso` module + dependency-free seam in `shared` | Reuses `AccountLinkingService`/`SsoRoleGrant`/`SsoConfig`/deactivation; `shared` must not import core/enterprise. |
| Verification lib | `jose` (pinned) | `createRemoteJWKSet` + `jwtVerify` give caching/rotation + RS256 + iss/aud/exp/nbf; closes alg-confusion via `algorithms:['RS256']`. |

## Open questions (remaining)

- App-only principal model: link to an `api_keys` record (default) vs a first-class `EntraServicePrincipal` entity. Default chosen; revisit only if SPs must exist independently of API keys.
- Delegated role reconciliation from Entra app-roles: first-link only vs periodic background sync (both avoid the per-request hot path).

## Final compliance report

**Compliance matrix**

| Rule | Status | Where |
|------|--------|-------|
| Naming conventions | Pass | Entity classes singular (`EntraTenantMapping`, `EntraServicePrincipalLink`); tables plural (`entra_tenant_mappings`, `entra_service_principal_links`); features `sso.entra_*.<action>`; event entity-slug would be singular if ever added. |
| FK-id only, no cross-module ORM relation | Pass | `organization_id`/`tenant_id`/`api_key_id` plain uuids, resolved by owning service. |
| `organization_id` scoping + tenant isolation | Pass | New entities carry org/tenant; INV-2/INV-4 + isolation integration test. |
| Canonical CRUD (`makeCrudRoute`/`CrudForm`/`DataTable`/`apiCall`/`openApi`/zod) | Pass | Data model § Admin CRUD; validators in `sso/data/validators.ts`. |
| Encryption maps for PII/secrets | Pass (N/A) | Only non-secret identifiers; `client_secret` never read; justified in Data model. |
| Optimistic locking | Pass | Admin entities via `makeCrudRoute` (default-ON `updated_at`/`updatedAt`). |
| RBAC declarative guards (`requireFeatures`, no `requireRoles`) | Pass | New ACL features; authorization via `loadAcl(sub)`. |
| Migrations (`db:generate` + snapshot, no `db:migrate`) | Pass | Phase 2 + BC note. |
| Integration coverage for all API/UI paths | Pass | Integration coverage table (auth + verifier + admin CRUD + negatives). |
| BC additive / no signature change | Pass | BC section. |

**Internal consistency check**

| Check | Result |
|-------|--------|
| Every INV has a Phase-4 test | Pass (Integration coverage + Phase 3/4 verify steps). |
| `AuthContext` field names (`orgId`, UUID `tenantId`) consistent | Pass (INV-8 + hard invariants). |
| Q1–Q5 answers reflected in design | Pass (Resolved decisions → Architecture). |
| Security-review Criticals/Highs addressed | Pass (#2→INV-1/2, #3→INV-4, #4→INV-7, #5→INV-9, #8→INV-6). |

**Verdict:** Pre-implement analysis complete (`.ai/specs/analysis/ANALYSIS-2026-06-23-entra-token-api-authentication.md`) and its corrections applied to this spec. No Critical/High architectural, BC, or security gaps outstanding; remaining items are the two scoped open questions. Ready for `om-implement-spec`.

## Changelog

- 2026-06-23 — Initial spec. Open Questions resolved (both flows, hybrid provisioning, existing-architecture RBAC mapping, multi-tenant v2.0, all-routes scope). Architecture grounded in a 7-dimension research pass; hardened with INV-1..INV-11 after adversarial security review (cross-tenant drift, verified-payload binding, `autoLinkByEmail` takeover, `idtyp` classification, revocation/kill-switch, staff-cookie clobber).
- 2026-06-23 — Pre-implement corrections applied (per `ANALYSIS-2026-06-23-entra-token-api-authentication.md`): table names → plural (classes stay singular); corrected the "zero RS256/JWKS" claim to reference the hand-rolled cert-based Gmail Pub/Sub precedent + test scaffold; documented the `makeCrudRoute` choice as a deliberate divergence from the module's hand-rolled style; framed INV-9 deactivation as net-new wiring; added `defaultRoleFeatures` mirror, `sso.entra.*` i18n, DS notes, `findWithDecryption`, plain boolean defaults, MikroORM UUID assignment, plus INV-11 RELEASE_NOTES + regression-test requirement; expanded Phase-1.2 alg-confusion test vectors.
- 2026-06-25 — Codebase-audit corrections (suggested changes, PR review): (1) **INV-10** — flagged that `RbacService` has only a process-wide `cacheTtlMs` with no per-principal seam; the ≤60s Entra TTL is now scoped as a net-new additive `ttlMs` override (new Phase 3.0). (2) **INV-9** — corrected the inverted active-derivation to match `scim-mapper.ts:30` (active iff no deactivation row OR `reactivatedAt != null`); the prior `reactivatedAt == null ⇒ active` would have admitted deactivated users. (3) **Delegated path** — replaced reuse of write-heavy `AccountLinkingService.resolveUser` with a new read-only `EntraDelegatedResolutionService`; noted `autoLinkByEmail` is a persisted `SsoConfig` column, not a per-call flag; folded the inline (not yet a function) `mapClaimsToIdentity` extraction into Phase 3.1. (4) **Strategy registration** — replaced "register at sso bootstrap" (no `bootstrap.ts`; registry is per-request in `di.ts#register`) with a net-new idempotent module-load-time hook.
