# Standalone generator evaluation lifetime

## Goal

Keep application metadata evaluation out of long-lived development watchers without changing generated metadata, plugins, discovery, or public contracts.

## Scope

Both `mercato generate watch` and the embedded `mercato server dev` watcher run the existing one-shot `mercato generate all --quiet` command in a fresh child for each accepted generation cycle. The watcher retains event gating/coalescing; shutdown drains the current cycle. Full metadata evaluation and existing fallback behavior remain unchanged, including mutation, computed/imported values, reexports, ACLs, and worker abandonment callbacks.

Source doc: .ai/specs/implemented/2026-04-02-dev-structural-regeneration-and-cold-start-optimization.md

## Implementation Plan

### Phase 1: Bounded evaluation lifetime

Add a small one-shot child runner using the current Node executable, inherited environment and original working directory. Wire both watcher callbacks without changing explicit full-generation dispatch. Await child closure and propagate failures. Drain in-flight watcher work before shutdown completes.

### Phase 2: Regression coverage and qualification

Add deterministic native-process metadata/edit-cycle tests and watcher drain/recovery coverage. Parent runs focused tests and real standalone navigation/edit-cycle A/B memory and latency measurements after edits settle. Update existing documentation with observed evidence before publication.

## Risks and Non-goals

Fresh processes trade startup and repeated module evaluation latency for releasing the generation graph after every cycle. No RAM saving is asserted before measurement. No static metadata extraction optimization, generated-file contract change, production dependency, or unmerged PR #6406 implementation is included. The future selected-plan runner can cross this same one-shot boundary; do not reintroduce in-process evaluation when integrating #6406.

No remote push or PR until parent authorizes after standalone validation. No merge. Parent owns validation and publication.

## Standalone verification

Two paired packaged standalone comparisons against `c981a94bea74fee63ca75815bf64fcf90738fb76` passed six-page navigation, customer create/read/delete with optimistic locking, composer/AI dock interaction, and ten structural API revisions per run. Post-edit process-tree physical footprint fell by 11.2% and 11.4%; supervisor residency fell by approximately 850 MiB in both pairs. Subsequent regeneration increased from approximately 1.5–2.5 seconds to 4.8–5.7 seconds. Cold-navigation peaks did not consistently improve.

The 111 focused generator/lifecycle tests passed before the standalone runs. The final configured publication gate uses the local runner; no compose app container is running. Full gate completion is tracked separately from the successful smoke. Detailed methodology and measurements are in `.ai/specs/2026-05-27-dev-mode-memory-quick-wins.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bounded evaluation lifetime

- [x] 1.1 Isolate watch generation and drain the active cycle. — 44d748066c

### Phase 2: Regression coverage and qualification

- [x] 2.1 Add metadata and lifecycle regression coverage. — 44d748066c
- [ ] 2.2 Complete coordinated validation, standalone measurement, and existing documentation update.
