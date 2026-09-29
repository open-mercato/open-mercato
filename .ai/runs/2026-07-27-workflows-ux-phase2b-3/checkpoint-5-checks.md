# Checkpoint 5 — after steps 3.1–3.5 (Phase 3b foundations)

- Date: 2026-07-28 (UTC)
- Window: commits `edb3517e3`..`1f125e8a0` (5 steps)
- Runner: local

## Steps covered

| Step | Commit | Summary |
|------|--------|---------|
| 3.1 | edb3517e3 | Durable opaque transition ids (`t_<base36>_<base36>`), legacy `e_from_to` ids keep working |
| 3.2 | 974a7d1e7 | Edit-safety rule: structural edit + active instances → structured 409 + "Create version" banner |
| 3.3 | fe32c9d1a | Edge reattachment via `onReconnect`, route data preserved, delta-based validation with inline refusal reasons |
| 3.4 | e20ca3adb | Arrangement persisted on drag end; byte-equal autosave skipped; cursor-based node placement |
| 3.5 | 1f125e8a0 | Step-type conversion with quarantined config (`metadata.unmappedConfig`), 110 table-driven pairs |

## Checks

- Module-scoped suite (`modules/workflows`): **136 suites / 1768 tests passed**.
- `yarn typecheck`: 22/22 workspaces clean. `yarn i18n:check-sync`: in sync.
- `yarn generate` after each step; tracked enterprise manifest never pruned.
- xyflow import boundary test still green — `WorkflowGraphImpl` remains the only runtime `@xyflow/react` importer.

## Verified facts (re-confirmed in current code, not inherited from the briefing)

- **Instances pin a row that PUT mutates.** `WorkflowInstance.definitionId` + `version`; `findDefinitionForInstance` resolves by row id; the PUT handler assigns `definition.definition = input.definition` on that row and bumps `version` only when explicitly supplied. This is what makes the edit-safety guard necessary.
- **Version-minting machinery already existed** in `api/definitions/[id]/publish/route.ts` (`nextVersion = max+1`, new uuid row, lifecycle + snapshot + breaking-change detection) and is reused unchanged.
- xyflow is **12.11.2**; `onReconnect(oldEdge, newConnection)` + explicit `edgesReconnectable` gate (v12 defaults it true, so the gate is what keeps read-only graphs inert).

## Decisions locked this window

- **Active-instance status set: RUNNING, PAUSED, WAITING_FOR_ACTIVITIES, FORKED, COMPENSATING.** `COMPENSATING` added beyond the plan's proposed four — the saga walks the same definition's activities in reverse, so a topology rewrite corrupts a compensating instance exactly as badly as a running one. Terminal statuses never re-read the definition.
- **The drag-autosave PUT hits the edit-safety guard too** (it is a definition PUT, not a draft write). Left alone it would fail silently mid-drag, so it raises the same banner. Draft writes remain entirely outside the guard — proven by a test with 7 active instances.
- **"Create version" re-applies the rejected payload** to the newly minted row, so the author's in-progress edit survives the version bump rather than being discarded.
- **Reattachment keeps `transitionId`** — the whole point of 3.1. `branchKey === transitionId` in the parallel handler, so preserving the id is what keeps fork branches coherent; the 3.2 guard blocks the *save* under active instances, so mid-flight runs never see rewired topology.
- **Reattachment validation is delta-based** (before-vs-after `validateWorkflowGraph` + `validateParallelForkJoin`), so a pre-existing graph problem never blocks an unrelated edit. Refusals carry a named reason, never a silent revert.
- **Scoped re-tidy deferred, deliberately** (3.4): dagre re-ranks the whole component it is handed, so a "neighbourhood only" run cannot be bounded; with insert-on-edge not yet shipped it would also be dead code. Full Tidy stays the single explicit override. Reasoning recorded in the module AGENTS.md.
- **Conversion operates on the editor node model**, not the definition `step` shape — that is the granularity the inspector mutates, and it lets `invokeAgent` participate (the `stepType` enum alone cannot express `automated ↔ invokeAgent`). Quarantined config accumulates in `metadata.unmappedConfig`, so converting back recovers it; the new optional `metadata` on `workflowStepSchema` is additive and the engine never reads it.

## Notes

- WAIT_FOR_TIMER's `duration` is deliberately excluded from conversion mapping — waiting on purpose is not the same as a deadline, so mapping it would silently change intent.
- The conversion picker surfaced a missing `workflows.nodeTypes.waitForCondition` label; added in all 4 locales.
- One jest run hit a worker `SIGSEGV` with zero failed assertions (infra flake); a clean re-run was green.
