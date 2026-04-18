# Step 3.12 — Verification Checks

## Scope

Phase 1 WS-C sixth Step: ship the five D18 catalog AI-authoring tools
the `catalog.merchandising_assistant` agent (landing in Step 4.9) will
whitelist verbatim. Lives inside
`packages/core/src/modules/catalog/ai-tools/authoring-pack.ts`, layered
on top of Step 3.11's merchandising read pack. All five tools are
structured-output helpers: the handler assembles tenant-scoped context
and emits `{ schemaName, jsonSchema }` for the surrounding agent turn;
it NEVER writes to the database and NEVER opens a fresh model call
from inside itself. Actual `proposal` fields are populated by the
surrounding `runAiAgentObject` call (landed in Step 3.5).

Follows Step 3.11 (D18 read tools) and unlocks Step 3.13 (Phase 1 WS-C
integration tests).

## Files touched

Code commit (`14249bc68`):

- `packages/core/src/modules/catalog/ai-tools/authoring-pack.ts` (new)
  — the five D18 authoring tools + per-tool input/proposal zod shapes
  + `toJsonSchema` helper + `loadProductContext` + `resolvePricingService`
  helpers. ~600 LOC total.
- `packages/core/src/modules/catalog/ai-tools/_shared.ts` (modified) —
  promotes `buildProductBundle`, `toProductSummary`, `resolveAttributeSchema`,
  `toPriceNumeric`, and the bundle types from
  `merchandising-pack.ts` into shared territory so both the
  merchandising read pack and the authoring pack consume the same
  loader. Additive surface — nothing removed.
- `packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts`
  (modified) — re-imports the promoted helpers from `_shared.ts`
  instead of declaring them inline. Behavior-preserving.
- `packages/core/src/modules/catalog/ai-tools.ts` (modified) — imports
  and concats `authoringAiTools` into the module-root aggregator.
  Total catalog AI tools: **24** (12 base + 7 merchandising + 5
  authoring).
- `packages/core/src/modules/catalog/__tests__/ai-tools/authoring-pack.test.ts`
  (new) — 1 suite / 20 tests covering every mandatory scenario (see
  Coverage areas below).
- `packages/core/src/modules/catalog/__tests__/ai-tools/aggregator.test.ts`
  (modified) — extends to 24-tool coverage and pins spec-name fidelity
  for all five D18 authoring tool names alongside the prior base +
  merchandising tools.

Docs-flip commit: PLAN.md row 3.12, HANDOFF.md rewrite, NOTIFY.md
append, this file.

## Five D18 structured-output tools

| Tool | Input | `requiredFeatures` |
|------|-------|--------------------|
| `catalog.draft_description_from_attributes` | `{ productId, tonePreference? }` | `catalog.products.view` |
| `catalog.extract_attributes_from_description` | `{ productId, descriptionOverride? }` | `catalog.products.view` |
| `catalog.draft_description_from_media` | `{ productId, userUploadedAttachmentIds? }` | `catalog.products.view` |
| `catalog.suggest_title_variants` | `{ productId, targetStyle, maxVariants?<=5 }` | `catalog.products.view` |
| `catalog.suggest_price_adjustment` | `{ productId, intent, priceKindId? }` | `catalog.pricing.manage` |

Every tool sets `isMutation: false` **explicitly** in its definition
(spec §7 line 536 calls this out for `suggest_price_adjustment`
specifically; the whole authoring pack mirrors the flag for
consistency and the test suite asserts it on all five tools). No
tool carries `isMutation: true`. Every tool whitelists an existing
feature ID from `packages/core/src/modules/catalog/acl.ts` — verified
by the test suite's RBAC mandate assertion which iterates every
authoring tool and cross-checks against the module ACL array.

### Tool contract

All five tools return one of:

```ts
// Happy path
{
  found: true,
  proposal: { /* typed placeholder matching the output schema shape */ },
  context: { /* tenant-validated input the model needs */ },
  outputSchemaDescriptor: {
    schemaName: string,
    jsonSchema: Record<string, unknown>, // via z.toJSONSchema
  },
}

// Product miss (or cross-tenant)
{ found: false, productId }
```

The `proposal` field is always an empty/zero-valued placeholder
matching the JSON-Schema emitted in `outputSchemaDescriptor.jsonSchema`.
The surrounding agent turn (Step 3.5's `runAiAgentObject` helper)
re-runs the model against that schema to populate `proposal` — the
tool itself never opens a model call from inside its handler.

### Handler contracts per tool

- `draft_description_from_attributes` — returns `{ product, tonePreference }`
  in context. `tonePreference` defaults to `'neutral'` when unset.
- `extract_attributes_from_description` — returns
  `{ product, attributeSchema, description }`. `description` resolves
  from `descriptionOverride` when provided; otherwise falls back to
  the product's stored description. The proposal's `attributes` field
  is a free-form `Record<string, unknown>` (JSON-Schema
  `additionalProperties: true`) because tenant attribute schemas are
  heterogeneous; Step 5.14's `apply_attribute_extraction` re-validates
  each value against the schema authoritatively before any write.
- `draft_description_from_media` — returns
  `{ product, productMedia, userMedia }`. Each media entry carries
  `{ attachmentId, fileName, mediaType, size, altText?, sortOrder? }`
  — **NO bytes, NO signed URLs**. Cross-tenant
  `userUploadedAttachmentIds` are dropped with `console.warn` and do
  not leak into `userMedia`. The Step 3.7 attachment bridge handles
  byte conversion at the agent-turn boundary.
- `suggest_title_variants` — returns
  `{ product, targetStyle, maxVariants }`. `maxVariants` defaults to
  `3` and is capped at `5` by zod.
- `suggest_price_adjustment` — returns
  `{ product, intent, availablePriceKinds, currentPrice }`.
  `currentPrice` resolves via `catalogPricingService.selectBestPrice`
  when the DI token is registered AND the call succeeds; otherwise
  returns `null` (DI resolve throw, service throw, or null return all
  fall into the `null` bucket). Proposal's `constraints` defaults
  `{ respectedPriceKindScope: true, respectedCurrency: true }`; the
  model adjusts these as it generates the price proposal.

### Feature-ID mapping decisions

- Describe / extract / media / title tools → `catalog.products.view`
  (same gate as the D18 merchandising read tools; the authoring
  helpers read the same product bundle).
- `suggest_price_adjustment` → `catalog.pricing.manage` (the
  merchandising_assistant will present the proposal as a pricing
  change; the feature aligns with existing price-kind management
  gates). `catalog.pricing.manage` is verified present in
  `packages/core/src/modules/catalog/acl.ts`.

## Unit tests

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit \
  --testPathPatterns="catalog/__tests__/ai-tools"
```

Result:

```
Test Suites: 9 passed, 9 total
Tests:       77 passed, 77 total
```

Full `packages/core` suite after the change:

```
cd packages/core && npx jest --config=jest.config.cjs --forceExit
Test Suites: 333 passed, 333 total
Tests:       3033 passed, 3033 total
```

Regression check against `packages/ai-assistant`:

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
Test Suites: 25 passed, 25 total
Tests:       316 passed, 316 total
```

Baseline before Step 3.12 was 332 suites / 3013 tests for core and
25 / 316 for ai-assistant. Core delta is **+1 suite / +20 tests**,
exactly matching the new `authoring-pack.test.ts` suite.
ai-assistant is unchanged. Catalog ai-tools scope was 8 / 57 before;
now 9 / 77 (+1 / +20).

### Coverage areas

- **`isMutation: false` asserted** explicitly for each of the five
  tools (mandatory per spec §7 line 536 callout). Iterative test
  walks every tool in the exported `authoringAiTools` array and
  asserts `tool.isMutation === false`.
- **`requiredFeatures` non-empty and valid** for every tool: test
  asserts each tool's `requiredFeatures?.length > 0` and every
  feature exists in `packages/core/src/modules/catalog/acl.ts`
  `features`.
- **`draft_description_from_attributes`**: product-not-found returns
  `{ found: false }` (handler never throws); happy path returns
  empty-defaults `proposal` + fully-populated `context` +
  JSON-Schema descriptor.
- **`extract_attributes_from_description`**: `descriptionOverride`
  wins when provided; `context.attributeSchema` is populated via
  `resolveAttributeSchema` (mocked).
- **`draft_description_from_media`**: cross-tenant
  `userUploadedAttachmentIds` are dropped from `context.userMedia`
  and a `console.warn` fires for each dropped id.
- **`suggest_title_variants`**: default `maxVariants` is `3` when
  unset; `{ maxVariants: 10 }` is rejected by zod (`safeParse`
  succeeds → zod's input upper bound is `5`).
- **`suggest_price_adjustment`**: explicit `isMutation: false`
  callout asserted (spec §7 line 536). `currentPrice` is `null` when
  `catalogPricingService` DI resolve throws (`resolver_unavailable`),
  when the service call throws, OR when the service returns null.
  `currentPrice` is populated when the mock returns a price row.
- **`outputSchemaDescriptor.jsonSchema` shape**: every tool's
  descriptor is asserted to be a plain JSON-Schema object
  (`typeof jsonSchema === 'object'`, `jsonSchema.type === 'object'`,
  no zod internals leak — no `_def`, no `parse`, no `safeParse`).
- **Aggregator coexistence**: module-root `allAiTools` exports all
  five authoring names alongside the 12 base + 7 merchandising
  tools; spec-name fidelity asserted for every D18 authoring name.

### Mocking strategy

- `@open-mercato/shared/lib/encryption/find` →
  `findWithDecryption` / `findOneWithDecryption` spies.
- `@open-mercato/shared/lib/crud/custom-fields` →
  `loadCustomFieldValues` (returns `{}`) and
  `loadCustomFieldDefinitionIndex` (returns empty `Map`) spies.
- `catalogPricingService` resolved through a fake container.
  DI-resolve-throw and service-throw paths both verified for the
  `currentPrice: null` fallback on `suggest_price_adjustment`.
- `em.count` and bundle builders resolved through mock helpers
  exported by `_shared.ts` (same mocking surface Step 3.11
  established for `merchandising-pack.ts`).
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
    (runtime-guarded by try/catch; Step 3.1 carryover).
  - Step 3.8 `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts`
    handler variance errors against the public `AiToolDefinition`
    generic. Identical to Step 3.11.
- **Zero new diagnostics** on the new catalog ai-tools files
  (verified — neither `authoring-pack.ts` nor the `_shared.ts`
  promotion surface is referenced in the typecheck output).

## yarn generate

```
yarn generate
```

Succeeded in ~5s. The existing `catalog` entry in
`apps/mercato/.mercato/generated/ai-tools.generated.ts` continues to
resolve the module-root `ai-tools.ts` which now aggregates
`authoringAiTools` alongside the prior packs. No new generator entry
is required (module-root file unchanged; new tools flow in via the
aggregator's concat).

The post-step `configs cache structural` purge still reports skipped
(pre-existing `@open-mercato/queue` export mismatch — unrelated,
same as Steps 3.8–3.11).

## OpenAPI / i18n / Playwright

Not applicable. No API routes, no user-facing strings, no UI surface.

## Notable design decisions

- **`_shared.ts` needed the helper promotion.** Step 3.11 originally
  declared `buildProductBundle` + `toProductSummary` +
  `resolveAttributeSchema` + `toPriceNumeric` + bundle types inside
  `merchandising-pack.ts`. Step 3.12's authoring tools reuse all of
  them (every authoring tool needs the bundle + schema + at least
  one tool needs the pricing helpers). The brief allowed adding the
  helpers to `_shared.ts`; the code commit promoted them there and
  the merchandising pack now re-imports. Behavior-preserving — a
  grep of `merchandising-pack.test.ts` still passes against the
  re-imports.
- **No separate `resolveCurrentBestPrice` helper was promoted** —
  the authoring pack's inline `resolvePricingService` is a 6-line
  try/catch around `ctx.container.resolve('catalogPricingService')`
  and the call to `selectBestPrice` is inlined at the
  `suggest_price_adjustment` handler site because the signature
  requires a tenant-specific `PricingContext` object the caller
  constructs. Factoring it into `_shared.ts` would add indirection
  without reuse. If a future Step needs the same helper elsewhere,
  it's a trivial extract.
- **`additionalProperties: true` on `extract_attributes_from_description`'s
  `attributes` output.** Tenant attribute schemas are heterogeneous
  (enum / numeric / boolean / string-with-unit) and the CE DSL
  resolver returns `Record<string, unknown>` definitions. Emitting
  `z.record(z.string(), z.unknown())` yields the JSON-Schema
  `additionalProperties: true` surface the model needs to produce
  arbitrary attribute-value pairs. Step 5.14's
  `apply_attribute_extraction` mutation tool re-validates each value
  against the resolved schema authoritatively before any DB write.
- **`catalogPricingService.selectBestPrice` signature.** Confirmed
  present and invoked with `{ quantity, date, variantId? }` context
  per the existing pricing library. When the service is not
  registered OR the call throws OR returns null, `currentPrice`
  surfaces as `null` — matching the brief's fallback contract.
- **`draft_description_from_media` never carries bytes.** The
  handler returns `{ attachmentId, fileName, mediaType, size,
  altText?, sortOrder? }` only. The Step 3.7 attachment bridge
  intercepts attachment references at the agent-turn boundary when
  the chat/object helper dispatches the tool in-context. Documented
  inline + here.
- **No new feature IDs invented.** All five tools whitelist existing
  IDs from `catalog/acl.ts` (verified by both `aggregator.test.ts`
  and `authoring-pack.test.ts`).
- **No UI / no OpenAPI / no DB changes.** BC checklists 7 (routes),
  8 (DB), 10 (ACL feature IDs) are all no-op.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:

- **Surface 1 (Auto-discovery conventions)**: `ai-tools.ts` at module
  root is the already-documented convention. Adding a new pack file
  inside `ai-tools/` cannot break existing consumers.
- **Surface 2 (Types)**: the promoted helper signatures in
  `_shared.ts` are new exports; nothing previously exported was
  removed or narrowed. `merchandising-pack.ts` re-imports them
  unchanged.
- **Surface 3 (Function signatures)**: unchanged on public surface.
  Helper signatures promoted from `merchandising-pack.ts` to
  `_shared.ts` are internal-only (module-private).
- **Surface 5 (Event IDs)**: unchanged. No events emitted.
- **Surface 7 (API route URLs)**: unchanged.
- **Surface 8 (Database schema)**: unchanged.
- **Surface 10 (ACL feature IDs)**: unchanged — only existing IDs
  referenced; both test files enforce this at test time.
- **Surface 13 (Generated file contracts)**: the
  `ai-tools.generated.ts` export shape (`aiToolConfigEntries`,
  `allAiTools`) is unchanged. The existing `catalog` module entry
  now yields 24 tools instead of 19, but the entry shape is
  identical.

## Follow-up candidates (non-blocking)

- **`suggest_price_adjustment` promotion of `resolvePricingService`.**
  If Step 5.14 (catalog mutation tools) or Step 4.9
  (`catalog.merchandising_assistant`) needs the same helper, promote
  to `_shared.ts` at that time. Trivial extract; no contract change.
- **`PricingContext` defaults.** The authoring handler constructs
  `{ quantity: 1, date: new Date() }` because authoring reads have
  no cart state. A future callback-style context builder on the
  pricing service would eliminate the default when a downstream
  agent wants to preview per-customer-group pricing.
- **`draft_description_from_media` media ordering.** The handler
  preserves `sortOrder` when present on the media row but does not
  re-sort. If the surrounding agent needs a deterministic order, a
  future Step can extend the context to sort by `sortOrder` ASC.
