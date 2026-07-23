# Skills Catalog

> All `om-*` skills organized by tier. Load this file when answering "what skill should I use?" or "what comes next?".
>
> Note: many pipeline skills (code review, auto-create/review PR, merge buddy, spec writing, changelog, …) are installed from the shared [open-mercato/skills](https://github.com/open-mercato/skills) collection into `.agents/skills/` by `yarn install-skills` — see the `external` block in `.ai/skills/tiers.json`. Skill names below stay valid regardless of source; the external collection also adds `om-auto-fix-issue`, `om-setup-agent-pipeline`, and `om-auto-fix-pr` (CI stabilization via `--ci-only`).

## Table of Contents

- [core](#core)
- [automation](#automation)
- [security](#security)
- [migration](#migration)
- [infra](#infra)

---

## core

Default tier — installed by `yarn install-skills`.

| Skill | Trigger phrase / When to use | Preceded by | Followed by |
|-------|------------------------------|-------------|-------------|
| `om-help` | "what now?", "next steps?", "which skill?", "how do I X in OM?", orientation questions | — | any |
| `om-spec-writing` | New feature (3+ files), architectural change, new module | — | `om-pre-implement-spec` |
| `om-pre-implement-spec` | Before implementing a spec — BC audit, gap analysis, readiness report | `om-spec-writing` | `om-implement-spec` |
| `om-implement-spec` | Execute an existing spec phase by phase | `om-pre-implement-spec` | `om-code-review` |
| `om-code-review` | Review before merge — architecture, security, DS, conventions | `om-implement-spec` | `om-check-and-commit` |
| `om-check-and-commit` | Run CI-style checks (build, typecheck, i18n, tests) then commit + push | `om-code-review` | `om-auto-create-pr` |
| `om-smart-test` | "run affected tests", "test only what changed", fast test loop | any stage | — |
| `om-ds-guardian` | UI/design system change — migrate hardcoded colors, enforce DS tokens | — | `om-code-review` |
| `om-backend-ui-design` | Design admin pages, CRUD forms, data tables before implementing | — | `om-implement-spec` |
| `om-integration-tests` | Create or run Playwright integration tests after implementation | `om-implement-spec` | `om-code-review` |
| `om-fix-specs` | Normalize legacy `SPEC-*` filenames to date+slug convention | — | `om-implement-spec` |
| `om-create-agents-md` | Create or rewrite AGENTS.md for a new package or module | `om-implement-spec` | — |
| `om-skill-creator` | Create a new skill or update an existing one | — | — |
| `om-create-ai-agent` | Add AI agents (`ai-agents.ts`) or MCP tools (`ai-tools.ts`) to a module | `om-spec-writing` | `om-implement-spec` |
| `om-migrate-mikro-orm` | Migrate module code from MikroORM v6 → v7 (decorators, Knex→Kysely) | — | `om-smart-test` |

---

## automation

Opt-in: `yarn install-skills --with automation`

| Skill | Trigger phrase / When to use | Preceded by | Followed by |
|-------|------------------------------|-------------|-------------|
| `om-auto-create-pr` | "ship this as a PR", run task end-to-end and open a GitHub PR | `om-check-and-commit` | `om-auto-review-pr` |
| `om-auto-continue-pr` | Resume an in-progress PR started by `om-auto-create-pr` | — | `om-auto-review-pr` |
| `om-auto-create-pr-loop` | Long multi-step spec implementation with step-level resumability | — | `om-auto-review-pr` |
| `om-auto-continue-pr-loop` | Resume a PR started by `om-auto-create-pr-loop` | — | `om-auto-review-pr` |
| `om-auto-review-pr` | Automated PR review — runs `om-code-review`, sets labels | `om-auto-create-pr` | `om-merge-buddy` |
| `om-auto-fix-issue` | Fix a GitHub issue by number end-to-end | — | `om-auto-create-pr` |
| `om-prepare-issue` | Capture a feature to build later — write the spec, ship a docs-only spec PR, open a tracking issue | `om-spec-writing` | `om-implement-spec` |
| `om-verify-in-repo` | Verify a change works in the repo (build + smoke check) | `om-implement-spec` | — |
| `om-root-cause` | Analyze root cause of a bug before fixing | — | `om-fix` |
| `om-fix` | Fix a bug autonomously after root cause is known | `om-root-cause` | `om-smart-test` |
| `om-open-pr` | Open a GitHub PR from the current branch | `om-check-and-commit` | `om-auto-review-pr` |
| `om-review-prs` | Review all unreviewed open PRs in batch | — | — |
| `om-merge-buddy` | Classify PRs as merge-ready / close-but-blocked | `om-auto-review-pr` | `om-close-fixed-issues` |
| `om-close-fixed-issues` | Close linked issues after merge, comment on abandoned PRs | `om-merge-buddy` | `om-auto-update-changelog` |
| `om-auto-update-changelog` | Draft CHANGELOG.md release entry for merged PRs | after merge | — |
| `om-auto-qa-scenarios` | Generate human QA report (P0/P1/P2 routes) for merged PRs | `om-implement-spec` | — |

---

## security

Opt-in: `yarn install-skills --with security`

| Skill | Trigger phrase / When to use | Preceded by | Followed by |
|-------|------------------------------|-------------|-------------|
| `om-auto-sec-report` | Security audit over a window of merged PRs or specs | — | `om-auto-sec-report-pr` |
| `om-auto-sec-report-pr` | OWASP-focused security analysis for a single PR, spec, or branch | `om-auto-sec-report` | — |

---

## migration

Opt-in: `yarn install-skills --with migration` — install only when needed.

| Skill | Trigger phrase / When to use | Preceded by | Followed by |
|-------|------------------------------|-------------|-------------|
| `om-auto-upgrade-0.4.10-to-0.5.0` | Migrate downstream codebase from Open Mercato 0.4.10 → 0.5.0 | — | — |

---

## infra

Opt-in: `yarn install-skills --with infra` — rare / special-case.

| Skill | Trigger phrase / When to use | Preceded by | Followed by |
|-------|------------------------------|-------------|-------------|
| `om-dev-container-maintenance` | Any change to `.devcontainer/`, container build/start failures | — | — |
| `om-integration-builder` | Build a new integration provider package (payment, shipping, data-sync) | `om-spec-writing` | `om-implement-spec` |

---

## Notes

- **preceded-by / followed-by** are suggestions, not hard constraints. The appropriate next step depends on context.
- Skills with `—` in preceded-by can be entry points for their workflow type.
- `om-smart-test` is usable at any stage and is not sequenced.
- `om-help` itself is always the entry point when the developer is disoriented.
