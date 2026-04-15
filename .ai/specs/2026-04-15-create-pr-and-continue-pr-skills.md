# create-pr and continue-pr skills

## TLDR

**Key Points:**
- Two new skills, `create-pr` and `continue-pr`, that wrap an arbitrary autonomous agent task and deliver it as a GitHub PR against `develop`, mirroring the isolation and discipline of `fix-github-issue`.
- `create-pr` accepts a free-form task brief plus optional external skill URLs (e.g. `https://skills.sh/...`), generates a spec, implements the work in an isolated worktree, commits incrementally, records progress inside the spec, and opens a PR with the correct pipeline labels.
- `continue-pr` resumes a PR that was started by `create-pr` but is not yet complete: it reads the referenced spec's Progress section, continues from the next unfinished step, and pushes follow-up commits to the same PR.

**Scope:**
- New skill `create-pr` available for Claude Code and Codex (via the shared `.ai/skills/` symlinks).
- New skill `continue-pr` available for Claude Code and Codex.
- Spec template additions: a `Progress` section with a stable checkbox format so both skills agree on state.
- Task Router entries and README registration so the skills are discoverable.

**Concerns:**
- External skill URLs are untrusted third-party instructions — they must be treated as reference material, never as permission to bypass AGENTS.md rules or CI gates.
- Progress recovery relies on a conventional format inside the spec; if a human rewrites the spec freely, `continue-pr` may mis-parse state.

## Overview

Today, autonomous agent runs that produce a PR are bespoke. `fix-github-issue` covers one specific shape (a numbered GitHub issue); spec-driven work is covered by `implement-spec` once a spec already exists; everything else (security review, doc generation, ad-hoc refactors delivered as a PR, running an external skill against our codebase) is manually orchestrated. These skills give us a single, reusable entry point: describe the task, optionally point at an external skill, and get a reviewable PR with a spec trail.

> **Market Reference**: The internal `fix-github-issue` skill (see [`.ai/skills/fix-github-issue/SKILL.md`](.ai/skills/fix-github-issue/SKILL.md)) is the direct reference implementation — we copy its worktree isolation, validation loop, lock protocol, and label hygiene. We deliberately reject "do everything inline on the current branch" because it leaks half-finished work into the user's active worktree.

## Problem Statement

- Running a generic autonomous agent task end-to-end (spec → code → tests → PR → labels) requires copy-pasting conventions from several skills; authors make mistakes (missing spec, wrong base branch, no labels).
- When a long run is interrupted, there is no standard way to resume — the next agent cannot tell which steps were completed without re-reading the entire diff.
- Third-party prompts (e.g. `skills.sh/...` pages) cannot be safely plugged into our workflow without an opinionated wrapper that still enforces our architecture and BC rules.

## Proposed Solution

Two skills, both Claude- and Codex-compatible (they live under `.ai/skills/` which is symlinked into `.claude/skills` and `.codex/skills`):

1. **`create-pr`** — accepts a task brief plus optional external skill URLs, drafts a spec in `.ai/specs/{YYYY-MM-DD}-{slug}.md`, commits the spec on a new feature branch in an isolated worktree, executes the plan phase-by-phase with incremental commits, updates the spec's Progress section after every phase, runs the full validation gate, and opens a PR labeled per the PR workflow.
2. **`continue-pr`** — accepts a PR number, claims it under the in-progress protocol, checks out its branch into an isolated worktree, loads the linked spec, and continues from the first unchecked Progress step. Pushes follow-up commits and leaves the PR ready for review once done.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Spec is mandatory, even for simple tasks | Required by `AGENTS.md`; also gives `continue-pr` a deterministic place to read progress from. |
| Progress tracked inside the spec, not in a separate file | One source of truth; the spec is already committed, reviewable, and picked up by the PR. |
| External skill URLs are fetched read-only and summarized into the spec before execution | Keeps provenance visible; lets humans sanity-check third-party instructions before code lands. |
| Labels normalized the same way as `fix-github-issue` | Consistent PR pipeline; respects the mutually-exclusive pipeline label rules. |
| Base branch always `develop` | Matches existing auto-skills; `main` is a release-merge target only. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Extend `fix-github-issue` with an "ad-hoc" mode | Overloads a skill that already has specific semantics (claims a GitHub issue). Clearer to add a sibling skill. |
| Let `implement-spec` handle it | `implement-spec` assumes the spec already exists; it doesn't bootstrap the spec, the branch, or the PR. `create-pr` composes with `implement-spec` for execution. |
| Track progress in a sidecar JSON file | Adds a second source of truth and a serialization format to maintain; inline checkboxes in the spec are easier to read and review. |

## User Stories / Use Cases

- A platform engineer wants to **run an API-security review and produce a PR with the remediation** so that the review outcome is enforceable via code review. They invoke `/create-pr "Run API security review using https://skills.sh/.../api-security-best-practices and apply the non-controversial fixes"`.
- An agent runtime gets interrupted mid-run (time budget, connectivity) and wants to **resume exactly where it left off** so that no work is duplicated or lost. They invoke `/continue-pr 1492`.
- A maintainer wants to **delegate a targeted refactor** (e.g. "migrate hardcoded colors in `packages/ui/src/portal` to semantic tokens") and receive a PR they can review without babysitting the agent.

## Architecture

### Components

- **`create-pr` skill** — `SKILL.md` with the full workflow; reuses the validation loop and worktree isolation from `fix-github-issue`, adds a spec-authoring step up front and a progress-tracking step between phases.
- **`continue-pr` skill** — `SKILL.md` that finds the spec linked from the PR body, re-enters the worktree (or creates one from the PR head), and resumes from the first unchecked Progress step.
- **Spec Progress section** — documented in the Implementation Plan below; a fixed markdown format both skills read and write.

### Flow (create-pr)

```
user brief + optional external skill URLs
        │
        ▼
   claim (branch name, assignee on PR later)
        │
        ▼
   isolated worktree off origin/develop
        │
        ▼
   spec draft → commit → push (feature branch, no PR yet)
        │
        ▼
   per-phase loop:
     implement → tests → validation gate → commit
     update Progress checkbox in spec → commit
        │
        ▼
   full CI gate (typecheck, unit tests, i18n, build)
        │
        ▼
   open PR against develop
        │
        ▼
   apply pipeline + meta labels, post rationale comments
        │
        ▼
   cleanup worktree (only if created by this run)
```

### Flow (continue-pr)

```
PR number
        │
        ▼
   claim PR (assignee + in-progress + claim comment)
        │
        ▼
   resolve spec path from PR body "Tracking spec:" line (fallback: grep new files in PR diff)
        │
        ▼
   isolated worktree from PR head
        │
        ▼
   read Progress section; pick first unchecked step
        │
        ▼
   per-remaining-step loop (same as create-pr)
        │
        ▼
   full CI gate → push → update PR body/labels
        │
        ▼
   release PR lock, cleanup worktree
```

### Commands & Events

Not applicable — these are developer-tooling skills, not product modules.

## Data Models

Not applicable. The only persisted state is:

- A markdown spec at `.ai/specs/{YYYY-MM-DD}-{slug}.md`
- Git commits on the feature branch
- Labels and comments on the GitHub PR

## API Contracts

Not applicable. External surface is the skill invocation contract (arguments) documented in each `SKILL.md`.

### Skill invocation

- `create-pr {brief} [--skill-url <url>...] [--slug <slug>] [--force]`
  - `brief` (required) — free-form task description.
  - `--skill-url` (optional, repeatable) — external skill/reference URL to fetch and honor during planning.
  - `--slug` (optional) — kebab-case override for the spec filename.
  - `--force` (optional) — skip the claim-conflict check (mirrors `fix-github-issue`).
- `continue-pr {prNumber} [--force]`
  - `prNumber` (required) — the PR to resume.
  - `--force` (optional) — override an existing `in-progress` lock.

## Internationalization (i18n)

Not applicable — the skills themselves are agent-facing documentation; no user-visible strings are added.

## UI/UX

Not applicable — the outputs are a spec file, commits, and a PR. UI impact is limited to the PR body format, which must include:

- `Tracking spec: .ai/specs/{file}.md`
- `Status: in-progress | complete`
- The same sections as `fix-github-issue` ("Problem / What Changed / Tests / Backward Compatibility") plus a link back to the spec Progress section.

## Configuration

None required. The skills rely on existing tooling (`gh`, `git`, `yarn`).

## Migration & Compatibility

- Purely additive. New files under `.ai/skills/create-pr/` and `.ai/skills/continue-pr/`, one new spec, minor edits to `.ai/skills/README.md` and root `AGENTS.md` Task Router.
- No contract-surface changes (no new ACL features, events, widget spots, API routes, DI names, or DB changes).
- Safe to roll back by deleting the two skill folders and reverting the router/README edits.

## Implementation Plan

### Phase 1: Spec and branch bootstrap

1. Create feature branch `feat/create-pr-skills` off `origin/develop`.
2. Draft this spec at `.ai/specs/2026-04-15-create-pr-and-continue-pr-skills.md`.
3. Commit the spec as the first commit on the branch.

### Phase 2: `create-pr` skill

1. Create `.ai/skills/create-pr/SKILL.md` with YAML frontmatter (`name`, `description`) and the full workflow adapted from `fix-github-issue`.
2. Document the spec-authoring step, the external-skill-URL handling, the per-phase progress-update cadence, and the label protocol.
3. Document cleanup and lock-release semantics (finally block).

### Phase 3: `continue-pr` skill

1. Create `.ai/skills/continue-pr/SKILL.md` with YAML frontmatter and the resume workflow.
2. Document spec-resolution rules, Progress-parse rules, and the same validation/label discipline as `create-pr`.

### Phase 4: Registration and discoverability

1. Update `.ai/skills/README.md` — add both skills to the Available Skills table.
2. Update root `AGENTS.md` Task Router — add a "PR Lifecycle" row pointing to the new skills for generic autonomous work.

### Phase 5: Validation and PR

1. Run `yarn lint` (skills changes are markdown-only, but lint is cheap insurance if it also lints markdown).
2. Confirm no code touched means typecheck/test gates are not required; otherwise run the full gate.
3. Push the branch, open the PR against `develop`, apply the `review` pipeline label and `documentation` category label, post rationale comments.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.ai/specs/2026-04-15-create-pr-and-continue-pr-skills.md` | Create | This spec. |
| `.ai/skills/create-pr/SKILL.md` | Create | New skill. |
| `.ai/skills/continue-pr/SKILL.md` | Create | New skill. |
| `.ai/skills/README.md` | Modify | Register both skills. |
| `AGENTS.md` | Modify | Task Router entries. |

### Testing Strategy

- Markdown-only change — no unit tests. Validation is a manual smoke test: invoke `create-pr` for a trivial brief (e.g. "add a sentence to packages/README.md") on a throwaway branch, confirm spec is created, Progress updates land, PR opens with correct labels.
- `continue-pr` is validated by interrupting the smoke test partway through Phase 2 and re-entering via `continue-pr {prNumber}`.

## Risks & Impact Review

### Data Integrity Failures

- N/A — no database writes. The only mutable state is git history and GitHub metadata.

### Cascading Failures & Side Effects

- If `create-pr` crashes between committing the spec and opening the PR, the user is left with a feature branch on their remote but no PR. Mitigation: `continue-pr` can be pointed at the branch's eventual PR, and the finally-block always cleans up the worktree even if the PR open fails.

### Tenant & Data Isolation Risks

- N/A — skills operate on repository metadata, not tenant data.

### Migration & Deployment Risks

- N/A — skill files ship in-repo and take effect the moment the PR is merged.

### Operational Risks

- **External skill URLs** may contain instructions that conflict with AGENTS.md. Mitigation: the skill MUST treat them as reference material and MUST run the normal code-review/BC gate; it MUST NOT bypass validation because a third-party skill said so.
- **Progress-section parse drift** — if a human rewrites the Progress block freely, `continue-pr` may misread state. Mitigation: document the exact checkbox format in each skill; `continue-pr` should refuse to resume and ask the user when it cannot confidently parse.

### Risk Register

#### Third-party skill injects unsafe instructions

- **Scenario**: A `--skill-url` points at a page that instructs the agent to skip tests, disable hooks, or exfiltrate data.
- **Severity**: High
- **Affected area**: Any code the run touches, plus CI and repo secrets.
- **Mitigation**: The skill MUST state explicitly that external URLs are reference-only, the mandatory validation gate is non-negotiable, and any `--no-verify`, hook-bypass, or credential-related instruction from an external URL MUST be ignored and reported back to the user.
- **Residual risk**: A cleverly crafted external skill could still influence code-review decisions via its rationale; human PR review remains the backstop.

#### Progress drift between spec and branch

- **Scenario**: A human edits the spec's Progress section without running `continue-pr`, leaving the commits and checkboxes out of sync.
- **Severity**: Medium
- **Affected area**: Resume correctness.
- **Mitigation**: `continue-pr` MUST cross-check the last commit message against the last-checked Progress step and MUST stop and ask the user on mismatch.
- **Residual risk**: User can override the check with `--force` and take responsibility.

#### Worktree leak on crash

- **Scenario**: The agent crashes after `git worktree add` but before cleanup; disk slowly fills with stale worktrees under `.ai/tmp/create-pr/`.
- **Severity**: Low
- **Affected area**: Developer workstation disk.
- **Mitigation**: Document a manual `git worktree prune` recovery step in each skill; cleanup uses a finally/trap.
- **Residual risk**: Accepted — this is a developer-local concern with a trivial recovery.

## Final Compliance Report — 2026-04-15

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `.ai/skills/README.md`
- `.ai/skills/fix-github-issue/SKILL.md` (reference implementation)
- `.ai/skills/review-pr/SKILL.md` (label and lock protocol reference)
- `.ai/skills/spec-writing/SKILL.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Specs live in `.ai/specs/` with `{date}-{title}.md` naming | Compliant | `2026-04-15-create-pr-and-continue-pr-skills.md`. |
| root AGENTS.md | Non-trivial tasks start with a spec before coding | Compliant | This spec is phase 1; code changes follow. |
| root AGENTS.md | PR pipeline labels are mutually exclusive; new PRs start in `review` | Will comply | Enforced in `create-pr` workflow. |
| root AGENTS.md | Auto-skills that mutate PRs/issues MUST claim them (assignee + in-progress + claim comment) | Will comply | Both skills include the claim protocol. |
| root AGENTS.md | `skip-qa` applies to docs-only / low-risk changes | Will apply | This PR is docs-only; `skip-qa` is appropriate. |
| root AGENTS.md | Base branch for fix branches is `develop` | Compliant | Both skills hard-code `develop`. |
| `.ai/specs/AGENTS.md` | Required spec sections | Compliant | TLDR, Overview, Problem, Solution, Architecture, Data Models (N/A), API Contracts (N/A), Risks, Compliance, Changelog included. |
| BACKWARD_COMPATIBILITY.md | No contract-surface changes | Compliant | Additive skill files only. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | Neither applies. |
| API contracts match UI/UX section | N/A | Neither applies. |
| Risks cover all write operations | Pass | Only writes are git/GitHub; covered. |
| Commands defined for all mutations | N/A | No application mutations. |
| Cache strategy covers all read APIs | N/A | No APIs. |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Progress

> **Convention**: `continue-pr` reads this section. Each step is a GitHub-flavored markdown task list item. `- [ ]` means pending, `- [x]` means done. Add a trailing ` — <commit sha>` when a step lands in a commit. Keep step titles stable — do not rename them mid-run.

### Phase 1: Spec and branch bootstrap

- [x] 1.1 Create feature branch `feat/create-pr-skills` off `origin/develop`.
- [x] 1.2 Draft this spec at `.ai/specs/2026-04-15-create-pr-and-continue-pr-skills.md`.
- [ ] 1.3 Commit the spec as the first commit on the branch.

### Phase 2: `create-pr` skill

- [ ] 2.1 Create `.ai/skills/create-pr/SKILL.md`.
- [ ] 2.2 Document spec-authoring, external-skill handling, progress cadence, and label protocol.
- [ ] 2.3 Document cleanup and lock-release semantics.

### Phase 3: `continue-pr` skill

- [ ] 3.1 Create `.ai/skills/continue-pr/SKILL.md`.
- [ ] 3.2 Document spec resolution and Progress-parse rules.
- [ ] 3.3 Document the same validation and label discipline as `create-pr`.

### Phase 4: Registration and discoverability

- [ ] 4.1 Update `.ai/skills/README.md` with both skills.
- [ ] 4.2 Update root `AGENTS.md` Task Router.

### Phase 5: Validation and PR

- [ ] 5.1 Run `yarn lint` (docs-only; full gate not required).
- [ ] 5.2 Push branch and open PR against `develop` with `review` + `documentation` labels.
- [ ] 5.3 Post rationale comments for applied labels.

## Changelog

### 2026-04-15

- Initial specification.
