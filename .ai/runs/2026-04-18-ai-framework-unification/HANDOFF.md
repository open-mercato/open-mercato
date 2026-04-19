# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T03:40:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.2 **complete**. Phase 3 WS-A
fully landed — the three shipped agents
(`customers.account_assistant`, `catalog.catalog_assistant`,
`catalog.merchandising_assistant`) now hydrate real record-level page
context via their `resolvePageContext` callbacks. Next: Step 5.3 —
versioned prompt-override persistence with safe additive merge rules.
**Last commit (code):** `e3076580a` — `feat(ai-agents): wire real resolvePageContext hydration for customers + catalog agents (Phase 3 WS-A)`

## What just happened

- Two new neighbor helpers landed:
  `packages/core/src/modules/customers/ai-agents-context.ts` and
  `packages/core/src/modules/catalog/ai-agents-context.ts`. They
  delegate to the existing Step 3.9 / 3.10 / 3.11 tool-pack handlers
  (`customers.get_person` / `get_company` / `get_deal`;
  `catalog.get_product`, `catalog.get_product_bundle`,
  `catalog.list_selected_products`) — there is exactly one read-path
  per record type, so the agent-reachable surface and the hydration
  surface stay in lock-step.
- `packages/core/src/modules/customers/ai-agents.ts` and
  `packages/core/src/modules/catalog/ai-agents.ts` replaced their
  `resolvePageContext` stubs with delegation to the neighbor helpers.
  The agent definitions, prompt templates, and allowed-tool whitelists
  are untouched.
- Hydration rules (for all three agents):
  - `tenantId == null` → null (cross-tenant guard, fail-silent).
  - `recordId` not a UUID → null (no-op).
  - Tool handler `{ found: false }` / `missingIds` → null (runtime
    appends no context blurb).
  - Handler throws → `console.warn` + null (chat request never breaks).
- Catalog selection hydration caps at 10 UUIDs before calling
  `list_selected_products`.
- Test deltas:
  - core: 338 / 3073 → **338 / 3094** (+21 tests — 9 customers +
    12 catalog hydration scenarios).
  - ai-assistant: 31 / 363 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) green;
  `yarn generate` green with no drift; `yarn i18n:check-sync` green
  (46 modules × 4 locales). Turbopack recipe applied
  (`cd packages/core && node build.mjs` + `touch apps/mercato/next.config.ts`).

## Open follow-ups carried forward

- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1. Step 5.3 or later should migrate it to
  `createModelFactory(container)` so chat-mode and object-mode runs
  honor `<MODULE>_AI_MODEL` via the shared port.
- **Runtime signature extension** for `AiAgentPageContextInput` —
  the merchandising agent's sheet already carries
  `pageContext.extra.filter` client-side, but the current hook only
  forwards `entityType` + `recordId`. When a Step needs the filter
  server-side (e.g., the D18 bulk-edit flow), widen the shape in
  `packages/ai-assistant/.../ai-agent-definition.ts` additively and
  re-wire the merchandising hydrator to surface it.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Revisit in or after Step 5.3.
- **Portal customer login UI helper** still missing from
  `packages/core/src/modules/core/__integration__/helpers/` — carried
  from Phase 2. TC-AI-INJECT-010 retains its deferred-UI-smoke
  placeholder.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.

## Next concrete action

- **Step 5.3** — Spec Phase 3 WS-B — versioned prompt-override
  persistence with safe additive merge rules. Introduce the per-tenant
  override row (versioned, timestamped, no-op on missing table),
  merge-rules that only add sections (never remove or rewrite
  mandatory MUTATION POLICY / SCOPE), and a BC-safe fallback when a
  tenant has no override. Carry the `PromptTemplate` export pattern
  already in place across the three agents so the merger can address
  sections by name.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1 + 5.2 are the 7th + 8th Steps since. Main coordinator
  should run the full validation gate + integration suites +
  ds-guardian sweep before Step 5.3 lands, or at the latest before
  the Phase 3 WS-C (mutation gate) Step 5.5 touches DB state.
- Phase 3 WS-A is now complete (5.1 + 5.2). The next natural pause is
  after Step 5.4 (settings-UI `mutationPolicy` surface) so Phase 3
  WS-B is closed before the pending-action entity lands.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.3
  validation.
- Database / migration state: clean, untouched this Step (no schema
  changes; only module-root files + new neighbor helpers + unit tests).
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
