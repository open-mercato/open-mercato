# Execution plan — workflows code-definition types: engine parity (#7183)

Source doc: issue #7183 (spec: `.ai/specs/implemented/2026-04-14-code-based-workflow-definitions.md`)

## Goal

`defineWorkflow` (`@open-mercato/shared/modules/workflows`) accepts every step type and every
`userTaskConfig` key the workflows engine validates, without casts, and a test fails when the two drift.

## Scope

- `packages/shared/src/modules/workflows/types.ts` — widen `WorkflowStepType` with `WAIT_FOR_CONDITION`
  (and the engine's `IF_ELSE` / `SWITCH`); extract the inline `userTaskConfig` shape into an exported
  `CodeUserTaskConfig` interface and add every optional key `userTaskConfigSchema` accepts.
  **Decision during implementation:** the shape stays INLINE on `CodeStepDefinition['userTaskConfig']`
  with no new exported name — `packages/shared/AGENTS.md` asks first before minting a new
  cross-package type, and consumers can already reach it as `NonNullable<CodeStepDefinition['userTaskConfig']>`.
- Type-level test (`*.typecheck.tsx`, gated by `tsc --noEmit`) that each engine key and the new step
  types compile in `defineWorkflow`.
- Drift guards in `packages/core` (core may import shared, never the reverse): a `*.typecheck.tsx`
  asserting the engine's `z.input` is assignable to the code type, plus a Jest test comparing the
  engine schema's runtime key set and step-type enum to an exhaustive list of the code type's keys.
- Spec changelog entry.

## Non-goals

- No runtime change: the builder already passes `userTaskConfig` through untouched, and the engine
  validates it on sync. No integration tests needed (no API path or runtime behaviour changes).
- Step-level keys the engine added later (`errorDirective`, `milestone`) and transition keys
  (`condition`, `kind`) — outside #7183; noted as a follow-up.
- No narrowing: `formSchema` stays `Record<string, unknown>`; no existing key changes type.

## Risks

- Contract surface (BACKWARD_COMPATIBILITY.md, types): change is additive only — new union members,
  new optional keys, one new exported interface whose shape equals the old inline type plus optional keys.
- Open sibling PR #7189 extends `userTaskConfig.deadline` with `at`; whichever lands second must add the
  key to `CodeUserTaskConfig` — the drift guard is designed to flag exactly that.

## Implementation Plan

### Phase 1: Types and guards

- 1.1 Widen `WorkflowStepType` and add `CodeUserTaskConfig` with all engine keys; export it.
- 1.2 Type-level `defineWorkflow` test in shared + drift guards (typecheck + Jest) in core.

### Phase 2: Docs

- 2.1 Spec changelog entry.

## Progress

PR: #7244

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Types and guards

- [x] 1.1 Widen `WorkflowStepType` and add `CodeUserTaskConfig` with all engine keys; export it. — 6a7a1bd27
- [x] 1.2 Type-level `defineWorkflow` test in shared + drift guards (typecheck + Jest) in core. — 568235ed7

### Phase 2: Docs

- [x] 2.1 Spec changelog entry. — e1fc5ba4c
