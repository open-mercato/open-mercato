# Resume and Reconcile an Interrupted Spec

Use this contract whenever the resolved spec already has `## Implementation Status`. The ledger is a hypothesis; the working tree and focused validation are evidence.

## Reconciliation order

1. Identify the phase marked `in_progress`, its focused typecheck command, and every ticked, unticked, or `IN FLIGHT` slice.
2. Run the focused typecheck for that phase first, before editing or starting a new slice. Record every broken or partial file it identifies.
3. Compare `git status` and the phase's real files/call sites with the ledger. Verify each ticked slice still exists and compiles. For each unticked slice, inspect whether its artifacts are absent, partial, or already complete.
4. Repair the ledger to match the tree: keep a tick only when its artifacts and focused evidence remain valid; remove a stale tick; add or update an `IN FLIGHT` line naming every partial/broken file and the exact failed or last-run command.
5. Resume at the first unticked slice after reconciliation. Never re-execute a verified ticked slice, and never trust an unticked slice without inspecting its tree state.

## Interrupted paired edits

Treat a missing import with a surviving usage, or a renamed declaration with stale same-file call sites, as one incomplete atomic edit. Repair the pair in one edit operation, rerun the focused typecheck, and update the `IN FLIGHT` line before doing later slice work.

Reconciliation does not make a partial slice complete. Only the normal slice evidence in `planning-and-progress.md` can replace `IN FLIGHT` with a ticked line.
