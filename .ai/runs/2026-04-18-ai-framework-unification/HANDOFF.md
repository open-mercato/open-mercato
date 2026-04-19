# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T23:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-C Step 4.9 **complete** (D18 Phase-2
exit: `catalog.merchandising_assistant` + products-list `<AiChat>`
sheet). Next: Step 4.10 — Backend + portal examples using existing
injection/replacement patterns.
**Last commit:** `ebb060c5f` — `feat(catalog): add catalog.merchandising_assistant agent + products-list AiChat sheet (Phase 2 WS-C, spec §10 D18)`

## What just happened

- Step 4.9 delivered the D18 demo (read-only Phase-2 exit):
  - Second agent `catalog.merchandising_assistant` exported from
    `packages/core/src/modules/catalog/ai-agents.ts` alongside
    `catalog.catalog_assistant`. Both are picked up by the generator's
    `aiAgents` barrel.
  - 17-tool whitelist: 7 D18 reads (Step 3.11) + 5 D18 authoring
    (Step 3.12) + 5 general-purpose (Step 3.8). Deny-list tests
    enforce no mutation tools and no base catalog list/get overlap.
  - Prompt template = spec §10.5 verbatim (7 structured sections).
  - `MerchandisingAssistantSheet` drawer embedded on
    `/backend/catalog/catalog/products`, gated behind
    `catalog.products.view` + `ai_assistant.view`. "Acting on N
    products" pill reflects live selection size.
  - Products DataTable emits selection + filter change notifications
    so the sheet forms a spec §10.1-shaped `pageContext` (view,
    recordType, recordId, extra.filter, extra.totalMatching,
    extra.selectedCount) and passes it to `<AiChat>`.
  - 6 new catalog-i18n keys under `catalog.merchandising_assistant.*`,
    4 locales in sync.
  - Playwright integration spec
    `packages/core/src/modules/catalog/__integration__/TC-AI-MERCHANDISING-008-products-sheet.spec.ts`
    asserts trigger button, sheet open, selection pill, and the
    playground picker shows all three agents.
- Unit tests: catalog ai-agents suite **23/23** (was 11; +12 for the
  new agent including deny-lists, whitelist membership, seven-section
  prompt, compilation, page-context stub).
- Typecheck clean, `yarn generate` no drift, `yarn i18n:check-sync`
  green.
- Browser smoke captured three screenshots under
  `step-4.9-artifacts/`: products-list trigger, merchandising sheet
  open, playground picker with all three agents.

## Next concrete action

- **Step 4.10** — Backend + portal examples using existing
  injection/replacement patterns:
  - Pick ONE backend page from another module (outside catalog) and
    demonstrate embedding `<AiChat>` via the widget-injection system
    (not by editing the page directly). Candidates: customers deal
    detail, quotes list, orders list. Prefer a page where a
    per-record pageContext shape is useful.
  - Pick ONE portal page (customer portal) and demonstrate the same
    pattern with `<AiChat>` gated by customer features. Customer
    portal layout lives under
    `packages/ui/src/portal/` and
    `packages/core/src/modules/customer_accounts/frontend/`.
  - Both examples MUST use the existing widget injection spots
    (`widgets/injection/*.tsx` + `widgets/injection-table.ts`) so
    third-party modules can copy the pattern.
  - Integration spec under the owning module's `__integration__/`
    folder.
  - UI-cadence rule applies: real browser smoke for both surfaces,
    screenshots under `step-4.10-artifacts/`.
- **Cadence note:** after Step 4.10 and 4.11, the 5-step checkpoint
  window closes (3 Steps since 4.6 checkpoint: 4.7, 4.8, 4.9; +4.10
  and 4.11 = 5). Full gate due after 4.11.

## Blockers / open questions

- **Turbopack dev-runtime cache** keeps needing a bust
  (`cd packages/core && node build.mjs` + `touch apps/mercato/next.config.ts`)
  every time a new module-root `ai-agents.ts` or generated file
  shifts. Not a blocker — documented recipe works. Consider a
  follow-up in Step 4.11 or later Phase 5 to wire a post-generate
  hook that touches `next.config.ts` automatically.
- **Agent `resolvePageContext`** is still a stub returning `null` for
  both catalog agents. The D18 sheet forms the `pageContext`
  client-side and passes it through `<AiChat>` — so the Step-5.2
  server-side hydration is strictly additive. Flag in 5.2 that the
  merchandising assistant's context already carries selection size.
- **Executor stability:** two stream-idle timeouts in the last two
  Step dispatches. Main session has been finishing docs-flips
  directly when this happens. Keep Step 4.10 scoped tight.

## Environment caveats

- Dev runtime: `yarn dev:app` still running on port 3000 (background
  task `bk93jo24j`). Reused across Steps 4.4 → 4.9.
- Database / migration state: clean, untouched.
- Typecheck clean; pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` carryover tolerated.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
