# Mode 2: Knowledge — "How do I do X?"

**Triggers:** "how do I add X?", "how do I build Y?", "where does Z go?", "what import for W?", "how do I extend module Z?"

## Step 1 — Map question to the right skill

| Question topic | Load this skill's SKILL.md or references |
|---------------|------------------------------------------|
| Create a new module | `om-module-scaffold/SKILL.md` |
| Design entities, fields, migrations | `om-data-model-design/SKILL.md` |
| Extend existing module (columns, fields, API) | `om-system-extension/SKILL.md` + `references/extension-contracts.md` |
| Build admin pages, forms, data tables | `om-backend-ui-design/SKILL.md` + `references/ui-components.md` |
| Build an integration provider | `om-integration-builder/SKILL.md` |
| Write a spec | `om-spec-writing/SKILL.md` |
| Write integration tests | `om-integration-tests/SKILL.md` |
| Eject and customize core module | `om-eject-and-customize/SKILL.md` |
| Something is broken | `om-troubleshooter/SKILL.md` |
| Remove unused modules | `om-trim-unused-modules/SKILL.md` |
| Code review | `om-code-review/SKILL.md` + `references/review-checklist.md` |

## Step 2 — Load and read the target skill

Read the identified `SKILL.md` and any relevant `references/` files. Look for:
- Step-by-step instructions specific to the task
- File paths, commands, and code patterns
- MUST rules and anti-patterns to avoid

## Step 3 — Answer grounded in the skill

Provide a specific answer citing:
- The exact steps or patterns from the skill
- Relevant commands to run (e.g. `yarn generate`, `yarn db:generate`)
- Any MUST rules that apply

Do not answer from model training data alone — ground every claim in the loaded skill content.
