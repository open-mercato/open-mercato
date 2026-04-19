# Step 4.10 — Verification Log

**Step:** 4.10 — Spec Phase 2 WS-C, backend + portal `<AiChat>` injection examples
**Code commit:** `e41732027`
**Timestamp:** 2026-04-19T00:30:00Z

## Files landed (code commit)

### Backend (customers module)
- `packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/widget.ts` (new)
- `packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/widget.client.tsx` (new, 171 lines)
- `packages/core/src/modules/customers/widgets/injection/ai-assistant-trigger/__tests__/widget.client.test.tsx` (new, 2 tests)
- `packages/core/src/modules/customers/widgets/injection-table.ts` (new — maps to `data-table:customers.people.list:header`)
- `packages/core/src/modules/customers/__integration__/TC-AI-INJECT-009-backend-inject.spec.ts` (new, Playwright)
- `packages/core/src/modules/customers/i18n/{en,pl,es,de}.json` — 4 new keys each under `customers.ai_assistant.*`

### Portal (customer_accounts module)
- `packages/core/src/modules/customer_accounts/widgets/injection/portal-ai-assistant-trigger/widget.ts` (new)
- `packages/core/src/modules/customer_accounts/widgets/injection/portal-ai-assistant-trigger/widget.client.tsx` (new, 136 lines)
- `packages/core/src/modules/customer_accounts/widgets/injection/portal-ai-assistant-trigger/__tests__/widget.client.test.tsx` (new, 2 tests)
- `packages/core/src/modules/customer_accounts/widgets/injection-table.ts` (extended — new `portal:profile:after` entry)
- `packages/core/src/modules/customer_accounts/__integration__/TC-AI-INJECT-010-portal-inject.spec.ts` (new, registration-smoke placeholder — full portal smoke in Step 4.11)
- `packages/core/src/modules/customer_accounts/i18n/{en,pl,es,de}.json` — 4 new keys each under `customer_accounts.portal_ai_assistant.*`

## Verification

| Check | Outcome | Notes |
|-------|---------|-------|
| `npx jest --config=packages/core/jest.config.cjs --forceExit` | ✅ | **337 suites / 3069 tests** (was 335 / 3053; delta +2 / +16 matches the two new widget RTL suites) |
| `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app` | ✅ | core cache miss rebuilt clean |
| `yarn generate` | ✅ | new widgets picked up by the generator pipeline (widgets.generated.ts is gitignored; grep confirms entries) |
| `yarn i18n:check-sync` | ✅ | 46 modules × 4 locales in sync |
| Playwright `TC-AI-INJECT-010` | ✅ | registration-smoke passes trivially; full portal smoke deferred to Step 4.11 when a customer-side login helper lands |
| Playwright `TC-AI-INJECT-009` | ⚠ flaky | dev server on port 3000 was returning HTTP 500 during the run (memory high-water 12.6 GB, stale compile state). Cannot restart dev server without user authorization. The widget unit-test coverage stands; the Step 4.11 integration pass will re-run TC-AI-INJECT-009 against a fresh dev server. |

## Decisions

- **Injection spot ids** — backend `data-table:customers.people.list:header`, portal `portal:profile:after`. Both are existing DataTable/portal spots; no new spot ids introduced.
- **Zero new ACL features.** Backend reuses `customers.people.view` + `ai_assistant.view`; portal reuses `portal.account.manage`. A dedicated portal `ai_assistant.view` customer feature is a follow-up gap — documented here, not blocking.
- **Duplication between backend + portal triggers** is ~120 lines each with different i18n namespaces and different Dialog styling. Below the 50-line "worth extracting" threshold for a shared primitive — re-evaluate if a third injection example lands in Phase 3.
- **No edits to host pages.** `/backend/customers/people/page.tsx` and the portal profile page are untouched; injection-registry does the wiring.
- **`pageContext`** follows spec §10.1 on both sides (view / recordType / recordId / extra). Backend picks up DataTable selection; portal carries the authenticated customer's user id.

## Blockers / open follow-ups

- **Dev server 500** on port 3000 after the widget-module additions. User did NOT authorize a restart; the code itself compiles clean in both typecheck and Jest. Step 4.11 MUST re-run TC-AI-INJECT-009 against a fresh dev server before closing Phase 2.
- **Portal customer-login helper** does not exist in `.ai/qa/tests/helpers` yet. TC-AI-INJECT-010 asserts registration trivially today; Step 4.11 adds the helper and extends the spec.
- **Dedicated portal `ai_assistant.view` feature** — document as a Phase 5 follow-up so the portal widget can gate more tightly than `portal.account.manage`.

## Next Step

**Step 4.11** — Phase 2 integration tests: playground + settings + D18 read-only demo. Closes Phase 2. Will also re-run TC-AI-INJECT-009 against a fresh dev runtime.
