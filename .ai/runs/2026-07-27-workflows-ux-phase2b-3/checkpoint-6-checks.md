# Checkpoint 6 — after steps 3.6–3.11 (editing ergonomics + a11y)

- Date: 2026-07-28 (UTC)
- Window: commits `6db818153`..`d10900b0d` (6 steps)
- Runner: local

## Steps covered

| Step | Commit (pushed) | Summary |
|------|-----------------|---------|
| 3.6 | 6db818153 | Undo/redo snapshot stack over `{nodes, edges, metadata}`, 100 entries, labeled |
| 3.7 | d7aacb0ab | Subgraph clipboard in definition vocabulary; paste re-IDs and rewires |
| 3.8 | 0991da2d9 | Palette drag → canvas / insert-on-edge / append-activity-to-route |
| 3.9 | 8d3a391c8 | Sticky notes + named groups as `metadata.editor.annotations` |
| 3.10 | 617cb4a0b | Searchable icon picker over the existing generated lucide registry |
| 3.11 | d10900b0d | Cmd+K command palette, full keyboard path, ARIA + non-color status |

> **PLAN SHA convention — settled.** The Tasks table records the *pre-amend* SHA (lineage), not the pushed HEAD; the two differ by construction because amending rewrites the hash. This is intentional and consistent across the run: the column documents which commit introduced the step, and `git log` resolves the rest. Executors must never leave `PENDING` placeholders — write the lineage SHA.

## Checks

- Module-scoped suite: **149 suites / 1880 tests passed** (checkpoint 5 was 136/1768).
- `yarn typecheck`: 22/22 clean. `yarn lint`: 0 errors. `yarn i18n:check-sync`: in sync (all locales at 1724 keys).
- `yarn generate`: no churn; enterprise manifest untouched.
- xyflow import boundary test green throughout.

## Verified: annotations never reach execution

`graphToDefinition` filters annotation nodes out of `steps` **and** drops any edge touching one; `validateWorkflowGraph`, `applyAutoLayout`, and `serializeWorkflowSubgraph` all skip them. Asserted directly: `JSON.stringify(graphToDefinition(withAnnotations))` is **byte-identical** to the annotation-free graph, with per-path assertions (no annotation id as a step id, stray edges dropped, no spurious "disconnected" issues, never copied to the clipboard). Round-trips through save/draft/wire covered in `definition-payload.test.ts`.

## Reuse decisions (both avoided building a second implementation)

- **Icon picker:** no picker existed in `dashboards` or `packages/ui`, but a curated **generated lucide registry** does (`packages/ui/src/backend/icons/lucideRegistry.generated.tsx`, ~250 icons, already loaded by `AppShell` on every backend page). Building the grid over it adds **zero** icons to the editor chunk — strictly better than a curated list + dynamic import, and it avoids the `lucide-react`-wholesale bundle regression the plan warned about. No new shared primitive, so no `packages/ui` Ask-First gate.
- **Command palette:** reused `@open-mercato/ui/primitives/command-menu` (cmdk + Radix, the DS-documented Cmd+K primitive). The `ai-assistant` `CommandPalette` is a purpose-built AI chat surface, not a reusable primitive, so it was correctly left alone.

## Decisions locked this window

- **Undo boundary (honest, documented):** definition-panel text fields are not versioned — per-keystroke commits would evict real structural edits from a 100-entry stack, and native input undo already covers typing. Consequence: draft restore / template load / Clear canvas **reset** the stack rather than pushing a half-restorable entry.
- **Groups store a `rect`, not `nodeIds`** (the spec allowed either). A region needs no maintenance when a step it overlaps is deleted, pasted, or converted, and an id list would be a second source of truth the engine must never read.
- **Notes/groups are click-to-add only.** The palette drag payload is typed `step | activity`; widening it for annotations would extend that contract for no keyboard-path gain, and the click path *is* the keyboard path per the module's own palette rule.
- **Cmd+K is deliberately exempt from the `isEditing` guard** — it is the way out of any focus. Every other binding (Cmd+Z/Shift+Z, Cmd+C/V/D, F, Esc) keeps its `isEditing` + dialog guards.
- **`describeNodeChanges` gained a `resizing` field** (additive) so annotation resizes persist once per gesture; without it a fixed-size group cannot frame anything and the feature would be cosmetic.
- **Last color-only state removed:** the `completed` route label gained a check icon. Node cards now carry `role="group"` with a `{type}: {title} — {status}` label, an `sr-only` status name, and a distinct icon shape per status.

## Notes

- One `workflow-templates.test.ts` SIGSEGV mid-run was a jest-worker flake (passes standalone and in the final full run). Combined with the earlier contention timeouts, `--maxWorkers=4` is the recommended local setting; worth watching in CI.
