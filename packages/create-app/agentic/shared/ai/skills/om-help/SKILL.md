---
name: om-help
description: >
  Open Mercato app navigator. Use when a developer asks: "what should I do now?",
  "which skill should I use?", "where do I start?", "next steps?", "I'm lost",
  "what comes after X?", "how do I create/add/build Y?", "how do I extend module Z?",
  "how do I fix this error?", "where does X go?", "what's the sequence for a new module / feature / integration?".
  Covers both orientation (navigation mode) and technical how-to (knowledge mode).
---

# om-help — App Navigator

Two modes: pick the one that matches the question.

---

## Mode 1: Navigation — "What do I do now?"

**Triggers:** "what now?", "next steps?", "where do I start?", "which skill?", "I'm lost"

### Step 1 — Read current context

```bash
git branch --show-current
git status --short
ls src/modules/ 2>/dev/null | head -20
gh pr list --author "@me" --state open --json number,title,labels 2>/dev/null || true
```

### Step 2 — Map to a workflow sequence

Read `references/workflow-sequences.md`. Match the context:

| Signal | Likely sequence |
|--------|-----------------|
| No module yet, task described | New Module |
| Module exists, adding new behavior | New Feature in Existing Module |
| Modifying a core OM module | Extend an Existing Module (UMES first) |
| Adding payment / shipping / sync | New Integration Provider |
| Error, broken build, missing widget | Fix a Bug / Something Is Broken |
| Code done, no PR | code-review → auto-create-pr |
| PR open, no review | auto-review-pr |
| Fresh scaffold with unused modules | Slim Down the App |
| Version bump needed | Upgrade Open Mercato |

### Step 3 — Recommend

```
**Where you are:** <one sentence: branch, open PR or active work if any>

**Recommended next step:** `/om-<skill-name>`

**Why:** <one sentence explaining the match>

**After that:** `/om-<next-skill>` → `/om-<skill-after>`
```

If multiple paths are valid, present at most two options.

---

## Mode 2: Knowledge — "How do I do X?"

**Triggers:** "how do I add X?", "how do I build Y?", "where does Z go?", "what import for W?", "how do I extend module Z?"

### Step 1 — Map question to the right skill

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

### Step 2 — Load and read the target skill

Read the identified `SKILL.md` and any relevant `references/` files. Look for:
- Step-by-step instructions specific to the task
- File paths, commands, and code patterns
- MUST rules and anti-patterns to avoid

### Step 3 — Answer grounded in the skill

Provide a specific answer citing:
- The exact steps or patterns from the skill
- Relevant commands to run (e.g. `yarn generate`, `yarn db:generate`)
- Any MUST rules that apply

Do not answer from model training data alone — ground every claim in the loaded skill content.

---

## References

- **Skill catalog** (all skills, categories, triggers, sequencing): `references/skills-catalog.md`
- **Workflow sequences** (named workflows with ordered skill lists): `references/workflow-sequences.md`

Load `references/skills-catalog.md` when the user asks which skill to use.  
Load `references/workflow-sequences.md` when the user asks about sequencing or "where to start".  
Load both when the user is fully disoriented.
