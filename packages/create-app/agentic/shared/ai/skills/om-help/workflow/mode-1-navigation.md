# Mode 1: Navigation — "What do I do now?"

**Triggers:** "what now?", "next steps?", "where do I start?", "which skill?", "I'm lost"

## Step 1 — Read current context

```bash
git branch --show-current
git status --short
ls src/modules/ 2>/dev/null | head -20
gh pr list --author "@me" --state open --json number,title,labels 2>/dev/null || true
```

## Step 2 — Map to a workflow sequence

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

## Step 3 — Recommend

```
**Where you are:** <one sentence: branch, open PR or active work if any>

**Recommended next step:** `/om-<skill-name>`

**Why:** <one sentence explaining the match>

**After that:** `/om-<next-skill>` → `/om-<skill-after>`
```

If multiple paths are valid, present at most two options.
