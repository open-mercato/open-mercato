# Step 4.2 — Verification Checks

**Step:** 4.2 — Spec Phase 2 WS-A — Upload adapter reusing the attachments API,
returns `attachmentIds`.
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-18 (UTC)

## Summary

Delivered the framework-agnostic upload adapter plus a React convenience hook
that the Step 4.1 `<AiChat>` composer will call when the user drops files into
the chat. The adapter posts each file to the canonical attachments upload
route (`POST /api/attachments`, multipart form-data — see
`packages/core/src/modules/attachments/api/route.ts`) and returns the resulting
`attachmentIds` so the chat request layer can thread them into the Step 3.3
dispatcher (`POST /api/ai_assistant/ai/chat?agent=<id>` carries
`attachmentIds` in the JSON body).

### Files created

- `packages/ui/src/ai/upload-adapter.ts` — framework-agnostic
  `uploadAttachmentsForChat(files, options)` adapter plus normalized
  failure envelopes.
- `packages/ui/src/ai/useAiChatUpload.ts` — React hook wrapping the adapter
  with per-file state, `overallProgress`, `busy`, and `reset`.
- `packages/ui/src/ai/__tests__/upload-adapter.test.ts` — 8 tests covering
  empty-input short-circuit, multi-file happy path + default endpoint,
  mixed success/failure reason mapping, network error → `network`, abort
  flagging remaining files as `aborted`, concurrency cap (peak ≤ 3 under
  an 8-file batch), entity/record/partition forwarding, and batch-scoped
  fallback `recordId`.
- `packages/ui/src/ai/__tests__/useAiChatUpload.test.tsx` — 4 tests
  covering busy toggle + done status, `overallProgress` averaging
  across mixed outcomes, `reset()`, and abort propagation.

### Files touched (additive only)

- `packages/ui/src/ai/index.ts` — new barrel exports for
  `uploadAttachmentsForChat`, `useAiChatUpload`, and their types.
- `packages/ui/src/index.ts` — unchanged; the existing `export * from './ai'`
  already surfaces the new names (no additional line needed).

## Validation gate

| Check | Command | Result |
|---|---|---|
| New ai/ tests | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="ai/"` | 4 suites / 22 tests / 0.54s — all green (delta +2 suites / +12 tests vs Step 4.1) |
| Full ui regression | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | 55 suites / 291 tests / 2.33s — all green (baseline was 53 / 279; delta matches new coverage exactly) |
| ai-assistant regression | `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | 28 suites / 338 tests / 1.24s — exact match to baseline |
| core regression | `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | 333 suites / 3033 tests / 5.30s — exact match to baseline |
| Typecheck | `yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/core --filter=@open-mercato/app` | 3/3 successful (2 cache hit, 1 cache miss). No new diagnostics. Pre-existing `agent-registry.ts(43,7)` carryover unchanged. |
| `yarn generate` | `yarn generate` | clean; no drift. |
| i18n sync | `yarn i18n:check-sync` | green (46 modules, 4 locales). |

## Key decisions / blockers

### (a) Which attachments endpoint

Targeted `POST /api/attachments` (multipart form-data) —
`packages/core/src/modules/attachments/api/route.ts`. That is the canonical
upload surface used by the rest of the admin UI; the
`/api/attachments/library` endpoint is a list/read route, and the other
attachments sub-routes (`/file`, `/image`, `/partitions`, `/transfer`) are
download / transfer helpers. Per-file payload fields:
- `entityId` — defaults to `'ai-chat-draft'`; overridable via options.
- `recordId` — defaults to `crypto.randomUUID()`; overridable. The
  adapter shares a single `recordId` across every file in a batch so all
  uploads group cleanly in the attachments table.
- `file` — the `File` object.
- `partitionCode` — optional; forwarded verbatim when present.

The adapter does **not** invent a MIME or size policy; the attachments
module is authoritative. Server rejections translate to
`failed[].reason`:

| Status / message | `reason` |
|---|---|
| `413` | `size_exceeded` |
| `403` or `415` | `mime_rejected` |
| `400` + message containing `file type` / `active content` | `mime_rejected` |
| `400` + message containing `size` / `quota` | `size_exceeded` |
| Any other non-2xx | `server` |
| Fetch exception (not `AbortError`) | `network` |
| `AbortError` or signal already aborted | `aborted` |

### (b) Portal vs backend fetch defaulting

The adapter is framework-agnostic: `fetchImpl` defaults to
`globalThis.fetch.bind(globalThis)`. Backend callers that want the
scoped-header / 401-redirect behavior of
`packages/ui/src/backend/utils/api.apiFetch` pass it explicitly (`fetchImpl:
apiFetch`). Portal callers pass their own portal-safe fetch. This avoids
pulling a `@open-mercato/ui/backend/utils/api` import into portal bundles
and keeps the adapter callable outside React entirely (tests prove this:
`upload-adapter.test.ts` exercises it without rendering anything).

### (c) Concurrency semaphore: hand-rolled

Hand-rolled a ~15-line worker pool over a shared index counter. No existing
util in the workspace matches the shape we needed — we require per-slot
ordering (results indexed by input position, not response arrival), and
`Promise.all` fan-out would blow past the cap. Pulling in a dependency for
15 lines would violate the `no new deps` posture Phase 2 WS-A is holding.
The cap clamps to `max(1, min(files.length, concurrency))` and defaults to
3.

### (d) Server-error-reason mapping edge case

The attachments route emits `400 + 'File type not allowed'` for
per-field extension rejection and `400 + 'Active content uploads are not
allowed.'` for polyglot/active-content detection. Both land on
`mime_rejected`. `400 + 'Attachment storage quota exceeded for this
tenant.'` can only come through as `413` today (the route short-circuits
before any `400` quota path), but the substring match (`quota`) covers it
defensively if a future route change downgrades the status. Unknown
non-2xx bodies map to `server` with the raw server message preserved in
`failed[].message`.

### (e) Response JSON parsing

Used `await response.text()` + `JSON.parse(...)` instead of
`response.clone().json()`. Under jsdom (the ui package's jest env),
`Response.clone().json()` returned null in the smoke test, so cloning was
removed. Behaviorally identical in production.

### (f) Hook never throws at consumers

The adapter only rejects on programming errors (e.g. missing `fetch` on
`globalThis`). The hook still wraps the adapter call in `.catch(...)` so
consumers can treat `busy === false` as the authoritative "work complete"
signal even if a misconfigured environment produced no `fetch`. The
hook's `onProgress` forwarding also swallows consumer-callback exceptions.

## Design-system compliance

- Adapter is pure TypeScript; no colors / typography.
- Hook exposes only `UploadFailureReason` codes (`'mime_rejected' |
  'size_exceeded' | 'network' | 'server' | 'aborted'`) plus the raw server
  message. Consumers translate at render time via `useT()` — the hook
  deliberately does not hard-code user-facing copy.
- No new i18n keys required (keeps `ai_assistant.chat.*` unchanged for
  Step 4.6 to finalize).

## Known limitations / deferred

- **Partial-progress events**: the attachments route is a single-shot
  `fetch` with no server-sent progress events. Per-file `onProgress` is
  fired once on completion with `{ loaded: size, total: size }`. When a
  future Step adds chunked uploads or an SSE progress channel, the hook's
  `progress` field can interpolate without a public-API change.
- **Signed-URL / direct-to-S3**: out-of-scope; the adapter always goes
  through `/api/attachments`.
- **Retry / backoff**: not implemented. `failed[]` is authoritative and
  the consumer decides whether to retry. Matches the "conservative,
  server-authoritative" posture the brief asks for.

## Hard-rule check

- [x] Exactly one code commit + one docs-flip commit planned.
- [x] No history rewrite, no force-push.
- [x] Additive BC only: new files, additive barrel exports, no existing
      name renamed/removed, no existing Step 4.1 public surface touched.
- [x] No `em.find(` / `em.findOne(` — UI-only change, not applicable.
- [x] No secrets.
- [x] No `in-progress` lock mutations from this executor.
