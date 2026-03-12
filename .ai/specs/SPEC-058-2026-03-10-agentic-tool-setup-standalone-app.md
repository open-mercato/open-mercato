# SPEC-058 — Agentic Tool Setup for Standalone Apps

**Date**: 2026-03-10
**Status**: Implemented
**Source Document**: [`agentic-setup-implementation-guide.md`](../../agentic-setup-implementation-guide.md) (Context B — Standalone App Developer)

---

## TLDR

- Add a **dedicated `packages/create-app/agentic/`** directory in the monorepo that holds all standalone-app-specific agentic content (AGENTS.md, CLAUDE.md, .ai/ structure, tool configs, hooks). This content is purpose-built for standalone apps — it is NOT a copy of the monorepo's `.ai/` folder.
- Implement a **generator system** in `packages/create-app/src/setup/` that reads from `agentic/` and produces tool-specific configuration files (Claude Code, Codex, Cursor) when scaffolding a new app.
- Add an **interactive wizard** to `create-mercato-app` that lets developers choose their AI coding tool(s).
- Add a **`yarn mercato agentic:init`** CLI command for existing apps that missed the wizard.
- The three supported tools are **Claude Code** (Anthropic), **Codex** (OpenAI), and **Cursor** (Anysphere) — the top 3 tools from the community survey.

---

## Problem Statement

### No agentic guidance for standalone app developers

Standalone app developers using AI coding tools get no framework-aware guidance out of the box. They must manually discover Open Mercato conventions — entity → migration lifecycle, `yarn generate` after module changes, never-edit-generated-files, extension-first architecture, module anatomy. The entity/migration lifecycle is the highest-risk scenario — forgetting a migration leads to runtime schema errors that are hard to diagnose.

### Each tool has a different enforcement model

1. **Claude Code** — `PostToolUse` hooks that can deterministically block agent progress. JSON on stdin, `{ "decision": "block" }` on stdout.
2. **Codex** — auto-loads `AGENTS.md` but has no hook system. Conventions enforced via prescriptive numbered rules only.
3. **Cursor** — `afterFileEdit` hooks (`.cursor/hooks.json`) that can block agent actions, plus `.cursor/rules/*.mdc` files with glob-scoped project rules. Hybrid enforcement.

### Monorepo `.ai/` folder is wrong for standalone apps

The monorepo's `.ai/` folder (295 files: 56+ specs, core skills like `code-review`, `implement-spec`, `pre-implement-spec`, integration test infrastructure) is designed for core contributors working on `packages/`. It references `packages/core/src/`, overlay contracts, backward compatibility surfaces, and changeset publishing — none of which apply to standalone app developers who work in `src/modules/` and consume `@open-mercato/*` from npm.

Copying or adapting the monorepo's `.ai/` into standalone apps would create:
- **Wrong paths**: Skills reference `packages/core/`, `packages/ui/` — paths that don't exist in standalone apps
- **Wrong mental model**: Core development assumes direct package modification; standalone development assumes extension via UMES
- **Maintenance burden**: Every core `.ai/` change would need a parallel standalone adaptation
- **Context window waste**: 295 files of irrelevant core context loaded into agent sessions

### The solution: purpose-built standalone content in a dedicated source directory

All standalone-specific agentic content is authored once in `packages/create-app/agentic/` and maintained alongside the scaffolder. The generators read from this directory and produce the right files in each new app. The content is written from the standalone developer's perspective — extension-first, `src/modules/` paths, framework consumption patterns.

---

## Tool Comparison Matrix

| Capability | Claude Code | Codex | Cursor |
|---|---|---|---|
| Config auto-loaded at session start | `CLAUDE.md` | `AGENTS.md` | `.cursor/rules/*.mdc` |
| Block agent on rule violation | Yes (`PostToolUse` → `decision: "block"`) | No | Yes (`afterFileEdit` non-zero exit) |
| Pre-tool interception | Yes (`PreToolUse`) | No | Yes (`beforeShellExecution`) |
| Post-edit hooks | Yes (`PostToolUse` on Write/Edit) | No | Yes (`afterFileEdit`) |
| Glob-scoped rules | No (single CLAUDE.md) | Yes (sub-dir AGENTS.md) | Yes (`.mdc` frontmatter `globs:`) |
| MCP server support | Yes (`.mcp.json`) | Yes (`mcp.json`) | Yes (`.cursor/mcp.json`) |
| Global user config | `~/.claude/settings.json` | `~/.openai/codex.yaml` | `~/.cursor/` |
| Enforcement model | Deterministic (hook-driven) | Instruction-only | Hybrid (hooks + rules) |

Two of three tools (Claude Code + Cursor) have deterministic hook enforcement for the entity/migration lifecycle. Only Codex relies on instruction-following.

---

## Proposed Solution

### Architecture Overview

```
MONOREPO (source of truth)                    SCAFFOLDED APP (output)
──────────────────────────                    ──────────────────────
packages/create-app/
├── agentic/                                  my-store/
│   ├── shared/                               ├── AGENTS.md
│   │   ├── AGENTS.md.template         ──→    ├── .ai/
│   │   └── ai/                               │   ├── specs/
│   │       ├── specs/README.md        ──→    │   │   ├── README.md
│   │       ├── specs/SPEC-template.md ──→    │   │   └── SPEC-000-template.md
│   │       └── lessons.md             ──→    │   └── lessons.md
│   ├── claude-code/                          ├── CLAUDE.md
│   │   ├── CLAUDE.md.template         ──→    ├── .claude/
│   │   ├── settings.json              ──→    │   ├── settings.json
│   │   ├── hooks/                            │   └── hooks/
│   │   │   └── entity-migration-check.ts ──→ │       └── entity-migration-check.ts
│   │   └── mcp.json.example           ──→    ├── .mcp.json.example
│   ├── codex/                                ├── .codex/
│   │   ├── enforcement-rules.md       ──→    │   └── mcp.json.example
│   │   └── mcp.json.example           ──→    (+ AGENTS.md patched with enforcement block)
│   └── cursor/                               ├── .cursor/
│       ├── rules/                            │   ├── rules/
│       │   ├── open-mercato.mdc       ──→    │   │   ├── open-mercato.mdc
│       │   ├── entity-guard.mdc       ──→    │   │   ├── entity-guard.mdc
│       │   └── generated-guard.mdc    ──→    │   │   └── generated-guard.mdc
│       ├── hooks.json                 ──→    │   ├── hooks.json
│       ├── hooks/                            │   ├── hooks/
│       │   └── entity-migration-check.mjs ──→│   │   └── entity-migration-check.mjs
│       └── mcp.json.example           ──→    │   └── mcp.json.example
│                                             ├── src/
└── src/                                      │   ├── modules/
    ├── index.ts  (modified)                  │   ├── modules.ts
    └── setup/                                │   └── ...
        ├── wizard.ts                         └── package.json
        └── tools/
            ├── shared.ts
            ├── claude-code.ts
            ├── codex.ts
            └── cursor.ts
```

### Why `packages/create-app/agentic/` and not `packages/create-app/template/.ai/`

The `template/` directory is copied as-is by `copyDirRecursive()`. This doesn't work for agentic setup because:

1. **Tool selection**: Only files for the selected tool(s) should be generated. The existing copy logic has no conditional branching.
2. **Placeholder substitution**: `.template` files support `{{APP_NAME}}` but `.mdc` frontmatter, `.json` configs, and `.ts` hooks need tool-specific processing.
3. **AGENTS.md patching**: Codex prepends enforcement rules to `AGENTS.md` — this requires read-modify-write, not copy.
4. **Separation of concerns**: Template files are the app boilerplate; agentic files are optional tool configs. Keeping them separate makes the wizard's skip option clean (no files to delete).

The `agentic/` directory is a **source content directory** — generators in `src/setup/tools/*.ts` read from it and write to the target app directory.

### Generator Pipeline

```
runAgenticSetup(targetDir, ask, options)
│
├── promptSelection(ask)          → ['claude-code', 'codex', 'cursor']
│
├── generateShared(config)        → AGENTS.md, .ai/ structure
│                                    (reads from agentic/shared/)
├── generateClaudeCode(config)    → CLAUDE.md, .claude/*, .mcp.json.example
│                                    (reads from agentic/claude-code/)
├── generateCodex(config)         → .codex/*, patches AGENTS.md
│                                    (reads from agentic/codex/)
├── generateCursor(config)        → .cursor/rules/*, hooks, mcp
│                                    (reads from agentic/cursor/)
│
└── printSummary(selectedIds)
```

**Critical ordering**: `generateShared()` must run before `generateCodex()` because Codex prepends enforcement rules to the `AGENTS.md` that `generateShared()` creates.

---

## Source Content Directory — `packages/create-app/agentic/`

### Complete file tree

```
packages/create-app/agentic/
├── shared/
│   ├── AGENTS.md.template              standalone app task router + conventions
│   └── ai/
│       ├── specs/
│       │   ├── README.md               business feature spec guidance
│       │   └── SPEC-000-template.md    spec template for app features
│       └── lessons.md                  empty file, populated by AI during dev
├── claude-code/
│   ├── CLAUDE.md.template              Claude Code instructions (references AGENTS.md)
│   ├── settings.json                   PostToolUse hook registration
│   ├── hooks/
│   │   └── entity-migration-check.ts   three-state entity guard (TypeScript, needs tsx)
│   └── mcp.json.example               MCP server template
├── codex/
│   ├── enforcement-rules.md            numbered rules prepended to AGENTS.md
│   └── mcp.json.example               MCP server template (Codex format)
└── cursor/
    ├── rules/
    │   ├── open-mercato.mdc            project rules (alwaysApply: true)
    │   ├── entity-guard.mdc            entity glob-scoped migration trigger
    │   └── generated-guard.mdc         generated files protection
    ├── hooks.json                      afterFileEdit hook registration
    ├── hooks/
    │   └── entity-migration-check.mjs  entity guard (plain ESM, no tsx dependency)
    └── mcp.json.example                MCP server template (Cursor format)
```

### Why this is NOT the monorepo's `.ai/` folder

| Aspect | Monorepo `.ai/` (295 files) | `agentic/shared/ai/` (~3 files) |
|--------|----------------------------|----------------------------------|
| Specs | 56+ specs about core architecture | Empty `specs/` with README + template for business features |
| Skills | `code-review`, `implement-spec`, `pre-implement-spec`, etc. | None — standalone apps use AGENTS.md + tool-specific rules |
| QA | Playwright tests, 80+ scenarios, helpers | None — standalone apps manage their own test infra |
| Lessons | Core contributor lessons | Empty file for app developer lessons |
| Path references | `packages/core/`, `packages/ui/` | `src/modules/`, `node_modules/@open-mercato/` |
| Audience | Core contributors | Standalone app developers |

---

## Generated Files — Complete Inventory

### Shared layer (generated for all tool selections)

| Output file | Source | Content |
|---|---|---|
| `AGENTS.md` | `agentic/shared/AGENTS.md.template` | Standalone app task router, module anatomy, key commands, extension-first conventions |
| `.ai/specs/README.md` | `agentic/shared/ai/specs/README.md` | Business feature spec guidance (not framework specs) |
| `.ai/specs/SPEC-000-template.md` | `agentic/shared/ai/specs/SPEC-000-template.md` | Spec template adapted for app-level features |
| `.ai/lessons.md` | `agentic/shared/ai/lessons.md` | Empty — populated during development by AI agents |

### Claude Code

| Output file | Source | Content |
|---|---|---|
| `CLAUDE.md` | `agentic/claude-code/CLAUDE.md.template` | App developer context — references AGENTS.md, stack, module anatomy, critical rules |
| `.claude/settings.json` | `agentic/claude-code/settings.json` | PostToolUse hook registration for entity-migration-check |
| `.claude/hooks/entity-migration-check.ts` | `agentic/claude-code/hooks/entity-migration-check.ts` | Entity edit → migration block (three-state logic, TypeScript) |
| `.mcp.json.example` | `agentic/claude-code/mcp.json.example` | MCP server template (`.mcp.json` gitignored) |

### Codex

| Output file | Source | Content |
|---|---|---|
| `.codex/mcp.json.example` | `agentic/codex/mcp.json.example` | MCP server template (Codex native path) |
| `AGENTS.md` (patched) | `agentic/codex/enforcement-rules.md` | Enforcement rules block prepended to AGENTS.md — numbered rules for entity/migration lifecycle |

### Cursor

| Output file | Source | Content |
|---|---|---|
| `.cursor/rules/open-mercato.mdc` | `agentic/cursor/rules/open-mercato.mdc` | Project rules (alwaysApply: true) — extension-first, module system, critical conventions |
| `.cursor/rules/entity-guard.mdc` | `agentic/cursor/rules/entity-guard.mdc` | Glob-scoped rule for `src/modules/*/entities/**` — triggers migration workflow |
| `.cursor/rules/generated-guard.mdc` | `agentic/cursor/rules/generated-guard.mdc` | Glob-scoped rule for `.mercato/generated/**` — "NEVER edit" guard |
| `.cursor/hooks.json` | `agentic/cursor/hooks.json` | `afterFileEdit` hook registration |
| `.cursor/hooks/entity-migration-check.mjs` | `agentic/cursor/hooks/entity-migration-check.mjs` | Entity guard (plain ESM JavaScript, no tsx dependency) |
| `.cursor/mcp.json.example` | `agentic/cursor/mcp.json.example` | MCP server template (`.cursor/mcp.json` gitignored) |

### File counts

| Selection | Shared | Tool-specific | Total |
|---|---|---|---|
| Skip | 0 | 0 | 0 |
| Claude Code only | 4 | 4 | **8** |
| Codex only | 4 | 1 (+AGENTS.md patch) | **5** |
| Cursor only | 4 | 6 | **10** |
| Claude Code + Codex | 4 | 5 | **9** |
| Claude Code + Cursor | 4 | 10 | **14** |
| All three | 4 | 11 | **15** |

---

## Source Content — Detailed Design

### `agentic/shared/AGENTS.md.template`

Replaces the existing minimal `packages/create-app/template/AGENTS.md`. The `{{PROJECT_NAME}}` placeholder is substituted during generation.

```markdown
# Agent Context Routing — {{PROJECT_NAME}}

Read this file before any task. Load ONLY the files listed for your task type.
Do NOT load the entire src/ tree — Open Mercato apps can have many modules.

## What this project is

A standalone Open Mercato application. You are building domain features ON TOP of
the Open Mercato framework — not modifying the framework itself.

The framework lives in node_modules/@open-mercato/*. To customise a built-in module
beyond what the extension system supports, eject it with `yarn mercato eject <module>`.
Never edit node_modules directly.

## Task → Context map

| Task | Load these files |
|---|---|
| Add a new custom module | `src/modules.ts`, one existing `src/modules/<id>/index.ts` as reference |
| Add/modify an entity | `src/modules/<id>/entities/`, `src/modules/<id>/migrations/` |
| Add a REST API endpoint | `src/modules/<id>/api/`, `src/modules/<id>/routes.ts` |
| Add a backend page | `src/modules/<id>/backend/`, `src/modules/<id>/routes.ts` |
| Register a DI service | `src/modules/<id>/di.ts` |
| Add an event subscriber | `src/modules/<id>/subscribers/`, `src/modules/<id>/index.ts` |
| Add a CLI command | `src/modules/<id>/cli/` |
| Add widget injection | `src/modules/<id>/widgets/injection/`, `src/modules/<id>/widgets/injection-table.ts` |
| Add a response enricher | `src/modules/<id>/data/enrichers.ts` |
| Add an API interceptor | `src/modules/<id>/api/interceptors.ts` |
| Eject a core module | Run `yarn mercato eject <module-id>` |
| Write a spec | `.ai/specs/README.md`, `.ai/specs/SPEC-000-template.md` |

## Critical conventions

- After any module or entity change: `yarn generate`
- After any entity edit: create migration with `yarn db:generate`
- NEVER edit `.mercato/generated/*` — auto-generated by `yarn generate`
- NEVER directly edit files in `node_modules/@open-mercato/*` — eject instead
- Custom modules: `from: '@app'` in `src/modules.ts`
- Confirm migrations with the user before running `yarn db:migrate`

## Module anatomy

Each module in `src/modules/<id>/` is self-contained:

| Directory/File | Purpose |
|---|---|
| `entities/` | MikroORM entity classes |
| `migrations/` | Per-module migration files |
| `api/` | REST handlers (auto-discovered by method + path) |
| `backend/` | Admin UI pages (auto-discovered) |
| `frontend/` | Public pages (auto-discovered) |
| `di.ts` | Awilix DI registrations |
| `acl.ts` | Feature-based permissions |
| `setup.ts` | Tenant initialization, role features |
| `events.ts` | Typed event declarations |
| `subscribers/` | Domain event handlers |
| `workers/` | Background job handlers |
| `widgets/injection/` | UI widgets injected into other modules |
| `widgets/components.ts` | Component replacement/wrapper definitions |
| `data/enrichers.ts` | Response enrichers for data federation |
| `api/interceptors.ts` | API route interception hooks |
| `cli/` | Module CLI commands |
| `search.ts` | Search indexing configuration |

Register in `src/modules.ts`: `{ id: '<id>', from: '@app' }`

## Key commands

| Command | Purpose |
|---|---|
| `yarn dev` | Start dev server |
| `yarn generate` | Regenerate `.mercato/generated/` |
| `yarn db:generate` | Create migration for entity changes |
| `yarn db:migrate` | Apply pending migrations |
| `yarn initialize` | Bootstrap DB + first admin account |
| `yarn build` | Build for production |
| `yarn mercato eject <module>` | Copy a core module into src/modules/ |

## Stack

Next.js App Router, TypeScript, MikroORM, Awilix DI, zod

## Platform references

- Module authoring: https://docs.openmercato.com/framework/modules/overview
- Entities & migrations: https://docs.openmercato.com/framework/database/entities
- DI container: https://docs.openmercato.com/framework/ioc/container
```

### `agentic/shared/ai/specs/README.md`

```markdown
# Feature Specs — {{PROJECT_NAME}}

Specs document business feature design decisions. Source of truth for what was built and why.

## What belongs here

- New domain features (inventory management, order flow, customer portal, etc.)
- Data model decisions (entity design, relationships, indexing strategy)
- API contract definitions for custom endpoints
- Integration design (external services, webhooks, import/export)

## What does NOT belong here

Framework-level decisions belong in the Open Mercato core repo. If you're unsure,
it's almost certainly an app-level decision.

## Naming convention

SPEC-{number}-{YYYY-MM-DD}-{slug}.md
Example: SPEC-001-2026-03-01-inventory-module.md

## Workflow

1. Before coding any significant feature, check for an existing spec
2. If none: create from SPEC-000-template.md, review with team, then code
3. After implementation: update the spec's Changelog and Acceptance Criteria
```

### `agentic/shared/ai/specs/SPEC-000-template.md`

```markdown
# SPEC-{number} — {Title}

**Date**: {YYYY-MM-DD}
**Status**: Draft

## TLDR

{2-3 sentence summary}

## Problem Statement

{What problem this feature solves}

## Proposed Solution

{High-level approach}

## Data Models

{Entity definitions, relationships}

## API Contracts

{Endpoints, request/response schemas}

## Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}

## Changelog

| Date | Change |
|------|--------|
| {date} | Initial spec |
```

### `agentic/claude-code/CLAUDE.md.template`

```markdown
# {{PROJECT_NAME}} — Claude Code Instructions

See AGENTS.md for task → context routing before starting any task.

## What this project is

A standalone Open Mercato application. You are building domain features ON TOP of
the Open Mercato framework — not modifying the framework itself.

The framework lives in node_modules/@open-mercato/*. To customise a built-in module,
eject it with `yarn mercato eject <module>` — never edit node_modules directly.

## Stack

- Next.js App Router, TypeScript, MikroORM, Awilix DI, zod
- Platform docs: https://docs.openmercato.com

## Critical rules

- NEVER edit `.mercato/generated/*`
- ALWAYS run `yarn generate` after any module or entity change
- ALWAYS confirm migrations with the user before running
- ALWAYS check `.ai/specs/` before implementing significant features
```

### `agentic/codex/enforcement-rules.md`

This block is prepended to `AGENTS.md` by the Codex generator. It compensates for Codex's lack of hooks with explicit, numbered rules.

```markdown
<!-- CODEX_ENFORCEMENT_RULES_START -->
## CRITICAL rules — always follow without exception

1. **After editing any entity file** (`src/modules/<id>/entities/*.ts`):
   - STOP immediately before any further action
   - Tell the user: "I modified an entity in module <id>. Should I create a migration?"
   - If yes: run `yarn db:generate`
   - Show the generated migration to the user before applying
   - Ask for confirmation, then run `yarn db:migrate`
   - Run `yarn generate` after migration is applied

2. **After editing `src/modules.ts`**: immediately run `yarn generate`

3. **Never edit `.mercato/generated/*`**: edit the source and run `yarn generate` instead

4. **Before significant features**: check `.ai/specs/` for an existing spec.
   If none exists, ask the user whether to create one first.

---
<!-- CODEX_ENFORCEMENT_RULES_END -->
```

The `<!-- CODEX_ENFORCEMENT_RULES_START/END -->` markers let the generator detect if rules were already prepended (idempotency).

### `agentic/cursor/rules/open-mercato.mdc`

```markdown
---
description: Core Open Mercato conventions for standalone app development
alwaysApply: true
---

# {{PROJECT_NAME}} — Project Rules

## What this project is

A standalone Open Mercato application. Build domain features ON TOP of the framework.
To customise a core module beyond the extension system: `yarn mercato eject <module>`.
Never edit node_modules/@open-mercato/* directly.

## Task routing

Read AGENTS.md before starting any task — it maps task types to the minimum files to load.

## Module system

Modules in `src/modules/<id>/`. Register with `from: '@app'` in `src/modules.ts`.
Run `yarn generate` after any module or entity change. Never edit `.mercato/generated/*`.

## Entity and migration rule

After editing any entity in `src/modules/<id>/entities/`:
1. Create migration: `yarn db:generate`
2. Show migration to user, confirm before applying
3. Apply: `yarn db:migrate`
4. Regenerate: `yarn generate`

## Spec-driven development

Check `.ai/specs/` before any significant feature. If no spec exists, ask the user
whether to create one first.
```

### `agentic/cursor/rules/entity-guard.mdc`

```markdown
---
description: Entity modification guard — triggers migration workflow
globs:
  - src/modules/*/entities/**/*.ts
alwaysApply: false
---

# Entity Modification — Migration Required

You are editing an entity file. After saving, you MUST:

1. **Create a migration** — ask the user before running:
   ```
   yarn db:generate
   ```

2. **Show the migration** to the user and wait for confirmation before applying

3. **Apply the migration** (only after user confirms):
   ```
   yarn db:migrate
   ```

4. **Regenerate registries**:
   ```
   yarn generate
   ```

Do NOT skip any step. Do NOT run migrations without user confirmation.
```

### `agentic/cursor/rules/generated-guard.mdc`

```markdown
---
description: Prevent editing auto-generated files
globs:
  - .mercato/generated/**
alwaysApply: false
---

# NEVER Edit Generated Files

This file is auto-generated by `yarn generate`. Any manual edits will be overwritten.

To change generated output, edit the source modules in `src/modules/` and run `yarn generate`.
```

### `agentic/cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": {
      "command": "node",
      "args": [".cursor/hooks/entity-migration-check.mjs"],
      "description": "Check if entity edit requires a database migration"
    }
  }
}
```

### MCP configs (all three tools)

All MCP examples use the same server definition, different file locations:

```json
{
  "mcpServers": {
    "open-mercato": {
      "command": "yarn",
      "args": ["mercato", "mcp:dev"],
      "env": {
        "APP_URL": "http://localhost:3000",
        "MCP_API_KEY": "${MCP_API_KEY}"
      }
    }
  }
}
```

Locations: `.mcp.json.example` (Claude Code), `.codex/mcp.json.example` (Codex), `.cursor/mcp.json.example` (Cursor). Active files (without `.example`) are gitignored.

---

## Entity Migration Check — Hook Design

Both Claude Code and Cursor implement the same detection logic, adapted to each tool's hook protocol.

### Three-state logic

```
file_path input
  │
  ├── matches migration pattern? → exit 0 (agent is already creating migration)
  ├── does NOT match entity pattern? → exit 0 (not relevant)
  └── matches entity pattern, no fresh migration in last 30s?
      → output warning + block
```

### Path patterns

```
ENTITY:    src/modules/*/entities/*.ts
MIGRATION: src/modules/*/migrations/*.ts
```

### Block output

```
Entity file(s) modified:
  src/modules/inventory/entities/inventory-item.entity.ts

Affected module(s): inventory

A database migration is likely needed. Ask the user whether to run:
  yarn db:generate

Then regenerate registries:
  yarn generate

Do NOT run migrations automatically — always confirm with the user first.
```

### Tool-specific adaptations

| Aspect | Claude Code | Cursor |
|--------|-------------|--------|
| Hook event | `PostToolUse` (Write/Edit matcher) | `afterFileEdit` |
| Input | JSON on stdin (`tool_input.file_path`) | File path via args/env |
| Block mechanism | stdout: `{ "decision": "block", "reason": "..." }` | Non-zero exit code + stderr |
| Script format | `.ts` (requires `tsx` in devDependencies) | `.mjs` (plain ESM Node.js, no extra deps) |
| Config file | `.claude/settings.json` | `.cursor/hooks.json` |

### `.claude/settings.json`

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx \"$CLAUDE_PROJECT_DIR/.claude/hooks/entity-migration-check.ts\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

---

## API Contracts

### Wizard function signature

```typescript
export interface AgenticSetupOptions {
  /** Skip wizard, use these tool IDs directly (comma-separated) */
  tool?: string;
  /** Overwrite existing files without per-file prompts */
  force?: boolean;
}

type AskFn = (question: string) => Promise<string>;

export async function runAgenticSetup(
  targetDir: string,
  ask: AskFn,
  options?: AgenticSetupOptions
): Promise<void>;
```

### CLI command

```bash
# Interactive
yarn mercato agentic:init

# Non-interactive
yarn mercato agentic:init --tool=claude-code
yarn mercato agentic:init --tool=claude-code,codex,cursor
yarn mercato agentic:init --tool=cursor --force
```

### Wizard UX

```
🤖  Agentic workflow setup

   Which AI coding tool will you use with this project?

   1. Claude Code     (Anthropic)
   2. Codex           (OpenAI)
   3. Cursor          (Anysphere)
   4. Multiple tools  (select individually)
   5. Skip — set up manually later

   Enter number(s) separated by comma [1]:
```

Rules: empty input → default `1`, single number → that tool, comma-separated `1,3` → Claude Code + Cursor, `4` → y/n for each individually, `5` → skip with reminder.

---

## Generator Code Layout

### `packages/create-app/src/setup/wizard.ts`

```typescript
const TOOLS = [
  { key: '1', label: 'Claude Code     (Anthropic)', id: 'claude-code'  },
  { key: '2', label: 'Codex           (OpenAI)',     id: 'codex'        },
  { key: '3', label: 'Cursor          (Anysphere)',  id: 'cursor'       },
  { key: '4', label: 'Multiple tools  (select individually)', id: 'multiple' },
  { key: '5', label: 'Skip — set up manually later',          id: 'skip'     },
] as const;

export async function runAgenticSetup(
  targetDir: string,
  ask: AskFn,
  options?: AgenticSetupOptions
): Promise<void> {
  const selectedIds = options?.tool
    ? options.tool.split(',').map(t => t.trim())
    : await promptSelection(ask);

  if (selectedIds.includes('skip')) { printSkipMessage(); return; }

  const config = { projectName: path.basename(targetDir), targetDir };

  // Order matters — codex.ts patches AGENTS.md created by shared.ts
  generateShared(config);
  if (selectedIds.includes('claude-code')) generateClaudeCode(config);
  if (selectedIds.includes('codex'))       generateCodex(config);
  if (selectedIds.includes('cursor'))      generateCursor(config);

  printSummary(selectedIds, targetDir);
}
```

### Generator responsibilities

| Generator | Creates | Modifies |
|---|---|---|
| `shared.ts` | `AGENTS.md`, `.ai/specs/README.md`, `.ai/specs/SPEC-000-template.md`, `.ai/lessons.md` | — |
| `claude-code.ts` | `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/entity-migration-check.ts`, `.mcp.json.example` | — |
| `codex.ts` | `.codex/mcp.json.example` | Prepends enforcement rules to `AGENTS.md` |
| `cursor.ts` | `.cursor/rules/open-mercato.mdc`, `.cursor/rules/entity-guard.mdc`, `.cursor/rules/generated-guard.mdc`, `.cursor/hooks.json`, `.cursor/hooks/entity-migration-check.mjs`, `.cursor/mcp.json.example` | — |

Each generator reads source files from `agentic/<tool>/`, applies `{{PROJECT_NAME}}` substitution where needed, and writes to `targetDir`.

---

## Integration Points

### `packages/create-app/src/index.ts` — modification

Add wizard call after template copy:

```typescript
import { runAgenticSetup } from './setup/wizard.js';

// ... existing copyDirRecursive(TEMPLATE_DIR, targetDir, placeholders) ...

console.log(pc.green('Success!') + ` Created ${pc.bold(appName)}`)
console.log('')

// Agentic setup wizard
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(res => rl.question(q, a => res(a.trim())));
await runAgenticSetup(targetDir, ask);
rl.close();

// ... existing next steps output ...
```

### `packages/create-app/template/AGENTS.md` — removal

The existing `template/AGENTS.md` (basic standalone instructions) will be **replaced** by the enhanced version generated by `shared.ts`. The old file should be removed from the template to avoid duplication. If the wizard is skipped, no `AGENTS.md` replacement is generated — the minimal existing one can remain as a fallback, or the template can ship without it and it only gets created via the wizard.

**Chosen approach**: Keep the existing minimal `template/AGENTS.md` as-is. When the wizard runs (non-skip), `shared.ts` overwrites it with the enhanced version. This way apps always have at least a basic `AGENTS.md` even if the wizard is skipped.

### `packages/create-app/template/CLAUDE.md` — unchanged

The existing `CLAUDE.md` (just `@AGENTS.md`) stays in the template as a minimal fallback. The Claude Code generator overwrites it with the enhanced version.

### `packages/create-app/template/gitignore` — additions

```gitignore
# Agentic tool secrets
.mcp.json
.codex/mcp.json
.cursor/mcp.json
.claude/settings.local.json
```

### `packages/cli/src/mercato.ts` — `agentic:init` command

```typescript
if (first === 'agentic:init') {
  const { runAgenticInit } = await import('./lib/agentic-init.js');
  await runAgenticInit(args.slice(1));
  process.exit(0);
}
```

### `packages/cli/src/lib/agentic-init.ts`

```typescript
export async function runAgenticInit(args: string[]): Promise<void> {
  const targetDir = process.cwd();

  if (!existsSync(join(targetDir, 'src', 'modules.ts'))) {
    console.error('Not an Open Mercato app directory (src/modules.ts not found)');
    process.exit(1);
  }

  const options = parseCliArgs(args); // --tool, --force
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(res => rl.question(q, a => res(a.trim())));

  await runAgenticSetup(targetDir, ask, options);
  rl.close();
}
```

**Code sharing**: The `runAgenticSetup` function and generators live in `packages/create-app/src/setup/`. The CLI package imports them. Both packages are in the same monorepo, so this is a workspace dependency.

---

## Idempotency Behavior

### Without `--force`

If any generated file already exists:
```
⚠️  Agentic files already exist. Run with --force to regenerate from current templates.
```

### With `--force`

Overwrite all files silently.

### In `create-mercato-app`

Always generates fresh (target directory is guaranteed to not exist).

### Codex AGENTS.md patch

The Codex generator detects `<!-- CODEX_ENFORCEMENT_RULES_START -->` marker. If present, it replaces the existing block. If absent, it prepends. This prevents duplication on re-run.

---

## Alternatives Considered

### 1. Copy/adapt the monorepo's `.ai/` folder into standalone apps

**Rejected**: The monorepo `.ai/` has 295 files designed for core contributors — wrong paths (`packages/core/`), wrong mental model (direct package modification), wrong skills (BC contracts, changeset publishing). Maintaining parallel adaptations creates sync burden. Purpose-built content in `agentic/` is simpler and correct by construction.

### 2. Always generate all three tool configs

**Rejected**: Adds clutter. The wizard lets developers choose, and `agentic:init` lets them add more later.

### 3. Put generators in `packages/cli/` only

**Rejected**: `create-mercato-app` runs standalone via `npx` without the CLI installed. Generators must live in `packages/create-app/` and be importable by `packages/cli/`.

### 4. Use `.template` files in the existing template directory

**Rejected**: Codex needs read-modify-write on AGENTS.md. Tool selection requires conditional generation. The existing `copyDirRecursive` has no branching logic.

### 5. Antigravity (Google) instead of Cursor

**Rejected**: Community survey showed top 3 tools are Claude Code, Codex, and Cursor. Cursor has hooks (`afterFileEdit`) + glob-scoped rules — stronger enforcement than Antigravity's instruction-only model. Two of three tools now have deterministic hook enforcement.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|------|----------|---------------|------------|---------------|
| Claude Code hook fails without `tsx` | High | Claude Code users | Add `tsx` to template `package.json` devDependencies. Cursor hook uses plain `.mjs` (no dep). | Low — tsx is already common |
| Cursor hooks API changes | Medium | Cursor users | Use stable v1 API only. Version field in hooks.json. | Low — v1 is established |
| `AGENTS.md` patch corruption | Medium | Codex users | Marker comments for idempotent prepend. Read-validate-write. | Low |
| `agentic/` content falls out of sync with framework | Medium | All users | `agentic:init --force` regenerates. Version tracking. Add sync reminder to root AGENTS.md. | Medium |
| Wizard blocks non-interactive CI/CD scaffolding | Medium | CI pipelines | `--tool=skip` or pipe empty input (defaults to Claude Code). Document in `--help`. | Low |
| `create-mercato-app` package size increase | Low | npm package | ~25KB of text files. Negligible. | None |

---

## Implementation Approach

### Phase 1 — Source Content + Generator Infrastructure + Claude Code

**Goal**: Create the `agentic/` source directory, implement the wizard and shared generator, and ship working Claude Code support.

1. Create `packages/create-app/agentic/shared/` directory with AGENTS.md.template, .ai/ structure
2. Create `packages/create-app/agentic/claude-code/` directory with CLAUDE.md.template, settings.json, hooks, mcp.json.example
3. Create `packages/create-app/src/setup/wizard.ts` — interactive selection + `runAgenticSetup` orchestrator
4. Create `packages/create-app/src/setup/tools/shared.ts` — reads from `agentic/shared/`, writes to targetDir
5. Create `packages/create-app/src/setup/tools/claude-code.ts` — reads from `agentic/claude-code/`, writes to targetDir
6. Write `entity-migration-check.ts` hook with three-state logic
7. Modify `packages/create-app/src/index.ts` — call `runAgenticSetup()` after template copy
8. Update `packages/create-app/template/gitignore` with agentic tool ignores
9. Update `packages/create-app/build.mjs` to include `agentic/` in dist output
10. Test in monorepo dev environment

**Files created/modified**:
- `packages/create-app/agentic/shared/*` (new, 4 files)
- `packages/create-app/agentic/claude-code/*` (new, 4 files)
- `packages/create-app/src/setup/wizard.ts` (new)
- `packages/create-app/src/setup/tools/shared.ts` (new)
- `packages/create-app/src/setup/tools/claude-code.ts` (new)
- `packages/create-app/src/index.ts` (modified)
- `packages/create-app/template/gitignore` (modified)
- `packages/create-app/build.mjs` (modified)

### Phase 2 — Codex + Cursor Generators

**Goal**: Complete multi-tool support.

11. Create `packages/create-app/agentic/codex/` directory with enforcement-rules.md, mcp.json.example
12. Create `packages/create-app/agentic/cursor/` directory with rules/*.mdc, hooks.json, hooks/*.mjs, mcp.json.example
13. Create `packages/create-app/src/setup/tools/codex.ts` — reads enforcement-rules.md, patches AGENTS.md
14. Create `packages/create-app/src/setup/tools/cursor.ts` — reads from `agentic/cursor/`, writes to targetDir
15. Write Cursor `entity-migration-check.mjs` hook (plain ESM, shares logic with Claude Code version)
16. Test all selection combinations (single tool, multiple tools, skip)

**Files created**:
- `packages/create-app/agentic/codex/*` (new, 2 files)
- `packages/create-app/agentic/cursor/*` (new, 6 files)
- `packages/create-app/src/setup/tools/codex.ts` (new)
- `packages/create-app/src/setup/tools/cursor.ts` (new)

### Phase 3 — CLI `agentic:init` Command

**Goal**: Existing apps can run `yarn mercato agentic:init`.

17. Create `packages/cli/src/lib/agentic-init.ts` — imports `runAgenticSetup` from create-app
18. Register `agentic:init` command in `packages/cli/src/mercato.ts`
19. Implement `--force` flag (overwrite) and `--tool` flag (non-interactive)
20. Implement idempotency detection (marker comments, file existence checks)
21. Test on existing standalone app scaffolded without agentic setup
22. Add `agentic:init` to `--help` output

**Files created/modified**:
- `packages/cli/src/lib/agentic-init.ts` (new)
- `packages/cli/src/mercato.ts` (modified)
- `packages/cli/package.json` (modified — add create-app as workspace dependency if needed)

### Phase 4 — Polish + Documentation

23. Add `tsx` to template `package.json.template` devDependencies (for Claude Code hook)
24. Update `packages/create-app/AGENTS.md` with agentic setup maintenance instructions
25. Add sync reminder to root `.ai/lessons.md` — "When changing module conventions, update `packages/create-app/agentic/`"
26. Final integration test via Verdaccio (full scaffolding + all tool combos)

---

## Testing in Dev Environment

### Approach 1 — Direct generator test (fastest feedback)

```bash
# 1. Build create-app
yarn workspace @open-mercato/create-app build

# 2. Create a test directory simulating a standalone app
mkdir -p /tmp/test-agentic/src/modules
echo 'export const modules = []' > /tmp/test-agentic/src/modules.ts

# 3. Write a quick test script
cat > /tmp/test-agentic-runner.ts << 'EOF'
import { runAgenticSetup } from './packages/create-app/dist/setup/wizard.js'
const mockAsk = async () => '1'  // Select Claude Code
await runAgenticSetup('/tmp/test-agentic', mockAsk)
EOF

npx tsx /tmp/test-agentic-runner.ts

# 4. Verify output
cat /tmp/test-agentic/AGENTS.md        # Enhanced routing table
cat /tmp/test-agentic/CLAUDE.md        # Claude Code instructions
cat /tmp/test-agentic/.claude/settings.json
ls /tmp/test-agentic/.claude/hooks/entity-migration-check.ts
cat /tmp/test-agentic/.mcp.json.example
ls /tmp/test-agentic/.ai/specs/
```

### Approach 2 — Full Verdaccio scaffolding (end-to-end)

```bash
# 1. Start Verdaccio
docker compose up -d verdaccio

# 2. Build and publish
yarn registry:publish

# 3. Scaffold with wizard
npx --registry http://localhost:4873 create-mercato-app@latest my-test-agentic
# → Wizard appears, select tools
cd my-test-agentic

# 4. Verify file tree
tree -a -I 'node_modules|.next|.mercato' --dirsfirst .

# 5. Tool-specific verification
# Claude Code: open in Claude Code, modify an entity → hook should block
# Codex: head -30 AGENTS.md → should show enforcement rules
# Cursor: cat .cursor/rules/entity-guard.mdc → should have globs
```

### Approach 3 — `agentic:init` on existing app

```bash
# 1. Scaffold without agentic (select 5 - Skip)
npx --registry http://localhost:4873 create-mercato-app@latest my-existing
cd my-existing

# 2. Run agentic:init
yarn mercato agentic:init                    # Interactive
yarn mercato agentic:init --tool=cursor      # Non-interactive
yarn mercato agentic:init --tool=cursor --force  # Overwrite

# 3. Verify + test idempotency
yarn mercato agentic:init --tool=cursor      # Should warn "already exists"
```

### Approach 4 — Unit tests

```
packages/create-app/src/setup/__tests__/
├── wizard.test.ts           selection parsing, default behavior, skip
├── shared.test.ts           AGENTS.md generation, .ai/ structure
├── claude-code.test.ts      CLAUDE.md, settings.json, hook content
├── codex.test.ts            AGENTS.md patch (prepend, idempotency, no duplication)
└── cursor.test.ts           .mdc files, hooks.json, hook script validity
```

Hook scripts can be tested by invoking them directly with mock input:
```bash
# Claude Code hook test (pipe mock PostToolUse JSON)
echo '{"tool_input":{"file_path":"src/modules/inv/entities/item.entity.ts"}}' | \
  npx tsx .claude/hooks/entity-migration-check.ts

# Cursor hook test (pass file path as arg)
node .cursor/hooks/entity-migration-check.mjs src/modules/inv/entities/item.entity.ts
```

### Verification checklist

- [ ] `packages/create-app/agentic/` directory exists with all source files
- [ ] `create-mercato-app my-app` → wizard appears after template copy
- [ ] Selecting "1" generates Claude Code + shared files only
- [ ] Selecting "2" generates Codex + shared files only
- [ ] Selecting "3" generates Cursor + shared files only
- [ ] Selecting "1,3" generates Claude Code + Cursor + shared files
- [ ] Selecting "4" → y/y/y generates all three tool configs + shared
- [ ] Selecting "5" generates zero agentic files; app still has minimal template AGENTS.md
- [ ] Generated `AGENTS.md` has task router table with all module operations
- [ ] Generated `CLAUDE.md` references AGENTS.md
- [ ] `.claude/hooks/entity-migration-check.ts` blocks on entity edit, passes on migration edit
- [ ] `.claude/settings.json` has PostToolUse hook config
- [ ] `.mcp.json.example` has correct MCP server config
- [ ] Codex `AGENTS.md` starts with enforcement rules block (marker comments present)
- [ ] Running Codex generator twice doesn't duplicate enforcement block
- [ ] `.cursor/rules/open-mercato.mdc` has `alwaysApply: true`
- [ ] `.cursor/rules/entity-guard.mdc` has globs for `src/modules/*/entities/**/*.ts`
- [ ] `.cursor/rules/generated-guard.mdc` has globs for `.mercato/generated/**`
- [ ] `.cursor/hooks.json` has `afterFileEdit` with correct script path
- [ ] `.cursor/hooks/entity-migration-check.mjs` is valid ESM (no tsx)
- [ ] Cursor hook exits non-zero for entity edits without recent migration
- [ ] `.cursor/mcp.json.example` has correct config
- [ ] `.ai/specs/README.md` has standalone-appropriate guidance (no monorepo references)
- [ ] `.ai/specs/SPEC-000-template.md` is a usable template
- [ ] `.ai/lessons.md` exists (empty)
- [ ] `yarn mercato agentic:init` works on app without agentic files
- [ ] `yarn mercato agentic:init --force` overwrites existing files
- [ ] `yarn mercato agentic:init` without `--force` warns about existing files
- [ ] Template `.gitignore` includes `.mcp.json`, `.codex/mcp.json`, `.cursor/mcp.json`, `.claude/settings.local.json`
- [ ] Zero references to `packages/core/`, `packages/ui/`, or monorepo paths in any generated file
- [ ] `agentic/` is included in create-app's build output (`dist/agentic/`)
- [ ] `{{PROJECT_NAME}}` placeholder is replaced in all generated files

---

## Success Metrics

1. **Zero-config agentic experience**: `create-mercato-app` → select tool → working AI agent config immediately.
2. **Entity/migration safety**: Hooks fire deterministically in Claude Code and Cursor. Prescriptive rules guide Codex. All three tools prevent forgotten migrations.
3. **Clean separation**: Standalone agentic content lives in `packages/create-app/agentic/` — never copied from monorepo `.ai/`. No monorepo paths leak into standalone apps.
4. **Retroactive adoption**: `yarn mercato agentic:init` adds agentic config to existing apps without re-scaffolding.

---

## Open Questions

1. **`tsx` for Claude Code hook**: The Claude Code entity hook is TypeScript requiring `tsx` at runtime. Should we also write it in plain `.mjs` (like Cursor's version) to avoid the dependency? Or is `tsx` acceptable since it's a devDependency?

2. **Code sharing between create-app and cli**: Should `cli` depend on `create-app` as a workspace dependency to import `runAgenticSetup`? Or duplicate the ~200 lines of generator code to avoid the circular-looking dependency?

3. **Build step for `agentic/`**: The `build.mjs` currently bundles `src/` with esbuild. The `agentic/` directory is static files that need to be copied to `dist/agentic/` — need a copy step in the build script.

4. **Cursor hooks API stability**: Cursor's hooks system (v1.7+) is relatively new. Should we add a fallback where the rules (`.mdc` files) contain the same migration instructions, so the app is still guided even if hooks don't fire?

5. **`AGENTS.md` overwrite on wizard run**: The wizard's shared generator overwrites the existing template `AGENTS.md`. If a developer has customized it and runs `agentic:init` later, their changes are lost. Should we merge instead of overwrite? Or just document the `--force` risk?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-10 | Initial spec. Self-contained — no dependency on SPEC-057. Standalone agentic content lives in `packages/create-app/agentic/` (purpose-built, not copied from monorepo `.ai/`). Tools: Claude Code, Codex, Cursor (community survey top 3). |
| 2026-03-10 | **Implementation complete** — all 4 phases delivered. Source content in `agentic/`, generators in `src/setup/tools/`, wizard in `src/setup/wizard.ts`, CLI `agentic:init` in `packages/cli/src/lib/agentic-init.ts`. Build verified (esbuild + agentic copy), typecheck clean, functional tests passed (all selection combos, hook enforcement, placeholder substitution, Codex idempotency, file counts 8/10/15). |
