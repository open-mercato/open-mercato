# Step 3.10 — Verification Checks

## Scope

Phase 1 WS-C fourth Step: ship the catalog read-only AI tool pack (base
coverage). Lives inside `packages/core/src/modules/catalog/ai-tools.ts`
plus six helper files under `packages/core/src/modules/catalog/ai-tools/`
(types + six packs). The generator already scans every module root for
an `ai-tools.ts` contribution (Step 2.3 restored loader), so no generator
plumbing is required. All twelve tools are read-only; mutation tools for
products / categories / variants / prices / price kinds / offers / media
are deferred to Phase 5 (Step 5.14) under the pending-action contract.

Follows Step 3.9 (customers pack) and unlocks Step 3.11 (D18 catalog
merchandising read tools) which will layer `catalog.search_products`,
`catalog.get_product_bundle`, `catalog.list_selected_products`,
`catalog.get_product_media`, `catalog.get_attribute_schema`,
`catalog.get_category_brief`, and `catalog.list_price_kinds` on top of
this base surface.

## Files touched

Code commit:

- `packages/core/src/modules/catalog/ai-tools.ts` (new) —
  module-root aggregator. Default/`aiTools` export concat of the six
  packs.
- `packages/core/src/modules/catalog/ai-tools/types.ts` (new) — local
  `CatalogAiToolDefinition` shape + `assertTenantScope` helper. Mirrors
  the pattern used by `customers/ai-tools/types.ts` so jest does not
  need a cross-package import into `@open-mercato/ai-assistant`.
- `packages/core/src/modules/catalog/ai-tools/products-pack.ts` (new) —
  `catalog.list_products`, `catalog.get_product`.
- `packages/core/src/modules/catalog/ai-tools/categories-pack.ts` (new) —
  `catalog.list_categories`, `catalog.get_category`.
- `packages/core/src/modules/catalog/ai-tools/variants-pack.ts` (new) —
  `catalog.list_variants`.
- `packages/core/src/modules/catalog/ai-tools/prices-offers-pack.ts` (new) —
  `catalog.list_prices`, `catalog.list_price_kinds_base`,
  `catalog.list_offers`.
- `packages/core/src/modules/catalog/ai-tools/media-tags-pack.ts` (new) —
  `catalog.list_product_media`, `catalog.list_product_tags`.
- `packages/core/src/modules/catalog/ai-tools/configuration-pack.ts` (new) —
  `catalog.list_option_schemas`, `catalog.list_unit_conversions`.
- `packages/core/src/modules/catalog/__tests__/ai-tools/shared.ts` (new)
  — shared `makeCtx` + `knownFeatureIds` test helpers.
- `packages/core/src/modules/catalog/__tests__/ai-tools/products-pack.test.ts`
  (new) — 9 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/categories-pack.test.ts`
  (new) — 7 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/variants-pack.test.ts`
  (new) — 4 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/prices-offers-pack.test.ts`
  (new) — 6 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/media-tags-pack.test.ts`
  (new) — 3 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/configuration-pack.test.ts`
  (new) — 4 tests.
- `packages/core/src/modules/catalog/__tests__/ai-tools/aggregator.test.ts`
  (new) — 3 tests (aggregator completeness + RBAC-features-in-acl audit
  + D18 reservation check).

Docs-flip commit: PLAN.md row 3.10, HANDOFF.md rewrite, NOTIFY.md append,
this file.

## Twelve read-only tools

| Tool | Input | `requiredFeatures` |
|------|-------|--------------------|
| `catalog.list_products` | `{ q?, limit?<=100, offset?, categoryId?, tagIds?, active? }` | `catalog.products.view` |
| `catalog.get_product` | `{ productId, includeRelated? }` | `catalog.products.view` |
| `catalog.list_categories` | `{ parentId?, limit?<=100, offset?, includeArchived? }` | `catalog.categories.view` |
| `catalog.get_category` | `{ categoryId, includeRelated? }` | `catalog.categories.view` |
| `catalog.list_variants` | `{ productId, limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.list_prices` | `{ productId?, variantId?, priceKindId?, limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.list_price_kinds_base` | `{ limit?<=100, offset? }` | `catalog.settings.manage` |
| `catalog.list_offers` | `{ productId?, variantId?, active?, limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.list_product_media` | `{ productId, limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.list_product_tags` | `{ productId }` | `catalog.products.view` |
| `catalog.list_option_schemas` | `{ limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.list_unit_conversions` | `{ productId?, limit?<=100, offset? }` | `catalog.products.view` |

No tool carries `isMutation: true`. Every tool whitelists **existing**
feature IDs from `packages/core/src/modules/catalog/acl.ts` (verified by
`aggregator.test.ts`). No new features invented.

### Feature ID mapping decisions

- **Products / product detail / variants / prices / offers / media /
  tags / option schemas / unit conversions** → `catalog.products.view`
  (matches what the existing `/api/catalog/*` GET routes enforce today
  for the same surfaces).
- **Categories / category detail** → `catalog.categories.view` (matches
  existing `/api/catalog/categories` GET).
- **`catalog.list_price_kinds_base`** → `catalog.settings.manage`
  (matches `/api/catalog/price-kinds` GET; price kinds are considered
  catalog settings in the route contract).

### D18 name collision avoidance

Step 3.11 (D18) owns `catalog.list_price_kinds` verbatim. The base
enumerator uses the distinct name `catalog.list_price_kinds_base` so
Step 3.11 can land the D18-shaped variant alongside it without renaming.
An assertion in `aggregator.test.ts` pins this reservation so a future
drive-by doesn't collapse the two tools. If Step 3.11 ends up with
identical output shape, it can either consume the base tool directly or
remove it as part of that Step — this Step flags that decision as a
non-blocking follow-up rather than pre-empting it.

## Unit tests

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="catalog/__tests__/ai-tools"
```

Result:

```
Test Suites: 7 passed, 7 total
Tests:       36 passed, 36 total
```

Full `packages/core` suite after the change:

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit
Test Suites: 331 passed, 331 total
Tests:       2992 passed, 2992 total
```

Regression check against `packages/ai-assistant`:

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
Test Suites: 25 passed, 25 total
Tests:       316 passed, 316 total
```

Baseline was 324 suites / 2956 tests for core and 25 / 316 for
ai-assistant. Core delta is +7 suites / +36 tests, exactly matching the
new catalog tests. ai-assistant is unchanged. No regressions.

### Coverage areas

- **Tenant isolation** on `list_products`, `list_categories`,
  `list_prices`, `list_price_kinds_base`, `list_variants`,
  `list_product_media`, `list_option_schemas`, `list_unit_conversions`,
  `list_product_tags`. Mocked `findWithDecryption` returns a
  cross-tenant row; handler drops it and only the `tenant-1` row
  reaches the output.
- **Not-found / cross-tenant refusal** on `get_product` / `get_category`
  — both return `{ found: false, <id> }` instead of throwing.
- **RBAC mandate**: `aggregator.test.ts` iterates every exported tool
  and asserts `requiredFeatures?.length > 0` and every feature exists
  in the module's own `acl.ts` `features` array.
- **100 page-size cap** on every list tool via zod `safeParse` rejection.
- **`get_product` + `includeRelated: true`** hydrates the expected keys
  (`categories`, `tags`, `variants`, `prices`, `media`, `unitConversions`,
  `customFields`) — assertion enforces the full set.
- **`list_price_kinds_base`** returns items scoped to tenant and drops
  cross-tenant rows.
- **Filter translation**: `list_prices` confirms `productId` / `variantId`
  / `priceKindId` all translate to `where.product` / `where.variant`
  / `where.priceKind`. `list_products` `categoryId` short-circuit
  returns `{ items: [], total: 0 }` without counting. `list_offers`
  short-circuits when no prices exist for the requested `variantId`.
- **Missing tenant rejection** on a sample tool per pack — handler
  throws `Tenant context is required` before any DB call.
- **D18 collision lock**: `aggregator.test.ts` pins that the base tool
  set does NOT register `catalog.list_price_kinds` (reserved for Step
  3.11) and DOES register `catalog.list_price_kinds_base`.

### Mocking strategy

- `@open-mercato/shared/lib/encryption/find` →
  `findWithDecryption` / `findOneWithDecryption` spies.
- `@open-mercato/shared/lib/crud/custom-fields` → `loadCustomFieldValues`
  spy (returns per-record custom-field map).
- `em.count` / `em.persistAndFlush` are jest mocks on the fake container.
- No ORM is booted; all tests run in jest's default node environment.

Raw `em.find(` / `em.findOne(` were verified not to appear in any of the
new non-test files (`grep -rn "em\.\(find\|findOne\)("
packages/core/src/modules/catalog/ai-tools` returned zero matches).
Every query goes through `findWithDecryption` / `findOneWithDecryption`
with `tenantId` + (when present) `organizationId` supplied both in
`where` and in the scope tuple.

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — pass.
- `@open-mercato/app:typecheck` — same pre-existing diagnostics carried
  over from Steps 3.1 / 3.8 / 3.9:
  - `agent-registry.ts(43,7)` — missing
    `@/.mercato/generated/ai-agents.generated` type declaration
    (runtime-guarded by try/catch).
  - Step 3.8 `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts`
    handler variance errors against the public `AiToolDefinition`
    generic. These are the same diagnostics present before Step 3.10.
- **Zero new diagnostics** on the new catalog ai-tools files (verified
  by grepping the typecheck output for `catalog/ai-tools` — empty
  result). The catalog packs deliberately use a local
  `CatalogAiToolDefinition` shape (like `customers` / `inbox_ops`) so
  TS enforces full input-type narrowing inside each handler instead of
  relying on the ai-assistant generic.

## yarn generate

```
yarn generate
```

Succeeded in ~5s. The generator now emits a new `catalog` entry in
`apps/mercato/.mercato/generated/ai-tools.generated.ts` alongside the
existing `search`, `ai_assistant`, `inbox_ops`, and `customers` entries:

```ts
import * as AI_TOOLS_catalog_397 from "@open-mercato/core/modules/catalog/ai-tools";
...
      moduleId: "catalog",
      ...
```

So the Phase 3 chat runtime (Step 2.3 loader) sees all twelve catalog
tools at runtime without any additional wiring. No generator code change
was required.

The post-step `configs cache structural` purge reports as skipped
(pre-existing `@open-mercato/queue` export mismatch; same as Steps 3.8
and 3.9; unrelated). Noted for the record.

## OpenAPI / i18n / Playwright

Not applicable. No API routes, no user-facing strings, no UI surface.

## Notable design decisions

- **Placement inside `packages/core`.** The catalog module is enabled by
  default in `apps/mercato/src/modules.ts`; the generator walks every
  enabled module, so adding a module-root `ai-tools.ts` inside catalog
  needed **zero** generator changes. Each pack lives in its own
  `ai-tools/*.ts` file (all under 350 lines) so the aggregator stays
  trivially grep-able.
- **Local `CatalogAiToolDefinition` shape** instead of importing from
  `@open-mercato/ai-assistant`. Matches the Step 3.9 `customers` pattern
  and avoids adding a cross-package jest `moduleNameMapper` entry.
- **Tenant isolation via `findWithDecryption` /
  `findOneWithDecryption` only.** Every query scopes by `tenantId`
  + (when set) `organizationId` in both the `where` map and the scope
  tuple, then post-filters by `row.tenantId === ctx.tenantId` as a
  defense in depth. Raw `em.find(` / `em.findOne(` appear nowhere in
  the new production files (grep verified pre-commit). `em.count`
  is used for total counts.
- **Detail tools emit `{ found: false }`** instead of throwing so a
  chat-mode agent can recover gracefully — matches the pattern Step 3.8
  established for `search.get_record_context` and
  `attachments.read_attachment`.
- **`get_product` + `includeRelated: true`** pulls categories
  (`CatalogProductCategoryAssignment` populate `category`), tags
  (`CatalogProductTagAssignment` populate `tag`), variants
  (`CatalogProductVariant`), prices (`CatalogProductPrice` — base +
  offer-scoped are the same table, differentiated by `offer` column),
  media metadata (`Attachment` filtered by
  `entityId = E.catalog.catalog_product`), unit conversions
  (`CatalogProductUnitConversion`), and custom fields. Each related
  list is capped at 100. Since all relations are cheap joins via
  `product_id`, no surface returned `null` — nothing was deemed
  "non-trivially reachable" at base coverage.
- **`get_category` + `includeRelated: true`** returns direct children
  + already-denormalized `ancestorIds` / `descendantIds` (kept on the
  entity itself). Custom fields are always included since the lookup
  is a single call.
- **Media tool returns metadata only** — `fileName`, `mimeType`,
  `fileSize`, `url`, `storageDriver`, `partitionCode`. Bytes go through
  the Step 3.7 attachment bridge (`read_attachment` on the ai-assistant
  attachments pack).
- **`list_price_kinds_base` name**: chosen deliberately to avoid
  collision with the D18 `catalog.list_price_kinds` reserved for Step
  3.11. The aggregator test pins that reservation.
- **`list_offers` variantId path**: walks prices to find offer ids first
  (offers join to prices via `offer_id`, not a direct variant FK).
  Short-circuits when the variant has no priced offers.
- **`list_price_kinds_base` org scope**: price kinds can be null-scoped
  (shared across the tenant). The `where.$or` allows both matched and
  null `organizationId` rows within the tenant boundary.
- **No `isMutation` tools** in this Step, as the brief mandates.
  Mutation tools are Step 5.14 scope under the pending-action contract.
- **No new feature IDs invented.** All twelve tools whitelist existing
  IDs from `catalog/acl.ts` (verified by `aggregator.test.ts`).
- **No UI / no OpenAPI / no DB changes.** The Step is purely additive
  on the runtime surface, so BC checklists 7 (routes), 8 (DB), 10 (ACL
  feature IDs) are all no-op.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:

- **Surface 1 (Auto-discovery conventions)**: `ai-tools.ts` at module
  root is the already-documented convention. Adding another participant
  cannot break existing consumers.
- **Surface 2 (Types)**: no public type changed. The local
  `CatalogAiToolDefinition` shape is module-private and not exported
  from any package entry point.
- **Surface 3 (Function signatures)**: unchanged.
- **Surface 5 (Event IDs)**: unchanged. No events emitted.
- **Surface 7 (API route URLs)**: unchanged.
- **Surface 8 (Database schema)**: unchanged.
- **Surface 10 (ACL feature IDs)**: unchanged — only existing IDs
  referenced; `aggregator.test.ts` enforces this at test time.
- **Surface 13 (Generated file contracts)**: the
  `ai-tools.generated.ts` export shape (`aiToolConfigEntries`,
  `allAiTools`) is unchanged; a new `catalog` entry appears in the
  array, which is what Step 2.3 is designed to accept.

## Follow-up candidates (non-blocking)

- **`catalog.list_price_kinds` vs `catalog.list_price_kinds_base`
  merge**. Step 3.11 (D18) may decide the base tool is redundant once
  the merchandising variant lands. If the output shapes converge, fold
  the base tool into the D18 variant (or expose it as an alias). If the
  shapes diverge, keep both.
- **Query-engine parity**. Step 3.10 uses `findWithDecryption`
  directly because each tool is a small scoped list that does not need
  the query-engine's advanced filter merge surface. Future tool
  variants wanting custom-field filtering (`cf:*`) should switch to
  the `queryEngine.query(...)` surface the existing products route uses.
- **Product bundle hydration**. The existing D18 spec calls for
  `catalog.get_product_bundle` that returns all of category refs +
  pricing + media + option schema in one payload. Step 3.11 owns that
  shape; this Step intentionally keeps `get_product` as a minimal
  detail fetch with a toggle for relations.
- **Soft-archive toggle**. `list_categories.includeArchived` mirrors
  the docs but `list_products` / `list_variants` / `list_unit_conversions`
  always filter `deletedAt: null` today. A future non-blocking spec may
  introduce a parallel `includeArchived` across the catalog surface.
