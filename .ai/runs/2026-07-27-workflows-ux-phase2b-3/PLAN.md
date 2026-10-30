# Run: workflows-ux-phase2b-3

- Date: 2026-07-27
- Branch: `feat/workflows-ux-phase2b-3`
- Base: `feat/agent-orchestrator-mvp` @ `e3a2d92de` (contains merged Phases 0/1/2a — PRs #4532/#4551/#4559)
- Source spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` (Phases 2b, 3a, 3b) + `.ai/specs/2026-07-20-workflows-wait-for-condition.md`
- Mockup references: `.ai/mockups/workflows-ux-redesign/`
- Mode: Spec-implementation run (om-auto-create-pr-loop)
- User directive: Phases 2b and 3 land on ONE branch (no further stacking); PR targets `feat/agent-orchestrator-mvp`.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Pure interpolation-pipeline parser + transform table | done | 1c8cd9a36 |
| 1 | 1.2 | Rewire interpolateVariables + expression-refs for piped tokens | done | 3284a86ea |
| 1 | 1.3 | Strict interpolation mode (schema field, threading, create default, editor toggle) | done | 18a9e4db1 |
| 1 | 1.4 | Workflows endpoint-catalog API (OpenAPI projection) | done | a9de51c55 |
| 1 | 1.5 | EndpointPicker component + CALL_API/CALL_WEBHOOK form wiring | done | f2248fc80 |
| 1 | 1.6 | CALL_API outputContract → response schema into ledger | done | f94a84ec7 |
| 1 | 1.7 | Additive EventDefinition payloadSchema + /api/events exposure | done | c38523c64 |
| 1 | 1.8 | Trigger editor: payload-path filter builder + mapping pickers + safe-default copy | done | 38e3abaa6 |
| 1 | 1.9 | Ledger: typed trigger contextMapping contributions | done | 87924472d |
| 1 | 1.10 | Enterprise: expose agent outcomeSchema on agents API | done | 200628beb |
| 1 | 1.11 | INVOKE_AGENT outputContract seam + typed ledger mapping targets | done | f7c9b6dd0 |
| 1 | 1.12 | AgentInvokeConfigField: schema-key pickers, author-time errors, Insert sample, subject picker | done | 00c16381f |
| 1 | 1.13 | InputDataPanel + drag-from-input-panel | done | e521512be |
| 2 | 2.1 | IF_ELSE + SWITCH step types (enum, pass-through handlers, minEngineVersion guard) | done | 3a427bbfc |
| 2 | 2.2 | If/Else + Switch editor (nodes, inspectors, otherwise warnings) | done | e9686c8b5 |
| 2 | 2.3 | WAIT_FOR_CONDITION engine core (condition-handler, queue backstop, DI) | done | f33055221 |
| 2 | 2.4 | WAIT_FOR_CONDITION wake API (scoped context PATCH + ACL + lock) | done | a602631f8 |
| 2 | 2.5 | WAIT_FOR_CONDITION visual editor (node, config, fail-closed validators) | done | dc1732f2a |
| 2 | 2.6 | Error routes model + engine (kind:'error' transitions, directives, ERROR_ROUTED) | done | 36c0dc12b |
| 2 | 2.7 | Workflow-level error handler (engine construct) + failure-queue park | done | 1fb16413c |
| 2 | 2.8 | Error-route canvas rendering + directive UI | done | 02b836777 |
| 2 | 2.9 | Inline Business Rules editor (business_rules component) + workflows embed + usage panel | done | abf71b7cc |
| 2 | 2.10 | Route condition/activity/otherwise chips + semantic zoom + overflow | done | 7c0197932 |
| 2 | 2.11 | Priority drag-to-reorder + normalization pass | done | 75f75dfe2 |
| 2 | 2.12 | Problems-panel ledger checks extension + 60-node density fixture | done | de5c9d631 |
| 3 | 3.1 | Durable transition ids (opaque, legacy-accepting) | done | ab70ee27f |
| 3 | 3.2 | Edit-safety rule: structural-edit guard + "Create version" flow | done | 4b7baf664 |
| 3 | 3.3 | Edge reattachment (onReconnect, validation snap-back) | done | 68ba2b190 |
| 3 | 3.4 | Persisted-arrangement completion (drag-end autosave, drop placement) | done | ed51e7b98 |
| 3 | 3.5 | Step-type conversion (pure lib + quarantine drawer UI) | done | ba5220883 |
| 3 | 3.6 | Undo/redo command stack + keyboard wiring | done | 6db818153 |
| 3 | 3.7 | Copy/paste/duplicate portable-JSON subgraphs + multi-select | done | d7aacb0ab |
| 3 | 3.8 | Drag-from-palette + insert-on-edge + drag-onto-route append | done | 0991da2d9 |
| 3 | 3.9 | Notes & groups annotations (metadata.editor.annotations) | done | c90e45420 |
| 3 | 3.10 | Icon picker (lazy searchable lucide grid) | done | 15fe62a05 |
| 3 | 3.11 | Keyboard path + command palette + ARIA acceptance | done | 823a9385e |
| 3 | 3.12 | Code view stage 1 (read-only + copy/paste + validation display) | done | 274607ff5 |
| 3 | 3.13 | Form-editor retirement (redirects, @deprecated, UPGRADE_NOTES, test retargeting) | done | 6532f68e4 |
| 3 | 3.14 | Compensation-edge visualization toggle | done | 0e8a55d10 |
| 3 | 3.15 | Integration tests batch (reattach, conversion, chips@60-node, code view, a11y smoke) | done | 4a46f6770 |
| 3 | 3.16 | Docs workstream + spec changelog update | done | 213c7e9e1 |

## Goal

Implement spec Phases 2b (typed-context completion), 3a (flow logic), and 3b (canvas editing depth, ending with form-editor retirement) of the workflows UX redesign, on a single branch, additive-only per BACKWARD_COMPATIBILITY.md.

## Scope

- Phase 2b: pill transform pipeline (`{{ path | fn(args) }}` grammar), strict interpolation mode, endpoint picker (#4235), trigger event/filter/mapping typing, agent typed I/O (§3.4/§7.1), drag-from-input-panel.
- Phase 3a: IF_ELSE/SWITCH as transition sugar, inline Business Rules (#4236), error routes + directives + workflow-level error handler, WAIT_FOR_CONDITION (its own spec), route chips + density (#4244), Problems ledger checks.
- Phase 3b: durable path identity + edit-safety versioning, reattachment (#4233), arrangement (#4248), conversion (#4237), undo/redo, copy/paste, drag-from-palette, notes/groups, icon picker, keyboard+a11y, Code view stage 1, form-editor retirement, compensation ghosts.

## Non-goals

- Loop container (gated on an unapproved engine-semantics mini-spec — explicitly OUT).
- Outcome routes / progressive agent disclosure (Phase 5). Code view two-way sync (Phase 5). Failure-queue triage UI (Phase 5 §8.5 — only park semantics here).
- Real agent input schemas (enterprise follow-up; SAMPLE.json-key warnings only).
- Legacy `NodeEditDialog`/`EdgeEditDialog` extension — CrudForm variants only; legacy files die separately post-soak.

## Risks (condensed; details in BRIEFING-phase2b.md / BRIEFING-phase3.md)

- #4230 still open: endpoint picker may need the OpenAPI response-schema generator fix (shared contract surface) or ships with honest `unknown` degradation.
- Strict mode failures follow the plain activity-failure path until error routes land (2.6) — sequencing documented, no ad-hoc routing.
- `|` inside `{{ }}` was previously a literal path lookup — grammar takeover is a technically-visible change; called out per BACKWARD_COMPATIBILITY.
- Workflow-level error handler is a new engine construct: handler-then-compensation ordering, durability outside the failing transaction, recursion guard, branch semantics — design note required in step 2.7 before code.
- Mid-flight state embeds `e_from_to` transition ids (`pendingTransition`, `branchKey`) — durable ids must coexist with legacy ids; never rewrite stored ids outside Customize.
- Edit-safety guard fires on definition PUT only, never on draft autosave; "active instances" definition decided in 3.2 (RUNNING/PAUSED/FORKED/WAITING_FOR_ACTIVITIES).
- Sequencing: 2.1 and 3.1/3.2 are prerequisites for chips, reattachment, conversion, copy/paste; retirement (3.13) strictly after Code view (3.12).

## External References

- GitHub issues: #4233, #4235, #4236, #4237, #4244, #4248 (+ #4230 dependency, #4251 umbrella).
- Research condensations: `BRIEFING-phase2b.md`, `BRIEFING-phase3.md` (code anchors verified 2026-07-27; line numbers may drift — re-verify before relying).

## Implementation Plan

Step details (approach, anchors, tests) live in the two BRIEFING files, one section per step topic. Binding rules for every step:

1. One Step = one commit; flip the Tasks row in the same commit (short SHA via amend).
2. Unit tests mandatory per step; integration tests batched in 3.15 plus per-step where the spec's Integration Coverage list names the path.
3. Additive-only on all 13 contract surfaces; every new user-facing string i18n'd in all 4 locales; DS tokens only (Boy-Scout `WorkflowTransitionLabel` emerald when touched).
4. Purity boundaries hold: `context-ledger.ts`, `expression-refs.ts`, new `interpolation-pipeline.ts`, `step-type-conversion.ts` stay pure; xyflow imports only where the boundary test allows.
5. Engine changes: DI-resolved services, event-sourced state changes, tenant scoping everywhere, no bare `.sort()` (#3620).
6. `yarn generate` after module-file changes; never commit env-pruned generated files (`file-agents.generated.ts` etc.).
7. Checkpoints every ~5 steps (`checkpoint-N-checks.md`): scoped typecheck + tests + i18n checks; UI checkpoints get browser verification via the integration suite where feasible.
