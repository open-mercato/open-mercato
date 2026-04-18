# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T23:05:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C — Steps 3.7, 3.8, 3.9, 3.10, 3.11
landed. Next up is Step 3.12 (D18 catalog AI-authoring tools).
**Last commit:** `6e0beccb8` —
`feat(catalog): add D18 merchandising read tools (search_products, get_product_bundle, list_selected_products, get_product_media, get_attribute_schema, get_category_brief, list_price_kinds)`

## What just happened

- Executor landed **Step 3.11** as one code commit (`6e0beccb8`) plus a
  docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.11-checks.md).
- Seven new D18 merchandising read tools shipped under
  `packages/core/src/modules/catalog/ai-tools/merchandising-pack.ts`:
  - `catalog.search_products` — hybrid search + filter. Routes through
    `searchService.search(q, { entityTypes: ['catalog:catalog_product'] })`
    when `q` is non-empty, falling back to the query engine with filters
    (category / tags / price bounds / active) when `q` is empty OR the
    search service is not registered in DI. Output carries
    `source: 'search_service' | 'query_engine'` so callers can tell
    which path ran.
  - `catalog.get_product_bundle` — aggregate bundle (core fields,
    categories, tags, variants, prices all + best, media metadata,
    custom-field values, merged attribute schema). `translations: null`
    is surfaced explicitly — no `translations.ts` exists for catalog
    yet; flagged as a non-blocking follow-up.
  - `catalog.list_selected_products` — bulk variant (1..50 ids,
    deduplicated). Cross-tenant / missing ids drop into `missingIds`
    with a `console.warn`. No 403 surface.
  - `catalog.get_product_media` — attachment metadata + `attachmentId`
    strings only. Does NOT invoke the Step 3.7 bridge; the runtime
    bridge converts ids into model file parts when the chat/object
    helper dispatches the tool in-context.
  - `catalog.get_attribute_schema` — merged module + category +
    product-level schema via the shared
    `loadCustomFieldDefinitionIndex` resolver.
  - `catalog.get_category_brief` — category snapshot reusing the same
    resolver; `{ found: false }` on miss / cross-tenant.
  - `catalog.list_price_kinds` — D18 spec-named enumerator. Coexists
    with Step 3.10's `catalog.list_price_kinds_base`; both tools route
    through the new shared `listPriceKindsCore` helper in
    `ai-tools/_shared.ts` so they cannot drift.
- New shared helper at
  `packages/core/src/modules/catalog/ai-tools/_shared.ts` extracts the
  tenant-scoped `CatalogPriceKind` enumeration. Step 3.10's
  `list_price_kinds_base` was refactored to use it (output shape
  preserved; `createdAt` / `updatedAt` added — additive only).
- Aggregator updated: module-root `ai-tools.ts` now imports and
  concats `merchandisingAiTools`. Total catalog read-only tools:
  **19** (12 base + 7 D18). `aggregator.test.ts` extended with a
  coexistence assertion (both `list_price_kinds_base` and
  `list_price_kinds` registered) and a spec-name fidelity assertion
  (every D18 name matches verbatim).
- Tenant isolation: every query routes through `findWithDecryption` /
  `findOneWithDecryption` with `tenantId` + (when set)
  `organizationId` in both the `where` map and the scope tuple, plus
  a defensive `row.tenantId === ctx.tenantId` post-filter. Pre-commit
  grep confirmed zero raw `em.find(` / `em.findOne(` in the new
  production files.
- Policy + ACL: every new tool whitelists existing feature IDs from
  `catalog/acl.ts`:
  - search / bundle / list_selected / media / attribute_schema →
    `catalog.products.view`.
  - category_brief → `catalog.categories.view`.
  - list_price_kinds (D18) → `catalog.settings.manage` (same gate as
    the base `_base` tool).
- No mutation tools. Every tool is explicitly read-only; mutations
  land in Step 5.14 under the pending-action contract.
- Detail tools (`get_product_bundle`, `get_category_brief`) emit
  `{ found: false }` instead of throwing on miss / cross-tenant —
  matches the pattern Steps 3.8–3.10 established.
- New unit-test suite at
  `packages/core/src/modules/catalog/__tests__/ai-tools/merchandising-pack.test.ts`:
  **1 suite / 21 tests**. Coverage includes:
  - RBAC mandate (all 7 tools declare non-empty
    `requiredFeatures` and none is a mutation).
  - `search_products` routing — searchService-present → service path,
    `q` empty → query engine; cross-tenant leak drop; zero-hit short
    circuit; limit cap ≤ 100.
  - `get_product_bundle` — missing returns `{ found: false }`;
    cross-tenant same; hit surfaces the full aggregate with
    `translations: null` and `prices: { all: [], best: null }`.
  - `list_selected_products` — input dedup (3 copies → 1 fetch);
    cross-tenant ids appear in `missingIds` (not as an error);
    `productIds` bounds `1..50` enforced.
  - `get_product_media` — `attachmentId` strings only; no `bytes`,
    no `content`, no `signedUrl` keys.
  - `get_attribute_schema` — calls `loadCustomFieldDefinitionIndex`;
    `resolvedFor` is correct for product / category / empty cases.
  - `get_category_brief` — missing + hit paths with attribute schema.
  - `list_price_kinds` (D18) — coexistence with `_base` in the
    aggregator; D18 output shape `{ id, code, name, scope, currency,
    appliesTo }`; tenant-null rejection.
- Aggregator test updated from 3 tests to 4 (coexistence assertion
  replaces the reservation assertion; spec-name fidelity assertion
  added).
- Catalog ai-tools scope: **8 suites / 57 tests** (was 7 / 36; +1
  suite / +21 tests matches the new test file). Full core suite:
  **332 suites / 3013 tests** (was 331 / 2992; +1 / +21 exactly
  matches the new suite). `ai-assistant` regression: **25 / 316**
  (preserved — zero regression).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — `@open-mercato/core` passes cleanly. `@open-mercato/app` still
  carries the pre-existing diagnostics (Step 3.8 handler-variance in
  `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts` +
  Step 3.1 `agent-registry.ts(43,7)`). Zero new diagnostics on the
  new catalog files (verified — the output references neither
  `merchandising-pack.ts` nor `_shared.ts`).
- `yarn generate` — re-run as a smoke test; succeeded in ~5s and the
  existing `catalog` module entry in
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` remains
  unchanged (generator discovers `aiTools` via the existing
  module-root `ai-tools.ts`, so no new entry was required). Post-step
  `configs cache structural` purge still reports skipped
  (pre-existing `@open-mercato/queue` export mismatch — unrelated).

## Next concrete action

- **Step 3.12** — Spec §7 (D18) — Catalog AI-authoring tools
  (`draft_description_from_attributes`,
  `extract_attributes_from_description`, `draft_description_from_media`,
  `suggest_title_variants`, `suggest_price_adjustment`). These are
  structured-output helpers (not classic read tools): they compose
  `runAiAgentObject` from Step 3.5 with tenant-scoped context, and
  their handlers return zod-typed proposals rather than database rows.
  - Placement: new file
    `packages/core/src/modules/catalog/ai-tools/authoring-pack.ts`
    alongside the existing packs; aggregator gets a seventh `...`
    entry.
  - Reuse `resolveAttributeSchema` and the bundle-building helpers
    from `merchandising-pack.ts` — factor into `_shared.ts` if the
    reuse surface grows past two callers.
  - Still read-only at the surface (no `isMutation: true`); any
    eventual write flows through Step 5.14 mutation tools plus the
    pending-action contract.
  - RBAC: same `catalog.products.view` gate for describe-style tools;
    `catalog.pricing.manage` for `suggest_price_adjustment` since it
    previews pricing deltas.
  - Unit tests: per-tool shape assertion, tenant scope, feature
    gating, and mock of the `runAiAgentObject` call surface so the
    tests don't hit a real model endpoint.
- After 3.12, Step 3.13 closes WS-C with integration coverage for
  auth / attachment / allowed-tool filtering.

## Blockers / open questions

- **`translations: null` on `catalog.get_product_bundle`**: catalog
  does not ship a `translations.ts` module file yet, so the bundle
  returns `translations: null` with an explicit doc-comment flag.
  Non-blocking for Step 3.11; a future Step (Phase 4 or Phase 5) can
  add the translations resolver and the bundle output will start
  populating the field without contract change.
- **`packages/ai-assistant` typecheck script**: still missing.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  Step 3.1 carryover — runtime try/catch hides it.
- **Step 3.8 handler-variance diagnostics**: unchanged.
- **Addresses / tags feature ID drift** (Step 3.9 carryover).
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
- `yarn generate` — Step 3.11 did NOT add a new module-root file,
  only a new pack and the aggregator import. The generator entry for
  catalog was already present since Step 3.10; re-running `yarn
  generate` confirmed the existing entry still resolves correctly.
  Step 3.12 likewise will NOT need a new generator entry unless it
  adds a new module-root file — which is not the plan (a new pack
  file under `ai-tools/` is sufficient).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
