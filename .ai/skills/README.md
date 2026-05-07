# Agent Skills

Skills extend AI agents with task-specific capabilities. Each skill is a folder containing a `SKILL.md` file plus optional bundled resources.

---

## Structure

```
.ai/skills/
├── README.md
├── tiers.json              # tier manifest (single source of truth)
├── tiers.schema.json       # JSON Schema for tiers.json
├── <skill>/                # one folder per skill (see "Available Skills" below)
│   ├── SKILL.md
│   ├── scripts/            # optional
│   └── references/         # optional
└── ...
```

The full list of skill folders and their tier assignments lives in `tiers.json`; see the [Available Skills](#available-skills) section below.

### Skill Folder Layout

```
skill-name/
├── SKILL.md          # Required: instructions + YAML frontmatter
├── scripts/          # Optional: executable code (Python/Bash)
├── references/       # Optional: documentation loaded on demand
└── assets/           # Optional: templates, images, resources
```

---

## SKILL.md Format

Every skill requires a `SKILL.md` with YAML frontmatter (`name` + `description`) and markdown instructions:

```markdown
---
name: skill-name
description: What this skill does and when to use it. Include trigger words and domain terms.
---

Instructions for the agent to follow when this skill is active.

## Section 1
...
```

Only include `name` and `description` in the frontmatter — no other fields.

---

## Tiers

All skills live under `.ai/skills/`. Tier membership is recorded in `.ai/skills/tiers.json` — that file is the single source of truth for which skills are installed by which command.

The default `yarn install-skills` ships only the **core** tier. Every other tier is opt-in. This keeps loaded skill descriptions inside the harness's per-session context budget while leaving the full catalog one flag away.

| Tier | Default? | Skills | What's inside |
|------|----------|--------|---------------|
| `core` | yes | 13 | Daily-driver skills installed by default. |
| `automation` | opt-in | 11 | PR/issue automation skills. Opt-in; agent-driven workflows. |
| `security` | opt-in | 2 | Security audit skills. Opt-in. |
| `migration` | opt-in | 1 | One-shot, version-pinned migrations. Install only when needed. |
| `infra` | opt-in | 2 | Rare, special-case skills. |

Run `yarn install-skills --list` at any time to see tier definitions, current memberships, and which tiers are installed locally.

---

## Installation

### Using the Install Script

The install script reads `.ai/skills/tiers.json` and creates one symlink per selected skill under `.claude/skills/` and `.codex/skills/`.

```bash
yarn install-skills                              # core only (default)
yarn install-skills --with automation            # core + automation
yarn install-skills --with automation,security   # multiple tiers
yarn install-skills --tiers core,security        # explicit set (replaces default)
yarn install-skills --all                        # every tier (29 skills)
yarn install-skills --list                       # show tiers + memberships
yarn install-skills --clean                      # remove all skill symlinks
```

`--with` is additive on top of the default tier set; `--tiers` replaces the default outright. The two flags are mutually exclusive. Re-running with a smaller selection is idempotent — symlinks for skills that are no longer selected are swept on each run.

The script auto-detects a legacy directory-level symlink (`.claude/skills -> ../.ai/skills`) left over from earlier versions, removes it, and replaces it with a real directory containing per-skill symlinks.

### Migrating from a previous install

If you previously ran `yarn install-skills`, your `.claude/skills` and `.codex/skills` are directory-level symlinks that exposed every skill in the catalog. Re-run `yarn install-skills` and the script will replace them with per-skill symlinks for the core tier. To preserve the old behavior of installing every skill, run `yarn install-skills --all` instead.

### Claude Code

The script wires `.claude/skills/` for you. If you prefer to configure Claude Code manually instead, point its skills directory at `.ai/skills/` via `.claude/settings.json`:

```json
{
  "skills": {
    "directory": ".ai/skills"
  }
}
```

Note that pointing the harness directly at `.ai/skills/` exposes every skill regardless of tier — the tier system only applies when installation goes through `yarn install-skills`.

### Codex

The script wires `.codex/skills/` the same way it wires `.claude/skills/`.

### Verify

```bash
# Claude Code
claude
> /skills
# With the default install you should see only the core tier — e.g.
# code-review, ds-guardian, backend-ui-design, check-and-commit,
# spec-writing, implement-spec, pre-implement-spec, integration-tests,
# smart-test, create-agents-md, skill-creator, fix-specs.

# Codex
codex
> /skills
# Same set as Claude Code; the install script keeps both harnesses in sync.
```

---

## Using Skills

| Agent | Invoke | List |
|-------|--------|------|
| Claude Code | `/skill-name` | `/skills` |
| Codex | `$skill-name` | `/skills` |

Skills also trigger automatically when a task matches the skill's `description`.

---

## Available Skills

Skills below are grouped by tier in the same order as `.ai/skills/tiers.json`. Each "When to use" cell is the skill's current `description:` field from its `SKILL.md`.

### core

| Skill | When to use |
|-------|-------------|
| `code-review` | Review code changes for Open Mercato compliance with architecture, security, conventions, and quality rules. Covers module structure, naming, data security, UI patterns, event/cache/queue rules, and anti-patterns. Use for reviewing PRs, diffs, or commits. |
| `ds-guardian` | Design System Guardian for Open Mercato. Enforces DS compliance, migrates hardcoded colors and typography, scaffolds DS-compliant pages, and reviews code against design principles. Activates on: 'design system', 'DS', 'migrate colors', 'fix colors', 'hardcoded colors', 'semantic tokens', 'scaffold page', 'new page', 'create page', 'DS review', 'DS check', 'DS health', 'health check', 'design system compliance', 'StatusBadge', 'FormField', 'SectionHeader', 'text-red-', 'bg-green-', 'text-[11px]', 'arbitrary text', 'empty state', 'loading state', or when a developer is building UI, creating new modules, reviewing PRs, or fixing DS violations in Open Mercato. Always use this skill when working on frontend UI in Open Mercato — it ensures every change follows the design system. |
| `backend-ui-design` | Design and implement consistent, production-grade backend/backoffice interfaces using the @open-mercato/ui component library. Use this skill when building admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI components. Ensures visual consistency and UX patterns across all application modules. |
| `check-and-commit` | Verify that the Open Mercato app is ready to publish by running build, generation, i18n, typecheck, unit test, and app build checks; fix obvious i18n sync or usage issues; and if everything passes, commit and push the current branch. Use this skill when the user asks to check the branch, make CI-style verification pass, fix i18n drift, then commit and push. |
| `spec-writing` | Guide for creating high-quality, architecturally compliant specifications for Open Mercato. Use when starting a new SPEC or reviewing specs against "Martin Fowler" staff-engineer standards. |
| `implement-spec` | Implement a specification (or specific phases) using coordinated subagents with unit tests, integration tests, docs, and code-review compliance. Tracks progress by updating the spec. Triggers on "implement spec", "implement phases", "build from spec", "code the spec". |
| `pre-implement-spec` | Analyze a spec before implementation: BC audit, risk assessment, gap analysis. Produces a readiness report with BC violations, missing sections, and suggested improvements. Triggers on "analyze spec", "pre-implement", "spec readiness", "BC analysis", "spec gap analysis". |
| `integration-tests` | Run and create QA integration tests (Playwright TypeScript), including executing the full suite, converting optional markdown scenarios, and generating new tests from specs or feature descriptions. Use when the user says "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", or "integration test". |
| `smart-test` | Run only the tests affected by changed code. Use when the user says "run affected tests", "run smart tests", "test only what changed", "run tests for this PR", "run tests for my changes", "selective tests", or asks to run tests without running the full suite. |
| `create-agents-md` | Create or rewrite AGENTS.md files for Open Mercato packages and modules. Use this skill when adding a new package, creating a new module, or when an existing AGENTS.md needs to be created or refactored. Ensures prescriptive tone, MUST rules, checklists, and consistent structure across all agent guidelines. |
| `skill-creator` | Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations. |
| `fix-specs` | Normalize spec filenames in .ai/specs and .ai/specs/enterprise to the date+slug convention. Use this when legacy `SPEC-*` / `SPEC-ENT-*` names need to be cleaned up, when filename collisions appear after dropping numeric prefixes, or when links must be updated after normalization. |
| `migrate-mikro-orm` | Migrate custom module code from MikroORM v6 to v7. Fixes v7 type errors (FilterQuery, RequiredEntityData), replaces Knex raw queries with Kysely, migrates persistAndFlush/removeAndFlush, updates decorator imports. Triggers on "mikro-orm v7", "persistAndFlush deprecated", "knex to kysely". |

### automation

| Skill | When to use |
|-------|-------------|
| `auto-create-pr` | Run an arbitrary autonomous task end-to-end and ship it as a GitHub PR against `develop`. Drafts a Progress-tracked plan in `.ai/runs/`, commits on a fresh worktree branch, implements phase-by-phase, runs typecheck/tests/i18n/build, applies pipeline labels. Resumable via `auto-continue-pr`. |
| `auto-continue-pr` | Resume an in-progress PR started by `auto-create-pr`. Claims the PR, checks the branch into an isolated worktree, reads the linked plan's Progress checklist, continues from the first unchecked step. Usage - /auto-continue-pr <PR-number> |
| `auto-create-pr-loop` | Advanced `auto-create-pr` workflow for long, multi-step spec implementations that need resumability and strict step tracking. Creates a run folder under `.ai/runs/<date>-<slug>/` with `PLAN.md`, `HANDOFF.md`, and `NOTIFY.md`, executes one lean commit per task-table step, batches verification into `checkpoint-<N>-checks.md` every 5 steps (with focused integration tests + screenshots when UI was touched), runs the full validation gate plus full/standalone integration suites and ds-guardian at spec completion, and opens a PR with the correct labels. Use the original `auto-create-pr` for small fixes. |
| `auto-continue-pr-loop` | Advanced `auto-continue-pr` workflow for PRs started by `auto-create-pr-loop`. Claims the PR, re-enters an isolated worktree, resumes from the first non-done row in `.ai/runs/<date>-<slug>/PLAN.md`, executes lean per-step commits, batches verification into `checkpoint-<N>-checks.md` every 5 resumed steps (with focused integration tests + screenshots when UI was touched), runs the full validation gate plus full/standalone integration suites and ds-guardian at spec completion, and preserves the run-folder and label contract. Use the original `auto-continue-pr` for simple `auto-create-pr` runs. |
| `auto-review-pr` | Review or re-review a GitHub PR by number in an isolated worktree. Runs the `code-review` skill, submits approve/request-changes, manages labels. Optional autofix iterates conflict resolution/fixes/tests/typecheck/re-review until merge-ready. Usage - /auto-review-pr <PR-number> |
| `auto-fix-github` | Fix a GitHub issue by number. Checks whether it's already solved or has an open solution, then in an isolated worktree implements the minimal fix, adds tests, runs code-review/BC/typecheck/i18n, pushes a branch, opens a PR linked to the issue. |
| `review-prs` | Review all currently unreviewed open pull requests, newest first, using the auto-review-pr skill and respecting in-progress locks. |
| `merge-buddy` | Scan open GitHub pull requests, classify merge readiness from labels, reviews, CI, and mergeability, then report which PRs can merge now and which ones are close but blocked. |
| `sync-merged-pr-issues` | Reconcile recently merged (and recently closed-but-not-merged) PRs with the GitHub issue tracker — auto-close issues they authoritatively fix via `fixes`/`closes`/`resolves` keywords or `closingIssuesReferences`, and post informational comments on issues whose PRs were closed without merging. Use for post-merge housekeeping and release prep. Respects claim locks. |
| `auto-update-changelog` | Draft a CHANGELOG.md release entry in the house emoji-driven format for every PR merged since the last release, then delegate to `auto-create-pr` so it lands as a docs PR against `develop`. Honors the Supersede Credit Rule for carried-forward fork PRs. Use at release time. |
| `auto-qa-scenarios` | Generate a human QA report for a window of merged PRs (date floor, PR-number floor, or default last 7 days) and ship it as a docs-only PR against `develop`. Groups work into P0/P1/P2 testing routes with click paths, verification points, and risk callouts. Writes markdown + HTML under `.ai/analysis/`. Hands off to `auto-continue-pr` if it cannot finish in one pass. |

### security

| Skill | When to use |
|-------|-------------|
| `auto-sec-report` | Driver that loops `auto-sec-report-pr` across a window (date, PR-number floor, branch, spec, or default last 7 days of merged PRs) and aggregates findings into one docs-only PR against `develop`. Writes markdown + HTML under `.ai/analysis/` with a top-level "Next steps — go deeper" list. |
| `auto-sec-report-pr` | Paranoid OWASP-oriented security analysis for a SINGLE unit of work — one PR, one spec under `.ai/specs/`, or one branch diff. Hunts non-obvious attack vectors beyond OWASP Top 10, flags same-pattern hotspots elsewhere, and emits "Next steps — go deeper" follow-ups. Writes markdown + HTML under `.ai/analysis/`; runs standalone or as a sub-unit of `auto-sec-report`. |

### migration

| Skill | When to use |
|-------|-------------|
| `auto-upgrade-0.4.10-to-0.5.0` | Migrate a downstream Open Mercato user codebase from 0.4.10 to 0.5.0. Executable companion to UPGRADE_NOTES.md — detects which codemod patterns are in use, applies them in place, typechecks, and reports what still needs human review. Triggers on "upgrade open-mercato to 0.5.0", "bump to 0.5.0", or "apply UPGRADE_NOTES migrations". |

### infra

| Skill | When to use |
|-------|-------------|
| `dev-container-maintenance` | Maintain the VS Code Dev Container setup for Open Mercato. MUST use for ANY change to `.devcontainer/` files. Also use when the container fails to build/start, services inside misbehave, or "works locally but not in dev container". Triggers on "dev container", "devcontainer", ".devcontainer". |
| `integration-builder` | Build integration provider packages for the Open Mercato Integration Marketplace (payment, shipping, data-sync, webhook). Scaffolds the npm package, adapter, credentials, widget injection, webhook processing, health checks, i18n, tests. Triggers on "build integration", "add provider", "integrate with stripe/paypal/dhl". |

---

## Creating a New Skill

1. Use the `skill-creator` skill interactively, or create manually:

```bash
mkdir -p .ai/skills/my-skill
```

2. Create `SKILL.md` with frontmatter and instructions
3. Add optional `scripts/`, `references/`, `assets/` as needed
4. Test the skill by invoking it

### Writing Effective Descriptions

The `description` field drives automatic skill selection. Include:

- **Trigger words**: "when building", "when creating", "when designing"
- **Domain terms**: "admin pages", "API endpoints", "CRUD interfaces"
- **Outcomes**: "ensures consistency", "follows conventions"

### Skill Size Guidelines

| Size | Lines | When to split |
|------|-------|---------------|
| Small | < 100 | Single-purpose conventions |
| Medium | 100-300 | Component libraries, API patterns |
| Large | 300-500 | Complex workflows — use `references/` to keep SKILL.md lean |

If exceeding 500 lines, split detailed content into `references/` files.

---

## Skills vs Global Instructions

| File | Scope | When active |
|------|-------|-------------|
| `CLAUDE.md` / `codex.md` | Global project instructions | Always |
| `AGENTS.md` | Agent conventions | Always |
| Skills | Task-specific guidance | On demand |

Use skills when instructions are task-specific, substantial (>50 lines), or benefit from explicit invocation control.

---

## Troubleshooting

**Skill not found**: Verify the per-skill symlink exists (`ls -la .claude/skills` or `ls -la .codex/skills`) and `SKILL.md` has valid YAML frontmatter. If the skill belongs to an opt-in tier, install it with `yarn install-skills --with <tier>` (or `--all`).

**Skill not auto-selected**: Improve `description` with more specific trigger words and domain terminology.

**Symlink issues**:
```bash
# Wipe everything the install script manages and reinstall the default core tier.
yarn install-skills --clean
yarn install-skills
```
