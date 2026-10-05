# Notify — 2026-10-05-release-3-storefront-read-side

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-05T10:47:00Z — run started
- Brief: storefront read side release — roadmap Phase 1 + visibility Phase 2 (SPEC-029 P1–3, Storefront Public API P1–3, Omnibus MVP, prerequisites), continuing fork PR #12.
- External skill URLs: none
- Decisions: owner override — reuse PR #12 and its branch instead of feat/release-3-storefront-read-side; Phase 0 already done (8040682f1a). Owner added Omnibus to this PR (D11); authoritative spec = 2026-06-30-omnibus-price-tracking.md (it supersedes SPEC-033), MVP Phases 1–3 only.
- Repo guard: all pushes to remote `fork`; all gh commands with --repo adeptofvoltron/open-mercato; upstream read-only.

## 2026-10-05T11:02:21Z — Step 1.5 scope decision: no ancestor inheritance for assortment scope
- customer-groups spec §6.4 and visibility spec §3.1 define the union over "each currently-matching group's own scope" and say nothing about walking parent groups (the §6.1 ancestor walk is stated for the scalar terms only). `resolveAssortmentScope` therefore reads each matching group's OWN terms row only (`loadGroupOwnAssortmentScope`); a parent's scope is not inherited. A matching group with no terms row, a null scope, or a scope whose lists are all empty contributes `null` (unrestricted), which makes the union unrestricted per `unionScopes`.
- Not in this step: catalog existence check for category/tag ids (US-A1 inline error) — belongs with the pickers (Step 7.10) or a later validation pass.

## 2026-10-05T11:05:17Z — checkpoint 1 (steps 1.1–1.6)
- Phase 1 prerequisites green: typecheck shared+core, 53 shared + 1051 core tests.
- Decision: Tasks-table Commit cells are back-filled by the following commit (a commit cannot embed its own SHA).
- Decision: unrelated wms snapshot drift from `yarn db:generate` is discarded each time; catalog/customer_groups snapshots hand-limited to the intended entries.
- Note (minor, for final review): `hashEffectiveScope` uses node:crypto and is exported from the catalog-visibility barrel; client imports of that barrel would pull it in.

## 2026-10-05T11:47:14Z — scope decision (2.4-fix appended)
- 2.4 executor flagged: POST /stores accepts branding without ecommerce.branding.manage; store delete leaves bindings holding the domain+prefix. Decision: gate branding on create by feature; cascade soft-delete bindings on store delete. Appended Step 2.4-fix.
- Note for spec changelog: branding fonts are stored as allowlist ids (ECOMMERCE_BRANDING_FONTS), not CSS strings (2.2 decision).

## 2026-10-05T11:53:55Z — implementation decision (2.4-fix)
- Store delete cascade runs in the CRUD factory's `afterDelete` hook as its own `em.transactional` (find live bindings → nativeUpdate deleted_at), with a compensating restore of the store's deleted_at if the cascade fails (customer_groups `cascadeGroupDelete` precedent). Staging binding mutations in `beforeDelete` to ride the factory's store flush would put a query (`deleteOrmEntity`'s findOne) between dirty scalars and the flush — the SPEC-018 pattern core AGENTS.md forbids. Binding `.deleted` events + query-index removal go through dataEngine.markOrmEntityChange after commit, then per-binding CRUD cache invalidation.
- Create branding gate: non-empty `settings.branding` without `ecommerce.branding.manage` (rbacService.userHasAllFeatures, wildcard-aware, fail-closed) → 403 with a `settings.branding` field error (status 403 per SPEC-029 §verification for the branding route; field-error shape as the 2.4 PUT case).

## 2026-10-05T12:01:57Z — checkpoint 2 (steps 2.1–2.4-fix)
- ecommerce scaffold, entities, migration, admin CRUD green: typecheck core, 307 core tests, i18n sync, template parity.

## 2026-10-05T12:15:58Z — implementation decisions (2.6)
- Dangling binding (R3): a hard-deleted DomainMapping drops its hostname, so on the request path it is indistinguishable from an unknown host (resolveByHostname → null → 404, logged `reason=domain_mapping_not_active`). The "domain removed" diagnostic must come from the admin Domains tab (findById null) and/or the 2.9 `customer_accounts.domain_mapping.deleted` subscriber, which knows both host and id. Resolver logs distinct 404 reasons (`domain_binding_not_found`, `domain_routing_unavailable`, `slug_ambiguous` at warn).
- Path-prefix matching uses `options.pathname` when given, else the request URL pathname. The public /context route (2.8) is an API path, so it must pass the storefront page path explicitly (e.g. a `path` query param) for prefix stores to resolve.
- Dev slug rule: slug is unique per tenant; `resolveStoreBySlug(..., { tenantId })` scopes by tenant, otherwise the slug must be unique across tenants (ambiguous → 404). No `?tenant=` param was added.
- Resolution cache entry = all bindings of a domain mapping (key per mapping id; tags ecommerce-store:*, ecommerce-domain:{host}, ecommerce-domain-mapping:{id}); longest-prefix selection is in memory so the key does not vary by path. Empty binding lists are cached (2.9 must invalidate by the mapping tag on binding create). The 503 misconfiguration throttle is an untagged 1h resolution-cache entry.

## 2026-10-05T12:44:58Z — checkpoint 3 (steps 2.5–2.9-fix)
- Store/buyer resolution, /context and subscribers green after one regression fix (bare sort → 2.9-fix).
- Spec sync list (apply to SPEC-029 at run end): rate-limit keyPrefix `ecommerce_storefront_context` (spec §12 says ecommerce_context); route file at `api/storefront/context/route.ts` (spec §10 lists api/get/...); branding fonts stored as allowlist ids; `/context` takes `?path=` for path-prefix matching; price-row deletes rely on 60 s TTL; `sales.channel.*` not subscribed (no cached field depends on it).
- Decision: integration tests run in the ephemeral environment (own containers + DB) — this is not a local `yarn db:migrate`.

## 2026-10-05T13:27:32Z — checkpoint 4 (steps 2.10–2.11) + safety stop
- SPEC-029 Phase 1 gate green: 12/12 ecommerce integration tests in the ephemeral env, 429 core unit tests.
- Env decisions: integration fixture activates DomainMappings via direct DB update (no API reaches `active` without DNS/TLS, same as existing dbFixtures tests); custom host sent as a real `Host` header because the ephemeral app runs NODE_ENV=production (X-Force-Host only honored in test mode); ephemeral app needs a non-placeholder JWT_SECRET (passed as a throwaway env var).
- Open for final gate: resolution P95 latency budget not measured yet.
- SAFETY STOP: 20 consecutive Steps landed (1.1–2.11 incl. fix rows). Halting dispatch for owner review before Phase 3 (Omnibus). Resume with `om-auto-continue-pr-loop 12` from Step 3.1.

## 2026-10-05T15:05:51Z — resume started (om-auto-continue-pr-loop)
- Resuming at Step 3.1 (Omnibus MVP) after the owner-review safety stop.

## 2026-10-05T15:46:29Z — checkpoint 5 (steps 3.1–3.3-fix)
- Omnibus history foundation green. Full core suite: only the pre-existing locale-dependent warranty_claims quantity test fails (passes under en_US).
- Regression caught: ecommerce ACL feature titles lacked auth i18n keys (from 2.1) → 3.3-fix. Checkpoints now run full core + shared suites.
- Known limitation (pre-existing, not in scope): undo of a product delete does not restore prices, so it records no history.

## 2026-10-05T16:19:10Z — step 3.6 scope decisions
- PATCH /api/catalog/config/omnibus is a shallow top-level merge (a provided `channels` map replaces the stored one; `defaultPresentedPriceKindId: null` clears it). Strict schema: unknown keys, Phase-4 derogation fields and `backfillCoverage` are rejected with 400 field errors (`backfillCoverage` is server-managed so the 422 gate cannot be bypassed — Step 3.7's `omnibus:backfill` must write it via ModuleConfigService directly).
- Config PATCH invalidates via a new tenant-wide cache tag `catalog:omnibus:<tenantId>` (added to every omnibus cache entry), since the config is tenant-scoped and spans organizations.

## 2026-10-05T17:20:07Z — checkpoint 6 (steps 3.4–3.8-fix)
- Omnibus resolution/config/backfill/UI green after one regression fix (bare sorts → 3.8-fix). UI smoke screenshot captured in the ephemeral env (port changes per start; read it from the start log).
- Playwright note: the repo's `@playwright/test` resolves a chromium revision not installed here; screenshots use `executablePath` of the installed headless shell (1243).
- Known gap (from 3.8): config page is gated by `catalog.settings.manage`, so view-only users cannot open the Omnibus panel yet (panel itself supports read-only).
