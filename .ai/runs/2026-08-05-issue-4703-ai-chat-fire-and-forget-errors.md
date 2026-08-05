# Execution plan — make the AI-chat models fetch report its outcome as one unambiguous state (adopted from PR #4967)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-05 because PR #4967 carried no execution plan.
**PR:** #4967 · **Branch:** `fix/issue-4703-ai-chat-fire-and-forget-errors` · **Base:** `develop`
**Author:** @adeptofvoltron — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

The already-landed fix must stop encoding "the models fetch finished" and "the models fetch succeeded" as two independent booleans, so no future consumer can read a failed load as a ready one and re-introduce the persisted-model-override data loss that #4703 is about.

## Scope

`packages/ui/src/ai/AiChat.tsx` (the module-private `useAgentModels` hook and its two consumers) and `packages/ui/src/ai/__tests__/AiChat.test.tsx`.

## Non-goals

- **The route's 200-on-partial-degradation signal.** `packages/ai-assistant/src/modules/ai_assistant/api/ai/agents/[agentId]/models/route.ts:161-166` catches its own tenant-allowlist snapshot failure, logs it, and still returns 200 with an env-only provider list, so a real partial degradation reaches every client — ours and any third-party consumer of the documented endpoint — as a success. Signalling it honestly needs an additive payload field (`degraded: true`), which is an API-contract change requiring its own spec and PR. Filed as a follow-up in step 4.1.
- The other 8 `void …then(…)` sites in `packages/ui/src` (markdown lazy-loaders, `confirmUnsavedChanges()`), already declared out of scope by the PR description.
- Any change to `AiChatSessions.tsx` or `useAiPendingActionPolling.ts` — their failure handling has no equivalent two-flag ambiguity.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| `setLoaded(true)` on the failure path is the thing to change | @adeptofvoltron's inline review comment on `packages/ui/src/ai/AiChat.tsx:151` — "schould not be true, if error was rised." | high |
| The fix is the state model, not the single line: `loaded` must stop meaning two things | The `🤖 om-auto-continue-pr` review comment on the PR (2026-08-05), and the PR's own root-cause section describing how the old `setLoaded(true)` + empty-provider combination deleted the user's stored override | high |
| The data loss is third-party-visible, so correctness matters beyond this app | `AiChat` is exported from `packages/ui/src/ai/index.ts:1`; `useAgentModels` is **not**, so `loaded`/`failed` are private and the refactor breaks no contract | high |
| 401/403 are designed responses, not faults, so `logger.error` is the wrong severity | The route's documented error list (`route.ts:64-66`, `code: 'agent_features_denied'`) and `UnauthorizedError`/`ForbiddenError` carrying `readonly status` (`packages/ui/src/backend/utils/api.ts:50,75`) | high |
| Only two consumers read `loaded` today, so the refactor is small | `AiChat.tsx:1247` (the `effectiveModelPickerValue` memo) and `AiChat.tsx:1265` (the stored-override cleanup effect); the picker's own render gate at `AiChat.tsx:1782` reads neither flag | high |
| Goal is #4703's stated intent, not a new feature | Issue #4703 body: failures must not leave the surface silently degraded | high |

## Assumptions

- A tri-state (`'loading' | 'ready' | 'failed'`) is preferred over keeping `loaded` and dropping only its failure-path assignment. Both fix the reported line; the tri-state additionally makes the ambiguity unrepresentable, and it is the more reversible choice because the hook is module-private. Contradict this by asking for the minimal two-line change instead.
- The historical inline comments this PR added (`AiChat.tsx:145-148`, `AiChat.tsx:1267-1269`) narrate previous behavior rather than current code, which `AGENTS.md` → Code Quality disallows; they are removed along with the code they annotate rather than rewritten.
- No new user-facing string is needed, so no locale change: every message here is a logger call, not UI copy.

## Risks

- Low blast radius: one module-private hook, two call sites, no exported signature. The main risk is missing a consumer of `loaded`, mitigated by the fact that a rename makes any missed reference a compile error rather than silent behavior.
- CI on this branch was mid-run (`ephemeral-integration` matrix queued) when the resume started; the full gate is re-run locally at step 6 regardless.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Handle the three AI-chat fire-and-forget failures — log them, keep the chat usable, preserve the stored model override, keep polling alive; 5 regression tests — b0ebdb7

### Phase 2: Model the models-fetch outcome as one tri-state

- [x] 2.1 Replace `loaded`/`failed` with a single `status: 'loading' | 'ready' | 'failed'` in `useAgentModels`, move both consumers onto it, and drop the now-redundant failure guard and the historical inline comments — b44e35c
- [x] 2.2 Update the models-failure tests to the tri-state and assert that a failed load keeps the persisted override while a successful load still prunes an unavailable one — b44e35c

### Phase 3: Log a denied models fetch at warning level

- [x] 3.1 Split the severity in both failure paths: `warn` for 401/403, `error` for everything else — b44e35c
- [x] 3.2 Cover the severity split in `AiChat.test.tsx` — b44e35c

### Phase 4: Record the out-of-scope route work

- [ ] 4.1 File the follow-up issue for the models route reporting partial degradation as 200
