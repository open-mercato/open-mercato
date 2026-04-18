# Step 4.1 — Verification Checks

**Step:** 4.1 — Spec Phase 2 WS-A — `packages/ui/src/ai/AiChat.tsx` (embeddable
chat component).
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-18 (UTC)

## Summary

Delivered the canonical `<AiChat>` embeddable chat component plus a
client-side UI-part registry under `packages/ui/src/ai/`. Component binds to
the Step 3.3 dispatcher (`POST /api/ai_assistant/ai/chat?agent=<module>.<agent>`)
through the same URL convention as `createAiAgentTransport` (Step 3.4) and
consumes the dispatcher's plain-text streaming response (`toTextStreamResponse`
— see `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts:251`).

### Files created

- `packages/ui/src/ai/AiChat.tsx` — main component.
- `packages/ui/src/ai/useAiChat.ts` — thin hook that wraps the transport
  factory and consumes the streaming response through `apiFetch` so the hook
  honors the ui package's scoped-headers + auth-redirect contract.
- `packages/ui/src/ai/ui-part-registry.ts` — `registerAiUiPart` /
  `resolveAiUiPart` / `unregisterAiUiPart` + `RESERVED_AI_UI_PART_IDS` for the
  four Phase 3 approval-card slots.
- `packages/ui/src/ai/index.ts` — barrel re-export.
- `packages/ui/src/ai/__tests__/AiChat.test.tsx` — composer, Cmd+Enter
  submission + streaming, error-envelope surfacing + `onError`, Escape abort
  of in-flight stream.
- `packages/ui/src/ai/__tests__/ui-part-registry.test.ts` — register/resolve
  round-trip, unknown-id null return, overwrite semantics, empty-id rejection,
  reserved-ids contract.

### Files touched (additive only)

- `packages/ui/src/index.ts` — one new `export * from './ai'` line.
- `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json` — 14
  new keys under `ai_assistant.chat.*` (all four locales, alphabetically
  sorted, parity maintained; `yarn i18n:check-sync` green).

## Validation gate

| Check | Command | Result |
|---|---|---|
| New ai/ tests | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="ai/"` | 2 suites / 10 tests / 0.46s — all green |
| Full ui regression | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | 53 suites / 279 tests / 2.97s — all green (baseline +2 suites / +10 tests) |
| ai-assistant regression | `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | 28 suites / 338 tests / 1.22s — exact match to baseline |
| core regression | `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | 333 suites / 3033 tests / 5.38s — exact match to baseline |
| Typecheck | `yarn turbo run typecheck --filter=@open-mercato/ui --filter=@open-mercato/core --filter=@open-mercato/app` | 3/3 successful, no new diagnostics (pre-existing `agent-registry.ts(43,7)` carryover remains) |
| `yarn generate` | `yarn generate` | no diff against generated files — only modified files are the new UI sources + i18n JSONs |
| i18n sync | `yarn i18n:check-sync` | green (46 modules, 4 locales, parity OK) |
| Package build | `yarn build:packages` | 18/18 successful; new entry points picked up by ui package (`256 entry points`) |

## Key decisions / blockers

### (a) Which AI SDK hook was wired

The `ai` package pinned in the root `package.json` is `ai@6.0.44` (see
`packages/ai-assistant/package.json` and the root `package.json` resolutions).
The AI SDK v6's React hook lives in `@ai-sdk/react`, which is **not** a
dependency of either `packages/ui` or the root workspace. Therefore the Step
took the explicitly-sanctioned "thin hook" fallback from the brief: a
hand-rolled `useAiChat` that reuses `createAiAgentTransport`'s URL convention
(so the dispatcher path stays single-source) but reads the streaming body
through `apiFetch`. The rationale is that the dispatcher currently returns a
plain-text stream (`toTextStreamResponse`, not `UIMessageChunk`), so plugging
`DefaultChatTransport.sendMessages` directly would misinterpret the body
anyway. When Phase 3 migrates the dispatcher to `toUIMessageStreamResponse`,
this hook can collapse to `useChat({ transport: createAiAgentTransport(...) })`
from `@ai-sdk/react` without changing the `<AiChat>` public contract.

### (b) Transport factory client-only import

`createAiAgentTransport` is imported directly from the top-level
`@open-mercato/ai-assistant` package. That module's `index.ts` re-exports it
alongside server-only helpers (`runAiAgentText`, OpenCode client, etc.), but
tree-shaking in the ui bundle only pulls the transport factory + the
`DefaultChatTransport` class from `ai` — no server-only transitive imports
ship into `packages/ui`. The `useAiChat` hook has `"use client"` at the top
and consumes only `apiFetch` + the transport factory from that side. The
Jest `AiChat.test.tsx` mocks `@open-mercato/ai-assistant` at the module
boundary so the ui package's jest config does not need a new
`moduleNameMapper` entry — BC-preserving for the shared test infra.

### (c) Escape wiring during streaming

The composer's `onKeyDown` checks the `Escape` key:

1. If `chat.status` is `submitting` or `streaming`, it calls `chat.cancel()`
   which aborts the active `AbortController`; the underlying stream reader's
   pending `read()` rejects with `AbortError`, which the hook swallows and
   transitions state to `idle` (keeping whatever assistant text streamed so
   far, mirroring the legacy `useCommandPalette` pattern).
2. Otherwise (idle), `Escape` blurs the textarea — same idiom as the
   `packages/ui/AGENTS.md` "every dialog: `Cmd/Ctrl+Enter` submit, `Escape`
   cancel" convention.

### (d) i18n key namespace

Stayed exactly on the proposed `ai_assistant.chat.*` namespace. 14 new keys
added: `assistantRoleLabel`, `cancel`, `composerLabel`, `composerPlaceholder`,
`debugPanelTitle`, `emptyTranscript`, `errorTitle`, `regionLabel`, `send`,
`shortcutHint`, `thinking`, `transcriptLabel`, `uiPartPending`,
`userRoleLabel`. All four locales (en/pl/es/de) were edited in the same
commit and `yarn i18n:check-sync` confirms parity + sorted-order + flat-shape.
Step 4.6 (i18n finalization) can still refine copy without breaking keys.

### (e) UI-part registry slot behavior

The registry is a global `Map` keyed off a `globalThis`-cached store so it
survives HMR and can be populated at app-boot time from either `packages/ui`
consumers or host apps. Unknown part ids return `null` from `resolveAiUiPart`
and render a neutral dashed-border placeholder chip (`UnknownUiPartPlaceholder`)
with `data-ai-ui-part-placeholder="<id>"` plus a `console.warn`. No Phase 3
server part is emitted yet; the registry is ready for Step 4.3 to add a
prop-bridge + for Step 5.10 to register the four mutation cards.

### (f) Debug panel

`debug?: boolean` prop renders a `<pre>` under the composer showing the last
request payload (url + body) and last response summary (status + streamed
text). No tool execution arguments are shown — that's scoped for Step 4.6.
Defaults to `false`.

## Design-system compliance

- No hardcoded status colors (grep-clean: `text-red-*`, `bg-green-*`,
  `text-emerald-*`, `bg-blue-*`, `text-amber-*` not present in new files).
- Alerts use `destructive` and `warning` variants from the existing
  `packages/ui/src/primitives/alert.tsx` component (which already emits
  `border-status-*` semantic tokens).
- No arbitrary text sizes (`text-[11px]` etc.). Uses `text-xs`, `text-sm`.
- Icons: `Bot`, `User`, `Loader2`, `Send`, `Square` from `lucide-react`.
- Keyboard: `Cmd/Ctrl+Enter` submits, `Escape` aborts/blurs — matches
  `packages/ui/AGENTS.md` UI Interaction section.

## Known limitations / deferred

- **Streaming format**: the hook expects plain-text chunks. When the
  dispatcher migrates to `toUIMessageStreamResponse`, swap the reader for
  `readUIMessageStream` from `ai@6`.
- **UI parts over the wire**: Phase 2 WS-A does not yet stream UI parts; the
  `onMutationRequested` prop + `AiUiPartRenderer` scaffolding is present so
  Phase 3 (Step 5.6 / 5.10) can populate them without shape churn.
- **Upload adapter**: Step 4.2 adds the attachments-upload adapter that feeds
  the `attachmentIds` prop. This Step accepts them as input but does not
  surface an uploader.
- **Portal consumers**: Step 4.10 wires the portal example; the component
  already does no Next.js-only imports so it can be dropped into the portal
  as-is.

## Hard-rule check

- [x] Exactly one code commit + one docs-flip commit planned.
- [x] No history rewrite, no force-push.
- [x] Additive BC only: new files under new `packages/ui/src/ai/` tree, one
      additive `export * from './ai'` line in `packages/ui/src/index.ts`, 14
      additive i18n keys. No existing export renamed/removed.
- [x] No `em.find(` / `em.findOne(` — UI-only change, not applicable (grep
      clean in diff).
- [x] No secrets.
- [x] No `in-progress` lock mutations from this executor.
