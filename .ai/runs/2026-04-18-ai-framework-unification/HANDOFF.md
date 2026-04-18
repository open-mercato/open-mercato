# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T17:20:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-C **opened** (Step 3.7 landed). Next
up is Step 3.8 (general-purpose tool packs — `search.*`, `attachments.*`,
`meta.*`).
**Last commit:** `86901a489` —
`feat(ai-assistant): add attachment-to-model conversion bridge`

## What just happened

- Executor landed **Step 3.7** as one code commit (`86901a489`) plus
  this docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append +
  step-3.7-checks.md).
- New module file:
  `packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts`
  (spec line 77). Resolves `attachmentIds` into contract-typed
  `AiResolvedAttachmentPart[]` and wires into both runtime helpers
  through a single shared code path.
- Wiring: `runAiAgentText` + `runAiAgentObject` now call
  `resolveAttachmentPartsForAgent` once each, then append the result
  as AI SDK v6 `FileUIPart` entries on the last user `UIMessage.parts`
  (bytes / signed-url) and a structured `[ATTACHMENTS]` block on the
  system prompt (text extracts + metadata-only). Behavior is identical
  on both helpers — the Step 3.6 parity contract holds.
- Four source kinds covered:
  - `bytes` — images/PDFs under 4 MB read via
    `fs.promises.readFile` through
    `resolveAttachmentAbsolutePath` (attachments module).
  - `signed-url` — images/PDFs over threshold, minted via an optional
    `AttachmentSigner` resolved from the DI container. No concrete
    signer ships in this Step; the hook is plumbed for future use.
  - `text` — text-like MIME types (`text/*`, JSON, XML, CSV, YAML)
    with extracted content from the `attachments.content` column
    (OCR/text extraction output); truncated at 64 KB chars with a
    `[... truncated]` marker.
  - `metadata-only` — fallback for binary files without text,
    oversized images without a signer, and failed disk reads.
- Tenant/org scope: enforced via `findOneWithDecryption` +
  `authContext` matching; cross-tenant records drop with
  `console.warn`; super-admin bypass. No raw `em.find`/`em.findOne`.
- `acceptedMediaTypes` whitelist: respected on every part;
  `undefined` means "no filter". Out-of-whitelist parts drop with
  `console.warn`.
- Graceful skip: no container, container without `em`, or empty
  `attachmentIds` all return `[]` with (at most) one `console.warn`.
  Preserves Step 3.6 parity invariant #7 — `attachmentIds` still flow
  into `resolveAiAgentTools` unchanged.
- New unit-test suite
  (`packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/attachment-parts.test.ts`):
  20 tests covering the four source kinds, the whitelist filter, the
  cross-tenant drop, and the unavailable-service graceful skip. Mocks
  the attachments module at the jest module level (no DB, no real
  filesystem).
- Additive public re-exports in `@open-mercato/ai-assistant`:
  `resolveAttachmentParts`, `resolveAttachmentPartsForAgent`,
  `attachmentPartsToUiFileParts`, `summarizeAttachmentPartsForPrompt`,
  `ResolveAttachmentPartsInput`, `AttachmentSigner`.
- Unit tests: 22 suites / 285 tests in `packages/ai-assistant`
  (baseline 21/265 after Step 3.6; delta **+1 suite, +20 tests**).
- Typecheck:
  `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`
  — same pre-existing `app:typecheck` error on
  `agent-registry.ts(43,7)` (Step 3.1 carryover). No new diagnostics
  on `attachment-parts.ts`, `agent-runtime.ts`, or `index.ts`.
- `yarn generate` NOT run — Step 3.7 is a library-only change; no
  route / OpenAPI / module-discovery surface touched.

## Next concrete action

- **Step 3.8** — Spec Phase 1 WS-C — General-purpose tool packs:
  `search.*`, `attachments.*`, `meta.*`.
  - Spec reference §484–§486 for the `attachments.*` tools:
    - `attachments.list_record_attachments` — list files bound to a
      record (→ `/api/attachments`).
    - `attachments.read_attachment` — fetch attachment metadata +
      extracted text when available (→
      `/api/attachments/library/[id]`, OCR/text extraction).
    - `attachments.transfer_record_attachments` — move uploaded
      files from temp or draft records to saved records (→
      `/api/attachments/transfer`).
  - `search.*` and `meta.*` coverage per spec §7 / §10 — review
    before implementing to pin the exact tool names.
  - Expected directory layout follows the existing module tool
    pattern (`packages/core/src/modules/<module>/ai-tools.ts` +
    generator registration). Step 2.3 already restored the generator
    loader for these so no infra change is needed.
  - Scope:
    1. Declare `ai-tools.ts` exports for each target module
       (attachments for the `attachments.*` pack; general-purpose
       utility module or `ai_assistant`-owned for `meta.*`; search
       module for `search.*`).
    2. Wire each tool's `requiredFeatures` to the existing ACL
       features from the target module's `acl.ts`.
    3. Unit tests per pack: tool loads, schema validates, handler
       honors tenant/org scope and `requiredFeatures`.
  - Integration coverage (unknown-agent / forbidden-agent / bad
    attachment / tool-pack reach) is Step 3.13 — not in 3.8.
- After 3.8 comes the customers (3.9) and catalog (3.10–3.12) tool
  packs, then Step 3.13 closes WS-C with integration coverage.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing —
  same caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which
  is not emitted yet (Step 3.1 carryover). Runtime try/catch hides
  it; TS flags it as a compile-time diagnostic. Still a drive-by
  candidate.
- **`AttachmentSigner` concrete implementation**: Step 3.7 wires the
  hook but ships no concrete signer (no existing attachments-service
  surface mints short-lived URLs). Oversized images/PDFs currently
  fall through to `metadata-only`. Whichever future Step adds a
  signer (candidate: Phase 3 WS-C when signed-URL issuance lands on
  the attachments module, or Phase 4 when the playground needs to
  render large media) MUST register `attachmentSigner` in the DI
  container — no runtime-helper change required.
- **Object-mode HTTP dispatcher**: still intentionally deferred to
  Phase 4 (playground). Step 3.7 did not change this.
- **Tools in object mode**: same Step 3.5 gap — AI SDK v6 object
  entries don't accept a `tools` map. The policy gate still runs on
  the resolved tools, but they are not forwarded to
  `generateObject` / `streamObject`. Migration to `generateText` +
  `Output.object` stays a Phase 4 candidate.
- **Attachment byte threshold**: hardcoded at 4 MB via
  `DEFAULT_MAX_INLINE_BYTES`; callers can override per-call via
  `maxInlineBytes`. The agent definition doesn't expose a per-agent
  threshold field today. Flag for Phase 5 / agent-settings UI if a
  production agent needs to diverge from 4 MB.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim on both helpers. Phase 4 may wrap them behind a thinner API
  once a global request-context resolver lands.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests
  only.
- Database/migration state: clean, untouched.
- `yarn generate` NOT re-run this Step (library-only change).
  Regenerating would be a no-op for the API path count.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
