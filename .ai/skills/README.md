# Agent Skills

Skills extend AI agents with task-specific capabilities. Each skill is a folder containing a `SKILL.md` file plus optional bundled resources.

---

## Structure

```
.ai/skills/
├── README.md
├── backend-ui-design/
│   ├── SKILL.md
│   └── references/
│       └── ui-components.md
├── check-and-commit/
│   └── SKILL.md
├── code-review/
│   ├── SKILL.md
│   └── references/
│       └── review-checklist.md
├── auto-continue-pr/
│   └── SKILL.md
├── auto-create-pr/
│   └── SKILL.md
├── auto-qa-scenarios/
│   └── SKILL.md
├── auto-sec-report/
│   └── SKILL.md
├── auto-sec-report-pr/
│   ├── SKILL.md
│   └── references/
│       └── deep-attack-vectors.md
├── create-agents-md/
│   └── SKILL.md
├── ds-guardian/
│   ├── SKILL.md
│   ├── references/
│   │   ├── token-mapping.md
│   │   ├── component-guide.md
│   │   └── page-templates.md
│   └── scripts/
│       ├── ds-health-check.sh
│       ├── ds-migrate-colors.sh
│       └── ds-migrate-typography.sh
├── fix-specs/
│   ├── SKILL.md
│   └── scripts/
│       └── fix_spec_conflicts.py
├── implement-spec/
│   ├── SKILL.md
│   └── references/
│       └── code-review-compliance.md
├── integration-tests/
│   └── SKILL.md
├── pre-implement-spec/
│   └── SKILL.md
├── auto-review-pr/
│   └── SKILL.md
├── auto-update-changelog/
│   └── SKILL.md
├── sync-merged-pr-issues/
│   └── SKILL.md
└── skill-creator/
    ├── SKILL.md
    ├── references/
    │   ├── output-patterns.md
    │   └── workflows.md
    └── scripts/
        ├── init_skill.py
        ├── package_skill.py
        └── quick_validate.py
```

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

## Installation

### Using the Install Script

Run the script to set up both Claude and Codex skills folders at once:

```bash
yarn install-skills
```

You should see emoji info messages like:

```
ℹ️  Linking .codex/skills → ../.ai/skills
✅  Linked .codex/skills
ℹ️  Linking .claude/skills → ../.ai/skills
✅  Linked .claude/skills
🎉  Skills installation complete.
```

### Claude Code

Symlink the skills folder:

```bash
mkdir -p .claude
ln -s ../.ai/skills .claude/skills
```

Or configure in `.claude/settings.json`:

```json
{
  "skills": {
    "directory": ".ai/skills"
  }
}
```

### Codex

Symlink the skills folder:

```bash
mkdir -p .codex
ln -s ../.ai/skills .codex/skills
```

### Verify

```bash
# Claude Code
claude
> /skills
# Should list backend-ui-design, create-agents-md, integration-tests

# Codex
codex
> /skills
# Should list backend-ui-design, create-agents-md, integration-tests
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

| Skill | When to use |
|-------|-------------|
| `backend-ui-design` | Building admin pages, CRUD interfaces, data tables, forms, or detail pages with @open-mercato/ui |
| `check-and-commit` | Running CI-style verification, fixing i18n drift, and only then committing and pushing the current branch |
| `code-review` | Reviewing PRs, code changes, or auditing code quality against project conventions |
| `auto-continue-pr` | Resuming an in-progress PR that was started by `auto-create-pr`: claims the PR, checks its branch out into an isolated worktree, reads the Progress checklist in the linked spec, and continues execution from the first unchecked step |
| `create-agents-md` | Creating or rewriting AGENTS.md files for packages and modules |
| `auto-create-pr` | Running an arbitrary autonomous task end-to-end and delivering it as a PR against `develop`: drafts a dated spec with a Progress checklist, commits it first, implements phase-by-phase with incremental commits, optionally honors external reference skills passed by URL, runs the full validation gate, and opens a PR with normalized pipeline labels |
| `auto-qa-scenarios` | Generating a human QA report for a window of merged PRs (date floor, PR number floor, or last 7 days default): groups work into practical testing routes (P0/P1/P2), calls out where to click, what to verify, and what can go wrong, then ships markdown + HTML artifacts under `.ai/analysis/` as a docs-only PR against `develop` |
| `auto-sec-report-pr` | Paranoid single-unit OWASP security analysis for one PR, one branch, or one spec file: layers deep attack vectors (TOCTOU, cache-key cross-tenant leakage, JWT alg confusion, SSRF redirect chains, ReDoS, webhook replay, prototype pollution, etc.) on top of the `code-review` baseline, cites apply-elsewhere candidates, and emits concrete "Next steps — go deeper" follow-up commands so a reviewer (or `auto-sec-report`) can keep drilling |
| `auto-sec-report` | Driver that loops `auto-sec-report-pr` across a window (date, PR number floor, branch, spec, or default last 7 days of merged PRs), aggregates per-unit fragments into one markdown + HTML report under `.ai/analysis/`, consolidates every "Next steps — go deeper" into one prioritized drill-deeper list, and ships it as a docs-only PR against `develop` |
| `ds-guardian` | Design system enforcement: analyzing modules for DS violations, migrating hardcoded colors/typography to semantic tokens, scaffolding DS-compliant pages, reviewing code against DS principles, and reporting health metrics |
| `auto-fix-github` | Fixing a GitHub issue by number: first checks whether the issue is already solved or already has an open solution, then uses an isolated worktree to implement the minimal fix, add regression tests, run review and compatibility checks, and open a PR linked to the original issue |
| `fix-specs` | Normalizing legacy spec filenames to `{YYYY-MM-DD}-{slug}.md`, resolving post-normalization collisions, and updating references/links |
| `implement-spec` | Implementing a spec (or specific phases) using coordinated subagents with unit tests, integration tests, docs, progress tracking, and code-review compliance gates. Asks whether to build as an external extension (UMES) or core modification |
| `integration-tests` | Running existing integration tests and generating new QA tests (Playwright TypeScript, with optional markdown scenarios) from specs or feature descriptions |
| `pre-implement-spec` | Analyzing a spec before implementation: backward compatibility audit, risk assessment, gap analysis, and readiness report |
| `auto-review-pr` | Reviewing or re-reviewing a GitHub PR by number in an isolated worktree: fetches the exact PR from GitHub, runs the full code-review skill, submits a GitHub review, and in autofix mode iterates through conflict resolution, fixes, unit tests, typecheck, and re-review until the branch is merge-ready or a real blocker remains |
| `auto-update-changelog` | Drafting a new CHANGELOG.md release entry in the house emoji-driven format (✨ Features / 🔒 Security / 🐛 Fixes / 🛠️ Improvements / 🧪 Testing / 📝 Specs & Documentation / 🚀 CI/CD) for every PR merged since the last release and delegating the edit to `auto-create-pr` so it lands as a docs PR against `develop`; honors the Supersede Credit Rule so when `auto-review-pr` has carried a fork PR forward, the changelog credits the original contributor instead of the reviewer |
| `sync-merged-pr-issues` | Post-merge housekeeping: walking recently merged and recently closed-unmerged PRs, auto-closing the open issues they authoritatively fix (via `fixes`/`closes`/`resolves` close-keywords or GitHub's own `closingIssuesReferences`), and leaving informational comments on issues whose PRs were closed without merging (with supersede detection); uses the same claim/release protocol as `auto-fix-github` |
| `skill-creator` | Creating a new skill or updating an existing skill |

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

**Skill not found**: Verify symlink exists (`ls -la .claude/skills` or `ls -la .codex/skills`) and `SKILL.md` has valid YAML frontmatter.

**Skill not auto-selected**: Improve `description` with more specific trigger words and domain terminology.

**Symlink issues**:
```bash
# Recreate symlinks
rm -f .claude/skills .codex/skills
mkdir -p .claude .codex
ln -s ../.ai/skills .claude/skills
ln -s .ai/skills .codex/skills
```
