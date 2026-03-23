# Decentralize Module Registry Generator

## TLDR
**Key Points:**
- The `module-registry.ts` generator is a ~1540-line monolith that produces 22+ generated files. Every new convention file type (messages, payments, inbox, guards, etc.) requires modifying this single function.
- Refactor into a plugin-based architecture where domain-specific generators are separate, composable units while the core module loop remains centralized.

**Scope:**
- Split `generateModuleRegistry()` into a core loop + pluggable "generator extensions"
- Each extension declares: convention file path, scan logic per module, output template, output file
- No changes to generated file content, convention file paths, or external contracts

**Concerns:**
- Some convention files are "dual purpose" — they produce a standalone generated file AND contribute fields to the `modules.generated.ts` Module declaration (events, analytics, translations). These need special handling.
- Import ID ordering must remain deterministic across plugins.

## Overview

The module registry generator (`packages/cli/src/lib/generators/module-registry.ts`) is the heart of Open Mercato's auto-discovery system. It iterates over all enabled modules, scans for convention files, and produces generated TypeScript files that wire everything together at build time.

Over time, the function has grown to handle 22+ output files. Every new module concern (messages, payments, inbox actions, guards, command interceptors) adds ~30-80 lines of boilerplate: new state arrays, a scan block inside the module loop, an output template, and a `writeGeneratedFile` call. This pattern is repetitive and makes the file hard to maintain.

## Problem Statement

1. **Monolithic growth**: Adding any new convention file type requires modifying a single 1540-line function. This is error-prone and creates merge conflicts.
2. **Repetitive patterns**: ~15 of the 22 generators follow an identical pattern (`processStandaloneConfig` → template → `writeGeneratedFile`), but each is hand-rolled inline.
3. **Difficult to test**: Individual generators cannot be tested in isolation.
4. **Cognitive load**: Contributors must read the entire function to understand where to add new concerns.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Plugin architecture for the generator, NOT for modules | Modules cannot "register" generators because the generator discovers modules (not the other way around). The plugin system lives in the CLI generator, not in module code. |
| Keep core module loop centralized | Pages, APIs, subscribers, workers, translations, CLI, setup, ACL, entities, extensions, and custom fields all contribute to the `Module` type declaration in `modules.generated.ts`. These must stay in the core loop. |
| Extract standalone generators as plugins | Convention files that produce their own `.generated.ts` file (search, notifications, messages, events, etc.) become separate plugin files. |
| Dual-purpose files get a hook | Events, analytics, and translatable fields produce standalone files AND contribute to the Module declaration. Plugins can optionally return data that the core loop injects into the Module declaration. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Module-contributed generators (modules declare their own generator logic) | Circular dependency — the generator discovers modules, so modules can't register generators at discovery time. Also a BC break since convention file scanning is a generator concern, not a module concern. |
| Code-generation from a schema/DSL | Over-engineering. The current pattern is well-understood; it just needs decomposition, not a new paradigm. |
| Leave as-is, just refactor inline | Doesn't solve the core problem of adding new concerns requiring edits to a monolith. |

## Architecture

### Generator Extension Interface

```typescript
// packages/cli/src/lib/generators/extension.ts
export interface GeneratorExtension {
  /** Unique ID for this extension */
  id: string

  /** Output file name (e.g., 'search.generated.ts') */
  outputFile: string

  /**
   * Called once per module during the scan loop.
   * Receives the module context and returns scan results to accumulate.
   */
  scanModule(ctx: ModuleScanContext): void

  /**
   * Generate the output file content after all modules have been scanned.
   */
  generateOutput(): string

  /**
   * Optional: return data to merge into the Module declaration
   * in modules.generated.ts (for dual-purpose convention files).
   */
  getModuleDeclContribution?(moduleId: string): string | null
}

export interface ModuleScanContext {
  moduleId: string
  roots: ModuleRoots
  imps: ModuleImports
  importIdRef: { value: number }
  // Helpers already available in the current code
  resolveModuleFile: typeof resolveModuleFile
  resolveFirstModuleFile: typeof resolveFirstModuleFile
  processStandaloneConfig: typeof processStandaloneConfig
}
```

### Plugin Classification

**Stay in core loop** (contribute to `modules.generated.ts` Module type):
- index.ts (metadata)
- frontend/backend pages
- API routes
- subscribers, workers
- CLI, translations (i18n)
- setup.ts, acl.ts, ce.ts
- data/fields.ts, data/extensions.ts
- integration.ts

**Become extensions** (produce standalone `.generated.ts` files):

| Convention file | Generated output | Dual-purpose? |
|----------------|-----------------|---------------|
| `search.ts` | `search.generated.ts` | No |
| `notifications.ts` | `notifications.generated.ts` | No |
| `notifications.client.ts` | `notifications.client.generated.ts` | No |
| `notifications.handlers.ts` | `notification-handlers.generated.ts` | No |
| `widgets/payments/client.tsx` | `payments.client.generated.ts` | No |
| `message-types.ts` | `message-types.generated.ts` | No |
| `message-objects.ts` | `message-objects.generated.ts` | No |
| (messages client) | `messages.client.generated.ts` | No |
| `ai-tools.ts` | `ai-tools.generated.ts` | No |
| `events.ts` | `events.generated.ts` | Yes (Module.events) |
| `analytics.ts` | `analytics.generated.ts` | Yes (Module.analytics) |
| `translations.ts` | `translations-fields.generated.ts` | Yes (Module.translatableFields) |
| `data/enrichers.ts` | `enrichers.generated.ts` | No |
| `api/interceptors.ts` | `interceptors.generated.ts` | No |
| `widgets/components.ts` | `component-overrides.generated.ts` | No |
| `inbox-actions.ts` | `inbox-actions.generated.ts` | No |
| `data/guards.ts` | `guards.generated.ts` | No |
| `commands/interceptors.ts` | `command-interceptors.generated.ts` | No |
| dashboard widgets | `dashboard-widgets.generated.ts` | No |
| injection widgets | `injection-widgets.generated.ts` | No |
| injection tables | `injection-tables.generated.ts` | No |

### Directory Structure

```
packages/cli/src/lib/generators/
├── module-registry.ts          # Core loop only (~400 lines)
├── extension.ts                # Extension interface + helpers
├── scanner.ts                  # Unchanged
├── extensions/
│   ├── search.ts
│   ├── notifications.ts        # notifications + client + handlers
│   ├── messages.ts             # message-types + objects + client
│   ├── payments-client.ts
│   ├── ai-tools.ts
│   ├── events.ts               # dual-purpose
│   ├── analytics.ts            # dual-purpose
│   ├── translatable-fields.ts  # dual-purpose
│   ├── enrichers.ts
│   ├── interceptors.ts         # API interceptors
│   ├── component-overrides.ts
│   ├── inbox-actions.ts
│   ├── guards.ts
│   ├── command-interceptors.ts
│   ├── dashboard-widgets.ts
│   └── injection-widgets.ts    # widgets + tables
```

### Core Loop After Refactoring

```typescript
export async function generateModuleRegistry(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const extensions = loadExtensions() // collect all extension instances

  for (const entry of enabled) {
    // ... core module processing (pages, APIs, subscribers, etc.) ...

    // Run all extensions for this module
    const ctx: ModuleScanContext = { moduleId: modId, roots, imps, importIdRef, ... }
    for (const ext of extensions) {
      ext.scanModule(ctx)
    }

    // Collect dual-purpose contributions for Module declaration
    const extensionContributions = extensions
      .map(ext => ext.getModuleDeclContribution?.(modId))
      .filter(Boolean)
      .join('\n      ')

    moduleDecls.push(`{ id: '${modId}', ... ${extensionContributions} }`)
  }

  // Write core output
  writeGeneratedFile({ outFile, content: output, ... })

  // Write all extension outputs
  for (const ext of extensions) {
    writeGeneratedFile({
      outFile: path.join(outputDir, ext.outputFile),
      content: ext.generateOutput(),
      ...
    })
  }
}
```

## Implementation Plan

### Phase 1: Extract Extension Interface + First Batch
1. Create `extension.ts` with the `GeneratorExtension` interface and `ModuleScanContext` type.
2. Create `extensions/` directory.
3. Extract the simplest standalone generators as the first batch: `search`, `ai-tools`, `enrichers`, `guards`, `command-interceptors`.
4. Wire them into the core loop via `loadExtensions()`.
5. Verify generated output is byte-identical.

### Phase 2: Extract Remaining Extensions
1. Extract `notifications` (server + client + handlers — 3 output files from one extension).
2. Extract `messages` (types + objects + client — 3 output files from one extension).
3. Extract `payments-client`, `inbox-actions`, `interceptors`, `component-overrides`.
4. Extract widget extensions: `dashboard-widgets`, `injection-widgets` (widgets + tables).

### Phase 3: Dual-Purpose Extensions
1. Extract `events`, `analytics`, `translatable-fields` with the `getModuleDeclContribution()` hook.
2. These are trickier because they push imports to both standalone and shared import arrays.

### Phase 4: UMES Conflict Detection
1. Extract the UMES conflict detection block into its own post-processing step that reads from extension results.

## Risks & Impact Review

#### Generated File Content Drift
- **Scenario**: Refactoring changes the import order or whitespace in generated files, causing unnecessary diffs.
- **Severity**: Medium
- **Affected area**: All 22+ generated files
- **Mitigation**: Compare output byte-for-byte before and after. The checksum mechanism already detects changes. Phase 1 should include a snapshot test.
- **Residual risk**: Low — deterministic import ID counter preserves ordering.

#### Import ID Ordering
- **Scenario**: Extensions run in different order, changing import variable names (e.g., `SEARCH_customers_42` becomes `SEARCH_customers_38`).
- **Severity**: Low (cosmetic, but makes diffing harder)
- **Affected area**: Generated import statements
- **Mitigation**: Extensions process in a fixed, deterministic order (array position). The shared `importIdRef` counter is passed through.
- **Residual risk**: Negligible.

#### Dual-Purpose Complexity
- **Scenario**: A dual-purpose extension's `getModuleDeclContribution()` returns stale data if called after the wrong phase.
- **Severity**: Low
- **Affected area**: events, analytics, translatable-fields
- **Mitigation**: Call `getModuleDeclContribution()` inside the module loop immediately after `scanModule()`, same as current inline code.
- **Residual risk**: Low.

## Backward Compatibility

No BC impact. This is a pure internal refactoring of the CLI generator:
- Convention file paths are unchanged
- Generated file names and content are unchanged
- Module API contracts are unchanged
- No changes to `@open-mercato/shared` types

## Final Compliance Report — 2026-03-20

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/cli/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|------------|------|--------|-------|
| root AGENTS.md | Generated files contract STABLE | Compliant | No changes to generated file exports or shapes |
| root AGENTS.md | Auto-discovery file conventions FROZEN | Compliant | Convention file paths unchanged |
| cli AGENTS.md | Never hand-write migrations | N/A | No DB changes |

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-03-20
- Initial specification drafted
