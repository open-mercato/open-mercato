# Pre-Implementation Analysis: Portal Custom Domain Routing (rev 4)

**Spec:** `.ai/specs/2026-04-08-portal-custom-domain-routing.md`
**Spec revision audited:** rev 4 (2026-04-30)
**Analysis date:** 2026-04-30
**Verdict:** **Needs spec updates first** — 3 critical fixes, then ready for `implement-spec`.

## Executive Summary

The rev 4 spec is architecturally sound and fully compliant with all 13 backward-compatibility surfaces (purely additive — new entity, new events, new ACL, new routes, new notifications, new DI service). All proposed event IDs, ACL features, API paths, notification types, and DI keys are confirmed clear of collisions in `customer_accounts/`.

However, three concrete codebase realities break the spec as written and need to be corrected before any code is written:

1. The customer session cookie name in the spec (`om_customer_session`) does not exist; the real codebase uses two cookies (`customer_auth_token` JWT + `customer_session_token` opaque token), both already host-only.
2. The customer login API currently requires `tenantId` in the request body. The spec assumes Host-only login on custom domains but does not specify how the form discovers `tenantId` — this is a real implementation gap.
3. The proposed search-indexing opt-out idiom `indexer: { entityType: null }` is invalid against `CrudIndexerConfig`, which requires `entityType: string`.

Once these are fixed, the spec is implementable. Next.js 16.2.4 in the repo comfortably exceeds the 15.2 floor for Node Middleware. No `middleware.ts` exists yet, so no collision.

---

## Backward Compatibility

### Violations Found

**None.** All 13 contract surfaces are clean.

| # | Surface | Result |
|---|---------|--------|
| 1 | Auto-discovery file conventions | ✅ Additive only (new files: `data/guards.ts`, `lib/hostname.ts`, `lib/customerUrl.ts`, `lib/proxyRanges.ts`, `services/domainMappingService.ts`, new workers/subscribers) |
| 2 | Type definitions & interfaces | ✅ No public type modifications |
| 3 | Function signatures | ✅ No existing function signatures changed |
| 4 | Import paths | ✅ New helpers only |
| 5 | Event IDs | ✅ 7 new IDs, no renames (verified against `customer_accounts/events.ts` — no overlap) |
| 6 | Widget injection spot IDs | ✅ 4 new component handles (`section:customer_accounts.domain-settings:*`); reuses existing `menu:sidebar:settings` |
| 7 | API route URLs | ✅ All new (no overlap with existing `customer_accounts/api/`) |
| 8 | Database schema | ✅ New `domain_mappings` table; no existing columns modified |
| 9 | DI service names | ✅ `domainMappingService` is new (verified against `customer_accounts/di.ts` — 5 existing services, no overlap) |
| 10 | ACL feature IDs | ✅ `customer_accounts.domain.manage` is new (current: `view`, `manage`, `roles.manage`, `invite`) |
| 11 | Notification type IDs | ✅ 4 new types (current: `user.signup`, `user.locked`) |
| 12 | CLI commands | ✅ None changed |
| 13 | Generated file contracts | ✅ Generators emit new entries to existing files (notifications.generated, workers.generated, etc.) — no shape change |

### Migration & Backward Compatibility Section

The spec's `Migration & Compatibility` section is present and correct. **No deprecation bridge required** — purely additive feature.

The rev 4 in-spec rename (`failed` → `dns_failed` + add `tls_failed`) is **not** a BC concern because the spec is unimplemented; no live code or DB rows reference the old `failed` value.

---

## Spec Completeness

### Missing Sections

**None at the section level.** All required sections present:

- ✅ TLDR & Overview
- ✅ Problem Statement
- ✅ Proposed Solution (with Design Decisions and Alternatives Considered)
- ✅ Architecture (request flows, customer auth, DNS verification algorithm, hostname normalization, cache architecture)
- ✅ Data Models (entity, indexes, status lifecycle, MikroORM class)
- ✅ API Contracts (all endpoints with request/response examples)
- ✅ UI/UX (multi-org switcher, stepper, all 6 wireframe states, components, loading/empty/error states)
- ✅ Risks & Impact Review (5 categories, 13 risk entries)
- ✅ Phasing (5 phases)
- ✅ Implementation Plan (per-phase tasks)
- ✅ Integration Test Coverage (Phase 5 testing strategy)
- ✅ Final Compliance Report
- ✅ Changelog (rev 1–4)

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Architecture › Customer Authentication | Spec describes the JWT replay defense ("API handler reads request `Host`, resolves to tenant, asserts `JWT.tenantId === resolved.tenantId`") but doesn't specify the implementation point. The current `getCustomerAuthFromCookies` (in `customer_accounts/lib/customerAuthServer.ts`) only reads the JWT — it has no Host-aware variant today. | Add an explicit task: "Extend `getCustomerAuthFromCookies` to accept an optional `expectedTenantId` argument and return null when JWT tenant doesn't match. Or add a new `getCustomerAuthForHost(host)` helper that internally resolves the host and asserts. Decide which." |
| Architecture › Customer Authentication | Spec assumes login on `shop.acme.com` "posts to `shop.acme.com/api/customer-accounts/customer/login`" — but the **current** `customer_accounts/api/login.ts` requires `tenantId` in the request body (validated by `loginSchema`). The custom-domain login form has no way to know `tenantId` client-side. | Add a task: either (a) make `tenantId` optional in `loginSchema` and resolve from Host header when absent, (b) server-render a hidden `tenantId` field in the login page based on the resolved host, or (c) introduce a new route `POST /api/customer-accounts/customer/login-by-host`. Pick one and document in the spec. |
| API Contracts | Two cookies are set on login (`customer_auth_token` JWT + `customer_session_token` opaque session). The spec only mentions one (`om_customer_session`, which doesn't exist). | Update the Customer Authentication section to reflect both cookies and explain which one the JWT-replay defense applies to (the JWT cookie). |
| Data Models | `tls_retry_count` is added to the entity but the corresponding `domain_mappings_pending_tls_idx` query (in the partial-index definition) references `(status, updated_at)`. The worker that polls TLS-failed retries needs `tls_retry_count` to bound the retry attempts. The query likely also needs `tls_retry_count` in the index for efficient `WHERE tls_retry_count < 3`. | Either include `tls_retry_count` in the partial index, or document that the worker first queries `WHERE status IN ('verified','tls_failed')` then filters retry count in memory (acceptable at expected scale). |
| Email scope | The Canonical URLs section claims `urlForCustomerOrg` migration covers password reset, magic link, account verified, and notification digest emails. **Reality:** only `customer_accounts/api/signup.ts` currently calls `sendEmail`; password-reset and magic-link email templates don't exist yet. | Narrow the spec's email-migration claim to only the existing call site (`signup.ts`). Note that future email-sending routes MUST also use `urlForCustomerOrg`. |
| Implementation Plan › Phase 4 | The catch-all layout at `apps/mercato/src/app/(frontend)/layout.tsx` already reads `headers().get('x-next-url')` and parses orgSlug via regex from a path. This is the integration point the middleware feeds. | Add a task: "Verify `layout.tsx` correctly handles the rewritten path (`/{orgSlug}/portal/...`). Confirm `x-next-url` is set by the new middleware (or whatever sets it today — verify) and that the rewrite preserves the original Host header for downstream `headers().get('host')` reads (canonical URL emission)." |
| Test Fixtures | Integration tests are listed but Playwright must send arbitrary `Host` headers and intercept TLS to test custom-domain flows. | Add a section to Phase 5 Testing Strategy: how Playwright tests fake the Host (e.g., `--host-resolver-rules`, hosts file, or a test-only `X-Force-Host` header that the middleware honors only when `NODE_ENV=test`). Pick one and document. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `packages/core AGENTS.md` — "CRUD routes: use `makeCrudRoute` with `indexer: { entityType }` for query index coverage" | Phase 1 step 1 says `indexer: { entityType: null }` for search opt-out | The `CrudIndexerConfig` type (in `packages/shared/src/lib/crud/types.ts` lines 23–28) declares `entityType: string` as **required**. There is no `null` opt-out. The spec must either: (a) provide a real `entityType: 'customer_accounts:domain_mapping'` and exclude the entity from the search index via `search.ts` instead, (b) confirm via reading `factory.ts` whether the `indexer` field on `makeCrudRoute` is itself optional (omitting it entirely), or (c) propose adding `entityType: null` support to the type as a separate, documented contract change. **Right now, the spec instructs an invalid TypeScript value.** |
| `packages/core AGENTS.md` — "API routes MUST export `openApi`" | Spec mentions OpenAPI under "All routes export `openApi`" but doesn't enumerate per route | ✅ Mentioned globally (line 711). Acceptable. Phase 1 task 13 should explicitly note "each new API route file exports `openApi`". |
| `packages/ui AGENTS.md` — "Wrap writes in `useGuardedMutation().runMutation()`" | Phase 4 already states this | ✅ Compliant. |
| Cookie name compliance | Spec says `om_customer_session`; reality is `customer_auth_token` + `customer_session_token` | Update spec — see Critical Gaps. |
| Reference for portal injected menu | The spec uses `menu:sidebar:settings` (backend admin) — confirmed exists. Customer-portal sidebar uses `menu:portal:sidebar:account` instead. | Spec is correct: the domain settings link is for staff users in the backend, not customer portal users. No change needed. |

### Spec-internal compliance

The spec's own Final Compliance Report (rev 4) claims all rules pass. Most are correct, but: the indexer opt-out claim is wrong, and "all email templates use `urlForCustomerOrg`" is overscoped. Update the rev 4 compliance report after the fixes below.

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Custom-domain login fails because `tenantId` is missing** | The spec assumes per-domain login works; in practice the existing login API rejects requests without `tenantId` in the body. Without a fix, customers cannot log in on `shop.acme.com`. | Decide login-flow strategy (Host-fallback in existing route, server-rendered hidden field, or new route) and document in spec **before** Phase 4 starts. |
| **`indexer: { entityType: null }` is a TypeScript error** | Phase 1 step 1 will fail typecheck. Implementer wastes a cycle figuring out the right idiom. | Audit `makeCrudRoute` config and `CrudRouteConfig` interface to determine the actual opt-out mechanism. Update spec with the verified syntax. |
| **Worker thundering on TLS retries** | If hundreds of domains hit `tls_failed` simultaneously (e.g., Let's Encrypt brief outage), the TLS-retry worker hammers Traefik. | Document a backoff strategy at the worker level (not just per-domain): max N domains processed per interval, plus exponential backoff multiplier on the worker as a whole. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Existing `getCustomerAuthFromCookies` does not enforce host-tenant binding** | Spec's defense-in-depth claim ("JWT replay across hosts impossible") relies on a Host check that doesn't exist in the helper today. Implementer might forget to add it. | Add an explicit Phase 1 task to extend `getCustomerAuthFromCookies` (or add a new `verifyForHost(host)` helper). Add a unit test asserting cross-host JWT rejection. |
| **`x-next-url` header origin** | The current `(frontend)/layout.tsx` reads `headers().get('x-next-url')` from "middleware" — but no `middleware.ts` exists yet. Either Next.js sets this internally, or some build-step injection sets it. The new `middleware.ts` must preserve this header to avoid breaking existing layout logic. | Phase 2 should grep for what sets `x-next-url` and ensure the new middleware preserves it (or replaces the mechanism explicitly). |
| **DNS A-record verification false positive when target IP is shared** | If `CUSTOM_DOMAIN_A_RECORD_TARGET` is a shared CDN/load balancer IP also used by other services, an attacker's domain pointing at that IP would pass the A-record check without proxying through us. | Mandate that `CUSTOM_DOMAIN_A_RECORD_TARGET` is a dedicated IP (not shared). Operator runbook documents this. The reverse-resolve fallback only fires for **known proxy ranges** — non-proxy non-matching IPs are rejected outright. |
| **`@open-mercato/cache` `deleteByTags` semantics** | Spec assumes `deleteByTags(tags[])` performs OR-match (any tag). Verify this is the actual behavior, not AND-match. | Confirmed in `packages/cache/src/types.ts:58` — accepts `string[]`, semantics confirmed by Explore agent. ✅ Already mitigated. |
| **Multi-org tenants without an active org** | Spec's no-access state renders an `<EmptyState>` for users with the feature on zero orgs. But what if the tenant has zero orgs at all (fresh tenant, no orgs created yet)? The current `customerAuth` flow loads orgs on demand. | Add this branch to the spec's state machine: "tenant has zero orgs → render `<EmptyState>` directing user to first create an organization." |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Punycode normalization differs from `tr46` (UTS#46)** | Browsers and Let's Encrypt use UTS#46; Node's `punycode.toASCII` uses RFC 3490. Edge cases (deviation characters, IDNA2008 vs IDNA2003) could cause a domain to register as one form but fail TLS provisioning under another. | Either use `tr46` (`npm install tr46`) or document that the normalization uses `punycode.toASCII` and accept the edge-case mismatch (most domains won't hit it). |
| **`X-Open-Mercato-Origin: 1` header set by middleware** | If the middleware sets the response header but Cloudflare/Fastly strips unknown headers, reverse-resolve fails for customers using strict proxies that whitelist headers. | Document that `X-Open-Mercato-Origin` must be in any Cloudflare Transform-Rule allowlist if the customer uses one. Operator runbook. |
| **Cache memory budget calculation** | Spec says ~300 bytes/entry × 10,000 = 3 MB. With Punycode hostnames + JSON encoding, real entries are likely 200–400 bytes. | Bound is conservative. No action. |
| **Migration `CHECK` constraint** | The hostname `CHECK` constraint enforces `lower(hostname)` and no trailing dot. Existing databases without this constraint don't have any rows yet (new table), so it's safe. | None. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

1. **Login flow on custom domains** — How does the login form on `shop.acme.com` discover `tenantId`? Decide and document:
   - Option A: relax `loginSchema` to make `tenantId` optional; backend resolves from Host header when absent
   - Option B: server-render a hidden `tenantId` field on the login page, derived from the catch-all layout's resolved org
   - Option C: introduce a separate `POST /api/customer-accounts/customer/login-by-host` route
   - **Recommendation: Option A** — cleanest, keeps one login endpoint, leverages the same Host-resolution infrastructure already needed.

2. **Cookie name accuracy** — Update the Customer Authentication section to reference `customer_auth_token` (JWT) + `customer_session_token` (session). Specifically: the Host-tenant binding defense applies to the JWT cookie. The session cookie is opaque and validated server-side via DB lookup, so it's already host-bound by virtue of being host-only.

3. **Indexer opt-out idiom** — Resolve via codebase audit: is `indexer` field on the `makeCrudRoute` config optional? If yes, simply omit it and add a one-line comment. If no, the spec must propose either (a) adding `null` support to `CrudIndexerConfig.entityType`, (b) accepting that domain mappings ARE in the search index but with a tenant filter (acceptable, less secure), or (c) opting out via search config exclusion in `search.ts`.

### Important Gaps (Should Address)

4. **`getCustomerAuthFromCookies` Host-tenant binding** — Specify that the helper must accept an optional Host context and reject JWTs whose `tenantId` doesn't match the host-resolved tenant. Add a unit test.
5. **Email migration scope** — Narrow the `urlForCustomerOrg` claim to actual call sites (`signup.ts` only). Note future routes must comply.
6. **`x-next-url` mechanism** — Phase 2 must verify what currently sets this header and ensure the new middleware integrates correctly.
7. **TLS-retry worker bounding** — Document how the TLS-retry worker bounds its rate (max N per interval, worker-level backoff).
8. **Dedicated A-record IP** — Document that `CUSTOM_DOMAIN_A_RECORD_TARGET` must be dedicated, not a shared load balancer / CDN IP.
9. **Playwright `Host` header strategy** — Document how integration tests fake the Host header (likely a test-only `X-Force-Host` honored only in non-prod).

### Nice-to-Have Gaps

10. **Tenant-with-zero-orgs state** for the multi-org switcher — extend the empty-state branch.
11. **`tr46` vs `punycode` decision** for IDN normalization — pick one and document.
12. **TLS cert visibility in the UI** — `healthCheck` returns issuer + expiresAt but the active state UI doesn't surface them. Enterprise admins want this.
13. **BYO certificate** — note as explicit out-of-scope (it's not currently mentioned).
14. **Audit log entry** for domain register/delete/swap — for compliance / security review.

---

## Remediation Plan

### Before Implementation (Must Do — block Phase 1)

1. **Fix cookie name** — replace all `om_customer_session` references in the spec with the actual cookie names (`customer_auth_token` + `customer_session_token`). Clarify the JWT-replay defense applies to `customer_auth_token`. (5 edits in spec)
2. **Decide login-flow strategy** — pick Option A/B/C above. Recommend Option A. Update `Customer Authentication on Custom Domains` and Phase 1 (or new Phase 1.5) with: relax `loginSchema.tenantId` to optional, add Host-resolution fallback in `customer_accounts/api/login.ts`, add a unit test for both code paths.
3. **Resolve indexer opt-out** — verify via reading `packages/shared/src/lib/crud/factory.ts` whether the `indexer` field can be omitted. Update Phase 1 step 1 with the verified syntax. If `indexer` is required, choose between providing a real `entityType` and excluding from search via `search.ts`, vs. proposing a type-level opt-out as a separate spec.

### During Implementation (Add to Spec as Tasks)

4. Extend `getCustomerAuthFromCookies` to enforce host-tenant binding (or add `verifyForHost`); add unit tests for cross-host JWT rejection.
5. Verify `x-next-url` source and ensure new middleware preserves it.
6. Add TLS-retry worker rate limiting at the worker level (not just per-domain backoff).
7. Document Playwright Host-faking strategy in the testing section.
8. Narrow email-migration scope to existing `signup.ts` call site; add a forward-looking note for future emails.
9. Add tenant-with-zero-orgs state to the multi-org switcher empty state branch.
10. Pick `tr46` or `punycode.toASCII` and document the choice.

### Post-Implementation (Follow Up)

11. Add audit-log integration for domain mutations (separate spec recommended).
12. Add TLS cert details (issuer/expiry) to the UI active state (quick UX win).
13. Add "renewal warning" notification when cert expires in <30 days (operational).
14. Plan BYO certificate as a future enterprise feature.

---

## Recommendation

**Needs spec updates first.** Apply the 3 critical fixes (cookie name, login flow, indexer opt-out) and the 6 important gaps to the spec, then this is implementable end-to-end via `implement-spec`. Estimated rev-4.1 work: ~30–60 minutes of spec edits, no code changes.

After fixes, the spec is genuinely high-quality and addresses concerns that most v1 custom-domain implementations defer (zero-downtime swap, proxied DNS fallback, IDN normalization, host-only cookies, two-tier cache with SWR + warm-up, distinct DNS vs TLS failure UX, multi-org switcher, DS-token compliance). The remaining items are real but small.
