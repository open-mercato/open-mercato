# Agent Skills

Skills extend AI agents with task-specific capabilities. Each skill is a folder containing a `SKILL.md` file plus optional bundled resources.

Skills come from **two sources**, mixed together by `yarn install-skills`:

1. **External shared collection** — the generalized `om-*` pipeline skills (code review, auto-create/review PR, merge buddy, spec writing, changelog, …) are maintained in [open-mercato/skills](https://github.com/open-mercato/skills) and installed into `.agents/skills/` via `npx skills add`. They read this repository's settings from `.ai/agentic.config.json` and the tracker descriptor `.ai/trackers/github.md`, plus the root docs (`AGENTS.md`, `BACKWARD_COMPATIBILITY.md`) and the review checklist `.ai/review-checklist.md`.
2. **Local repo skills** — everything still under `.ai/skills/<skill>/`, installed as per-skill symlinks according to the tier manifest.

A folder under `.ai/skills/` whose name matches an external skill (listed under `external` in `tiers.json`) is a **repo-local override**: the external skill reads and follows it on top of its built-in workflow. Override folders are never symlinked into the harness directories.

---

## Structure

```
.ai/skills/
├── README.md
├── tiers.json              # tier manifest + external-skill registry (single source of truth)
├── tiers.schema.json       # JSON Schema for tiers.json
├── <skill>/                # one folder per local skill (see "Available Skills" below)
│   ├── SKILL.md
│   ├── scripts/            # optional
│   └── references/         # optional
└── <external-skill>/       # optional repo-local override for an external skill
    └── SKILL.md
```

The full list of local skill folders and their tier assignments lives in `tiers.json`; the `external` block in the same file registers the skills owned by [open-mercato/skills](https://github.com/open-mercato/skills). See the [Available Skills](#available-skills) section below.

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

Local skills live under `.ai/skills/`. Tier membership is recorded in `.ai/skills/tiers.json` — that file is the single source of truth for which local skills are installed by which command.

The default `yarn install-skills` ships the **core** tier plus the entire external collection. Every other local tier is opt-in. This keeps loaded skill descriptions inside the harness's per-session context budget while leaving the full catalog one flag away.

| Tier | Default? | Skills | What's inside |
|------|----------|--------|---------------|
| `core` | yes | 11 | Daily-driver skills installed by default. |
| `automation` | opt-in | 2 | PR/issue automation skills. Opt-in; agent-driven workflows. |
| `security` | opt-in | 2 | Security audit skills. Opt-in. |
| `migration` | opt-in | 1 | One-shot, version-pinned migrations. Install only when needed. |
| `infra` | opt-in | 2 | Rare, special-case skills. |
| external | always | 25 | Shared pipeline skills from [open-mercato/skills](https://github.com/open-mercato/skills), installed via `npx skills add` and refreshed via `npx skills update` (skip with `--no-external`). |

Run `yarn install-skills --list` at any time to see tier definitions, current memberships, and which tiers are installed locally.

---

## Installation

### Using the Install Script

Skills install into **one canonical directory** — `.agents/skills/`, the cross-agent path the `skills` CLI treats as canonical and most coding agents read directly. The install script does two things on every run:

1. Reads `.ai/skills/tiers.json` and creates one symlink per selected local skill: `.agents/skills/<name> -> ../../.ai/skills/<name>`.
2. Installs the external collection with `npx -y skills add open-mercato/skills --skill '*'` into the same `.agents/skills/` directory, then runs `npx -y skills update --project` so re-runs refresh the external skills to their latest published versions (the lockfile is gitignored, so `add` seeds and `update` keeps them current). This step needs network access; when it fails the script warns and continues with local skills only.

```bash
yarn install-skills                              # core tier + external collection (default)
yarn install-skills --with automation            # + automation tier
yarn install-skills --with automation,security   # multiple tiers
yarn install-skills --tiers core,security        # explicit set (replaces default)
yarn install-skills --all                        # every local tier
yarn install-skills --legacy-links               # also symlink into .claude/skills/ AND .codex/skills/
yarn install-skills --ignore-agents cursor       # never write these agents' directories
yarn install-skills --no-external                # skip the npx step (offline; also OM_SKIP_EXTERNAL_SKILLS=1)
yarn install-skills --list                       # show tiers + memberships
yarn install-skills --clean                      # remove all skill symlinks + external copies
```

`--with` is additive on top of the default tier set; `--tiers` replaces the default outright. The two flags are mutually exclusive. Re-running with a smaller selection is idempotent — symlinks for local skills that are no longer selected are swept on each run; external skills are always installed in full for parity with the shared collection.

### Agent directories

A skill is duplicated into an agent's own directory **only when that agent cannot read the canonical one**:

| Agent | Directory | Reads `.agents/skills/` | Per-skill symlinks |
|-------|-----------|-------------------------|--------------------|
| Claude Code | `.claude/skills/` | no | yes (automatic) |
| Codex | `.codex/skills/` | yes | no |
| Cursor | `.cursor/skills/` | yes | no |

The support column follows the universal-agent list of the [`skills` CLI](https://github.com/vercel-labs/skills). An agent that cannot read the canonical directory keeps its symlinks, written by `install-skills.sh` itself for both local tier skills and the external collection — dropping them would make its skills silently disappear. Re-check the table when an agent gains support.

Two escape hatches:

- **`--legacy-links`** restores the historical layout (every skill symlinked into `.claude/skills/` *and* `.codex/skills/`), for a setup that still depends on it.
- **`--ignore-agents <csv>`** skips an agent entirely. The persistent form is an `agents` block in `tiers.json`, which the flag overrides:

  ```json
  { "agents": { "ignore": ["cursor"] } }
  ```

### Migrating from a previous install

Earlier versions symlinked every skill into `.claude/skills/` *and* `.codex/skills/` (and copied external skills into `.agents/skills/` on top — three locations per skill). A plain re-run of `yarn install-skills` migrates you: it writes the canonical layout and sweeps the stale per-agent links away. To clear everything first:

```bash
yarn install-skills --clean && yarn install-skills
```

### Claude Code

The script wires `.claude/skills/` for you — Claude Code does not read the canonical directory at project level. If you prefer to configure it manually instead, point its skills directory at `.ai/skills/` via `.claude/settings.json`:

```json
{
  "skills": {
    "directory": ".ai/skills"
  }
}
```

Note that pointing the harness directly at `.ai/skills/` exposes every skill regardless of tier — the tier system only applies when installation goes through `yarn install-skills`.

### Codex and Cursor

Nothing to wire: both read `.agents/skills/` directly.

### Verify

```bash
# Claude Code
claude
> /skills
# With the default install you should see the core tier (e.g. ds-guardian,
# backend-ui-design, implement-spec, pre-implement-spec, smart-test,
# create-agents-md, skill-creator, fix-specs, migrate-mikro-orm,
# create-ai-agent, help) plus the external collection (code-review,
# check-and-commit, spec-writing, integration-tests, auto-create-pr, ...).

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
| `om-ds-guardian` | Design System Guardian for Open Mercato. Enforces DS compliance, migrates hardcoded colors and typography, scaffolds DS-compliant pages, and reviews code against design principles. Activates on: 'design system', 'DS', 'migrate colors', 'fix colors', 'hardcoded colors', 'semantic tokens', 'scaffold page', 'new page', 'create page', 'DS review', 'DS check', 'DS health', 'health check', 'design system compliance', 'StatusBadge', 'FormField', 'SectionHeader', 'text-red-', 'bg-green-', 'text-[11px]', 'arbitrary text', 'empty state', 'loading state', or when a developer is building UI, creating new modules, reviewing PRs, or fixing DS violations in Open Mercato. Always use this skill when working on frontend UI in Open Mercato — it ensures every change follows the design system. |
| `om-backend-ui-design` | Design and implement consistent, production-grade backend/backoffice interfaces using the @open-mercato/ui component library. Use this skill when building admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI components. Ensures visual consistency and UX patterns across all application modules. |
| `om-implement-spec` | Implement a specification (or specific phases) using coordinated subagents with unit tests, integration tests, docs, and code-review compliance. Tracks progress by updating the spec. Triggers on "implement spec", "implement phases", "build from spec", "code the spec". |
| `om-pre-implement-spec` | Analyze a spec before implementation: BC audit, risk assessment, gap analysis. Produces a readiness report with BC violations, missing sections, and suggested improvements. Triggers on "analyze spec", "pre-implement", "spec readiness", "BC analysis", "spec gap analysis". |
| `om-smart-test` | Run only the tests affected by changed code. Use when the user says "run affected tests", "run smart tests", "test only what changed", "run tests for this PR", "run tests for my changes", "selective tests", or asks to run tests without running the full suite. |
| `om-create-agents-md` | Create or rewrite AGENTS.md files for Open Mercato packages and modules. Use this skill when adding a new package, creating a new module, or when an existing AGENTS.md needs to be created or refactored. Ensures prescriptive tone, MUST rules, checklists, and consistent structure across all agent guidelines. |
| `om-skill-creator` | Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations. |
| `om-fix-specs` | Normalize spec filenames in .ai/specs and .ai/specs/enterprise to the date+slug convention. Use this when legacy `SPEC-*` / `SPEC-ENT-*` names need to be cleaned up, when filename collisions appear after dropping numeric prefixes, or when links must be updated after normalization. |
| `om-migrate-mikro-orm` | Migrate custom module code from MikroORM v6 to v7. Fixes v7 type errors (FilterQuery, RequiredEntityData), replaces Knex raw queries with Kysely, migrates persistAndFlush/removeAndFlush, updates decorator imports. Triggers on "mikro-orm v7", "persistAndFlush deprecated", "knex to kysely". |
| `om-create-ai-agent` | Scaffold AI agents (`ai-agents.ts`) and MCP tools (`ai-tools.ts`) for Open Mercato modules. Use when adding a new AI agent definition, configuring tool allowlists, mutation policies, or model selection. Triggers on "add ai agent", "create ai tool", "ai-agents.ts", "ai-tools.ts". |
| `om-help` | Open Mercato workflow navigator. Use when asking "what should I do now?", "which skill?", "next steps?", "where do I start?", or "how do I add/build X in Open Mercato?". Covers navigation (recommends the next skill based on git/spec/PR state) and knowledge (answers how-to questions grounded in AGENTS.md). |

### automation

| Skill | When to use |
|-------|-------------|
| `om-auto-publish-pr` | Publish pkg.pr.new package previews for a same-repository Open Mercato PR by dispatching the Package Previews GitHub Actions workflow with gh. Use when a maintainer asks to publish, republish, or trigger a PR package preview. Does not publish npm snapshots. |
| `om-auto-qa-scenarios` | Generate a human QA report for a window of merged PRs (date floor, PR-number floor, or default last 7 days) and ship it as a docs-only PR against `develop`. Groups work into P0/P1/P2 testing routes with click paths, verification points, and risk callouts. Writes markdown + HTML under `.ai/analysis/`. Hands off to `om-auto-continue-pr` if it cannot finish in one pass. |

### external (open-mercato/skills)

These skills are installed from [open-mercato/skills](https://github.com/open-mercato/skills) into `.agents/skills/`; their descriptions are maintained upstream. They read `.ai/agentic.config.json`, `.ai/trackers/github.md`, the root docs, and any repo-local override under `.ai/skills/<name>/`.

`om-approve-merge-pr`, `om-auto-continue-pr`, `om-auto-continue-pr-loop`, `om-auto-create-pr`, `om-auto-create-pr-loop`, `om-auto-fix-issue`, `om-auto-review-pr`, `om-auto-update-changelog`, `om-auto-qa-pr`, `om-check-and-commit`, `om-code-review`, `om-fix`, `om-followup-issue-from-pr`, `om-integration-tests`, `om-merge-buddy`, `om-open-pr`, `om-prepare-issue`, `om-prepare-test-env`, `om-review-prs`, `om-root-cause`, `om-setup-agent-pipeline`, `om-spec-writing`, `om-auto-fix-pr`, `om-close-fixed-issues`, `om-verify-in-repo`

### security

| Skill | When to use |
|-------|-------------|
| `om-auto-sec-report` | Driver that loops `om-auto-sec-report-pr` across a window (date, PR-number floor, branch, spec, or default last 7 days of merged PRs) and aggregates findings into one docs-only PR against `develop`. Writes markdown + HTML under `.ai/analysis/` with a top-level "Next steps — go deeper" list. |
| `om-auto-sec-report-pr` | Paranoid OWASP-oriented security analysis for a SINGLE unit of work — one PR, one spec under `.ai/specs/`, or one branch diff. Hunts non-obvious attack vectors beyond OWASP Top 10, flags same-pattern hotspots elsewhere, and emits "Next steps — go deeper" follow-ups. Writes markdown + HTML under `.ai/analysis/`; runs standalone or as a sub-unit of `om-auto-sec-report`. |

### migration

| Skill | When to use |
|-------|-------------|
| `om-auto-upgrade-0.4.10-to-0.5.0` | Migrate a downstream Open Mercato user codebase from 0.4.10 to 0.5.0. Executable companion to UPGRADE_NOTES.md — detects which codemod patterns are in use, applies them in place, typechecks, and reports what still needs human review. Triggers on "upgrade open-mercato to 0.5.0", "bump to 0.5.0", or "apply UPGRADE_NOTES migrations". |

### infra

| Skill | When to use |
|-------|-------------|
| `om-dev-container-maintenance` | Maintain the VS Code Dev Container setup for Open Mercato. MUST use for ANY change to `.devcontainer/` files. Also use when the container fails to build/start, services inside misbehave, or "works locally but not in dev container". Triggers on "dev container", "devcontainer", ".devcontainer". |
| `om-integration-builder` | Build integration provider packages for the Open Mercato Integration Marketplace (payment, shipping, data-sync, webhook). Scaffolds the npm package, adapter, credentials, widget injection, webhook processing, health checks, i18n, tests. Triggers on "build integration", "add provider", "integrate with stripe/paypal/dhl". |

---

## Creating a New Skill

1. Use the `om-skill-creator` skill interactively, or create manually:

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

**Skill not found**: Verify the skill exists in the canonical directory (`ls -la .agents/skills`) — and, for Claude Code, that its link layer has it too (`ls -la .claude/skills`) — and that `SKILL.md` has valid YAML frontmatter. If the skill belongs to an opt-in tier, install it with `yarn install-skills --with <tier>` (or `--all`).

**Skill not auto-selected**: Improve `description` with more specific trigger words and domain terminology.

**Symlink issues**:
```bash
# Wipe everything the install script manages and reinstall the default core tier.
yarn install-skills --clean
yarn install-skills
```
