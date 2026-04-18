# Execution Runs (`.ai/runs/`)

This folder contains **execution runs** created by `auto-create-pr` and its
sibling skills (`auto-continue-pr`, `auto-sec-report`, `auto-qa-scenarios`,
etc.). Each run is a self-contained tracking folder that lets an agent resume
interrupted work, hand off to a fresh session, and prove that every commit was
verified.

## These are NOT specs

Architectural specifications live in `.ai/specs/` and `.ai/specs/enterprise/`.
Execution runs here are agent-internal tracking artifacts — they record what
to do, in what order, which steps landed, and what verification evidence each
commit produced.

## Folder layout

Each run lives in its own folder, not a flat file:

```
.ai/runs/<YYYY-MM-DD>-<slug>/
├── PLAN.md          # Goal, scope, phases/steps, Progress checklist (1:1 with commits)
├── HANDOFF.md       # Live session-handoff snapshot — kept current so any agent can resume
├── NOTIFY.md        # Append-only, UTC-timestamped log of decisions, blockers, and progress
└── proofs/
    └── <step-id-or-commit-sha>/
        ├── typecheck.log
        ├── unit-tests.log
        ├── playwright.log        # optional — only when UI was exercised
        ├── screenshot-*.png      # optional — only when UI was exercised
        └── notes.md              # optional — human-readable summary of what was verified
```

### PLAN.md

The authoritative plan for the run. Always includes:

- **Goal** and **Scope** (brief summary).
- **Non-goals** (what this run will not touch).
- **Implementation Plan** broken into Phases and Steps. **Every Step MUST
  correspond to exactly one commit** so reviewers can bisect cleanly.
- **Risks** (brief).
- **External References** (URLs passed via `--skill-url`, with adopt/reject
  notes).
- A **Progress** section parseable by `auto-continue-pr` — see the skill files
  for the exact required format.

### HANDOFF.md

A short, always-current snapshot of the run state. Overwritten (not appended)
every time an agent finishes a chunk of work. Its job: let a brand-new agent
pick up in <30 seconds if the current session crashes.

Minimum contents:

- Current phase / step in progress.
- Last commit SHA on the branch, and what it delivered.
- Outstanding TODOs / next concrete action.
- Known blockers, open questions, or environment caveats.
- Pointers to any active branches, worktrees, or external references.

### NOTIFY.md

An **append-only** log of human-relevant events during the run. Every entry is
dated and time-stamped (UTC, ISO-8601). Use it to record:

- Every important decision and its rationale.
- Problems encountered, what was tried, what worked.
- Phase transitions.
- QA/validation anomalies.
- Any user-visible messages the agent wants the operator to see later.

Never rewrite or delete prior entries. Append only.

### proofs/

Per-step (or per-commit) verification artifacts — raw logs, Playwright output,
screenshots. The rule set in `auto-create-pr`:

- **Typecheck** and **unit tests** are mandatory for every code-changing
  commit. Their output MUST be captured here.
- **Playwright browser checks** and **screenshots** are only required when the
  step is UI-facing AND the dev environment is runnable. If the env is not
  runnable, skip these and note the reason in `NOTIFY.md` — this never blocks
  development.
- Docs-only commits can skip proofs but SHOULD still leave a short `notes.md`
  recording what was read.

## Lifecycle

1. `auto-create-pr` drafts `PLAN.md`, initializes `HANDOFF.md` and `NOTIFY.md`,
   and commits the whole run folder as the first commit on a fresh branch.
2. During implementation, each Step produces one commit plus a proofs
   subfolder. After each commit the agent flips the Step's checkbox in
   `PLAN.md`, rewrites `HANDOFF.md`, and appends a `NOTIFY.md` entry.
3. `auto-continue-pr` resumes from the `Tracking plan:` line in the PR body.
   It MUST read `HANDOFF.md` first, then `PLAN.md`, then catch up on
   `NOTIFY.md` tail.
4. Run folders remain in the repo after merge as a permanent audit trail.

## Who else writes here

Specialized driver skills (`auto-sec-report`, `auto-qa-scenarios`,
`auto-update-changelog`, …) also create per-spec folders under `.ai/runs/`
using the same layout. Their deliverables (sec reports, QA reports,
changelog drafts) land under `.ai/analysis/` or `CHANGELOG.md` as before —
only the tracking plan lives here.
