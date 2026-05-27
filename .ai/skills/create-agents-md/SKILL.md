---
name: create-agents-md
description: Create or rewrite AGENTS.md files for Open Mercato packages and modules. Use this skill when adding a new package, creating a new module, or when an existing AGENTS.md needs to be created or refactored. Ensures prescriptive tone, the Always/Ask First/Never/Validation Commands boundary structure, MUST-style rules, checklists, and consistent structure across all agent guidelines.
---

Create prescriptive, action-oriented AGENTS.md files that tell agents **what to DO**, **what to ASK ABOUT**, **what NEVER to do**, and **how to VALIDATE** their work. Never write descriptive documentation — write instructions.

> Authoritative source for the boundary convention: root `AGENTS.md` → `## Boundary Labels for Agent Rules`. This skill follows that convention.

## Core Philosophy

AGENTS.md files are **not documentation**. They are **instruction sets for coding agents**. Every sentence should either:
- Tell the agent what to do ("Use X when...")
- Constrain the agent's behavior ("MUST NOT...")
- Give a step-by-step procedure ("1. Create... 2. Add... 3. Run...")

## Boundary Section Convention

Every AGENTS.md MUST use these four top-level boundary sections, in this order, with these exact headings:

| Section | What goes in it |
|---------|-----------------|
| `## Always` | Required defaults, MUST/MUST NOT rules, and commands agents apply without asking. The bulk of constraint content lives here. |
| `## Ask First` | Decisions that need maintainer input before changing behavior, scope, dependencies, branch/deploy flow, or contract surfaces. |
| `## Never` | Prohibited actions and unsafe shortcuts. Phrased as "Never …" bullets (the section name does the rule-tagging). |
| `## Validation Commands` | Short, real commands an agent can run to prove the relevant code path (lint/build/typecheck/test/grep). |

These four headings are required. Additional sections (decision tables, checklists, structure tree, cross-references, etc.) live **alongside** them, never instead of them.

## File Structure Template

Every AGENTS.md follows this structure. Adapt sections based on file size (small: 40-80 lines, medium: 80-150 lines, large: 150+ lines).

```markdown
# {Name} — Agent Guidelines

{One-line imperative directive: "Use X for Y." or "Use the Z module for A, B, and C."}

## {Optional decision/selection table — e.g. "Strategy Selection", "When to Use"}

{Table with "When to use" / "Configuration" columns}

## Always

1. **MUST ...** — {consequence or rationale}
2. **MUST NOT ...** — {what to do instead}
3. **MUST ...** — {consequence or rationale}

## Ask First

- Ask before {decision that needs maintainer input — scope, contract surface, dependency, infra}.
- Ask before {second decision class — typically destructive or cross-module}.

## Never

- Never {prohibited action — bypassing tenant scoping, skipping hooks, raw fetch, etc.}.
- Never {second prohibition}.

## Validation Commands

```bash
yarn workspace @open-mercato/{package} test
yarn workspace @open-mercato/{package} build
```

## {Primary Task Section — "When You Need X" or "Adding a New Y"}

{Numbered checklist or decision table}

## {Secondary Sections}

{Tables with "When to use" / "When to modify" columns}

## Structure

{Directory tree — keep brief}

## {Cross-References} (if applicable)

- **For X**: `path/to/AGENTS.md` → Section
```

## Prescriptive Tone Rules

### NEVER start a section with

- "The module provides..."
- "This package is..."
- "This document describes..."
- "X is a Y that..."

### ALWAYS start sections with

- Imperative verbs: "Use", "Add", "Create", "Configure", "Declare", "Follow", "Resolve"
- Conditional directives: "When you need X, do Y"
- Constraints: "MUST", "MUST NOT"

### Transform Patterns

| Descriptive (BAD) | Prescriptive (GOOD) |
|---|---|
| "The cache module provides multi-strategy caching" | "Use `@open-mercato/cache` for all caching needs. MUST NOT use raw Redis directly." |
| "Products are core entities with media" | "**Products** — core entities. MUST have at least a name" |
| "Events support local and async dispatch" | "When `QUEUE_STRATEGY=async`, persistent events dispatch through BullMQ" |
| "The pricing system uses layered overrides" | "Price layers compose in order: base → channel → customer → promotional" |
| Description column in tables | "When to use" or "When to modify" column |

## Boundary Section Requirements

The `Always`, `Ask First`, `Never`, and `Validation Commands` headings are mandatory in every AGENTS.md. The `Always` section is where MUST/MUST NOT rules live, and its minimum item count scales with file size:

| File size | Minimum `Always` items (MUST/MUST NOT rules) | `Ask First` items | `Never` items | `Validation Commands` |
|-----------|---------------------------------------------|-------------------|---------------|------------------------|
| Small (< 80 lines) | 3 | 1+ | 2+ | 1+ command |
| Medium (80–150 lines) | 5 | 2+ | 3+ | 2+ commands |
| Large (150+ lines) | 8+ | 2+ | 4+ | 2+ commands |

If a real prohibition only fits one of the boundaries, prefer the most restrictive: `Never` > `Ask First` > `Always`.

### Writing Effective `Always` Rules

Each `Always` rule follows this pattern: `**MUST [verb]** — [rationale or consequence]`

Good examples:
- `**MUST resolve via DI** — always use container.resolve('cacheService'), never instantiate directly`
- `**MUST NOT reimplement pricing logic** — use selectBestPrice and the resolver pipeline`
- `**MUST export metadata** with { queue, id?, concurrency? } from every worker file`
- `**MUST follow document flow**: Quote → Order → Invoice — no skipping steps`

Bad examples:
- `**MUST** follow best practices` (too vague)
- `**MUST** be careful with...` (not actionable)
- `**MUST** use the correct approach` (says nothing)

### Writing Effective `Ask First` Items

Phrase as `Ask before {scope-changing action}.` Each item names a concrete decision that a maintainer (human) should approve.

Good examples:
- `Ask before adding a new cache backend, changing default strategy selection, or caching data whose sensitivity is unclear.`
- `Ask before changing queue strategy defaults, retry semantics, or worker concurrency limits.`
- `Ask before applying database migrations locally with yarn db:migrate.`

Bad examples:
- `Ask if unsure` (uselessly generic — every rule could say that)
- `Ask before doing anything dangerous` (not actionable)

### Writing Effective `Never` Items

Phrase as `Never {prohibited action}.` Do NOT prefix with "MUST NOT" — the section heading already supplies that force.

Good examples:
- `Never expose cross-tenant data or skip tenant/organization scoping.`
- `Never use raw fetch in backend pages — always go through apiCall.`
- `Never edit generated files by hand.`

Bad examples:
- `Avoid X` (too soft for `Never`)
- `Try not to Y` (not a rule)

### Writing Effective `Validation Commands`

List the smallest set of real commands an agent can copy-paste to prove the relevant path. Prefer package-scoped commands over repo-wide ones for module/package AGENTS.md files.

Good examples:

```bash
yarn workspace @open-mercato/cache test
yarn workspace @open-mercato/cache build
```

```bash
yarn generate
yarn typecheck
yarn workspace @open-mercato/core test --testPathPattern=customers
```

Bad examples:
- `Run the tests` (not a command)
- `yarn test:everything --all-the-things` (invented or impractical)

## Table Column Conventions

### NEVER use these column headers
- "Description"
- "Purpose" (as standalone — use "Purpose / MUST rules" instead)
- "Details"

### ALWAYS use these column headers

| Context | Column headers to use |
|---------|----------------------|
| Feature/strategy tables | "When to use", "Configuration" |
| Directory listings | "When to modify" |
| Entity/data model | Constraint-framed bullets: "Entity — description. MUST [constraint]" |
| File reference tables | "When you need", "Copy from" |
| API/endpoint tables | "When to use", "MUST rules" |
| Environment variables | "When to configure" |
| DI tokens / imports | "When to use", "Import path" |

## Checklist Sections

Include numbered checklists for common tasks. Pattern: "Adding a New X" or "Checklist: Do Y"

```markdown
## Adding a New Worker

1. Create worker file in `src/modules/<module>/workers/<worker-name>.ts`
2. Export `metadata` with `{ queue: '<queue-name>', id: '<worker-id>', concurrency: <n> }`
3. Export default async handler function
4. Ensure handler is idempotent — check state before mutating
5. Run `yarn generate` to register the worker
6. Test with `QUEUE_STRATEGY=local` in development
```

Every checklist MUST:
- Use numbered steps (not bullets)
- Start each step with an imperative verb
- Include the `yarn generate` step when adding module files
- End with a testing/verification step

## Data Model Sections

Convert entity lists to constraint-framed bullets:

```markdown
## Data Model Constraints

- **Products** — core entities with media. MUST have at least a name
- **Categories** — hierarchical. MUST maintain parent-child integrity (no circular references)
- **Variants** — linked via `product_id`. MUST reference valid option schemas
- **Prices** — multi-tier with channel scoping. MUST use `selectBestPrice` for resolution
```

Pattern: `**Entity** — brief description. MUST [constraint]`

## Cross-Reference Rules

When two AGENTS.md files cover related topics:

1. **Pick one authoritative source** for each topic — never duplicate full content
2. **Use condensed quick-references** in the non-authoritative file
3. **Add a Cross-Reference section** at the bottom linking to related guides
4. **Keep the Task Router in root AGENTS.md** accurate with descriptive task names

Example:
```markdown
## Cross-Reference

- **Declaring events in a module**: `packages/core/AGENTS.md` → Events
- **Queue worker contract**: `packages/queue/AGENTS.md`
```

## File Size Guidelines

| Type | Target lines | Examples |
|------|-------------|---------|
| Small package | 40–80 | cache, content, queue, events |
| Medium module | 60–100 | catalog, sales, customers, onboarding |
| Large package | 80–150 | shared, create-app, specs |
| Very large (tone rewrite) | Keep original length | ai-assistant (~1100), search (~700) |

## Sizing Rules

- Keep small files focused — do not pad with unnecessary sections
- Large files: keep ALL technical content, only reframe tone
- Root AGENTS.md: MUST stay under 230 lines

## Code Examples in AGENTS.md

- Include code examples only for **contracts** (worker metadata, event declaration, subscriber export)
- Keep examples minimal — 3-5 lines max for inline snippets
- For full API examples, cross-reference the relevant module or spec
- MUST NOT include implementation details — only show the interface/pattern

## Verification Checklist

After writing an AGENTS.md, verify:

1. **Tone**: Every section starts with imperative verb or "When you need..."
2. **MUST audit**: File has required number of MUST rules (3+ small, 5+ medium, 8+ large)
3. **No descriptive openers**: No section starts with "The module provides..." or similar
4. **Tables**: All tables use "When to use" / "When to modify" columns, never "Description"
5. **Checklists**: Common tasks have numbered step-by-step procedures
6. **Data models**: Entity lists are constraint-framed with MUST rules
7. **Cross-references**: No duplicated content between files; clear pointers instead
8. **Structure section**: Directory tree is present and brief
9. **Opening line**: File starts with one-line imperative directive, not a description

## Anti-Patterns

1. **Explaining how things work** instead of telling agents what to do
2. **Listing features** instead of listing constraints
3. **Duplicating content** across multiple AGENTS.md files
4. **Writing paragraphs** where a checklist would be clearer
5. **Adding changelog sections** to small/medium files (only for large files with complex history)
6. **Over-documenting internals** — AGENTS.md guides usage, not implementation
7. **Missing the "when" framing** — every table/section should answer "when do I use this?"

## Reference Examples

Study these files as reference implementations:

| Size | File | Why it's good |
|------|------|---------------|
| Small | `packages/cache/AGENTS.md` | Clean structure, 5 MUST rules, decision table, checklist |
| Small | `packages/queue/AGENTS.md` | Concurrency guidelines table, idempotency rule, worker contract |
| Medium | `packages/core/src/modules/sales/AGENTS.md` | Data model constraints, document flow MUST rules, "MUST NOT modify directly" |
| Medium | `packages/core/src/modules/customers/AGENTS.md` | "Copy from here" directive, reference files table, module checklist |
| Large | `packages/search/AGENTS.md` | Strategy decision guide, dual checklists, DI token reference |
| Large | `packages/ai-assistant/AGENTS.md` | Common tasks up front, auth MUST rules, session debugging steps |

## When Updating Root AGENTS.md Task Router

After creating a new AGENTS.md, update the Task Router table in root `AGENTS.md`:
1. Add a row with descriptive task keywords (not just the package name)
2. Include specific function names, patterns, and task verbs an agent would search for
3. Keep the root file under 230 lines
