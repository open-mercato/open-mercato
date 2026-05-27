# om-help: Workflow Navigator Skill

## TLDR

**Key Points:**
- New skill `om-help` gives agents a navigation layer over the entire `om-*` skill ecosystem
- Two modes: **navigation** (what to do next) and **knowledge** (how to do X in OM)
- Grounded in `tiers.json`, skill frontmatter, and existing `AGENTS.md` guides — never hallucinated
- Added to the `core` tier; available by default

**Scope:** `.ai/skills/om-help/` + registration in `tiers.json` and `README.md`. No code, no migrations, no API changes.

**Concerns:** None — pure documentation/guidance artifact with no backward-compatibility surface.

---

## Problem Statement

The Open Mercato skill ecosystem has 34 skills across 5 tiers. Developers and agents frequently face three friction points:

1. **Entry confusion** — "Where do I start?" for a new feature, bugfix, or PR review. Skill names are self-describing but the _sequence_ is implicit knowledge not captured anywhere.
2. **Navigation gaps** — after completing one skill (e.g. `om-implement-spec`) the correct next step (`om-code-review` → `om-check-and-commit`) must be recalled from memory or re-read from AGENTS.md.
3. **Knowledge lookup cost** — questions like "how do I add search to a module?" require manually tracing the Task Router in the root `AGENTS.md` and then reading the target package's `AGENTS.md`. There is no single entry point.

`bmad-help` in the BMAD-METHOD framework solves an analogous problem for BMAD modules. `om-help` adapts that pattern for Open Mercato's skill + AGENTS.md structure.

---

## Proposed Solution

A new `core`-tier skill with two explicit operating modes:

### Navigation Mode
Triggered by orientation questions ("what now?", "next steps?", "where do I start?").

The skill:
1. Reads git state (`git status`, `git branch`)
2. Scans `.ai/specs/` for active specs
3. Optionally checks open PRs via `gh pr list`
4. Maps current state to a workflow sequence (from `references/workflow-sequences.md`)
5. Recommends the next skill + provides the exact invocation command

### Knowledge Mode
Triggered by how-to questions ("how do I add X?", "where does Y go?", "what import for Z?").

The skill:
1. Maps the question to a Task Router row from root `AGENTS.md`
2. Loads the relevant package/module `AGENTS.md`
3. Answers with specific imports, patterns, and MUST rules from that file — not from model training data

### Design Decisions

**Full answers over pointers**: The knowledge mode loads and cites the relevant AGENTS.md rather than just pointing to it. This costs context but eliminates the need for a follow-up read.

**References split**: `skills-catalog.md` and `workflow-sequences.md` are kept in `references/` and loaded on demand, not always in context. `SKILL.md` body stays under 200 lines.

**No CSV catalog**: Unlike BMAD's CSV, the catalog is a Markdown table in `references/skills-catalog.md` — readable, diffable, easy to update as new skills are added.

---

## File Manifest

```
.ai/skills/om-help/
├── SKILL.md
└── references/
    ├── skills-catalog.md
    └── workflow-sequences.md

.ai/skills/tiers.json          # add "om-help" to core.skills
.ai/skills/README.md           # add row to core table + bump tier count
.ai/specs/2026-05-27-om-help-skill.md   # this file
```

---

## Implementation Plan

### Phase 1 — Skill files (this PR)

**Step 1:** Create `references/skills-catalog.md`
- Table of all `om-*` skills: tier, trigger phrase, preceded-by, followed-by
- ToC at top (file > 100 lines)

**Step 2:** Create `references/workflow-sequences.md`
- Named workflow sequences: feature, bugfix, UI change, new module, PR lifecycle, security, MikroORM migration, integration builder, new skill
- Each sequence: ordered list of skills with one-line rationale per step

**Step 3:** Create `SKILL.md`
- Frontmatter: `name: help`, description covering both modes and trigger phrases
- Navigation Mode section: git/spec/PR inspection workflow, catalog lookup, recommendation format
- Knowledge Mode section: Task Router mapping, AGENTS.md loading, citation format
- References pointers for both catalog and sequences files

**Step 4:** Register in `tiers.json` — add `"om-help"` to `core.skills`

**Step 5:** Update `README.md` — add `om-help` row to core table, bump core skill count from 13→14

---

## Risks & Impact Review

| Scenario | Severity | Mitigation |
|----------|----------|------------|
| Skill catalog goes stale as new skills are added | Low | Single-source table in `references/skills-catalog.md`; PR adding new skill should also update the catalog |
| Navigation mode gives wrong next step | Low | Sequences are documented, not inferred; agent follows the table |
| Knowledge mode loads wrong AGENTS.md | Low | Task Router mapping is explicit in the skill body |
| Context budget bloat from loading references | Low | References are loaded on demand; SKILL.md body is lean (<200 lines) |

---

## Changelog

- **2026-05-27** — Initial spec. Author: Bernard van der Esch.
