# Step 5.10 — Checks

**Commit (code):** `0797f0e9b` — `feat(ui): mutation approval UI parts (preview/diff/confirmation/result) + polling + registry wiring (Phase 3 WS-C)`

## What landed

- Four new React components under `packages/ui/src/ai/parts/`:
  - `MutationPreviewCard.tsx` — componentId `mutation-preview-card`.
    Renders the pending action's `fieldDiff` (single) OR `records[]`
    (batch) preview with `Confirm`, `Cancel`, `Review Details` actions.
  - `FieldDiffCard.tsx` — componentId `field-diff-card`. Pure
    presentational three-column diff table with DS semantic tokens
    (`text-status-warning-text` / `text-status-success-text`). Batch
    `records[]` mode renders one section per record.
  - `ConfirmationCard.tsx` — componentId `confirmation-card`.
    Spinner + side-effects copy; the Cancel button disables once the
    polled status flips to `executing`; 412 `stale_version` / 412
    `schema_drift` / 409 `invalid_status` render targeted inline alerts.
  - `MutationResultCard.tsx` — componentId `mutation-result-card`.
    Success / partial-success / failure variants with a record link.
- `useAiPendingActionPolling` — fetch on mount + 3s poll while non-
  terminal; stops on `confirmed` / `cancelled` / `failed` / `expired`;
  exposes `refresh()`; clears every outstanding timer on unmount.
- `pending-action-api` — typed `confirmPendingAction` /
  `cancelPendingAction` helpers over `apiCall` (from
  `@open-mercato/ui/backend/utils/apiCall`) that surface the server's
  structured error envelopes (`code`, `message`, `extra`).
- Keyboard shortcuts route through `useAiShortcuts` (Step 4.6): preview
  card honors `Cmd/Ctrl+Enter` (confirm) + `Escape` (cancel);
  confirmation card honors Escape (Cancel); result card has none.
- Registry: `createAiUiPartRegistry()` learned `seedLiveApprovalCards?:
  boolean`. The app-wide `defaultAiUiPartRegistry` opts in so end users
  see live cards without bootstrap wiring; scoped registries preserve
  the humane `PendingPhase3Placeholder` so playground embeds + unit
  tests stay deterministic.
- `@open-mercato/ui/ai` barrel re-exports the four cards, the polling
  hook, the confirm / cancel helpers, and the shared
  `AiPendingActionCard*` types.
- `AiPlaygroundPageClient` opts into `seedLiveApprovalCards: true` and
  accepts a `?uiPart=<componentId>&pendingActionId=...` debug seed so
  Playwright / operator debug flows render the real preview card
  against a stubbed `/api/ai_assistant/ai/actions/:id`.
- i18n: new `ai_assistant.chat.mutation_cards.*` keys synced across
  en / de / es / pl.

## Design decisions

- **Live cards in the default registry, placeholders in scoped
  registries.** The task brief offered two variants; I landed the
  first so end users of the built-in `<AiChat>` see real cards with
  zero wiring. Scoped consumers (playground, tests, embedded mounts)
  keep the placeholder unless they explicitly opt in via
  `seedLiveApprovalCards: true`. The two existing
  `<AiChat registry={default}>` test scenarios that assumed the
  default registry surfaces the pending-chip were updated to pass an
  explicit scoped registry instead — the contract for test isolation
  is preserved. Four tests total were edited (not removed) to reflect
  the new default.
- **`apiCall` over `apiCallOrThrow` for cards.** Cards need the 412
  `stale_version` / 412 `schema_drift` / 409 `invalid_status` body to
  render targeted alerts; `apiCallOrThrow` would drop that envelope
  into a generic thrown error. The polling hook still uses
  `apiCallOrThrow` because the GET route only returns 200 / 4xx that
  the hook surfaces through the consumer.
- **Playground debug seed for Playwright.** The dispatcher does not
  yet surface `AiUiPart` entries through the plain-text stream
  `useAiChat` consumes. Until the stream format switches to
  UIMessageChunk, the playground reads a `?uiPart=...` seed from the
  URL. The integration test stubs `/api/ai_assistant/ai/actions/:id`
  to return a pending row and asserts the preview card renders with
  `[data-ai-mutation-preview-confirm]` / `[data-ai-mutation-preview-cancel]`
  visible.

## Test deltas

- `packages/ui` — 60 / 328 → **65 / 348** (+5 suites, +20 tests).
  - New suites: `FieldDiffCard.test.tsx` (3),
    `MutationPreviewCard.test.tsx` (4),
    `ConfirmationCard.test.tsx` (5),
    `MutationResultCard.test.tsx` (3),
    `useAiPendingActionPolling.test.tsx` (3). +2 new tests on
    `ui-part-registry.test.ts` covering the live-card default +
    opt-in seeding.
  - Two existing tests (`AiChat.registry.test.tsx` +
    `TC-AI-UI-003-aichat-registry.spec.tsx`) edited to use a scoped
    registry for the pending-chip assertion; behavior is unchanged,
    only the registry path was made explicit.
- `packages/ai-assistant` — 45 / 512 → **45 / 512** (preserved).
- `packages/core` — 338 / 3094 → **338 / 3094** (preserved).

## Validation gate

- `cd packages/ui && npx jest --config=jest.config.cjs --forceExit`
  → 65 suites, 348 tests, all pass.
- `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit`
  → 45 suites, 512 tests, all pass.
- `cd packages/core && npx jest --config=jest.config.cjs --forceExit`
  → 338 suites, 3094 tests, all pass.
- `yarn turbo run typecheck --filter=@open-mercato/ui
  --filter=@open-mercato/core --filter=@open-mercato/app --force`
  → 3 successful, 0 failing.
- `yarn generate` → no drift (skipped unchanged openapi bundle).
- `yarn i18n:check-sync` → `All translation files are in sync.`
  (after `--fix` on the auto-sorted insertion).

Playwright integration run for `TC-AI-PLAYGROUND-004` is deferred to
the 5.10 boundary full-gate checkpoint (the HANDOFF notes Step 5.10 as
the strong candidate for the next full-gate batch). The dev server on
port `3000` (background task `bgyb7opzt`) was reused for local
validation of the chat lane injection path during development.

## BC posture

- Additive only. No schema / DI / existing route / existing repo
  change. The default registry flip (placeholder → live cards) is a
  user-facing improvement; scoped registries preserve the prior
  behavior. The reserved slot ids are unchanged (`RESERVED_AI_UI_PART_IDS`
  tuple is frozen per the `BACKWARD_COMPATIBILITY.md` §6 contract).
- New registry option `seedLiveApprovalCards` is additive with
  `default = false` on scoped registries.

## Follow-ups carried forward

- Step 5.11 — typed `ai.action.confirmed` / `ai.action.cancelled` /
  `ai.action.expired` events via `createModuleEvents`. The confirm
  route (Step 5.8) and the cancel route (Step 5.9) still emit raw
  event ids via the eventBus with a `TODO(step 5.11)` marker.
- Step 5.12 — cleanup worker sweeping `status='pending' AND
  expiresAt < now`.
- Dispatcher flushing of `ResolvedAgentTools.uiPartQueue` into the
  chat SSE stream — stays deferred. Today the preview card is
  triggered by the `?uiPart=` debug seed in the playground; once the
  dispatcher emits UI parts on the wire, the playground effect swaps
  over to reading them from the streamed body.
