# Pre-Implementation Analysis: Omnibus Price Tracking (EU Directive 2019/2161)

- **Spec:** [`.ai/specs/2026-06-30-omnibus-price-tracking.md`](../2026-06-30-omnibus-price-tracking.md) (merged to `develop` in PR #3723, commit `c078d218f`)
- **Target branch:** `feat/omnibus-price-tracking` (branched from `origin/develop` @ `3d8e83062`)
- **Existing implementation:** local branch `feat/omnibus-rebased` (5 commits, ~5 770 insertions across 41 files), unpushed
- **Analysis date:** 2026-07-21

## Executive Summary

This is **not a greenfield implementation** — a complete as-built implementation already exists on the local branch `feat/omnibus-rebased`, whose merge-base (`c4b17c07c`) is 458 commits behind `develop`. The good news dominates: a 3-way merge against current `develop` yields **only 2 trivial conflicts**, and neither `catalog/` nor `sales/` gained any migration on `develop` since the merge-base, so both regenerated ORM snapshots remain valid — no `db:generate` rebase needed.

The blockers are **semantic, not mechanical**. Five of the six "as-built verification items" the spec itself flags in *Future / Known Gaps* are **confirmed defects in the code**, and one of them (EC-7) is a genuine **legal-correctness bug**: the resolver does not exclude the presented price reduction from its own reference window, so the Omnibus reference price collapses to the promo price. Separately, `develop` introduced a **strict CI gate on raw `console.*`** (`yarn logger:check-console:ci`, exit 1 on any non-allowlisted finding) that the omnibus code violates in 9 places.

**Recommendation: Ready to implement, with a mandatory pre-merge remediation list.** The spec itself needs no revision — it already predicted these gaps. Sequence the work as: port → fix EC-7 (+ C16 test) → close the remaining 4 gaps → logging facade → validation gate.

## Backward Compatibility

### Violations Found

Audited all 13 contract-surface categories from `BACKWARD_COMPATIBILITY.md` against the actual codebase.

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| — | §1 Auto-discovery conventions | None. Only new `route.ts` / component / service / lib files; `acl.ts`, `di.ts`, `setup.ts`, `cli.ts` extended additively. | — | — |
| — | §2 Types & interfaces | New exports `OmnibusBlock`, `OmnibusConfig`, `OmnibusResolutionContext`, `OmnibusApplicabilityReason` — all net-new. | — | — |
| 1 | §2 Types (internal) | `OmnibusHistoryRow` (`lib/omnibusTypes.ts:65-73`) carries neither `priceId` nor `changeType`, so the spec's EC-7 identity rule is **not expressible**. Extending it is required. | **Warning** | Type is new/unreleased — extend `mapRow` + `OmnibusHistoryRow` freely now, before it becomes a STABLE surface. Do it in the same PR. |
| — | §3 Function signatures | `resolveOmnibusBlock(em, ctx, presentedEntry, priceKindIsPromotion)` is new. `applyOrderLineResults` / `replaceOrderLines` in sales gain an **optional** `container?` arg. | — | Optional param → non-breaking. Verify the added arg is genuinely optional at every existing call site. |
| — | §4 Import paths | Nothing moved; new `catalog/lib/*` and `catalog/services/*` exports only. | — | — |
| — | §5 Event IDs | None new; `catalog.price.created|updated|deleted` unchanged. History is an in-command side effect. | — | — |
| — | §6 Widget spot IDs | Not touched — no widget injection. | — | — |
| 2 | §7 API routes | 3 new routes. `GET /api/catalog/products` gains an `omnibus` block — additive. **But** `isPersonalized`/`personalizationReason` ship as `pricing.is_personalized` / `pricing.personalization_reason` (snake_case, nested) while the spec's authoritative contract is **top-level camelCase**. | **Critical** | Fix **before** first release. Once shipped, §7 forbids removing a response field — the wrong shape would need a permanent bridge. Emit top-level camelCase; drop the nested snake_case (never published). |
| — | §8 DB schema | New table `catalog_price_history_entries`; new columns `catalog_products.omnibus_exempt` / `first_listed_at`, `catalog_product_variants.omnibus_exempt`, 6 nullable columns on `sales_order_lines` + `sales_quote_lines`. All additive, nullable or defaulted. | — | — |
| 3 | §8 DB schema (naming) | Spec's Data Models table says the history row FKs to `CatalogProductPrice`; the real table backing that entity is **`catalog_product_variant_prices`**, and it has **no `deleted_at`** (hard delete). The spec never states the physical table name, so this is a documentation gap, not a schema defect. | Warning | Add the physical table name to the spec's Data Models section. Confirm the backfill/history logic does not assume a soft-delete column on the price row. |
| — | §9 DI keys | New `catalogOmnibusService`. Existing `catalogPricingService` (registered `.singleton()`) untouched. | — | — |
| — | §10 ACL feature IDs | Adds `catalog.price_history.view`, `catalog.settings.view`; **reuses** existing `catalog.settings.manage`. No rename/removal. | — | — |
| — | §11 Notification type IDs | None. | — | — |
| — | §12 AI agent/tool IDs | None. | — | — |
| — | §13 CLI commands | New `omnibus:backfill`. **Verify** the CLI dispatcher accepts a colon in `ModuleCli.command` — every existing catalog command uses hyphens (`seed-units`, `seed-price-kinds`, …). | Warning | Confirm dispatch; fall back to `omnibus-backfill` if colons are unsupported. Do this before the name is published. |
| — | §14 Generated files | `yarn generate` picks up new routes/CLI; no hand-edited generated files. | — | — |

**Net BC verdict:** the spec's claim of *additive-only* holds. The two items worth acting on (#2 `isPersonalized` shape, #1 `OmnibusHistoryRow`) are cheap **only because nothing has shipped yet** — both become breaking changes the moment this merges.

### Missing BC Section

None. The spec has a dedicated **"Backward Compatibility & Contract Surfaces"** section enumerating all 13 categories, plus a **"Migration & Compatibility"** section. Requirement satisfied.

## Spec Completeness

### Missing Sections

None. All required sections are present: TLDR, Regulatory Background, Overview, Prerequisites, Problem Statement, Proposed Solution (+ Design Decisions, Alternatives), User Stories, Architecture, Data Models, API Contracts, Resolution Algorithm, Worked Examples, Edge Cases, i18n, UI/UX, Configuration, Migration & Compatibility, BC & Contract Surfaces, Implementation Plan, Testing Strategy, Compliance Gap Analysis, Monitoring & Alerting, Risks & Impact Review, Future/Known Gaps, Final Compliance Report, Changelog.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Data Models | Physical table name of the price entity is never stated (`catalog_product_variant_prices`, not `catalog_product_prices`); no note that the price row has no `deleted_at`. | Add both facts — they matter for backfill and for anyone reading the migration. |
| Compliance Gap Analysis | Marks all seven gaps **"Implemented"**. Verified against code: gaps 1 and 6 are only *partially* implemented — anchoring exists but the EC-7 exclusion does not, and `applicable` degenerates because no caller passes a presented entry. | Change gaps 1 & 6 to **"Partially implemented — see Known Gaps"** so the spec stops contradicting its own Known Gaps section. |
| Testing Strategy | Ships integration tests as `TC-CAT-035` / `TC-CAT-036`. `develop` already has its own `TC-CAT-035` (SEO helper i18n, #3299). | Renumber the omnibus pair to `TC-CAT-037` / `TC-CAT-038`; update `.ai/qa` descriptors and every in-spec reference. |
| Implementation Plan | Written as greenfield phases. The work is actually port → remediate. | Add a note that Phases 1–5 exist as-built on `feat/omnibus-rebased` and that the delivery is a port plus the remediation list below. |
| Configuration / API | `api/config/omnibus` predates `develop`'s new canonical catalog-settings surface (`catalog/lib/settings.ts` + `catalog/api/settings/route.ts`). | Decide: fold into `api/settings/route.ts`, or keep separate and adopt its `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` / `createLogger` wiring. |

## AGENTS.md Compliance

### Violations

Verified against the actual code on `feat/omnibus-rebased`, not the spec text.

| Rule | Location | Fix |
|------|----------|-----|
| Structured logging facade — raw `console.*` fails the strict CI gate `yarn logger:check-console:ci` (`.github/workflows/ci.yml:373`; baseline is zero) | `catalog/commands/prices.ts:410,495,770,896,973,1090`; `catalog/services/catalogOmnibusService.ts:202,215`; `sales/commands/documents.ts:3131` | `createLogger('catalog'\|'sales')` + `logger.error(msg, { err, … })`. `documents.ts` already has a module-level `logger` post-merge → one-line swap. `catalog/cli.ts` is allowlisted by the `packages/*/src/**/cli.ts` glob — no action. |
| `findWithDecryption` / `findOneWithDecryption` for all entity reads (root AGENTS.md → Data & Security; lesson: *"Integration packages must use decryption-aware find helpers"*) | `catalogOmnibusService.backfillChannel` uses raw `em.find` / `em.count` for `CatalogProductPrice` and `CatalogPriceHistoryEntry` | Route through `findWithDecryption`. No tenant leak today (filters do include `organizationId` + `tenantId`), but it breaks the contract if catalog later adopts encrypted fields — exactly the reason the spec cites for using the helper. |
| Error handling must not mislabel failures (checklist §5: no silent/miscategorised catch) | `catalog/api/products/route.ts` — the trailing `catch` swallows every omnibus resolution failure while logging it as `"Failed to load unit conversions"` | Wrap the omnibus resolution in its own `try/catch`; degrade to `item.omnibus = null` and log with an omnibus-specific message. |
| Cache invalidation must be wired to every write path (`packages/cache/AGENTS.md`; checklist §6 "If a cache was added: is invalidation wired to every write path") | `buildCacheTag()` exists in `catalogOmnibusService` and is attached on every `cache.set`, but **nothing consumes it**; `commands/prices.ts` never resolves `cache` | Invalidate the omnibus tag post-commit in `catalog.prices.create/update/delete` **and all undo paths**, after `em.flush()` / outside the write transaction. |
| Zod validation at the trust boundary (root → Data & Security; checklist §2) | `omnibusPreviewQuerySchema` (`data/validators.ts:578-585`) leaves `productId`/`variantId`/`offerId` all optional with no `.refine()` | Add `.refine()` requiring ≥1 scope id. Today a scope-less request triggers a tenant-wide history scan **and** a `product:undefined` cache key — a cross-scope cache-key collision inside the tenant. |
| DI lifetime | Spec mandates `catalogOmnibusService` `.scoped()`; the module's existing `catalogPricingService` is `.singleton()` | Confirm the request container exposes `moduleConfigService` and `cache` in the cradle at scoped resolution; keep `.scoped()` per spec (the service holds per-request EM-derived state). |
| Convention drift — new canonical settings surface | `catalog/api/config/omnibus/route.ts` vs `develop`'s `catalog/api/settings/route.ts` pattern | See Spec Completeness table — decide and align. |

### Compliant (verified, not assumed)

- History entity has **no** `created_at`/`updated_at`/`deleted_at` — append-only, as specified.
- Migration `Migration20260629120100` contains **all** required DDL: table, 6 lookback indexes (5 ending `recorded_at desc`), partial-unique idempotency index, immutability trigger `prevent_history_modification()`. `REVOKE` documented as a runbook comment, matching the spec.
- Resolver's six read paths all use `findWithDecryption` with the scope argument; `buildScopeFilters` always pins `tenantId` + `organizationId`.
- `api/prices/history` and the preview route filter both scope columns.
- No new production dependencies.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **EC-7 not implemented — the presented reduction is included in its own reference window** | **Legal failure.** `computeLowestPrice` (`catalogOmnibusService.ts:142-155`) applies **no candidate filtering**, and `fetchInWindow` uses `recordedAt: { $gt: windowStart, $lte: windowEnd }` where `windowEnd == anchor`. The promo row is a `MIN` candidate and wins whenever the reduction is the lowest price — the reference collapses to the promo price. This is the exact scenario spec §R2 rates **High** and worked example E1 calls "a compliance bug". | Implement the spec's rule verbatim: keep the inclusive window, then drop (i) the exact presented entry by `(price_id, change_type, recorded_at)` identity and (ii) any row with `recorded_at >= anchor`. Requires extending `OmnibusHistoryRow` + `mapRow` to carry `priceId`/`changeType`. Ship test **C16** in the same commit. |
| **No caller ever passes a presented entry** | `resolveOmnibusBlock(em, ctx, null, …)` in both the preview route (`omnibus-preview/route.ts:65`) and the products list. Consequences: `promotionAnchorAt` can only come from `firstOfferEntry.recordedAt`; `applicable` degenerates to `priceKindIsPromotion` alone (always `false` in the preview). The admin preview therefore does not match the authoritative path — operators validate against a lie. | Derive the presented entry on both paths: current active `CatalogProductPrice` for the resolved presented kind → its latest history entry, plus `priceKindIsPromotion = kind.isPromotion`. Note this **must** land together with EC-7 — the fix is inert without a non-null presented entry. |
| **Sales bulk-import N+1** | `applyOmnibusToLine` does `em.fork()` + a `findOne` + `resolveOmnibusBlock` **sequentially per line**. `develop` added a bulk-import path (`ctx.bulkImport?.skipNotifications`) that did not exist at the merge-base — at import scale this is a real N+1 on order/quote creation. | Gate omnibus capture on `ctx.bulkImport` (skip, or batch-resolve). Measure before merge with a representative import. |
| **Strict `console.*` CI gate** | `yarn logger:check-console:ci` exits 1 on any non-allowlisted finding; the omnibus code has 9. CI is red on push. | Mechanical migration to `createLogger` (see AGENTS.md violations table). |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stale omnibus cache after a price write | Cache tag built but never invalidated → reads stale up to the 5-min TTL after any price create/update/delete/undo. Acceptable for admin reads; **not** a correctness guarantee for a storefront reference (the spec says so explicitly). | Wire post-commit tag invalidation on all price write paths. Storefront is out of scope for now, which bounds the blast radius. |
| `isPersonalized` contract mismatch | Ships as nested snake_case; spec's authoritative contract is top-level camelCase. Same item already emits `omnibus` top-level → self-inconsistent payload. Post-release this needs a permanent bridge under §7. | Fix now, before first publish. |
| Migration ordering on pre-migrated local DBs | Omnibus adds `20260629*`; `develop` later added `20260709` (payment_gateways) and `20260715/16` (workflows). On a dev DB already past `0716`, the omnibus files land as out-of-order pendings. | MikroORM applies them fine; note it in the PR description for anyone with an existing local DB. Fresh DBs unaffected. |
| Preview scope-less query | No `.refine()` → tenant-wide history scan + `product:undefined` cache key collision within a tenant/org. | Add the refinement (also listed as a validation violation above). |
| `TC-CAT-035` ID collision | `develop` shipped its own `TC-CAT-035`; add/add conflict, and duplicate IDs corrupt the QA descriptor. | Renumber omnibus tests to `TC-CAT-037` / `TC-CAT-038`. |
| Settings-endpoint convention drift | `api/config/omnibus` diverges from `develop`'s new canonical `api/settings` pattern → review friction, inconsistent guard/logging wiring. | Decide before implementation starts (see Remediation). |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Unbounded history growth | Monotonic table growth; retention/partitioning explicitly deferred by the spec. | Indexed + capped `fetchInWindow` (1 000 rows). Track as a follow-up issue before high-volume EU production. |
| `REVOKE UPDATE/DELETE` not applied | Second line of defence absent until the deploy step runs; the DB trigger is the active guard meanwhile. | Runbook comment exists in the migration. Add to the deploy checklist. |
| Monitoring not instrumented | Metrics/alerts specified but not emitted. | Structured logging is in place once the facade migration lands; instrument as a follow-up. |
| `omnibus:backfill` colon in CLI command name | Every existing catalog command uses hyphens; dispatcher support unverified. | Verify; rename to `omnibus-backfill` if unsupported. Cheap now, breaking later (§13 STABLE). |
| `create or replace trigger` needs PG ≥ 14 | Platform targets PostgreSQL 17. | No action; note in deploy docs. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **EC-7 exclusion missing** — the core compliance rule of the entire feature is absent from the resolver. Requires extending `OmnibusHistoryRow`/`mapRow` with `priceId` + `changeType` before the rule can even be written. Must ship with test C16.
- **Presented entry never passed** — both consumers hard-code `null`, which makes the EC-7 fix inert and the admin preview non-representative. Must land with EC-7.

### Important Gaps (Should Address)

- **`isPersonalized` response shape** — must be corrected before the API is published, or it needs a permanent compatibility bridge.
- **Cache invalidation on price writes** — tag exists, nothing consumes it.
- **`console.*` → `createLogger`** — 9 sites; hard CI gate.
- **`omnibus-preview` `.refine()`** — scope-less requests cause a tenant-wide scan and a cache-key collision.
- **`backfillChannel` raw `em.find`/`em.count`** — must use the decryption-aware helpers.
- **Products-route `catch` mislabels omnibus failures** as unit-conversion errors.
- **`TC-CAT-035` renumbering** to 037/038.
- **Settings-endpoint convention decision** — fold into `api/settings` or align its guard/logger wiring.

### Nice-to-Have Gaps

- `notFound()` helper from `@open-mercato/shared/lib/crud/errors` in the new routes, for consistency with `develop`.
- Spec edits: physical table name, Compliance Gap Analysis statuses (gaps 1 & 6 → *partially implemented*), a note that Phases 1–5 exist as-built.
- Monitoring instrumentation; retention/partitioning; `REVOKE` deploy step — all explicitly deferred by the spec, track as follow-up issues.

## Remediation Plan

### Before Implementation (Must Do)

1. **Decide the port mechanism** — cherry-pick the 5 commits from `feat/omnibus-rebased` onto `feat/omnibus-price-tracking`, or merge and squash. Either way resolve the 2 conflicts: `backend/config/catalog/page.tsx` (keep all three settings components + both imports) and `TC-CAT-035.spec.ts` (renumber omnibus → 037/038).
2. **Decide the settings-endpoint convention** — keep `api/config/omnibus` separate (adopting `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` / `createLogger`) or fold it into `develop`'s `api/settings/route.ts`. This shapes Phase 2 work and is an architectural call, not a detail.
3. **Verify** the CLI dispatcher accepts `omnibus:backfill` (colon), and that the scoped DI cradle exposes `moduleConfigService` + `cache`.
4. **Note the second snapshot file** — `catalog/migrations/` contains both `.snapshot-open-mercato.json` and `.snapshot-openmercato.json` (hyphen-less). Confirm which one the generator actually reads before touching either.

### During Implementation (Add to Spec)

1. **EC-7 + presented entry** as one atomic change, with test **C16**, plus the `OmnibusHistoryRow`/`mapRow` extension. This is the compliance core — do it first, after the port.
2. **Close the remaining four known gaps**: `isPersonalized` top-level camelCase; post-commit cache-tag invalidation on all price write paths incl. undo; `omnibus-preview` `.refine()`; `backfillChannel` → `findWithDecryption`.
3. **Logging facade migration** — 9 `console.*` sites → `createLogger`; split the omnibus `catch` in `decorateProductsAfterList` from the unit-conversions one.
4. **Bulk-import guard** in `applyOmnibusToLine` — gate on `ctx.bulkImport` or batch-resolve.
5. **Review merged files by eye**: `api/products/route.ts` (omnibus queue lands directly above `develop`'s rewritten `catch`) and `sales/commands/documents.ts` (`assertShippedOrderLineEditable` now runs before `applyOrderLineResults`; confirm omnibus stamping still fires only for `!existing` lines).
6. **Spec updates**: physical table name; gaps 1 & 6 → *partially implemented*; renumbered test IDs; port-not-greenfield note; changelog entry.
7. **Validation gate** (`.ai/agentic.config.json`): `yarn build:packages` → `generate` → `build:packages` → `i18n:check-sync` → `i18n:check-usage` → `typecheck` → `test` → `build:app`, **plus** `yarn logger:check-console:ci` and `yarn lint`. Re-run `module-decoupling.test.ts` (sales imports `CatalogProductPrice` + `detectPersonalization` from catalog) and the products-list integration tests. No `yarn db:generate` should be needed — both snapshots are still in sync with `develop`.

### Post-Implementation (Follow Up)

1. Monitoring instrumentation (the 6 metrics in the spec's Monitoring & Alerting table).
2. Retention / monthly partitioning of `catalog_price_history_entries` before high-volume EU production.
3. `REVOKE UPDATE, DELETE` on the app DB role as a production deploy step.
4. Storefront display + `catalog.pricing.personalizedDisclosure` i18n key.
5. Expand `isPersonalized` signal-source mapping per Art. 6(1)(ea).

## Recommendation

**Ready to implement** — the spec needs no revision to start, only the accuracy edits listed above (which can land in the same PR).

The decisive finding is that the port itself is **low-risk** (2 trivial conflicts, zero catalog/sales migrations on `develop` since the merge-base, both ORM snapshots still valid, `commands/prices.ts` byte-identical), while the **quality bar is not yet met**: EC-7 is a live compliance bug, four more known gaps are confirmed in code, and a hard CI gate is red. Merging the port as-is would ship a feature that computes the wrong legally-mandated reference price — the single failure mode this entire spec exists to prevent.

Suggested delivery order: **port → EC-7 + presented entry (+C16) → remaining gaps → logging → validation gate → PR**.

Labels for the eventual PR, per root `AGENTS.md`: `feature`, `priority-high` (compliance/legal correctness), `risk-high` (DB migration + schema, money-adjacent, cross-module catalog→sales), `needs-qa`.
