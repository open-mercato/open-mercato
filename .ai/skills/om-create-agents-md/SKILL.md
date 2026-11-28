> **Repo-local override.** Supplies this monorepo's AGENTS.md house template to the base `om-create-agents-md` skill — boundary-label authority, the instruction byte budget (`yarn agents:check-budget`), the root Task Router row shape, package/module file locations, sizing, and reference examples.

## Step 2 — resolve the template (replace)

This repo has no `.ai/agents-md-template.md` and no `agentsMd.template` config: use the subsections below as the repo template (the base `references/template-contract.md` aspects they name) and report "template: repo-local override" in the handover.

### Authority and required headings

- Boundary labels and the instruction budget are defined in `.ai/docs/agent-instructions.md`, linked from root `AGENTS.md` → `## Boundary Labels for Agent Rules`; when this file and that doc disagree, the doc wins. Lesson records (`.ai/lessons/*.md`) carry evidence; hard safety and workflow boundaries belong in the closest `AGENTS.md`.
- `## Always`, `## Ask First`, `## Never`, `## Validation Commands` — exactly once each, in that order, in every file (root, package, module).
- Legacy headings `## MUST Rules`, `## Critical Rules`, `## Key Rules`, and `MANDATORY:` H2s predate the boundary convention (PR #2082). List inbound links to old anchors (`#must-rules`, `#critical-rules`, …) and update them only with the user's agreement.

### Sizing — the instruction byte budget

Agents load `AGENTS.md` root-first down to the working directory and silently drop everything past their project-instruction budget (Codex `project_doc_max_bytes`, 32,768 bytes). Limits live in `scripts/agents-md-budget.baseline.json`, enforced in CI by `yarn agents:check-budget` (`scripts/check-agents-md-budget.mjs`):

- **Root `AGENTS.md`** stays under `rootMaxBytes` (bytes, not lines). Check the headroom before adding a Task Router row or rule; when it does not fit, move long-form procedure into `.ai/docs/*` and link it.
- **Chain ratchet** — for each baseline chain (`packages/ai-assistant`, `packages/core`, `packages/core/src/modules/sales`, `packages/ui` today) already over the budget, the nested files may only shrink. A tone rewrite of a very large file (e.g. `packages/ai-assistant/AGENTS.md`) keeps all technical content but MUST NOT grow those bytes — move procedure, option tables, and worked examples into a referenced doc (`.ai/docs/*`, `apps/docs/**`, a spec).
- Line tiers still set the per-section minimums. Size targets: small package 40–80 lines (`cache`, `content`, `queue`, `events`), medium module 60–100 (`catalog`, `sales`, `customers`, `onboarding`), large package 80–150 (`shared`, `create-app`, `.ai/specs`); a very large file under a tone rewrite keeps its length.
- Re-recording the baseline (`yarn agents:check-budget --update-baseline`) is an Ask First decision: only with the user's agreement, explained in the PR.

### Validation commands, checklists, house rules

- Scoped files prefer `yarn workspace @open-mercato/<package> test`, `yarn workspace @open-mercato/<package> build`, `yarn workspace @open-mercato/core test --testPathPattern=<module>`; add `yarn generate` + `yarn typecheck` where module files are generated. The root file's gate is `validation.commands` in `.ai/agentic.config.json`.
- Every checklist that adds module files includes the `yarn generate` step and ends with a verification step.
- Constraint examples use real Open Mercato contracts: `@open-mercato/cache` via DI instead of raw Redis, `selectBestPrice`, worker `metadata` `{ queue, id?, concurrency? }`, Quote → Order → Invoice. Code snippets only for contracts (worker metadata, `createModuleEvents`, subscriber export), 3–5 lines. Cross-reference format: ``- **{Topic}**: `packages/<pkg>/AGENTS.md` → {Section}``.

### Reference examples

Small: `packages/cache/AGENTS.md` (decision table, concrete `Validation Commands`), `packages/queue/AGENTS.md` (idempotency, worker contract). Medium: `packages/core/src/modules/sales/AGENTS.md` (data-model constraints, scope-tightening `Ask First`), `packages/core/src/modules/customers/AGENTS.md` (copy-from directive, module checklist). Large: `packages/search/AGENTS.md` (strategy guide, DI tokens), `packages/ai-assistant/AGENTS.md` (`AskUserQuestion` confirmation boundary under `Ask First`).

## Step 6 — verify (add)

After writing any `AGENTS.md`, run `yarn agents:check-budget` and include its result in the handover's verification line.

## Step 8 — route it (add)

- File locations: root `AGENTS.md`; `packages/<pkg>/AGENTS.md`; `packages/core/src/modules/<module>/AGENTS.md`; `packages/ui/src/backend/AGENTS.md`; `.ai/specs/AGENTS.md`; plus subtrees that already carry one (`find . -name AGENTS.md -not -path '*/node_modules/*'`).
- The root Task Router (`## Task Router — Where to Find Detailed Guidance`) is a two-column `| Task | Guide |` table grouped by bold section rows (`| **Module Development** | |`). Write the Task cell as search keywords (function names, patterns, task verbs) and the Guide cell in router shorthand: `<pkg>` = `packages/<pkg>/AGENTS.md`, `core:<module>` = `packages/core/src/modules/<module>/AGENTS.md`, `ui:backend` = `packages/ui/src/backend/AGENTS.md`, `→ Section` for the heading, full links for `.ai/docs/*`. Add the row under the matching group; do not add columns.
