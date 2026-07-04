---
name: om-implement-spec
description: Implement a specification (or specific phases of a spec) using coordinated subagents. Handles multi-phase spec implementation with unit tests, integration tests, documentation, and code-review compliance. Use when the user says "implement spec", "implement the spec", "implement phases", "build from spec", or "code the spec". Tracks progress by updating the spec with implementation status.
---

# Implement Spec

Implements a specification (or selected phases) end-to-end using a team of coordinated subagents. Every code change MUST pass the code-review checklist before the phase is considered done.

## When to use

- The user says "implement spec", "implement phases", "build from spec", or "code the spec" and points at a spec under `.ai/specs/`.
- Not for authoring or reviewing a spec — that is `om-spec-writing`; not for a pre-implementation BC audit — that is `om-pre-implement-spec`.

## What it contains

A per-phase loop: pre-flight + plan → implement + test + document → self-review gate + progress update, repeated for each phase, then a final verification pass. Subagents parallelize independent work; the spec's `## Implementation Status` table is the progress ledger.

## Reference map — load the step in play

| When | Load |
|------|------|
| Starting — locate spec, load context/checklist/lessons, scope phases, plan the current phase | [`workflow/step-1-preflight-and-plan.md`](workflow/step-1-preflight-and-plan.md) |
| Writing code — inline code-review rules, unit tests, integration tests, docs/i18n | [`workflow/step-2-implement-and-test.md`](workflow/step-2-implement-and-test.md) |
| Closing a phase — self-review gate + updating the spec's Implementation Status | [`workflow/step-3-review-and-progress.md`](workflow/step-3-review-and-progress.md) |
| After all phases — final verification gate, subagent strategy, MUST/MUST-NOT rules | [`workflow/step-4-verify-and-finish.md`](workflow/step-4-verify-and-finish.md) |
| Module conventions, Mandatory Module Mechanisms, Design System, Encryption maps | [`AGENTS.md`](../../../AGENTS.md) |

## Non-negotiables

- Read the full spec and every guide/skill in the Task → Context Map before coding.
- Each phase passes the code-review checklist self-review before it is marked done, and updates the spec's Implementation Status.
- Every new behavioral change ships unit tests; API/UI phases ship (or propose) integration tests. Run the full verification gate (`yarn generate`/`typecheck`/`build`/`test`) after the final phase.
- No `any`, hardcoded strings, raw `fetch`, or hand-rolled substitutes for canonical framework primitives.
