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
| Phase 1: domainMappingService | Not Started | full service with all methods — start here next session |
| Phase 1: DI registration | Not Started | one-line registration in di.ts (depends on service) |
| Phase 1: Mutation guards | Not Started | hostname-format, hostname-unique, org-limit |
| Phase 1: Response enrichers | Not Started | directory:organization enricher |
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

- [ ] Create `services/domainMappingService.ts` with:
  - [ ] Constructor: takes EM, eventBus, cacheService via DI
  - [ ] `register(hostname, orgId, tenantId, replacesId?)` — creates entity, runs guards, emits `created`
  - [ ] `verify(id)` — DNS verification (CNAME → A → reverse-resolve fallback chain), updates status, emits `verified` or `dns_failed`
  - [ ] `activate(id)` — `verified` → `active`, handles replaces_domain_id auto-removal
  - [ ] `remove(id)` — emits `deleted`, invalidates cache
  - [ ] `resolveByHostname(hostname)` — reads cache then DB
  - [ ] `resolveActiveByOrg(orgId)` — used by `urlForCustomerOrg`
  - [ ] `resolveAll()` — for middleware batch warm-up
  - [ ] `healthCheck(id)` — HTTPS GET to verify TLS, retries with backoff, emits `activated` or `tls_failed`
  - [ ] `findPendingVerification()` — for DNS worker
  - [ ] `findPendingTls()` — for TLS retry worker
- [ ] All write methods call `emitCrudSideEffects` for events + cache invalidation

### Phase 1: DI registration

- [ ] Register `domainMappingService` in `di.ts`

### Phase 1: Mutation guards

- [ ] Create `data/guards.ts`:
  - [ ] `customer_accounts.domain_mapping.hostname-format` (priority 10)
  - [ ] `customer_accounts.domain_mapping.hostname-unique` (priority 20)
  - [ ] `customer_accounts.domain_mapping.org-limit` (priority 30)

### Phase 1: Response enrichers

- [ ] Update `data/enrichers.ts` to add `customer_accounts.domain-status:directory:organization` enricher
  - [ ] Uses `enrichMany()` with batch `$in` query
  - [ ] Feature-gated by `customer_accounts.domain.manage`
  - [ ] Returns `{ _customDomain: { hostname, status } | null }`
  - [ ] Timeout: 1000ms, critical: false

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
