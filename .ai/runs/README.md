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

Each run lives in its own folder, not a flat file. Verification and artifacts
sit **next to** `PLAN.md` — there is no `proofs/` subfolder and no per-Step
subfolders for checks:

```
.ai/runs/<YYYY-MM-DD>-<slug>/
├── PLAN.md                       # Goal, scope, phases/steps, Progress (1:1 step↔commit)
├── HANDOFF.md                    # Live session-handoff snapshot (rewritten, not appended)
├── NOTIFY.md                     # Append-only UTC-timestamped log of decisions/blockers/progress
├── step-<X.Y>-checks.md          # Required per Step — verification log (typecheck, tests, i18n, diff re-read, UI-check outcome)
├── step-<X.Y>-artifacts/         # Optional per Step — only if the Step produced real artifacts
│   ├── playwright.log            #   (e.g. Playwright transcript)
│   ├── screenshot-<desc>.png     #   (e.g. screenshot)
│   └── typecheck.log             #   (e.g. captured command output worth keeping)
├── step-<X.Y+1>-checks.md
└── ...
```

Conventions:

- `<X.Y>` is the exact Step id from `PLAN.md`'s Progress section (e.g. `1.1`,
  `2.3`, or `2.1-review-fix` for post-review follow-ups).
- `step-<X.Y>-checks.md` is **required for every Step** with a commit.
- `step-<X.Y>-artifacts/` is **created only when the Step actually produced
  artifacts** worth keeping alongside the commit (Playwright runs, captured
  screenshots, saved command output, diff dumps). Pure docs/config Steps skip
  the folder entirely.
- Artifact filenames are descriptive lowercase-kebab-case, not timestamped —
  the commit SHA in `checks.md` already anchors them in time.

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

### step-\<X.Y\>-checks.md

One Markdown file per Step, required whenever a Step lands a commit. Records
what verification was run and what was deliberately skipped. Suggested
sections:

- `Step` id + one-line title (match `PLAN.md` exactly).
- `Scope` — files/packages touched.
- `Commit` — the exact commit SHA the Step produced.
- `Verification` — outcome of typecheck / unit tests / i18n checks / diff
  re-read / Playwright + screenshot (or explicit N/A with reason).
- `Artifacts` — either `None.` or a list of entries under
  `step-<X.Y>-artifacts/`.

The rule set in `auto-create-pr`:

- **Typecheck** and **unit tests** are mandatory for every code-changing
  commit. Their outcome MUST be recorded in `step-<X.Y>-checks.md`; when the
  captured output is worth keeping, save it under
  `step-<X.Y>-artifacts/typecheck.log` or `unit-tests.log`.
- **Playwright browser checks** and **screenshots** are only required when the
  step is UI-facing AND the dev environment is runnable. If the env is not
  runnable, skip these and note the reason in `step-<X.Y>-checks.md` and
  `NOTIFY.md` — this never blocks development.
- Docs-only commits can skip runtime checks but SHOULD still leave
  `step-<X.Y>-checks.md` recording that the checks were N/A and why.

### step-\<X.Y\>-artifacts/

Optional per-Step folder. Only created when the Step actually produced
artifacts worth keeping. Typical contents:

- `playwright.log` — Playwright MCP transcript.
- `screenshot-<desc>.png` — one or more screenshots named by what they show.
- `typecheck.log`, `unit-tests.log`, `i18n.log` — captured command output when
  the raw log is worth keeping alongside the commit.
- `notes.md` — optional free-form addendum referenced from `checks.md`.

Do not create an empty `step-<X.Y>-artifacts/` folder. If there is nothing to
save, omit it.

## Lifecycle

1. `auto-create-pr` drafts `PLAN.md`, initializes `HANDOFF.md` and `NOTIFY.md`,
   and commits the whole run folder as the first commit on a fresh branch.
2. During implementation, each Step produces one commit plus a
   `step-<X.Y>-checks.md` (and optionally a `step-<X.Y>-artifacts/` folder).
   After each commit the agent flips the Step's checkbox in `PLAN.md`,
   rewrites `HANDOFF.md`, and appends a `NOTIFY.md` entry.
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
