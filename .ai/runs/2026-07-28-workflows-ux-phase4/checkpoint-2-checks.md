# Checkpoint 2 — task vocabulary + inspector (steps 0.4–1.5)

- Date: 2026-07-28 (UTC) · Runner: local · **168 suites / 2090 tests passing**, typecheck + i18n sync clean

| Step | Commit | Summary |
|------|--------|---------|
| 0.4 | 74c515f22 | The inbox now sends the `myTasks` filter it always defaulted to |
| 0.5 | 9b39f0a68 | Task rows serialized (proposal links, priority) instead of dumped raw |
| 0.6 | f63c88a01 | `taskHandler` resolved through DI |
| 1.1 | 25ea54521 | §6.1 authoring vocabulary declared on `userTaskConfigSchema` |
| 1.2 | 597bf97ad | `entity_bindings`, `priority`, reassignment audit columns + migration |
| 1.3 | de66c0709 | Task creation resolves copy, dynamic assignment and bindings |
| 1.4 | ce40b55e2 | Five §6.1 inspector sections (What / About what / Who / When / Decisions) |
| 1.5 | 78d8853e6 | Decision buttons bound to durable route ids + approval preset |

## Decisions taken at this checkpoint

**1. New tasks mint `deadline`, not the legacy `slaDuration`.** 1.5 conservatively wrote back whichever key a config already carried, which left the new canonical field dead for newly authored tasks. The spec calls `deadline` a superset that supersedes `slaDuration`, and `resolveTaskDeadlineDuration` already reads both, so new configs write `deadline` while existing configs keep their key untouched (no migration). Residual risk, accepted and recorded: a deploy rolled back to an engine without `deadline` support would not see a due date on tasks authored in the interim — standard additive-evolution exposure, and the value is still visible in the config.

**2. Decisions: re-resolve for rendering, persist only the choice.** The 1.5 executor's analysis was right and worth keeping — these are two different requirements wearing one name:
- *Rendering* the decision buttons is pure derived state. The config is reachable from the task (`workflowInstanceId → definition → step.userTaskConfig`), and the instance pins its definition version, so re-resolving at render time is always correct and needs no column.
- *Recording which button was pressed* is an audit fact about the completion, not about the button list. It is a different field with a different lifetime.

So step 2.4 re-resolves via the exported pure resolver and records the chosen decision id as part of the completion, rather than denormalizing the button list onto the row. No new column for the list.

## Notable behavior change (intended, pinned by a regression test)

A step name or description containing a **resolvable** `{{context.*}}` pill now interpolates at task creation where it previously persisted verbatim — the §6.1 "pill-capable title" requirement. Pill-free configs are byte-identical.

## Every step verified its tests bite

Each executor stashed its change, re-ran, confirmed failures, restored. 1.1: 4 failed on the schema, 2 more on the graph carry. 1.2: 4 on the serializer, 2 on the snapshot. 1.3: 7 of 17. 1.4/1.5 covered by round-trip assertions through the real dialog.
