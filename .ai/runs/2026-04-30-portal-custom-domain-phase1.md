# Portal Custom Domain Routing — Phase 1 + 1.5 Implementation Progress

| Field | Value |
|-------|-------|
| **Spec** | [`.ai/specs/2026-04-08-portal-custom-domain-routing.md`](../specs/2026-04-08-portal-custom-domain-routing.md) (rev 5) |
| **Pre-implementation analysis** | [`.ai/specs/analysis/ANALYSIS-2026-04-08-portal-custom-domain-routing.md`](../specs/analysis/ANALYSIS-2026-04-08-portal-custom-domain-routing.md) |
| **Branch** | `fix/issue-1631-messages-send-submit-lock` (current) — **TODO**: switch to a dedicated feature branch before commits |
| **Started** | 2026-04-30 |
| **Status** | In Progress |

## How to resume in another session

1. Read this file top to bottom. Current state is in **Phase Status** below.
2. Read the spec at `.ai/specs/2026-04-08-portal-custom-domain-routing.md` (rev 5).
3. Find the first unchecked `[ ]` item in the **Detailed Checklist** and continue from there.
4. After each task, update its checkbox to `[x]` and add a one-line note (commit hash, file paths created/modified).
5. When Phase 1 + 1.5 are fully checked off, run the **Verification Gate** at the bottom and tick those boxes. Then update the spec's Implementation Status section.
6. If you hit a blocker, add a `### Blockers` entry below with the file path, error, and what you tried.

Suggested resume command in a fresh session:
```
/auto-continue-pr <pr-number>
```
Or, if no PR exists yet, just tell Claude:
> "Continue Phase 1 of the portal custom domain spec. Read `.ai/runs/2026-04-30-portal-custom-domain-phase1.md` for state and pick up from the first unchecked task."

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| Pre-flight: read AGENTS guides | **Done** | customer_accounts/AGENTS.md, packages/core/AGENTS.md, existing patterns |
| Phase 1: Foundation libs | **Done** | hostname.ts, proxyRanges.ts, customerUrl.ts + tests (20 tests passing) |
| Phase 1: Entity + enums | **Done** | DomainMapping appended to data/entities.ts; type aliases for DomainProvider / DomainStatus |
| Phase 1: Validators | **Done** | hostnameSchema (with normalizeHostname transform), registerDomainSchema |
| Phase 1: Events + ACL + setup | **Done** | 7 events appended; `customer_accounts.domain.manage` feature added; setup.ts already has `customer_accounts.*` wildcard so no setup change needed |
| Phase 1: domainMappingService | **Done** | Full service: register, verify (CNAME→A→reverse-resolve), activate (with replace auto-removal), remove, healthCheck (3 retries with backoff), resolveByHostname/Active/All, findPendingVerification, findPendingTls. Cache-aware, DI-injectable DNS resolver + health check for testability. |
| Phase 1: DI registration | **Done** | `domainMappingService` registered in `di.ts` |
| Phase 1: Mutation guards | **Done** | hostname-format (priority 10, normalizes via modifiedPayload), hostname-unique (priority 20, cross-tenant check), org-limit (priority 30, max 2 per org) |
| Phase 1: Response enrichers | **Done** | `customer_accounts.domain-status:directory:organization` added — picks the primary domain (active > verified > pending > tls_failed > dns_failed) per org via batch `$in` query |
| Phase 1: Notifications | Not Started | 4 types + client renderers |
| Phase 1: API routes | Not Started | 10 files |
| Phase 1: Subscribers | Not Started | 5 subscribers |
| Phase 1: i18n keys | Not Started | en/pl/de/es |
| Phase 1: Migrations & generators | Not Started | yarn db:generate + yarn generate |
| Phase 1.5: Customer auth host-awareness | Not Started | resolveTenantContext, login schema, getCustomerAuthFromCookies |
| Verification Gate | Not Started | build, lint, test, integration |

## Detailed Checklist

### Pre-flight

- [x] Read `packages/core/src/modules/customer_accounts/AGENTS.md`
- [x] Read `packages/core/AGENTS.md` (relevant sections: API Routes, Module Setup, Events, Notifications, Custom Fields, Encryption, Response Enrichers)
- [ ] Read `.ai/skills/code-review/references/review-checklist.md` — **next session before starting service implementation**
- [x] Read existing customer_accounts patterns: `data/entities.ts`, `data/validators.ts`, `events.ts`, `acl.ts`, `setup.ts`, `notifications.ts`, `di.ts` (notifications.client.ts and data/enrichers.ts pending — read before Phase 1: Notifications and Phase 1: Response enrichers)
- [ ] Read at least one existing service for pattern (e.g., `services/customerUserService.ts`) — **next session before Phase 1: domainMappingService**
- [ ] Read at least one existing admin route using `makeCrudRoute` — **next session before Phase 1: API routes**
- [ ] Read example template `data/guards.ts` from `packages/create-app/template/src/modules/example/data/guards.ts` — **next session before Phase 1: Mutation guards**
- [ ] Read existing notification subscriber pattern — **next session before Phase 1: Subscribers**
- [x] Read `customer_accounts/lib/customerAuthServer.ts` and `api/login.ts` (for Phase 1.5) — login.ts read; customerAuthServer.ts pending (read it before extending)

### Phase 1: Foundation libs (no dependencies on other Phase 1 items)

- [x] Create `packages/core/src/modules/customer_accounts/lib/hostname.ts` exporting `normalizeHostname(input: string): string` with lowercase + trailing-dot strip + IDN→Punycode + 253-char cap. Uses `new URL()` for IDN conversion (avoids deprecated `node:punycode`).
- [x] Create `packages/core/src/modules/customer_accounts/lib/proxyRanges.ts` exporting `isInKnownProxyRange(ip)` and `detectProxy(ip)`. Reads `KNOWN_PROXY_IP_RANGES` env var (default = Cloudflare's 15 published ranges) and parses CIDR. Cached after first read; `resetProxyRangeCacheForTests()` exposed for tests.
- [x] Create `packages/core/src/modules/customer_accounts/lib/customerUrl.ts` exporting `urlForCustomerOrg(orgId, path, options?)`. Calls `domainMappingService.resolveActiveByOrg(orgId)` then falls back to `PLATFORM_PORTAL_BASE_URL/{orgSlug}/portal{path}`. Service is resolved via DI request container with try/catch for tests / fresh installs.
- [x] Create `packages/core/src/modules/customer_accounts/lib/__tests__/hostname.test.ts` (10 tests, all green)
- [x] Create `packages/core/src/modules/customer_accounts/lib/__tests__/proxyRanges.test.ts` (10 tests, all green)

### Phase 1: Entity + enums

- [x] Add `DomainProvider` and `DomainStatus` type aliases (`pending | verified | active | dns_failed | tls_failed`) plus `DOMAIN_PROVIDERS` / `DOMAIN_STATUSES` const arrays to `packages/core/src/modules/customer_accounts/data/entities.ts`
- [x] Add `DomainMapping` entity class to same file with all columns: hostname (UNIQUE), tenant_id (UUID), organization_id (UUID), replaces_domain_id (self-referential ManyToOne nullable), provider (enum default `traefik`), status (enum default `pending`), verified_at, last_dns_check_at, dns_failure_reason, tls_failure_reason, tls_retry_count, created_at, updated_at
- [x] Verify imports for `Tenant` and `Organization` — kept as raw UUID columns (no ManyToOne) to honor "no direct ORM relationships between modules" rule. Self-referential `replacesDomain` ManyToOne is fine (same module).

### Phase 1: Validators

- [x] Add `hostnameSchema` to `data/validators.ts` — uses `z.string().transform()` + `normalizeHostname` with proper `ctx.addIssue` failure path
- [x] Add `registerDomainSchema` (hostname + organizationId + optional replacesDomainId) and `RegisterDomainInput` type via `z.infer`

### Phase 1: Events + ACL + setup

- [x] Add 7 events to `events.ts`: `customer_accounts.domain_mapping.{created, verified, activated, dns_failed, tls_failed, deleted, replaced}` with `clientBroadcast: true`
- [x] Add `customer_accounts.domain.manage` feature to `acl.ts`
- [x] **No setup.ts change needed**: `superadmin` and `admin` already have `customer_accounts.*` wildcard which covers the new `customer_accounts.domain.manage` feature — verified against the wildcard ACL handling rule in `.ai/lessons.md`

### Phase 1: domainMappingService

- [x] Create `services/domainMappingService.ts` with:
  - [x] Constructor: takes `EntityManager` plus optional `cacheService`, `dnsResolver`, `healthCheck` (DI-injectable for testability)
  - [x] `register(input)` — creates entity, emits `created`, invalidates cache
  - [x] `verify(id)` — DNS verification with full CNAME → A → reverse-resolve fallback chain, transitions to `verified` or `dns_failed`, returns diagnostics on failure
  - [x] `activate(id)` — `verified` → `active`, handles `replacesDomain` auto-removal (emits `replaced` + `deleted` for the old row)
  - [x] `remove(id, scope?)` — emits `deleted`, invalidates cache
  - [x] `resolveByHostname(input)` — normalizes input, reads `@open-mercato/cache` (300s TTL, tag-based) then falls back to DB
  - [x] `resolveActiveByOrg(orgId)` — for `urlForCustomerOrg`; same caching pattern keyed by org
  - [x] `resolveAll()` — for middleware batch warm-up; joins org slugs via single batch query
  - [x] `healthCheck(id)` — HTTPS GET to `/api/customer-accounts/domain-check` with 3 retries (exponential backoff 1s/4s/16s), transitions to `active` or `tls_failed` (with `tlsRetryCount` increment)
  - [x] `findPendingVerification({ olderThanMs? })` — for DNS worker
  - [x] `findPendingTls({ maxRetries?, batchSize? })` — for TLS retry worker
- [x] All write methods emit lifecycle events (created/verified/dns_failed/activated/tls_failed/deleted/replaced) and invalidate cache via `cacheService.deleteByTags`. **Note**: spec mentioned `emitCrudSideEffects`, but that helper only handles standard CRUD actions (`created`/`updated`/`deleted`) and would conflate the lifecycle events. Direct event emission via `emitCustomerAccountsEvent` is the right shape here. Cache invalidation is handled in-service for predictability + via the upcoming ephemeral subscriber as defense in depth.

### Phase 1: DI registration

- [x] Register `domainMappingService` in `di.ts` (scoped, like other customer_accounts services)

### Phase 1: Mutation guards

- [x] Create `data/guards.ts`:
  - [x] `customer_accounts.domain_mapping.hostname-format` (priority 10) — runs `tryNormalizeHostname` and writes the canonical form back via `modifiedPayload`
  - [x] `customer_accounts.domain_mapping.hostname-unique` (priority 20) — uses `domainMappingService.resolveByHostname` to detect cross-tenant collisions; returns 409
  - [x] `customer_accounts.domain_mapping.org-limit` (priority 30) — enforces max 2 domains per org (1 active + 1 pending replacement); returns 409

### Phase 1: Response enrichers

- [x] Update `data/enrichers.ts` to add `customer_accounts.domain-status:directory:organization` enricher
  - [x] Uses `enrichMany()` with batch `$in` query, picks the primary domain per org by status priority (active > verified > pending > tls_failed > dns_failed) then most-recent createdAt
  - [x] Feature-gated by `customer_accounts.domain.manage`
  - [x] Returns `{ _customDomain: { hostname, status } | null }`
  - [x] Timeout: 1000ms, critical: false, fallback: `{ _customDomain: null }`

### Phase 1: Notifications

- [ ] Add 4 types to `notifications.ts`: `customer_accounts.domain_mapping.{verified, activated, dns_failed, tls_failed}` with severity, titleKey, action link, expiresAfterHours: 168
- [ ] Add corresponding renderers to `notifications.client.ts`

### Phase 1: API routes

CRUD via `makeCrudRoute` (omit `indexer` field per rev 5):
- [ ] `api/admin/domain-mappings.ts` — GET list + POST create + DELETE (single file with method dispatch via `makeCrudRoute`)

Custom routes (use `runCustomRouteAfterInterceptors()`):
- [ ] `api/admin/domain-mappings/[id]/verify.ts` (POST)
- [ ] `api/admin/domain-mappings/[id]/health-check.ts` (POST)
- [ ] `api/get/domain-check.ts` — Traefik gating, secret-protected
- [ ] `api/get/domain-resolve.ts` — middleware single resolve, secret-protected
- [ ] `api/get/domain-resolve/all.ts` — middleware batch warm-up, secret-protected

All routes export `openApi`.

### Phase 1: Subscribers

- [ ] `subscribers/invalidate-domain-cache.ts` — ephemeral, on `customer_accounts.domain_mapping.*`, calls `cacheService.deleteByTags(['domain_routing', 'domain_routing:{hostname}'])`
- [ ] `subscribers/domain-verified-notification.ts` — persistent
- [ ] `subscribers/domain-activated-notification.ts` — persistent
- [ ] `subscribers/domain-dns-failed-notification.ts` — persistent
- [ ] `subscribers/domain-tls-failed-notification.ts` — persistent

### Phase 1: i18n keys

- [ ] Add ~30 keys (per spec i18n table) to `i18n/en.json`
- [ ] Add to `pl.json`, `de.json`, `es.json` (use English placeholders if needed; mark with `// TODO translate` comments)

### Phase 1: Migrations & generators

- [ ] Run `yarn db:generate` — creates migration for `domain_mappings` table
- [ ] Verify generated migration matches spec's illustrative SQL (UNIQUE on hostname, partial indexes, FK to tenants/organizations, replaces_domain_id self-FK)
- [ ] Verify a CHECK constraint exists for hostname normalization (or add via custom migration if MikroORM doesn't emit it)
- [ ] Run `yarn generate` — should regenerate `enrichers.generated.ts`, `guards.generated.ts`, `notifications.generated.ts`
- [ ] Verify no TypeScript errors after generation

### Phase 1.5: Customer auth host-awareness

- [ ] Relax `loginSchema.tenantId` to optional in `data/validators.ts`. Mirror in `signupSchema`, `magicLinkRequestSchema`, `passwordResetRequestSchema`, `passwordResetConfirmSchema`
- [ ] Create `lib/resolveTenantContext.ts` exporting `resolveTenantContext(req, bodyTenantId?)` — platform-host requires body, custom-host resolves from Host, mismatch returns error
- [ ] Update `api/login.ts` to use `resolveTenantContext`
- [ ] Update `api/signup.ts` to use `resolveTenantContext` and `urlForCustomerOrg` for the welcome-email link
- [ ] Update `api/magic-link/request.ts` to use `resolveTenantContext`
- [ ] Update `api/password/reset-request.ts` to use `resolveTenantContext`
- [ ] Update `api/password/reset-confirm.ts` to use `resolveTenantContext`
- [ ] Extend `lib/customerAuthServer.ts`: add optional `expectedTenantId` to `getCustomerAuthFromCookies`; add new `getCustomerAuthForHost(req)` wrapper
- [ ] Add unit tests:
  - [ ] `loginSchema` accepts missing `tenantId`
  - [ ] `resolveTenantContext` body / host / mismatch branches
  - [ ] `getCustomerAuthFromCookies` rejects mismatched JWT tenantId

### Phase 1: Documentation updates

- [ ] Add to `customer_accounts/AGENTS.md`: rule that customer-portal email senders must use `urlForCustomerOrg`

### Verification Gate

- [ ] `yarn lint` passes
- [ ] `yarn test` passes (especially new unit tests)
- [ ] `yarn build:packages` passes
- [ ] `yarn generate` runs cleanly with no TS errors
- [ ] `yarn db:generate` produces a clean migration
- [ ] No `any` types introduced
- [ ] No raw `fetch` (must use `apiCall`)
- [ ] No hardcoded user-facing strings (must use `useT()` / `resolveTranslations()`)
- [ ] All API routes export `openApi`
- [ ] All workers export `metadata` with `{ queue, id, concurrency }`
- [ ] All subscribers export `metadata` with `{ event, persistent?, id }`
- [ ] Self-review against `.ai/skills/code-review/references/review-checklist.md`

### Update spec

- [ ] Add `## Implementation Status` section to spec with Phase 1 + 1.5 marked Done
- [ ] Cross off the rev 5 verdict's "ready for implementation" — Phase 1 + 1.5 actually shipped

## Blockers

(none yet)

## Session Log

### 2026-04-30 — Session 1

**Completed:**
- Created this progress file with full Phase 1 + 1.5 checklist.
- Read `customer_accounts/AGENTS.md`, `packages/core/AGENTS.md`, lessons.md, BACKWARD_COMPATIBILITY.md, and existing `data/entities.ts` / `data/validators.ts` / `events.ts` / `acl.ts` / `setup.ts` / `notifications.ts` / `di.ts` / `api/login.ts` patterns.
- **Phase 1 — Foundation libs**: Created `lib/hostname.ts` (uses `new URL()` for IDN→Punycode, avoiding deprecated `node:punycode`), `lib/proxyRanges.ts` (IPv4 CIDR matcher with cache, default Cloudflare ranges, env override), `lib/customerUrl.ts` (resolves active custom domain via DI, falls back to platform URL). 20 unit tests, all green.
- **Phase 1 — Entity + enums**: Appended `DomainMapping` entity to `data/entities.ts` with all 12 spec columns, `DomainProvider`/`DomainStatus` type aliases, `DOMAIN_PROVIDERS`/`DOMAIN_STATUSES` const arrays, partial-status indexes left for the migration step. Used raw UUID FKs for tenant/org (no ManyToOne — module-boundary rule). Self-referential `replacesDomain` ManyToOne added.
- **Phase 1 — Validators**: Added `hostnameSchema` (with `normalizeHostname` transform via `z.transform` + `ctx.addIssue`), `registerDomainSchema` (hostname + organizationId + optional replacesDomainId), `RegisterDomainInput` type.
- **Phase 1 — Events + ACL + setup**: Added 7 domain_mapping events to `events.ts` (all `clientBroadcast: true`), added `customer_accounts.domain.manage` feature to `acl.ts`. Setup.ts unchanged — wildcard `customer_accounts.*` already grants the new feature to superadmin/admin.

**Verification at session end:**
- `yarn jest packages/core/src/modules/customer_accounts/lib/__tests__/` — 4 suites, 26 tests passing.
- `yarn workspace @open-mercato/core run -T tsc --noEmit` — no errors in any file I touched (pre-existing `sales_return` errors are unrelated, in `packages/core/src/modules/sales/`).

**Files created:**
- `packages/core/src/modules/customer_accounts/lib/hostname.ts`
- `packages/core/src/modules/customer_accounts/lib/proxyRanges.ts`
- `packages/core/src/modules/customer_accounts/lib/customerUrl.ts`
- `packages/core/src/modules/customer_accounts/lib/__tests__/hostname.test.ts`
- `packages/core/src/modules/customer_accounts/lib/__tests__/proxyRanges.test.ts`

**Files modified:**
- `packages/core/src/modules/customer_accounts/data/entities.ts` (added `Enum` import, `DomainProvider`/`DomainStatus` types, `DOMAIN_PROVIDERS`/`DOMAIN_STATUSES` consts, `DomainMapping` entity at end)
- `packages/core/src/modules/customer_accounts/data/validators.ts` (added `normalizeHostname` import, `hostnameSchema`, `registerDomainSchema`, `RegisterDomainInput`)
- `packages/core/src/modules/customer_accounts/events.ts` (added 7 domain_mapping events)
- `packages/core/src/modules/customer_accounts/acl.ts` (added `customer_accounts.domain.manage`)

**Not yet committed.** Working branch is still `fix/issue-1631-messages-send-submit-lock` — the user should `git checkout -b feat/portal-custom-domain-phase1` (or similar) and commit before continuing.

**Next session — start here:**
1. Create a new feature branch (`git checkout -b feat/portal-custom-domain-phase1`).
2. Commit the Session-1 foundation work (`feat(customer_accounts): scaffold custom domain foundation (lib + entity + validators + events + acl)`).
3. Read `services/customerUserService.ts` for service constructor / DI pattern.
4. Read `packages/create-app/template/src/modules/example/data/guards.ts` for mutation-guard structure.
5. Implement `services/domainMappingService.ts` per the spec's Service Methods table — start with the read paths (`resolveByHostname`, `resolveActiveByOrg`, `resolveAll`, `findByOrganization`) since they're simpler, then `register` / `verify` / `activate` / `remove`, then `healthCheck` (HTTPS GET with retries) and the worker query helpers (`findPendingVerification`, `findPendingTls`).
6. Add DI registration in `di.ts` after the service exists.
7. Continue per the Detailed Checklist.

### 2026-04-30 — Session 2

**Completed:**
- Read remaining reference patterns: `customerUserService.ts` (service constructor + EM injection), `customers/commands/labels.ts` (emitCrudSideEffects shape), `customer_accounts/data/enrichers.ts` (existing enrichers in this file), `mutation-guard-store.ts` + `mutation-guard-registry.ts` (guard contract), `packages/cache/src/types.ts` (CacheService interface), example-template `guards.ts` (guard skeleton).
- **Phase 1 — domainMappingService**: Implemented full service at `services/domainMappingService.ts` with all 11 spec methods. Service is DI-injectable: takes `EntityManager` plus optional `cacheService`/`dnsResolver`/`healthCheck` deps so unit tests can stub DNS and TLS without real network. DNS verification implements the full CNAME → A-record → reverse-resolve fallback chain from the spec, including proxy detection via `lib/proxyRanges.ts` and a per-call HTTPS probe to verify the request actually reaches our origin (via the `X-Open-Mercato-Origin` header). `healthCheck` retries 3× with exponential backoff (1s/4s/16s) before transitioning to `tls_failed`. Cache uses tag-based invalidation (`domain_routing`, `domain_routing:{hostname}`, `domain_routing:org:{orgId}`) for resolve-by-hostname and active-by-org keys. **Spec deviation noted**: did not use `emitCrudSideEffects` because that helper only fires standard CRUD events (`created`/`updated`/`deleted`) and would conflate the 7 lifecycle events the spec defines; emitting via `emitCustomerAccountsEvent` directly is cleaner. Search indexing is opted out anyway (per rev 5 design decision 27). Also dropped `tenantSlug` from the resolve response — the `Tenant` entity has no slug column today, only a `name`. Middleware only needs `orgSlug` for the URL rewrite. Updated the spec's API contracts for this in a follow-up edit (deferred to next session — see "Next session" below).
- **Phase 1 — DI registration**: Registered `domainMappingService` in `customer_accounts/di.ts` as a scoped service (matches other customer_accounts services).
- **Phase 1 — Mutation guards**: Created `data/guards.ts` with the 3 guards from the spec. `hostname-format` writes the normalized canonical form back via `modifiedPayload` so the service receives the canonical input even if the route handler skipped normalization. `hostname-unique` uses the service's `resolveByHostname` to detect cross-tenant collisions. `org-limit` uses `findByOrganization` to enforce the max 2 domains per org rule.
- **Phase 1 — Response enrichers**: Extended `data/enrichers.ts` with `customer_accounts.domain-status:directory:organization`. Uses `enrichMany` with a batch `$in` query (no N+1) and a status-priority sort to pick the primary domain per org for display.

**Verification at session end:**
- `yarn workspace @open-mercato/core run -T tsc --noEmit` — no errors in any file I touched (pre-existing `sales_return` errors persist, unrelated).
- `yarn jest customer_accounts/lib/__tests__/` — 26 tests still passing (no regressions).

**Files created (2):**
- `packages/core/src/modules/customer_accounts/services/domainMappingService.ts`
- `packages/core/src/modules/customer_accounts/data/guards.ts`

**Files modified (2):**
- `packages/core/src/modules/customer_accounts/di.ts` (registered `domainMappingService`)
- `packages/core/src/modules/customer_accounts/data/enrichers.ts` (added `organizationCustomDomainEnricher`)

**Spec discrepancies discovered (not yet patched in spec):**
1. The spec's `domain-resolve` API contract returns a `tenantSlug` field, but the `Tenant` entity in `directory/data/entities.ts` has no `slug` column. The middleware doesn't actually need it. **Recommend**: drop `tenantSlug` from the `domain-resolve` response in the spec when working on the API routes next session.
2. The spec recommends `emitCrudSideEffects` for write methods, but that helper handles only standard CRUD actions. Direct `emitCustomerAccountsEvent` calls produce the spec's intended events without artificial mapping. Worth a one-line note in the spec when next touched.

**Next session — start here:**
1. Read `packages/core/src/modules/customer_accounts/notifications.ts` and `notifications.client.ts` (full file) plus an existing notification subscriber (e.g., `subscribers/notify-staff-on-signup.ts` — name approximate, search) for the persistent-subscriber pattern.
2. Read at least one existing CRUD admin route using `makeCrudRoute` for the API route pattern. The customers module's `api/people/route.ts` is the canonical reference per `customers/AGENTS.md`.
3. Add the 4 notification types to `notifications.ts` and renderers to `notifications.client.ts`.
4. Build the 5 subscribers (`invalidate-domain-cache.ts` + 4 lifecycle notifications).
5. Build the 6 API routes (CRUD via `makeCrudRoute`, `verify`, `health-check`, `domain-check`, `domain-resolve`, `domain-resolve/all`). Remember to **omit the `indexer` field** on the CRUD route (rev 5 fix).
6. Add i18n keys to `i18n/en.json` (and stubs in pl/de/es).
7. Run `yarn db:generate` (creates the migration) and `yarn generate` (refreshes generated registries).
8. Hand off Phase 1.5 (`resolveTenantContext` + `getCustomerAuthFromCookies` host binding + signup email migration + login schema relaxation) to a fresh session if context is full.
