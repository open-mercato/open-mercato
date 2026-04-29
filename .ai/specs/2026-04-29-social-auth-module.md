# Social Auth Module (better-auth-backed)

## TLDR

Add a new optional core module **`social_auth`** that provides multi-provider social sign-in (Google, Apple, Facebook, GitHub) for both authentication surfaces in open-mercato:

- **Staff (`auth`)** — admin/back-office users.
- **Customer portal (`customer_accounts`)** — portal users.

The module wraps [better-auth](https://better-auth.com) behind a typed `SocialAuthPort` so the underlying library can be swapped without touching API routes, subscribers, or session issuance. Native (idToken/accessToken/authCode) and web (OAuth redirect) flows are both supported. Provider credentials live in a per-tenant table with env fallback. The module never creates its own user table — it links third-party identities to existing `users` and `customer_users` rows and reuses existing JWT/session issuance.

This spec generalizes the proprietary integration we built for an internal app so it can ship as part of open-mercato.

**In scope:**
- New `social_auth` module: data, API, DI, ACL, setup, events, encryption, tests.
- 4 providers (Google, Apple, Facebook, GitHub) with native + web flows.
- `SocialAuthPort` abstraction; better-auth-backed adapter.
- Per-tenant provider configuration with env fallback.
- Account linking to existing staff (`User`) or portal (`CustomerUser`) records.
- Event emission compatible with existing customer_accounts/auth event flows.
- React Native integration contract per provider.

**Out of scope:**
- Account-linking UI ("connect Google to my existing account") — separate spec.
- MFA composition with social login.
- Replacing better-auth — the port enables it; the swap itself is a future spec.
- Provider revocation hooks (Apple revocation, FB deauth callback).
- Admin UI for editing per-tenant provider config (CLI/setup-only in v1).

---

## Overview

open-mercato today ships two first-class authentication systems:

- `packages/core/src/modules/auth/` — staff identity, JWT + session cookie, RBAC via features.
- `packages/core/src/modules/customer_accounts/` — customer/portal identity, separate JWT + session cookie, two-tier RBAC.

Both surfaces are password-and-email today: login, signup, magic link, password reset. There is no first-class way for an integrator to add "Sign in with Google" without re-implementing the OAuth dance, token verification, and account linking.

Several open-mercato deployments (including ours, internally) have built ad-hoc better-auth wrappers to plug social login into one of the two surfaces. The pattern is consistent enough to extract: a thin module that handles the provider dance, verifies the resulting profile, and hands off to existing session/JWT issuance via a small adapter.

This spec specifies that module.

---

## Problem Statement

### P1 — No first-class social auth in open-mercato

Today, integrators wanting "Sign in with Google" copy-paste OAuth code per app. There is no shared module, no shared abstraction, no shared event surface. Each integrator solves account-linking, tenant scoping, encryption, and event emission from scratch.

### P2 — Two auth surfaces with no shared SSO seam

Staff and customer auth are deliberately separate identity systems (per `customer_accounts/AGENTS.md` MUST rule #11). A social-login module must integrate with **both** surfaces without leaking customer state into staff or vice versa, and without forcing duplication of OAuth logic.

### P3 — Library volatility

better-auth is the most ergonomic OSS option for OAuth-on-Node today, but it moves quickly and has historically reshuffled APIs. Hard-coupling open-mercato to better-auth is a maintenance liability. The module must isolate better-auth behind a port so the open-mercato contract is decoupled from the library's release cadence.

### P4 — Multi-tenant provider configuration

open-mercato is multi-tenant. Reading `process.env.GOOGLE_CLIENT_ID` once at boot pins every tenant to a single OAuth app. A module that ships in core must support per-tenant overrides without losing the env-only convenience for single-tenant deployments.

### P5 — Native vs web flow asymmetry

Mobile apps (RN/Expo) need the native-SDK → idToken/accessToken/authCode → backend-verify → platform JWT pattern. Browsers need the OAuth redirect dance. The module must support both with one codebase and one event surface, so subscribers don't have to care which flow produced the user.

### P6 — Implicit React Native contract

Per-provider quirks (Apple's first-auth-only name, Facebook Limited Login, GitHub having no native SDK) are typically buried in a single dev's head. The module documentation must formalize, per provider, exactly what payload the mobile app sends and which native SDK it uses.

---

## Proposed Solution

### S1 — New `social_auth` module

Create `packages/core/src/modules/social_auth/` following the standard module layout:

```
social_auth/
├── AGENTS.md
├── README.md
├── index.ts
├── acl.ts
├── setup.ts
├── di.ts
├── events.ts
├── encryption.ts
├── ce.ts                              # custom entity registration for TenantOauthProvider
├── data/
│   ├── entities.ts                    # TenantOauthProvider, SocialIdentity
│   └── validators.ts                  # social/web schemas
├── lib/
│   ├── social-auth-port.ts            # interface
│   ├── better-auth-adapter.ts         # implements port; isolates better-auth
│   ├── better-auth-config.ts          # per-tenant factory
│   ├── apple-client-secret.ts         # apple JWT helper
│   └── account-linker.ts              # links VerifiedSocialUser → User|CustomerUser
├── api/
│   ├── openapi.ts
│   ├── post/social/route.ts           # native idToken/accessToken/authCode flow (staff or customer)
│   ├── post/social/admin/route.ts     # tenant provider CRUD (admin-only)
│   ├── get/social/admin/route.ts
│   └── any/auth/[...path]/route.ts    # web redirect catch-all (better-auth handler)
├── services/
│   └── social-sign-in-service.ts      # thin orchestrator: port.verify → linker → JWT
├── commands/
│   └── social-sign-in.ts              # action-log shape
├── subscribers/
│   └── (none in v1; emitters only)
├── migrations/
│   └── Migration<ts>_social_auth_init.ts
├── __tests__/
└── __integration__/
```

The module is **opt-in**: a deployment includes it in `apps/<app>/src/modules.ts` only if it wants social login. Disabling it does not break staff or customer auth (`module-decoupling.test.ts` continues to pass).

### S2 — `SocialAuthPort` abstraction

```ts
// lib/social-auth-port.ts
export type SocialProvider = 'google' | 'apple' | 'facebook' | 'github'
export type SocialAudience = 'staff' | 'customer'

export type SocialCredential =
  | { kind: 'idToken'; token: string }
  | { kind: 'accessToken'; token: string }
  | { kind: 'authCode'; code: string; redirectUri: string }

export interface VerifiedSocialUser {
  provider: SocialProvider
  providerUserId: string
  email: string | null
  emailVerified: boolean
  name: string | null
  rawProfile: Record<string, unknown>
}

export interface SocialAuthPort {
  verify(args: {
    tenantId: string
    provider: SocialProvider
    credential: SocialCredential
    profileHints?: Record<string, unknown>  // Apple first-auth name passthrough
  }): Promise<VerifiedSocialUser>

  buildAuthorizationUrl(args: {
    tenantId: string
    provider: SocialProvider
    redirectUri: string
    state: string
    audience: SocialAudience
  }): Promise<URL>

  webHandler(req: Request): Promise<Response>
}
```

The port deliberately **does not** issue JWTs, manage sessions, or persist users. Those responsibilities stay in the existing `auth` and `customer_accounts` services. The port owns only the OAuth dance plus provider verification.

### S3 — better-auth adapter

`BetterAuthSocialAdapter` implements `SocialAuthPort`:

- Holds an LRU-capped (default 50, configurable) `Map<tenantId, BetterAuth>` so per-tenant config is honored without rebuilding the SDK on every request.
- Reads provider config from `tenant_oauth_providers` (decrypted), falling back to env vars (`OM_SOCIAL_AUTH_GOOGLE_CLIENT_ID`, etc.) for single-tenant defaults.
- Routes `verify` based on `credential.kind`:
  - `idToken` → `auth.api.signInSocial({ idToken: { token, ... }, disableRedirect: true })`
  - `accessToken` → `auth.api.signInSocial({ provider, accessToken })`
  - `authCode` → token exchange, then signInSocial.
- For GitHub, adds an explicit branch that calls `/user` + `/user/emails` after token exchange (GitHub OAuth2 has no OIDC profile on github.com).

The adapter is the **only** file that imports from `better-auth`. All other module code consumes the port via DI.

### S4 — Account linking

`account-linker.ts` translates a `VerifiedSocialUser` into a real open-mercato user:

```ts
linkOrCreate(args: {
  audience: 'staff' | 'customer'
  tenantId: string
  organizationId?: string  // required for customer; default for staff
  verified: VerifiedSocialUser
}): Promise<{
  userId: string                        // User.id or CustomerUser.id
  isNewUser: boolean
  identityId: string                    // SocialIdentity row id
}>
```

Resolution order:
1. Find a `SocialIdentity` row matching `(tenantId, audience, provider, providerUserId)` → return existing link.
2. If `email` is present and `emailVerified === true`, find an existing `User`/`CustomerUser` by `email_hash` and link.
3. Otherwise, create a new `User`/`CustomerUser` with a random unusable password marker, default role assigned, then create the `SocialIdentity` row.

The linker emits one of two events:

- `social_auth.user.signed_up` (new account)
- `social_auth.user.signed_in` (existing account)

Each event carries `{ audience, tenantId, organizationId?, userId, provider, isNewUser }`. Existing `customer_accounts.user.created` and `auth.user.created` events continue to fire from the underlying creation paths so existing subscribers (CRM auto-link, welcome emails, audit log) keep working unmodified.

### S5 — Per-tenant provider configuration

New entity `TenantOauthProvider`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | FK → tenants |
| `audience` | text | `'staff' \| 'customer' \| 'both'` |
| `provider` | text | `'google' \| 'apple' \| 'facebook' \| 'github'` |
| `client_id` | text | |
| `client_secret_enc` | text | encrypted via `TenantDataEncryptionService` |
| `extra` | jsonb | provider-specific (Apple `teamId`/`keyId`/`privateKey`) |
| `is_active` | boolean | default true |
| `created_at`/`updated_at`/`deleted_at` | timestamptz | |

Unique on `(tenant_id, audience, provider)` where `deleted_at IS NULL`.

`encryption.ts` registers `client_secret_enc` and `extra.privateKey` for column-level encryption.

Env fallback keys (used when no row exists):

- `OM_SOCIAL_AUTH_<PROVIDER>_CLIENT_ID`
- `OM_SOCIAL_AUTH_<PROVIDER>_CLIENT_SECRET`
- `OM_SOCIAL_AUTH_APPLE_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY`

### S6 — Native flow API

`POST /api/social_auth/social` accepts:

```ts
const socialSchema = z.object({
  audience: z.enum(['staff', 'customer']),
  provider: z.enum(['google', 'apple', 'facebook', 'github']),
  credential: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('idToken'), token: z.string().min(1) }),
    z.object({ kind: z.literal('accessToken'), token: z.string().min(1) }),
    z.object({ kind: z.literal('authCode'),
      code: z.string().min(1), redirectUri: z.string().url() }),
  ]),
  profileHints: z.record(z.string(), z.unknown()).optional(),  // Apple names
})
```

Response (audience-aware): same shape the corresponding native auth endpoint returns today.

- `audience: 'staff'` → matches `auth/api/login.ts` response: `{ token, user, features }` plus `Set-Cookie` for staff session.
- `audience: 'customer'` → matches `customer_accounts/api/login.ts` response and sets `customer_auth_token` + `customer_session_token` cookies.

Re-using the existing JWT/session issuance services keeps a single auth model per surface.

### S7 — Web redirect flow

`/api/social_auth/auth/[...path]/route.ts` is a thin catch-all that calls `port.webHandler(req)`. After a successful callback, a Next.js middleware matched on `/api/social_auth/auth/callback/:provider` (gated by env flag `OM_SOCIAL_AUTH_WEB_PLATFORM_JWT`):

1. Reads the better-auth session cookie set by the response.
2. Resolves the linked open-mercato user (staff or customer based on the `audience` query param baked into `state`).
3. Issues an open-mercato JWT + session cookie via the standard `AuthService` / `CustomerAuthService`.
4. Clears better-auth's internal cookie.

This keeps the platform a single auth model from the app's perspective; better-auth cookies are an implementation detail.

### S8 — React Native integration contract

| Provider | Native SDK | Credential | Notes |
|---|---|---|---|
| **Apple** | `@invertase/react-native-apple-authentication` or `expo-apple-authentication` | `idToken` (+ `profileHints: { firstName, lastName }` on first auth) | Apple sends the user's name **only** the first time. App MUST forward it. |
| **Google** | `@react-native-google-signin/google-signin` | `idToken` | Configure with the Web client ID for `idToken` audience. |
| **Facebook** | `react-native-fbsdk-next` | `accessToken` | iOS 17+ Limited Login returns a JWT-shaped authentication token; v1 supports classic access tokens only. |
| **GitHub** | `expo-auth-session` (no native SDK) | `authCode` + `redirectUri` | Custom scheme like `<app>://oauth/github`; backend exchanges code. |

This table lives in `social_auth/AGENTS.md` and `apps/docs/`; the spec is the source of truth.

---

## Architecture

### Request flow — native (RN, customer audience)

```
RN app                                  open-mercato
[native SDK / expo-auth-session] ── credential ──▶ POST /api/social_auth/social
                                                   │ socialSchema.parse
                                                   │ socialAuthPort.verify(...)
                                                   │   └─ BetterAuthSocialAdapter
                                                   │       getBetterAuthForTenant(tid)
                                                   │       (idToken|accessToken|authCode dispatch)
                                                   │ accountLinker.linkOrCreate(...)
                                                   │   └─ existing CustomerUser path
                                                   │ customerAuthService.createSession + signJwt
                                                   │ emit social_auth.user.{signed_in|signed_up}
                                                   └─▶ { token, refreshToken, user, isNewUser }
```

### Request flow — web (browser, staff audience)

```
browser ── click "Google" ──▶ GET /api/social_auth/auth/sign-in/social/google?audience=staff
                              │ port.webHandler(req) → 302 to Google
Google consent ──────────────▶ GET /api/social_auth/auth/callback/google?code=...&state=...
                              │ port.webHandler(req)  (token exchange + verify)
                              │ middleware swaps better-auth cookie for open-mercato session
                              └─▶ 302 to original return URL with om session cookie set
```

### Data Models

**`tenant_oauth_providers`** — see §S5.

**`social_identities`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid | |
| `audience` | text | `'staff' \| 'customer'` |
| `provider` | text | |
| `provider_user_id` | text | |
| `user_id` | uuid | FK to `users.id` when audience=staff, else null |
| `customer_user_id` | uuid | FK to `customer_users.id` when audience=customer, else null |
| `email_hash` | text | for blind index lookups |
| `last_signed_in_at` | timestamptz | |
| `created_at`/`updated_at`/`deleted_at` | timestamptz | |

Unique on `(tenant_id, audience, provider, provider_user_id)` where `deleted_at IS NULL`.

A user (staff or customer) MAY have multiple identities — one per provider — all linking to the same `user_id`/`customer_user_id`. This is the foundation account-linking-UI will build on later.

**No changes to `users`, `customer_users`, or any existing entity.** Better-auth's internal session/account tables are not used directly by open-mercato — they live inside the better-auth handler scope and are ignored downstream of `port.verify`.

### API Contracts

**`POST /api/social_auth/social`** — see §S6 schema. Status codes: `200` (success), `400` (invalid credential / unsupported provider for this audience), `401` (verification failed), `403` (account inactive), `429` (rate limited). Rate-limited per-IP and per-`(audience, provider, providerUserId)` once known.

**`GET|POST /api/social_auth/auth/[...path]`** — better-auth catch-all. Documented in OpenAPI as a single tagged route group; subpaths are not individually enumerated.

**`GET|POST|PUT|DELETE /api/social_auth/admin/providers`** — tenant provider CRUD, gated by `social_auth.providers.manage`. `client_secret` is write-only; reads return a redacted `client_secret_set: boolean` instead.

All routes export `openApi`. CRUD routes use `makeCrudRoute` with `indexer: { entityType: 'social_auth:tenant_oauth_provider' }`.

### Events

```ts
// events.ts
export const eventsConfig = createModuleEvents({
  moduleId: 'social_auth',
  events: [
    { id: 'social_auth.user.signed_up', label: 'Social sign-up', category: 'crud',
      entity: 'social_identity' },
    { id: 'social_auth.user.signed_in', label: 'Social sign-in', category: 'crud',
      entity: 'social_identity' },
    { id: 'social_auth.identity.linked', label: 'Identity linked to existing user',
      category: 'crud', entity: 'social_identity' },
    { id: 'social_auth.provider.config.updated', label: 'Tenant provider config updated',
      category: 'crud', entity: 'tenant_oauth_provider' },
  ],
} as const)
```

### Access Control

```ts
// acl.ts
export const features = [
  'social_auth.providers.manage',   // edit tenant_oauth_providers
  'social_auth.providers.view',     // read (with secret redaction)
  'social_auth.identities.view',    // see linked identities for a user
  'social_auth.identities.unlink',  // remove a social link from a user
]
```

`setup.ts` `defaultRoleFeatures`:

- `superadmin`: `['social_auth.*']`
- `admin`: `['social_auth.providers.*', 'social_auth.identities.view']`
- `employee`: `[]`

Customer roles do not get any `social_auth.*` features by default — these are administrative.

### Encryption

`encryption.ts` registers:

- `tenant_oauth_providers.client_secret_enc`
- `tenant_oauth_providers.extra` (full jsonb, since Apple keys live inside)

### Setup

`setup.ts` reads env-fallback provider config and provisions a default `tenant_oauth_providers` row (audience `'both'`) when env vars are present and no row exists. Idempotent. Single-tenant deployments thus get zero-config behavior identical to the proprietary integration today.

### Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Web post-callback middleware corrupts better-auth's response | High | Web SSO | Integration tests assert state preserved, error responses pass through, success path issues om JWT and clears better-auth cookie. Feature-flag with `OM_SOCIAL_AUTH_WEB_PLATFORM_JWT`. | Low |
| GitHub OAuth2 (no OIDC) — provider profile shape differs | Medium | Verification | Explicit GitHub branch in adapter; integration test with recorded fixtures + optional live-cred test. | Low |
| Per-tenant config + better-auth singleton internals | Medium | Multi-tenant correctness | LRU cache of per-tenant instances; provider config update event invalidates cache entry. | Low |
| Account-linker hijacks an existing customer/staff account via unverified provider email | High | Security | Linker only auto-merges when `emailVerified === true`. For unverified emails, always create a new identity with no merge. Document explicitly. | Low |
| Audience confusion (staff token issued for a customer flow) | High | Security | `audience` is a required input and is also baked into web `state`. Linker dispatches by audience and verifies the resulting user lives in the matching table. Integration test asserts cross-audience rejection. | Low |
| FB Limited Login (iOS 17+) returns auth-token JWT, not classic access token | Medium | RN | RN contract states v1 supports classic accessToken only; auth-token branch is a v1.x followup. | Open until mobile teams confirm |
| Apple revocation webhook not wired | Low | Compliance (Apple guideline 5.1.1(v)) | Out of scope. Tracked separately. | Accepted |
| Replacing better-auth still requires migrating any persisted ba_* tables | Low | Future swap | We deliberately do not persist better-auth tables. Port owns runtime; persistent state is `social_identities` only. | Accepted |
| Module disabled in apps that don't use social auth | Low | Decoupling | `module-decoupling.test.ts` covers this; staff/customer auth keep working. | Low |
| Discriminated-union schema break for clients on old shape | Medium | Backwards compat | N/A — module is new. Old proprietary clients are out of scope (they live in their own app). | None |

### Final Compliance Report

**Task Router rows consulted:**

- `packages/core/AGENTS.md` → Module Setup, Events, Access Control, Encryption: applied throughout.
- `packages/core/src/modules/auth/AGENTS.md`: staff JWT/session issuance reused; no new feature flags inside `auth`.
- `packages/core/src/modules/customer_accounts/AGENTS.md`: customer JWT/session issuance reused; the new module never imports staff auth services directly (and vice versa).
- `packages/shared/AGENTS.md`: encryption helpers + `hashForLookup` for `email_hash` on `social_identities`.
- `packages/queue/AGENTS.md`: rate-limiter shared with existing auth endpoints (no new queue worker introduced).
- `.ai/qa/AGENTS.md`: integration tests required (manifest below).
- `.ai/specs/AGENTS.md`: this file follows the OSS naming convention.

**Naming/conventions check:**

- Module id: `social_auth` (snake_case).
- Event ids: `social_auth.user.signed_up`, `social_auth.user.signed_in`, `social_auth.identity.linked`, `social_auth.provider.config.updated` (dot-separated, past tense, singular entity).
- Entity names: `TenantOauthProvider`, `SocialIdentity` → `tenant_oauth_providers`, `social_identities`.
- File names: kebab-case.

**Read-only package check:** all changes confined to the new `packages/core/src/modules/social_auth/` directory plus a single migration. No changes to existing `auth` or `customer_accounts` modules.

**OpenAPI:** every API route exports `openApi`; admin CRUD uses `createCrudOpenApiFactory`. Catch-all is documented as one tagged group.

**Backward compatibility:** the module is new and opt-in; no contract surface in the BC-13 list is modified. Adding the module to a deployment is purely additive. Removing it from a deployment that previously used it is a data concern (orphan `social_identities` rows) and is documented in the README.

### Integration test coverage (required)

| Test | Endpoint | Scenario |
|---|---|---|
| Customer: Google idToken — new user | `POST /api/social_auth/social` | Creates customer_user with linked social_identity, returns customer JWT, emits signed_up event. |
| Customer: Google idToken — returning user | same | Same providerUserId resolves to existing customer_user; returns isNewUser=false; emits signed_in. |
| Customer: Apple first-auth name passthrough | same | profileHints.firstName/lastName persisted to CustomerUser; second auth without hints leaves names intact. |
| Customer: Facebook accessToken | same | Creates customer_user via FB graph profile. |
| Customer: GitHub authCode | same | Token exchange + /user + /user/emails; primary verified email used for blind-index merge. |
| Staff: Google idToken | same with audience=staff | Creates User, returns staff JWT + cookie; verifies feature ACL load path runs. |
| Audience cross-rejection | same | A request with audience=staff but a credential previously linked to a customer_user 401s; never issues a staff token. |
| Email-merge gating | same | Unverified provider email does NOT merge with an existing user by email_hash; always creates a new identity. |
| Per-tenant provider override | same | tenant_oauth_providers row beats env; encrypted secret correctly decrypted at request time. |
| Web redirect (Google, customer) | GET .../sign-in/social/google?audience=customer → callback | Callback middleware issues om customer cookies and clears better-auth cookie. |
| Web redirect error | GET .../callback/google?error=access_denied | Middleware passes error through; no om token issued. |
| Catch-all method dispatch | POST .../sign-out | Better-auth handles it; om cookies invalidated by middleware. |
| Provider enum rejection | POST /api/social_auth/social with provider=twitter | 400. |
| Admin CRUD: list providers redacts secrets | GET /api/social_auth/admin/providers | client_secret never in response; client_secret_set=true is. |
| Admin CRUD: write requires manage feature | POST /api/social_auth/admin/providers without feature | 403. |
| Soft-deleted user re-signup via provider | POST /api/social_auth/social | Restores or recreates per existing soft-delete policy in customer_accounts. |
| Action log for SSO sign-in | any successful native flow | `commands.social_auth.social-sign-in` row written; `undo` deliberately empty (third-party state can't be reversed). |
| Module disabled smoke | startup with social_auth absent | App boots, customer/staff auth unaffected (extends module-decoupling.test.ts). |

### Implementation Steps

1. **Scaffold** the module per layout above (`yarn generate` after).
2. **Schema** — add `TenantOauthProvider`, `SocialIdentity` entities; generate migration. Wire `encryption.ts`.
3. **Port** — define `SocialAuthPort` interface.
4. **Adapter** — implement `BetterAuthSocialAdapter` with per-tenant LRU cache and credential dispatch (idToken/accessToken/authCode + GitHub branch).
5. **Linker** — implement account linking with strict `emailVerified` gating; emit events.
6. **DI** — register port + linker as request-scoped.
7. **Native API route** — `api/post/social/route.ts`; thin orchestrator over port → linker → JWT issuance for the requested audience.
8. **Admin CRUD** — `api/.../admin/providers` via `makeCrudRoute`.
9. **Web catch-all** — `api/any/auth/[...path]/route.ts` delegating to `port.webHandler`.
10. **Cookie-swap middleware** — Next.js middleware on the callback path, gated by env flag.
11. **Command** — `commands/social-sign-in.ts` for action logging; `undo` documented as a no-op with rationale.
12. **Setup.ts** — env→default-row provisioning, idempotent.
13. **ACL + setup defaults** — features and `defaultRoleFeatures`.
14. **Tests** — implement the integration test manifest above; unit-test the adapter against better-auth's mock provider.
15. **Docs** — `social_auth/README.md` (operator-facing), `social_auth/AGENTS.md` (agent-facing), and a section in `apps/docs/` covering the RN contract.
16. **Verify** — `yarn generate && yarn build && yarn test && yarn test:integration`.

### Open Questions

1. **Facebook Limited Login** — should v1 accept the JWT-shaped authentication token as a separate `credential.kind`? Or defer to v1.1? Need mobile team input from at least one downstream consumer.
2. **Account-merge UI** — out of scope here, but should the data model anticipate "user has two identities of the same provider" (e.g., a personal and a work GitHub)? Current unique constraint allows it; the open question is whether the linker should ever auto-merge across provider records.
3. **Apple JWT key rotation** — `extra.privateKey` rotation path: should we keep a `previous_private_key` column to overlap-rotate? Defer to a v1.1 spec unless ops feedback says otherwise.
4. **Better-auth pinning** — pin to a specific minor or accept range? Recommend minor pin + a quarterly review, given API churn.
5. **Custom providers** — out of scope for v1, but the port shape should not preclude tenant-defined OIDC providers later. Current `SocialProvider` is a closed enum; opening it to `string` post-v1 is a non-breaking widening.

### Changelog

- **2026-04-29** — Initial draft. Generalizes a proprietary better-auth integration into a reusable open-mercato core module supporting staff and customer audiences, native and web flows, four providers, per-tenant configuration, and event-based downstream integration. Built atop existing `auth` and `customer_accounts` modules without modifying either.
