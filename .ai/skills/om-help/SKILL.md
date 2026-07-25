---
name: om-help
description: >
  Open Mercato workflow navigator. Use when a developer or agent asks: "what should I do now?",
  "which skill should I use?", "where do I start?", "next steps?", "I'm lost", "what comes after X?",
  "how do I add/create/build Y in Open Mercato?", "where does Z go?", "what's the order for a feature/bugfix/PR?",
  "how do I do X" (module, search, RBAC, events, commands, migrations, UI, AI agents, integrations).
  Covers both orientation (navigation mode) and technical how-to (knowledge mode).
---

# om-help — Open Mercato Navigator

Two modes: pick the one that matches the question.

---

## Mode 1: Navigation — "What do I do now?"

**Triggers:** "what now?", "next steps?", "where do I start?", "which skill?", "I'm lost"

### Step 1 — Read current context

Run these commands to understand where the developer is:

```bash
git branch --show-current
git status --short
ls .ai/specs/ 2>/dev/null | sort | tail -10
gh pr list --author "@me" --state open --json number,title,labels 2>/dev/null || true
```

### Step 2 — Map to a workflow sequence

Read `references/workflow-sequences.md`. Match the context:

| Signal | Likely sequence |
|--------|-----------------|
| No spec, no open PR, task described | New Feature or New Module |
| Spec exists in `.ai/specs/`, not implemented | pre-implement-spec → implement-spec |
| Spec exists, implementation in progress | implement-spec (continue from last phase) |
| Code changed, no PR | code-review → check-and-commit → auto-create-pr |
| PR open, no review | auto-review-pr |
| Bug report / error logs | root-cause → fix |
| UI files touched | ds-guardian → code-review |
| MikroORM errors | migrate-mikro-orm |

### Step 3 — Recommend

Output a recommendation in this format:

```
**Where you are:** <one sentence: branch, active spec or PR if any>

**Recommended next step:** `/om-<skill-name>`

**Why:** <one sentence explaining the match>

**After that:** `/om-<next-skill>` → `/om-<skill-after>`
```

If multiple paths are valid, present at most two options.

---

## Mode 2: Knowledge — "How do I do X in Open Mercato?"

**Triggers:** "how do I add X?", "how do I build Y?", "where does Z go?", "what import for W?"

### Step 1 — Map question to Task Router

Read the Task Router table in the root `AGENTS.md`. Find the row whose description best matches the question.

Common mappings (quick reference):

| Question topic | Task Router row / Guide |
|---------------|-------------------------|
| New module, scaffolding, auto-discovery | `packages/core/AGENTS.md` |
| CRUD routes, OpenAPI, `makeCrudRoute` | `packages/core/AGENTS.md` → API Routes |
| Events, subscribers, `createModuleEvents` | `packages/core/AGENTS.md` → Events |
| RBAC, ACL features, `acl.ts` | `packages/core/AGENTS.md` → Access Control |
| Custom fields, `cf.*`, `defineLink` | `packages/core/AGENTS.md` → Custom Fields |
| Search, `search.ts`, reindexing | `packages/search/AGENTS.md` |
| UI components, forms, `CrudForm`, `DataTable` | `packages/ui/AGENTS.md` |
| Backend pages, `apiCall`, `RowActions` | `packages/ui/src/backend/AGENTS.md` |
| i18n, `useT`, `resolveTranslations` | `packages/shared/AGENTS.md` |
| Cache, tag invalidation | `packages/cache/AGENTS.md` |
| Background workers, queues | `packages/queue/AGENTS.md` |
| Event bus, subscribers | `packages/events/AGENTS.md` |
| AI agents, MCP tools | `packages/ai-assistant/AGENTS.md` |
| Integration providers | `packages/core/src/modules/integrations/AGENTS.md` |
| Customer portal, portal auth | `packages/ui/AGENTS.md` → Portal Extension |
| Webhooks | `packages/webhooks/AGENTS.md` |
| Notifications | `packages/core/AGENTS.md` → Notifications |
| Widget injection, component replacement | `packages/core/AGENTS.md` → Widget Injection |
| Database migrations, `db:generate` | `packages/cli/AGENTS.md` |

### Step 2 — Load and read the target AGENTS.md

Read the identified `AGENTS.md` file. Look for:
- Import paths and package names
- MUST rules relevant to the question
- Code patterns, examples, file conventions

### Step 3 — Answer grounded in the file

Provide a specific answer citing:
- The exact import or file path
- The relevant MUST rule(s)
- A minimal code pattern or checklist

Do not answer from model training data alone — ground every claim in the loaded AGENTS.md.

---

## References

- **Skill catalog** (all om-* skills, tiers, triggers, sequencing): `references/skills-catalog.md`
- **Workflow sequences** (named workflows with ordered skill lists): `references/workflow-sequences.md`

Load `references/skills-catalog.md` when the user asks which skill to use.  
Load `references/workflow-sequences.md` when the user asks about sequencing or "where to start".  
Load both when the user is fully disoriented.
