# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T00:35:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-C Step 4.10 **complete** (backend +
portal `<AiChat>` injection examples via existing widget registry).
Next: Step 4.11 — Phase 2 integration tests (playground + settings +
D18 read-only demo). Closes Phase 2.
**Last commit:** `e41732027` — `feat(ai-assistant-examples): backend + portal AiChat injection examples (Phase 2 WS-C)`

## What just happened

- Step 4.10 shipped two injection widgets that demonstrate dropping
  `<AiChat>` onto host surfaces through the existing widget pipeline
  instead of editing host pages:
  - Backend `customers.injection.ai-assistant-trigger` → spot
    `data-table:customers.people.list:header`. Renders an "Ask AI"
    toolbar button on `/backend/customers/people`; click opens a
    Dialog embedding `<AiChat agent="customers.account_assistant">`
    with selection-aware `pageContext` (spec §10.1 shape).
  - Portal `customer_accounts.injection.portal-ai-assistant-trigger`
    → spot `portal:profile:after`. Renders a portal-styled "Ask AI"
    button behind the `portal.account.manage` customer feature.
- RTL unit tests (2 suites / 4 tests) cover trigger render + feature
  gating on both widgets. Core Jest regression: 337 / 3069 (was
  335 / 3053; delta +2 / +16 matches).
- i18n: 4 new keys each on the backend (`customers.ai_assistant.*`)
  and portal (`customer_accounts.portal_ai_assistant.*`) sides, all 4
  locales in sync.
- Integration specs landed under each owning module's
  `__integration__/` folder:
  - `TC-AI-INJECT-009-backend-inject.spec.ts` asserts the trigger
    renders on the people list.
  - `TC-AI-INJECT-010-portal-inject.spec.ts` ships as a registration
    smoke placeholder (no portal customer-login helper yet).

## Open issues carried to Step 4.11

- **Dev server on port 3000 is returning HTTP 500** (peak memory
  12.6 GB, stale compile state). User did NOT authorize a restart;
  the code compiles clean under typecheck + Jest, but TC-AI-INJECT-009
  against the live dev server could not green in the Step 4.10
  window. Step 4.11 must either re-run it against a fresh dev runtime
  or ask the user to restart.
- **Portal customer-login helper** is missing in
  `.ai/qa/tests/helpers`. TC-AI-INJECT-010 is a trivial registration
  smoke today; Step 4.11 should extend
  `packages/core/src/helpers/integration/auth.ts` (or the equivalent)
  with a customer-side login flow and upgrade the spec.
- **Portal `ai_assistant.view` feature gap** — the portal widget
  gates on `portal.account.manage` because no dedicated portal AI
  view feature exists. Document as a Phase 5 follow-up.

## Next concrete action

- **Step 4.11** — Spec Phase 2 — Integration tests closing Phase 2:
  - Playwright coverage of the playground page (`/backend/config/ai-assistant/playground`) including the agent-picker populated with all three agents, debug-panel rendering, chat happy-path with a stubbed SSE response.
  - Playwright coverage of the agent settings page (`/backend/config/ai-assistant/agents`) including the prompt-override editor's `Cmd/Ctrl+Enter` hook and the read-only tool-toggle list.
  - Playwright coverage of the D18 merchandising demo: open the sheet on `/backend/catalog/catalog/products`, verify the selection pill updates when rows are selected.
  - Re-run TC-AI-INJECT-009 + TC-AI-INJECT-010 (after wiring the portal login helper) against a fresh dev runtime.
  - All specs colocated under the owning module's
    `packages/<pkg>/src/modules/<module>/__integration__/` folder.

## Cadence reminder

- 5 Steps since the last full-gate checkpoint (4.7, 4.8, 4.9, 4.10 +
  4.11 upcoming). After Step 4.11 the full integration + validation
  gate is due (user rule: every 5 Steps). Since 4.11 is itself an
  integration-test Step, the checkpoint stacks cleanly on top.

## Environment caveats

- Dev runtime: `yarn dev:app` still registered as background task
  `bk93jo24j` on port 3000 but currently returning 500. Restart
  requires user authorization.
- Database / migration state: clean, untouched.
- Typecheck clean; pre-existing `@open-mercato/app`
  `agent-registry.ts(43,7)` carryover tolerated.
- `yarn i18n:check-sync` green (46 modules × 4 locales).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
