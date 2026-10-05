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
