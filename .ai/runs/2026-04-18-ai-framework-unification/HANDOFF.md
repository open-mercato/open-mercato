# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T22:15:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.10 **complete**. The four Phase 3
mutation-approval cards (`MutationPreviewCard`, `FieldDiffCard`,
`ConfirmationCard`, `MutationResultCard`) are live under
`packages/ui/src/ai/parts/`, wired through the shared
`useAiPendingActionPolling` hook (mount-fetch + 3s poll + terminal
stop + unmount cleanup) and the `apiCall`-backed
`confirmPendingAction` / `cancelPendingAction` helpers. Keyboard
shortcuts (`Cmd/Ctrl+Enter` = confirm, `Escape` = cancel) thread
through `useAiShortcuts`. The `defaultAiUiPartRegistry` now seeds the
LIVE cards; scoped `createAiUiPartRegistry()` still seeds the humane
`PendingPhase3Placeholder` so tests + playground stay deterministic,
and `AiPlaygroundPageClient` opts into `seedLiveApprovalCards: true`
plus a `?uiPart=<componentId>&pendingActionId=...` URL debug seed so
Playwright renders the real preview card against a stubbed polling
endpoint. i18n keys under `ai_assistant.chat.mutation_cards.*` are
synced across all four locales. Next: Step 5.11 — typed `ai.action.*`
events via `createModuleEvents`.
**Last commit (code):** `0797f0e9b` — `feat(ui): mutation approval UI parts (preview/diff/confirmation/result) + polling + registry wiring (Phase 3 WS-C)`

## What just happened

- New components under `packages/ui/src/ai/parts/`:
  - `MutationPreviewCard.tsx` (componentId `mutation-preview-card`) —
    renders `fieldDiff` OR `records[]` summary; `Confirm` / `Cancel` /
    `Review Details` buttons; keyboard shortcuts via `useAiShortcuts`.
    Flips into `<ConfirmationCard>` after confirm, and into
    `<MutationResultCard>` once the polling hook observes a terminal
    status. Surfaces the confirm envelope (412 `stale_version`, 412
    `schema_drift`, 409 `invalid_status`) through the confirmation
    card's inline alerts.
  - `FieldDiffCard.tsx` (componentId `field-diff-card`) — presentational
    three-column diff table with DS semantic tokens
    (`text-status-warning-text` / `text-status-success-text`). Batch
    `records[]` mode groups by record; empty `fieldDiff[]` renders an
    info placeholder alert (no empty table).
  - `ConfirmationCard.tsx` (componentId `confirmation-card`) — shows
    `Spinner` + `sideEffectsSummary`; Cancel button disables once
    polled status flips to `executing`; renders the three targeted
    error alerts; `Escape` submits Cancel.
  - `MutationResultCard.tsx` (componentId `mutation-result-card`) —
    success / partial / failure variants. Success shows a record link
    (from `payload.recordHref`), partial shows a bulleted
    `failedRecords[]` list with `code` + `message`.
- New hook `useAiPendingActionPolling`:
  - Fetches on mount, polls every 3s while non-terminal, stops on
    `confirmed` / `cancelled` / `failed` / `expired`.
  - Reconnect: always refetches on mount, even when the server
    already streamed a card this session.
  - Exposes `refresh()`, clears every outstanding timer on unmount.
- New helpers `confirmPendingAction` / `cancelPendingAction` over
  `apiCall` (not `apiCallOrThrow`) so cards can read the 412 / 409
  envelopes from the body instead of catching a thrown error.
- Registry:
  - `createAiUiPartRegistry()` learned `seedLiveApprovalCards?:
    boolean`. Default = `false` on scoped registries (preserves
    `PendingPhase3Placeholder` contract for tests).
  - `defaultAiUiPartRegistry` sets `seedLiveApprovalCards: true` so
    the app-wide registry resolves the reserved ids to the real
    components.
  - `AI_MUTATION_APPROVAL_CARDS` canonical map exported from
    `packages/ui/src/ai/parts/approval-cards-map.ts` for downstream
    consumers that want to spread the cards into a scoped registry.
  - `@open-mercato/ui/ai` barrel re-exports everything.
- Playground (`AiPlaygroundPageClient`):
  - `createAiUiPartRegistry({ seedLiveApprovalCards: true })` for the
    chat lane.
  - Reads `?uiPart=<componentId>&pendingActionId=...` from
    `window.location` and forwards that into `<AiChat uiParts={...}>`
    so Playwright can render the real preview card against a stubbed
    polling endpoint. Effect is a temporary bridge until the
    dispatcher surfaces `AiUiPart` entries through the streamed body.
- Integration test:
  - Extended `TC-AI-PLAYGROUND-004-playground.spec.ts` with a fourth
    scenario that stubs `/api/ai_assistant/ai/actions/pa-stub-001`,
    navigates with the debug seed, and asserts
    `[data-ai-mutation-preview]` + the two action buttons are visible.
- i18n: new `ai_assistant.chat.mutation_cards.*` keys (preview /
  diff / confirmation / result) synced across en / de / es / pl.
- Existing registry tests updated (not removed) so the "scoped
  registry surfaces the pending chip" assertion passes an explicit
  scoped registry instead of relying on the default (which now seeds
  live cards). Four touched tests, zero removed.
- Test deltas:
  - ui: 60 / 328 → **65 / 348** (+5 suites / +20 tests).
  - ai-assistant: 45 / 512 preserved.
  - core: 338 / 3094 preserved.
- Typecheck clean for `@open-mercato/ui` + `@open-mercato/core` +
  `@open-mercato/app`. `yarn generate` no drift. `yarn i18n:check-sync`
  green after `--fix` auto-sorted the new keys into each locale file.

## BC posture (production inventory)

- Additive only. No schema / DI / existing route / existing repo /
  entity change. The reserved slot-id tuple
  (`RESERVED_AI_UI_PART_IDS`) is unchanged (frozen per the
  `BACKWARD_COMPATIBILITY.md` §6 contract).
- `createAiUiPartRegistry()` signature is additive: the new
  `seedLiveApprovalCards?: boolean` option defaults to `false`, so
  existing scoped-registry callers see no change. The `defaultAiUiPartRegistry`
  behavior did flip from "returns placeholder" to "returns real card"
  for the four reserved ids — this is the intended Phase 3 delivery.
- The `apiCall` / `apiCallOrThrow` wrappers used in the cards live in
  `@open-mercato/ui/backend/utils/apiCall` — backend-only modules are
  not imported from `packages/ui`.

## Open follow-ups carried forward

- **Step 5.11** — typed `ai.action.confirmed` / `ai.action.cancelled` /
  `ai.action.expired` events via `createModuleEvents`. The Step 5.8
  confirm route and the Step 5.9 cancel route still emit the raw
  event ids via the eventBus with `TODO(step 5.11)` markers — 5.11
  swaps the emission sites to the typed helper in one pass.
- **Step 5.12** — cleanup worker sweeping `status='pending' AND
  expiresAt < now` → `expired` + event emission.
- **Step 5.13** — first mutation-capable agent flow
  (`customers.account_assistant` deal-stage updates).
- **Step 5.14** — D18 catalog mutation tools batch + single-approval
  flow.
- **Dispatcher UI-part flushing** — the chat dispatcher still does
  not drain `ResolvedAgentTools.uiPartQueue` into the streamed SSE
  body. Today the preview card is triggered by the `?uiPart=` URL
  debug seed inside the playground. Once the dispatcher format
  switches to UIMessageChunk, the playground effect can swap over to
  reading the streamed `uiParts` payload; public consumers of
  `<AiChat>` can follow the same path via the `uiParts` prop.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.

## Next concrete action

- **Step 5.11** — Spec Phase 3 WS-C — typed `ai.action.confirmed` /
  `ai.action.cancelled` / `ai.action.expired` events via
  `createModuleEvents()` in `packages/ai-assistant/src/modules/ai_assistant/events.ts`.
  Re-emit the existing Step 5.8 (confirm) + Step 5.9 (cancel) + flip-to-
  expired sites through the typed emit helper so subscribers in other
  modules can bind to strongly-typed payloads. The event IDs
  (`ai.action.confirmed` / `ai.action.cancelled` / `ai.action.expired`)
  are already FROZEN per the spec §13 contract; 5.11 only formalizes
  them in the module registry. No UI / card change in this Step —
  `MutationResultCard` already reads `executionResult` directly from
  the polled row rather than listening for events, so the event work
  is a pure backend-side additive.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.10 are the 7th–16th Steps since. **Coordinator should
  run the checkpoint batch at the next boundary** so the full
  validation gate + integration suites + ds-guardian sweep cover
  the new routes and the four new UI parts in one pass. Step 5.10
  is a strong candidate for the checkpoint because it introduces the
  first UI-rich addition in Phase 3 WS-C (all prior Steps were
  routes + entity + policy gates).
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 (foundation) + 5.6 (runtime wrapper) + 5.7
  (reconnect/polling) + 5.8 (confirm) + 5.9 (cancel) + 5.10 (UI parts,
  this Step) done; 5.11–5.14 remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.11
  validation. No dev-server restart required for Step 5.10 (the new
  module is picked up via Next.js HMR).
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/ui` + `@open-mercato/core` +
  `@open-mercato/app`); the ai-assistant package still has no
  `typecheck` script — its Jest suite acts as the TS gate via
  `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s).
  Unchanged.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
