# Step 3.11 — Verification Checks

## Scope

Phase 1 WS-C fifth Step: ship the seven D18 catalog merchandising read
tools the `catalog.merchandising_assistant` agent (landing in Step 4.9)
will whitelist verbatim. Lives inside
`packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts`,
layered on top of Step 3.10's base catalog pack. Tenant isolation
mirrors Steps 3.8–3.10 (`findWithDecryption` / `findOneWithDecryption`
+ defensive post-filter). All tools are read-only; mutation tools for
catalog land in Step 5.14 under the pending-action contract.

Follows Step 3.10 (catalog base coverage) and unlocks Step 3.12 (D18
catalog AI-authoring tools — structured-output helpers via
`runAiAgentObject`).

## Files touched

Code commit (`6e0beccb8`):

- `packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts`
  (new) — seven D18 read tools. ~740 LOC including input schemas and
  the aggregate bundle builder reused across
  `get_product_bundle` + `list_selected_products`.
- `packages/core/src/modules/catalog/ai-tools/_shared.ts` (new) —
  `listPriceKindsCore` helper shared by both `list_price_kinds` (D18)
  and `list_price_kinds_base` (Step 3.10). Keeps the two tools
  lock-step on tenant scoping and filter shape.
- `packages/core/src/modules/catalog/ai-tools.ts` (modified) — imports
  and concats `merchandisingAiTools` into the module-root aggregator.
  Total read-only tools: 19 (12 base + 7 D18).
- `packages/core/src/modules/catalog/ai-tools/prices-offers-pack.ts`
  (modified) — routes `list_price_kinds_base` through the new shared
  helper. Output shape preserved; `createdAt` / `updatedAt` are now
  returned (additive only — the Step 3.10 test only asserts `codes`).
- `packages/core/src/modules/catalog/__tests__/ai-tools/aggregator.test.ts`
  (modified) — expects 19 tools, asserts coexistence (`_base` +
  D18 both registered), and pins spec-name fidelity for all seven
  D18 names.
- `packages/core/src/modules/catalog/__tests__/ai-tools/merchandising-pack.test.ts`
  (new) — 1 suite / 21 tests covering every mandatory scenario (see
  Coverage areas below).

Docs-flip commit: PLAN.md row 3.11, HANDOFF.md rewrite, NOTIFY.md
append, this file.

## Seven D18 read-only tools

| Tool | Input | `requiredFeatures` |
|------|-------|--------------------|
| `catalog.search_products` | `{ q?, limit?<=100, offset?, categoryId?, priceMin?, priceMax?, tags?, active? }` | `catalog.products.view` |
| `catalog.get_product_bundle` | `{ productId }` | `catalog.products.view` |
| `catalog.list_selected_products` | `{ productIds: [1..50] }` | `catalog.products.view` |
| `catalog.get_product_media` | `{ productId, limit?<=100, offset? }` | `catalog.products.view` |
| `catalog.get_attribute_schema` | `{ productId?, categoryId? }` | `catalog.products.view` |
| `catalog.get_category_brief` | `{ categoryId }` | `catalog.categories.view` |
| `catalog.list_price_kinds` | `{ limit?<=100, offset? }` | `catalog.settings.manage` |

No tool carries `isMutation: true`. Every tool whitelists an
**existing** feature ID from `packages/core/src/modules/catalog/acl.ts`
(verified by `aggregator.test.ts` + `merchandising-pack.test.ts`). No
new features invented.

### D18 name coexistence

`catalog.list_price_kinds_base` (Step 3.10) stays in the aggregator
alongside the D18 `catalog.list_price_kinds` (Step 3.11). Both route
through the shared `listPriceKindsCore` helper in
`ai-tools/_shared.ts`, so the underlying query cannot drift between
the two tools. `aggregator.test.ts` pins this coexistence
(`has('catalog.list_price_kinds_base')` AND
`has('catalog.list_price_kinds')`).

### Feature-ID mapping decisions

- `search_products`, `get_product_bundle`, `list_selected_products`,
  `get_product_media`, `get_attribute_schema` →
  `catalog.products.view` (matches what the existing
  `/api/catalog/*` GET routes enforce for the same surfaces).
- `get_category_brief` → `catalog.categories.view` (matches the
  existing `/api/catalog/categories` GET).
- `list_price_kinds` → `catalog.settings.manage` (same gate the base
  `_base` tool uses; price kinds are settings-scoped per the existing
  `/api/catalog/price-kinds` route contract).

## Unit tests

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit \
  --testPathPatterns="catalog/__tests__/ai-tools"
```

Result:

```
Test Suites: 8 passed, 8 total
Tests:       57 passed, 57 total
```

Full `packages/core` suite after the change:

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit
Test Suites: 332 passed, 332 total
Tests:       3013 passed, 3013 total
```

Regression check against `packages/ai-assistant`:

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
Test Suites: 25 passed, 25 total
Tests:       316 passed, 316 total
```

Baseline was 331 suites / 2992 tests for core and 25 / 316 for
ai-assistant. Core delta is **+1 suite / +21 tests**, exactly matching
`merchandising-pack.test.ts`. ai-assistant is unchanged. No
regressions.

### Coverage areas

- **Tenant isolation on `search_products`**: cross-tenant product
  returned by the query engine is dropped before the handler emits
  `items`; the `tenant-1` row survives.
- **`search_products` routing**: mock `searchService.search` returns
  a hit → handler pipes the id into `queryProductsWithFilters` and
  emits `source: 'search_service'`. `q` empty → `search` never called;
  handler goes directly to the query-engine path and emits
  `source: 'query_engine'`.
- **`search_products` short-circuit**: when the search service
  returns zero hits, the handler returns
  `{ total: 0, items: [], source: 'search_service' }` without touching
  `findWithDecryption`.
- **Page-size cap** on `search_products` (and all other list tools):
  `limit: 200` fails `safeParse`.
- **`get_product_bundle` not-found**: returns
  `{ found: false, productId }` — no throw.
- **`get_product_bundle` cross-tenant**: tenant mismatch on the
  fetched row also returns `{ found: false }`.
- **`get_product_bundle` aggregate shape**: `translations: null` is
  surfaced explicitly; `prices: { all: [], best: null }` when the
  pricing service returns null; `attributeSchema` present.
- **`list_selected_products` dedup**: 3 duplicate ids → exactly 1
  `findOneWithDecryption` call.
- **`list_selected_products` cross-tenant** drops into `missingIds`
  with a `console.warn` (spy asserts the warn fires). The happy id
  survives in `items`.
- **`list_selected_products` bounds**: empty array and 51-entry
  array both fail `safeParse`.
- **`get_product_media`**: output rows carry `attachmentId` strings;
  `'bytes'`, `'content'`, `'signedUrl'` keys are asserted absent.
- **`get_attribute_schema` resolver reuse**:
  `loadCustomFieldDefinitionIndex` mock is asserted called.
  `resolvedFor: { productId }` when `productId` is provided;
  `resolvedFor: {}` when both are absent.
- **`get_category_brief`**: missing → `{ found: false, categoryId }`;
  hit → `{ found: true, id, name, path, description, attributeSchema }`
  with `resolvedFor.categoryId` set.
- **`list_price_kinds` shape**: D18 projection verified —
  `{ id, code, name, scope, currency, appliesTo }`. Null
  `organizationId` maps to `scope: 'tenant'`; non-null maps to
  `scope: 'organization'`. `isPromotion: true` → `appliesTo:
  'promotion'`; false → `appliesTo: 'regular'`.
- **Missing tenant rejection** on `list_price_kinds` (handler throws
  `Tenant context is required` before touching the DI container).
- **RBAC mandate at pack level**: iterates every exported
  merchandising tool and asserts `requiredFeatures?.length > 0` and
  every feature exists in the module's own `acl.ts` `features` array.
- **Aggregator coexistence**: `catalog.list_price_kinds_base` (Step
  3.10) and `catalog.list_price_kinds` (Step 3.11) are both
  registered; spec-name fidelity assertion pins every D18 tool name.

### Mocking strategy

- `@open-mercato/shared/lib/encryption/find` →
  `findWithDecryption` / `findOneWithDecryption` spies.
- `@open-mercato/shared/lib/crud/custom-fields` →
  `loadCustomFieldValues` (returns `{}`) and
  `loadCustomFieldDefinitionIndex` (returns empty `Map`) spies.
- `searchService` / `catalogPricingService` resolved through a fake
  container. `null` variants flip the DI resolve to throw so the tool
  takes its fallback path (query engine / no best price).
- `em.count` is a jest mock on the fake container.
- No ORM is booted; all tests run in jest's default node environment.

Raw `em.find(` / `em.findOne(` were verified not to appear in any of
the new non-test files:

```
grep -rn "em\.\(find\|findOne\)(" \
  packages/core/src/modules/catalog/ai-tools/
```

returns zero matches.

## Typecheck

```
yarn turbo run typecheck \
  --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — **pass**.
- `@open-mercato/app:typecheck` — same pre-existing diagnostics carried
  over from Steps 3.1 / 3.8:
  - `agent-registry.ts(43,7)` — missing
    `@/.mercato/generated/ai-agents.generated` type declaration
    (runtime-guarded by try/catch).
  - Step 3.8 `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts`
    handler variance errors against the public `AiToolDefinition`
    generic. These are the same diagnostics present before Step 3.11.
- **Zero new diagnostics** on the new catalog ai-tools files
  (verified by grepping the typecheck output — neither
  `merchandising-pack.ts` nor `_shared.ts` is referenced in the
  diagnostics).

## yarn generate

```
yarn generate
```

Succeeded in ~5s. The existing `catalog` entry in
`apps/mercato/.mercato/generated/ai-tools.generated.ts` is unchanged:

```ts
import * as AI_TOOLS_catalog_397 from "@open-mercato/core/modules/catalog/ai-tools";
...
      moduleId: "catalog",
```

Because Step 3.11 did NOT add a new module-root file (only a new pack
under `ai-tools/` plus the aggregator import), no new generator entry
is required. The generator continues to re-evaluate the module-root
`ai-tools.ts` at runtime via the same entry point established in
Step 3.10.

The post-step `configs cache structural` purge still reports skipped
(pre-existing `@open-mercato/queue` export mismatch — unrelated,
same as Steps 3.8–3.10).

## OpenAPI / i18n / Playwright

Not applicable. No API routes, no user-facing strings, no UI surface.

## Notable design decisions

- **Placement inside the catalog ai-tools directory.** The seven D18
  tools live together in `merchandising-pack.ts` so reviewers can
  grep the entire D18 read surface in one file, and so Step 3.12
  (AI-authoring pack) can land as its own sibling without growing
  this file.
- **Shared `listPriceKindsCore` helper.** The brief allowed either a
  refactor or a duplicate-with-NOTE. The shared helper path was
  picked because both `list_price_kinds` and `list_price_kinds_base`
  enumerate the same `CatalogPriceKind` table with identical scoping
  — any drift between the two would be a real bug. The helper lives
  in `ai-tools/_shared.ts` so Step 3.12 can reuse the same module.
- **`search_products` hybrid routing.** `searchService.search`
  currently accepts `tenantId` / `organizationId` / `entityTypes` but
  not structured filters. When `q` is non-empty, the tool pipes the
  hit ids into the query-engine path to apply structured filters
  (category / tags / price / active) post-hoc. This is documented in
  the tool description and here; should a future
  `SearchOptions.filters` field appear, the narrowing step can be
  pushed down into the service.
- **`get_product_bundle` output cohesiveness.** Core product fields
  + categories + tags + variants + prices (`all` + `best`) + media
  metadata + custom-field values + merged attribute schema +
  `translations: null` flag. The `translations` field is surfaced as
  explicit `null` because catalog has no `translations.ts` yet; the
  loader helper exists elsewhere (customers has one) but reusing it
  here would require an additional catalog-side module file out of
  scope for this Step.
- **`get_product_bundle` best-price resolution.** Uses
  `catalogPricingService.resolvePrice` when the DI token is
  registered. `PricingContext` requires `quantity` + `date`; the
  bundle passes `{ quantity: 1, date: new Date() }` since
  merchandising reads have no cart state. When the service throws,
  the handler logs via `console.warn` and falls back to
  `best: null`.
- **`list_selected_products` cross-tenant = missing.** Per the
  brief, cross-tenant ids MUST appear as missing, not as a 403. The
  handler drops them into `missingIds` with a `console.warn` and the
  caller sees a uniform not-found signal whether the product was
  deleted, never existed, or lived in another tenant.
- **`get_product_media` bridge handoff.** The tool returns
  `attachmentId` strings alongside metadata; it does NOT call the
  Step 3.7 bridge. The bridge is expected to intercept attachment
  references when the chat/object helper dispatches the tool
  in-context (that's the whole point of the Phase 3 bridge). A
  short doc-comment on the tool's description makes the handoff
  explicit so Step 4.9 agent wiring knows where the bytes appear.
- **`get_attribute_schema` reuses `loadCustomFieldDefinitionIndex`.**
  This is the canonical CE DSL resolver; no hand-rolled merged
  schema path. Product / category specialization goes through the
  same loader with `entityIds: [E.catalog.catalog_product,
  E.catalog.catalog_product_category]`.
- **`list_price_kinds` vs `list_price_kinds_base` both ship.** Per
  the brief, both names are required. The base tool stays for
  callers wanting raw `displayMode` / `isPromotion` booleans; the
  D18 tool projects the spec shape (`id, code, name, scope,
  currency, appliesTo`). Shared query keeps them lock-step.
- **No `isMutation` tools** in this Step, as the brief mandates.
  Mutation tools are Step 5.14 scope under the pending-action
  contract.
- **No new feature IDs invented.** All seven tools whitelist existing
  IDs from `catalog/acl.ts` (verified by both `aggregator.test.ts`
  and `merchandising-pack.test.ts`).
- **No UI / no OpenAPI / no DB changes.** The Step is purely
  additive on the runtime surface, so BC checklists 7 (routes),
  8 (DB), 10 (ACL feature IDs) are all no-op.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:

- **Surface 1 (Auto-discovery conventions)**: `ai-tools.ts` at module
  root is the already-documented convention. Adding a pack file
  inside `ai-tools/` cannot break existing consumers.
- **Surface 2 (Types)**: no public type changed. The local
  `CatalogAiToolDefinition` shape is module-private; the new
  `ListPriceKindsCoreResult` type lives inside `_shared.ts` and is
  not exported from any package entry point.
- **Surface 3 (Function signatures)**: unchanged. The shared
  helper's signature is new; no existing function signature changed.
- **Surface 5 (Event IDs)**: unchanged. No events emitted.
- **Surface 7 (API route URLs)**: unchanged.
- **Surface 8 (Database schema)**: unchanged.
- **Surface 10 (ACL feature IDs)**: unchanged — only existing IDs
  referenced; both test files enforce this at test time.
- **Surface 13 (Generated file contracts)**: the
  `ai-tools.generated.ts` export shape (`aiToolConfigEntries`,
  `allAiTools`) is unchanged. The existing `catalog` module entry
  now yields 19 tools instead of 12, but the entry shape is
  identical.

The base tool `list_price_kinds_base` now returns two additional
fields (`createdAt`, `updatedAt`) via the shared helper. This is
**additive only** — the Step 3.10 test of this tool only asserts
`codes`, so the change is backward compatible.

## Follow-up candidates (non-blocking)

- **`translations` resolver for catalog.** `get_product_bundle`
  currently returns `translations: null` because catalog has no
  `translations.ts` module file. A Phase 4 / Phase 5 Step can add
  the file and the bundle output will start populating the field
  without any contract change (consumers already handle null).
- **`search_products` pushdown of structured filters.** When
  `SearchOptions.filters` lands in `@open-mercato/search`, the tool
  can push `category`, `tags`, `price`, and `active` into the
  service layer instead of narrowing in-process. Output shape
  remains stable regardless.
- **`get_product_bundle` / `list_selected_products` sharing.** The
  bundle builder is already a single function
  (`buildProductBundle`); Step 3.12's authoring tools can reuse it
  from `merchandising-pack.ts` (or a promoted `_shared.ts` export)
  when they need richer context.
- **`catalogPricingService` PricingContext defaults.** The bundle
  passes `{ quantity: 1, date: new Date() }` because merchandising
  reads have no cart state. A future callback-style context builder
  on the service could eliminate the default when a downstream
  agent wants to preview per-customer-group pricing.
