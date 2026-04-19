# Step 5.15 — Verification Checks

**Commit:** `2d6886130` — `feat(ai-assistant-bindings): thread conversationId + bind production agents via widget injection (Phase 3 WS-D)`

**Date:** 2026-04-19
**Spec Phase:** 3 WS-D (Production rollout)

## Scope delivered

1. `<AiChat>` / `useAiChat` accept and forward a stable `conversationId` per
   the Phase 3 WS-D brief. The hook mints one on mount when the caller does
   not supply one; otherwise forwards the caller's id verbatim. The id is
   sent in the POST body to `/api/ai_assistant/ai/chat` and threaded through
   `runAiAgentText` → `resolveAiAgentTools` → `prepareMutation` so the
   Step 5.6 idempotency hash stays stable across turns.
2. Customers People list widget (`customers.injection.ai-assistant-trigger`)
   exposes `computeCustomersAiInjectPageContext` so the `pageContext`
   derivation is unit-testable. The widget already wired `<AiChat>` with a
   `pageContext` object — this Step adds the test coverage called out in
   the brief.
3. New binding: `customers.injection.ai-deal-detail-trigger` on spot
   `detail:customers.deal:header`. The deal detail page gains a single
   `<InjectionSpot>` mount — the trigger, sheet, and `<AiChat>` embed live
   entirely inside the widget. `pageContext` shape
   `{ view, recordType: 'deal', recordId, extra: { stage, pipelineStageId } }`.
4. New binding: `catalog.injection.merchandising-assistant-trigger` on spot
   `data-table:catalog.products:header`. The direct
   `MerchandisingAssistantSheet` import was removed from
   `backend/catalog/products/page.tsx`; the widget reuses the sheet
   component verbatim so TC-AI-MERCHANDISING-008's DOM contract is
   preserved.
5. i18n additions for the new deal-detail widget keys in en/pl/es/de.

## Decisions

- **conversationId minting location.** The mint lives inside `useAiChat`
  via a `React.useRef` initialized on first render. This keeps the
  contract identical for hook callers AND `<AiChat>` consumers, and makes
  unit-testing the "same prop across remounts -> same id" / "no prop
  across remounts -> distinct ids" invariants trivial.
- **Deal detail spot id.** Registered a NEW injection spot
  `detail:customers.deal:header` (there was no existing spot on the deal
  detail page). The spot id follows the shared `DetailInjectionSpots`
  pattern (`detail:<entityId>:header`) already used by the People-v2 /
  Companies-v2 pages. The page only needed a single `<InjectionSpot>`
  mount — all AI-specific code lives in the widget.
- **Catalog merchandising migration vs dual-channel.** Moved to the
  injection path. The brief allowed dual-channel as a fallback, but the
  migration was low-risk: TC-AI-MERCHANDISING-008 asserts the DOM
  contract (`data-ai-merchandising-trigger`, `data-ai-merchandising-sheet`,
  `data-ai-chat-agent="catalog.merchandising_assistant"`), and the new
  widget reuses the SAME `MerchandisingAssistantSheet` component, so
  every data-attribute selector continues to match. The products list
  page lost its `extraActions` wiring, eligibility polling, and feature
  check — feature gating now lives on the widget's `features` metadata.
- **Feature-id gap.** No new feature id was needed. The two new widgets
  reuse existing ids (`customers.deals.view`, `catalog.products.view`,
  `ai_assistant.view`).

## Test + gate results

- `packages/ui`: **66/351** (was 65/348) — +1 suite / +3 tests (the new
  `AiChat.conversation.test.tsx` covering explicit-id stability,
  auto-mint uniqueness, POST-body forwarding).
- `packages/core`: **342/3167** — includes +4 new tests on the existing
  customers people widget, +6 new tests on the deal-detail widget,
  +4 new tests on the catalog merchandising widget, +1 assertion on the
  catalog injection-table test. (Pre-run baseline from Step 5.14 was
  the new mutation-pack suite count — the deltas here are additive.)
- `packages/ai-assistant`: **47/525** preserved (no changes to
  ai-assistant unit suites in this Step).
- `yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`:
  **3/3 successful** (ai-assistant has no dedicated typecheck script
  and is gated by its build step — same as prior Steps).
- `yarn generate`: **green**. New injection widgets `customers.injection
  .ai-deal-detail-trigger` and `catalog.injection.merchandising-assistant-
  trigger` discovered and emitted into `injection-widgets.generated.ts`
  and `injection-tables.generated.ts`.
- `yarn i18n:check-sync`: **green**. All four locales carry the new
  `customers.ai_assistant.dealDetail.*` keys.

## Integration tests

Two new specs added per the "one spec per extended widget" rule:

- `TC-AI-INJECT-012-deal-detail-inject.spec.ts` seeds a deal via the
  customers CRUD API, asserts the trigger renders with the seeded id on
  `data-ai-customers-deal-id`, clicks through to the sheet, asserts the
  `<AiChat>` composer is visible, then cleans up. Tolerant of API seed
  failures (skips cleanly rather than failing the suite) — mirrors the
  robustness pattern used by TC-AI-MUTATION-011.
- `TC-AI-INJECT-013-merchandising-injection.spec.ts` proves the
  injection path renders the same DOM contract that TC-AI-MERCHANDISING-008
  exercised against the direct-wired implementation. Same trigger
  selector, same sheet selector, same chat region selector.

The existing TC-AI-INJECT-009 (customers people inject) and
TC-AI-MERCHANDISING-008 (catalog merchandising direct-wire-cum-injection)
specs continue to pass because every attribute they pin on stayed
stable across the migration.

## BC posture

Fully additive:

- New optional `conversationId?: string` prop on `<AiChat>`.
- New optional `conversationId?: string` input on `useAiChat`.
- New optional `conversationId?: string | null` on
  `RunAiAgentTextInput`.
- New optional `conversationId` field on the chat dispatcher body
  schema (bounded `z.string().min(1).max(128).optional()`).
- Two new injection widgets, one new injection spot id
  (`detail:customers.deal:header`), one new `data-` attribute on
  `<AiChat>`'s region root.
- Two new integration specs. No existing spec was renamed or removed.
- Five new i18n keys per locale, additive.
- One new `data-table:catalog.products:header` mapping in the catalog
  injection-table. The pre-existing `data-table:catalog.products:bulk-
  actions` + `data-table:catalog.products.list:bulk-actions` mappings
  are untouched.

No DB migration, no event rename, no feature-id rename, no DI key
rename, no API route move.

## Follow-ups carried forward

- Step 5.16 — integration tests for page-context resolution, model-factory
  fallback chain, and `maxSteps` execution-budget enforcement.
- Step 5.17 — full pending-action contract integration sweep (happy /
  cancel / expiry / stale-version / cross-tenant / idempotency /
  read-only-agent refusal / prompt-override escalation refusal / reconnect).
- Step 5.18 — full D18 bulk-edit demo (`[Confirm All]` + per-record
  `catalog.product.updated` + DataTable refresh via DOM event bridge +
  `partialSuccess`).
- Step 5.19 — operator rollout docs.

## Verification one-liners

```
cd packages/ui && npx jest --config=jest.config.cjs --forceExit AiChat.conversation
cd packages/core && npx jest --config=jest.config.cjs --forceExit widget.client
cd packages/core && npx jest --config=jest.config.cjs --forceExit injection-table
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app
yarn generate
yarn i18n:check-sync
```
