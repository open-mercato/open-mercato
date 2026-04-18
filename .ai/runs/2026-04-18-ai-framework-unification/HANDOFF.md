# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T15:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C — Steps 3.7–3.12 landed. Next up
is Step 3.13 (Phase 1 WS-C integration tests).
**Last commit:** `14249bc68` —
`feat(catalog): add D18 authoring tools (draft/extract/suggest) as structured-output helpers`

## What just happened

- Executor landed **Step 3.12** as one code commit (`14249bc68`) plus a
  docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.12-checks.md).
- Five new D18 catalog AI-authoring tools shipped under
  `packages/core/src/modules/catalog/ai-tools/authoring-pack.ts`:
  - `catalog.draft_description_from_attributes` — tonePreference-aware
    description draft. Proposal: `{ description, rationale,
    attributesUsed[] }`. Gate: `catalog.products.view`.
  - `catalog.extract_attributes_from_description` —
    `descriptionOverride?` wins when present. Proposal:
    `{ attributes: Record<string, unknown> (additionalProperties: true),
    confidence: 0..1, unmapped[] }`. Gate: `catalog.products.view`.
    The `additionalProperties: true` surface is intentional because
    tenant attribute schemas are heterogeneous; Step 5.14
    `apply_attribute_extraction` re-validates authoritatively before
    any DB write.
  - `catalog.draft_description_from_media` — attachment metadata only
    (`{ attachmentId, fileName, mediaType, size, altText?, sortOrder? }`).
    NO bytes, NO signed URLs. Cross-tenant
    `userUploadedAttachmentIds` drop with `console.warn` and do NOT
    leak into `userMedia`. Gate: `catalog.products.view`. The Step
    3.7 attachment bridge intercepts attachment references at the
    agent-turn boundary.
  - `catalog.suggest_title_variants` — `targetStyle` enum
    (`short | seo | marketplace`); `maxVariants` defaults to 3, zod
    caps at 5. Proposal: `{ variants[] }`. Gate:
    `catalog.products.view`.
  - `catalog.suggest_price_adjustment` — explicit `isMutation: false`
    per spec §7 line 536 callout. `currentPrice` resolves via
    `catalogPricingService.selectBestPrice`; falls back to `null`
    on DI-resolve-throw, service-throw, or null return. Proposal:
    `{ currentPrice | null, proposedPrice, rationale, constraints:
    { respectedPriceKindScope, respectedCurrency } }`. Gate:
    `catalog.pricing.manage`.
- All five tools set `isMutation: false` **explicitly** in their
  definitions (spec §7 line 536 callout for
  `suggest_price_adjustment`; whole pack mirrors the flag for
  consistency). Test suite asserts the flag on every tool.
- Structured-output contract: each handler validates input + loads
  tenant-scoped context (product bundle, attribute schema, media
  refs, current price) and returns
  `{ found: true, proposal, context, outputSchemaDescriptor: {
  schemaName, jsonSchema } }` — NEVER opens a model call from
  inside the handler. The surrounding agent turn uses
  `runAiAgentObject` (Step 3.5) with the emitted JSON-Schema to
  populate `proposal`. Tool's own `proposal` field is a typed
  placeholder (empty strings / empty arrays / null numbers) matching
  the eventual output schema.
- `_shared.ts` expanded: Step 3.11's `buildProductBundle`,
  `toProductSummary`, `resolveAttributeSchema`, `toPriceNumeric`,
  and bundle types promoted from `merchandising-pack.ts` into
  `_shared.ts` so the authoring pack and the merchandising pack
  consume the same loader. Behavior-preserving —
  `merchandising-pack.ts` now re-imports the helpers unchanged. A
  `description` field was added to the product summary (additive
  only) so `extract_attributes_from_description` can seed the
  model's description input without a second lookup.
- Aggregator: module-root `ai-tools.ts` imports and concats
  `authoringAiTools`. Total catalog AI tools: **24** (12 base + 7
  merchandising + 5 authoring). `aggregator.test.ts` extended to
  cover the new total and pin spec-name fidelity for all five D18
  authoring names.
- RBAC: four describe/extract/media/title tools gate on
  `catalog.products.view`; `suggest_price_adjustment` gates on
  `catalog.pricing.manage`. All existing feature IDs verified
  against `packages/core/src/modules/catalog/acl.ts` — no new IDs
  invented.
- Tenant scoping: all product / attachment / price-kind lookups
  route through `findWithDecryption` /
  `findOneWithDecryption` / `resolveAttributeSchema` with
  `tenantId` + (when set) `organizationId` in both the `where` map
  and the scope tuple. Cross-tenant ids behave as not-found /
  dropped; cross-tenant `userUploadedAttachmentIds` drop with a
  `console.warn` that does NOT leak which ids belonged to which
  tenant (the warn just logs the dropped id without a source
  tenant). Pre-commit grep confirmed zero raw `em.find(` /
  `em.findOne(` in the new production files.
- New unit-test suite at
  `packages/core/src/modules/catalog/__tests__/ai-tools/authoring-pack.test.ts`:
  **1 suite / 20 tests**. Coverage includes:
  - `isMutation: false` mandate on every tool.
  - `requiredFeatures` non-empty and every feature present in the
    module's `acl.ts`.
  - `draft_description_from_attributes` product-not-found returns
    `{ found: false }` (never throws).
  - `extract_attributes_from_description` `descriptionOverride` path
    and `context.attributeSchema` population.
  - `draft_description_from_media` cross-tenant
    `userUploadedAttachmentIds` drop + `console.warn` spy.
  - `suggest_title_variants` default 3 / zod cap 5 (input
    `{ maxVariants: 10 }` rejected).
  - `suggest_price_adjustment` explicit `isMutation: false` callout
    + `currentPrice: null` on service-throw + populated on happy
    path.
  - `outputSchemaDescriptor.jsonSchema` shape plain JSON-Schema
    object (no zod internals leak).
  - Aggregator test: all five new tool names coexist with prior
    catalog tools (24 total).
- Catalog ai-tools scope: **9 suites / 77 tests** (was 8 / 57; +1
  suite / +20 tests matches the new test file). Full core suite:
  **333 suites / 3033 tests** (was 332 / 3013; +1 / +20 exactly
  matches). `ai-assistant` regression: **25 / 316** (preserved —
  zero regression).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — `@open-mercato/core` passes cleanly. `@open-mercato/app` still
  carries the pre-existing diagnostics (Step 3.1 `agent-registry.ts(43,7)`
  + Step 3.8 handler-variance on
  `ai-assistant/ai-tools/{search,attachments,meta}-pack.ts`). Zero
  new diagnostics on the new / modified catalog files (verified —
  the output references neither `authoring-pack.ts` nor the
  promoted `_shared.ts` surface).
- `yarn generate` — re-run as a smoke test; succeeded in ~5s and
  the existing `catalog` module entry in
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` remains
  unchanged (generator discovers `aiTools` via the existing
  module-root `ai-tools.ts`, so no new entry was required). Post-step
  `configs cache structural` purge still reports skipped
  (pre-existing `@open-mercato/queue` export mismatch — unrelated).

## Next concrete action

- **Step 3.13** — Phase 1 WS-C integration tests covering:
  - unknown agent → 404 / refusal path
  - forbidden agent (missing feature ID on the calling user) → 403
  - invalid attachment (missing, cross-tenant, expired) → refusal
    path with safe error surface
  - allowed-tool filtering: agent's `allowedTools` whitelist
    enforces and tools outside the list cannot be invoked
  - tool-pack coverage: every catalog read + authoring tool is
    reachable under the `catalog.merchandising_assistant` agent
    (Step 4.9 wiring permitting) OR the generic `ai_assistant`
    agent.
  - Placement: Playwright TypeScript tests under `.ai/qa/` per
    `.ai/skills/integration-tests/SKILL.md`.
  - Follow the module's existing integration-test conventions:
    tenant / org fixtures via API, cleanup in finally, no reliance
    on seeded data.
- Step 3.13 closes Phase 1 WS-C. Phase 2 (UI surface) starts at
  Step 4.1.

## Blockers / open questions

- **`translations: null` on `catalog.get_product_bundle`**: catalog
  still has no `translations.ts` module file. Non-blocking for Step
  3.12; Phase 4 / Phase 5 can add the resolver. No contract change
  required.
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
- **Step 3.12 `_shared.ts` promotion**: executed as part of the code
  commit. Future non-authoring / non-merchandising packs can reuse
  `buildProductBundle`, `toProductSummary`, `resolveAttributeSchema`,
  `toPriceNumeric` without further refactor. No contract change.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` — Step 3.12 did NOT add a new module-root file;
  only a new pack, the aggregator import, and shared-helper
  promotions. Generator entry for catalog was already present since
  Step 3.10; re-running `yarn generate` confirmed the existing entry
  still resolves. Step 3.13 is integration tests only — no generator
  entry expected.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
