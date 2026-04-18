# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T18:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-A Step 4.2 **complete**. Next: Phase 4
Step 4.3 — client-side UI-part registry formalization with Phase 3
approval-card slots reserved. Step 4.1 already shipped a minimal
`ui-part-registry.ts`; Step 4.3 expands the registry API shape.
**Last commit:** `6acaa8487` —
`feat(ui): add AiChat upload adapter + useAiChatUpload hook (Phase 2 WS-A)`

## What just happened

- Executor landed **Step 4.2** as one code commit (`6acaa8487`) plus a
  docs-flip commit. Step 4.2 delivers the upload adapter that the
  `<AiChat>` composer (Step 4.1) will call when the user drops files
  into the chat, threading the resulting `attachmentIds` into the Step
  3.3 dispatcher (`POST /api/ai_assistant/ai/chat?agent=<id>` reads
  `attachmentIds` from the JSON body).
- **Target endpoint.** The adapter reuses the canonical attachments
  upload route `POST /api/attachments` (multipart form-data;
  `packages/core/src/modules/attachments/api/route.ts`). Fields sent per
  file: `entityId`, `recordId`, `file`, optional `partitionCode`. The
  other attachments routes (`/api/attachments/library`, `/file`,
  `/image`, `/partitions`, `/transfer`) are library/read/transfer
  surfaces — the write path is `POST /api/attachments`.
- New files under `packages/ui/src/ai/`:
  - `upload-adapter.ts` — framework-agnostic pure function
    `uploadAttachmentsForChat(files, options)`. Bounded parallelism via
    a hand-rolled semaphore (default 3, clamped to `max(1,
    min(files.length, concurrency))`). `AbortSignal` support: queued
    files short-circuit as `failed[].reason === 'aborted'`, in-flight
    fetches map `AbortError` to the same reason. Server outcomes
    normalize through a `mapStatusToReason(status, message)` helper:
    `413` → `size_exceeded`, `403/415` → `mime_rejected`,
    `400 + ('file type'|'active content')` → `mime_rejected`,
    `400 + ('size'|'quota')` → `size_exceeded`, everything else →
    `server`. Network failures → `network`. Items preserve input order
    by indexing into `outcomes[]` before flattening. Response JSON
    parsing goes through `response.text()` + `JSON.parse` because
    jsdom's `Response.clone().json()` is unreliable in the test harness.
    `recordId` defaults to `crypto.randomUUID()` when present,
    otherwise `ai-chat-<base36time>-<random>`; shared across the batch
    so every file in a drop groups cleanly.
  - `useAiChatUpload.ts` — React hook wrapping the adapter. Exposes
    `{ files, overallProgress, busy, upload, reset }` with per-file
    `{ fileName, size, progress, status, attachmentId?, reason?,
    error? }`. `overallProgress` is the arithmetic mean of per-file
    `progress` ∈ [0,1]. `busy` toggles on/off around the batch. Caller
    `onProgress` is forwarded without swallowing consumer exceptions.
    Adapter promise is coerced to a failure envelope so the hook never
    throws at consumers.
  - `__tests__/upload-adapter.test.ts` — 8 tests: empty list short-
    circuit, successful multi-file upload + default endpoint, mixed
    success/failure reason mapping, network error → `network`, abort
    → remaining files `aborted` (concurrency=1 ensures the ordering
    assertion), concurrency cap honored at 3 via counter semaphore,
    entityType/recordId/partitionCode forwarding, fallback recordId
    generation + batch-scoped sharing.
  - `__tests__/useAiChatUpload.test.tsx` — 4 tests: busy toggle + done
    status, overallProgress averaging across mixed outcomes, reset()
    clears state, abort propagation.
- Touched files (additive-only):
  - `packages/ui/src/ai/index.ts` — barrel exports for
    `uploadAttachmentsForChat`, `useAiChatUpload`, and their types.
  - `packages/ui/src/index.ts` — unchanged; `export * from './ai'`
    already surfaces the new names.
- Validation gate (all green):
  - ai/ scope:
    `cd packages/ui && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="ai/"`
    → 4 suites / **22 tests** (was 2 / 10; delta +2 suites / +12 tests).
  - `packages/ui` full regression: 55 / **291** (was 53 / 279; delta
    +2 suites / +12 tests — matches new coverage exactly).
  - `packages/ai-assistant` regression: 28 / **338** preserved.
  - `packages/core` regression: 333 / **3033** preserved.
  - Typecheck (`yarn turbo run typecheck --filter=@open-mercato/ui
    --filter=@open-mercato/core --filter=@open-mercato/app`): 3/3
    successful (2 cache hit, 1 cache miss). Pre-existing
    `agent-registry.ts(43,7)` carryover unchanged.
  - `yarn generate`: clean; only refreshed openapi bundle listing
    (unchanged after emit).
  - `yarn i18n:check-sync`: green (46 modules, 4 locales). Hook
    surfaces only `UploadFailureReason` codes — consumers translate at
    render time, so no new i18n keys.
- **Playwright**: skipped for Step 4.2 (same rationale as Step 4.1 —
  adapter is a pure function + React hook covered by Jest + RTL under
  jsdom; a browser round-trip requires a live dev server and a real
  agent endpoint). Step 4.4 (playground) is the first natural
  integration point; Step 4.11 carries the full Playwright sweep.

## Next concrete action

- **Phase 4 Step 4.3** — Client-side UI-part registry formalization
  with Phase 3 approval-card slots reserved. Step 4.1 already shipped
  a minimal `packages/ui/src/ai/ui-part-registry.ts` with register /
  resolve / unregister + `RESERVED_AI_UI_PART_IDS` for the four
  Phase 3 slots (`mutation-preview-card`, `field-diff-card`,
  `confirmation-card`, `mutation-result-card`). Step 4.3 expands the
  registry API shape. Candidate additions:
  - Scoped registries so a host `<AiChat registry={...}>` can pass a
    caller-owned registry instead of falling back to the global one
    (keeps the Step 4.1 global registry as default).
  - Richer `AiUiPartProps` shape (versioned envelope: `{ payload,
    agentId, messageId, reservedId? }`) so Phase 3 approval cards
    can read the pending-action id and emit `confirm` / `cancel`
    events without re-inventing the contract each time.
  - `listRegisteredAiUiPartIds()` helper for debug panels + settings
    tooling.
  - Unit tests updated for the expanded API; keep the Step 4.1 reserved
    constants immutable.
  - No changes to `<AiChat>`'s public contract; the component just
    prefers the prop-supplied registry over the module-global one.

## Blockers / open questions

- **`@ai-sdk/react` still absent from the workspace** — Step 4.1 fall-
  back stays in place (`useAiChat` + hand-rolled text stream). Step 4.2
  is unaffected.
- **Playwright stale-worktree conflict** (`.ai/tmp/review-pr/pr-1372/`)
  — pre-existing; still non-blocking. Operator cleanup task.
- **`packages/ai-assistant` typecheck script** — still missing (carryover).
- **`apps/mercato` stale generated import** — `agent-registry.ts(43,7)`
  Step 3.1 carryover — runtime try/catch hides it.
- **Attachment signer** — still a hook, awaiting concrete impl (carryover).
- **Object-mode HTTP dispatcher** — deferred to Phase 4 / 5 (carryover).
- **Tools in object mode** (Step 3.5 gap — carryover).
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.

## Environment caveats

- Dev runtime runnable: unknown. Phase 4 Step 4.2 was proven through
  Jest + jsdom. Step 4.4 will exercise `<AiChat>` + the upload adapter
  in a real Next.js route and should attempt a Playwright pass.
- Database/migration state: clean, untouched.
- `.ai/tmp/review-pr/pr-1372/` is still a pre-existing stale review
  worktree that breaks local `yarn test:integration --list`. Cleanup is
  an operator task.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
