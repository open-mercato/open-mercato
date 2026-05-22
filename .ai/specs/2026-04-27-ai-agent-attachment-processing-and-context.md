# AI Agent Conversation Context & Pluggable Attachment Processing

**Date**: 2026-04-27
**Status**: Draft
**Module**: `ai_assistant` (`packages/ai-assistant/src/modules/ai_assistant/`) + `attachments` (`packages/core/src/modules/attachments/`)
**Related**: feat/ai-framework-unification (PR #1593) — typed AI agents (`defineAiAgent`, `runAiAgentText`, `runAiAgentObject`)
**Owner**: AI Framework

---

## TLDR

Two things. (1) Verify and lock in that the unified AI chat preserves multi-turn context across requests, and add the integration test that proves it. (2) Replace today's hardcoded attachment-to-model conversion with a **pluggable, per-agent attachment processing pipeline** that lets agent authors declare *which* MIME types they accept *and how* each type should be converted (raw bytes / inline base64 / extracted text / rendered page images / OCR fallback). PDFs gain an automatic image-pages fallback when they exceed inline byte budgets, reusing the existing rasterizer in `packages/core/src/modules/attachments/lib/pdfProcessing.ts`. This spec is a framework-extension contract — third-party `defineAiAgent` authors can opt agents into the new pipeline without forking core.

---

## Problem

### Conversation context

The unified chat passes the **full message history** from the client to the LLM on every turn:

- `packages/ui/src/ai/useAiChat.ts:217–235` — `outgoingHistory = [...messages, userMessage]` is serialized into the POST body each turn.
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts:31–44, 180–195` — Zod-validated `messages[]` is passed verbatim to `runAiAgentText`.
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts:336–396` — `convertToModelMessages(...)` then `streamText({ messages: modelMessages, ... })`.

So context **IS** preserved end-to-end. But:

1. **No multi-turn integration test exists.** The route-level test (`route.test.ts`) only checks that the payload is delegated; it does not assert "turn 2 sees turn 1." A future regression that drops history (e.g., a misguided "send only latest message for cost" patch) would slip through.
2. **No persistence layer.** History lives only in browser memory. A page refresh, a navigation, or a tab crash erases the conversation. There is no `ai_chat_session` / `ai_chat_message` table.
3. **`MAX_MESSAGES = 100` hard cap** at the API boundary (`route.ts:13`). For long-running CRM-style conversations this will start rejecting requests, with no graceful summarization fallback.

### Attachment processing

Today's flow is opaque, hardcoded, and not reusable across agents:

- **Upload pipeline** (`packages/core/src/modules/attachments/api/route.ts`) extracts text at upload time using `pdfjs-dist` (PDFs), `mammoth` (docx), and direct `fs.readFile` (text/CSV/JSON). Result is stored in `attachments.content`.
- **Resolution at chat time** (`packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts:62–78, 273–342, 318–322`) classifies each attachment as `'image' | 'pdf' | 'file'`, then:
  - inlines bytes as base64 if ≤ 4 MB (hardcoded), OR
  - emits a signed URL (signer DI hook exists but no concrete impl ships), OR
  - falls back to metadata-only.
- **Per-agent control surface today** (`defineAiAgent`): a single `acceptedMediaTypes?: ('image' | 'pdf' | 'file')[]` whitelist. That's it. Parts outside the whitelist are silently `console.warn`-dropped at line 318–322.

What's missing:

- **No PDF → image-pages fallback.** A 30 MB scanned PDF that exceeds the 4 MB inline cap becomes metadata-only — the model sees the filename and nothing else. Yet `packages/core/src/modules/attachments/lib/pdfProcessing.ts` already has page rasterization (with `MIN_RENDER_SCALE` and pixel-budget logic) sitting unused at chat-prep time.
- **No image resizing** before inlining. Provider-side limits (Anthropic, OpenAI, Google) vary; oversized images are rejected by the provider, not pre-shrunk by us.
- **No per-agent conversion strategy.** A "merchandising assistant" that wants PDFs as **page images** (to reason about layout) is indistinguishable in config from a "contract analyzer" that wants the same PDFs as **extracted text** (to reason about clauses). Today both get whatever the global heuristic decides.
- **No per-agent inline byte budget.** The 4 MB threshold in `attachment-parts.ts` is hardcoded; agents that want to push more (or less) into inline parts cannot.
- **Chat route skips attachment-type validation** (`route.ts:169` comment: `"once the attachment-to-model conversion bridge lands"`) — this spec is that bridge.

### Why this blocks framework extensibility

`defineAiAgent` is the public contract third-party module authors use. If a user builds a "loan document reviewer" agent, the only knob today is `acceptedMediaTypes: ['pdf']`. They cannot say "convert PDFs to page images at 200 DPI before sending, fall back to text if rasterization fails, and reject anything > 50 pages." They have to fork the runtime — which defeats the purpose of having a unified framework.

---

## Goals

1. **Lock in conversation context preservation** with a dedicated multi-turn integration test that survives refactors.
2. **Make attachment processing a declarative per-agent contract** — `defineAiAgent` accepts a `attachments` config block describing per-MIME conversion strategy, inline byte budget, page-image rendering options, and OCR policy.
3. **Reuse existing utilities** in `packages/core/src/modules/attachments/lib/` (rasterizer, text extraction, OCR queue) rather than reimplementing.
4. **Add a PDF → image-pages fallback** as a built-in conversion strategy and the *default* for PDFs that exceed the inline byte budget.
5. **Add image resizing** as a built-in conversion strategy and the *default* for images that exceed the inline byte budget.
6. **Stay backward compatible**: agents that do not declare an `attachments` block continue to behave exactly as they do today.
7. **Optional / Phase 2**: persist chat conversations server-side (`ai_chat_session` + `ai_chat_message`) so refreshes don't lose context, and add summarization-on-cap so `MAX_MESSAGES` doesn't reject. This is gated behind a non-default opt-in to avoid scope creep.

---

## Non-goals

- Building a generic "document parsing service" outside the attachments module — we extend, not replace.
- Provider-specific cache-control gymnastics (Anthropic prompt caching is its own spec).
- A new attachment storage driver (S3/R2 etc.) — orthogonal.
- Agent-to-agent file passing (out of scope).
- Real-time streaming attachment uploads (current multipart flow is sufficient).

---

## Current State (Audit Summary)

### Conversation context — ✅ preserved

| Stage | File | Behavior |
|-------|------|----------|
| UI hook | `packages/ui/src/ai/useAiChat.ts:217–235` | Sends full `messages[]` array each turn |
| API route | `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts:31–44, 180–195` | Validates, passes through |
| Agent runtime | `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts:336–396` | Calls `streamText({ messages, system, tools, ... })` |
| Provider | Vercel AI SDK → Anthropic/OpenAI/Google | Receives full array |

Cap: `MAX_MESSAGES = 100`. No multi-turn integration test exists today.

### Attachments — ⚠️ partially configurable, missing key fallbacks

| Capability | Status | Location |
|-----------|--------|----------|
| Upload size limit (25 MB default, env override) | ✅ implemented | `attachments/api/route.ts` + `attachments/lib/upload-limits.ts` |
| Tenant quota (512 MB) | ✅ implemented | `attachments/api/route.ts` |
| Dangerous-extension block | ✅ implemented | `attachments/lib/imageSafety.ts` etc. |
| Text extraction at upload (PDF/Docx/CSV/JSON/MD) | ✅ implemented | `attachments/lib/textExtraction.ts` |
| OCR queue | ✅ implemented (async worker) | `attachments/lib/ocrService.ts` + `ocrQueue.ts` |
| PDF page rasterization | ✅ implemented but **unused at chat-prep time** | `attachments/lib/pdfProcessing.ts` |
| Inline base64 / signed URL / metadata-only triage | ✅ implemented | `ai_assistant/lib/attachment-parts.ts:213–247, 378–396` |
| Image resizing before inline | ❌ not implemented | — |
| PDF → image-pages fallback | ❌ not implemented at chat-prep time | — |
| Per-agent type whitelist (`acceptedMediaTypes`) | ✅ implemented | `defineAiAgent` |
| Per-agent conversion strategy | ❌ not implemented | — |
| Per-agent inline byte budget | ❌ not implemented | — |
| Per-agent OCR policy | ❌ not implemented | — |
| Multi-turn context integration test | ❌ missing | — |

---

## Proposed Design

### Part A — Conversation context lock-in

**A.1.** Add a multi-turn integration test under `packages/ai-assistant/__integration__/TC-AI-CHAT-CONTEXT.spec.ts`:

1. Boot ephemeral app, log in.
2. Send turn 1 `[{ role: 'user', content: 'Remember the codeword: blue-marlin-7' }]`.
3. Capture assistant reply.
4. Send turn 2 with `[turn1-user, turn1-assistant, { role: 'user', content: 'What was the codeword?' }]`.
5. Assert the assistant reply contains `blue-marlin-7`.

This test is the regression fence. It uses a deterministic mock model adapter wired through the existing model factory (`packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts`) so it does not require live provider keys.

**A.2.** Add a unit test asserting that `runAiAgentText` passes `messages` to `streamText` **without filtering or truncation** (other than the documented 100-message API cap). Test file: `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-runtime.context.test.ts`.

**A.3.** Document the contract in `packages/ai-assistant/AGENTS.md` and `apps/docs/docs/framework/ai-assistant/agents.mdx`:

> The chat client owns conversation history. The server is stateless: every turn must include the full prior message array. The 100-message cap is a soft fence; agents that need long-running conversations should opt into Phase 2 persistence (Section A.4 below).

**A.4. (Phase 2 / opt-in, default off)** Add server-side chat persistence so refreshes don't lose context:

- New entities: `ai_chat_sessions(id, tenant_id, organization_id, agent_id, user_id, title, created_at, updated_at, deleted_at)` and `ai_chat_messages(id, session_id, role, content, parts_jsonb, attachments_jsonb, created_at)`. UUID PKs, scoped to tenant + org + user.
- New endpoints: `POST /api/ai/sessions`, `GET /api/ai/sessions/:id`, `POST /api/ai/sessions/:id/messages`. Auth-gated via `requireFeatures(['ai_assistant.chat'])`.
- Chat route accepts an optional `sessionId` and rehydrates history when present, falling back to the existing client-driven flow when absent.
- Summarization fallback when `MAX_MESSAGES` would be hit: oldest N messages get folded into a system-level summary message via the same model. Configurable per-agent via `attachments` config (next section's pattern reused for context).

A.4 is **explicitly opt-in** because most chats are ephemeral and we don't want to default-store every assistant exchange.

### Part B — Pluggable per-agent attachment processing

**B.1. New `defineAiAgent` config field: `attachments`.**

```ts
// packages/ai-assistant/src/lib/define-ai-agent.ts
export type AttachmentConversion =
  | { kind: 'inline-bytes' }                // raw bytes as data URL
  | { kind: 'inline-text' }                 // pre-extracted text from attachments.content
  | { kind: 'page-images'; dpi?: number; maxPages?: number; format?: 'png' | 'webp' }
  | { kind: 'resized-image'; maxWidth?: number; maxHeight?: number; format?: 'png' | 'webp' | 'jpeg' }
  | { kind: 'ocr-text'; language?: string }
  | { kind: 'metadata-only' }               // filename + size only, no bytes/text
  | { kind: 'reject' }                      // 415-style rejection at chat-prep time

export type AttachmentRule = {
  match: { mimeTypes?: string[]; extensions?: string[] } // OR-match
  // Tried in order. First strategy whose preconditions are satisfied wins.
  // Preconditions: byte budget per agent, page count, image dimensions.
  strategies: AttachmentConversion[]
  // Hard limits (per attachment)
  maxBytes?: number       // overrides global 25 MB at chat-prep time (cannot exceed it)
  maxInlineBytes?: number // bytes that may go inline before falling through to next strategy
}

export type AgentAttachmentsConfig = {
  rules: AttachmentRule[]                              // ordered
  default?: AttachmentConversion                       // applied when no rule matches; defaults to { kind: 'metadata-only' }
  totalBytesPerTurn?: number                           // soft cap on aggregate inline payload
}
```

Wired in via:

```ts
defineAiAgent({
  id: 'catalog.merchandising_assistant',
  // ...
  attachments: {
    rules: [
      {
        match: { mimeTypes: ['application/pdf'] },
        strategies: [
          { kind: 'page-images', dpi: 200, maxPages: 20, format: 'webp' },
          { kind: 'inline-text' },         // fallback if rasterizer fails or pages > maxPages
          { kind: 'metadata-only' },       // last resort
        ],
        maxInlineBytes: 8 * 1024 * 1024,
      },
      {
        match: { mimeTypes: ['image/*'] },
        strategies: [
          { kind: 'inline-bytes' },
          { kind: 'resized-image', maxWidth: 2048, maxHeight: 2048, format: 'webp' },
          { kind: 'metadata-only' },
        ],
        maxInlineBytes: 4 * 1024 * 1024,
      },
      {
        match: { mimeTypes: ['text/*', 'application/json'] },
        strategies: [{ kind: 'inline-text' }],
      },
    ],
    default: { kind: 'metadata-only' },
    totalBytesPerTurn: 24 * 1024 * 1024,
  },
})
```

**B.2. Default attachment config when an agent omits `attachments`.**

To keep current agents working unchanged, the runtime applies a built-in default that mirrors today's behavior, **plus** the two missing fallbacks the spec is introducing:

```ts
const BUILTIN_DEFAULT: AgentAttachmentsConfig = {
  rules: [
    {
      match: { mimeTypes: ['application/pdf'] },
      strategies: [
        { kind: 'inline-bytes' },                           // current behavior
        { kind: 'page-images', dpi: 144, maxPages: 30, format: 'webp' }, // NEW fallback
        { kind: 'inline-text' },                            // existing extraction
        { kind: 'metadata-only' },
      ],
      maxInlineBytes: 4 * 1024 * 1024,                      // current threshold
    },
    {
      match: { mimeTypes: ['image/*'] },
      strategies: [
        { kind: 'inline-bytes' },
        { kind: 'resized-image', maxWidth: 2048, maxHeight: 2048, format: 'webp' }, // NEW fallback
        { kind: 'metadata-only' },
      ],
      maxInlineBytes: 4 * 1024 * 1024,
    },
    {
      match: { mimeTypes: ['text/*', 'application/json', 'text/csv', 'text/markdown'] },
      strategies: [{ kind: 'inline-text' }],
    },
  ],
  default: { kind: 'metadata-only' },
  totalBytesPerTurn: 24 * 1024 * 1024,
}
```

The `acceptedMediaTypes` whitelist remains as a coarser pre-filter for backward compatibility: if an agent sets it, only matching attachments reach the rules engine. New code should prefer `attachments.rules` instead.

**B.3. New runtime: `AttachmentProcessor`.**

```ts
// packages/ai-assistant/src/modules/ai_assistant/lib/attachment-processor.ts
export interface AttachmentProcessor {
  process(args: {
    agent: AgentDefinition
    config: AgentAttachmentsConfig
    attachment: ResolvedAttachment   // { id, mimeType, fileName, byteSize, content?, storagePath }
    container: Container             // for DI lookup of pdfProcessing, ocrService, image resizer
  }): Promise<AttachmentPart[]>
}
```

The default implementation:

1. Picks the first matching `AttachmentRule` (or `default`).
2. For each `strategy` in order:
   - Checks preconditions (byte size, page count, dimensions).
   - If satisfied, executes the strategy and emits zero or more `AttachmentPart` objects.
   - If the strategy fails (rasterizer error, OCR queue full), continues to the next.
3. If no strategy succeeds, emits a `metadata-only` part and a structured warning.

**B.4. Strategy implementations — reuse existing utilities.**

| Strategy | Reuses | New code |
|----------|--------|----------|
| `inline-bytes` | existing `attachment-parts.ts` byte-to-data-URL path | none |
| `inline-text` | `attachments/lib/textExtraction.ts` (already populates `attachments.content` at upload) | none |
| `page-images` | `attachments/lib/pdfProcessing.ts` (rasterizer with pixel budget) | thin wrapper that emits one image part per rendered page; honors `dpi`, `maxPages`, `format` |
| `resized-image` | `sharp` (already a transitive dep via attachments module) — verify and explicitly add if absent | image-resizer util in `attachments/lib/imageResize.ts` |
| `ocr-text` | `attachments/lib/ocrService.ts` + `ocrQueue.ts` (async worker) | sync wait-for-result helper for chat-prep with timeout |
| `metadata-only` | existing `attachment-parts.ts` metadata path | none |
| `reject` | new | small util that throws a typed `AttachmentRejectedError(415, reason)` mapped to a 400 by the chat route |

**B.5. Wire into `agent-runtime.ts`.**

Replace the call to `resolveAttachmentPartsForAgent(...)` (currently at `agent-runtime.ts:345`) with a call into the new `AttachmentProcessor`. The processor returns the same `AttachmentPart[]` shape the rest of the runtime already understands (`attachmentPartsToUiFileParts`, `summarizeAttachmentPartsForPrompt`), so downstream code does not change.

**B.6. Chat route validation.**

Remove the `route.ts:169` TODO. The route now:

1. Looks up each `attachmentId` (existing).
2. Resolves the agent's `attachments` config.
3. Applies the rule engine **before** invoking `streamText` so over-budget attachments are rejected with a precise 400 (`AttachmentRejectedError`) instead of a vague provider error.

**B.7. Tenant override surface.**

For parity with existing tenant-scoped prompt overrides (`AiAgentPromptOverride`), add `AiAgentAttachmentsOverride(tenant_id, agent_id, config_jsonb)` so operators can tighten or loosen attachment rules per tenant via the existing settings UI. Schema migration handled via `yarn db:generate` after entity edits.

---

## API / Type Changes

### `defineAiAgent`

Adds optional `attachments?: AgentAttachmentsConfig`. Existing field `acceptedMediaTypes` continues to work as a pre-filter — *not removed*. Mark it `@deprecated` in JSDoc and document the migration path: "Set `attachments.rules` instead of `acceptedMediaTypes`. The rules engine subsumes the whitelist." Per `BACKWARD_COMPATIBILITY.md` category 2 (type definitions), removing the field would be breaking; keeping it as additive deprecated is the contract.

### Runtime

- New module export: `AttachmentProcessor`, `AttachmentRule`, `AttachmentConversion`, `AgentAttachmentsConfig`, `AttachmentRejectedError`.
- New DI registrations in `packages/ai-assistant/src/modules/ai_assistant/di.ts`:
  - `attachmentProcessor` — singleton, configurable via container.
  - `pdfRasterizer`, `imageResizer`, `ocrSyncWaiter` — service interfaces with default impls.

### Database

- New entity `AiAgentAttachmentsOverride` — additive; no rename of existing tables. Migration via `yarn db:generate`.
- Phase 2 only: new entities `AiChatSession`, `AiChatMessage`. Strictly additive.

### Events

Add (additive):

- `ai_assistant.attachment.processed` — payload `{ agentId, attachmentId, strategy, byteSize, pagesRendered? }`. Useful for observability and downstream subscribers (e.g., bill metering).
- `ai_assistant.attachment.rejected` — payload `{ agentId, attachmentId, reason, ruleIndex }`.

---

## Implementation Plan

### Phase 1 — Context lock-in (small, low risk)

1. Add multi-turn integration test (Section A.1). Mock model adapter via `model-factory` so test runs without provider keys.
2. Add unit test asserting `messages` flows verbatim (Section A.2).
3. Update `packages/ai-assistant/AGENTS.md` and the docs page (Section A.3).

### Phase 2 — Attachment processor scaffold

1. Land `AttachmentProcessor` interface, `BUILTIN_DEFAULT` config, and the 7 strategy implementations behind a feature flag (default ON; flag is escape hatch for hotfix rollback only).
2. Reuse `pdfProcessing.ts` rasterizer behind a thin adapter; do not duplicate logic.
3. Add `imageResize.ts` to `packages/core/src/modules/attachments/lib/` using `sharp` (verify dep, add if missing).
4. Wire into `agent-runtime.ts:345`. Keep `acceptedMediaTypes` as a pre-filter for back-compat.
5. Unit tests per strategy: byte-cap fallback, rasterizer failure → text fallback, OCR timeout → metadata-only fallback, reject → 400.

### Phase 3 — Per-agent declarative config

1. Wire `defineAiAgent({ attachments })` through the runtime.
2. Update reference agents (`catalog.merchandising_assistant`, any others touching PDFs) to declare explicit rules.
3. Add tenant override entity `AiAgentAttachmentsOverride` + admin UI hook.
4. Integration tests: PDF over inline cap → page images; image over inline cap → resized; unknown MIME → metadata-only.

### Phase 4 (optional, opt-in) — Server-side conversation persistence

1. `AiChatSession` + `AiChatMessage` entities + migration.
2. New REST endpoints + RBAC features (`ai_assistant.chat.history.view`, `ai_assistant.chat.history.manage`).
3. Chat route accepts optional `sessionId`, rehydrates server-side history when present.
4. Summarization-on-cap when approaching `MAX_MESSAGES`.
5. Documented as opt-in: agents must declare `persistConversation: true` in their definition; default remains stateless client-driven.

---

## Migration & Backward Compatibility

- **`acceptedMediaTypes`**: kept; marked `@deprecated`; remains functional for ≥ 1 minor version. Documented migration: "Replace with `attachments.rules` for per-MIME control."
- **No entity renames**, only additions. All migrations are additive (DB category 8).
- **No event rename / removal** (events category 5 frozen). New events added are additive.
- **No API route URL changes** (category 7). Chat route gains better validation but keeps shape and response.
- **Default behavior with no config**: identical to today *plus* two new fallbacks (PDF page-images, image resizing) that only trigger when current logic would have produced a metadata-only result. Net effect: more attachments reach the model successfully; none reach it less successfully.
- **DI registrations**: new keys added; no existing keys renamed.

---

## Integration Test Coverage

Per AGENTS.md "every new feature MUST list integration coverage":

- `TC-AI-CHAT-CONTEXT-001` — Multi-turn codeword recall (Section A.1).
- `TC-AI-ATTACH-001` — Small PDF → inline bytes (current behavior).
- `TC-AI-ATTACH-002` — Large PDF (over inline cap) → page images at 144 DPI.
- `TC-AI-ATTACH-003` — Large PDF where rasterizer fails → falls through to extracted text.
- `TC-AI-ATTACH-004` — Large image → resized to 2048 max edge.
- `TC-AI-ATTACH-005` — Image-only agent rejects PDF with 400 + structured error.
- `TC-AI-ATTACH-006` — Tenant override tightens default rules; per-tenant rejection lands cleanly.
- `TC-AI-ATTACH-007` — `acceptedMediaTypes` legacy whitelist still works alongside `attachments.rules`.

UI paths covered: chat composer drag-and-drop, attachment chip rendering, error toast for rejected attachments.

API paths covered: `POST /api/ai/chat`, `POST /api/attachments`, `GET /api/attachments/:id`.

Tests are self-contained: each one creates fixtures via API at setup, cleans up in teardown, and does not rely on seeded demo data.

---

## Risks

- **`sharp` native binary**: if not already a transitive dep of attachments, adding it bumps install size and complicates standalone-app installs. Mitigation: load lazily; degrade gracefully to "metadata-only" when `sharp` import fails so the framework still boots without it.
- **OCR sync wait** at chat-prep time can stall a turn if the OCR queue is backed up. Mitigation: hard timeout (default 8 s, configurable per agent); on timeout fall back to next strategy and emit `attachment.rejected` event.
- **Rasterizer pixel budget** in `pdfProcessing.ts` is conservative; some pages will exceed it. Mitigation: rule explicitly states `maxPages` so authors can cap; on per-page failure, skip that page and continue.
- **Phase 4 storage cost**: every chat persisted is rows + bytes. Mitigation: opt-in per agent, retention policy from day one (`deleted_at` + nightly cleanup worker), default 30-day TTL configurable per tenant.
- **Provider drift**: each provider has its own image format / size limits. Mitigation: keep strategy outputs media-type-tagged so `convertToModelMessages` can do any provider-specific massaging downstream — out of scope for this spec but the seam is clean.

---

## Open Questions

1. Should `page-images` emit one `file` part per page or one combined sprite sheet? Default: one per page (aligns with how Anthropic / OpenAI vision tools index pages).
2. Should we expose `attachments.totalBytesPerTurn` as a tenant-level setting too, or only per-agent? Lean: per-agent for now; revisit if ops asks.
3. For Phase 4 persistence, do we re-use the existing `messages` table conventions (jsonb parts) or a normalized one-row-per-part? Lean: jsonb parts to mirror Vercel AI SDK's `UIMessage.parts` shape directly.

---

## Changelog

- **2026-04-27**: Initial draft — context lock-in (Phase 1), pluggable attachment processor (Phases 2–3), optional persistence (Phase 4).
