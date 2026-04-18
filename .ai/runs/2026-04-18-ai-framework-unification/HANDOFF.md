# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T17:20:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 4 WS-A Step 4.1 **complete**. Next: Phase 4
Step 4.2 — upload adapter that reuses the attachments API and returns
`attachmentIds` (opens the second commit of Phase 2 WS-A).
**Last commit:** `aae5bdac8` —
`feat(ui): add AiChat component + client-side UI-part registry (Phase 2 WS-A)`

## What just happened

- Executor landed **Step 4.1** as one code commit (`aae5bdac8`) plus a
  docs-flip commit. Step 4.1 opens Phase 4 WS-A by delivering the
  canonical embeddable `<AiChat>` React component under
  `packages/ui/src/ai/`. The component is framework-agnostic inside
  `packages/ui` (no Next.js-only imports, no `@open-mercato/core` coupling)
  so both the backend playground (Step 4.4) and the portal example (Step
  4.10) can consume it without reshaping.
- New files under `packages/ui/src/ai/`:
  - `AiChat.tsx` — main component. `"use client"`. Binds to
    `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` via the same
    URL convention as `createAiAgentTransport` (Step 3.4). Renders a
    transcript (`role="log"` + `aria-live="polite"`) and a labelled
    `<Textarea>` composer. `Cmd/Ctrl+Enter` submits, `Escape` aborts an
    in-flight stream or blurs the composer when idle. Error envelopes
    from the dispatcher surface as `<Alert variant="destructive|warning">`
    plus the `onError` callback. Debug panel behind a `debug?: boolean`
    prop.
  - `useAiChat.ts` — thin hook: manages `messages`, `status`, `error`,
    and last-request/response debug state. Consumes the dispatcher's
    plain-text streaming body via `apiFetch` from
    `packages/ui/src/backend/utils/api.ts` so scoped headers + 401/403
    redirects are honored. Reuses `createAiAgentTransport` for the
    endpoint URL shape so the dispatcher path stays single-source.
  - `ui-part-registry.ts` — client-side registry with
    `registerAiUiPart` / `resolveAiUiPart` / `unregisterAiUiPart` +
    `RESERVED_AI_UI_PART_IDS` for the four Phase 3 approval-card slots
    (`mutation-preview-card`, `field-diff-card`, `confirmation-card`,
    `mutation-result-card`). Global-scoped Map survives HMR; unknown ids
    return `null` and the component renders a neutral placeholder chip
    with a `console.warn` instead of throwing.
  - `index.ts` — barrel re-export.
  - `__tests__/AiChat.test.tsx` — renders composer with i18n placeholder,
    `Cmd+Enter` submit streams assistant text into transcript, dispatcher
    error envelope surfaces as Alert + `onError`, `Escape` aborts stream
    cleanly.
  - `__tests__/ui-part-registry.test.ts` — register/resolve round-trip,
    unknown id null, unregister, overwrite semantics, reserved-ids
    contract.
- Touched files (additive-only):
  - `packages/ui/src/index.ts` — one new `export * from './ai'` line.
  - `packages/ai-assistant/src/modules/ai_assistant/i18n/{en,pl,es,de}.json`
    — 14 new keys under `ai_assistant.chat.*` (`assistantRoleLabel`,
    `cancel`, `composerLabel`, `composerPlaceholder`, `debugPanelTitle`,
    `emptyTranscript`, `errorTitle`, `regionLabel`, `send`,
    `shortcutHint`, `thinking`, `transcriptLabel`, `uiPartPending`,
    `userRoleLabel`). Alphabetically sorted + parity across locales.
- Validation gate (all green):
  - New ai/ tests:
    `cd packages/ui && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="ai/"`
    → 2 suites / **10 tests** / 0.46s.
  - `packages/ui` full regression: 53 suites / **279 tests** (was 51 /
    269; delta +2 suites / +10 tests matches exactly). No pre-existing
    failures introduced.
  - `packages/ai-assistant` regression: 28 / **338** preserved exactly.
  - `packages/core` regression: 333 / **3033** preserved exactly.
  - Typecheck (`yarn turbo run typecheck --filter=@open-mercato/ui
    --filter=@open-mercato/core --filter=@open-mercato/app`): 3/3
    successful. Only the Step 3.1 `agent-registry.ts(43,7)` carryover
    remains (unchanged).
  - `yarn generate`: ran clean — no generator drift against the new
    files (only in-scope edits are the new UI sources + i18n JSONs).
  - `yarn i18n:check-sync`: green (46 modules, 4 locales).
  - `yarn build:packages`: 18/18 successful; ui picked up 256 entry
    points.
- **Playwright**: skipped for Step 4.1. The component is covered by
  Jest + React Testing Library under jsdom; an end-to-end Playwright
  round-trip requires (a) a reachable dev server, (b) a real agent wired
  into `ai-agents.generated.ts` with a live LLM provider, and (c) the
  pre-existing `.ai/tmp/review-pr/pr-1372/` stale-worktree conflict
  resolved. Steps 4.4 + 4.11 are the natural Playwright integration
  points: 4.4 embeds `<AiChat>` in the playground page against a test
  agent, and 4.11 adds the full playground/settings integration-test
  sweep. Recording here so Step 4.4 remembers to re-enable browser
  proof.

## Next concrete action

- **Phase 4 Step 4.2** — Upload adapter that reuses the existing
  attachments API and returns `attachmentIds`. Expected shape:
  - Thin wrapper around the existing `/api/attachments/upload` (or
    equivalent) endpoint, exposed from `packages/ui/src/ai/` as a helper
    the `<AiChat>` host page can call before attaching files to a turn.
  - Returns a typed `{ attachmentIds: string[] }` payload the host page
    can thread into `<AiChat attachmentIds={...}>`.
  - Unit tests mocking `apiFetch`; follow the same polyfill + mocking
    pattern used by `AiChat.test.tsx` (TextEncoder/TextDecoder +
    ReadableStream polyfills from `node:util` + `node:stream/web`, and
    a `ResponseLike` helper type for jsdom).
  - No changes to the attachments API itself — reuse only.
- After Step 4.2 lands, Step 4.3 formalizes the UI-part registry props
  bridge so host pages can pass a scoped registry into `<AiChat>`. The
  default global-scoped registry from Step 4.1 will stay as the fallback.

## Blockers / open questions

- **`@ai-sdk/react` not in the workspace** — `useChat` lives there. Step
  4.1 took the brief's sanctioned fallback: a hand-rolled `useAiChat`
  that reuses `createAiAgentTransport`'s URL convention but reads the
  stream through `apiFetch`. This is a non-blocker — the dispatcher
  currently returns plain text (`toTextStreamResponse`), so
  `DefaultChatTransport.sendMessages` wouldn't parse the body correctly
  anyway. When the dispatcher migrates to `toUIMessageStreamResponse` in
  a future Step (likely Phase 5), `useAiChat` collapses to
  `useChat({ transport: createAiAgentTransport(...) })` from
  `@ai-sdk/react` without changing `<AiChat>`'s public contract.
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

- Dev runtime runnable: unknown. Phase 4 Step 4.1 was proven through
  Jest + jsdom; Step 4.4 will exercise the component in a real Next.js
  route and should attempt a Playwright pass.
- Database/migration state: clean, untouched.
- `.ai/tmp/review-pr/pr-1372/` is still a pre-existing stale review
  worktree that breaks local `yarn test:integration --list`. Cleanup is
  an operator task.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
