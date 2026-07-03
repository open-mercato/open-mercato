# Step 2 — Implement phase-by-phase with incremental commits

For each Phase in the Implementation Plan:

1. Implement only the steps in the current Phase. Do not pull work forward from later Phases.
2. Add or update tests for anything that changed behavior:
   - Unit tests are mandatory for any code change.
   - Escalate to integration tests for risky flows, permissions, tenant isolation, workflows, or multi-module behavior.
3. Run the targeted validation loop for the affected packages, probing scripts first
   (see `../references/environment.md` §3):
   - Unit tests + typecheck for changed packages.
   - `yarn i18n:check-sync` / `yarn i18n:check-usage` **if present** and locale files or user-facing strings changed.
   - `yarn generate` (and `yarn db:generate`) when module structure, entities, or generated files changed.
4. Re-read the diff and remove scope creep.
5. Grep changed non-test files for raw `em.findOne(` / `em.find(` and replace with
   `findOneWithDecryption` / `findWithDecryption`.
6. Commit with a clear conventional-commit subject. Prefer one commit per Step when meaningful; otherwise one commit per Phase.
7. Update the plan's **Progress** section: flip `- [ ]` to `- [x]` for completed Steps and append the commit SHA. Commit that update as a dedicated commit:

```bash
git commit -m "docs(runs): mark ${SLUG} Phase N step X complete"
```

8. Push after every Phase so `om-auto-continue-pr` always has the latest state on the remote.

When every Phase is implemented, proceed to `step-3-validate-and-review.md`.
