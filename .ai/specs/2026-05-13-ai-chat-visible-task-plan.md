# AI Chat — Visible Agent Task Plan

**Date:** 2026-05-13
**Status:** Implemented — Phases 1-3 complete as of 2026-05-18
**Primary Scope:** OSS, `@open-mercato/ai-assistant`, `@open-mercato/ui`
**Companion Scope:** `apps/mercato`, `packages/create-app`, shared backend DataTable UX
**Extends:**
- `.ai/specs/2026-04-28-ai-agents-agentic-loop-controls.md`
- `.ai/specs/2026-05-05-ai-chat-server-side-conversation-storage.md`
- `apps/docs/docs/framework/ai-assistant/ui-parts.mdx`

## TLDR

Add an operator-visible, Codex-style task plan to `<AiChat>` without exposing raw model chain-of-thought. The runtime streams structured task-plan events derived from safe agent activity, and the UI renders them separately from text, reasoning, and tool-call rows.

**Scope:**
- Live task plan rendering in `<AiChat>` for in-flight assistant turns.
- Additive SSE/UI message chunk shape for task snapshots and task updates.
- Server-derived default task events from tool-call lifecycle hooks.
- Optional module/agent hook for explicit high-level task labels.

**Non-goals:**
- No persistence of task plans in `ai_chat_messages`.
- No display of hidden reasoning, private chain-of-thought, or provider reasoning payloads as task text.
- No replacement of existing tool-call debug rows or `LoopTrace`.
- No changes to KMS/Vault availability, tenant key reads, or encryption fallback behavior.

## Implementation Update — 2026-05-13

This spec remains the owner for the visible AI task-plan proposal. The current implementation pass did not add the AI chat task-plan stream protocol yet. It did, however, include two small platform fixes discovered while exercising the app in development. They are captured here so the branch has a single record of what changed and what was verified.

### Dev origin allowlist

Files:
- `apps/mercato/src/lib/dev-origins.ts`
- `packages/create-app/template/src/lib/dev-origins.ts`
- `apps/mercato/src/__tests__/dev-origins.test.ts`

Behavior:
- `APP_URL` and `NEXT_PUBLIC_APP_URL` continue to accept URL values only.
- `APP_ALLOWED_ORIGINS` now accepts URL origins, bare hostnames, and Next-supported wildcard host patterns such as `*.local-origin.dev`.
- When any loopback or container-local host is allowlisted, the resolver expands the local dev aliases to `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, and `host.docker.internal`.
- The app copy and create-app template copy remain byte-for-byte synchronized.

This fixes Next.js development warnings where assets such as `/_next/webpack-hmr` or `/__nextjs_font/geist-latin.woff2` were blocked when the browser reached the dev server through `127.0.0.1` while the app was configured with another local hostname. Custom dev origins remain supported through `APP_ALLOWED_ORIGINS`, including Docker and dev-container hostnames.

### DataTable rows-per-page footer

Files:
- `packages/ui/src/backend/DataTable.tsx`
- `packages/ui/src/backend/__tests__/DataTable.render.test.tsx`

Behavior:
- The shared DataTable page-size cluster now uses a non-shrinking inline flex wrapper with `whitespace-nowrap`.
- The translated `per page` label is also non-wrapping.
- Customers pages inherit the fix through the shared backend DataTable rather than a customers-only override.

This keeps controls like `20 per page` on one line while still allowing the broader footer content to wrap at safe group boundaries on narrow layouts.

## Overview

`<AiChat>` already renders streamed text, a collapsible reasoning panel, tool-call rows, UI parts, and debug-only loop traces. Operators still see a gap during multi-step agent work: they can see which tool ran, but not the assistant's high-level checklist or what is likely to happen next. The new task plan fills that gap with safe, concise, user-facing progress statements.

The design mirrors coding-agent UIs at the interaction level, but the data source is intentionally different. We do not ask the model to reveal its thinking. We stream a task list that is either generated from trusted runtime events or explicitly emitted through a constrained agent API.

## Problem Statement

Current behavior:
- `tool-input-*` / `tool-output-*` chunks are rendered as "Tool calls". They can receive friendly captions derived from task-plan labels, while still showing the raw tool id in parentheses for debugging.
- After a tool finishes, the UI may show "Thinking..." while the agent decides whether to call another tool or answer.
- `LoopTrace` has useful step telemetry, but it is debug-only and emitted after the turn completes.

This makes agents feel less predictable for normal operators, especially for catalog cleanup, CRM analysis, and mutation-approval flows.

## Proposed Solution

Introduce a small structured task-plan protocol:

```ts
type AiTaskPlanChunk =
  | {
      type: 'data-agent-task-plan'
      planId: string
      tasks: AiAgentTaskSnapshot[]
    }
  | {
      type: 'data-agent-task-update'
      planId: string
      task: AiAgentTaskSnapshot
    }

type AiAgentTaskSnapshot = {
  id: string
  label: string
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
  source: 'runtime' | 'agent'
  toolCallId?: string
}
```

Default behavior is runtime-derived:
- When `onToolCallStart` fires, create or update a `running` task with a human label derived from the tool display name.
- When `onToolCallFinish` succeeds, mark that task `done`.
- When a tool errors, mark it `failed`.
- Existing tool-call rows remain available for raw arguments/output inspection.

Optional agent behavior is constrained:
- Add a runtime helper such as `ctx.taskPlan?.set([...])` or a reserved non-mutation tool like `meta.update_task_plan`.
- Labels must be plain text, length-bounded, and sanitized.
- The runtime rejects labels that look like hidden reasoning markers (`chain of thought`, `internal reasoning`, XML thinking tags, etc.) and treats the plan as user-visible UI copy.

## Architecture

Flow:

```text
AI SDK streamText / ToolLoopAgent
  -> runtime tool lifecycle hooks
  -> task-plan accumulator
  -> SSE data-agent-task-plan / data-agent-task-update chunks
  -> useAiChat message builder
  -> <AiChatTaskPlan> above tool-call rows
```

Implementation should reuse the existing SSE parsing path in `packages/ui/src/ai/useAiChat.ts` and render in `packages/ui/src/ai/AiChat.tsx`. The runtime source belongs in `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`, next to existing loop trace and tool lifecycle wiring.

`LoopTrace` stays debug-only and post-turn. Task plan is live, compact, and operator-facing.

## Data Models

No database tables or persisted columns.

If `.ai/specs/2026-05-05-ai-chat-server-side-conversation-storage.md` persists assistant messages, task plans should not be stored in the message body by default. If a future audit feature needs persistence, it must be covered by a separate retention and privacy spec.

## API Contracts

### SSE chunks

Additive chunks on the existing chat stream:

```json
{"type":"data-agent-task-plan","planId":"turn_123","tasks":[{"id":"tool_call_1","label":"Search products","state":"running","source":"runtime","toolCallId":"call_1"}]}
{"type":"data-agent-task-update","planId":"turn_123","task":{"id":"tool_call_1","label":"Search products","state":"done","source":"runtime","toolCallId":"call_1"}}
```

Existing clients that ignore unknown chunks continue to work.

### UI types

Extend `AiChatMessage` with:

```ts
taskPlan?: AiAgentTaskSnapshot[]
```

This is optional and client-local.

## UI/UX

Render a compact "Plan" or "Agent plan" block inside assistant messages, above raw tool-call rows:
- Header shows task count and live state.
- Each row uses icon + label + status badge.
- Rows are stable-height to avoid layout jumps during streaming.
- Tool-derived rows can expand/cross-link to the existing tool-call detail row by `toolCallId`.
- Do not render raw tool input/output in the plan.

Design system constraints:
- Use shared status primitives where practical.
- Use lucide icons.
- Avoid hardcoded status colors and arbitrary text sizes in new code.

## Migration & Compatibility

Backward compatible:
- SSE chunks are additive.
- Existing `toolCalls`, `uiParts`, `reasoning`, and `LoopTrace` behavior remains unchanged.
- No DB migration.
- No ACL changes; task plans expose only labels for actions already visible through authorized tools.

## Implementation Plan

### Phase 1 — Runtime-Derived Plan

1. Add task-plan types in `packages/ui/src/ai/useAiChat.ts` or a shared AI UI type file.
2. Extend the stream parser to consume `data-agent-task-plan` and `data-agent-task-update`.
3. Add `<AiChatTaskPlan>` rendering in `AiChat.tsx`.
4. Emit runtime-derived task updates from AI assistant tool lifecycle hooks.
5. Add unit tests for streamed task-plan chunks and rendering.

### Phase 2 — Agent-Authored Safe Labels — Completed 2026-05-18

1. Added the read-only `meta.update_task_plan` helper to the general-purpose meta tool pack.
2. Added shared label sanitization and length bounds in `task-plan-labels.ts`.
3. Documented prompt guidance: task plans are user-visible progress summaries, not internal reasoning.
4. Added unit coverage proving hidden-reasoning-like payloads are rejected or dropped.
5. Added optional agent-level `taskPlan: { enabled: true }` config. The registry exposes `meta.update_task_plan` only for opted-in agents and removes manual allowlist entries otherwise.
6. Enabled task planning by default for CRM/customer agents; catalog agents remain disabled by default and can opt in through an agent definition or `AiAgentExtension`.

### Phase 3 — Docs and Playground — Completed 2026-05-18

1. Updated `apps/docs/docs/framework/ai-assistant/ui-parts.mdx`.
2. Updated playground docs to distinguish live task plans from debug `LoopTrace`.
3. Added a manual QA route covering CRM tool usage and a tool error case.

## Testing Strategy

### Completed companion checks

- `yarn workspace @open-mercato/app test --runTestsByPath src/__tests__/dev-origins.test.ts --runInBand` — PASS.
- `cmp -s apps/mercato/src/lib/dev-origins.ts packages/create-app/template/src/lib/dev-origins.ts` — PASS, template and app helper are in sync.
- `yarn exec tsx -e "..."` runtime check — PASS, resolves `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, `host.docker.internal`, custom bare hosts, and wildcard custom hosts.
- `bash .ai/scripts/ds-health-check.sh` — COMPLETED, report written to `.ai/reports/ds-health-2026-05-13.txt`; existing repository-wide DS findings remain outside this narrow fix.
- `yarn workspace @open-mercato/ui test --runTestsByPath src/backend/__tests__/DataTable.render.test.tsx --runInBand` — PASS.

### Required for AI task-plan implementation

- Unit: `useAiChat` merges plan snapshots and updates into the active assistant message.
- Unit: `AiChat` renders pending/running/done/failed states without hiding text output.
- Unit: unknown task-plan chunks are ignored safely by old parser paths.
- Integration: a mocked agent stream emits task plan + tool call + text in order.
- Manual QA: ask a CRM agent with `taskPlan.enabled` to find assigned deals and verify the live plan updates before final text appears. Confirm catalog agents do not show a plan unless opted in.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual Risk |
|------|----------|------------|---------------|
| Hidden reasoning leaks into visible plan labels | High | Runtime-derived labels by default; sanitize and length-bound agent-authored labels; document that task plans are UI copy | Low |
| Duplicate UI with existing tool-call rows | Medium | `<AiChat>` renders the Plan block only for agent-authored steps; runtime-derived tool lifecycle rows remain technical detail | Low |
| Stream ordering bugs cause stale statuses | Medium | Plan updates keyed by `planId` + task `id`; terminal states win over running | Low |
| Over-promising next actions the agent does not take | Medium | Runtime-derived fallback derives from actual tool lifecycle; agent-authored labels are stateful and mapped to matching tool updates when `toolName` is supplied | Medium |
| Persisted conversation storage accidentally stores task plans | Medium | Keep `taskPlan` client-local and optional; do not include in storage payload without a follow-up spec | Low |

## Final Compliance Report

- **Backward compatibility:** PASS — the new SSE chunks are additive (`data-agent-task-plan`, `data-agent-task-update`) and ignored by older clients. Existing `tool-input-*`, `tool-output-*`, `loop-finish`, `toolCalls`, `uiParts`, and `reasoning` paths are unchanged.
- **Security/privacy:** PASS — agent-authored labels flow only through `meta.update_task_plan`, are length-bounded and sanitized, and hidden-reasoning-like text is rejected or dropped. The helper is exposed only when `taskPlan.enabled === true`; no chain-of-thought, no provider reasoning text, no persistence.
- **Tenant isolation:** PASS — no new data access path; labels derive from already-authorized tool calls.
- **Design system:** PASS — `<AiChatTaskPlan>` and the Tool calls panel use shared semantic status tokens (`text-status-success-icon`, `text-status-success-text`, `text-destructive`, `text-muted-foreground`) and lucide icons; no hardcoded colors or arbitrary text sizes (the `text-[10px]` status-badge size matches the existing tool-call row precedent).
- **Tests:** PASS for Phases 1-3 focused coverage — `packages/ai-assistant/.../__tests__/task-plan-stream.test.ts` covers label derivation, terminal-state ordering, SSE injection, agent-authored plan snapshots, and hidden-reasoning rejection; `packages/ai-assistant/.../ai-tools/__tests__/meta-pack.test.ts` covers `meta.update_task_plan`; `packages/ai-assistant/.../__tests__/agent-registry.test.ts` covers opt-in/opt-out registry normalization; `packages/ui/src/ai/__tests__/AiChat.task-plan.test.tsx` covers UI rendering (pending / running / done / failed), runtime-only plan suppression, internal plan-tool hiding, and unknown-chunk safety; core customers/catalog agent-definition tests cover the shipped prompt/allowlist updates.

## Changelog

- 2026-05-18 — **Task-plan opt-in refinement.** Added `taskPlan.enabled` to agent definitions/extensions, made the registry manage `meta.update_task_plan` exposure, injected prompt guidance only for opted-in agents, enabled CRM/customer agents by default, left catalog agents disabled by default, and changed `<AiChat>` to show the Plan block only for agent-authored steps while keeping runtime tool calls under Tool calls.
- 2026-05-18 — **Tool-call caption refinement.** Renamed the raw execution panel from "Agent tasks" to "Tool calls", matched its bordered layout to the Plan panel, kept runtime-derived tool lifecycle rows out of the Plan block, and reused provided task labels as friendly captions such as `Customers - Get Deal (customers.get_deal)`.
- 2026-05-18 — **Phases 2-3 implemented.** Added the read-only `meta.update_task_plan` tool, shared safe-label sanitization, runtime mapping from agent-authored planned steps to subsequent tool lifecycle updates, client hiding for the internal plan tool, prompt/allowlist updates for shipped customers and catalog agents, docs for UI parts/playground/agent authoring, and focused unit coverage for hidden-reasoning rejection plus plan-before-domain-tool streaming.
- 2026-05-18 — **Phase 1 implemented (#1922).** Runtime-derived task-plan chunks stream through `data-agent-task-plan` / `data-agent-task-update` emitted by `injectTaskPlanIntoStream` in `agent-runtime.ts`, and `useAiChat` merges them into the client-local `taskPlan` array. After the opt-in refinement, `<AiChatTaskPlan>` renders only agent-authored steps; runtime-derived lifecycle updates remain available through the existing tool-call detail rows. Unit tests cover label derivation, ordering safeguards, and renderer states; tool-call detail rows, `LoopTrace`, `reasoning`, and `uiParts` behavior are unchanged.
- 2026-05-13 — Added implementation notes for dev-origin allowlist support, Docker/dev-container aliases, and the shared DataTable rows-per-page no-wrap fix.
- 2026-05-13 — Added verification log for focused app/UI tests, template sync check, and DS health check output.
- 2026-05-13 — Initial short spec for visible live task plans in AI chat.
