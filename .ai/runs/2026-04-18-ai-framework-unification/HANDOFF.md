# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T19:15:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-C Step 4.8 **complete** (closes the
generic catalog read-only agent for Phase 2 WS-C). Next: Step 4.9 —
D18 `catalog.merchandising_assistant` agent (read-only Phase 2 exit)
with `<AiChat>` sheet on `/backend/catalog/catalog/products` and
selection-aware `pageContext`.
**Last commit:** `2d2679502` — `feat(catalog): add catalog.catalog_assistant read-only AI agent (Phase 2 WS-C)`

## What just happened

- **First catalog production agent landed** under
  `packages/core/src/modules/catalog/ai-agents.ts` — the second
  `ai-agents.ts` file in the repo. Declares the
  `catalog.catalog_assistant` agent (module `catalog`) with:
  - `readOnly: true` and `mutationPolicy: 'read-only'` so the Step 3.2
    runtime policy gate rejects any whitelisted tool that returns
    `isMutation: true`.
  - `allowedTools` whitelist of 17 tools: twelve from the base catalog
    read pack (Step 3.10 — `catalog.list_products`, `catalog.get_product`,
    `catalog.list_categories`, `catalog.get_category`, `catalog.list_variants`,
    `catalog.list_prices`, `catalog.list_price_kinds_base`, `catalog.list_offers`,
    `catalog.list_product_media`, `catalog.list_product_tags`,
    `catalog.list_option_schemas`, `catalog.list_unit_conversions`) plus
    five general-purpose tools (`search.hybrid_search`,
    `search.get_record_context`, `attachments.list_record_attachments`,
    `attachments.read_attachment`, `meta.describe_agent`).
  - **Zero D18 merchandising tools** (`catalog.search_products`,
    `catalog.get_product_bundle`, `catalog.list_selected_products`,
    `catalog.get_product_media`, `catalog.get_attribute_schema`,
    `catalog.get_category_brief`, `catalog.list_price_kinds`) and
    **zero authoring tools** (`catalog.draft_*`, `catalog.extract_*`,
    `catalog.suggest_*`). Those belong to Step 4.9's
    `catalog.merchandising_assistant`. A deny-list unit test asserts
    every excluded id stays out.
  - `requiredFeatures: ['catalog.products.view', 'catalog.categories.view']`
    — both ids already declared in
    `packages/core/src/modules/catalog/acl.ts`.
  - `acceptedMediaTypes: ['image', 'pdf', 'file']`,
    `executionMode: 'chat'`, no `defaultModel`, no `maxSteps`, no
    structured `output`.
  - Structured `PromptTemplate` export (`promptTemplate`) with the
    seven spec §8 sections (ROLE, SCOPE, DATA, TOOLS, ATTACHMENTS,
    MUTATION POLICY, RESPONSE STYLE). The file compiles the template
    to the `systemPrompt` string the runtime currently consumes; the
    structured shape is additionally exported so Phase 5.3 prompt
    overrides can address sections by name.
  - `resolvePageContext` stub — async function that returns `null`.
- **Types redeclared locally** (same pattern as Step 4.7): the file
  mirrors `AiAgentDefinition`, `PromptTemplate`, and `PromptSection`
  inline so `@open-mercato/core` stays off the
  `@open-mercato/ai-assistant` module graph (package does not declare
  the dependency).
- **Generator output updated.**
  `apps/mercato/.mercato/generated/ai-agents.generated.ts` now imports
  BOTH the customers and the catalog `ai-agents.ts` files. Confirmed
  via grep. The generated file is gitignored — regeneration is
  idempotent on the next `yarn generate`.
- **Unit tests (11)**
  `packages/core/src/modules/catalog/__tests__/ai-agents.test.ts`
  assert: single-agent export, `readOnly: true`, execution metadata
  (no defaultModel / maxSteps / output), whitelist membership
  (catalog-base OR general-purpose), no catalog-pack mutation tool,
  the D18 deny-list (seven ids), the authoring deny-list (five ids),
  every `requiredFeatures` id exists in `catalog/acl.ts`, the seven
  §8 sections in canonical order, prompt compilation into
  systemPrompt, and `resolvePageContext` is an async identity stub.
- **Integration spec** `TC-AI-CATALOG-007` lives under
  `packages/core/src/modules/catalog/__integration__/` (per-module
  placement rule). Three checkpoints:
  - `GET /api/ai_assistant/ai/agents` returns the agent with
    `readOnly: true`, the expected tool names included, and the D18
    tool names explicitly excluded.
  - `meta.describe_agent` via `POST /api/ai_assistant/tools/execute`
    echoes the composed prompt with every §8 section header.
  - Playground picker at `/backend/config/ai-assistant/playground`
    lists BOTH `catalog.catalog_assistant` and
    `customers.account_assistant`.
- **Browser smoke** captured as
  `step-4.8-artifacts/playground-catalog-agent.png`. Reused the
  pre-existing `yarn dev:app` background task on port 3000; rebuilt
  `@open-mercato/core` (`node build.mjs`) and touched
  `apps/mercato/next.config.ts` to bust the Turbopack module graph
  cache — same recipe from Step 4.7. Snapshot confirms both agents
  are in the picker, the Catalog Assistant card shows Module `catalog`,
  Execution mode `chat`, Mutation policy `read-only`, Allowed tools
  `17`.

## Next concrete action

- **Step 4.9** — `catalog.merchandising_assistant` (Spec §10 / D18).
  Add the SECOND catalog agent entry to
  `packages/core/src/modules/catalog/ai-agents.ts` (spec §10 defines
  this as a distinct agent id, not a replacement for
  `catalog_assistant`). Read-only Phase 2 exit. Canonical whitelist
  covers the seven D18 read tools + the authoring tools that run as
  structured-output proposals (still `isMutation: false`; mutation
  writes are Step 5.14 and go through the pending-action contract).
  Add the `<AiChat>` sheet on `/backend/catalog/catalog/products`
  with selection-aware `pageContext`. See spec §10 for the exact
  canonical feature set and prompt tone.

## Blockers / open questions

- **Core → ai-assistant dependency direction.** Still unresolved.
  `@open-mercato/core` does NOT declare `@open-mercato/ai-assistant`
  in `package.json`, so `import type { AiAgentDefinition } from
  '@open-mercato/ai-assistant'` fails typecheck. Step 4.8 reused the
  Step 4.7 workaround (redeclare the shapes locally). Step 4.9 can
  import the types directly from
  `packages/core/src/modules/catalog/ai-agents.ts` (same file) to
  stay consistent.
- **Turbopack cache invalidation.** Same trap as Step 4.7. Adding a
  new module-root `ai-agents.ts` required `cd packages/core && node
  build.mjs` + touching `apps/mercato/next.config.ts` before the dev
  server could resolve the new module. **Step 4.9 does NOT need this
  step** because it extends an existing `ai-agents.ts` (the file will
  already be in the Turbopack graph after Step 4.8).
- **Integration test not executed.** `yarn test:integration --grep=
  "TC-AI-CATALOG-007"` was NOT run for this Step because the full
  suite is not part of the unit-gate baselines the brief tracks. The
  spec is deterministic superadmin + API + DOM; it will be exercised
  as part of Step 4.11 cross-cutting coverage.

## Environment caveats

- Dev runtime reachable. Reused the pre-existing `yarn dev:app`
  background task on port 3000 (task id `bk93jo24j`). No second dev
  server spawned.
- Database / migration state: clean, untouched.
- `yarn i18n:check-sync` green (46 modules × 4 locales). No new i18n
  keys introduced in Step 4.8.
- Typecheck clean (`@open-mercato/core` cache miss/rebuilt; app
  cached).
- `packages/core` baseline extended to **335 suites / 3053 tests**
  (was 334 / 3042 after Step 4.7 — delta is this Step's new test
  suite +1 / +11).
- `packages/ai-assistant` preserved at **30 suites / 353 tests**.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
