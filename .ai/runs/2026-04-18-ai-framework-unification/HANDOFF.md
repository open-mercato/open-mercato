# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T01:35:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-C Step 4.11 **complete** (Phase 2
integration tests — playground + settings + D18 + injection). **Phase 2
(= spec Phase 2) is now fully closed: rows 4.1 – 4.11 all `done`.**
Next: Step 5.1 — Spec Phase 3 WS-A: extract shared model factory from
`packages/core/src/modules/inbox_ops/lib/llmProvider.ts` into
`@open-mercato/ai-assistant/lib/model-factory.ts`.
**Last commit (code):** `17e754c04` — `test(ai-framework): close Phase 2 with playground + settings + D18 + injection integration tests`

## What just happened

- Step 4.11 extended five TC-AI integration specs (no production code
  touched) to cover every user-facing surface shipped in Steps
  4.1 – 4.10. Total TC-AI integration scenarios: **17 / 17 green** (was
  10 at the start of this Step). All run against the live dev runtime
  on port 3000 with SSE + agents endpoints stubbed via `page.route`.
- Per-spec scenario delta:
  - `TC-AI-PLAYGROUND-004`: 1 → 3 (+ all-three-agents picker, +
    object-mode-disabled alert, + stubbed-SSE chat happy-path).
  - `TC-AI-AGENT-SETTINGS-005`: 3 → 4 (+ detail-panel meta/tools/
    attachment-policy assertion with disabled tool toggles).
  - `TC-AI-MERCHANDISING-008`: 4 → 5 (+ post-trigger sheet title +
    chat composer visible).
  - `TC-AI-INJECT-009`: 1 → 3 (+ click opens dialog with AiChat
    composer, + selection-pill DOM contract). The prior dev-server
    500 flake is resolved (new dev runtime `bgyb7opzt`).
  - `TC-AI-INJECT-010`: 1 → 2 (upgraded trivial registration
    placeholder to real injection-table registration assertion;
    explicit deferred-UI-smoke scenario).
- Jest regression baselines preserved: ai-assistant 30/353,
  core 337/3069, ui 60/328. Typecheck (core + app), `yarn generate`,
  `yarn i18n:check-sync` all green.

## Phase 2 closure summary

| WS | Steps | Outcome |
|----|-------|---------|
| WS-A (`<AiChat>` embed + upload adapter + UI-part registry) | 4.1 – 4.3 | done |
| WS-B (playground + agent settings + i18n/shortcuts) | 4.4 – 4.6 | done |
| WS-C (first customers/catalog agents + D18 demo + injection examples + integration tests) | 4.7 – 4.11 | done |

## Open follow-ups carried to Phase 5

- **Portal customer login UI helper** is missing from
  `packages/core/src/modules/core/__integration__/helpers/` and
  `packages/core/src/helpers/integration/`. TC-AI-INJECT-010 ships a
  deferred-UI-smoke placeholder that must be replaced once the helper
  lands. Phase 5 Step 5.1+ picks this up.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in Phase 5.
- **DataTable selection → injection `context` wiring** — selection
  pills on both customers (TC-AI-INJECT-009) and catalog
  (TC-AI-MERCHANDISING-008) rely on a DOM-injection contract. Phase 3
  / Phase 5 WS-B should wire live rowSelection through the injection
  spot `context` prop so the pills render without DOM patching.

## Next concrete action

- **Step 5.1** — Spec Phase 3 WS-A — Extract shared model factory from
  `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` into
  `@open-mercato/ai-assistant/lib/model-factory.ts`. Support
  `defaultModel` + per-module `<MODULE>_AI_MODEL` env overrides.
  Preserve the existing `llmProvider.ts` signature as a thin wrapper
  over the new factory (BC: additive-only).

## Cadence reminder

- **5-Step checkpoint due.** The last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Steps 4.5 – 4.11 is
  seven Steps. The main coordinator session should run the full
  validation gate + integration suite + ds-guardian sweep before Step
  5.1 lands.
- Phase 2 is integration-covered end-to-end; the next natural pause is
  after Step 5.1 (new shared factory) for an additive-contract spot-
  check.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 is healthy (last `/login`
  200 in 90ms). Reuse for Phase 5 Step 5.1 validation.
- Database / migration state: clean, untouched this Step.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- `yarn i18n:check-sync` green (46 modules × 4 locales); test-only
  Step, so no i18n churn.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
