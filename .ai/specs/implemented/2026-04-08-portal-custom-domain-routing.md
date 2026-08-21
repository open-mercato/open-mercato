# Portal Custom Domain Routing

| Field | Value |
|-------|-------|
| **Status** | Draft (rev 5) |
| **Created** | 2026-04-08 |
| **Last revision** | 2026-04-30 |
| **Builds on** | `packages/core/src/modules/customer_accounts` (portal auth & identity), `packages/core/src/modules/portal` (portal frontend), `packages/core/src/modules/directory` (Tenant/Organization entities) |
| **Related** | `packages/enterprise/src/modules/sso/lib/domains.ts` (domain validation patterns) |

## TLDR

**Key Points:**
- Allow each organization to map a custom domain (e.g., `shop.acme.com`) to their customer-facing portal, replacing the default `/{orgSlug}/portal` URL path.
- A new Next.js **Node** Middleware (`middleware.ts`, `runtime: 'nodejs'`, requires Next.js ≥ 15.2) resolves both tenant and organization by `Host` header via a `DomainMapping` lookup, rewrites requests to the internal portal route, and keeps the branded URL visible to end customers.
- The `DomainMapping` entity lives in the `customer_accounts` module alongside existing portal auth and identity infrastructure.
- Traefik is introduced as the reverse proxy with on-demand Let's Encrypt TLS certificate provisioning, gated by an application verification endpoint.

**Scope:**
- `DomainMapping` entity in `customer_accounts` module with hostname (normalized + Punycode), tenant/org references, status lifecycle, provider, and DNS diagnostics
- Next.js **Node** Middleware (`apps/mercato/src/middleware.ts`, `runtime: 'nodejs'`, Next.js ≥ 15.2) with stale-while-revalidate cache and batch warm-up for host resolution
- Back office settings page with guided stepper wizard, auto-polling DNS verification, DNS diagnostics, multi-org switcher, and domain swap flow
- DNS verification flow with **CNAME-first, then A-record fallback, then reverse-resolve over HTTPS** (handles apex domains and Cloudflare-proxied DNS), with diagnostic error reporting and background auto-verification worker
- Hostname normalization (lowercase, trailing-dot trim, IDN → Punycode, 253-char limit) at validator and service layer
- Per-domain host-only customer cookies — login on `shop.acme.com` is independent from login on the platform domain
- Traefik docker-compose configuration with ACME/Let's Encrypt on-demand TLS
- Verification endpoint (`GET /api/customer-accounts/domain-check`) for Traefik certificate gating
- Batch resolve endpoint (`GET /api/customer-accounts/domain-resolve/all`) for cache warm-up
- Domain status lifecycle: `pending` → `verified` → `active`, with two distinct failure states: `dns_failed` and `tls_failed`
- Zero-downtime domain swap flow (register replacement while old domain remains active)
- Automatic TLS provisioning trigger after DNS verification (no manual "first HTTPS visit" required)
- Canonical URLs and customer-portal transactional emails honor the active custom domain when present
- `DomainMapping` excluded from search indexing (no cross-tenant hostname leak)

**Deferred:**
- Cloudflare for SaaS integration (future `provider: 'cloudflare'`)
- Custom domain for the back office panel
- Automatic subdomain provisioning (e.g., `acme.openmercato.com`)
- Shared external cache layer (Redis/SQLite for multi-instance edge cache coherence) — in-memory stale-while-revalidate is sufficient for initial deployment; shared cache becomes necessary only at 10,000+ domains across 10+ instances

**Concerns:**
- Introducing `middleware.ts` is a new architectural pattern — no prior art in the codebase. Must be minimal and non-blocking for platform-domain traffic. Pinned to `runtime: 'nodejs'` (requires Next.js ≥ 15.2). Edge runtime is rejected — V8 isolates do not share module state reliably across cold starts, which would break the SWR cache + batch warm-up design.
- The repo currently has no reverse proxy configuration. Traefik addition is new infrastructure.
- Node Middleware still has no MikroORM/DI container access at the request hot path; domain cache is populated via internal fetch to a secret-protected endpoint.
- Multi-instance deployments: each Next.js process has its own in-memory cache. Batch warm-up on startup and stale-while-revalidate mitigate thundering herd, but cache coherence is eventual (within TTL window).
- The `domain-resolve` and `domain-check` endpoints are unauthenticated hot paths — mandatory shared secrets and negative caching are required to prevent abuse.
- Customer portal authentication is **per-domain (host-only cookies)** — a customer logged in on `openmercato.com` is not automatically logged in on `shop.acme.com`. Cross-domain SSO is intentionally out of scope.
- Cloudflare orange-cloud and other DNS proxies hide the CNAME/A target from us; verification must fall back to reverse-resolve over HTTPS.
- IDN/Punycode normalization is mandatory: `Shop.Café.com` and `xn--shop-caf-jeb.com` and `shop.café.com` must collide on a single canonical row.

## Overview

Multi-tenant SaaS platforms that serve customer-facing storefronts need to support vanity domains. Without this, tenants are stuck presenting a generic platform URL (`openmercato.com/my-org/portal`) to their end customers, which undermines brand trust, SEO, and professional appearance.

This feature introduces a complete custom domain lifecycle — from registration and DNS verification through TLS provisioning and runtime request routing — entirely managed through the existing back office, with zero separate deployments per tenant.

### Market Reference

**Studied:** Shopify Custom Domains, Vercel Domains API, Caddy on-demand TLS

**Adopted:**
- CNAME-based verification (Shopify, Vercel) — simple, well-understood by non-technical users
- On-demand TLS certificate provisioning with application-level gating (Caddy pattern, adapted to Traefik)
- Host-header middleware rewriting (Vercel multi-tenant pattern)
- Single lookup table for domain → tenant + org resolution (Shopify)

**Rejected:**
- TXT record verification — more complex for tenants, unnecessary when CNAME already proves ownership
- Wildcard certificates — doesn't scale to unique tenant domains
- DNS-01 ACME challenge — requires DNS API integration per registrar; TLS-ALPN-01 is simpler with Traefik
- Per-domain Traefik router config — would require Traefik restart; on-demand TLS avoids this entirely

## Problem Statement

Currently, every tenant's customer portal is served under the platform's shared domain using a slug-based URL pattern (`openmercato.com/{orgSlug}/portal`):

1. **No branded URLs**: Tenants cannot present their own domain to customers. The platform domain is always visible, undermining trust and brand perception.
2. **SEO leakage**: All search value flows to the platform's domain rather than the tenant's own domain.
3. **No domain management**: There is no mechanism to register, verify, or manage custom domains at the tenant level. Tenants who want branded URLs have no self-service path.
4. **No TLS automation**: Even if DNS were configured manually, there is no automated certificate provisioning or renewal for custom domains.
5. **Competitive gap**: SaaS platforms that offer vanity domains out of the box have a significant advantage over platforms that don't.

This creates friction for **tenants** (who want a white-labeled storefront), **end customers** (who expect a recognizable domain), and **platform operators** (who lose a differentiator).

## Proposed Solution

Introduce a `DomainMapping` entity in the `customer_accounts` module and a Next.js **Node** Middleware that performs host-header-based resolution to serve the portal under a tenant's custom domain.

### Design Decisions

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| 1 | Request interception layer | **Next.js Node Middleware** (`middleware.ts`, `runtime: 'nodejs'`) | Runs before the catch-all router, can rewrite URLs transparently. Standard Next.js pattern for host-based multi-tenancy. The codebase has no `middleware.ts` yet — this is the first use. Edge runtime explicitly rejected (see row 21). |
| 2 | Module placement | **`customer_accounts`** module | Portal auth, identity, and customer RBAC already live here. Domain routing is portal infrastructure. Keeps portal logic centralized. |
| 3 | Custom domain path scope | **Domain IS the portal** — all non-internal paths rewrite to portal | `shop.acme.com/products` → `/{orgSlug}/portal/products`. No `/portal` prefix on the branded domain. `/api/*` and `/_next/*` paths pass through without rewrite. |
| 4 | Domain cache in middleware | **Stale-while-revalidate in-memory Map** with batch warm-up | Even on the Node runtime, middleware has no DI/ORM access at the request hot path — the cache is populated via internal fetch to a secret-protected endpoint. Module-scoped Map persists across requests inside a single Node.js process. On process start, batch-fetches all active domains via `/domain-resolve/all`. Stale entries served immediately while background refresh occurs — no request blocks on a cache miss after warm-up. Negative lookups cached with longer TTL (5 min) to absorb unknown-hostname probing. |
| 5 | TLS provisioning | **Traefik on-demand TLS** with Let's Encrypt | Certificates provisioned automatically on first request. Application verification endpoint gates issuance. No Traefik restart per domain. |
| 6 | DNS verification | **CNAME check** via Node.js `dns.resolveCname()` | Tenant points domain to `portal.openmercato.com` (configurable). Server-side verification triggered manually ("Verify Now") or periodically. |
| 7 | Reverse proxy | **Concrete Traefik config** as a deliverable | Docker-compose additions, `traefik.yml`, ACME config. Not proxy-agnostic — Traefik is the specified target. |
| 8 | Internal rewrite vs. redirect | **Rewrite** (not redirect) | Browser URL stays as `shop.acme.com/products`. Server processes it as `/{orgSlug}/portal/products`. Essential for white-label experience. |
| 9 | Organization entity | **Not modified** | Domain concerns fully encapsulated in `DomainMapping`. No columns added to Organization. |
| 10 | Background DNS verification | **Worker-based auto-polling** (every 5 min for pending/failed domains) | Tenants should not need to repeatedly click "Verify Now" for up to 48 hours. A background worker checks pending domains automatically and emits `domain_mapping.verified` or `domain_mapping.failed` events, triggering real-time UI updates and email notifications. |
| 11 | Domain swap flow | **Zero-downtime replacement** — new domain registered alongside active domain | Changing a domain should not cause downtime. A new domain can be registered as a replacement (`replaces_domain_id` FK). The old domain stays active until the replacement reaches `active` status, then the old one is auto-removed. Max 2 domains per org enforced at service level. |
| 12 | Automatic TLS provisioning | **Background health check after DNS verification** | The `verified → active` transition must not depend on an end customer visiting the domain. After DNS verification, the system proactively triggers a TLS health check (HTTPS request to the domain) to confirm Traefik has provisioned the certificate, then transitions to `active`. |
| 13 | CRUD API for DomainMapping | **`makeCrudRoute`** for list/create/delete + custom routes for specialty endpoints | Standard CRUD operations use the factory to get enricher pipeline, interceptor pipeline, query engine integration, and consistent API shape for free. Only `verify`, `health-check`, `domain-check`, and `domain-resolve` remain as custom routes (they use `runCustomRouteAfterInterceptors()` where applicable). |
| 14 | Write operations | **Service methods with `emitCrudSideEffects`**, not formal Command pattern | Domain operations are not undoable — undo would leave dangling DNS records, orphaned TLS certificates, and stale CNAME pointers. Service methods call `emitCrudSideEffects` for consistent event emission, cache invalidation, and search indexing rather than manually emitting events. |
| 15 | Domain registration validation | **Mutation Guards** (`data/guards.ts`) for extensible validation | Hostname uniqueness, org domain limit, and hostname format checks are declared as mutation guards in the guard registry. This allows enterprise modules to add their own validation (e.g., domain allowlists, approval workflows) without modifying the core service. Internal invariants (status transitions) remain in the service. |
| 16 | Server-side caching | **Two-tier cache**: `@open-mercato/cache` (server-side, shared) + in-memory Map (middleware, per-process) | The `domain-resolve` and `domain-check` API endpoints use `@open-mercato/cache` with tag-based invalidation for server-side caching. Domain lifecycle events trigger cache invalidation via an ephemeral subscriber. The Node Middleware uses its own in-memory stale-while-revalidate cache on top (since middleware has no DI access at request time). This prevents DB queries on the hot path. |
| 17 | Organization domain visibility | **Response enricher** on Organization entity | A response enricher decorates Organization API responses with `_customDomain: { hostname, status }` so the org list/detail pages can show domain status without a separate API call. Other modules can consume this enriched data. |
| 18 | Settings sidebar navigation | **Widget injection** via `menu:sidebar:settings` spot | Navigation link uses the standard injection-table + widget pattern with `features: ['customer_accounts.domain.manage']` gating. Not a manual link addition. |
| 19 | Notification definitions | **`notifications.ts` + persistent subscribers** following platform pattern | Notification types declared as `NotificationTypeDefinition[]`. Persistent subscribers per lifecycle event use `buildFeatureNotificationFromType` + `notificationService.createForFeature()`. Client renderers in `notifications.client.ts`. |
| 20 | Customer cookie scope | **Host-only per-domain cookies** | Login form on `shop.acme.com` posts to `shop.acme.com/api/customer-accounts/customer/login`; the session cookie is set without a `Domain=` attribute, so it is host-only. A customer logged in on `openmercato.com` does **not** carry that session to `shop.acme.com`, and vice versa. JWT validates against the host-resolved org context. Cross-domain SSO is intentionally out of scope. |
| 21 | Middleware runtime | **Next.js Node Middleware (`runtime: 'nodejs'`)** on Next.js ≥ 15.2 | Edge runtime explicitly rejected: V8 isolates don't reliably share module state across cold starts, which breaks the SWR + batch warm-up cache. Node Middleware preserves module-scoped Map state across requests inside a single process while still running before the catch-all router. |
| 22 | Apex domain support | **A record target alongside CNAME** | Apex domains (e.g., `acme.com`) cannot legally have a CNAME (RFC 1034). Tenants point an A record at `CUSTOM_DOMAIN_A_RECORD_TARGET`. Subdomains continue to use CNAME → `CUSTOM_DOMAIN_CNAME_TARGET`. Verification tries CNAME first, then falls back to A record, then to reverse-resolve over HTTPS. Both subdomain and apex configurations are first-class. |
| 23 | Proxied DNS detection | **Reverse-resolve over HTTPS** when target is a known proxy IP range | When the resolved A record falls inside a well-known proxy IP range (Cloudflare, Fastly), DNS verification cannot directly confirm the target. Instead, the verifier issues an HTTPS request to the candidate hostname and asserts that the response originates from our infrastructure (custom response header `X-Open-Mercato-Origin: 1`). This is the same trust model as CNAME — the domain owner must explicitly proxy traffic to us. |
| 24 | Hostname normalization | **Lowercase + trailing-dot strip + IDN → Punycode + 253-char cap** | Applied at the validator (`hostnameSchema`) so the entity stores a single canonical form. Prevents UNIQUE-constraint bypass via case (`Shop.Acme.com`) or IDN (`shop.café.com` ↔ `xn--shop-caf-jeb.com`). All lookups (resolve, check, verify) normalize input identically before comparison. |
| 25 | Status enum split | **`failed` → `dns_failed` + new `tls_failed`** | A single `failed` state conflated two very different problems with different fixes. `dns_failed` means the customer needs to fix their DNS provider; `tls_failed` means Let's Encrypt or Traefik couldn't issue a cert (different remediation, different copy, different retry path). UI surfaces the difference. Both can recover back to `pending` (re-verify) or `verified` (re-attempt TLS). |
| 26 | Multi-org tenants | **Org switcher inside the settings page** (option b) | Settings route stays at `/backend/customer_accounts/settings/domain` (single canonical entry point). When the staff user has access to multiple organizations within the tenant, the page header renders an org dropdown — selecting an org swaps the loaded `DomainMapping` and the page re-fetches. Single-org tenants render no switcher. Avoids URL fragmentation; mirrors how other org-scoped settings pages already behave. |
| 27 | Search indexing | **`DomainMapping` excluded from search index** by **omitting the `indexer` field** on `makeCrudRoute` | Hostnames are tenant-private. Indexing them in the platform-wide search would risk cross-tenant disclosure. Verified against `packages/shared/src/lib/crud/factory.ts:424` — `indexer?: CrudIndexerConfig<any>` is optional, so the correct opt-out is to simply not pass the field. The route exists for CRUD only; query-engine integration is intentionally skipped. |
| 28 | Canonical URL & email domains | **`Host`-aware** | Portal pages emit `<link rel="canonical">` from the request `Host` header, not the rewritten internal path. Customer-portal transactional emails (magic link, password reset, in-app notifications that link out) call `domainMappingService.resolveActiveByOrg(orgId)` and use the active custom domain when one exists, else the platform domain. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Resolve domain in catch-all layout instead of middleware | Mixes routing concerns with rendering. Cannot rewrite URL before route matching. Would require significant refactoring of the layout to handle both slug-based and domain-based resolution in a single code path. |
| Standalone `domain_mappings` module | Over-separation for a feature tightly coupled to portal identity. Would require cross-module event wiring for something that's fundamentally a portal concern. |
| `@open-mercato/cache` package directly inside the middleware | DI is not exposed at the middleware request hot path even on the Node runtime — wiring DI into middleware would couple boot order and increase blast radius. Instead, `@open-mercato/cache` is used server-side (Tier 1) for the `domain-resolve` and `domain-check` API endpoints. The Node Middleware in-memory Map (Tier 2) sits on top and calls those cached endpoints. This two-tier approach keeps the middleware narrow while benefiting from shared server-side cache with tag-based invalidation. |
| Caddy instead of Traefik | Traefik has stronger Docker-native integration and is more common in the Next.js ecosystem. Caddy's on-demand TLS is excellent but would be a less familiar choice for contributors. |
| Formal Command pattern (`registerCommand`) for domain mutations | Domain operations are not undoable — undo would leave dangling DNS records, orphaned TLS certificates, and stale CNAME pointers that the platform cannot clean up. The `customers` module uses Commands because person/company CRUD is safely reversible. Domain lifecycle has external side effects that make undo semantically wrong. Service methods with `emitCrudSideEffects` provide consistent event emission and cache invalidation without the undo machinery. |
| Custom routes for all DomainMapping API endpoints | Custom routes bypass the CRUD factory's enricher pipeline, interceptor pipeline, and query engine integration. Standard list/create/delete operations should use `makeCrudRoute` to get these integrations for free and maintain consistent API shape. Only specialty endpoints (verify, health-check, domain-check, domain-resolve) need custom routes. |
| Manual service-level validation only (no mutation guards) | Keeping all validation in the service prevents other modules from adding domain validation rules (e.g., enterprise domain allowlists). Mutation guards provide an extensible, priority-ordered validation pipeline via the guard registry. |

## User Stories

| # | As a... | I want to... | So that... |
|---|---------|--------------|------------|
| 1 | Tenant Admin | register my own domain (e.g., `shop.acme.com`) in the back office settings | my customers see a branded URL instead of the platform's generic path |
| 2 | Tenant Admin | follow a guided step-by-step wizard to configure my domain | I can complete setup without DNS expertise or contacting platform support |
| 3 | Tenant Admin | see exactly what DNS record to add, with links to instructions for my DNS provider | I don't need to guess how to configure CNAME records in GoDaddy, Cloudflare, etc. |
| 4 | Tenant Admin | have the system automatically check my DNS and notify me when verification succeeds | I don't need to keep coming back and clicking "Verify Now" for 48 hours |
| 5 | Tenant Admin | see a clear explanation of what's wrong when DNS verification fails (wrong target, no record found, etc.) | I can self-diagnose and fix the issue without support |
| 6 | Tenant Admin | change my custom domain without downtime for existing customers | I can rebrand safely — old domain stays live until the new one is ready |
| 7 | Tenant Admin | preview/test that my domain works before it goes live to customers | I can verify the setup is correct before advertising the new URL |
| 8 | Tenant Admin | remove my custom domain | I can decommission a domain I no longer need |
| 9 | End Customer | visit `shop.acme.com` and see a fully working portal with HTTPS | I trust the site and have a seamless shopping experience |
| 10 | Platform Operator | have the system automatically provision and renew TLS certificates | I don't need to manually manage SSL for every tenant domain |
| 11 | Platform Operator | validate that a requested hostname is legitimate before issuing a certificate | the platform is protected against domain abuse and certificate flooding |
| 12 | Platform Operator | have the domain resolution cache warm up automatically on process start | a deploy or restart does not cause a thundering herd of resolve requests |

## Architecture

### Request Flow: Custom Domain

```
Browser → shop.acme.com/products
    ↓
DNS: CNAME → portal.openmercato.com → Server IP
    ↓
Traefik: TLS termination (Let's Encrypt cert)
    ↓
Next.js Node Middleware (middleware.ts, runtime: 'nodejs', Next.js ≥ 15.2)
  1. Read Host header: "shop.acme.com"
  2. Normalize via normalizeHostname (lowercase, trailing-dot trim, IDN → Punycode)
  3. Check: not a platform domain → custom domain path
  4. Lookup in-memory cache: hostname → { orgSlug, tenantId, organizationId, status, expiresAt }
  5. Cache hit (fresh or stale)? → use cached data immediately
     5a. If stale (past TTL but present): trigger background async refresh (non-blocking)
     5b. If cold miss (not in cache at all, e.g. after warm-up): fetch synchronously (fallback)
  6. Status is "active"? → rewrite URL to /acme/portal/products
  7. Set x-custom-domain request header (forwarded to API/page handlers via NextResponse.rewrite + request init)
  8. NextResponse.rewrite() → internal route
    ↓
Catch-all layout: /app/(frontend)/[...slug]/layout.tsx
  1. Extract orgSlug from rewritten path: "acme"
  2. Resolve Organization by slug (existing flow)
  3. Render PortalLayoutShell (existing flow)
    ↓
Page renders with branded portal. Browser URL remains: shop.acme.com/products
```

### Request Flow: Platform Domain (unchanged)

```
Browser → openmercato.com/my-org/portal/products
    ↓
Next.js Node Middleware (runtime: 'nodejs')
  1. Read Host header: "openmercato.com"
  2. Check: IS a platform domain → NextResponse.next() (pass through)
    ↓
Existing catch-all layout + page routing (no changes)
```

### Request Flow: API Calls on Custom Domain

```
Browser (on shop.acme.com, host-only session cookie) → fetch("/api/portal/orders")
    ↓
Next.js Node Middleware
  1. Read Host header: "shop.acme.com"
  2. Path starts with /api/ → pass through (no rewrite)
    ↓
API catch-all: /app/api/[...slug]/route.ts
  1. Resolves tenant + org by Host header (via domainMappingService.resolveByHostname)
  2. Calls getCustomerAuthForHost(req) which:
     - Reads customer_auth_token cookie → decodes JWT
     - Reads customer_session_token cookie → asserts session still active in DB
     - Asserts JWT.tenantId === resolvedTenantId (defends against cookie replay across hosts)
  3. Loads customer scoped to that tenant; serves response
```

**Note**: Custom-domain API routes do NOT rely on the JWT alone for tenant context — the host-resolved org is the source of truth. The JWT serves only as the authenticated principal. This is what makes per-domain cookies safe.

### Canonical URLs and Customer-Email Domains

Two consequences of "domain IS the portal" must be wired explicitly, otherwise SEO and customer trust quietly degrade.

**Canonical URLs:**

The portal currently emits `<link rel="canonical">` based on a server-known base URL. Once the user is on `shop.acme.com/products`, the canonical must be `https://shop.acme.com/products`, **not** `https://openmercato.com/acme/portal/products`. The catch-all layout reads `request.headers.get('host')` and uses that as the canonical authority, ignoring the rewritten internal pathname.

```typescript
// packages/core/src/modules/portal/components/PortalCanonical.tsx
const host = headers().get('host')!  // e.g. "shop.acme.com" or "openmercato.com"
const customDomainPath = host === platformHost
  ? request.nextUrl.pathname                            // include /{orgSlug}/portal prefix
  : stripOrgPortalPrefix(request.nextUrl.pathname)      // strip the rewritten prefix
return <link rel="canonical" href={`https://${host}${customDomainPath}`} />
```

**Customer-portal email links:**

All customer-facing email links must be built via a single helper rather than hard-coding the platform host:

```typescript
// packages/core/src/modules/customer_accounts/lib/customerUrl.ts
export async function urlForCustomerOrg(orgId: string, path: string): Promise<string> {
  const active = await domainMappingService.resolveActiveByOrg(orgId)
  if (active) {
    return `https://${active.hostname}${path}`
  }
  const org = await orgService.findById(orgId)
  return `${PLATFORM_PORTAL_BASE_URL}/${org.slug}/portal${path}`
}
```

- `resolveActiveByOrg(orgId)` is a new service method: returns the single `DomainMapping` for the org with status `active` (or null). Cached identically to `resolveByHostname`.
- During domain swap, the old domain remains `active` until the replacement reaches `active`. Emails generated mid-swap use the still-live old domain, which is correct — those links remain valid.

**Migration scope (verified against current codebase):**

The only customer-portal call site that currently sends email is `customer_accounts/api/signup.ts` (two `sendEmail` calls — signup confirmation and portal welcome). This spec migrates **just those two call sites** to `urlForCustomerOrg`. There is no existing magic-link email, password-reset email, or notification-digest email to migrate.

**Forward-looking rule** (added to `customer_accounts/AGENTS.md`): any new customer-portal email-sending route (magic link, password reset, in-app notification digest, etc.) MUST construct customer-facing URLs via `urlForCustomerOrg` and MUST NOT hard-code `PLATFORM_PORTAL_BASE_URL`. A unit test under `customer_accounts/__tests__/customerUrl.test.ts` asserts that templates in `customer_accounts/emails/` (when added in future work) don't reference the platform host directly.

### Hostname Normalization

Every input hostname (registration, lookup, verification, middleware Host header) is normalized through a single function before any storage or comparison. This is non-negotiable — the UNIQUE constraint on `hostname` is meaningless without it.

```typescript
// packages/core/src/modules/customer_accounts/lib/hostname.ts
import { toASCII } from 'punycode'  // Node built-in (or 'tr46' for stricter UTS#46)

export function normalizeHostname(input: string): string {
  if (!input) throw new Error('Empty hostname')
  let host = input.trim().toLowerCase()
  // Strip protocol and path defensively (validators reject these earlier, but be safe)
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
  // Strip trailing dot (DNS root marker)
  if (host.endsWith('.')) host = host.slice(0, -1)
  // Convert IDN (Unicode) to Punycode (ASCII)
  host = toASCII(host)
  // DNS-spec total length cap
  if (host.length === 0 || host.length > 253) {
    throw new Error('Hostname must be between 1 and 253 characters after normalization')
  }
  return host
}
```

**Effect on uniqueness:**

| Input | Stored hostname |
|-------|-----------------|
| `Shop.Acme.com` | `shop.acme.com` |
| `shop.acme.com.` | `shop.acme.com` |
| `https://shop.acme.com/path` | `shop.acme.com` |
| `shop.café.com` | `xn--shop-caf-jeb.com` |
| `xn--shop-caf-jeb.com` | `xn--shop-caf-jeb.com` |

The last two map to the same row — registering `shop.café.com` after a competitor already registered `xn--shop-caf-jeb.com` (or vice versa) returns `409 Hostname already claimed`.

**Where it runs:**

- `data/validators.ts` — `hostnameSchema` invokes `normalizeHostname` via `z.string().transform(normalizeHostname)`. Throws → 400.
- `data/guards.ts` — `hostname-format` guard re-asserts post-normalization shape (regex on ASCII form).
- `domainMappingService.register(hostname, ...)` — receives already-normalized input.
- `domainMappingService.resolveByHostname(hostname)` — normalizes incoming Host header before cache lookup.
- `middleware.ts` — normalizes `request.headers.get('host')` before consulting the SWR cache.
- `domain-check` and `domain-resolve` API endpoints — normalize the `host` query param.

### DNS Verification Algorithm

Verification supports both subdomains (CNAME) and apex domains (A record), and tolerates proxied DNS (Cloudflare orange-cloud, Fastly, etc.). The verifier runs in three phases:

```
domainMappingService.verify(id):

  hostname = normalize(record.hostname)   // already canonical, but defensive

  ── Phase 1: CNAME ──
  cnames = await dns.resolveCname(hostname)
  if cnames.length > 0:
    expected = process.env.CUSTOM_DOMAIN_CNAME_TARGET
    if cnames.some(c => normalize(c) === normalize(expected)):
      return success({ method: 'cname', detected: cnames })
    else:
      return failure('cname-wrong-target', detectedRecords: cnames)

  ── Phase 2: A record ──
  aRecords = await dns.resolve4(hostname)
  if aRecords.length === 0:
    return failure('no-record', detectedRecords: [])

  expectedA = process.env.CUSTOM_DOMAIN_A_RECORD_TARGET
  if aRecords.includes(expectedA):
    return success({ method: 'a-record', detected: aRecords })

  ── Phase 3: Reverse-resolve (proxied DNS fallback) ──
  proxyMatches = aRecords.filter(ip => isInKnownProxyRange(ip))
  if proxyMatches.length > 0:
    // Domain is behind a proxy. Confirm traffic actually reaches us.
    try:
      response = await httpsGet(`https://${hostname}/api/customer-accounts/domain-check`,
                                { headers: { 'X-Domain-Check-Secret': SECRET },
                                  timeout: 5000 })
      if response.headers['x-open-mercato-origin'] === '1':
        return success({ method: 'reverse-resolve', detected: aRecords, proxy: detectProxy(aRecords[0]) })
    catch (err):
      pass  // fall through to failure

    return failure('proxy-reverse-resolve-failed', detectedRecords: aRecords)

  return failure('a-record-wrong-target', detectedRecords: aRecords)
```

**Known proxy ranges** (`KNOWN_PROXY_IP_RANGES` env var, comma-separated CIDR list, default includes Cloudflare's published list):

```
173.245.48.0/20, 103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22,
141.101.64.0/18, 108.162.192.0/18, 190.93.240.0/20, 188.114.96.0/20,
197.234.240.0/22, 198.41.128.0/17, 162.158.0.0/15, 104.16.0.0/13,
104.24.0.0/14, 172.64.0.0/13, 131.0.72.0/22
```

Operators can extend with custom CIDR ranges (e.g., own internal proxies).

**`X-Open-Mercato-Origin: 1`** is set by a Next.js custom header on `/api/customer-accounts/domain-check` and `/_next/health` endpoints to identify our origin through any proxy chain. It is **not** a security control — the secret header is. It's purely a "did the proxy actually forward to us?" signal.

### Traefik On-Demand TLS Flow

```
First HTTPS request to shop.acme.com
    ↓
Traefik: no cert cached for this hostname
    ↓
Traefik calls: GET http://app:3000/api/customer-accounts/domain-check?host=shop.acme.com
    ↓
App: Query DomainMapping by hostname
  - Found with status "verified" or "active" → 200 OK
  - Not found or status "pending"/"dns_failed"/"tls_failed" → 404
    ↓
200 OK → Traefik requests Let's Encrypt cert via TLS-ALPN-01 challenge
    ↓
Cert issued → stored in acme.json → serves TLS
    ↓
Subsequent requests: Traefik uses cached cert (renews automatically before expiry)
```

### Cache Architecture (Two-Tier)

**Tier 1 — Server-Side (`@open-mercato/cache`)**

```
Shared cache layer (Redis in production, memory in dev)
  Key pattern: domain_routing:resolve:{hostname}
  Tags: ['domain_routing', 'domain_routing:{hostname}']
  TTL: 300 seconds
  Invalidation: Event-driven via ephemeral subscriber on customer_accounts.domain_mapping.* events
  Scope: Shared across all app instances (Redis strategy)
  Used by: domain-resolve, domain-check API endpoints (server-side, has DI access)
```

**Tier 2 — Middleware In-Memory (Node Runtime, per-process)**

```
Per-process in-memory cache (Map<string, CacheEntry>)
  Key: hostname (e.g., "shop.acme.com")
  Value: { tenantId, tenantSlug, organizationId, orgSlug, status, expiresAt, isNegative }
  Positive TTL: 60 seconds (configurable via DOMAIN_CACHE_TTL_SECONDS)
  Negative TTL: 300 seconds (configurable via DOMAIN_NEGATIVE_CACHE_TTL_SECONDS)
  Max entries: 10,000 (configurable via DOMAIN_CACHE_MAX_ENTRIES)

Cache Strategy: Stale-While-Revalidate
  - Fresh entry (within TTL): serve immediately, no fetch
  - Stale entry (past TTL, still in Map): serve immediately, trigger async background refresh
  - Cold miss (not in Map at all): synchronous fetch as fallback (should be rare after warm-up)
  - Negative entry (unknown hostname): cached with longer TTL (5 min) to absorb probing/attacks

Batch Warm-Up on Process Start:
  - On middleware module initialization: fetch GET /api/customer-accounts/domain-resolve/all
  - Returns all active domain mappings in a single response
  - Populates entire cache before any request is handled
  - Prevents thundering herd after deploy/restart across N instances
  - If warm-up fetch fails: middleware starts with empty cache, falls back to per-request fetch

Cache Invalidation:
  - TTL-based expiry with stale-while-revalidate — eventual consistency after domain changes
  - No active invalidation from middleware side (stateless)
  - Domain changes take effect within TTL window (60s for positive, 300s for negative)
  - Negative entries prevent repeated DB queries for unknown hostnames

Memory Budget:
  - ~300 bytes per entry × 10,000 entries = ~3MB — acceptable per process
  - LRU eviction when max entries exceeded (evicts least-recently-accessed entry)
```

### Customer Authentication on Custom Domains

Customer portal authentication is **host-scoped** — sessions on `shop.acme.com` and on `openmercato.com` are independent. This is a deliberate trade-off: it removes any cross-domain cookie complexity (no `Domain=.openmercato.com` parent cookie, no third-party cookie blocking, no cross-site OAuth handshake) at the cost of customers needing to log in once per branded URL they visit. The platform-domain portal (`openmercato.com/{orgSlug}/portal`) remains a working fallback.

**Cookies set by `customer_accounts/api/login.ts`** (applies to both platform and custom domains — verified against current source):

```
Set-Cookie: customer_auth_token=<jwt>;
            HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800   (8h)
Set-Cookie: customer_session_token=<opaque-session-id>;
            HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000 (30d)
            (no Domain attribute — host-only on whatever host login posted to)
```

`customer_auth_token` is the JWT. `customer_session_token` is an opaque server-side session ID validated via DB lookup (`assertSessionStillActive` in `customerAuthServer.ts`). Both are host-only — no `Domain=` attribute is set today, which is exactly the host-only model this spec assumes.

**Host-tenant binding defense** applies to the JWT cookie (`customer_auth_token`). The session cookie (`customer_session_token`) is opaque and additionally validated server-side, so it cannot be replayed across hosts in a meaningful way — but the same host check is applied for defense in depth.

**Login flow on a custom domain:**

```
Browser → GET shop.acme.com/login
    ↓
Middleware rewrites to /acme/portal/login
    ↓
Portal layout resolves orgSlug=acme via the rewritten path; PortalShell renders the
login form server-side. The form posts to shop.acme.com/api/customer-accounts/login
(relative). NOTE: tenantId is NO LONGER required in the request body when the
request arrives on a non-platform host — see Phase 1.5 below.
    ↓
POST shop.acme.com/api/customer-accounts/login
    ↓
Middleware: /api/* path → pass through (no rewrite)
    ↓
API handler (apps/mercato/src/app/api/[...slug]/route.ts → customer_accounts/api/login.ts):
  1. Parses body via loginSchema (tenantId now optional)
  2. If tenantId missing OR present but Host is a non-platform domain:
     a. Reads Host header: shop.acme.com
     b. Normalizes via normalizeHostname
     c. Calls domainMappingService.resolveByHostname → { tenantId, organizationId, status }
     d. Asserts status === 'active' (else 404)
     e. If body provided a different tenantId, returns 400 (mismatch — defense in depth)
  3. Validates credentials against that tenant's customers
  4. Issues JWT with { tenantId, customerId, organizationId, iss: hostname }
  5. Set-Cookie customer_auth_token + customer_session_token, host-only on shop.acme.com
    ↓
Subsequent requests on shop.acme.com carry both cookies.
getCustomerAuthFromCookies (extended in Phase 1) takes a Host argument, decodes the JWT,
asserts JWT.tenantId === resolveByHostname(host).tenantId. Mismatch → 401.
```

**Login schema relaxation (Phase 1.5):**

The current `loginSchema` in `customer_accounts/data/validators.ts` makes `tenantId` required, and `api/login.ts` returns 400 if it is missing. To support custom-domain login (where the client cannot know `tenantId`), this spec changes:

1. `loginSchema.tenantId` → optional.
2. `api/login.ts` resolution rules:
   - If Host is a platform domain (in `PLATFORM_DOMAINS`): require `tenantId` in body (current behavior preserved — backward compatible for platform-domain logins).
   - If Host is a custom domain: ignore any client-supplied `tenantId`; resolve via `domainMappingService.resolveByHostname(host)`. If the resolved status is not `active`, return 404. If body supplied a *different* `tenantId`, return 400 (mismatch).
3. The exact same logic applies to all customer auth entry points that accept a `tenantId`: `signup.ts`, `magic-link/request.ts`, `password/reset-request.ts`, `password/reset-confirm.ts`. All of them must use a shared helper `resolveTenantContext(req)` that returns either `{ source: 'body', tenantId }` or `{ source: 'host', tenantId, organizationId }`.

This is fully backward compatible for existing platform-domain clients — the body shape stays the same, `tenantId` is still accepted and used when present on a platform host.

**`getCustomerAuthFromCookies` host binding (Phase 1):**

The current helper in `customer_accounts/lib/customerAuthServer.ts` reads the JWT and validates the session in DB but does **not** verify the host. This spec extends it to:

```typescript
// signature change: optional expectedTenantId argument
export async function getCustomerAuthFromCookies(
  cookies: ReadonlyRequestCookies,
  options?: { expectedTenantId?: string },
): Promise<CustomerAuthContext | null>
```

Behavior: if `options.expectedTenantId` is set and decoded JWT's `tenantId !== expectedTenantId`, return `null` (effectively unauthenticated). All API handlers that run on custom-domain hosts MUST pass `expectedTenantId: hostResolved.tenantId`. A new convenience wrapper `getCustomerAuthForHost(req)` resolves the host first and calls the helper with the right `expectedTenantId`.

The change is backward compatible: existing callers that don't pass `expectedTenantId` see no behavior change.

**Domain swap behavior:**
- Customers actively using the old domain stay logged in on it (their cookie is host-only on the old domain).
- When the replacement reaches `active` and the old domain is auto-removed, the old cookie continues to be sent to `old.acme.com` for up to its `Max-Age`, but DNS no longer points there → request never reaches us. No security exposure.
- Customers who first visit the new domain log in fresh on the new domain.
- The settings page documents this in the swap copy: *"Customers using the previous domain will need to log in again when they switch."*

**JWT cross-host invariance:**
- The JWT contains the `tenantId` and `organizationId` it was issued against. The API handler reads the request `Host`, resolves it to a tenant/org pair, and asserts the JWT's `tenantId === resolved.tenantId`. If not, 401 — even if the cookie was somehow replayed. This makes JWT replay across hosts impossible.

**Email links:**
- All transactional customer emails (magic link, password reset, account-verified, in-app notifications that link out) are built via `urlForOrg(orgId, path)` which:
  1. Calls `domainMappingService.resolveActiveByOrg(orgId)`.
  2. If an `active` `DomainMapping` exists, uses `https://{hostname}{path}`.
  3. Else uses the platform fallback `https://{platformHost}/{orgSlug}/portal{path}`.
- During domain swap, `resolveActiveByOrg` returns the still-active old domain until the swap completes — emails generated mid-swap remain valid.

### Module Integration

The `DomainMapping` entity lives in `customer_accounts` alongside:
- Customer authentication (login/signup/magic links)
- Customer RBAC (roles, features)
- Portal settings (portal_enabled toggle)
- Customer user management

New files added to `customer_accounts`:
- `data/entities.ts` — `DomainMapping` entity class (added to existing file)
- `data/validators.ts` — domain validation schemas (added to existing file)
- `data/guards.ts` — mutation guards for domain registration validation (hostname uniqueness, org limit, format). Extensible by enterprise modules (e.g., domain allowlists).
- `data/enrichers.ts` — response enricher on `directory:organization` entity. Decorates Organization API responses with `_customDomain: { hostname, status }`.
- `services/domainMappingService.ts` — domain lifecycle service (uses `emitCrudSideEffects` for event emission and cache invalidation)
- `di.ts` — register `domainMappingService`
- `events.ts` — domain mapping events (added to existing file)
- `acl.ts` — domain management feature (added to existing file)
- `notifications.ts` — `NotificationTypeDefinition[]` for domain lifecycle events (verified, active, failed). Added to existing file.
- `notifications.client.ts` — client-side notification renderers for domain events. Added to existing file.
- `api/admin/domain-mappings.ts` — admin CRUD endpoint via `makeCrudRoute` (GET list, POST create, DELETE). Includes `enrichers: { entityId: 'customer_accounts.domain_mapping' }` for enricher pipeline.
- `api/admin/domain-mappings/[id]/verify.ts` — DNS verification trigger (custom route, uses `runCustomRouteAfterInterceptors()`)
- `api/admin/domain-mappings/[id]/health-check.ts` — TLS provisioning health check (custom route)
- `api/get/domain-check.ts` — Traefik verification endpoint (secret-protected, reads from `@open-mercato/cache`)
- `api/get/domain-resolve.ts` — middleware single-domain resolve endpoint (secret-protected, reads from `@open-mercato/cache`)
- `api/get/domain-resolve/all.ts` — middleware batch resolve endpoint for cache warm-up (secret-protected)
- `subscribers/invalidate-domain-cache.ts` — ephemeral subscriber on `customer_accounts.domain_mapping.*` events, invalidates `@open-mercato/cache` tags
- `subscribers/domain-verified-notification.ts` — persistent subscriber, sends in-app notification via `buildFeatureNotificationFromType`
- `subscribers/domain-activated-notification.ts` — persistent subscriber, sends in-app notification
- `subscribers/domain-failed-notification.ts` — persistent subscriber, sends in-app notification
- `backend/customer_accounts/settings/domain/page.tsx` — back office UI (uses `useGuardedMutation` for all writes)
- `widgets/injection-table.ts` — updated with `menu:sidebar:settings` entry for domain settings navigation
- `widgets/injection/domain-settings-menu/widget.ts` — menu item widget with `features: ['customer_accounts.domain.manage']` gating
- `workers/domainVerificationWorker.ts` — background DNS verification worker with metadata `{ queue: 'domain-verification', id: 'customer_accounts:domain-verification', concurrency: 1 }`

New file at app level:
- `apps/mercato/src/middleware.ts` — Next.js Node Middleware (`runtime: 'nodejs'`)

New infrastructure files:
- `docker/traefik/traefik.yml` — Traefik static configuration
- `docker-compose.yml` — Traefik service addition

### Commands & Events

**Events** (added to `customer_accounts/events.ts`):

| Event ID | Category | Broadcast | Payload |
|----------|----------|-----------|---------|
| `customer_accounts.domain_mapping.created` | crud | clientBroadcast | `{ id, hostname, organizationId, status }` |
| `customer_accounts.domain_mapping.verified` | lifecycle | clientBroadcast | `{ id, hostname, organizationId }` |
| `customer_accounts.domain_mapping.activated` | lifecycle | clientBroadcast | `{ id, hostname, organizationId }` |
| `customer_accounts.domain_mapping.dns_failed` | lifecycle | clientBroadcast | `{ id, hostname, organizationId, reason, detectedRecords }` |
| `customer_accounts.domain_mapping.tls_failed` | lifecycle | clientBroadcast | `{ id, hostname, organizationId, reason, retryCount }` |
| `customer_accounts.domain_mapping.deleted` | crud | clientBroadcast | `{ id, hostname, organizationId }` |
| `customer_accounts.domain_mapping.replaced` | lifecycle | clientBroadcast | `{ id, hostname, organizationId, replacedById }` |

All domain mapping events use `clientBroadcast: true` for real-time status updates in the back office UI.

**Service methods** — uses `emitCrudSideEffects` for consistent event emission, cache invalidation, and search indexing. Not the formal Command pattern (`registerCommand`) because domain operations are not undoable — undo would leave dangling DNS records, orphaned TLS certificates, and stale CNAME pointers that the platform cannot clean up. Validation that needs to be extensible by other modules (hostname uniqueness, org limit, format) is handled via mutation guards in `data/guards.ts`, not in the service.

| Method | Action | Side Effects |
|--------|--------|-------------|
| `domainMappingService.register(hostname, orgId, tenantId, replacesId?)` | Create `DomainMapping` with `status: 'pending'`. If `replacesId` is set, links as replacement for an existing active domain. Mutation guards validate hostname format, uniqueness, and org limit before creation. | `emitCrudSideEffects({ operation: 'create', entity: 'customer_accounts.domain_mapping' })` — emits `domain_mapping.created`, invalidates cache tags |
| `domainMappingService.verify(id)` | DNS lookup with CNAME → A → reverse-resolve fallback chain and diagnostic info. On success: transition to `verified`, trigger async TLS health check. On failure: transition to `dns_failed` with `dnsFailureReason` and `detectedRecords`. | `emitCrudSideEffects({ operation: 'update' })` — emits `domain_mapping.verified` or `domain_mapping.dns_failed` (with diagnostic payload), invalidates cache tags |
| `domainMappingService.activate(id)` | Transition from `verified` to `active`. If domain has `replacesDomainId`, auto-remove the replaced domain. | `emitCrudSideEffects({ operation: 'update' })` — emits `domain_mapping.activated`. If replacing: `emitCrudSideEffects({ operation: 'delete' })` for old domain + emit `domain_mapping.replaced`. |
| `domainMappingService.remove(id)` | Delete record | `emitCrudSideEffects({ operation: 'delete', entity: 'customer_accounts.domain_mapping' })` — emits `domain_mapping.deleted`, invalidates cache tags |
| `domainMappingService.resolveByHostname(hostname)` | Read-only single-domain lookup for middleware/Traefik. Reads from `@open-mercato/cache` first (key: `domain_routing:resolve:{hostname}`, tags: `['domain_routing', 'domain_routing:{hostname}']`), falls back to DB on cache miss. | None |
| `domainMappingService.resolveAll()` | Read-only batch lookup returning all active domain mappings. Used by middleware batch warm-up endpoint. | None |
| `domainMappingService.healthCheck(id)` | Makes an HTTPS request to the domain to verify TLS is working (Traefik has provisioned cert). On success: calls `activate(id)`. On failure: retries up to 3 times with exponential backoff. | `emitCrudSideEffects` via `activate(id)` on success |
| `domainMappingService.findPendingVerification()` | Returns all domains with status `pending` or `dns_failed` (with `last_dns_check_at` older than 5 min). Used by background DNS verification worker. | None |
| `domainMappingService.findPendingTls()` | Returns all domains with status `verified` (or `tls_failed` with `tls_retry_count < 3`) needing a TLS health check. Used by background TLS health-check worker. | None |

**Mutation Guards** (declared in `data/guards.ts`):

| Guard ID | Target Entity | Operations | Validation |
|----------|---------------|------------|------------|
| `customer_accounts.domain_mapping.hostname-format` | `customer_accounts.domain_mapping` | `['create']` | Validates hostname format against `hostnameSchema` (no protocol, valid TLD, min 2 labels). Priority: 10. |
| `customer_accounts.domain_mapping.hostname-unique` | `customer_accounts.domain_mapping` | `['create']` | Checks hostname is not already claimed by another org. Returns 409 on conflict. Priority: 20. |
| `customer_accounts.domain_mapping.org-limit` | `customer_accounts.domain_mapping` | `['create']` | Enforces max 2 domains per org (1 active + 1 pending replacement). Returns 409 if limit exceeded. Priority: 30. |

Guards run in priority order before `register()` executes. Enterprise modules can add additional guards (e.g., `enterprise.domain_mapping.allowlist` at priority 25) without modifying the core service.

**Response Enricher** (declared in `data/enrichers.ts`):

| Enricher ID | Target Entity | Output |
|-------------|---------------|--------|
| `customer_accounts.domain-status:directory:organization` | `directory:organization` | `{ _customDomain: { hostname, status } \| null }` |

Enriches Organization list/detail API responses. Uses `enrichMany()` with batch `$in` query to prevent N+1. Feature-gated by `customer_accounts.domain.manage`. Timeout: 1000ms, critical: false, fallback: `{ _customDomain: null }`.

**Notification Types** (added to `notifications.ts`):

| Type | Severity | Title Key | Action |
|------|----------|-----------|--------|
| `customer_accounts.domain_mapping.verified` | `success` | `domainMapping.notification.verified` | Link to `/backend/customer_accounts/settings/domain` |
| `customer_accounts.domain_mapping.activated` | `success` | `domainMapping.notification.active` | Link to `/backend/customer_accounts/settings/domain` |
| `customer_accounts.domain_mapping.dns_failed` | `warning` | `domainMapping.notification.dnsFailed` | Link to `/backend/customer_accounts/settings/domain` |
| `customer_accounts.domain_mapping.tls_failed` | `warning` | `domainMapping.notification.tlsFailed` | Link to `/backend/customer_accounts/settings/domain` |

Each notification type has a corresponding persistent subscriber (`subscribers/domain-{event}-notification.ts`) that calls `buildFeatureNotificationFromType()` with `requiredFeature: 'customer_accounts.domain.manage'` and `expiresAfterHours: 168` (7 days).

**Cache Invalidation Subscriber** (`subscribers/invalidate-domain-cache.ts`):

```typescript
export const metadata = {
  event: 'customer_accounts.domain_mapping.*',
  persistent: false,  // ephemeral — cache invalidation is best-effort
  id: 'customer_accounts:invalidate-domain-cache',
}

export default async function handle(payload, ctx) {
  const cacheService = ctx.resolve('cacheService')
  await cacheService.deleteByTags([
    `domain_routing:${payload.hostname}`,
    'domain_routing',
  ])
}
```

Invalidates server-side `@open-mercato/cache` entries on any domain lifecycle event. The Node Middleware's in-memory cache is TTL-based and not actively invalidated (eventual consistency within 60s).

## Data Models

### DomainMapping

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | Standard UUID |
| `hostname` | varchar(255) | UNIQUE index, NOT NULL | Primary lookup key. Lowercase, no protocol/path/port. e.g., `shop.acme.com` |
| `tenant_id` | uuid | FK → `tenants.id`, NOT NULL | Parent tenant. Populated at registration for single-query resolution. |
| `organization_id` | uuid | FK → `organizations.id`, NOT NULL | No UNIQUE constraint — allows up to 2 domains per org during domain swap (1 active + 1 pending replacement). Enforced at service level. |
| `replaces_domain_id` | uuid | FK → `domain_mappings.id`, NULLABLE, UNIQUE | Self-referential FK. Set when this domain is registered as a replacement for an existing active domain. UNIQUE ensures only one replacement can be pending per target domain. |
| `provider` | varchar(20) | NOT NULL, DEFAULT `'traefik'` | Enum: `traefik`. Extensible for future `cloudflare`. |
| `status` | varchar(20) | NOT NULL, DEFAULT `'pending'` | Enum: `pending` \| `verified` \| `active` \| `dns_failed` \| `tls_failed` |
| `verified_at` | timestamptz | NULLABLE | Set when DNS verification succeeds |
| `last_dns_check_at` | timestamptz | NULLABLE | Last time DNS verification was attempted (manual or background). Used by auto-verification worker to space out retries. |
| `dns_failure_reason` | varchar(500) | NULLABLE | Diagnostic message from last failed DNS check. e.g., "CNAME points to `wrong.example.com` instead of `portal.openmercato.com`", "No CNAME or A record found", "A record points to a proxy IP but reverse-resolve did not reach our server", "DNS lookup timed out". |
| `tls_failure_reason` | varchar(500) | NULLABLE | Diagnostic message from last failed TLS health check. e.g., "Certificate not yet provisioned after 3 retries", "Let's Encrypt rate limit hit", "TLS-ALPN-01 challenge failed". Distinct from `dns_failure_reason` so the UI can render both independently. |
| `tls_retry_count` | int | NOT NULL, DEFAULT 0 | Number of TLS health-check attempts since the last `verified` transition. Reset on re-verify. |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Standard lifecycle |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Standard lifecycle |

**Indexes:**
- `domain_mappings_hostname_unique` — UNIQUE on `hostname` (primary lookup)
- `domain_mappings_organization_id_idx` — INDEX on `organization_id` (org-scoped queries; no UNIQUE to allow domain swap)
- `domain_mappings_tenant_id_idx` — INDEX on `tenant_id` (tenant-scoped queries)
- `domain_mappings_replaces_domain_id_unique` — UNIQUE on `replaces_domain_id` WHERE NOT NULL (one replacement per target)
- `domain_mappings_pending_verification_idx` — INDEX on `(status, last_dns_check_at)` WHERE status IN ('pending', 'dns_failed') (background DNS verification worker query)
- `domain_mappings_pending_tls_idx` — INDEX on `(status, updated_at)` WHERE status IN ('verified', 'tls_failed') (background TLS health-check worker query)

**Status Lifecycle:**

```
                  DNS OK                       TLS health check
            (manual or background)             (auto, with retries)
   ┌─────────┐ ──────────────────► ┌──────────┐ ──────────────────► ┌────────┐
   │ pending │                     │ verified │                     │ active │
   └─────────┘ ◄────────────────── └──────────┘ ◄───────────────── └────────┘
        ▲      Retry: clears                 ▲    Retry: bumps           │
        │      dns_failure_reason            │    tls_retry_count = 0    │ Has replaces_domain_id?
        │                                    │                           │ → auto-remove replaced
        │ DNS check failed                   │ TLS health-check failed   │   (cache drains in 60s)
        │                                    │ (3 retries exhausted)     │ Emit domain_mapping.replaced
        ▼                                    ▼                           ▼
   ┌──────────────┐                  ┌──────────────┐           ┌──────────────────┐
   │ dns_failed   │                  │ tls_failed   │           │ replaced domain  │
   │ (admin fixes │                  │ (operator    │           │ deleted          │
   │  DNS)        │                  │  investigates│           └──────────────────┘
   └──────────────┘                  │  rate limit, │
                                     │  ACME challenge)
                                     └──────────────┘
```

**Transition notes:**

| From | To | Trigger | Side effects |
|------|-----|---------|--------------|
| `pending` | `verified` | DNS check succeeds (manual "Check Now" or background worker every 5 min). Calls `domainMappingService.verify()`. | `verifiedAt` set; `tls_retry_count` reset to 0; emits `customer_accounts.domain_mapping.verified`; auto-triggers `healthCheck(id)`. |
| `pending` | `dns_failed` | DNS check fails (no CNAME, no A record, wrong target, proxy reverse-resolve failed, or timeout). | `dns_failure_reason` set; `lastDnsCheckAt` set; emits `customer_accounts.domain_mapping.dns_failed`. |
| `dns_failed` | `pending` | Admin clicks "Re-check DNS" or background worker re-runs (next interval). | Clears `dns_failure_reason`. |
| `verified` | `active` | TLS health check succeeds (HTTPS GET to `https://{hostname}` returns valid cert). | Emits `customer_accounts.domain_mapping.activated`. If `replaces_domain_id` set: replaced domain auto-deleted, emits `replaced`. |
| `verified` | `tls_failed` | TLS health check fails after 3 exponential-backoff retries. | `tls_failure_reason` set; `tls_retry_count` recorded; emits `customer_accounts.domain_mapping.tls_failed`. |
| `tls_failed` | `verified` | Admin clicks "Retry SSL" — re-runs `healthCheck(id)`. | `tls_retry_count` reset to 0; clears `tls_failure_reason`. |
| `tls_failed` | `pending` | Admin clicks "Re-check DNS" (chooses to re-run DNS verification rather than just retry TLS). | Treats it as a full reset. |
| any | (deleted) | Admin clicks "Remove Domain" or replacement reaches `active`. | Emits `customer_accounts.domain_mapping.deleted`; cache invalidated. |

The admin **never** needs to manually trigger the `verified → active` transition. It happens automatically via background TLS health check. Both `dns_failed` and `tls_failed` are surfaced distinctly in the UI so the admin sees actionable copy ("fix your DNS" vs "we're investigating SSL provisioning").

**MikroORM Entity** (added to `customer_accounts/data/entities.ts`):

```typescript
@Entity({ tableName: 'domain_mappings' })
export class DomainMapping {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'varchar', length: 255, unique: true })
  hostname!: string

  @ManyToOne(() => Tenant, { fieldName: 'tenant_id', nullable: false })
  tenant!: Tenant

  @ManyToOne(() => Organization, { fieldName: 'organization_id', nullable: false })
  organization!: Organization

  @ManyToOne(() => DomainMapping, { fieldName: 'replaces_domain_id', nullable: true, unique: true })
  replacesDomain?: DomainMapping

  @Enum({ items: () => DomainProvider, default: DomainProvider.TRAEFIK })
  provider: DomainProvider = DomainProvider.TRAEFIK

  @Enum({ items: () => DomainStatus, default: DomainStatus.PENDING })
  status: DomainStatus = DomainStatus.PENDING

  @Property({ type: 'timestamptz', nullable: true })
  verifiedAt?: Date

  @Property({ type: 'timestamptz', nullable: true })
  lastDnsCheckAt?: Date

  @Property({ type: 'varchar', length: 500, nullable: true })
  dnsFailureReason?: string

  @Property({ type: 'varchar', length: 500, nullable: true })
  tlsFailureReason?: string

  @Property({ type: 'int', default: 0 })
  tlsRetryCount: number = 0

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date
}

export enum DomainProvider {
  TRAEFIK = 'traefik',
}

export enum DomainStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  ACTIVE = 'active',
  DNS_FAILED = 'dns_failed',
  TLS_FAILED = 'tls_failed',
}
```

**Note:** `Tenant` and `Organization` are FK ID references only — `DomainMapping` is in the same module boundary as portal infrastructure, but the references to `directory` entities are via foreign keys, not direct ORM relationship traversal across module boundaries.

## API Contracts

### POST /api/customer-accounts/admin/domain-mappings

Register a custom domain for an organization. Route implemented via `makeCrudRoute` with `enrichers: { entityId: 'customer_accounts.domain_mapping' }`. Mutation guards run before creation (hostname format, uniqueness, org limit).

**Auth:** Staff auth + `customer_accounts.domain.manage` feature

**Request:**
```json
{
  "hostname": "shop.acme.com",
  "organizationId": "org_uuid"
}
```

**Response (201):**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "organizationId": "org_uuid",
    "tenantId": "tenant_uuid",
    "provider": "traefik",
    "status": "pending",
    "verifiedAt": null,
    "cnameTarget": "portal.openmercato.com",
    "createdAt": "2026-04-08T10:00:00Z",
    "updatedAt": "2026-04-08T10:00:00Z"
  }
}
```

**Errors:**
- `400` — Invalid hostname format
- `409` — Hostname already claimed by another organization
- `409` — Organization already has a custom domain
- `403` — Missing `customer_accounts.domain.manage` feature

### GET /api/customer-accounts/admin/domain-mappings

List domain mappings for the current tenant (scoped by organization). Route implemented via `makeCrudRoute` with enricher pipeline and interceptor pipeline support.

**Auth:** Staff auth + `customer_accounts.domain.manage` feature

**Query:** `?organizationId=org_uuid` (optional filter)

**Response (200):**
```json
{
  "ok": true,
  "domainMappings": [
    {
      "id": "dm_uuid",
      "hostname": "shop.acme.com",
      "organizationId": "org_uuid",
      "tenantId": "tenant_uuid",
      "provider": "traefik",
      "status": "active",
      "verifiedAt": "2026-04-08T10:05:00Z",
      "cnameTarget": "portal.openmercato.com",
      "createdAt": "2026-04-08T10:00:00Z",
      "updatedAt": "2026-04-08T10:10:00Z"
    }
  ]
}
```

### DELETE /api/customer-accounts/admin/domain-mappings/{id}

Remove a custom domain mapping. Route implemented via `makeCrudRoute`. Calls `domainMappingService.remove(id)` which uses `emitCrudSideEffects` for event emission and cache invalidation.

**Auth:** Staff auth + `customer_accounts.domain.manage` feature

**Response (200):**
```json
{ "ok": true }
```

### POST /api/customer-accounts/admin/domain-mappings/{id}/verify

Trigger DNS verification for a domain mapping.

**Auth:** Staff auth + `customer_accounts.domain.manage` feature

**Response (200) — success:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "verified",
    "verifiedAt": "2026-04-08T10:05:00Z"
  }
}
```

**Response (200) — DNS not found:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "dns_failed",
    "lastDnsCheckAt": "2026-04-08T10:03:00Z",
    "dnsFailureReason": "No CNAME or A record found for shop.acme.com"
  },
  "diagnostics": {
    "expectedCnameTarget": "portal.openmercato.com",
    "expectedARecordTarget": "203.0.113.10",
    "detectedRecords": [],
    "suggestion": "For a subdomain, add a CNAME record pointing to portal.openmercato.com. For an apex domain (acme.com), add an A record pointing to 203.0.113.10. DNS propagation can take up to 48 hours."
  }
}
```

**Response (200) — DNS points to wrong target:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "dns_failed",
    "lastDnsCheckAt": "2026-04-08T10:03:00Z",
    "dnsFailureReason": "CNAME points to wrong-target.example.com instead of portal.openmercato.com"
  },
  "diagnostics": {
    "expectedCnameTarget": "portal.openmercato.com",
    "detectedRecords": [{ "type": "CNAME", "value": "wrong-target.example.com" }],
    "suggestion": "Your CNAME record points to wrong-target.example.com. Update it to point to portal.openmercato.com."
  }
}
```

**Response (200) — proxied DNS (Cloudflare orange-cloud) reverse-resolve failed:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "dns_failed",
    "lastDnsCheckAt": "2026-04-08T10:03:00Z",
    "dnsFailureReason": "A record points to a known proxy IP, but reverse-resolve over HTTPS did not reach our server"
  },
  "diagnostics": {
    "expectedCnameTarget": "portal.openmercato.com",
    "expectedARecordTarget": "203.0.113.10",
    "detectedRecords": [{ "type": "A", "value": "104.18.0.1", "proxy": "cloudflare" }],
    "reverseResolve": { "attempted": true, "originHeaderPresent": false },
    "suggestion": "Your DNS uses a proxy (Cloudflare). Either disable the proxy (grey cloud) and add a CNAME → portal.openmercato.com, or configure your proxy to forward traffic to portal.openmercato.com."
  }
}
```

### GET /api/customer-accounts/domain-check

Traefik verification endpoint. Called by Traefik before issuing a TLS certificate. Reads from `@open-mercato/cache` (tag: `domain_routing`) before hitting DB.

**Auth:** Mandatory shared secret via `X-Domain-Check-Secret` header (must match `DOMAIN_CHECK_SECRET` env var). Returns `403` if secret is missing or incorrect.

**Query:** `?host=shop.acme.com`

**Response:**
- `200 OK` — hostname exists in `DomainMapping` with status `verified` or `active`
- `403 Forbidden` — missing or incorrect `X-Domain-Check-Secret` header
- `404 Not Found` — hostname not found, or status is `pending`/`dns_failed`/`tls_failed`

### GET /api/customer-accounts/domain-resolve

Internal endpoint for the Node Middleware to populate its cache (single-domain lookup). Reads from `@open-mercato/cache` (key: `domain_routing:resolve:{hostname}`, tags: `['domain_routing', 'domain_routing:{hostname}']`, TTL: 300s) before hitting DB. Cache invalidated by `invalidate-domain-cache` subscriber on any domain lifecycle event.

**Auth:** Mandatory shared secret via `X-Domain-Resolve-Secret` header (must match `DOMAIN_RESOLVE_SECRET` env var). Returns `403` if secret is missing or incorrect.

**Query:** `?host=shop.acme.com`

**Response (200):**
```json
{
  "tenantId": "tenant_uuid",
  "tenantSlug": "acme-holdings",
  "organizationId": "org_uuid",
  "orgSlug": "acme",
  "status": "active"
}
```

**Response (403):** missing or incorrect secret.
**Response (404):** hostname not found or not in `active` status.

### GET /api/customer-accounts/domain-resolve/all

Internal endpoint for the Node Middleware batch cache warm-up on process start.

**Auth:** Mandatory shared secret via `X-Domain-Resolve-Secret` header.

**Response (200):**
```json
{
  "domains": [
    {
      "hostname": "shop.acme.com",
      "tenantId": "tenant_uuid",
      "tenantSlug": "acme-holdings",
      "organizationId": "org_uuid",
      "orgSlug": "acme",
      "status": "active"
    }
  ]
}
```

Returns all domain mappings with status `active`. Lightweight response optimized for cache population — no pagination needed (bounded by total active domains, expected <10,000).

### POST /api/customer-accounts/admin/domain-mappings/{id}/health-check

Trigger TLS health check for a verified domain. Called automatically after DNS verification succeeds, but can also be triggered manually from the back office.

**Auth:** Staff auth + `customer_accounts.domain.manage` feature (admin), or internal secret for automated calls.

**Response (200) — TLS working:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "active"
  },
  "tls": { "valid": true, "issuer": "Let's Encrypt", "expiresAt": "2026-07-07T10:00:00Z" }
}
```

**Response (200) — TLS not ready:**
```json
{
  "ok": true,
  "domainMapping": {
    "id": "dm_uuid",
    "hostname": "shop.acme.com",
    "status": "verified"
  },
  "tls": { "valid": false, "reason": "Certificate not yet provisioned. Traefik will provision on next request." }
}
```

**OpenAPI:** All routes export `openApi` for documentation generation.

## Internationalization (i18n)

New keys added to `customer_accounts` locale files (`i18n/en.json`, `pl.json`, `de.json`, `es.json`):

| Key | English Value |
|-----|--------------|
| `domainMapping.title` | Custom Domain |
| `domainMapping.description` | Map your own domain to the customer portal |
| `domainMapping.hostname.label` | Domain |
| `domainMapping.hostname.placeholder` | e.g., shop.yourdomain.com |
| `domainMapping.hostname.validation.invalid` | Enter a valid domain name (no protocol, path, or port) |
| `domainMapping.status.pending` | Checking DNS... |
| `domainMapping.status.verified` | Setting up SSL certificate... |
| `domainMapping.status.active` | Active |
| `domainMapping.status.dns_failed` | DNS issue — see details below |
| `domainMapping.status.tls_failed` | SSL certificate issue — we're retrying |
| `domainMapping.stepper.step1` | Register Domain |
| `domainMapping.stepper.step2` | Configure DNS |
| `domainMapping.stepper.step3` | SSL Certificate |
| `domainMapping.stepper.step4` | Live |
| `domainMapping.cnameInstruction` | Add a CNAME record for {hostname} pointing to {target} in your DNS provider |
| `domainMapping.dnsProviderHelp` | Need help? See instructions for: |
| `domainMapping.dnsProviderHelp.cloudflare` | Cloudflare |
| `domainMapping.dnsProviderHelp.godaddy` | GoDaddy |
| `domainMapping.dnsProviderHelp.namecheap` | Namecheap |
| `domainMapping.dnsProviderHelp.googleDomains` | Google Domains |
| `domainMapping.dnsProviderHelp.other` | Other providers |
| `domainMapping.autoVerify.checking` | Automatically checking every 5 minutes |
| `domainMapping.autoVerify.lastChecked` | Last checked: {time} |
| `domainMapping.autoVerify.nextCheck` | Next check in ~{minutes} minutes |
| `domainMapping.verifyNow` | Check Now |
| `domainMapping.diagnostics.noRecord` | No CNAME record found for {hostname} |
| `domainMapping.diagnostics.wrongTarget` | Your CNAME record points to {detected} instead of {expected} |
| `domainMapping.diagnostics.timeout` | DNS lookup timed out — this may be a temporary issue |
| `domainMapping.diagnostics.detectedRecords` | Detected DNS records: |
| `domainMapping.diagnostics.suggestion` | Suggested fix: |
| `domainMapping.removeDomain` | Remove Domain |
| `domainMapping.removeConfirm` | Are you sure? Customers using this domain will no longer be able to reach your portal. |
| `domainMapping.removeConfirm.hasReplacement` | This will also cancel the pending replacement domain ({hostname}). |
| `domainMapping.propagationNote` | DNS changes can take up to 48 hours to propagate. The system checks automatically — you'll be notified when it's ready. |
| `domainMapping.registered` | Domain registered successfully |
| `domainMapping.removed` | Domain removed |
| `domainMapping.alreadyClaimed` | This domain is already in use by another organization |
| `domainMapping.changeDomain` | Change Domain |
| `domainMapping.changeDomain.description` | Your current domain ({hostname}) will stay active until the new domain is fully set up. No downtime for your customers. |
| `domainMapping.changeDomain.replacing` | Replacing {oldHostname} — old domain stays live until this one is ready |
| `domainMapping.preview` | Test Domain |
| `domainMapping.preview.description` | Opens your portal on the custom domain in a new tab to verify it's working correctly |
| `domainMapping.preview.notReady` | Domain is not yet active. Complete the setup steps first. |
| `domainMapping.notification.verified` | Your custom domain {hostname} has been verified! SSL certificate is being provisioned. |
| `domainMapping.notification.active` | Your custom domain {hostname} is now live! |
| `domainMapping.notification.dnsFailed` | DNS verification failed for {hostname}. {reason} |
| `domainMapping.notification.tlsFailed` | SSL certificate provisioning is having trouble for {hostname}. We're retrying — no action needed yet. |
| `domainMapping.tls.retryButton` | Retry SSL |
| `domainMapping.dns.recheckButton` | Re-check DNS |

## UI/UX

### Back Office: Custom Domain Settings Page

**Route:** `/backend/customer_accounts/settings/domain`

**Access:** Staff auth + `customer_accounts.domain.manage` feature

### Multi-Org Tenant Behavior

When the staff user has access to multiple organizations within the current tenant (and holds `customer_accounts.domain.manage` on more than one of them), the page header renders an **organization switcher** dropdown. Selecting an organization swaps the loaded `DomainMapping` and re-fetches the page state (the URL stays at `/backend/customer_accounts/settings/domain` — the active org is held in a `?org=<orgSlug>` query parameter so the page is shareable).

```
┌──────────────────────────────────────────────────────┐
│ Custom Domain                                         │
│ Map your own domain to the customer portal            │
│                                                       │
│ Organization: [ Acme Retail ▼ ]                       │
│   ↳ Acme Retail (acme)                                │
│     Acme Wholesale (acme-wholesale)                   │
│     Acme EU (acme-eu)                                 │
├──────────────────────────────────────────────────────┤
│ ... rest of page is org-scoped ...                    │
└──────────────────────────────────────────────────────┘
```

- **Single-org tenants**: the switcher is not rendered. The page implicitly operates on the user's only accessible organization.
- **No-access state**: if the staff user has `customer_accounts.domain.manage` on zero organizations, the page renders an `<EmptyState>` explaining they need the feature granted on at least one org.
- **Default org**: the dropdown defaults to `?org=<slug>` from the URL; if absent, the most recently active org (cookie-stored preference); if absent, the first alphabetical org the user can manage.
- **Cross-org operations**: explicitly disallowed — the page never lets an admin manage one org's domain while looking at another's data. Switching the org is a full re-render, not a partial.

### Visual Stepper

The setup flow is presented as a 4-step progress indicator at the top of the page. Each step shows its status (completed, current, upcoming) and the stepper persists across all states:

```
  ① Register Domain  →  ② Configure DNS  →  ③ SSL Certificate  →  ④ Live
       [done]              [current]           [upcoming]          [upcoming]
```

### State: No Domain Configured

```
┌──────────────────────────────────────────────────────┐
│ Custom Domain                                         │
│ Map your own domain to the customer portal            │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│   [current]                                           │
│                                                       │
│  Domain: [_________________________] [Register]       │
│  e.g., shop.yourdomain.com                            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: Pending DNS Verification

```
┌──────────────────────────────────────────────────────┐
│ Custom Domain                                         │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]      [current]                              │
│                                                       │
│  Domain: shop.acme.com                              │
│  Status: ● Checking DNS...                            │
│  Last checked: 2 minutes ago · Next check in ~3 min   │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │ DNS Configuration Required                    │     │
│  │                                               │     │
│  │ Add a CNAME record in your DNS provider:      │     │
│  │                                               │     │
│  │ Type:   CNAME                                 │     │
│  │ Name:   shop.acme.com                       │     │
│  │ Target: portal.openmercato.com          [📋]  │     │
│  │                                               │     │
│  │ Need help? See instructions for:              │     │
│  │ [Cloudflare] [GoDaddy] [Namecheap]           │     │
│  │ [Google Domains] [Other providers]            │     │
│  │                                               │     │
│  │ DNS changes can take up to 48 hours to        │     │
│  │ propagate. The system checks automatically —  │     │
│  │ you'll be notified when it's ready.           │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  [Check Now]                       [Remove Domain]    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: DNS Verification Failed — `dns_failed` (with Diagnostics)

```
┌──────────────────────────────────────────────────────┐
│ Custom Domain                                         │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]      [error]                                │
│                                                       │
│  Domain: shop.acme.com                              │
│  Status: ⚠ DNS issue — see details below              │
│  Last checked: 30 seconds ago                         │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │ ⚠ DNS Issue Detected                         │     │
│  │                                               │     │
│  │ Your CNAME record points to:                  │     │
│  │   wrong-target.example.com                    │     │
│  │                                               │     │
│  │ It should point to:                           │     │
│  │   portal.openmercato.com              [📋]    │     │
│  │                                               │     │
│  │ Update your CNAME record in your DNS provider │     │
│  │ and the system will detect the change         │     │
│  │ automatically.                                │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  [Re-check DNS]                    [Remove Domain]    │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: TLS Provisioning Failed — `tls_failed`

When DNS verified successfully but Traefik / Let's Encrypt could not issue a certificate after 3 retries. The admin sees a different message — this is **not** a DNS problem and should not lead them to mess with their DNS records.

```
┌──────────────────────────────────────────────────────┐
│ Custom Domain                                         │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]       [done]    [error]                     │
│                                                       │
│  Domain: shop.acme.com                              │
│  Status: ⚠ SSL certificate issue                      │
│  TLS retries: 3 / 3                                   │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │ ⚠ SSL Certificate Provisioning Failed        │     │
│  │                                               │     │
│  │ Your DNS is correct — we just couldn't issue │     │
│  │ a Let's Encrypt certificate after 3 attempts. │     │
│  │                                               │     │
│  │ Reason: TLS-ALPN-01 challenge timed out      │     │
│  │                                               │     │
│  │ This is usually temporary. Wait a minute and  │     │
│  │ click "Retry SSL". If it keeps failing,      │     │
│  │ contact support — we'll investigate.          │     │
│  └──────────────────────────────────────────────┘     │
│                                                       │
│  [Retry SSL]   [Re-check DNS]    [Remove Domain]      │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: Verified — SSL Provisioning

```
┌──────────────────────────────────────────────────────┐
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]       [done]    [current]                   │
│                                                       │
│  Domain: shop.acme.com                              │
│  Status: ● Setting up SSL certificate...              │
│                                                       │
│  DNS verified. SSL certificate is being provisioned   │
│  automatically. This usually takes less than a minute.│
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: Active

```
┌──────────────────────────────────────────────────────┐
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]       [done]     [done]    [done]           │
│                                                       │
│  Domain: shop.acme.com                              │
│  Status: ● Active                                     │
│                                                       │
│  Your portal is live at https://shop.acme.com       │
│                                                       │
│  [Test Domain]    [Change Domain]    [Remove Domain]  │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### State: Domain Swap in Progress

When admin clicks "Change Domain" on an active domain:

```
┌──────────────────────────────────────────────────────┐
│  Current domain: shop.acme.com  ● Active            │
│  ─────────────────────────────────────────────────    │
│  New domain setup:                                    │
│                                                       │
│  ① Register  →  ② DNS  →  ③ SSL  →  ④ Live          │
│    [done]      [current]                              │
│                                                       │
│  Domain: store.acme.com                            │
│  Status: ● Checking DNS...                            │
│                                                       │
│  Replacing shop.acme.com — old domain stays live    │
│  until this one is ready. No downtime for customers.  │
│                                                       │
│  [CNAME instructions + DNS provider help as above]    │
│                                                       │
│  [Check Now]                [Cancel Replacement]      │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### Loading, Empty, and Error States

The page must satisfy the design-system rule "Every list/data page MUST handle empty state via `<EmptyState>` and every async page MUST show loading state via `<LoadingMessage>` / `<Spinner>` / `<DataLoader>`" from `packages/ui/AGENTS.md`.

- **Loading state** (initial page mount, fetching the org's `DomainMapping`):

  ```
  <DataLoader query={domainMappingQuery}
              loading={<LoadingMessage>Loading domain settings...</LoadingMessage>}
              error={(err) => <ErrorMessage message={err.message} retry={refetch} />}>
    {(data) => <DomainSettingsContent data={data} />}
  </DataLoader>
  ```

- **Empty state** (org has no `DomainMapping` row at all — the "no domain configured" view above is itself the empty state, but it uses `<EmptyState>` semantics):

  ```
  <EmptyState
    icon="globe"
    title="No custom domain yet"
    description="Map your own domain to the customer portal. Customers will see your branded URL instead of the platform's generic path."
    action={<Button onClick={openRegisterDialog}>Register a domain</Button>}
  />
  ```

  This replaces the bare "Domain: [____] [Register]" form on first render and pushes the form into a modal/dialog launched by the action button.

- **Error state** (fetch failed — e.g., network error, 500 from the API): `<ErrorMessage message={err.message} retry={refetch} />`. The user can retry without leaving the page.

- **No-access state** (multi-org tenant, user has the feature on zero organizations): `<EmptyState icon="lock" title="No managed organizations" description="Ask an admin to grant you the 'customer_accounts.domain.manage' feature on at least one organization." />`.

- **Inline async** (after clicking "Re-check DNS" or "Retry SSL"): the button enters a `loading` state with a `<Spinner size="sm">`, the rest of the page stays visible. On success: `flash('DNS verified', 'success')`. On failure: status updates in place + `<Alert variant="warning">` is appended to the diagnostics card.

### Components

- **Stepper indicator**: 4-step horizontal progress bar. Steps show checkmark (done), spinner (in progress), dot (upcoming), or warning icon (error). DS tokens: `text-status-success-icon` (done), `text-status-info-icon` (current), `text-muted-foreground` (upcoming), `text-status-warning-icon` (error). Never hardcoded colors.
- **Hostname input**: Wrapped in `FormField` (label + error). Client-side hostname validation runs through the same `normalizeHostname` + zod schema as the server, so the user sees the canonical form (e.g., typing `Shop.Acme.com` previews as `shop.acme.com`). IDN input is auto-converted to Punycode with a small caption: *"Punycode form: xn--..."*.
- **Status indicator**: Uses `<StatusBadge variant={domainStatusMap[status]} dot>` with the following `StatusMap<DomainStatus>`:

```typescript
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const domainStatusMap: StatusMap<DomainStatus> = {
  pending:    'info',      // checking DNS — neutral information
  verified:   'info',      // setting up SSL — neutral information
  active:     'success',
  dns_failed: 'warning',   // recoverable, admin action required
  tls_failed: 'warning',   // recoverable, may auto-resolve
}
```

No hardcoded color classes anywhere. Dark mode is provided by the semantic tokens.
- **CNAME instruction card**: Copy-to-clipboard button for the target value. DNS provider quick-links open external help articles (Cloudflare, GoDaddy, Namecheap, Google Domains).
- **Auto-polling indicator**: Shows "Last checked: {time}" and "Next check in ~{minutes} min". Powered by background worker — UI reflects status via real-time events.
- **"Check Now" button**: Triggers `POST /api/customer-accounts/admin/domain-mappings/{id}/verify`. Replaces the old "Verify Now" label — more intuitive phrasing.
- **Diagnostics card**: Shown on `dns_failed` status. Displays `dnsFailureReason`, detected DNS records, expected target, and a specific actionable suggestion. A separate **SSL diagnostics card** is shown on `tls_failed` status displaying `tlsFailureReason`, `tlsRetryCount`, and operator-friendly copy.
- **"Test Domain" button**: Shown on `active` status. Opens `https://{hostname}` in a new tab. Disabled when domain is not yet active.
- **"Change Domain" button**: Shown on `active` status. Opens the domain swap flow — registers a new domain with `replacesDomainId` pointing to the current active domain. Old domain stays active until replacement is ready.
- **"Remove Domain" button**: Confirmation dialog with `Cmd/Ctrl+Enter` to confirm, `Escape` to cancel. Warning text changes based on whether there's a pending replacement.
- **Real-time status updates**: `useAppEvent('customer_accounts.domain_mapping.*')` (DOM Event Bridge). UI auto-updates when background worker verifies DNS or TLS health check completes — admin sees transitions happen live without page refresh.
- **Notifications**: In-app notification sent when domain transitions to `verified`, `active`, `dns_failed`, or `tls_failed` (via notification subscriber). Each includes actionable message with link to the domain settings page; `dns_failed` and `tls_failed` use distinct copy so the admin sees the right call to action.

**Extension Points** (component handles for UMES extensibility):

| Handle | Purpose |
|--------|---------|
| `section:customer_accounts.domain-settings:status` | Status badge area — replaceable/wrappable by other modules |
| `section:customer_accounts.domain-settings:dns-config` | DNS instruction card area — replaceable (e.g., Cloudflare integration could replace with API-driven setup) |
| `section:customer_accounts.domain-settings:actions` | Action buttons area — wrappable (e.g., enterprise module adds "Request Approval" button) |
| `section:customer_accounts.domain-settings:stepper` | Stepper indicator — wrappable (e.g., add extra steps for enterprise approval workflows) |

These handles are declared via `useRegisteredComponent(handle, FallbackComponent)` in the settings page. They are FROZEN contract surfaces per the Backward Compatibility Contract.

**Validation (client-side, zod):**
- No protocol prefix (`http://`, `https://`)
- No path or query string
- No port
- Valid hostname format: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`
- Minimum 2 labels (e.g., `foo.com`, not just `foo`)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CUSTOM_DOMAIN_CNAME_TARGET` | `portal.openmercato.com` | The CNAME target subdomain tenants must point their domain to |
| `CUSTOM_DOMAIN_A_RECORD_TARGET` | *(required for apex support)* | The IPv4 address apex-domain tenants must point their A record to. **MUST be a dedicated IP** that serves only this platform — not a shared CDN/load balancer IP also used by other services. If shared, an attacker pointing their domain at the same IP would pass the A-record check without proxying through us. If unset, apex-domain registration is disabled and the verifier returns a `dns_failed` with a copy explaining apex isn't supported on this deployment. |
| `DOMAIN_TLS_RETRY_INTERVAL_SECONDS` | `1800` | TLS-retry worker cadence (30 min default). |
| `DOMAIN_TLS_MAX_RETRIES` | `6` | Per-domain retry cap. After this, only manual UI "Retry SSL" or operator action revives the domain. |
| `DOMAIN_TLS_RETRY_BATCH` | `50` | Max domains the TLS-retry worker processes per run. |
| `DOMAIN_TLS_RETRY_FAILURE_THRESHOLD` | `0.8` | If ≥80% of a worker run's health checks fail, the worker doubles its next interval (capped at 6h). |
| `KNOWN_PROXY_IP_RANGES` | *(Cloudflare default list)* | Comma-separated CIDR ranges identifying known reverse-proxy networks (Cloudflare, Fastly, etc.). Triggers reverse-resolve fallback when an A record falls inside these ranges. |
| `CUSTOMER_DOMAIN_ORIGIN_HEADER` | `X-Open-Mercato-Origin` | Name of the response header set on `/api/customer-accounts/domain-check` to confirm proxied requests reach our origin. |
| `PLATFORM_DOMAINS` | `localhost,openmercato.com` | Comma-separated list of platform domains. Middleware skips these hosts. |
| `PLATFORM_PORTAL_BASE_URL` | `https://openmercato.com` | Public base URL for the platform fallback portal. Used by `urlForCustomerOrg` when no custom domain is active. |
| `DOMAIN_CHECK_SECRET` | *(required)* | **Mandatory** shared secret for the Traefik `domain-check` endpoint. Traefik must send `X-Domain-Check-Secret` header. App refuses to start if not set. |
| `DOMAIN_RESOLVE_SECRET` | *(required)* | **Mandatory** shared secret for the middleware `domain-resolve` and `domain-resolve/all` endpoints. Middleware sends `X-Domain-Resolve-Secret` header. App refuses to start if not set. |
| `DOMAIN_CACHE_TTL_SECONDS` | `60` | TTL for positive entries in the in-memory domain cache (stale-while-revalidate: stale entries served immediately while background refresh occurs) |
| `DOMAIN_NEGATIVE_CACHE_TTL_SECONDS` | `300` | TTL for negative cache entries (unknown hostnames). Longer TTL absorbs probing/attack traffic without repeated DB queries. |
| `DOMAIN_CACHE_MAX_ENTRIES` | `10000` | Maximum entries in the in-memory domain cache. LRU eviction when exceeded. ~300 bytes per entry = ~3MB at max. |
| `DOMAIN_AUTO_VERIFY_INTERVAL_SECONDS` | `300` | How often the background worker checks pending/failed domains for DNS verification. Set to `0` to disable auto-verification. |

## Migration & Compatibility

### Database Migration

> **Note:** Per `AGENTS.md` ("Never hand-write migrations — update ORM entities, run `yarn db:generate`"), the actual migration is generated from the entity decorators. The SQL below is **illustrative only** — it documents the expected output shape so reviewers can confirm the indexes and constraints are right. Do not copy-paste this block into a migration file.

```sql
CREATE TABLE domain_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  replaces_domain_id UUID REFERENCES domain_mappings(id) ON DELETE SET NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'traefik',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  last_dns_check_at TIMESTAMPTZ,
  dns_failure_reason VARCHAR(500),
  tls_failure_reason VARCHAR(500),
  tls_retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domain_mappings_hostname_unique UNIQUE (hostname),
  CONSTRAINT domain_mappings_replaces_domain_id_unique UNIQUE (replaces_domain_id),
  CONSTRAINT domain_mappings_hostname_normalized_chk
    CHECK (hostname = lower(hostname) AND hostname NOT LIKE '%.')
);

CREATE INDEX domain_mappings_organization_id_idx ON domain_mappings(organization_id);
CREATE INDEX domain_mappings_tenant_id_idx ON domain_mappings(tenant_id);
CREATE INDEX domain_mappings_pending_verification_idx ON domain_mappings(status, last_dns_check_at)
  WHERE status IN ('pending', 'dns_failed');
CREATE INDEX domain_mappings_pending_tls_idx ON domain_mappings(status, updated_at)
  WHERE status IN ('verified', 'tls_failed');
```

### Backward Compatibility

- **No breaking changes.** The `Organization` entity is not modified. All existing portal routing continues to work unchanged.
- **New `middleware.ts`** is additive. Platform-domain traffic passes through with `NextResponse.next()` — zero impact on existing routes.
- **New ACL feature** `customer_accounts.domain.manage` requires `setup.ts` update to assign to default roles (`superadmin`, `admin`).
- **Traefik addition** is opt-in infrastructure — existing deployments without Traefik continue to work; custom domains simply won't have automated TLS.

### Future Multi-Domain Support

The `organization_id` column intentionally has no UNIQUE constraint — the schema already supports multiple domains per organization. The domain swap flow uses this to allow a replacement domain to coexist with the active domain during transition. For full multi-domain support (e.g., regional domains), the only change needed is removing the service-level "max 2 per org" enforcement and adding a UI for managing multiple active domains.

## Implementation Plan

### Phase 1: Data Layer & API

**Goal:** `DomainMapping` entity, service, CRUD API routes, validation, events, ACL, DNS diagnostics. Integrates with `makeCrudRoute`, mutation guards, response enrichers, `@open-mercato/cache`, notification system, and widget injection.

1. Add `DomainMapping` entity class (with `replacesDomain`, `lastDnsCheckAt`, `dnsFailureReason`, `tlsFailureReason`, `tlsRetryCount`), `DomainProvider` enum, and `DomainStatus` enum (`pending | verified | active | dns_failed | tls_failed`) to `customer_accounts/data/entities.ts`. **Omit the `indexer` field** on the CRUD route config so the entity is excluded from the platform-wide search index — `indexer?` is optional in `CrudRouteConfig` (`packages/shared/src/lib/crud/factory.ts:424`), so omission is the documented opt-out. Add a one-line code comment on the route file: `// Domain mappings are tenant-private — intentionally excluded from search indexing.`
2. Create `customer_accounts/lib/hostname.ts` exporting `normalizeHostname` (lowercase + trailing-dot strip + IDN → Punycode + 253-char cap). All callers (validators, service, middleware, API endpoints) MUST use this function — no ad-hoc normalization.
3. Add Zod validation schemas to `customer_accounts/data/validators.ts`:
   - `registerDomainSchema` — hostname (transforms via `normalizeHostname`) + organizationId + optional `replacesDomainId`
   - `hostnameSchema` — reusable hostname format validator running on the post-normalization ASCII form
3. Create `customer_accounts/data/guards.ts` — mutation guards for domain validation:
   - `customer_accounts.domain_mapping.hostname-format` (priority 10) — validates hostname against `hostnameSchema`
   - `customer_accounts.domain_mapping.hostname-unique` (priority 20) — checks DB uniqueness
   - `customer_accounts.domain_mapping.org-limit` (priority 30) — enforces max 2 per org
4. Create `customer_accounts/data/enrichers.ts` — response enricher on `directory:organization`:
   - `customer_accounts.domain-status:directory:organization` — adds `_customDomain: { hostname, status }` to Organization API responses
   - Uses `enrichMany()` with batch `$in` query; feature-gated by `customer_accounts.domain.manage`
5. Create `customer_accounts/services/domainMappingService.ts` with: `register`, `verify` (CNAME → A → reverse-resolve fallback chain with detailed diagnostics), `activate`, `remove`, `findByOrganization`, `resolveByHostname` (reads `@open-mercato/cache` first), `resolveActiveByOrg(orgId)` (used by `urlForCustomerOrg`), `resolveAll`, `healthCheck`, `findPendingVerification`, `findPendingTls`
   - All write methods use `emitCrudSideEffects` for consistent event emission and cache invalidation. Search indexing is opt-out (`indexer: false`) — domain mappings are not searchable cross-tenant.
5a. Create `customer_accounts/lib/proxyRanges.ts` — parses `KNOWN_PROXY_IP_RANGES` into in-memory CIDR matchers. Exposes `isInKnownProxyRange(ip)` and `detectProxy(ip)`.
5b. Create `customer_accounts/lib/customerUrl.ts` — exports `urlForCustomerOrg(orgId, path)`. All customer-portal email templates must use this helper. Add a unit test asserting no template hardcodes the platform host.
6. Register `domainMappingService` in `customer_accounts/di.ts`
7. Add domain mapping events to `customer_accounts/events.ts` (7 events with `clientBroadcast: true`: `created`, `verified`, `activated`, `dns_failed`, `tls_failed`, `deleted`, `replaced`)
8. Add `customer_accounts.domain.manage` feature to `customer_accounts/acl.ts`
9. Update `customer_accounts/setup.ts` to assign `customer_accounts.domain.manage` to `superadmin` and `admin` default roles
10. Add notification types to `customer_accounts/notifications.ts`:
    - `customer_accounts.domain_mapping.verified` (severity: success)
    - `customer_accounts.domain_mapping.activated` (severity: success)
    - `customer_accounts.domain_mapping.dns_failed` (severity: warning) — *user must fix DNS*
    - `customer_accounts.domain_mapping.tls_failed` (severity: warning) — *operator should investigate; user typically takes no action*
    - All with `expiresAfterHours: 168`, action link to settings page
11. Add client notification renderers to `customer_accounts/notifications.client.ts`
12. Run `yarn db:generate` to create migration
13. Create API routes:
    - `api/admin/domain-mappings.ts` — **via `makeCrudRoute`** (GET list, POST create, DELETE). Includes `enrichers: { entityId: 'customer_accounts.domain_mapping' }` and `orm: { entity: DomainMapping, orgField: 'organizationId', tenantField: 'tenantId' }`. Mutation guards run automatically before create.
    - `api/admin/domain-mappings/[id]/verify.ts` — custom route (POST DNS check — returns diagnostics). Uses `runCustomRouteAfterInterceptors()`.
    - `api/admin/domain-mappings/[id]/health-check.ts` — custom route (POST TLS health check)
    - `api/get/domain-check.ts` — custom route (Traefik verification — mandatory `DOMAIN_CHECK_SECRET`, reads `@open-mercato/cache`)
    - `api/get/domain-resolve.ts` — custom route (middleware resolve — mandatory `DOMAIN_RESOLVE_SECRET`, reads `@open-mercato/cache`)
    - `api/get/domain-resolve/all.ts` — custom route (middleware batch resolve — mandatory `DOMAIN_RESOLVE_SECRET`)
14. Create subscribers:
    - `subscribers/invalidate-domain-cache.ts` — ephemeral subscriber on `customer_accounts.domain_mapping.*`, invalidates `@open-mercato/cache` tags `['domain_routing', 'domain_routing:{hostname}']`
    - `subscribers/domain-verified-notification.ts` — persistent, calls `buildFeatureNotificationFromType()` with `requiredFeature: 'customer_accounts.domain.manage'`
    - `subscribers/domain-activated-notification.ts` — persistent, same pattern
    - `subscribers/domain-dns-failed-notification.ts` — persistent, same pattern
    - `subscribers/domain-tls-failed-notification.ts` — persistent, same pattern
15. Add i18n keys to locale files (stepper, diagnostics, auto-verify, domain swap, preview, notifications)
16. Validate mandatory env vars (`DOMAIN_CHECK_SECRET`, `DOMAIN_RESOLVE_SECRET`) at startup — fail fast if missing
17. Run `yarn generate` (regenerates `enrichers.generated.ts`, `guards.generated.ts`, `injection-tables.generated.ts`, `notifications.generated.ts`, `workers.generated.ts`) and `yarn build:packages`

### Phase 1.5: Customer Auth Host-Awareness

**Goal:** Make the existing customer-auth entry points work on custom domains without breaking existing platform-domain clients.

1. Relax `loginSchema.tenantId` in `customer_accounts/data/validators.ts` from required to optional. Mirror the change in `signupSchema`, `magicLinkRequestSchema`, `passwordResetRequestSchema`, `passwordResetConfirmSchema`.
2. Create `customer_accounts/lib/resolveTenantContext.ts`:
   ```typescript
   export async function resolveTenantContext(
     req: Request,
     bodyTenantId?: string,
   ): Promise<{ tenantId: string; organizationId: string | null }>
   ```
   Logic:
   - Read `Host` header, normalize via `normalizeHostname`.
   - If host is in `PLATFORM_DOMAINS`: require `bodyTenantId`; return it.
   - Else: call `domainMappingService.resolveByHostname(host)`. If `status !== 'active'` → throw 404. If `bodyTenantId` is supplied and differs from resolved → throw 400 (mismatch).
3. Update `customer_accounts/api/login.ts`, `signup.ts`, `magic-link/request.ts`, `password/reset-request.ts`, `password/reset-confirm.ts` to call `resolveTenantContext(req, parsed.data.tenantId)` instead of asserting `tenantId` directly.
4. Extend `customer_accounts/lib/customerAuthServer.ts`:
   - Add optional `expectedTenantId` to `getCustomerAuthFromCookies`. When present and decoded JWT's `tenantId !== expectedTenantId`, return null.
   - Add new helper `getCustomerAuthForHost(req)` that resolves the host first, then calls `getCustomerAuthFromCookies` with `expectedTenantId`.
   - Existing callers that don't pass `expectedTenantId` see no behavior change (additive).
5. Update `customer_accounts/api/signup.ts` to construct the welcome-email URL via `urlForCustomerOrg(orgId, '/portal')` instead of hard-coding `PLATFORM_PORTAL_BASE_URL`. This is the only existing call site that sends customer-portal email; future routes follow the same rule (forward-looking).
6. Add unit tests:
   - `loginSchema` accepts a missing `tenantId`.
   - `resolveTenantContext` returns body-supplied `tenantId` on platform host, host-resolved `tenantId` on custom host, throws on mismatch.
   - `getCustomerAuthFromCookies` rejects JWT when `expectedTenantId` doesn't match decoded `tenantId`.
7. Add `customer_accounts.domain.manage` to `customer_accounts/AGENTS.md` along with the rule: "All customer-portal email senders MUST construct URLs via `urlForCustomerOrg`. Never hard-code `PLATFORM_PORTAL_BASE_URL`."

### Phase 2: Next.js Node Middleware

**Goal:** Host-header resolution with stale-while-revalidate cache, batch warm-up, and URL rewriting. Runs on `runtime: 'nodejs'` — Next.js ≥ 15.2 is a hard requirement.

1. **Pre-task:** verify the source of the `x-next-url` request header that `apps/mercato/src/app/(frontend)/layout.tsx` already reads (line ~24). Today no `middleware.ts` exists in the repo, so this header is either set by Next.js internally or by a build-step injection. The new middleware MUST preserve (or replicate) whatever sets it, otherwise the existing portal layout's pathname-based orgSlug parsing breaks. Confirm via grep + a bare-middleware smoke test before committing the rewrite logic.
2. Create `apps/mercato/src/middleware.ts`:
   - `export const config = { matcher: [...], runtime: 'nodejs' }` — explicit Node runtime declaration. CI must enforce Next.js ≥ 15.2 in `package.json` engines (current: 16.2.4 — comfortably ahead).
   - Matcher config excluding `/_next/*`, `/favicon.ico`
   - Normalize the incoming Host header through `normalizeHostname` before any cache lookup (defends against case/IDN/trailing-dot drift)
   - When rewriting via `NextResponse.rewrite`, pass through the original `x-next-url` (or set it explicitly to the rewritten URL) so the catch-all layout's pathname extraction continues to work
   - Set `x-open-mercato-origin: 1` response header on the `/api/customer-accounts/domain-check` and `/_next/health` endpoints so the proxied-DNS reverse-resolve check (Phase 1) can distinguish "request reached our origin" from "request was answered by an unrelated host"
   - Platform domain allow-list from `PLATFORM_DOMAINS` env var
   - **Stale-while-revalidate cache**: serve stale entries immediately, trigger async background refresh. Cold misses fall back to synchronous fetch.
   - **Batch warm-up on module init**: fetch `GET /api/customer-accounts/domain-resolve/all` (with `X-Domain-Resolve-Secret` header) to populate entire cache before first request.
   - **Negative caching**: unknown hostnames cached with `DOMAIN_NEGATIVE_CACHE_TTL_SECONDS` (default 5 min) to prevent repeated DB hits from probing.
   - **LRU eviction**: when cache exceeds `DOMAIN_CACHE_MAX_ENTRIES`, evict least-recently-accessed entry.
   - For custom domain + non-API path: resolve from cache, rewrite URL to `/{orgSlug}/portal{pathname}`
   - For custom domain + `/api/*` path: pass through (no rewrite)
   - For platform domain: `NextResponse.next()`
2. Add `x-custom-domain` response header for downstream context awareness
3. Handle warm-up failure gracefully: log error, start with empty cache, fall back to per-request fetch
4. Handle per-request fetch failure gracefully: return 503 with retry-after header. Stale cached entries continue serving.

### Phase 3: Traefik Configuration

**Goal:** Reverse proxy with on-demand TLS certificate provisioning.

1. Create `docker/traefik/traefik.yml` with:
   - HTTP entrypoint (port 80) with redirect to HTTPS
   - HTTPS entrypoint (port 443) with TLS
   - Let's Encrypt ACME resolver using TLS-ALPN-01 challenge
   - On-demand TLS with verification endpoint: `http://app:3000/api/customer-accounts/domain-check`
   - Certificate storage in `acme.json`
   - `X-Domain-Check-Secret` header forwarded in on-demand TLS verification request
2. Update `docker-compose.yml`:
   - Add Traefik service with ports 80/443
   - Mount `acme.json` as persistent volume
   - Configure app service labels for Traefik routing
   - Network configuration for internal verification endpoint access
   - Environment variables for `DOMAIN_CHECK_SECRET`

### Phase 4: Back Office UI

**Goal:** Guided stepper wizard with auto-polling, DNS diagnostics, domain swap, multi-org switcher, and preview. Uses platform UI patterns: `useGuardedMutation`, `useRegisteredComponent`, `StatusBadge` + `StatusMap`, `<EmptyState>`/`<LoadingMessage>`/`<ErrorMessage>`, widget injection for navigation.

1. Create `backend/customer_accounts/settings/domain/page.tsx`:
   - **Multi-org switcher**: header dropdown listing every org the staff user can manage with `customer_accounts.domain.manage`. Persists selection via `?org=<slug>` URL param + cookie. Hidden when the user manages exactly one org.
   - **Loading/empty/error states**: wrap the data fetch in `<DataLoader>` rendering `<LoadingMessage>` / `<ErrorMessage>` / `<EmptyState>` per the rules above.
   - **Status display**: `<StatusBadge variant={domainStatusMap[status]} dot>` — `domainStatusMap` lives next to the page in `components/domainStatusMap.ts`. No hardcoded colors.
   - **Distinct dns_failed vs tls_failed UX**: dns_failed shows the DNS diagnostics card with `[Re-check DNS]`. tls_failed shows the SSL diagnostics card with `[Retry SSL]` and `[Re-check DNS]` (both reachable). Copy makes clear which is the customer's problem to fix vs ours.
   - Page metadata with `requireAuth: true`, `requireFeatures: ['customer_accounts.domain.manage']`
   - **All write operations** wrapped in `useGuardedMutation(...).runMutation(...)` — no raw `apiCall` for POST/PUT/PATCH/DELETE
   - **4-step stepper indicator** (Register → DNS → SSL → Live) with state-driven progression. Wrapped in `useRegisteredComponent('section:customer_accounts.domain-settings:stepper', DefaultStepper)` for extensibility.
   - Hostname input form with client-side zod validation
   - **CNAME instruction card** wrapped in `useRegisteredComponent('section:customer_accounts.domain-settings:dns-config', DefaultDnsConfig)` — replaceable by Cloudflare integration module
   - **Status badge** wrapped in `useRegisteredComponent('section:customer_accounts.domain-settings:status', DefaultStatusBadge)`
   - **Auto-polling status display**: "Last checked: {time}" + "Next check in ~{minutes} min" — powered by background worker events
   - **DNS diagnostics card** on `dns_failed` status: shows `dnsFailureReason`, detected records, expected target, actionable suggestion. **SSL diagnostics card** on `tls_failed` status: shows `tlsFailureReason`, retry count, operator-investigation copy.
   - **Action buttons** wrapped in `useRegisteredComponent('section:customer_accounts.domain-settings:actions', DefaultActions)` — wrappable by enterprise modules
   - **"Check Now" button**: manual trigger for `POST /verify`
   - **"Test Domain" button**: opens `https://{hostname}` in new tab (shown when `active`)
   - **"Change Domain" button**: opens domain swap flow — registers new domain with `replacesDomainId`, shows old domain as "stays live until ready"
   - **"Remove Domain"** with confirmation dialog (`Cmd/Ctrl+Enter` to confirm, `Escape` to cancel), warning text varies based on replacement state
2. Wire real-time updates via `useAppEvent('customer_accounts.domain_mapping.*')` — UI auto-refreshes on background verification events
3. Add settings sidebar navigation via widget injection:
   - Update `widgets/injection-table.ts` with `'menu:sidebar:settings': { widgetId: 'customer_accounts.injection.domain-settings-menu', priority: 30 }`
   - Create `widgets/injection/domain-settings-menu/widget.ts` with `menuItems: [{ id: 'domain-settings', labelKey: 'domainMapping.title', href: '/backend/customer_accounts/settings/domain', icon: 'globe', features: ['customer_accounts.domain.manage'] }]`

### Phase 5: Background DNS Verification & Auto-Activation

**Goal:** Automatic DNS polling for pending/failed domains, automatic TLS provisioning after verification.

1. Create `customer_accounts/workers/domainVerificationWorker.ts`:
   - Runs on `DOMAIN_AUTO_VERIFY_INTERVAL_SECONDS` interval (default every 5 min)
   - Queries `findPendingVerification()` — all domains with status `pending` or `dns_failed` where `last_dns_check_at` is older than the interval
   - For each domain: runs DNS check with diagnostics, updates `lastDnsCheckAt`, transitions status
   - On verification success: triggers `healthCheck(id)` to auto-provision TLS and transition to `active`
   - Emits events for each transition (triggers real-time UI updates + in-app notifications)
2. Register worker in `customer_accounts/workers/` with metadata: `{ queue: 'domain-verification', id: 'customer_accounts:domain-verification', concurrency: 1 }` (follows `WorkerMeta` type from `@open-mercato/queue`)
3. Create `domainMappingService.healthCheck(id)`:
   - Makes HTTPS GET to `https://{hostname}` to verify Traefik has provisioned TLS cert
   - On success (valid TLS): calls `activate(id)` — transitions to `active`, handles domain swap auto-removal
   - On failure: retries up to 3 times with exponential backoff (1s, 4s, 16s). If all retries fail: transitions to `tls_failed`, sets `tlsFailureReason` and `tlsRetryCount`, emits `customer_accounts.domain_mapping.tls_failed`.
4. Create `customer_accounts/workers/domainTlsRetryWorker.ts` — separate worker, longer cadence:
   - Metadata: `{ queue: 'domain-tls-retry', id: 'customer_accounts:domain-tls-retry', concurrency: 1 }`
   - Runs on `DOMAIN_TLS_RETRY_INTERVAL_SECONDS` (default 1800s = 30 min)
   - Queries `findPendingTls()` — domains with status `verified` (still waiting for first cert) or `tls_failed` with `tls_retry_count < DOMAIN_TLS_MAX_RETRIES` (default 6)
   - **Worker-level rate limit**: processes at most `DOMAIN_TLS_RETRY_BATCH` (default 50) domains per run. If more are pending, the rest wait for the next interval. Prevents overwhelming Let's Encrypt or Traefik during a brief outage that affected many domains at once.
   - **Worker-level backoff**: if any single run sees ≥ `DOMAIN_TLS_RETRY_FAILURE_THRESHOLD` (default 80%) of attempted health checks fail, the worker doubles its next interval (capped at 6h). Resets on a successful run. This mitigates Let's Encrypt account-level rate limits triggering across the board.
   - Domains exceeding `DOMAIN_TLS_MAX_RETRIES` are NOT retried by the worker — they require operator intervention (UI "Retry SSL" or runbook escalation). They emit a `customer_accounts.domain_mapping.tls_failed` notification with severity bumped to surface the operator action.
5. End-to-end testing: register domain → background DNS worker detects DNS → auto-verify → TLS retry worker provisions cert → auto-activate

### Testing Strategy

**Test infrastructure for fake Host headers:**

Custom-domain integration tests need to drive requests with arbitrary `Host` headers (e.g., `shop.acme.com`) without modifying `/etc/hosts` or doing real DNS. The chosen strategy:

- Add a test-only header `X-Force-Host: shop.acme.com` that the middleware honors **only when `process.env.NODE_ENV === 'test'` AND the request also carries `X-Force-Host-Secret: <test-secret>`**. In all other modes the header is ignored, preventing prod abuse.
- Playwright integration tests set both headers via `page.setExtraHTTPHeaders({...})` per test fixture.
- Direct API tests (Jest/`fetch`) set the headers in the request init.
- The middleware MUST log a single line at boot: `domain-routing: X-Force-Host enabled (NODE_ENV=test)` so misconfiguration is loud.
- A unit test asserts that `X-Force-Host` is ignored when `NODE_ENV !== 'test'` even if the secret matches.

**Integration tests** (Playwright):
- Register a custom domain via API → verify record created with `pending` status
- Trigger DNS verification (mock DNS resolution) → verify status transitions and diagnostic payload
- Verify DNS verification returns actionable diagnostics on failure (wrong target, no record, timeout)
- Verify domain-check endpoint returns 200 for verified domains, 404 for unknown, 403 for missing secret
- Verify domain-resolve endpoint returns correct tenant/org data, 403 for missing secret
- Verify domain-resolve/all batch endpoint returns all active domains
- Verify Node Middleware rewrites custom domain URLs to portal routes
- Verify Node Middleware serves stale cache entries during background refresh
- Verify platform domain traffic is unaffected
- Verify removing a domain returns 404 on subsequent resolve
- Verify duplicate hostname registration is rejected
- Verify domain swap flow: register replacement → old domain stays active → replacement activates → old domain auto-removed
- Verify background verification worker processes pending domains
- Verify TLS health check auto-activates verified domains
- Verify in-app notifications sent on domain lifecycle transitions
- Verify mandatory secrets are enforced (app startup fails without `DOMAIN_CHECK_SECRET` / `DOMAIN_RESOLVE_SECRET`)
- Verify customer login on a custom domain works **without** a `tenantId` in the request body (Host-based resolution)
- Verify customer login on a platform domain still requires `tenantId` (backward compatibility)
- Verify customer login with a *mismatched* `tenantId` in body on a custom domain returns 400
- Verify JWT issued on `shop.acme.com` is rejected when replayed on `other.acme.com` (host-tenant binding)
- Verify host-only cookies are not sent across hosts (cookie scope test)
- Verify magic-link/password-reset/signup routes also accept Host-based tenant resolution (Phase 1.5 shared `resolveTenantContext` helper)
- Verify the TLS-retry worker honors `DOMAIN_TLS_RETRY_BATCH` cap and the worker-level backoff multiplier on high failure rate
- Verify `X-Force-Host` is honored only when `NODE_ENV=test` and ignored in production builds

**Unit tests:**
- Hostname validation schema (valid/invalid cases)
- Domain status lifecycle transitions (all valid and invalid transitions)
- Stale-while-revalidate cache behavior: fresh hit, stale hit with background refresh, cold miss
- Negative cache TTL behavior (unknown hostnames cached for 5 min)
- LRU eviction when max entries exceeded
- Batch warm-up populates cache correctly
- Platform domain detection logic
- DNS diagnostic message generation (wrong target, no record, timeout)
- Domain swap service-level enforcement (max 2 per org)

## Risks & Impact Review

### Data Integrity Failures

#### Concurrent Domain Registration Race Condition
- **Scenario**: Two organizations attempt to register the same hostname simultaneously. Without proper constraint enforcement, both could succeed, creating conflicting mappings.
- **Severity**: Medium
- **Affected area**: `DomainMapping` table, domain resolution
- **Mitigation**: Database-level UNIQUE constraint on `hostname` column. The second INSERT fails with a constraint violation, which the service catches and returns a `409` error. First-come-first-served.
- **Residual risk**: None — database constraint is authoritative.

#### Domain Deletion During Active Traffic
- **Scenario**: Admin removes a custom domain while end customers are actively using it. In-flight requests may fail or get 404s.
- **Severity**: Low
- **Affected area**: End customer portal access
- **Mitigation**: Confirmation dialog warns admin. Cache TTL of 60s means existing cached entries continue serving for up to 1 minute after deletion. After cache expires, new requests get 404.
- **Residual risk**: Acceptable — admin explicitly chose to remove the domain. Up to 60s of stale routing is a feature (graceful drain), not a bug.

### Cascading Failures & Side Effects

#### Middleware Cache Fetch Failure
- **Scenario**: The Node Middleware cannot reach the `domain-resolve` endpoint (app crash, network issue). All custom domain requests fail.
- **Severity**: High
- **Affected area**: All custom domain portal traffic
- **Mitigation**: Stale-while-revalidate means existing cached entries continue serving even when the resolve endpoint is unreachable — stale data is better than no data. If the internal fetch fails, the background refresh silently retries on the next request. Only cold misses (domains not in cache at all) return 503. Batch warm-up on startup ensures the cache is pre-populated, so cold misses should be rare. Platform-domain traffic is completely unaffected (separate code path).
- **Residual risk**: Custom domain downtime only if: (a) the domain was never cached (e.g., registered while the app was down) AND (b) the resolve endpoint is unreachable. Acceptable edge case.

#### Thundering Herd After Deploy/Restart
- **Scenario**: Multiple Next.js instances restart simultaneously (deploy, scaling event). Each instance starts with an empty cache and simultaneously calls the batch warm-up endpoint, causing a spike of DB queries.
- **Severity**: Medium
- **Affected area**: Database load, application startup time
- **Mitigation**: The batch warm-up endpoint (`domain-resolve/all`) is a single query returning all active domains — no per-domain queries. Even with N instances calling simultaneously, the DB handles N identical SELECT queries (no writes, no locks). The response is small (~300 bytes × domain count) and fast. For large deployments, a rolling restart strategy is recommended.
- **Residual risk**: At very high instance counts (50+) with 10,000+ domains, the simultaneous batch queries could briefly spike DB connections. Mitigated by connection pooling and the fact that it's a single read-only query per instance.

#### DNS Verification False Positive
- **Scenario**: A CNAME is temporarily cached by the DNS resolver but the tenant hasn't actually configured it. Domain transitions to `verified` prematurely.
- **Severity**: Low
- **Affected area**: Domain lifecycle, TLS certificate issuance
- **Mitigation**: Traefik's own TLS-ALPN-01 challenge independently validates domain control before issuing a certificate. Even if our DNS check gives a false positive, Let's Encrypt won't issue a cert unless the domain actually resolves to our server.
- **Residual risk**: Negligible — dual verification (our DNS check + ACME challenge).

### Tenant & Data Isolation Risks

#### Cross-Tenant Domain Hijacking
- **Scenario**: Tenant B registers a domain that belongs to Tenant A's brand, attempting to phish Tenant A's customers.
- **Severity**: High
- **Affected area**: End customer trust, platform reputation
- **Mitigation**: CNAME verification ensures the domain actually points to our server. The domain owner (DNS admin) must explicitly create the CNAME record. Without DNS control, registration stays in `pending` and no traffic is served. The `hostname` unique constraint prevents claiming a domain already in use.
- **Residual risk**: A domain owner could point their domain at our server maliciously. This is inherent to CNAME-based verification and accepted by Shopify, Vercel, and all major platforms. Abuse can be handled operationally by revoking domain mappings.

#### Domain Mapping Leaks Organization Data Cross-Tenant
- **Scenario**: A bug in the resolve endpoint returns org data for a different tenant.
- **Severity**: Critical
- **Affected area**: Tenant data isolation
- **Mitigation**: `resolveByHostname` is a single-row lookup by `hostname` (unique). It returns the tenant and org that own that exact hostname. There is no tenant-scoped filtering needed because the hostname itself IS the scoping key — each hostname maps to exactly one tenant+org pair. No cross-tenant query is possible.
- **Residual risk**: None — hostname uniqueness is the isolation boundary.

### Migration & Deployment Risks

#### New Middleware Breaks Existing Routes
- **Scenario**: The new `middleware.ts` file inadvertently intercepts or modifies platform-domain requests, breaking existing functionality.
- **Severity**: Critical
- **Affected area**: All platform routes (backend, API, portal)
- **Mitigation**: The middleware's first check is whether the Host is a platform domain. If yes, it returns `NextResponse.next()` immediately — zero processing. Platform domains are configurable via `PLATFORM_DOMAINS` env var with a sensible default. Integration tests verify platform-domain traffic is unaffected.
- **Residual risk**: Misconfigured `PLATFORM_DOMAINS` could cause issues. Mitigated by clear documentation and a default value that includes `localhost`.

#### Traefik Misconfiguration Blocks All Traffic
- **Scenario**: Incorrect Traefik config (wrong ports, bad ACME config) prevents all HTTP/HTTPS traffic from reaching the application.
- **Severity**: High
- **Affected area**: Entire application availability
- **Mitigation**: Traefik is opt-in — not required for existing deployments. Configuration is provided as a reference with documented variables. Development continues to work without Traefik (direct app access). Health check endpoint ensures Traefik can detect app availability.
- **Residual risk**: Operator must validate Traefik config before production deployment. Standard ops concern.

### Operational Risks

#### Let's Encrypt Rate Limits
- **Scenario**: Rapid domain registration triggers Let's Encrypt rate limits (50 certificates per registered domain per week). Enterprise tenants with many regional subdomains under one root (e.g., `store-us.brand.com`, `store-eu.brand.com`, ..., `store-asia.brand.com`) could hit this limit.
- **Severity**: Medium
- **Affected area**: New domain TLS provisioning for tenants with 50+ subdomains under one registered domain
- **Mitigation**: The verification endpoint prevents certificate requests for unregistered domains (no abuse vector). For most tenants, each custom domain is a unique registered domain, so the per-domain rate limit is not a concern. For enterprise tenants with many subdomains: (1) document this as a known limitation, (2) use Let's Encrypt staging environment for development/testing, (3) monitor certificate issuance counts via Traefik logs, (4) alert platform operators when approaching 40 certs/week for a single registered domain.
- **Residual risk**: A tenant with 50+ subdomains per week would need to space out domain registrations. This is an edge case but should be documented in operator runbook.

#### In-Memory Cache Memory Growth
- **Scenario**: Large number of unique hostnames (valid or invalid) fill the in-memory cache, causing memory pressure in the middleware.
- **Severity**: Low
- **Affected area**: App memory usage per process
- **Mitigation**: Cache is bounded with a configurable max-entries limit (default 10,000). LRU eviction removes least-recently-accessed entries when the limit is exceeded. Negative lookups (unknown hostnames) are cached with a longer TTL (5 min) to absorb probing attacks without repeated DB queries. At ~300 bytes per entry, 10,000 entries = ~3MB per process — acceptable for any deployment.
- **Residual risk**: None at expected scale. The 3MB budget is negligible compared to typical Next.js process memory (200-500MB).

#### Domain Resolve Endpoint Abuse
- **Scenario**: The `domain-resolve` and `domain-resolve/all` endpoints are called with invalid or missing secrets, either by an attacker probing for domain information or by a misconfigured middleware instance.
- **Severity**: Medium
- **Affected area**: Data exposure, DB load
- **Mitigation**: Both endpoints require a mandatory `X-Domain-Resolve-Secret` header matching `DOMAIN_RESOLVE_SECRET` env var. Requests with missing or incorrect secrets receive `403 Forbidden` with no data. The app refuses to start if `DOMAIN_RESOLVE_SECRET` is not set. Negative caching (5 min TTL) in the middleware prevents repeated queries for unknown hostnames even if the endpoint is accessible.
- **Residual risk**: If the secret is compromised, an attacker could enumerate all active domains. The data exposed (hostname, orgSlug, tenantSlug) is low-sensitivity. Secret rotation requires a coordinated deploy of app + middleware config.

#### Per-Domain Cookie Confusion
- **Scenario**: A customer logs in on `openmercato.com/acme/portal`, then visits `shop.acme.com` and sees an unauthenticated page. They report "your site logged me out".
- **Severity**: Low (UX, not security)
- **Affected area**: Customer portal sign-in experience
- **Mitigation**: Document the per-domain session model in customer-facing help. The settings page warns admins during domain swap. Customer portal login pages display *"Sign in to {hostname}"* so the host context is explicit. Long-term, an opt-in cross-domain SSO (federated login on the platform domain handing tokens to custom domains) is a future consideration but explicitly out of scope for this spec.
- **Residual risk**: Some customer support tickets during early rollouts. Acceptable given the security and complexity savings of host-only cookies.

#### Cross-Host JWT Replay Attempt
- **Scenario**: An attacker obtains a JWT issued on `shop.acme.com` and attempts to replay it on `other.acme.com` (another tenant's domain).
- **Severity**: Critical if it worked
- **Affected area**: Tenant data isolation
- **Mitigation**: API handlers resolve tenant by Host header (via `domainMappingService.resolveByHostname`) and assert `JWT.tenantId === resolvedTenantId`. Mismatch returns 401. The host is the authoritative scoping key — the cookie alone does not grant access. Documented as the cross-host invariance rule in the Customer Authentication section.
- **Residual risk**: None — host resolution and JWT scope are both required to match.

#### Shared `CUSTOM_DOMAIN_A_RECORD_TARGET` IP Bypass
- **Scenario**: The operator sets `CUSTOM_DOMAIN_A_RECORD_TARGET` to a shared IP (e.g., a CDN edge IP or a load balancer also serving unrelated services). An attacker registers a domain that already points at that shared IP for unrelated reasons; the A-record verifier passes without the domain owner having actually opted in to our platform.
- **Severity**: High
- **Affected area**: Domain ownership verification, TLS issuance
- **Mitigation**: `CUSTOM_DOMAIN_A_RECORD_TARGET` MUST be a dedicated IP (operator runbook explicit). Documentation calls this out in the env-var description. A startup check warns (logs `WARN`) if the configured A-record target falls inside a `KNOWN_PROXY_IP_RANGES` CIDR — that is a strong signal the operator picked a shared IP. Reverse-resolve over HTTPS provides defense in depth (an attacker pointing at a shared CDN IP won't reach our origin), but the cleanest mitigation is a dedicated IP.
- **Residual risk**: Operator misconfiguration. Standard ops concern; mitigated by docs + startup warning.

#### Apex-Domain Misregistration
- **Scenario**: A tenant attempts to register an apex domain (`acme.com`) without `CUSTOM_DOMAIN_A_RECORD_TARGET` configured by the operator. The verifier fails repeatedly with confusing errors.
- **Severity**: Low
- **Affected area**: Onboarding UX
- **Mitigation**: When `CUSTOM_DOMAIN_A_RECORD_TARGET` is unset, the verifier returns a `dns_failed` with copy *"Apex-domain registration is not enabled on this deployment. Use a subdomain (shop.acme.com) instead, or contact the platform operator."* The hostname validator may also reject apex registration up-front when the env var is missing — TBD by operator preference.
- **Residual risk**: None.

#### Hostname Normalization Bypass via Direct DB Insert
- **Scenario**: A migration or admin DB tool inserts a `DomainMapping` with a non-normalized hostname (`Shop.Acme.com`). Lookups via the normalizer ignore the row; the row is effectively orphaned.
- **Severity**: Low
- **Affected area**: Data hygiene
- **Mitigation**: A Postgres `CHECK` constraint enforces `hostname = lower(hostname)` and absence of trailing dot. A startup migration scans existing rows and normalizes any stragglers (no-op on a fresh deployment). Code paths can no longer insert non-normalized rows because the validator is the only entry point.
- **Residual risk**: Operator using raw SQL outside the constraint. Standard ops concern.

#### Cloudflare-Proxied Customer Bypassing Verification
- **Scenario**: A tenant points their domain at Cloudflare which forwards to an attacker-controlled origin, then registers it claiming ownership. Reverse-resolve fails (does not return our origin header), so registration stays in `dns_failed` — but the tenant complains.
- **Severity**: Low (operational)
- **Affected area**: Onboarding support load
- **Mitigation**: Verifier copy explicitly explains the proxy case and offers two fixes: (a) disable the proxy (grey cloud), (b) configure the proxy to forward to `portal.openmercato.com`. Operator runbook documents the diagnostic header.
- **Residual risk**: None — verification is fail-closed.

#### Domain Swap Race Condition
- **Scenario**: Admin starts a domain swap (registers replacement), but another admin simultaneously removes the original domain or starts a different replacement.
- **Severity**: Low
- **Affected area**: Domain swap lifecycle consistency
- **Mitigation**: `replaces_domain_id` has a UNIQUE constraint — only one replacement can be pending per target domain. Service-level validation enforces max 2 domains per org. If the original domain is removed while a replacement is pending, the `ON DELETE SET NULL` FK action clears `replaces_domain_id`, and the replacement continues as a standalone registration.
- **Residual risk**: Edge case where two admins act simultaneously on the same domain. The DB constraints prevent data corruption; the worst outcome is a confusing but recoverable state.

## Final Compliance Report — 2026-04-30 (rev 5)

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customer_accounts/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `DomainMapping` references `Tenant` and `Organization` via FK IDs. These are `directory` entities but the references are FK-only, consistent with how `customer_accounts` already references `organizations` in `CustomerUser`. |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | Admin API routes scope by tenant (from auth). `organization_id` unique constraint ensures one domain per org. |
| root AGENTS.md | Never expose cross-tenant data from API handlers | Compliant | `resolveByHostname` is keyed by unique hostname — no tenant parameter needed. Admin routes filter by auth tenant context. |
| root AGENTS.md | Validate all inputs with zod | Compliant | `registerDomainSchema` and `hostnameSchema` defined in `data/validators.ts` |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | `domainMappingService` registered in `di.ts` |
| root AGENTS.md | Event IDs: `module.entity.action` (singular entity, past tense) | Compliant | `customer_accounts.domain_mapping.created`, `.verified`, `.activated`, `.failed`, `.deleted` |
| packages/core AGENTS.md | CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` | Compliant (with documented opt-out) | Admin domain-mappings route uses `makeCrudRoute` with `enrichers: { entityId: 'customer_accounts.domain_mapping' }`. The `indexer` field is **intentionally omitted** because hostnames are tenant-private and must not be in a platform-wide search index. Verified `indexer?` is optional at `factory.ts:424`, so omission is the supported opt-out. Specialty routes (verify, health-check, domain-check, domain-resolve) are custom. |
| packages/core AGENTS.md | API routes MUST export `openApi` | Compliant | All API routes include `openApi` export |
| packages/core AGENTS.md | Response enrichers: declare in `data/enrichers.ts` | Compliant | Organization entity enricher declared with `enrichMany()` batch optimization |
| packages/core AGENTS.md | Widget injection: declare in `widgets/injection/`, map via `injection-table.ts` | Compliant | Settings menu item injected via `menu:sidebar:settings` spot with feature gating |
| packages/core AGENTS.md | Component replacement: use handle-based IDs (`section:*`) | Compliant | 4 component handles declared for settings page extensibility |
| packages/core AGENTS.md | Notifications: types in `notifications.ts`, subscribers use `buildFeatureNotificationFromType` | Compliant | 3 notification types (verified, activated, failed) with persistent subscribers |
| packages/cache AGENTS.md | Cache: resolve via DI, scope to tenant, use tags | Compliant | Server-side cache uses `domain_routing:{hostname}` keys with tag-based invalidation via ephemeral subscriber |
| packages/ui AGENTS.md | Wrap writes in `useGuardedMutation().runMutation()` | Compliant | Settings page uses `useGuardedMutation` for all write operations |
| packages/core AGENTS.md | setup.ts: declare `defaultRoleFeatures` when adding features to acl.ts | Compliant | `customer_accounts.domain.manage` added to `superadmin` and `admin` roles in `setup.ts` |
| packages/core AGENTS.md | Events: use `createModuleEvents()` with `as const` | Compliant | Events added to existing `eventsConfig` in `events.ts` |
| packages/ui AGENTS.md | Every dialog: Cmd/Ctrl+Enter submit, Escape cancel | Compliant | Remove domain confirmation dialog follows this pattern |
| packages/ui AGENTS.md | Use `Button` from `@open-mercato/ui`, never raw `<button>` | Compliant | Specified in UI/UX section |
| packages/shared AGENTS.md | i18n: `useT()` client-side | Compliant | All user-facing strings use locale keys |
| packages/events AGENTS.md | `clientBroadcast: true` for DOM Event Bridge | Compliant | All domain mapping events use `clientBroadcast: true` |
| root AGENTS.md | Keep `pageSize` at or below 100 | N/A | Domain mappings list is per-org (max 1 in MVP) |
| root AGENTS.md | Backward Compatibility Contract | Compliant | No existing surfaces modified. All additions are new: new entity, new API routes, new middleware file, new events. |

| packages/queue AGENTS.md | Workers: export handler + metadata with `{ queue, id?, concurrency? }` | Compliant | `domainVerificationWorker` exports metadata with `{ queue: 'domain-verification', concurrency: 1 }` |
| root AGENTS.md (DS rules) | Use `StatusBadge` for entity status; never hardcode colors on Badge | Compliant (rev 4) | `domainStatusMap: StatusMap<DomainStatus>` defined; status display uses `<StatusBadge variant={...} dot>`. No hardcoded color classes in the spec. |
| packages/ui AGENTS.md | Every list/data page MUST handle empty state via `<EmptyState>`; every async page MUST show loading state | Compliant (rev 4) | Settings page wraps fetch in `<DataLoader>` with `<LoadingMessage>` / `<ErrorMessage>` / `<EmptyState>`. No-access state also uses `<EmptyState>`. |
| root AGENTS.md (search) | Modules opt out of search indexing when data is tenant-private | Compliant (rev 5) | `DomainMapping` excluded by **omitting the optional `indexer` field** on `makeCrudRoute` (verified at `packages/shared/src/lib/crud/factory.ts:424`). |
| root AGENTS.md (i18n) | No hardcoded user-facing strings | Compliant (rev 4) | DNS/TLS/diagnostic copy uses i18n keys; `domainMapping.notification.dnsFailed` and `tlsFailed` added. |
| Backward Compatibility Contract — Type definitions | Status enum is additive (renaming `failed` → `dns_failed` + new `tls_failed`) | Compliant — pre-implementation | Spec is unimplemented; the rename is an in-spec change, not a deployed contract change. The migration ships the final shape; no live deployments rely on the old `failed` value. |
| Customer Authentication on Custom Domains | Host-resolved tenant context is the authoritative scope; JWT scope must match host | Compliant (rev 4) | Documented in the Customer Authentication section + Cross-Host JWT Replay risk entry. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `DomainMapping` fields map 1:1 to API response fields. `cnameTarget` is computed from env var, not stored. New fields (`lastDnsCheckAt`, `dnsFailureReason`, `replacesDomainId`) reflected in verify response and diagnostics payload. |
| API contracts match UI/UX section | Pass | Settings page uses all CRUD endpoints. Stepper wizard maps to status lifecycle. Verify, health-check, remove, and domain swap actions map to specific API routes. |
| Risks cover all write operations | Pass | Register, verify, activate, remove, and domain swap all have risk scenarios. Thundering herd, endpoint abuse, and swap race condition added. |
| Service methods defined for all mutations | Pass | `register`, `verify`, `activate`, `remove`, `healthCheck`, `resolveAll`, `findPendingVerification` cover all operations. |
| Cache strategy covers all read APIs | Pass | Two-tier cache: `@open-mercato/cache` (server-side, shared, tag-invalidated) for `domain-resolve` and `domain-check` endpoints. In-memory stale-while-revalidate (Node Middleware, per-process) with batch warm-up. Event-driven invalidation via ephemeral subscriber. |
| Mandatory secrets enforced | Pass | Both `DOMAIN_CHECK_SECRET` and `DOMAIN_RESOLVE_SECRET` are required. App fails to start without them. All internal endpoints validate secrets. |
| Platform integration completeness | Pass | Uses `makeCrudRoute` (CRUD factory), mutation guards (extensible validation), response enrichers (Organization entity), `@open-mercato/cache` (server-side caching), notification system (`notifications.ts` + subscribers), widget injection (`menu:sidebar:settings`), component handles (`useRegisteredComponent`), `useGuardedMutation` (UI writes), `emitCrudSideEffects` (event emission). No custom duplicates of platform infrastructure. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant (rev 5)** — ready for implementation.

**rev 5 closes all critical and important findings from `.ai/specs/analysis/ANALYSIS-2026-04-08-portal-custom-domain-routing.md`:**

1. Cookie names corrected to match the actual codebase (`customer_auth_token` + `customer_session_token`).
2. New Phase 1.5 defines the customer-auth host-awareness work: relaxed login schema, shared `resolveTenantContext` helper, host-bound `getCustomerAuthFromCookies`. Backward compatible for platform-domain clients.
3. Indexer opt-out idiom verified against `factory.ts:424` — omit the optional field.
4. Email migration scope narrowed to actual call sites; forward-looking rule added to module AGENTS.md.
5. `x-next-url` source verification is now an explicit Phase 2 pre-task.
6. Dedicated TLS-retry worker with worker-level rate limiting and backoff multiplier.
7. `CUSTOM_DOMAIN_A_RECORD_TARGET` documented as MUST be dedicated; new risk entry for shared-IP bypass.
8. Playwright Host-faking via test-only `X-Force-Host` gated by `NODE_ENV` + secret.
9. Integration tests added for all new behaviors.

**rev 4 outcomes preserved:**
1. Per-domain host-only customer cookies.
2. Node Middleware (`runtime: 'nodejs'`, Next.js ≥ 15.2 — repo is 16.2.4).
3. Apex via A record + Cloudflare-proxy reverse-resolve fallback.
4. Hostname normalization (Punycode/IDN/case/trailing-dot).
5. Status enum split (`dns_failed` + `tls_failed`).
6. Multi-org switcher.
7. Search-index opt-out.
8. DS tokens + StatusBadge.
9. Empty/loading/error states.
10. Canonical URLs + email-domain awareness.

## Changelog

### 2026-04-30 (rev 5) — Pre-implementation audit fixes

Resolves the 3 critical findings + 6 important gaps from `.ai/specs/analysis/ANALYSIS-2026-04-08-portal-custom-domain-routing.md`:

- **Cookie names corrected**: spec now references the real cookies `customer_auth_token` (JWT, 8h) and `customer_session_token` (opaque session, 30d) instead of the non-existent `om_customer_session`. Both are already host-only by default — the per-domain isolation model "just works" without additional cookie attribute changes.
- **Login flow defined (new Phase 1.5)**: `loginSchema.tenantId` becomes optional. New `resolveTenantContext(req, bodyTenantId)` helper. On platform domains → require body `tenantId` (backward compatible). On custom domains → resolve via `domainMappingService.resolveByHostname(host)`, reject mismatched body `tenantId`. Same logic applied to signup, magic-link, password-reset routes via the shared helper.
- **Indexer opt-out fixed**: `indexer?` is optional in `CrudRouteConfig` (verified at `packages/shared/src/lib/crud/factory.ts:424`). Spec now says "omit the field" instead of the invalid `indexer: { entityType: null }`.
- **`getCustomerAuthFromCookies` host binding**: explicit Phase 1.5 task to extend the helper with an optional `expectedTenantId`. New `getCustomerAuthForHost(req)` convenience wrapper. Backward compatible.
- **Email migration scope narrowed**: only `customer_accounts/api/signup.ts` currently sends customer-portal email (verified). `urlForCustomerOrg` migration covers just those two `sendEmail` call sites. Forward-looking rule added to `customer_accounts/AGENTS.md` for future email senders.
- **`x-next-url` source verification**: Phase 2 starts with a pre-task confirming what currently sets this header (today no `middleware.ts` exists yet `(frontend)/layout.tsx` reads it) and ensuring the new middleware preserves or replaces the mechanism cleanly.
- **TLS-retry worker rate limiting**: new dedicated `domainTlsRetryWorker` separate from the DNS verification worker. Worker-level rate limit (`DOMAIN_TLS_RETRY_BATCH`, default 50/run), worker-level backoff multiplier when failure rate ≥80%, per-domain max retries (`DOMAIN_TLS_MAX_RETRIES`, default 6) before requiring operator action.
- **Dedicated A-record IP requirement**: `CUSTOM_DOMAIN_A_RECORD_TARGET` MUST be a dedicated IP, not a shared CDN/load-balancer IP. New risk entry. Startup warning when the configured IP falls inside `KNOWN_PROXY_IP_RANGES`.
- **Playwright Host-faking strategy**: test-only `X-Force-Host` header gated by `NODE_ENV === 'test'` AND a shared secret. Documented in Testing Strategy with explicit unit test for the prod-mode safety.
- **New integration tests**: custom-domain login without body `tenantId`, platform-domain login still requires it, mismatched-tenantId 400, JWT cross-host replay rejection, host-only cookie scope, TLS retry worker batching/backoff, `X-Force-Host` ignored in non-test builds.

### 2026-04-30 (rev 4) — Architecture & UX hardening

- **Per-domain customer cookies**: Custom domains use host-only cookies (no `Domain=` attribute). Login form posts to the same custom domain. Customers logging in on `openmercato.com` and on `shop.acme.com` have separate sessions. JWT validation runs against the host-resolved org context — no cross-host leakage. During domain swap, customers on the old domain stay authenticated until the old domain is removed; visitors to the new domain log in on the new domain.
- **Middleware runtime pinned to Node**: `apps/mercato/src/middleware.ts` runs on Next.js Node Middleware (`runtime: 'nodejs'`) with Next.js ≥ 15.2 as a hard requirement. Edge runtime explicitly rejected — V8 isolates do not share module state reliably across cold starts, breaking the SWR cache and batch warm-up.
- **Apex domain support via A record**: Tenants can register apex domains (`acme.com`) by pointing an A record to `CUSTOM_DOMAIN_A_RECORD_TARGET` (server IP). Subdomains continue to use CNAME. Verification tries CNAME first, falls back to A record.
- **Cloudflare/proxy fallback**: When A record resolves to a known proxy IP range (Cloudflare, Fastly), DNS verification falls back to a reverse-resolve HTTPS request to confirm traffic actually reaches our server.
- **Hostname normalization**: All input hostnames are lowercased, trailing-dot trimmed, and converted from IDN (Unicode) to Punycode (ASCII) before storage and lookup. Validators enforce the 253-char DNS limit and reject empty/invalid output.
- **Split status states**: `failed` is renamed to `dns_failed`. New `tls_failed` state added for TLS health-check failures. Distinct lifecycle edges and recovery paths for each. UI surfaces the difference (DNS issue vs SSL issue).
- **Multi-org org switcher**: Settings page `/backend/customer_accounts/settings/domain` includes an org switcher dropdown for multi-org tenants. Single-org tenants render no switcher.
- **Search indexing opt-out**: `DomainMapping` excluded from search index via `indexer: { entityType: null }` on `makeCrudRoute`. Hostnames must not be searchable cross-tenant.
- **DS tokens applied**: Status display uses `StatusBadge` + a `domainStatusMap: StatusMap<DomainStatus>` per `AGENTS.md`. No hardcoded color names anywhere in the spec.
- **Empty / loading / error states**: Settings page renders `<LoadingMessage>` while fetching, `<EmptyState>` when no domain is configured, `<ErrorMessage>` on fetch failure — per `packages/ui/AGENTS.md`.
- **Canonical URL & email domains**: Portal pages emit canonical URLs based on the request `Host` header (custom domain when present). Customer-portal transactional emails (magic link, password reset, notifications) call `domainMappingService.resolveActiveByOrg(orgId)` and use the active custom domain when one exists, else the platform domain.

### 2026-04-08 (rev 3) — Platform integration & UMES alignment
- **`makeCrudRoute`**: Admin domain-mappings CRUD (list/create/delete) now uses the CRUD factory for enricher pipeline, interceptor pipeline, and consistent API shape. Specialty endpoints (verify, health-check, domain-check, domain-resolve) remain custom routes.
- **`emitCrudSideEffects`**: All service write methods use `emitCrudSideEffects` for consistent event emission, cache invalidation, and search indexing. Command pattern (`registerCommand`) explicitly rejected — domain operations are not undoable (undo would leave dangling DNS records, orphaned TLS certificates, and stale CNAME pointers).
- **Mutation guards**: Hostname format, uniqueness, and org limit validation moved from service internals to `data/guards.ts`. Extensible by enterprise modules (e.g., domain allowlists at priority 25).
- **Response enricher**: Organization entity enriched with `_customDomain: { hostname, status }` via `data/enrichers.ts`. Batch `enrichMany()` prevents N+1.
- **Two-tier cache**: Added `@open-mercato/cache` (server-side, shared across instances, tag-invalidated) as Tier 1. `domain-resolve` and `domain-check` endpoints read from server cache before DB. Ephemeral subscriber invalidates tags on domain lifecycle events. Edge Middleware in-memory cache remains as Tier 2 on top.
- **Notification system**: Full `NotificationTypeDefinition[]` in `notifications.ts` for 3 lifecycle events (verified, activated, failed). Persistent subscribers use `buildFeatureNotificationFromType()` + `notificationService.createForFeature()`. Client renderers in `notifications.client.ts`.
- **Widget injection for settings nav**: Settings sidebar link uses `menu:sidebar:settings` injection spot with widget + `features: ['customer_accounts.domain.manage']` gating. Not a manual link.
- **Component handles (UMES)**: 4 `useRegisteredComponent` handles declared on settings page (`section:customer_accounts.domain-settings:{status,dns-config,actions,stepper}`) for enterprise extensibility.
- **`useGuardedMutation`**: All settings page writes wrapped in `useGuardedMutation().runMutation()`.
- **Worker metadata**: Added `id: 'customer_accounts:domain-verification'` field to worker metadata for auto-discovery compliance.
- **Cache invalidation subscriber**: `subscribers/invalidate-domain-cache.ts` (ephemeral) invalidates `@open-mercato/cache` tags on any domain lifecycle event.
- **`yarn generate` scope**: Explicitly noted which generated files are affected (enrichers, guards, injection-tables, notifications, workers).

### 2026-04-08 (rev 2) — Enterprise performance & UX hardening
- **Cache architecture**: Replaced naive TTL Map with stale-while-revalidate pattern + batch warm-up on process start. Raised max entries from 1,000 → 10,000 (configurable). Added negative caching with 5 min TTL for unknown hostnames.
- **Mandatory secrets**: `DOMAIN_CHECK_SECRET` and `DOMAIN_RESOLVE_SECRET` are now required (app refuses to start without them). Removed "optional" / "should be restricted" language.
- **Batch resolve endpoint**: Added `GET /api/customer-accounts/domain-resolve/all` for cache warm-up — prevents thundering herd after deploy.
- **Background DNS verification**: Added `domainVerificationWorker` — auto-polls pending/failed domains every 5 min. Admins no longer need to manually click "Verify Now" repeatedly.
- **DNS diagnostics**: `verify` endpoint now returns `dnsFailureReason`, `detectedRecords`, and actionable `suggestion`. UI shows specific errors ("CNAME points to wrong-target.example.com") instead of generic "DNS Verification Failed."
- **Auto TLS provisioning**: `verified → active` transition is now automatic via `healthCheck()` — no "first HTTPS visit" required. Background health check with exponential backoff retries.
- **Guided stepper UI**: Replaced flat status display with 4-step progress wizard (Register → DNS → SSL → Live). Added DNS provider quick-links (Cloudflare, GoDaddy, Namecheap, Google Domains). Added auto-polling indicator with "last checked" timestamp.
- **Domain swap flow**: Zero-downtime domain changes. New domain registered alongside active domain (`replacesDomainId` FK). Old domain auto-removed when replacement reaches `active`. Dropped UNIQUE on `organization_id`, enforced max 2 per org at service level.
- **Preview/test**: Added "Test Domain" button on active domains (opens in new tab).
- **Data model additions**: `replaces_domain_id`, `last_dns_check_at`, `dns_failure_reason` columns. New indexes for background worker queries.
- **Notifications**: In-app notifications on domain lifecycle transitions (verified, active, failed).
- **Risk additions**: Thundering herd, domain resolve endpoint abuse, domain swap race condition, updated Let's Encrypt rate limit analysis for enterprise subdomain scenarios.

### 2026-04-08 (rev 1)
- Initial skeleton with open questions
- Resolved Q1 (Edge Middleware), Q2 (customer_accounts module), Q3 (concrete Traefik config), Q4 (domain IS the portal), Q5 (in-memory Map cache)
- Full specification: architecture, data models, API contracts, UI/UX, implementation plan, risks, compliance
