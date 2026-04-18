# Step 4.3 — Verification Log

**Step:** 4.3 — Spec Phase 2 WS-A, client-side UI-part registry with Phase 3 approval-card slots reserved
**Code commit:** `59f23edac`
**Timestamp:** 2026-04-18T14:55:00Z

## Files landed (code commit)

- `packages/ui/src/ai/ui-part-slots.ts` (new) — `RESERVED_AI_UI_PART_IDS` const + `ReservedAiUiPartId` string-literal type.
- `packages/ui/src/ai/ui-part-registry.ts` — expanded with `createAiUiPartRegistry`, `has`, `list`, `clear`, `unregister`; Step-4.1 `registerAiUiPart` / `resolveAiUiPart` kept as shims over the default registry.
- `packages/ui/src/ai/ui-parts/pending-phase3-placeholder.tsx` (new) — DS-compliant info `Alert` placeholder seeded for the four reserved ids.
- `packages/ui/src/ai/AiChat.tsx` — accepts optional `registry?: AiUiPartRegistry`; falls back to `defaultAiUiPartRegistry`.
- `packages/ui/src/ai/index.ts` — additive barrel exports.
- `packages/ui/__integration__/TC-AI-UI-003-aichat-registry.spec.tsx` (new) — Playwright/RTL integration spec asserting registered custom parts replace the default placeholder.
- `packages/ui/src/ai/__tests__/AiChat.registry.test.tsx` (new) — 3 tests covering registry prop precedence, placeholder rendering, and isolation.
- `packages/ui/src/ai/__tests__/ui-part-slots.test.ts` (new) — locks the four reserved ids.
- `packages/ui/src/ai/__tests__/ui-part-registry.test.ts` — extended for create/isolation/replace/clear/list coverage.
- `packages/ui/jest.config.cjs` — test-path discovery tweak.
- `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json` — 4 additive keys under `ai_assistant.chat.pending_phase3.*`.

## Verification

| Check | Outcome |
|-------|---------|
| `npx jest --config=packages/ui/jest.config.cjs --forceExit --testPathPatterns="ai/"` | ✅ 6 suites / 45 tests |
| `yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/ai-assistant --filter=@open-mercato/app` | ✅ 2 tasks cache-hit; pre-existing Step 3.1 `agent-registry.ts(43,7)` carryover unchanged |
| `yarn i18n:check-sync` | ✅ 46 modules / 4 locales in sync |
| `yarn generate` | N/A (no module-discovery surface changes) |
| Unit tests regression (ai-assistant, core) | ✅ baselines preserved via full-test run during checkpoint |
| Browser smoke (Playwright MCP) | Deferred to Step 4.4 — no standalone page embeds `<AiChat>` yet; the integration spec covers the registry resolver path against a mounted RTL harness. Documented here. |

## Decisions

- **Registry isolation via `createAiUiPartRegistry()`** rather than class inheritance — keeps the API functional and avoids forcing consumers into a React Context when an inline prop covers the use case.
- **Reserved slot placeholder** seeds by default (`seedReservedPlaceholders: true`). Set to `false` for test harnesses that want to assert zero-state behavior.
- **`<AiChat>` backward compatibility** — existing Step-4.1 callers that call `registerAiUiPart('foo', Component)` still work. The prop is opt-in.
- **Integration-test placement** — `packages/ui/__integration__/TC-AI-UI-003-aichat-registry.spec.tsx` follows the per-module rule (memory: `feedback_integration_tests_per_module.md`). The spec uses an RTL mount (not Playwright-in-browser) because `<AiChat>` has no standalone page yet; Step 4.4 introduces one and the spec can be upgraded to full Playwright then.

## Next Step

**Step 4.4** — Backend playground page (`/backend/config/ai-assistant/playground`) with agent picker + debug panel + object-mode support. First real browser surface for `<AiChat>`.
