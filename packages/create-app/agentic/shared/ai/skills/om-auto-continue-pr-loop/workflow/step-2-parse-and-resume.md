# Step 2 — Orient via HANDOFF.md, parse the Tasks table, pick the resume point

> Spec-implementation runs only. Simple runs have no run folder — go straight to
> `step-4-final-gate.md`. See `../references/run-folder-contract.md` for the file formats.

## 2a. Read HANDOFF.md first

**Read `HANDOFF.md` before anything else.** It is the authoritative short-form snapshot of what the
previous session was doing:

- The current phase/step.
- The last commit SHA and what it delivered.
- The next concrete action.
- Open blockers, environment caveats, and worktree details.

## 2b. Parse PLAN.md's `## Tasks` table

Open `PLAN.md` and find the `## Tasks` table at the top of the file. Columns: `Phase`, `Step`,
`Title`, `Status`, `Commit`.

```markdown
## Tasks

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | {step title} | done | abc1234 |
| 1 | 1.2 | {step title} | done | def5678 |
| 2 | 2.1 | {step title} | todo | — |
| 2 | 2.2 | {step title} | todo | — |
```

Parse rules:

- The **first row whose `Status` column is not `done`** is the resume point. `Status` values are `todo` or `done` only.
- The Step id comes from the `Step` column (`X.Y` or `X.Y-review-fix`). That id drives the Step commit and the `Commit` column SHA.
- `Title` is informational; if it drifts from the Implementation Plan title, trust the Implementation Plan and fix the table.
- If `HANDOFF.md` names a different resume point than the table implies, trust `HANDOFF.md` and reconcile the table (a previous session may have crashed mid-Step). Log the reconciliation in `NOTIFY.md`.
- If the `## Tasks` table is missing, fall back to a legacy `## Progress` checkbox section (first `- [ ]` is the resume point) and migrate it to a Tasks table as part of this resume's first commit.
- If neither can be parsed, stop and ask the user — unless `--from <phase.step>` was passed, in which case use that as the resume point and log a note in `NOTIFY.md`.
- Cross-check the most recent `done` row's `Commit` SHA against `git log` on the PR head. If the recorded SHA is not reachable, warn the user and ask whether to continue (or accept `--force`).
- Skim the tail of `NOTIFY.md` (e.g. last 30 entries) for recent blockers or decisions so you do not repeat or contradict prior work.

## 2c. Announce the resume

Append a NOTIFY entry announcing the resume:

```
## <UTC ISO-8601 timestamp> — auto-continue-pr-loop resume
- Resumed by: @<current-user>
- Resume point: <phase.step> (source: HANDOFF.md / Tasks table / legacy Progress / --from)
- PR head SHA: <sha>
```

Then proceed to `step-3-resume-loop-and-checkpoint.md`.
