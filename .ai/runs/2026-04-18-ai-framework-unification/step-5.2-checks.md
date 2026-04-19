# Step 5.2 — Validation Checks

**Step:** 5.2 — Spec Phase 3 WS-A — Production `ai-agents.ts` files
with `resolvePageContext` callbacks that hydrate record-level context.

**Code commit:** `e3076580a` —
`feat(ai-agents): wire real resolvePageContext hydration for customers + catalog agents (Phase 3 WS-A)`

**Docs-flip commit:** _(this commit)_ —
`docs(runs): mark ai-framework-unification step 5.2 complete`

## Files created

- `packages/core/src/modules/customers/ai-agents-context.ts` —
  new page-context hydrator for `customers.account_assistant`.
  Dispatches on `entityType` (`customers.person`, `customers.company`,
  `customers.deal`, plus bare aliases) to the Step 3.9 tool-pack
  handlers (`customers.get_person` / `get_company` / `get_deal`) with
  `includeRelated: true`. Emits a compact JSON context block.
- `packages/core/src/modules/catalog/ai-agents-context.ts` —
  two named hydrators: `hydrateCatalogAssistantContext` (summary view
  for `catalog.catalog_assistant`) and
  `hydrateMerchandisingAssistantContext` (full bundle view for
  `catalog.merchandising_assistant`). Supports single-product
  (`catalog.product`) and selection-list (`catalog.products.list` with
  a comma-separated UUID list, capped at 10).

## Files touched

- `packages/core/src/modules/customers/ai-agents.ts` —
  `resolvePageContext` now delegates to
  `hydrateCustomersAccountContext`. Stub replaced with a one-line
  call; header comment retained.
- `packages/core/src/modules/catalog/ai-agents.ts` — both
  agents' `resolvePageContext` stubs replaced with delegation to the
  two named hydrators. Filter/extra payload is documented as
  intentionally out-of-scope (the Phase-1 runtime signature does not
  forward `pageContext.extra` to the hook; any signature widening is
  deferred to a later Step).
- `packages/core/src/modules/customers/__tests__/ai-agents.test.ts`
  — new `describe('customers.account_assistant resolvePageContext
  hydration')` block with 9 tests (tenant-missing, non-UUID,
  per-record-type happy paths, cross-tenant/not-found, throwing
  handler, unknown entityType, end-to-end agent callback).
- `packages/core/src/modules/catalog/__tests__/ai-agents.test.ts`
  — new `describe('catalog.catalog_assistant resolvePageContext
  hydration')` block with 7 tests (tenant-missing, single-product,
  not-found, throwing handler, selection-list, 10-id cap,
  unparseable recordId) + new
  `describe('catalog.merchandising_assistant resolvePageContext
  hydration')` block with 5 tests (single bundle, selection-list
  bundles, tenant-missing, throwing handler, unknown entityType).
  One existing test's title clarified from "async identity stub" to
  "yields no extra context for non-UUID recordIds".

## Tests

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| `@open-mercato/core` Jest | 338 / 3073 | **338 / 3094** | +21 tests (9 customers + 12 catalog hydration scenarios) |
| `@open-mercato/ai-assistant` Jest | 31 / 363 | **31 / 363** | preserved |
| `@open-mercato/ui` Jest | 60 / 328 | **60 / 328** | preserved |

Focused re-runs:

- `jest --testPathPatterns="customers/__tests__/ai-agents"` —
  **18 / 18** (9 original + 9 new).
- `jest --testPathPatterns="catalog/__tests__/ai-agents"` —
  **35 / 35** (23 original + 12 new).

All suites green.

## Gate verdicts

- `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/ai-assistant --filter=@open-mercato/app`
  — **green** (core + app cache-hit / fresh pass; ai-assistant has no
  `typecheck` script, ts-jest acts as the TS gate).
- `yarn generate` — **green**, no drift ("Skipped (unchanged)
  openapi.generated.json", all generators completed, structural cache
  purge succeeded).
- `yarn i18n:check-sync` — **green** (46 modules × 4 locales).
- Turbopack recipe applied post-edit: `cd packages/core && node
  build.mjs` (rebuild dist) + `touch apps/mercato/next.config.ts`
  (poke the dev runtime).

## Key decisions

1. **Avoided duplicating tool-pack loader logic.** The helpers look
   up tools by `name` in the existing pack barrels
   (`customers/ai-tools.ts`, `catalog/ai-tools.ts`) and invoke the
   registered `handler(args, ctx)` directly. This keeps a single
   source of truth per record type — the agent-reachable surface
   (Step 3.9 / 3.10 / 3.11) and the hydration surface stay in lock-
   step. A synthetic `CustomersToolContext` / `CatalogToolContext`
   with `isSuperAdmin: true` + empty `userFeatures` is built for the
   hook (tool handlers do not inspect those fields internally — only
   the external policy gate does).

2. **10-id selection cap lives inside the hydrator.** Both catalog
   hydrators call a private `parseSelectionIds(raw)` helper that
   splits on commas, validates each token against the UUID regex,
   de-dupes, and short-circuits at 10 ids. The downstream
   `catalog.list_selected_products` tool enforces its own 1..50
   contractual cap; the 10-id policy is a Step 5.2 hydration budget
   (keeps the system prompt small) and never passes a list longer
   than 10 to the tool.

3. **Cross-tenant hardening.** Every helper enforces
   `tenantId != null` (`return null` otherwise) before the tool call,
   the tool handlers themselves guard tenant scope via
   `findWithDecryption` / `findOneWithDecryption`, and the helpers
   translate any `{ found: false }` / `missingIds` responses to a
   silent `null` return so the runtime appends no context blurb.
   This mirrors the Step 3.9 / 3.11 pack behavior — the platform
   never surfaces cross-tenant data through the agent.

4. **No runtime-signature widening.** The merchandising agent's
   product-list sheet ships a client-side `pageContext.extra.filter`
   object (see `MerchandisingAssistantSheet.tsx`), but the
   `AiAgentPageContextInput` shape defined in
   `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts`
   only forwards `entityType` + `recordId` + `container` + tenant
   scope to `resolvePageContext`. Rather than widen the contract in
   this Step (BC-sensitive), the merchandising hydrator relies purely
   on the selection payload it receives. A future Step may extend the
   signature once a wider use-case justifies it.

5. **Error swallowing is total.** Both helpers wrap the tool handler
   call in `try`/`catch`; failures `console.warn` with a short
   `reason="hydration_error"` string and return `null`. This honors
   the Step 3.2 runtime contract that a hydration fault MUST NEVER
   break the chat request.

## Blockers

None.

## Hard-rule deviations

None. One code commit + one docs-flip commit, both pushed. No history
rewrite. BC additive-only (no public-API changes; the
`resolvePageContext` signature is unchanged, the hook just returns
meaningful data now).
