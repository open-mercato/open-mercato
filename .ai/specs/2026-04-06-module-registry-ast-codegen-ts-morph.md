# Module Registry AST-Based Code Generation with ts-morph

> **Companion spec**: [Decentralize Module Registry Generator](2026-03-20-decentralize-module-registry-generator.md) — defines the plugin-based extension architecture. This spec and the decentralization spec are designed to be implemented together: extensions are extracted from the monolith AND built with ts-morph from the start, avoiding a double-refactor.

## TLDR

**Key Points:**
- The module-registry generators (`packages/cli/src/lib/generators/`) produce ~30 TypeScript files via string concatenation (template literals). This is fragile, hard to validate, and produces inconsistent formatting.
- Migrate all code generation to AST-based construction using `ts-morph`, ensuring structurally valid TypeScript output with proper formatting.
- Three-phase approach: **Phase 1** (COMPLETE) adds snapshot unit tests; **Phase 2** migrates standalone generators (`module-di`, `module-entities`, `entity-ids`) to ts-morph + adds AST infrastructure; **Phase 3** combines decentralization with ts-morph — extracts extensions from the monolithic `module-registry.ts` and builds each extension with ts-morph from the start.

**Scope:**
- 6 generator files in `packages/cli/src/lib/generators/`: `module-registry.ts` (2,903 lines), `module-entities.ts`, `module-di.ts`, `entity-ids.ts`, `module-package-sources.ts`, `openapi.ts`
- ~30 generated `.ts` files + 1 `.css` + 1 `.json` in `apps/mercato/.mercato/generated/`
- No changes to generated file contracts (exports, types, import paths, runtime behavior)
- Introduces `GeneratorExtension` interface and `extensions/` directory (from decentralization spec)

**Concerns:**
- ts-morph adds a dependency (~5MB) to `@open-mercato/cli` — acceptable for a dev-only tool
- Performance: ts-morph is slower than raw string concatenation; needs benchmarking to ensure generation stays under 5s
- The plugin system (`GeneratorPlugin.buildOutput`) currently receives raw strings — migration must preserve this extension point
- `openapi.ts` produces JSON, not TypeScript — stays as-is (JSON.stringify is already correct)
- Combined decentralization + ts-morph is more complex per-step, but avoids rewriting each extension twice

---

## Overview

The Open Mercato CLI generator system scans all enabled modules, discovers convention files, and produces TypeScript source files that wire routing, DI, events, search, notifications, widgets, and more into the application bootstrap. Today, all TypeScript output is built by concatenating strings inside template literals — a pattern that:

1. Cannot validate structural correctness (missing commas, unclosed brackets, invalid imports)
2. Makes formatting inconsistent (manual indentation via string padding)
3. Is difficult to compose (conditional fields require ternary expressions inside template literals)
4. Produces no AST-level guarantees about the output

Additionally, the monolithic `module-registry.ts` (2,903 lines) concentrates 22+ output generators in a single function. Every new convention file type requires modifying this function, creating merge conflicts and cognitive overload. The [decentralization spec](2026-03-20-decentralize-module-registry-generator.md) addresses this by extracting standalone generators into composable `GeneratorExtension` plugins.

**This spec and the decentralization spec are designed to be implemented together.** Rather than:
- (A) Decentralize first with strings → then rewrite each extension to ts-morph (double work), or
- (B) ts-morph first on monolith → then split into extensions (double refactor)

We take approach **(C) Extract extensions AND build them with ts-morph from the start** — one clean pass per output file.

`ts-morph` provides a TypeScript-aware AST builder that eliminates template literal problems while maintaining full control over output structure.

---

## Problem Statement

1. **Fragile output**: A misplaced comma or missing newline in a template literal silently produces invalid TypeScript. The error surfaces only at build time, not generation time.
2. **Unmaintainable templates**: `module-registry.ts` is 2,903 lines. Of those, ~600 lines are template literal construction with embedded ternary operators, `.join()` calls, and conditional sections.
3. **Monolithic growth**: Adding any new convention file type requires modifying a single 2,903-line function. This is error-prone and creates merge conflicts. ~15 of the 22 generators follow an identical pattern but are hand-rolled inline.
4. **No output validation**: Generated files are written directly to disk. There is no structural check that the output is valid TypeScript.
5. **Difficult to test**: Individual generators cannot be tested in isolation since they're embedded in the monolith.
6. **Formatting inconsistency**: Each template manually manages indentation. Different generators use different styles (2-space, no indent, mixed).

---

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use `ts-morph` (not the raw `typescript` compiler API) | ts-morph provides a high-level, chainable API for AST construction. The raw TS API is verbose and error-prone for code generation. |
| Phase 1: Tests first, Phase 2+3: Refactor | Classic "make the change easy, then make the easy change". Tests lock in current behavior before any refactoring. |
| **Combine decentralization + ts-morph in a single pass** | Extracting extensions with string templates then migrating each to ts-morph means rewriting every extension twice. One combined pass is cleaner. |
| Plugin architecture for the generator, NOT for modules | Modules cannot "register" generators because the generator discovers modules (not the other way around). The plugin system lives in the CLI generator. |
| Keep core module loop centralized | Pages, APIs, subscribers, workers, translations, CLI, setup, ACL, entities, extensions, and custom fields all contribute to the `Module` type declaration in `modules.generated.ts`. These must stay in the core loop. |
| Dual-purpose files get a hook | Events, analytics, and translatable fields produce standalone files AND contribute to the Module declaration. Extensions return data via `getModuleDeclContribution()`. |
| Snapshot-based testing against real module set | Tests run the actual generators against the real project modules and snapshot every output file. |
| Preserve `writeGeneratedFile` + checksum pattern | The existing write/checksum mechanism is orthogonal to how content is built. Keep it as-is. |
| Keep `openapi.ts` out of scope | It produces JSON via `JSON.stringify`, not template literals. No benefit from ts-morph. |
| Keep `module-package-sources.ts` out of scope | It produces CSS, not TypeScript. No benefit from ts-morph. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Decentralize first (strings), then migrate each extension to ts-morph | Double work — each extension gets written twice. The combined approach does one clean pass per output file. |
| ts-morph the monolith first, then decentralize | Also double refactor — ts-morph sub-phases 2d–2h in the original spec map naturally to extension boundaries, so combining is strictly less work. |
| Code-generation templates (Handlebars/EJS) | Still string-based, no structural validation, adds another template language to learn. |
| Stay with string concatenation, just add prettier | Fixes formatting but not structural correctness. Adds prettier as a generation-time dependency with its own perf cost. |
| Build a custom DSL for the generator output | Over-engineering. ts-morph already solves this well. |
| Module-contributed generators (modules declare their own generator logic) | Circular dependency — the generator discovers modules, so modules can't register generators at discovery time. Also a BC break. |

---

## Architecture

### Dependency Addition

```
packages/cli/package.json
  "dependencies": {
+   "ts-morph": "^25.0.0"
  }
```

ts-morph is a dev-time tool dependency only. It is never bundled into the application.

### New Utility Module: `packages/cli/src/lib/generators/ast/`

```
packages/cli/src/lib/generators/ast/
├── index.ts              # Re-exports
├── source-file.ts        # Helpers: createGeneratedSourceFile(), addAutoGeneratedComment()
├── imports.ts            # Helpers: addNamespaceImport(), addNamedImport(), addTypeImport()
├── arrays.ts             # Helpers: addExportedArray(), addConstArray()
├── objects.ts            # Helpers: buildObjectLiteral(), buildConditionalProperty()
└── functions.ts          # Helpers: addExportedFunction(), addArrowFunction()
```

These helpers wrap ts-morph's API to encode Open Mercato's code generation conventions:
- Auto-generated header comment
- Deterministic import ordering (by module ID, then by convention)
- Consistent formatting (ts-morph's built-in formatter)
- Conditional property patterns (replaces ternary-in-template-literal)

### Migration Pattern

**Before (string concatenation):**
```typescript
const output = `// AUTO-GENERATED by mercato generate di
${imports.join('\n')}

const diRegistrars = [
  ${registrars.join(',\n  ')}
].filter(Boolean) as (((c: any) => void)|undefined)[]

export { diRegistrars }
export default diRegistrars
`
```

**After (ts-morph):**
```typescript
import { Project } from 'ts-morph'

const project = new Project({ useInMemoryFileSystem: true })
const sourceFile = project.createSourceFile('di.generated.ts')

addAutoGeneratedComment(sourceFile, 'mercato generate di')

for (const { importName, importPath } of diImports) {
  sourceFile.addImportDeclaration({
    namespaceImport: importName,
    moduleSpecifier: importPath,
  })
}

sourceFile.addVariableStatement({
  declarationKind: VariableDeclarationKind.Const,
  declarations: [{
    name: 'diRegistrars',
    initializer: `[\n  ${registrars.join(',\n  ')}\n].filter(Boolean) as (((c: any) => void)|undefined)[]`,
  }],
})

sourceFile.addExportDeclaration({ namedExports: ['diRegistrars'] })
sourceFile.addExportAssignment({ isExportEquals: false, expression: 'diRegistrars' })

const output = sourceFile.getFullText()
```

### Generator Extension Interface (from Decentralization Spec)

The `GeneratorExtension` interface (defined in the [decentralization spec](2026-03-20-decentralize-module-registry-generator.md)) is the structural backbone for Phase 3. Each extension owns one or more generated output files, uses ts-morph internally, and plugs into the core module scan loop.

```typescript
// packages/cli/src/lib/generators/extension.ts
export interface GeneratorExtension {
  /** Unique ID for this extension */
  id: string

  /** Output file name(s) (e.g., 'search.generated.ts') */
  outputFiles: string[]

  /**
   * Called once per module during the scan loop.
   * Receives the module context and accumulates scan results internally.
   */
  scanModule(ctx: ModuleScanContext): void

  /**
   * Generate the output file content(s) after all modules have been scanned.
   * Each extension uses ts-morph internally to build structurally valid TypeScript.
   * Returns a map of outputFile → content string.
   */
  generateOutput(): Map<string, string>

  /**
   * Optional: return data to merge into the Module declaration
   * in modules.generated.ts (for dual-purpose convention files like events, analytics, translations).
   */
  getModuleDeclContribution?(moduleId: string): string | null
}

export interface ModuleScanContext {
  moduleId: string
  roots: ModuleRoots
  imps: ModuleImports
  importIdRef: { value: number }
  resolveModuleFile: typeof resolveModuleFile
  resolveFirstModuleFile: typeof resolveFirstModuleFile
  processStandaloneConfig: typeof processStandaloneConfig
}
```

Key difference from the original decentralization spec: `generateOutput()` returns a `Map<string, string>` instead of a single string, because some extensions produce multiple files (e.g., notifications produces 3 files). Internally, each extension uses ts-morph AST helpers to build its output — the interface is string-based at the boundary to keep the core loop decoupled from ts-morph internals.

### Plugin System Compatibility

The `GeneratorPlugin.buildOutput({ importSection, entriesLiteral })` API (module-declared plugins in `generators.ts`) currently receives raw strings. This interface is preserved — plugins still receive string sections. Internally, the core generator uses ts-morph, but plugin output is inserted as raw text via `sourceFile.insertText()`. A future Phase 4 (out of scope) could introduce an AST-aware plugin API.

### Extension Classification

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

| Convention file | Generated output | Dual-purpose? | Extension file |
|----------------|-----------------|---------------|----------------|
| `search.ts` | `search.generated.ts` | No | `extensions/search.ts` |
| `notifications.ts` | `notifications.generated.ts` | No | `extensions/notifications.ts` |
| `notifications.client.ts` | `notifications.client.generated.ts` | No | `extensions/notifications.ts` |
| `notifications.handlers.ts` | `notification-handlers.generated.ts` | No | `extensions/notifications.ts` |
| `widgets/payments/client.tsx` | `payments.client.generated.ts` | No | `extensions/payments-client.ts` |
| `message-types.ts` | `message-types.generated.ts` | No | `extensions/messages.ts` |
| `message-objects.ts` | `message-objects.generated.ts` | No | `extensions/messages.ts` |
| (messages client) | `messages.client.generated.ts` | No | `extensions/messages.ts` |
| `ai-tools.ts` | `ai-tools.generated.ts` | No | `extensions/ai-tools.ts` |
| `events.ts` | `events.generated.ts` | Yes (Module.events) | `extensions/events.ts` |
| `analytics.ts` | `analytics.generated.ts` | Yes (Module.analytics) | `extensions/analytics.ts` |
| `translations.ts` | `translations-fields.generated.ts` | Yes (Module.translatableFields) | `extensions/translatable-fields.ts` |
| `data/enrichers.ts` | `enrichers.generated.ts` | No | `extensions/enrichers.ts` |
| `api/interceptors.ts` | `interceptors.generated.ts` | No | `extensions/interceptors.ts` |
| `widgets/components.ts` | `component-overrides.generated.ts` | No | `extensions/component-overrides.ts` |
| `inbox-actions.ts` | `inbox-actions.generated.ts` | No | `extensions/inbox-actions.ts` |
| `data/guards.ts` | `guards.generated.ts` | No | `extensions/guards.ts` |
| `commands/interceptors.ts` | `command-interceptors.generated.ts` | No | `extensions/command-interceptors.ts` |
| dashboard widgets | `dashboard-widgets.generated.ts` | No | `extensions/dashboard-widgets.ts` |
| injection widgets | `injection-widgets.generated.ts` | No | `extensions/injection-widgets.ts` |
| injection tables | `injection-tables.generated.ts` | No | `extensions/injection-widgets.ts` |
| `security/mfa-providers.ts` | `security-mfa-providers.generated.ts` | No | `extensions/security.ts` |
| `security/sudo.ts` | `security-sudo.generated.ts` | No | `extensions/security.ts` |
| `subscribers/*.ts` | `subscribers.generated.ts` | No | `extensions/subscribers.ts` |

### Directory Structure After Phase 3

```
packages/cli/src/lib/generators/
├── module-registry.ts          # Core loop only (~400 lines, uses ts-morph for remaining output)
├── module-di.ts                # ts-morph (Phase 2)
├── module-entities.ts          # ts-morph (Phase 2)
├── entity-ids.ts               # ts-morph (Phase 2)
├── openapi.ts                  # Unchanged (JSON output)
├── module-package-sources.ts   # Unchanged (CSS output)
├── scanner.ts                  # Unchanged
├── extension.ts                # GeneratorExtension interface + ModuleScanContext + helpers
├── ast/                        # ts-morph utility helpers (Phase 2)
│   ├── index.ts
│   ├── source-file.ts
│   ├── imports.ts
│   ├── arrays.ts
│   ├── objects.ts
│   └── functions.ts
├── extensions/                 # Extracted extensions, each using ts-morph (Phase 3)
│   ├── search.ts
│   ├── notifications.ts        # notifications + client + handlers (3 output files)
│   ├── messages.ts             # message-types + objects + client (3 output files)
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
│   ├── injection-widgets.ts    # widgets + tables (2 output files)
│   ├── security.ts             # mfa-providers + sudo (2 output files)
│   └── subscribers.ts
└── __tests__/                  # Phase 1 tests (already exist)
    ├── output-snapshots.test.ts
    ├── structural-contracts.test.ts
    └── __snapshots__/
```

### Core Loop After Phase 3

```typescript
export async function generateModuleRegistry(options: ModuleRegistryOptions): Promise<GeneratorResult> {
  const extensions = loadExtensions() // collect all GeneratorExtension instances

  for (const entry of enabled) {
    // ... core module processing (pages, APIs, subscribers, etc.) ...
    // This section also uses ts-morph for its output templates

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

  // Write core output files (modules.generated.ts, routes, etc.) using ts-morph
  writeGeneratedFile({ outFile, content: buildModulesFile(moduleDecls, imports), ... })

  // Write all extension outputs
  for (const ext of extensions) {
    const outputs = ext.generateOutput()
    for (const [fileName, content] of outputs) {
      writeGeneratedFile({
        outFile: path.join(outputDir, fileName),
        content,
        ...
      })
    }
  }
}
```

---

## Phase 1: Snapshot Tests for All Generated Output — COMPLETE

> **Status: COMPLETE** — Implemented in commit `a7da0b55a`. Both test files exist and pass.

### Deliverables (delivered)

1. `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts` (861 lines) — Snapshot tests for all 30+ generated files using scaffolded module fixtures
2. `packages/cli/src/lib/generators/__tests__/structural-contracts.test.ts` (1,114 lines) — Export/contract validation tests verifying all downstream-consumed symbols
3. Jest snapshot files committed to the repo
4. CI pipeline runs these tests on every PR

### Acceptance Criteria (all met)

- [x] Every generated `.ts` file has a snapshot test
- [x] Every generated `.ts` file has at least one structural contract test (verifying exports)
- [x] All generated files pass TypeScript syntax validation
- [x] Tests pass in CI (`yarn test` in packages/cli)
- [x] Running `yarn generate` followed by `yarn test` produces zero failures

---

## Phase 2: ts-morph Infrastructure + Standalone Generator Migration

### Goal

Add ts-morph as a dependency, create AST utility helpers, and migrate the three standalone generators (`module-di.ts`, `module-entities.ts`, `entity-ids.ts`) to ts-morph. These generators are independent files not affected by the decentralization, so they can be migrated first.

### Sub-Phase 2a: Infrastructure + `module-di.ts`

**Add ts-morph dependency:**
```bash
cd packages/cli && yarn add ts-morph
```

**Create AST utility module** (`packages/cli/src/lib/generators/ast/`):

```typescript
// ast/source-file.ts
import { Project, SourceFile } from 'ts-morph'

// Shared Project instance — reuse across generators for performance
let sharedProject: Project | null = null

export function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({ useInMemoryFileSystem: true })
  }
  return sharedProject
}

export function createGeneratedSourceFile(fileName: string): SourceFile {
  const project = getProject()
  // Remove existing file if present (re-generation)
  const existing = project.getSourceFile(fileName)
  if (existing) project.removeSourceFile(existing)
  return project.createSourceFile(fileName)
}

export function addAutoGeneratedComment(sourceFile: SourceFile, generator: string): void {
  sourceFile.insertText(0, `// AUTO-GENERATED by mercato generate ${generator}\n`)
}

export function getSourceText(sourceFile: SourceFile): string {
  return sourceFile.getFullText()
}
```

**Create `extension.ts`** — the `GeneratorExtension` interface and `ModuleScanContext` type. This infrastructure is needed in Phase 2 even though extensions are extracted in Phase 3, because it establishes the contract.

**Migrate `module-di.ts`:**
- Replace the template literal with ts-morph calls
- Run Phase 1 tests — snapshot must match exactly (or update snapshot if formatting-only difference)

**Decision: snapshot update policy:**
When ts-morph produces output that differs only in whitespace/formatting from the string-concatenated version, update the snapshot. The structural contract tests ensure no semantic change. Document the formatting delta in the PR description.

### Sub-Phase 2b: `module-entities.ts`

- Migrate the single template + `enhanceEntities` function literal
- The embedded function body (`enhanceEntities`) can use `addFunction()` with a body string or construct it via AST nodes
- Run tests, update snapshot if needed

### Sub-Phase 2c: `entity-ids.ts`

- Keep the existing TypeScript compiler API usage for *reading* entity files (parsing class declarations, property names)
- Migrate only the *output* construction to ts-morph
- Handle the per-entity file loop (each entity gets its own `entities/<EntityName>/index.ts`)
- Run tests, update snapshots

### Phase 2 Deliverables

1. `ts-morph` added as dependency to `packages/cli/package.json`
2. `packages/cli/src/lib/generators/ast/` utility module with reusable helpers
3. `packages/cli/src/lib/generators/extension.ts` — `GeneratorExtension` interface
4. `module-di.ts`, `module-entities.ts`, `entity-ids.ts` migrated to ts-morph
5. Phase 1 snapshot tests updated (formatting-only deltas documented)
6. Phase 1 structural contract tests remain green with zero changes

### Phase 2 Acceptance Criteria

- [ ] All Phase 1 structural contract tests pass without modification
- [ ] Snapshot tests updated only for formatting differences (no semantic changes)
- [ ] `yarn generate` produces identical output (modulo whitespace normalization)
- [ ] `yarn build` succeeds after generation
- [ ] `yarn test` passes in packages/cli
- [ ] No string template literals remain in `module-di.ts`, `module-entities.ts`, `entity-ids.ts`

---

## Phase 3: Combined Decentralization + ts-morph for `module-registry.ts`

### Goal

Extract standalone generators from the monolithic `module-registry.ts` into `GeneratorExtension` plugins in `extensions/`, building each extension with ts-morph from the start. After this phase, `module-registry.ts` shrinks from ~2,903 lines to ~400 lines (core loop only), and all extracted extensions produce structurally valid TypeScript via ts-morph.

This phase implements the [decentralization spec](2026-03-20-decentralize-module-registry-generator.md) and the remaining ts-morph migration simultaneously.

### Sub-Phase 3a: First Batch — Simple Standalone Extensions

Extract the simplest standalone generators that follow the `processStandaloneConfig → template → writeGeneratedFile` pattern:

| Extension | Output file | Complexity |
|-----------|------------|------------|
| `extensions/search.ts` | `search.generated.ts` | Low |
| `extensions/ai-tools.ts` | `ai-tools.generated.ts` | Low |
| `extensions/enrichers.ts` | `enrichers.generated.ts` | Low |
| `extensions/guards.ts` | `guards.generated.ts` | Low |
| `extensions/command-interceptors.ts` | `command-interceptors.generated.ts` | Low |
| `extensions/interceptors.ts` | `interceptors.generated.ts` | Low |
| `extensions/inbox-actions.ts` | `inbox-actions.generated.ts` | Low |
| `extensions/component-overrides.ts` | `component-overrides.generated.ts` | Low |
| `extensions/payments-client.ts` | `payments.client.generated.ts` | Low |
| `extensions/security.ts` | `security-mfa-providers.generated.ts`, `security-sudo.generated.ts` | Low |
| `extensions/subscribers.ts` | `subscribers.generated.ts` | Low |

Each extension:
1. Implements `GeneratorExtension`
2. Accumulates scan results in `scanModule()`
3. Uses ts-morph AST helpers in `generateOutput()` to build structurally valid TypeScript
4. Returns `Map<string, string>` of output file → content

Wire them into the core loop via `loadExtensions()`. Verify generated output is byte-identical (or whitespace-only diff).

### Sub-Phase 3b: Multi-File Extensions — Notifications & Messages

Extract extensions that produce multiple output files:

**`extensions/notifications.ts`** (3 output files):
- `notifications.generated.ts` — server-side notification type registry
- `notifications.client.generated.ts` — client-side notification renderers
- `notification-handlers.generated.ts` — reactive notification handlers

**`extensions/messages.ts`** (3 output files):
- `message-types.generated.ts` — message type definitions
- `message-objects.generated.ts` — message object factory registry
- `messages.client.generated.ts` — client-side message renderers (complex rendering logic)

These are the most complex templates due to client-side component rendering logic. Each uses ts-morph for structurally valid output.

### Sub-Phase 3c: Widget Extensions

**`extensions/dashboard-widgets.ts`** (1 output file):
- `dashboard-widgets.generated.ts`

**`extensions/injection-widgets.ts`** (2 output files):
- `injection-widgets.generated.ts`
- `injection-tables.generated.ts`

### Sub-Phase 3d: Dual-Purpose Extensions

These are the trickiest extractions because they produce standalone files AND contribute fields to the `Module` declaration in `modules.generated.ts`.

| Extension | Output file | Module declaration field |
|-----------|------------|--------------------------|
| `extensions/events.ts` | `events.generated.ts` | `Module.events` |
| `extensions/analytics.ts` | `analytics.generated.ts` | `Module.analytics` |
| `extensions/translatable-fields.ts` | `translations-fields.generated.ts` | `Module.translatableFields` |

Each implements `getModuleDeclContribution(moduleId)` which returns the string fragment to inject into the Module object literal. The core loop calls this inside the module iteration, immediately after `scanModule()`, same timing as the current inline code.

Import ordering: these extensions push imports to both standalone and shared import arrays. The shared `importIdRef` counter is passed through `ModuleScanContext` to ensure deterministic ordering.

### Sub-Phase 3e: Core Loop ts-morph Migration

After all extensions are extracted, the remaining `module-registry.ts` (~400 lines) handles:
- Module iteration and discovery
- Page/API/subscriber/worker scanning (stays in core loop)
- `modules.generated.ts`, `modules.runtime.generated.ts` output
- `modules.app.generated.ts`, `modules.cli.generated.ts` output
- `bootstrap-registrations.generated.ts` output
- Route files: `frontend-routes.generated.ts`, `backend-routes.generated.ts`, `api-routes.generated.ts`
- Middleware files: `frontend-middleware.generated.ts`, `backend-middleware.generated.ts`
- Extension orchestration (`loadExtensions`, scan loop, write loop)

Migrate the remaining output templates in the core loop to ts-morph. The route/middleware output uses AST helpers from `ast/`:

```typescript
// Core loop output helpers (use ts-morph internally)
function buildModulesFile(moduleDecls: ModuleDeclaration[], imports: ImportDecl[]): string { ... }
function buildRuntimeModulesFile(modules: RuntimeModuleDeclaration[], imports: ImportDecl[]): string { ... }
function buildBootstrapRegistrationsFile(plugins: PluginRegistration[]): string { ... }
function buildFrontendRoutesFile(entries: FrontendRouteEntry[]): string { ... }
function buildBackendRoutesFile(entries: BackendRouteEntry[]): string { ... }
function buildApiRoutesFile(entries: ApiRouteEntry[]): string { ... }
function buildMiddlewareFile(kind: 'frontend' | 'backend', entries: MiddlewareEntry[]): string { ... }
```

These can live in `ast/module-declarations.ts` and `ast/routes.ts`, or inline in `module-registry.ts` — implementor's choice based on readability.

### Sub-Phase 3f: UMES Conflict Detection

Extract the UMES (Universal Module Extension System) conflict detection block into a post-processing step that reads from extension results. This is a small, self-contained extraction.

### Phase 3 Performance Validation

After full migration, benchmark generation time:

```bash
time yarn generate
```

**Acceptance threshold:** Total generation time must not exceed 2x the pre-migration baseline. If it does, apply these optimizations:
1. Reuse a single `Project` instance across all generators (already planned)
2. Use `sourceFile.getFullText()` directly, avoid `sourceFile.formatText()` (let the raw AST formatting be sufficient)
3. If still slow, fall back to using ts-morph only for complex templates and keep simple ones as template literals

### Phase 3 Deliverables

1. `packages/cli/src/lib/generators/extensions/` directory with 18 extension files
2. `packages/cli/src/lib/generators/extension.ts` — populated with helpers and `loadExtensions()`
3. `module-registry.ts` reduced from ~2,903 to ~400 lines
4. All remaining output templates in core loop use ts-morph
5. Phase 1 snapshot tests updated (formatting-only deltas documented)
6. Phase 1 structural contract tests remain green with zero changes
7. Performance benchmark documented in PR description

### Phase 3 Acceptance Criteria

- [ ] All Phase 1 structural contract tests pass without modification
- [ ] Snapshot tests updated only for formatting differences (no semantic changes)
- [ ] `yarn generate` produces identical output (modulo whitespace normalization)
- [ ] `yarn build` succeeds after generation
- [ ] `yarn dev` starts successfully with generated files
- [ ] `yarn test` passes in packages/cli
- [ ] Generation time stays within 2x of pre-migration baseline
- [ ] No string template literals remain in generator output construction (except `openapi.ts` and `module-package-sources.ts`)
- [ ] Plugin system (`GeneratorPlugin.buildOutput`) continues to work unchanged
- [ ] `module-registry.ts` is under 500 lines
- [ ] Each extension is independently testable (scanModule + generateOutput)
- [ ] Import ID ordering is deterministic (extensions process in fixed array order, shared `importIdRef` counter)

---

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Generated output differs semantically after migration | **Critical** | All downstream consumers | Phase 1 snapshot tests catch any diff; structural contract tests validate exports | Low — double safety net |
| ts-morph performance degrades generation time | **Medium** | Developer experience | Shared Project instance, skip formatting, benchmark gate | Low — fallback to hybrid approach |
| Combined decentralization + ts-morph is too complex per-step | **Medium** | Implementation risk | Sub-phase approach: 3a extracts simple extensions first, proving the pattern before tackling complex ones | Low — incremental delivery |
| Import ID ordering changes across extensions | **Low** | Generated import statements (cosmetic) | Extensions process in fixed, deterministic order. Shared `importIdRef` counter passed through `ModuleScanContext` | Negligible |
| Dual-purpose extensions return stale data | **Low** | events, analytics, translatable-fields | Call `getModuleDeclContribution()` inside the module loop immediately after `scanModule()`, same as current inline code | Low |
| ts-morph dependency size impacts CI | **Low** | CI build time | It's a devDependency in CLI package only | Negligible |
| Plugin system breaks for custom `buildOutput` | **Medium** | Third-party module generators | Preserve string-based plugin API, insert plugin output as raw text | Low |
| Snapshot tests become flaky across environments | **Low** | CI reliability | Normalize line endings, sort deterministically, use `os.EOL` | Low |

---

## Backward Compatibility

This refactor changes **zero** contract surfaces:

- Generated file paths: unchanged
- Generated export names: unchanged
- Generated type signatures: unchanged
- Generated import paths: unchanged
- Plugin API (`GeneratorPlugin`): unchanged
- CLI commands (`mercato generate`): unchanged
- Convention file paths: unchanged
- Module API contracts: unchanged
- No changes to `@open-mercato/shared` types
- Checksum files: unchanged behavior (content checksums may change due to formatting, which triggers a one-time regeneration)

The only observable change is potential whitespace/formatting differences in generated files. Since these files are auto-generated and never hand-edited, and since they are gitignored in standalone apps, this has zero user impact.

---

## Files Modified

### Phase 1 (COMPLETE — already exist)
- `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts`
- `packages/cli/src/lib/generators/__tests__/structural-contracts.test.ts`
- `packages/cli/src/lib/generators/__tests__/__snapshots__/output-snapshots.test.ts.snap`

### Phase 2 (New Files)
- `packages/cli/src/lib/generators/ast/index.ts`
- `packages/cli/src/lib/generators/ast/source-file.ts`
- `packages/cli/src/lib/generators/ast/imports.ts`
- `packages/cli/src/lib/generators/ast/arrays.ts`
- `packages/cli/src/lib/generators/ast/objects.ts`
- `packages/cli/src/lib/generators/ast/functions.ts`
- `packages/cli/src/lib/generators/extension.ts`

### Phase 2 (Modified Files)
- `packages/cli/package.json` (add ts-morph dependency)
- `packages/cli/src/lib/generators/module-di.ts`
- `packages/cli/src/lib/generators/module-entities.ts`
- `packages/cli/src/lib/generators/entity-ids.ts`

### Phase 3 (New Files)
- `packages/cli/src/lib/generators/extensions/search.ts`
- `packages/cli/src/lib/generators/extensions/notifications.ts`
- `packages/cli/src/lib/generators/extensions/messages.ts`
- `packages/cli/src/lib/generators/extensions/payments-client.ts`
- `packages/cli/src/lib/generators/extensions/ai-tools.ts`
- `packages/cli/src/lib/generators/extensions/events.ts`
- `packages/cli/src/lib/generators/extensions/analytics.ts`
- `packages/cli/src/lib/generators/extensions/translatable-fields.ts`
- `packages/cli/src/lib/generators/extensions/enrichers.ts`
- `packages/cli/src/lib/generators/extensions/interceptors.ts`
- `packages/cli/src/lib/generators/extensions/component-overrides.ts`
- `packages/cli/src/lib/generators/extensions/inbox-actions.ts`
- `packages/cli/src/lib/generators/extensions/guards.ts`
- `packages/cli/src/lib/generators/extensions/command-interceptors.ts`
- `packages/cli/src/lib/generators/extensions/dashboard-widgets.ts`
- `packages/cli/src/lib/generators/extensions/injection-widgets.ts`
- `packages/cli/src/lib/generators/extensions/security.ts`
- `packages/cli/src/lib/generators/extensions/subscribers.ts`
- `packages/cli/src/lib/generators/ast/routes.ts` (optional — core loop helpers)
- `packages/cli/src/lib/generators/ast/module-declarations.ts` (optional — core loop helpers)

### Phase 3 (Modified Files)
- `packages/cli/src/lib/generators/module-registry.ts` (reduced from ~2,903 to ~400 lines)
- `packages/cli/src/lib/generators/extension.ts` (add `loadExtensions()` implementation)

---

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| Backward compatibility | Pass | Zero contract surface changes |
| Generated file contracts | Pass | All exports, types, import paths preserved |
| Plugin system preserved | Pass | `GeneratorPlugin.buildOutput` API unchanged |
| Convention file paths | Pass | No changes to auto-discovery paths |
| Performance acceptable | TBD | Must benchmark after Phase 3 |
| Test coverage adequate | Pass | Snapshot + structural tests cover all 30+ files |
| No security implications | Pass | Code generation is a dev-time operation |
| No database changes | Pass | No entities or migrations involved |
| Decentralization spec alignment | Pass | Extension interface, classification, and directory structure are consistent |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-06 | Initial spec created |
| 2026-04-06 | Major revision: aligned with [decentralization spec](2026-03-20-decentralize-module-registry-generator.md) for combined implementation. Restructured from 2-phase to 3-phase approach. Phase 1 marked COMPLETE. Phase 2 narrowed to standalone generators. New Phase 3 combines extension extraction + ts-morph migration. Added `GeneratorExtension` interface with `Map<string, string>` return type. Updated extension classification table, directory structure, file lists, and risks. |
