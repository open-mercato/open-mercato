# Step 2.4 — Checks

**Step title:** Spec Phase 0 — Attachment-bridge contract types + prompt-composition primitive types in `@open-mercato/ai-assistant`.

**Scope:** TYPES ONLY. No runtime resolver, no prompt composer, no attachment fetcher (those live in Phase 3).

## Files touched

- Added `packages/ai-assistant/src/modules/ai_assistant/lib/attachment-bridge-types.ts`
  - `AttachmentSource` string-literal union (`'bytes' | 'signed-url' | 'text' | 'metadata-only'`)
  - `AiResolvedAttachmentPart` (spec lines 985–993, exact field names)
  - `AiUiPart` (spec lines 964–970)
  - `AiChatRequestContext` (spec lines 972–981)
- Added `packages/ai-assistant/src/modules/ai_assistant/lib/prompt-composition-types.ts`
  - `PromptSectionName` string-literal union covering the seven required §8 sections plus the `overrides` surface from spec line 228
  - `PromptSection` (`name` + `content` + optional `order`)
  - `PromptTemplate` (`id` + ordered `sections`)
  - `definePromptTemplate()` identity builder (symmetric with `defineAiTool` / `defineAiAgent`)
- Modified `packages/ai-assistant/src/index.ts` to re-export the six new type symbols and `definePromptTemplate`; existing exports untouched.
- Added `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/attachment-bridge-and-prompt-types.test.ts` — 12 tests across 5 `describe` blocks.

## Unit tests

```
PASS src/modules/ai_assistant/lib/__tests__/attachment-bridge-and-prompt-types.test.ts
... (all other suites)
Test Suites: 12 passed, 12 total
Tests:       167 passed, 167 total
```

Baseline before Step 2.4 was 11 suites / 155 tests (recorded in HANDOFF after Step 2.3). Delta: +1 suite, +12 tests. No regressions.

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`:

- `@open-mercato/core:typecheck` — green (cache hit).
- `@open-mercato/app:typecheck` — fails on the SAME pre-existing stale entry documented in HANDOFF:
  `.mercato/generated/backend-routes.generated.ts(174,12114): error TS2307: Cannot find module '../../src/modules/example/backend/customer-tasks/page'`.
  Unrelated to this Step.
- `grep` of the typecheck output for `attachment-bridge-types`, `prompt-composition-types`, and `attachment-bridge-and-prompt-types` produced zero matches — new files contribute no diagnostics.

## i18n / Playwright / Generate

- i18n — N/A (no user-facing strings; spec baseline prompt strings belong to Phase 3 when the prompt composer lands).
- Playwright — N/A (no UI surface).
- `yarn generate` — N/A (no module structural change; no new auto-discovery file).

## BC contract surfaces (per `BACKWARD_COMPATIBILITY.md`)

- Surface 2 (Type definitions & interfaces): additive-only. No existing types renamed, narrowed, or removed.
- Surface 4 (Import paths): additive-only. Existing `@open-mercato/ai-assistant` re-exports remain at their prior positions; six new type names and one new identity builder added alongside.
- Surfaces 1, 3, 5–13: not touched.

## Notable decisions

- `PromptSectionName` uses camelCase JS-identifier form (`mutationPolicy`, `responseStyle`, `overrides`), not the spec's uppercase `ROLE` / `SCOPE` labels. The uppercase labels in spec §8 are the *rendering* headers that the Phase 3 prompt composer will emit; the primitive type here is the programmatic section key, so camelCase is the correct naming convention. `overrides` covers the tenant/admin override surface mentioned at spec line 228.
- `PromptSection` is deliberately minimal (no rendering logic, no compile step) — this Step lands the *primitive* only.
- `AiResolvedAttachmentPart.data` accepts `Uint8Array | string | null` exactly as spec line 992 shows. `textContent`, `url`, and `data` are all optional so a metadata-only attachment can be constructed with just the four required fields.
