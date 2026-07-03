# Step 2 — Parse the Progress checklist and resume execution

## 2a. Parse the Progress checklist

Open `$PLAN_PATH` and find the `## Progress` section. The expected format (written by
`om-auto-create-pr`):

```markdown
## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: {name}

- [x] 1.1 {step title} — abc1234
- [x] 1.2 {step title} — def5678

### Phase 2: {name}

- [ ] 2.1 {step title}
- [ ] 2.2 {step title}
```

Rules:

- The first unchecked (`- [ ]`) line is the resume point.
- If the Progress section is missing or cannot be parsed cleanly, stop and ask the user — unless `--from <phase.step>` was passed, in which case use that as the resume point and log a note.
- Cross-check the last `- [x]` line's commit SHA against `git log` on the PR head. If the recorded SHA is not reachable, warn the user and ask whether to continue (or accept `--force`).

## 2b. Resume execution

From the resume point forward, apply the **same phase-by-phase loop** documented in
`.ai/skills/om-auto-create-pr/workflow/step-2-implement.md`:

1. Implement only the steps of the current Phase. Custom modules live at `src/modules/<module>/` (see `../references/environment.md` §4).
2. Add or update tests for anything that changed behavior.
3. Run targeted validation for affected packages, probing scripts first (`../references/environment.md` §3): unit tests, typecheck, `yarn i18n:check-*` **if present**, `yarn generate` / `yarn db:generate` when module structure or entities changed.
4. Re-read the diff to remove scope creep.
5. Grep changed non-test files for raw `em.findOne(` / `em.find(` and replace with `findOneWithDecryption` / `findWithDecryption`.
6. Commit with a conventional-commit message per Step or per Phase.
7. Flip the Progress checkbox to `- [x]` and append the commit SHA. Commit that update as a dedicated `docs(runs): mark {slug} Phase N step X complete` commit.
8. Push after every Phase so the remote always has the latest state.

Do not alter work already completed in earlier commits. Do not reorder or rewrite history on the
PR branch.

When the resume has advanced through the remaining Phases, proceed to
`step-3-validate-and-review.md`.
