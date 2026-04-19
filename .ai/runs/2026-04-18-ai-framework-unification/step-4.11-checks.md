# Step 4.11 — Verification Log

**Step:** 4.11 — Spec Phase 2: integration tests (playground + settings + D18 + injection)
**Code commit:** `17e754c04`
**Timestamp:** 2026-04-19T01:30:00Z

## Scope

Phase 2 WS-C closure. Extends five existing TC-AI integration specs with end-to-end
Playwright coverage of every user-facing surface Steps 4.1 – 4.10 shipped. No new
production code; test-only.

## Files touched (code commit)

| File | Change |
|------|--------|
| `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-PLAYGROUND-004-playground.spec.ts` | +2 scenarios: all-three-agents picker + object-mode disabled alert, stubbed-SSE chat happy path |
| `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-AGENT-SETTINGS-005-settings-page.spec.ts` | +1 scenario: populated-registry detail panel with disabled tool toggles + attachment-policy badges |
| `packages/core/src/modules/catalog/__integration__/TC-AI-MERCHANDISING-008-products-sheet.spec.ts` | +1 scenario: sheet title + chat region + composer visible after trigger click |
| `packages/core/src/modules/customers/__integration__/TC-AI-INJECT-009-backend-inject.spec.ts` | +2 scenarios: click opens dialog with AiChat composer; selection-pill DOM contract |
| `packages/core/src/modules/customer_accounts/__integration__/TC-AI-INJECT-010-portal-inject.spec.ts` | upgraded from trivial placeholder to real injection-table registration assertion; explicit deferred-UI-smoke marker |

## Verification

| Check | Outcome | Notes |
|-------|---------|-------|
| `yarn test:integration --grep="TC-AI-PLAYGROUND-004\|TC-AI-AGENT-SETTINGS-005\|TC-AI-MERCHANDISING-008\|TC-AI-INJECT-009\|TC-AI-INJECT-010"` | PASS | **17 / 17** scenarios green (was 10 before this Step; delta +7) |
| `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | PASS | 30 suites / 353 tests preserved |
| `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | PASS | 337 suites / 3069 tests preserved |
| `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | PASS | 60 suites / 328 tests preserved |
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app` | PASS | core cache miss (re-typechecked clean); app cache hit |
| `yarn turbo run typecheck --filter=@open-mercato/ai-assistant` | n/a | ai-assistant package has no `typecheck` script today (parity with Step 4.10). The ai-assistant Jest suite acts as the TS gate via `ts-jest`. |
| `yarn generate` | PASS | generators pass, OpenAPI spec unchanged, structural cache purged across all tenants |
| `yarn i18n:check-sync` | PASS | 46 modules × 4 locales in sync (no i18n churn — test-only change) |

## TC-AI scenario delta

| Spec | Scenarios before (Step 4.10 / earlier) | Scenarios now | Delta |
|------|----------------------------------------|---------------|-------|
| TC-AI-PLAYGROUND-004 | 1 | 3 | +2 |
| TC-AI-AGENT-SETTINGS-005 | 3 | 4 | +1 |
| TC-AI-MERCHANDISING-008 | 4 | 5 | +1 |
| TC-AI-INJECT-009 | 1 | 3 | +2 |
| TC-AI-INJECT-010 | 1 | 2 | +1 |
| **Total** | **10** | **17** | **+7** |

(The Step prompt mentioned a pre-Step baseline of 7 TC-AI tests — that figure reflects the suite before Steps 4.9 / 4.10 landed their own scenarios. At the start of Step 4.11, the suite was already at 10 after the dev-server restart.)

## Decisions / stubs

- **Dev server reuse.** Reused the fresh dev runtime started for 4.10 follow-up (`bgyb7opzt`, `/login` 200 in 90ms). No second dev server was spawned. All 17 TC-AI scenarios ran against port 3000.
- **SSE stubs.** The new playground chat happy-path scenario stubs `**/api/ai_assistant/ai/chat**` with a canned `text/event-stream` body. No real LLM provider is hit. Mirrors the existing TC-AI-PLAYGROUND-004 pattern.
- **Object-mode disabled assertion.** The Phase 2 agent registry is chat-only, so the object tab surfaces the `data-ai-playground-unsupported="object"` info alert. Asserted verbatim rather than waiting for a future object-mode agent.
- **Settings detail panel.** Stubbed the agents endpoint to return one `customers.account_assistant`-shaped record with two tools and two media types. Radix `Switch` surfaces disabled state via `aria-disabled` / `data-disabled` rather than the native attribute — the assertion accepts either.
- **Merchandising sheet title.** Asserted via the first `role="heading"` inside the sheet (locale-agnostic) instead of hard-coding English copy.
- **Customers injection selection pill.** Uses the same DOM-injection contract test TC-AI-MERCHANDISING-008 uses for its pill: the live DataTable rowSelection is not yet wired through the injection `context` prop; the spec pins the pill's DOM shape so future selection wiring must honor it.

## Portal customer login helper — decision

- No `loginCustomer(page, ...)` helper exists in `packages/core/src/modules/core/__integration__/helpers/` or `packages/core/src/helpers/integration/`. Per Step 4.11 scope, `TC-AI-INJECT-010` was **not** upgraded to a full portal UI smoke. Instead it was upgraded to:
  1. a real injection-table registration assertion (imports `@open-mercato/core/modules/customer_accounts/widgets/injection-table` and asserts `customer_accounts.injection.portal-ai-assistant-trigger` is mapped to `portal:profile:after`);
  2. an explicit placeholder scenario that documents the deferred UI smoke so the Phase 5 helper-landing step has a clear marker to replace.
- Phase 5 Step 5.1+ will land the portal customer login helper and upgrade TC-AI-INJECT-010 to a full `/portal/profile` render assertion.

## Blockers / open follow-ups

- **None blocking.** Phase 2 is now fully integration-covered.
- **Portal UI smoke** remains deferred — tracked in this run's HANDOFF / NOTIFY as the Phase 5 opening move.
- **Dedicated portal `ai_assistant.view` customer feature** — same follow-up noted in Step 4.10; Phase 5 should gate the portal widget more tightly than `portal.account.manage`.

## Closure

Phase 4 (spec Phase 2) is now **5 / 5 WS-C** and **11 / 11 overall** (rows 4.1 – 4.11 all `done`). Next action is **Step 5.1 (spec Phase 3 WS-A)** — extract the shared model factory from `inbox_ops/lib/llmProvider.ts`.
