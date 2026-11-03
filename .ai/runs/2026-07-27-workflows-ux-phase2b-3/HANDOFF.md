# HANDOFF — workflows-ux-phase2b-3

> Rewritten at every checkpoint and at run end.

## Current state

**Phase 2b is COMPLETE** (steps 1.1–1.13, checkpoints 1 and 2 recorded). Branch `feat/workflows-ux-phase2b-3` off `feat/agent-orchestrator-mvp` @ `e3a2d92de`. No PR opened yet — the plan opens it once Phase 2b + 3a have landed so review starts early while 3b continues on the same branch.

Delivered so far: the `{{ path | transform(args) }}` interpolation grammar with a pure parser and fixed transform table; strict interpolation mode (default-on for newly created definitions only); the endpoint catalog API + EndpointPicker with CALL_API response schemas typing the ledger; additive event `payloadSchema` driving typed trigger filter/mapping editors and typed trigger contributions in the ledger; agent OUTCOME schemas exposed from the enterprise API and flowing into INVOKE_AGENT output contracts through an optional duck-typed bridge method; typed agent I/O pickers with author-time errors on unknown mapping paths; and the draggable Input data panel.

Next resume point: **step 2.1** (IF_ELSE + SWITCH step types).

## How to resume

1. Read `PLAN.md` — the first `todo` row in the Tasks table is the resume point.
2. Read the latest `checkpoint-*-checks.md` for verification state and flagged decisions.
3. Briefings: `BRIEFING-phase2b.md`, `BRIEFING-phase3.md` (code anchors verified 2026-07-27; line numbers drift — re-verify before relying).
4. Sequencing rule from the plan: steps 2.1 and 3.1/3.2 are prerequisites for chips, reattachment, conversion, and copy/paste. Step 3.13 (form-editor retirement) must come strictly after 3.12 (Code view stage 1) — that is the spec's retirement precondition.

## Open items for the reviewer / maintainer

- **New shared export:** `zodToJsonSchema` + `JsonSchema` from `@open-mercato/shared/lib/openapi` (additive; needed for in-process agent result schemas).
- **Step 2.7 needs a design note before code:** the workflow-level error handler is a new engine construct — handler-vs-compensation ordering, durability outside the failing transaction, recursion guard, and branch semantics are all unspecified in the spec.
- The `|` grammar takeover inside `{{ }}` is a technically-visible behavior change for any definition that used a literal pipe in a path (previously a silent lookup miss). Called out for the PR body per BACKWARD_COMPATIBILITY.

## Environment notes

- `yarn typecheck` requires `yarn generate` first (`#generated/*` imports).
- The tracked generated manifest is `packages/enterprise/src/modules/agent_orchestrator/generated/file-agents.generated.ts` — never commit a pruned version. (An earlier note in this file named the wrong path.)
- 7 enterprise tests (`agent-token-usage`, `agent-source-files`, `webSearchEgress`) fail on ANY checkout lacking the local opencode mirrors — `docker/opencode/opencode.jsonc` is untracked and absent from the main worktree too. Pre-existing, not this run's doing.
- Jest on this version takes `--testPathPatterns` (plural), not `--testPathPattern`.
- Never run heavy builds in parallel with the ephemeral integration suite.
- Bare `.sort()` is forbidden (`explicit-sort-comparators.test.ts`, #3620) — always pass a comparator.
