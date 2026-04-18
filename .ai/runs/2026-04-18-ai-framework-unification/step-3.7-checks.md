# Step 3.7 — Verification Checks

## Scope

Phase 1 WS-C first Step: introduce the attachment-to-model conversion
bridge as a new module
(`packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts`)
and thread it into `runAiAgentText` + `runAiAgentObject` through a
single shared helper so the Step 3.6 parity contract is preserved.

Opens Phase 3 WS-C.

## Files touched

Code commit (`86901a489`):
- `packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts` (new) — resolver, whitelist filter, tenant/org gate, four-source classification, AI SDK v6 `FileUIPart` materializer, system-prompt attachment summarizer.
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` (modified) — imports + module-private `attachAttachmentsToMessages` and `appendAttachmentSummary` helpers, shared by both `runAiAgentText` and `runAiAgentObject`.
- `packages/ai-assistant/src/index.ts` (modified) — additive re-exports: `resolveAttachmentParts`, `resolveAttachmentPartsForAgent`, `attachmentPartsToUiFileParts`, `summarizeAttachmentPartsForPrompt`, `ResolveAttachmentPartsInput`, `AttachmentSigner`.
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/attachment-parts.test.ts` (new) — 20 tests across the four mandated coverage areas.

Docs-flip commit (this turn): PLAN.md row 3.7, HANDOFF.md rewrite, NOTIFY.md append, this file.

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result:

```
Test Suites: 22 passed, 22 total
Tests:       285 passed, 285 total
```

Delta vs Step 3.6 baseline (21/265): **+1 suite, +20 tests**.

### Coverage areas (per Step brief)

1. **All four source kinds** — separate tests for `bytes`, `signed-url`, `text`, `metadata-only`, plus a regression test that images fall back to `metadata-only` when disk-read fails and no signer is available.
2. **`acceptedMediaTypes` filter** — a mixed-media test that drops `file` when the agent whitelist is `['image', 'pdf']`, and a null-filter test that shows all types pass when `acceptedMediaTypes` is undefined.
3. **Cross-tenant drop** — a record scoped to a different tenant is dropped with `console.warn`; a super-admin caller bypasses the scope check even on mismatched tenant/org; unresolved ids (`findOneWithDecryption → null`) are dropped with `console.warn`.
4. **Unavailable-service graceful skip** — no container, container without `em`, and empty `attachmentIds` all short-circuit to `[]` without throwing; `findOneWithDecryption` is not called.

### Additional coverage

- `resolveAttachmentPartsForAgent` (the runtime-facing wrapper) threads the agent's `acceptedMediaTypes` and short-circuits on undefined/empty ids.
- `attachmentPartsToUiFileParts` emits `data:` URLs for `bytes`, raw URLs for `signed-url`, and drops `text` / `metadata-only` (those surface via the system prompt).
- `summarizeAttachmentPartsForPrompt` returns `null` on empty input and includes extracted text verbatim for `text` sources.

### Mocking strategy

The attachments module is mocked at the jest module level:
- `@open-mercato/shared/lib/encryption/find` → `findOneWithDecryption` spy.
- `@open-mercato/core/modules/attachments/data/entities` → stub `Attachment` class.
- `@open-mercato/core/modules/attachments/lib/storage` → stub `resolveAttachmentAbsolutePath`.
- `fs.promises.readFile` → spy with per-test behavior.

This keeps the suite independent of the core package's runtime (no DB, no real FS), matches the pattern already used by the Step 3.4 / 3.5 suites, and makes the unit boundary clear: `attachment-parts.ts` is the single integration point with the attachments module. Integration coverage with the real attachments service is Step 3.13.

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — cache hit, pass.
- `@open-mercato/app:typecheck` — one pre-existing diagnostic only (Step 3.1 carryover: `agent-registry.ts(43,7)` missing `@/.mercato/generated/ai-agents.generated`, guarded by runtime try/catch). No new diagnostics on `attachment-parts.ts`, `agent-runtime.ts`, or `index.ts`.

## OpenAPI / generate

`yarn generate` NOT run — Step 3.7 adds a library-only module, no API route, module-discovery, OpenAPI, or generator surface touched. The `attachmentIds` pass-through to `resolveAiAgentTools` preserves the Phase-1 runtime contract Step 3.6 locked in.

## i18n / Playwright

Not applicable. Library-only change, no user-facing strings, no UI.

## Notable design decisions

- **Single entry point through `resolveAttachmentPartsForAgent`.** Chat and object helpers call the same wrapper so media-type classification, tenant-scope enforcement, `acceptedMediaTypes` filtering, and signer dispatch live in one place. Step 3.6 parity invariant #7 holds: `attachmentIds` still flow into `resolveAiAgentTools` untouched; the resolver is a sibling code path that produces the model-ready parts after the policy gate has run.
- **No new attachments-service surface.** The attachments module already exposes `Attachment` + `resolveAttachmentAbsolutePath` + the `content` column (OCR/text extraction output). The bridge reuses those directly instead of extending the service API, keeping the spec's stability contract (no provider-service change yet). `findOneWithDecryption` is the mandated entry point — no raw `em.findOne` / `em.find` in the new module.
- **Four-kind classification.**
  - `bytes` — images/PDFs under 4 MB, read via `fs.promises.readFile` and surfaced as a base64 data URL in the AI SDK v6 `FileUIPart`.
  - `signed-url` — images/PDFs over 4 MB, minted via an optional `AttachmentSigner` resolved from the DI container. No concrete signer ships in this Step; the hook exists so Phase 3 can add one without another runtime-helper change.
  - `text` — text-like MIME types (`text/*`, `application/json`, `application/xml`, CSV, YAML) with existing extracted content (OCR output stored on the `attachments.content` column). Truncated to 64 KB characters with a `[... truncated]` marker to keep system-prompt budgets sane.
  - `metadata-only` — fallback for binary files without text, oversized images without a signer, and images whose bytes fail to read from disk.
- **Why 4 MB threshold?** Safe cross-provider inline ceiling: Anthropic, OpenAI, and Google accept inline file parts comfortably under this limit. Callers can override via `maxInlineBytes`. Anything larger MUST use a signed URL or fall through to metadata-only — the spec (D13) forbids passing authenticated frontend URLs directly to providers.
- **Message-part shape — AI SDK v6 `FileUIPart`.** Resolved bytes/signed-url parts are appended to the last user `UIMessage.parts` as `{ type: 'file', mediaType, filename, url }` entries (data URL for bytes, raw URL for signed). `convertToModelMessages` is already wired into both helpers and handles the UIMessage→ModelMessage conversion upstream of `streamText` / `generateObject` / `streamObject`. If no user message exists (edge case), a synthetic user message is appended. This matches the SDK v6 contract exactly — no provider-specific branching required in this Step.
- **Text + metadata-only in the system prompt.** These cannot travel as file parts (no provider-safe URL/byte representation for text extracts or unknown binaries), so they're rendered into a structured `[ATTACHMENTS]` block appended to the composed system prompt. Same rendering on both helpers — the prompt composition is the only write path that sees them.
- **Graceful skip when the DI container is missing.** `resolveAttachmentParts` returns `[]` with a single `console.warn` instead of throwing. Preserves the Step 3.6 parity invariant #7 behavior — if the helper runs in a context without a request-scoped container (direct callers, tests, future non-HTTP dispatchers), `attachmentIds` still reach `resolveAiAgentTools` unchanged and the helper silently skips the media conversion.
- **Tenant/org scope enforcement mirrors the attachments `checkAttachmentAccess` rules.** The resolver checks `tenantId`/`organizationId` on the loaded `Attachment` against the caller `AiChatRequestContext`; mismatches drop with `console.warn`. Super-admin callers bypass. The encryption-aware `findOneWithDecryption` call passes both scope fields so encrypted records decrypt correctly.
- **No `console.warn` suppression in the runtime path.** Following the Step 3.4 / 3.5 / 3.6 pattern — warnings stay visible so drift (missing container, mis-scoped records, out-of-whitelist media) shows up in logs during integration rollouts.

## BC impact

Additive only — per `BACKWARD_COMPATIBILITY.md`:
- **Surface 2 (Types)**: new optional `ResolveAttachmentPartsInput`, `AttachmentSigner`. No existing public type modified.
- **Surface 3 (Function signatures)**: four new exported functions (`resolveAttachmentParts`, `resolveAttachmentPartsForAgent`, `attachmentPartsToUiFileParts`, `summarizeAttachmentPartsForPrompt`). `runAiAgentText` / `runAiAgentObject` public input shape unchanged — the bridge runs on already-accepted `attachmentIds` + `container`.
- **Surface 4 (Import paths)**: additive re-exports only in `@open-mercato/ai-assistant`.
- **Surface 7 (API route URLs)**: unchanged — this Step adds no route.
- **Surface 8 (Database schema)**: unchanged.
