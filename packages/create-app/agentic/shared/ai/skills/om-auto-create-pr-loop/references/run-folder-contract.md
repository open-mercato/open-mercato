# Run-folder contract — layout, Tasks table, checkpoints

Every Spec-implementation run lives in its own folder (never a flat file). Verification is
**checkpoint-based** — one combined `checkpoint-<N>-checks.md` for every ~5 Steps, not per Step.
Per-Step verification logs are NOT produced; the per-Step commit flips its own row in the Tasks
table and nothing else.

## Layout

```
.ai/runs/<YYYY-MM-DD>-<slug>/
├── PLAN.md                       # Tasks table (top), goal, scope, phases/steps (1:1 step↔commit)
├── HANDOFF.md                    # Rewritten at each checkpoint and at run end (not per Step)
├── NOTIFY.md                     # Append-only UTC log — checkpoint events, blockers, decisions only
├── checkpoint-<N>-checks.md      # Required every ~5 Steps — cumulative verification log
├── checkpoint-<N>-artifacts/     # Optional — screenshots + Playwright transcripts from this checkpoint
│   ├── playwright.log
│   ├── screenshot-<desc>.png
│   └── typecheck.log
├── final-gate-checks.md          # Written at spec completion — full gate + integration suites + ds-guardian
├── final-gate-artifacts/         # Optional — retained only when raw output is worth keeping
└── ...
```

Rules:

- `<N>` is a monotonically increasing checkpoint index starting at `1`. A checkpoint fires after
  every 5 consecutive Steps and again at spec completion (as part of the final gate).
- **There is NO `step-<X.Y>-checks.md` and NO `step-<X.Y>-artifacts/`.** Do not create them.
  Per-Step chatter (individual check logs, individual NOTIFY entries, individual HANDOFF rewrites)
  is deliberately dropped to reduce noise.
- `checkpoint-<N>-artifacts/` is optional — create it only when the checkpoint produced real
  artifacts (Playwright transcripts, screenshots, captured command output worth keeping). Never
  create an empty folder.

## `## Tasks` table (top of `PLAN.md`)

A mandatory `## Tasks` table at the very top of `PLAN.md` (right after the header metadata,
before `Goal`). It is the authoritative status source that `om-auto-continue-pr-loop` parses.

```markdown
## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | {step title} | todo | — |
| 1 | 1.2 | {step title} | todo | — |
| 2 | 2.1 | {step title} | todo | — |
```

Rules:

- `Phase` — integer. `Step` — unique id (`X.Y` or `X.Y-review-fix`). `Title` — single line, must
  match the Step title in the Implementation Plan section exactly.
- `Status` — only `todo` or `done`. Never introduce a third value; Steps are atomic.
- `Commit` — short SHA for `done` rows, `—` for `todo` rows.
- Do NOT emit the legacy `## Progress` checkbox section. The Tasks table is the single source of truth.

## `HANDOFF.md` (rewritten at each checkpoint and run end)

```markdown
# Handoff — <date-slug>

**Last updated:** <UTC ISO-8601 timestamp>
**Branch:** <branch>
**PR:** <url or "not yet opened">
**Current phase/step:** <e.g. Phase 1 Step 1.2>
**Last commit:** <sha> — <short subject>

## What just happened
- <one or two bullets>

## Next concrete action
- <one bullet: the exact next Step to start on>

## Blockers / open questions
- <or "none">

## Environment caveats
- Dev runtime runnable: <yes|no|unknown>
- Playwright / browser checks: <enabled|skipped because ...>
- Database/migration state: <clean|dirty — describe>

## Worktree
- Path: <worktree path>
- Created this run: <yes|no>
```

## `NOTIFY.md` (append-only)

```markdown
# Notify — <date-slug>

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## <UTC ISO-8601 timestamp> — run started
- Brief: <one-line task summary>
- External skill URLs: <list or "none">
```

`NOTIFY.md` MUST receive an append-only, UTC-timestamped entry for: run start, run end, every
**checkpoint**, every blocker, every important decision, every subagent delegation, and every
skipped UI integration pass (with reason). Do NOT log routine per-Step progress; the Tasks table
+ git log cover that.
