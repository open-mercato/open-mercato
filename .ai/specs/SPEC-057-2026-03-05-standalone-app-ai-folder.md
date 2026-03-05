# SPEC-057 — Standalone App `.ai` Folder & AI-Driven Development Kit

**Date**: 2026-03-05
**Status**: Draft
**Related PR**: [#809](https://github.com/open-mercato/open-mercato/pull/809) (bundling `.ai/` into scaffolded apps)
**Related Issues**: [#805](https://github.com/open-mercato/open-mercato/issues/805), [#853](https://github.com/open-mercato/open-mercato/issues/853)

## TLDR

Design and implement a dedicated `.ai/` folder for standalone Open Mercato apps (scaffolded via `create-mercato-app`) with adapted skills, UMES reference documentation, and a comprehensive Task Router that guides AI agents to build custom features, extend core modules, and create integrations — all without modifying core packages.

## Problem Statement

PR #809 attempted to copy the monorepo's `.ai/` folder into scaffolded standalone apps. As identified in [andrzejewsky's review](https://github.com/open-mercato/open-mercato/pull/809#issuecomment-), this approach is fundamentally flawed:

1. **Wrong context**: The root `.ai/` is designed for monorepo contributors working on core packages. Standalone app developers work in a single Next.js project where `@open-mercato/*` packages are npm dependencies.
2. **Wrong paths**: Skills reference `packages/core/`, `packages/ui/`, etc. — paths that don't exist in standalone apps.
3. **Wrong mental model**: Core development assumes direct package modification. Standalone development assumes extension via UMES (events, injections, replacements, interceptors, enrichers, guards).
4. **Missing guidance**: No Task Router exists for common standalone app tasks (create a module, extend a core entity, add a custom integration, use UMES).
5. **Missing UMES reference**: The comprehensive UMES extension point documentation lives in core specs and AGENTS.md files inside `node_modules/` — inaccessible to AI agents by default.

## Proposed Solution

Create a purpose-built `.ai/` folder for the standalone app template with:

### 1. Adapted `AGENTS.md` (Template Root)

A comprehensive AGENTS.md tailored to standalone app development that includes:
- **Standalone-specific Task Router** mapping common tasks to guides
- **Extension-first architecture principles** (never modify `node_modules/`)
- **UMES extension decision tree** (which mechanism to use for each need)
- **Module development guide** adapted to `src/modules/` context
- **Key commands and workflow** for the standalone context

### 2. Adapted Skills (`.ai/skills/`)

| Skill | Adaptation Strategy |
|-------|-------------------|
| **code-review** | Keep with path adjustments (`src/modules/` instead of `packages/core/src/modules/`). Remove monorepo-specific checks (BC contract for core, cross-package build order). Add UMES compliance checks. |
| **spec-writing** | Adapt for standalone app scope. Simplify — no enterprise specs, no BC contract surfaces (those are core concerns). Focus on module design and UMES extension patterns. |
| **pre-implement-spec** | Simplify significantly. Remove 13-category BC audit (not applicable). Focus on: UMES extension point selection, core API compatibility, upgrade safety. |
| **implement-spec** | Adapt paths. Remove "Core Modification" mode — always extension mode. Simplify phase gates for standalone context. |
| **integration-tests** | Keep mostly as-is. Adjust paths (`src/modules/<module>/__integration__/`). Ensure helpers import correctly from `@open-mercato/core`. |
| **backend-ui-design** | Keep as-is — component library is the same regardless of context. |
| **create-agents-md** | Keep as-is — useful for documenting custom modules. |
| **fix-specs** | Keep as-is — spec numbering is universal. |
| **skill-creator** | Keep as-is — developers may want to create their own skills. |
| **dev-container-maintenance** | Remove — standalone apps have their own Docker setup. |

### 3. UMES Reference Documentation (`.ai/references/`)

A standalone-friendly reference extracted from UMES specs and core AGENTS.md:

| File | Content |
|------|---------|
| `umes-extension-points.md` | All 13 extension points with examples, file locations, auto-discovery rules |
| `umes-decision-tree.md` | "I want to..." decision tree mapping needs to extension mechanisms |
| `module-file-conventions.md` | Complete module file structure with auto-discovery paths |
| `core-api-reference.md` | Key imports, DI services, and framework APIs available to standalone apps |
| `example-patterns.md` | Curated patterns from the `example` module showing each extension point |

### 4. Standalone-Specific Specs Structure (`.ai/specs/`)

- Empty `specs/` directory with a simplified `AGENTS.md` (no enterprise separation, standalone naming convention)
- Pre-populated with UMES reference specs that document the extension contract standalone apps depend on

### 5. QA Structure (`.ai/qa/`)

- Simplified `AGENTS.md` for standalone integration testing
- Playwright config pointing to standalone app structure
- Helper imports from `@open-mercato/core` (npm package, not local)

## Architecture

### Directory Structure

```
<standalone-app>/
├── .ai/
│   ├── skills/
│   │   ├── code-review/
│   │   │   ├── SKILL.md                    # Adapted for standalone context
│   │   │   └── references/
│   │   │       └── review-checklist.md      # Standalone-specific checklist
│   │   ├── spec-writing/
│   │   │   ├── SKILL.md                    # Simplified for app-level specs
│   │   │   └── references/
│   │   │       ├── spec-checklist.md
│   │   │       └── spec-template.md
│   │   ├── implement-spec/
│   │   │   └── SKILL.md                    # Extension-mode only
│   │   ├── integration-tests/
│   │   │   └── SKILL.md                    # Adjusted paths
│   │   ├── backend-ui-design/
│   │   │   ├── SKILL.md                    # Kept as-is
│   │   │   └── references/
│   │   │       └── ui-components.md
│   │   ├── create-agents-md/
│   │   │   └── SKILL.md                    # Kept as-is
│   │   ├── fix-specs/
│   │   │   ├── SKILL.md
│   │   │   └── scripts/
│   │   │       └── fix_spec_conflicts.py
│   │   └── skill-creator/
│   │       ├── SKILL.md
│   │       └── references/
│   │           ├── workflows.md
│   │           └── output-patterns.md
│   ├── references/
│   │   ├── umes-extension-points.md        # All 13 UMES mechanisms
│   │   ├── umes-decision-tree.md           # "I want to..." guide
│   │   ├── module-file-conventions.md      # File structure & auto-discovery
│   │   ├── core-api-reference.md           # Framework imports & DI services
│   │   └── example-patterns.md             # Curated extension examples
│   ├── specs/
│   │   └── AGENTS.md                       # Simplified spec rules
│   ├── qa/
│   │   ├── AGENTS.md                       # Standalone testing guide
│   │   └── tests/
│   │       └── playwright.config.ts        # Pre-configured for standalone
│   └── lessons.md                          # Empty, populated during development
├── AGENTS.md                               # Comprehensive standalone Task Router
├── CLAUDE.md                               # Points to AGENTS.md
└── src/modules/                            # Custom modules go here
```

### Template AGENTS.md Design

The root `AGENTS.md` for standalone apps is the primary entry point. It must cover:

#### Task Router (Standalone Edition)

| Task | Guide |
|------|-------|
| **Module Development** | |
| Creating a new custom module | `AGENTS.md` → Module Development |
| Building CRUD API routes, OpenAPI specs | `AGENTS.md` → API Routes |
| Adding entities, migrations, validators | `AGENTS.md` → Data Layer |
| Building backend pages (admin UI) | `AGENTS.md` → Backend Pages + `.ai/skills/backend-ui-design/` |
| Building frontend pages | `AGENTS.md` → Frontend Pages |
| Adding RBAC features | `AGENTS.md` → Access Control |
| Adding module setup (tenant init) | `AGENTS.md` → Module Setup |
| Adding events, subscribers | `AGENTS.md` → Events |
| Adding notifications | `AGENTS.md` → Notifications |
| Adding CLI commands | `AGENTS.md` → CLI |
| Adding search indexing | `AGENTS.md` → Search |
| Adding i18n translations | `AGENTS.md` → Internationalization |
| **Extending Core Modules (UMES)** | |
| Adding UI widgets to core pages (columns, fields, tabs, sections) | `.ai/references/umes-extension-points.md` → Widget Injection |
| Adding menu items to sidebar/topbar | `.ai/references/umes-extension-points.md` → Menu Injection |
| Adding computed data to core API responses | `.ai/references/umes-extension-points.md` → Response Enrichers |
| Intercepting/modifying core API requests | `.ai/references/umes-extension-points.md` → API Interceptors |
| Replacing/wrapping core UI components | `.ai/references/umes-extension-points.md` → Component Replacement |
| Validating/blocking core entity mutations | `.ai/references/umes-extension-points.md` → Mutation Guards |
| Reacting to core entity lifecycle events | `.ai/references/umes-extension-points.md` → Event Subscribers |
| Intercepting core commands (execute/undo) | `.ai/references/umes-extension-points.md` → Command Interceptors |
| Extending core data models with custom data | `.ai/references/umes-extension-points.md` → Entity Extensions |
| Adding custom fields to core entities | `.ai/references/umes-extension-points.md` → Custom Fields |
| Adding real-time browser events | `.ai/references/umes-extension-points.md` → DOM Event Bridge |
| Choosing the right extension mechanism | `.ai/references/umes-decision-tree.md` |
| **Integrations** | |
| Building a third-party integration module | `AGENTS.md` → Integration Patterns |
| Adding webhook handlers | `AGENTS.md` → Webhooks |
| Adding background sync workers | `AGENTS.md` → Workers |
| Adding external API clients | `AGENTS.md` → External APIs |
| **Testing** | |
| Writing integration tests | `.ai/qa/AGENTS.md` + `.ai/skills/integration-tests/` |
| Running tests | `AGENTS.md` → Key Commands |
| **Spec & Planning** | |
| Writing a feature spec | `.ai/skills/spec-writing/` |
| Reviewing code changes | `.ai/skills/code-review/` |
| Implementing a spec | `.ai/skills/implement-spec/` |

#### Core Principles (Standalone Edition)

1. **Extension-first**: Never modify files in `node_modules/@open-mercato/`. Use UMES extension points to customize core behavior.
2. **Upgrade safety**: Custom modules must work across Open Mercato version upgrades. Avoid depending on internal APIs — use documented extension contracts.
3. **Module isolation**: Each module is self-contained. No direct entity imports between modules — use extension entities, enrichers, and events.
4. **Convention over configuration**: Follow file naming conventions for auto-discovery. Run `yarn generate` after adding module files.

#### Extension-First Architecture Section

```
I want to...                              → Use this mechanism

Add a column to Customers table           → Widget Injection (data-table column)
Add a field to Product edit form          → Widget Injection (crud-form field) + Enricher
Add a "Loyalty Points" badge to sidebar   → Widget Injection (status badge)
Show computed data on Order detail page   → Response Enricher
Block order creation if credit limit exceeded → API Interceptor (before hook)
Auto-assign priority when customer created → Sync Event Subscriber
Send Slack notification on new deal       → Async Event Subscriber
Add external system IDs to contacts       → Entity Extension
Replace the dashboard page entirely       → Component Replacement
Add a setup wizard for my integration     → Widget Injection (wizard)
Add background data sync                  → Worker
```

#### Key Differences from Core Development

| Aspect | Core (Monorepo) | Standalone App |
|--------|-----------------|----------------|
| Package source | Local workspace | npm dependencies in `node_modules/` |
| Module location | `packages/core/src/modules/` | `src/modules/` |
| Can modify core code | Yes | No — use UMES extensions |
| BC contract compliance | Required (13 categories) | Not applicable (consumer, not author) |
| Enterprise specs | Separate folder | Not applicable |
| Build command | `yarn build:packages && yarn build` | `yarn build` |
| Generated files | `.mercato/generated/` | `.mercato/generated/` |

### UMES Reference Documentation Design

#### `umes-extension-points.md`

Comprehensive reference covering all 13 extension mechanisms:

For each mechanism:
1. **What it does** (one sentence)
2. **File location** (`src/modules/<module>/<path>`)
3. **Auto-discovery**: how `yarn generate` picks it up
4. **TypeScript interface** (key fields only)
5. **Minimal working example** (copy-pasteable)
6. **Key rules** (3-5 MUST rules)
7. **Pipeline position** (when it runs relative to other mechanisms)

Extension points covered:
1. Widget Injection (reactive, headless columns/fields/actions/menus)
2. Widget Event Handlers (onBeforeSave, onFieldChange, transformers)
3. Response Enrichers
4. API Interceptors (before/after hooks)
5. Component Replacement (replace/wrapper/propsTransform)
6. Mutation Guards
7. Sync Event Subscribers (before-events)
8. Async Event Subscribers (after-events)
9. Command Interceptors
10. Entity Extensions
11. Custom Fields / Custom Entities
12. DOM Event Bridge (SSE to browser)
13. Notification Handlers (reactive client-side)

#### `umes-decision-tree.md`

The complete "I want to..." decision tree mapping developer intent to the correct extension mechanism. Includes:
- UI layer decisions
- Data layer decisions
- Behavior layer decisions
- The "triad pattern" (enricher + field widget + onSave) for adding editable fields to core forms

#### `module-file-conventions.md`

Complete file tree showing every auto-discovered file path with:
- Export requirements
- When each file is loaded
- Generator output it produces

#### `core-api-reference.md`

Essential imports for standalone app developers:
- UI components (`CrudForm`, `DataTable`, `apiCall`, etc.)
- Shared utilities (`useT`, `resolveTranslations`, `parseBooleanToken`, etc.)
- Type imports (`DataEngine`, `ApiInterceptor`, `ResponseEnricher`, etc.)
- DI services available via Awilix container
- Event system APIs

#### `example-patterns.md`

Curated, copy-pasteable examples extracted from the `example` module:
- Adding a column to the Customers table (enricher + column widget)
- Adding a field to a CrudForm (enricher + field widget + onSave)
- Intercepting an API route (block + transform)
- Subscribing to entity events (sync + async)
- Replacing a component (wrapper mode)
- Adding a sidebar menu item
- Creating a background worker

### Skills Adaptation Details

#### code-review (Standalone)

Changes:
- Remove BC contract surface checks (standalone apps don't define contracts)
- Replace `packages/core/` paths with `src/modules/`
- Add UMES compliance checks:
  - Enriched data uses `_<module>` namespace prefix
  - Enrichers implement `enrichMany` for list endpoints
  - API interceptors are fail-closed (timeout returns error)
  - Component replacements maintain original props schema
  - No direct imports from `node_modules/@open-mercato/*/dist/` internals
- Keep CI/CD verification gate (adapted commands: `yarn build`, `yarn generate`, `yarn typecheck`, `yarn test`, `yarn lint`)
- Remove cross-package build checks

#### spec-writing (Standalone)

Changes:
- Remove enterprise spec support
- Simplify spec template — no BC contract section
- Add "UMES Extension Strategy" section to template (which extension points will be used)
- Remove monorepo-specific compliance gates
- Keep core workflow: skeleton → questions → research → design → phases → review

#### implement-spec (Standalone)

Changes:
- Remove "Core Modification" mode — always extension mode
- Remove BC compliance gate
- Simplify pre-flight checks
- Keep: phase execution, unit tests, integration tests, self-review
- Add: UMES extension point verification (are correct mechanisms used?)

#### integration-tests (Standalone)

Changes:
- Adjust paths: tests live in `src/modules/<module>/__integration__/`
- Playwright config at `.ai/qa/tests/playwright.config.ts`
- Helpers imported from `@open-mercato/core` (npm package)
- Remove ephemeral environment commands (standalone apps run directly)
- Keep: self-contained tests, fixture creation/cleanup, Playwright best practices

### Sync Strategy: Keeping Template `.ai/` Updated

When the monorepo `.ai/` folder evolves, the standalone template must be updated. This requires:

1. **Manual sync trigger**: When a core skill or UMES extension point changes, a contributor updates the standalone template `.ai/` files.
2. **AGENTS.md instruction**: Add a rule to root `AGENTS.md` lessons: "When modifying `.ai/skills/` or UMES extension points, check if `packages/create-app/template/.ai/` needs corresponding updates."
3. **Version tagging**: Include a `version` field in `.ai/metadata.json` in the template so standalone apps can check if their `.ai/` folder is outdated.

### Build Integration

The `packages/create-app/build.mjs` must:
1. Copy `template/.ai/` directly into `dist/` (no transformation needed — these are standalone-specific files)
2. The scaffolding CLI (`src/index.ts`) already copies template contents — `.ai/` will be included automatically

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Template `.ai/` falls out of sync with core UMES changes | Medium | Add sync reminder to root AGENTS.md lessons. Include version tracking. |
| UMES reference docs become stale | Medium | Reference docs derived from specs; update when specs change. Add cross-reference to UMES spec changelog. |
| Skills bloat template size | Low | Skills are text files, minimal size impact (~50KB total). |
| AI agents confused by standalone vs monorepo context | High | Clear context markers in AGENTS.md. Explicit "you are in a standalone app" framing. Remove all monorepo-specific references. |
| Standalone developers try to modify `node_modules/` | Medium | Strong "NEVER modify node_modules" messaging in AGENTS.md and all skills. |

## Phasing

### Phase 1: Foundation (Core Deliverables)

1. **Template AGENTS.md rewrite** — Comprehensive standalone Task Router, extension-first principles, UMES decision tree
2. **UMES reference docs** — All 5 reference files in `.ai/references/`
3. **Adapted skills**: code-review, spec-writing, implement-spec, integration-tests
4. **Kept skills**: backend-ui-design, create-agents-md, fix-specs, skill-creator
5. **Removed skills**: dev-container-maintenance (not applicable)
6. **QA structure** — Simplified `AGENTS.md`, Playwright config
7. **Specs structure** — Simplified `AGENTS.md`
8. **Build integration** — Ensure `.ai/` is scaffolded correctly
9. **Metadata** — `.ai/metadata.json` with version tracking

### Phase 2: Enhancement

1. **Interactive examples** — Expand `example` module documentation with step-by-step tutorials
2. **Upgrade guide** — Document how to update `.ai/` folder when upgrading Open Mercato packages
3. **Custom skill templates** — Pre-built skill templates for common integration patterns
4. **AI tool integration** — UMES-aware MCP tools for the standalone AI assistant

## Implementation Plan

### Phase 1 Tasks

1. Create `packages/create-app/template/.ai/` directory structure
2. Write `.ai/references/umes-extension-points.md` — extract from UMES specs and core AGENTS.md
3. Write `.ai/references/umes-decision-tree.md` — the "I want to..." guide
4. Write `.ai/references/module-file-conventions.md` — auto-discovery paths
5. Write `.ai/references/core-api-reference.md` — essential imports
6. Write `.ai/references/example-patterns.md` — curated copy-pasteable examples
7. Adapt `code-review` skill for standalone context
8. Adapt `spec-writing` skill for standalone context
9. Adapt `implement-spec` skill for standalone context
10. Adapt `integration-tests` skill for standalone context
11. Copy unchanged skills: `backend-ui-design`, `create-agents-md`, `fix-specs`, `skill-creator`
12. Rewrite template `AGENTS.md` with standalone Task Router
13. Write `.ai/specs/AGENTS.md` (simplified)
14. Write `.ai/qa/AGENTS.md` (standalone testing)
15. Create `.ai/qa/tests/playwright.config.ts`
16. Create `.ai/metadata.json` with version
17. Create empty `.ai/lessons.md`
18. Update `packages/create-app/build.mjs` if needed for `.ai/` copying
19. Add sync reminder to root `.ai/lessons.md`
20. Test by scaffolding a new app and verifying AI agent behavior

## Integration Test Coverage

| Test | Path | What it verifies |
|------|------|------------------|
| Scaffolded app has `.ai/` folder | CLI scaffolding | `.ai/` directory exists with correct structure |
| Skills are present and parseable | CLI scaffolding | All skill SKILL.md files exist and have valid metadata |
| References are present | CLI scaffolding | All 5 reference files exist in `.ai/references/` |
| AGENTS.md has Task Router | Template validation | Task Router table exists with all required rows |
| No monorepo paths in template `.ai/` | Template validation | No references to `packages/core/`, `packages/ui/`, etc. |
| Playwright config works | Integration test | Can run `yarn test:integration` in scaffolded app |

## Changelog

| Date | Change |
|------|--------|
| 2026-03-05 | Initial spec created based on PR #809 review feedback |
