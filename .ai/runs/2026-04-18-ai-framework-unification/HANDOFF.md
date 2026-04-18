# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T21:30:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C — Steps 3.7, 3.8, 3.9, 3.10 landed.
Next up is Step 3.11 (D18 catalog merchandising read tools).
**Last commit:** `0a5395ff2` —
`feat(catalog): add catalog ai-tool pack (read-only Phase 1 base coverage)`

## What just happened

- Executor landed **Step 3.10** as one code commit (`0a5395ff2`) plus a
  docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.10-checks.md).
- Twelve new read-only tools shipped under
  `packages/core/src/modules/catalog/ai-tools/`:
  - `products-pack.ts` — `catalog.list_products`,
    `catalog.get_product` (with `includeRelated` hydrating categories,
    tags, variants, prices, media metadata, unit conversions, custom
    fields).
  - `categories-pack.ts` — `catalog.list_categories`,
    `catalog.get_category`.
  - `variants-pack.ts` — `catalog.list_variants`.
  - `prices-offers-pack.ts` — `catalog.list_prices`,
    `catalog.list_price_kinds_base`, `catalog.list_offers`.
  - `media-tags-pack.ts` — `catalog.list_product_media`,
    `catalog.list_product_tags`.
  - `configuration-pack.ts` — `catalog.list_option_schemas`,
    `catalog.list_unit_conversions`.
- Plus a `types.ts` declaring the local `CatalogAiToolDefinition`
  shape (subset of the canonical `AiToolDefinition`, identical pattern
  to Step 3.9 `customers/ai-tools/types.ts` — avoids adding a
  cross-package jest `moduleNameMapper` entry into
  `packages/core/jest.config.cjs`).
- Module-root `ai-tools.ts` aggregates all six packs via `aiTools` /
  `default`. The existing generator (Step 2.3) discovers the catalog
  module and emits a new
  `@open-mercato/core/modules/catalog/ai-tools` namespace entry in
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` — zero
  generator changes required.
- Tenant isolation: every query routes through `findWithDecryption` /
  `findOneWithDecryption` with `tenantId` + (when set) `organizationId`
  in both the `where` map and the scope tuple, plus a
  defense-in-depth post-filter (`row.tenantId === ctx.tenantId`).
  Pre-commit grep confirms no raw `em.find(` / `em.findOne(` in any of
  the new production files.
- Policy + ACL: every tool whitelists the **minimum existing** feature
  ID from `catalog/acl.ts`:
  - products / variants / prices / offers / media / tags / option
    schemas / unit conversions → `catalog.products.view` (matches
    existing `/api/catalog/*` GET routes).
  - categories → `catalog.categories.view`.
  - price kinds (base) → `catalog.settings.manage` (matches existing
    `/api/catalog/price-kinds` GET).
- **D18 name-collision avoidance**: the base price-kinds enumerator
  uses `catalog.list_price_kinds_base`. Step 3.11 owns
  `catalog.list_price_kinds` verbatim. An aggregator-level assertion
  pins the reservation so a future drive-by cannot collapse the two
  names.
- No mutation tools. Every tool is explicitly read-only; mutations
  land in Step 5.14 under the pending-action contract.
- Detail tools (`get_product`, `get_category`) emit `{ found: false }`
  instead of throwing on miss / cross-tenant / cross-org — matches the
  Step 3.8 / 3.9 pattern.
- New unit-test suites at
  `packages/core/src/modules/catalog/__tests__/ai-tools/`:
  - `products-pack.test.ts` (9 tests — incl. includeRelated shape).
  - `categories-pack.test.ts` (7 tests).
  - `variants-pack.test.ts` (4 tests).
  - `prices-offers-pack.test.ts` (6 tests).
  - `media-tags-pack.test.ts` (3 tests).
  - `configuration-pack.test.ts` (4 tests).
  - `aggregator.test.ts` (3 tests — completeness + RBAC-in-acl audit
    + D18 name reservation).
  Plus a shared `shared.ts` helper with `makeCtx` + `knownFeatureIds`
  pulled from `catalog/acl.ts`.
- Unit tests: **7 suites / 36 tests** in
  `packages/core/src/modules/catalog/__tests__/ai-tools/`. Full core
  suite: **331 suites / 2992 tests** passing (baseline was 324 / 2956;
  +7 / +36 exactly matches the new catalog tests). Ai-assistant
  regression: **25 suites / 316 tests** (baseline preserved).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — same pre-existing diagnostics only (Step 3.8 ai-assistant handler
  variance on `search/attachments/meta` packs + Step 3.1 carryover
  `agent-registry.ts(43,7)`). Zero new diagnostics on the new catalog
  files (verified by grepping the typecheck output for
  `catalog/ai-tools`).
- `yarn generate` — required for this Step (new module-root
  `ai-tools.ts`). Generator ran in ~5s and emitted the `catalog` entry
  correctly. Post-step `configs cache structural` purge reports as
  skipped (pre-existing `@open-mercato/queue` export mismatch,
  unrelated to this Step).

## Next concrete action

- **Step 3.11** — Spec §7 (D18) — Catalog merchandising read tools
  (`catalog.search_products`, `catalog.get_product_bundle`,
  `catalog.list_selected_products`, `catalog.get_product_media`,
  `catalog.get_attribute_schema`, `catalog.get_category_brief`,
  `catalog.list_price_kinds`).
  - Lands on top of the Step 3.10 base surface — reuse the existing
    catalog packs directory and add `ai-tools/merchandising-pack.ts`
    (or similar) rather than duplicating plumbing. The aggregator in
    `packages/core/src/modules/catalog/ai-tools.ts` is the single
    insertion point.
  - `catalog.list_price_kinds` is reserved by the Step 3.10 aggregator
    test. Step 3.11 MUST either land a distinct-shape D18 tool under
    that name or decide to collapse the base `_base` variant into it —
    that decision belongs to 3.11.
  - `catalog.get_product_media` overlaps conceptually with Step 3.10's
    `catalog.list_product_media` — both should be kept: the D18
    variant integrates with the Step 3.7 bridge (returns file parts
    ready for model consumption); the base tool remains
    metadata-only.
  - All tools still read-only. No `isMutation`. No new feature IDs
    (stay inside `catalog/acl.ts`).
  - Use `findWithDecryption` / `findOneWithDecryption` or existing
    services. Pricing touches should route through the DI token
    `catalogPricingService` per the catalog module AGENTS.md.
  - Unit tests per tool: tenant scope + RBAC feature mapping +
    page-size cap + at least one shape check per detail tool. Keep
    the aggregator assertion updated so the D18 names are pinned.
- After 3.11 come the D18 AI-authoring tools (3.12, still read-only
  surface with deterministic output — no mutation), then Step 3.13
  closes WS-C with integration coverage for auth / attachment / tool
  filtering.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing — same
  caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which is
  not emitted yet (Step 3.1 carryover). Runtime try/catch hides it;
  TS flags it as a compile-time diagnostic. Drive-by candidate for any
  future Step that touches ai-agents generator output.
- **Step 3.8 handler-variance diagnostics**: `search-pack.ts`,
  `attachments-pack.ts`, `meta-pack.ts` under ai-assistant still carry
  the Step 3.8 assignment-variance errors from the public
  `AiToolDefinition` generic. Not my Step, not introduced by Step 3.10
  — they pre-exist on the branch. A future Step that touches the
  public `AiToolDefinition` generic can either relax the parameter
  variance or add a `defineAiTool` overload that widens the handler
  input back to `unknown`.
- **`catalog.list_price_kinds` vs `catalog.list_price_kinds_base`
  merge**: Step 3.11 may collapse the two if output shapes converge.
  Left to that Step.
- **Addresses / tags feature ID drift** (Step 3.9 carryover). Flagged
  in `step-3.9-checks.md` Follow-ups.
- **`search.get_record_context` strategy** (Step 3.8 carryover).
- **Attachment transfer duplication** (Step 3.8 carryover).
- **`AttachmentSigner` concrete implementation** (Step 3.7 hook only).
- **Object-mode HTTP dispatcher** (deferred to Phase 4).
- **Tools in object mode** (Step 3.5 gap — AI SDK v6 object entries
  don't accept a `tools` map).
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim on both helpers.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` — re-run in Step 3.10 (new module-root `ai-tools.ts`
  in `packages/core/src/modules/catalog`). Step 3.11 (D18 catalog
  merchandising) will NOT need it again since it will layer onto the
  same aggregator — unless a new module-root file is added.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
