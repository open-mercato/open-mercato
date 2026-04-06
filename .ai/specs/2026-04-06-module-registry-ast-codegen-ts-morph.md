# Module Registry AST-Based Code Generation with ts-morph

## TLDR

**Key Points:**
- The module-registry generators (`packages/cli/src/lib/generators/`) produce ~30 TypeScript files via string concatenation (template literals). This is fragile, hard to validate, and produces inconsistent formatting.
- Migrate all code generation to AST-based construction using `ts-morph`, ensuring structurally valid TypeScript output with proper formatting.
- Two-phase approach: **Phase 1** adds snapshot unit tests capturing every generated file's exact output; **Phase 2** replaces string concatenation with ts-morph, using Phase 1 tests as a regression safety net.

**Scope:**
- 6 generator files in `packages/cli/src/lib/generators/`: `module-registry.ts` (2,903 lines), `module-entities.ts`, `module-di.ts`, `entity-ids.ts`, `module-package-sources.ts`, `openapi.ts`
- ~30 generated `.ts` files + 1 `.css` + 1 `.json` in `apps/mercato/.mercato/generated/`
- No changes to generated file contracts (exports, types, import paths, runtime behavior)

**Concerns:**
- ts-morph adds a dependency (~5MB) to `@open-mercato/cli` — acceptable for a dev-only tool
- Performance: ts-morph is slower than raw string concatenation; needs benchmarking to ensure generation stays under 5s
- The plugin system (`GeneratorPlugin.buildOutput`) currently receives raw strings — migration must preserve this extension point
- `openapi.ts` produces JSON, not TypeScript — may stay as-is (JSON.stringify is already correct)

---

## Overview

The Open Mercato CLI generator system scans all enabled modules, discovers convention files, and produces TypeScript source files that wire routing, DI, events, search, notifications, widgets, and more into the application bootstrap. Today, all TypeScript output is built by concatenating strings inside template literals — a pattern that:

1. Cannot validate structural correctness (missing commas, unclosed brackets, invalid imports)
2. Makes formatting inconsistent (manual indentation via string padding)
3. Is difficult to compose (conditional fields require ternary expressions inside template literals)
4. Produces no AST-level guarantees about the output

`ts-morph` provides a TypeScript-aware AST builder that eliminates these problems while maintaining full control over output structure.

---

## Problem Statement

1. **Fragile output**: A misplaced comma or missing newline in a template literal silently produces invalid TypeScript. The error surfaces only at build time, not generation time.
2. **Unmaintainable templates**: `module-registry.ts` is 2,903 lines. Of those, ~600 lines are template literal construction with embedded ternary operators, `.join()` calls, and conditional sections.
3. **No output validation**: Generated files are written directly to disk. There is no structural check that the output is valid TypeScript.
4. **Testing gap**: Existing tests verify only that generator functions exist and that options interfaces are correct — no test validates actual generated output content or structure.
5. **Formatting inconsistency**: Each template manually manages indentation. Different generators use different styles (2-space, no indent, mixed).

---

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use `ts-morph` (not the raw `typescript` compiler API) | ts-morph provides a high-level, chainable API for AST construction. The raw TS API is verbose and error-prone for code generation. |
| Phase 1: Tests first, Phase 2: Refactor | Classic "make the change easy, then make the easy change". Tests lock in current behavior before any refactoring. |
| Snapshot-based testing against real module set | Tests run the actual generators against the real project modules and snapshot every output file. This catches regressions at the exact character level. |
| Preserve `writeGeneratedFile` + checksum pattern | The existing write/checksum mechanism is orthogonal to how content is built. Keep it as-is. |
| Keep `openapi.ts` out of scope | It produces JSON via `JSON.stringify`, not template literals. No benefit from ts-morph. |
| Keep `module-package-sources.ts` out of scope | It produces CSS, not TypeScript. No benefit from ts-morph. |
| Migrate generators incrementally (smallest first) | Start with `module-di.ts` (94 lines), then `module-entities.ts` (134 lines), then `entity-ids.ts` (500 lines), then `module-registry.ts` (2,903 lines). Each migration is independently mergeable. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Code-generation templates (Handlebars/EJS) | Still string-based, no structural validation, adds another template language to learn. |
| Stay with string concatenation, just add prettier | Fixes formatting but not structural correctness. Adds prettier as a generation-time dependency with its own perf cost. |
| Build a custom DSL for the generator output | Over-engineering. ts-morph already solves this well. |
| Generate `.js` instead of `.ts` | Would break the existing TypeScript import chain and IDE support. |

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

### Plugin System Compatibility

The `GeneratorPlugin.buildOutput({ importSection, entriesLiteral })` API currently receives raw strings. During Phase 2, this interface is preserved — plugins still receive string sections. Internally, the core generator uses ts-morph, but the plugin output is inserted as raw text via `sourceFile.insertText()`. A future Phase 3 (out of scope) could introduce an AST-aware plugin API.

### Generator Migration Order

| Order | Generator | File | Lines | Complexity | Notes |
|-------|-----------|------|-------|------------|-------|
| 1 | `generateModuleDi` | `module-di.ts` | 94 | Low | Single template, 2 arrays. Ideal first migration. |
| 2 | `generateModuleEntities` | `module-entities.ts` | 134 | Low | Single template, embedded function literal. |
| 3 | `generateEntityIds` | `entity-ids.ts` | 500 | Medium | Two main templates + per-entity file loop. Uses TS compiler API for parsing (keep that, migrate output only). |
| 4 | `generateModuleRegistry` | `module-registry.ts` | 2,903 | Very High | 28 output templates, conditional logic, plugin system. Break into sub-migrations by output file group. |
| 4a | — routes group | — | ~200 | Medium | `frontend-routes`, `backend-routes`, `api-routes`, middleware files |
| 4b | — config group | — | ~200 | Medium | `search`, `events`, `analytics`, `translations-fields` |
| 4c | — notifications group | — | ~200 | Medium | `notifications`, `notifications.client`, `notification-handlers` |
| 4d | — messages group | — | ~200 | High | `message-types`, `message-objects`, `messages.client` — complex rendering logic |
| 4e | — widgets group | — | ~100 | Medium | `dashboard-widgets`, `injection-widgets`, `injection-tables` |
| 4f | — misc group | — | ~200 | Medium | `ai-tools`, `enrichers`, `interceptors`, `guards`, `command-interceptors`, `inbox-actions`, `component-overrides` |
| 4g | — core modules | — | ~400 | High | `modules.generated.ts`, `modules.runtime.generated.ts`, `modules.app.generated.ts`, `modules.cli.generated.ts`, `bootstrap-registrations` |
| skip | `openapi.ts` | — | 600 | — | JSON output, no ts-morph benefit |
| skip | `module-package-sources.ts` | — | 60 | — | CSS output, no ts-morph benefit |

---

## Phase 1: Snapshot Tests for All Generated Output

### Goal

Lock in the exact current output of every generator so that Phase 2 refactoring has a zero-tolerance regression safety net.

### Test Strategy

**Test file:** `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts`

Each test:
1. Runs the real generator against the real project resolver (not mocks)
2. Reads every generated output file
3. Snapshots the content (Jest `toMatchSnapshot()` or inline snapshots)

This ensures that after Phase 2, running `yarn test` will fail if any generated file differs by even a single character.

### Test Cases

```typescript
// packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts

describe('generator output snapshots', () => {
  let resolver: PackageResolver

  beforeAll(async () => {
    resolver = createPackageResolver({ rootDir: MERCATO_ROOT })
  })

  // --- DI Generator ---
  describe('generateModuleDi', () => {
    it('should produce stable di.generated.ts output', async () => {
      const result = await generateModuleDi({ resolver, quiet: true })
      const content = fs.readFileSync(path.join(outputDir, 'di.generated.ts'), 'utf8')
      expect(content).toMatchSnapshot()
    })
  })

  // --- Entities Generator ---
  describe('generateModuleEntities', () => {
    it('should produce stable entities.generated.ts output', async () => {
      const result = await generateModuleEntities({ resolver, quiet: true })
      const content = fs.readFileSync(path.join(outputDir, 'entities.generated.ts'), 'utf8')
      expect(content).toMatchSnapshot()
    })
  })

  // --- Entity IDs Generator ---
  describe('generateEntityIds', () => {
    it('should produce stable entities.ids.generated.ts output', async () => {
      const result = await generateEntityIds({ resolver, quiet: true })
      const content = fs.readFileSync(path.join(outputDir, 'entities.ids.generated.ts'), 'utf8')
      expect(content).toMatchSnapshot()
    })

    it('should produce stable per-entity index files', async () => {
      // Snapshot all entity subdirectories
      const entityDir = path.join(outputDir, 'entities')
      const entityFiles = fs.readdirSync(entityDir, { recursive: true })
        .filter((f) => f.toString().endsWith('.ts'))
        .sort()
      for (const file of entityFiles) {
        const content = fs.readFileSync(path.join(entityDir, file.toString()), 'utf8')
        expect(content).toMatchSnapshot(`entity/${file}`)
      }
    })
  })

  // --- Module Registry Generator (28 output files) ---
  describe('generateModuleRegistry', () => {
    const registryFiles = [
      'modules.generated.ts',
      'modules.runtime.generated.ts',
      'frontend-routes.generated.ts',
      'backend-routes.generated.ts',
      'api-routes.generated.ts',
      'dashboard-widgets.generated.ts',
      'injection-widgets.generated.ts',
      'injection-tables.generated.ts',
      'search.generated.ts',
      'events.generated.ts',
      'analytics.generated.ts',
      'notifications.generated.ts',
      'notifications.client.generated.ts',
      'notification-handlers.generated.ts',
      'message-types.generated.ts',
      'message-objects.generated.ts',
      'messages.client.generated.ts',
      'ai-tools.generated.ts',
      'translations-fields.generated.ts',
      'enrichers.generated.ts',
      'interceptors.generated.ts',
      'component-overrides.generated.ts',
      'inbox-actions.generated.ts',
      'guards.generated.ts',
      'command-interceptors.generated.ts',
      'frontend-middleware.generated.ts',
      'backend-middleware.generated.ts',
      'bootstrap-registrations.generated.ts',
      'payments.client.generated.ts',
      'security-mfa-providers.generated.ts',
      'security-sudo.generated.ts',
      'subscribers.generated.ts',
    ]

    beforeAll(async () => {
      await generateModuleRegistry({ resolver, quiet: true })
    })

    for (const file of registryFiles) {
      it(`should produce stable ${file} output`, () => {
        const filePath = path.join(outputDir, file)
        if (!fs.existsSync(filePath)) {
          // File may not exist if no modules contribute to it — skip
          return
        }
        const content = fs.readFileSync(filePath, 'utf8')
        expect(content).toMatchSnapshot()
      })
    }
  })

  // --- Module Registry App ---
  describe('generateModuleRegistryApp', () => {
    it('should produce stable modules.app.generated.ts output', async () => {
      await generateModuleRegistryApp({ resolver, quiet: true })
      const content = fs.readFileSync(path.join(outputDir, 'modules.app.generated.ts'), 'utf8')
      expect(content).toMatchSnapshot()
    })
  })

  // --- Module Registry CLI ---
  describe('generateModuleRegistryCli', () => {
    it('should produce stable modules.cli.generated.ts output', async () => {
      await generateModuleRegistryCli({ resolver, quiet: true })
      const content = fs.readFileSync(path.join(outputDir, 'modules.cli.generated.ts'), 'utf8')
      expect(content).toMatchSnapshot()
    })
  })
})
```

### Structural Validation Tests

In addition to snapshots, add structural tests that verify contracts survive regardless of exact formatting:

```typescript
describe('generated file structural contracts', () => {
  // These tests verify the exported symbols that downstream code depends on.
  // They protect against the ts-morph migration accidentally dropping an export.

  it('di.generated.ts exports diRegistrars and default', () => {
    const content = readGenerated('di.generated.ts')
    expect(content).toContain('export { diRegistrars }')
    expect(content).toContain('export default diRegistrars')
  })

  it('entities.generated.ts exports entities array', () => {
    const content = readGenerated('entities.generated.ts')
    expect(content).toContain('export const entities = [')
  })

  it('modules.generated.ts exports modules array and modulesInfo', () => {
    const content = readGenerated('modules.generated.ts')
    expect(content).toContain('export const modules')
    expect(content).toContain('export const modulesInfo')
    expect(content).toContain('export default modules')
  })

  it('search.generated.ts exports searchModuleConfigEntries and searchModuleConfigs', () => {
    const content = readGenerated('search.generated.ts')
    expect(content).toContain('export const searchModuleConfigEntries')
    expect(content).toContain('export const searchModuleConfigs')
  })

  it('events.generated.ts exports eventDefinitionEntries', () => {
    const content = readGenerated('events.generated.ts')
    expect(content).toContain('export const eventDefinitionEntries')
  })

  it('frontend-routes.generated.ts exports frontendRoutes', () => {
    const content = readGenerated('frontend-routes.generated.ts')
    expect(content).toContain('export const frontendRoutes')
    expect(content).toContain('export default frontendRoutes')
  })

  it('backend-routes.generated.ts exports backendRoutes', () => {
    const content = readGenerated('backend-routes.generated.ts')
    expect(content).toContain('export const backendRoutes')
    expect(content).toContain('export default backendRoutes')
  })

  it('api-routes.generated.ts exports apiRoutes', () => {
    const content = readGenerated('api-routes.generated.ts')
    expect(content).toContain('export const apiRoutes')
    expect(content).toContain('export default apiRoutes')
  })

  it('entities.ids.generated.ts exports M and E constants', () => {
    const content = readGenerated('entities.ids.generated.ts')
    expect(content).toContain('export const M')
    expect(content).toContain('export const E')
  })

  it('all generated .ts files start with AUTO-GENERATED comment', () => {
    const tsFiles = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.generated.ts'))
    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(outputDir, file), 'utf8')
      expect(content.startsWith('// AUTO-GENERATED')).toBe(true)
    }
  })

  it('all generated .ts files are valid TypeScript (no syntax errors)', () => {
    // Parse each file with the TypeScript compiler and assert zero diagnostics
    const tsFiles = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.generated.ts'))
    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(outputDir, file), 'utf8')
      const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
      // parseDiagnostics would be empty for valid syntax
      expect(sf.parseDiagnostics?.length ?? 0).toBe(0)
    }
  })
})
```

### Phase 1 Deliverables

1. `packages/cli/src/lib/generators/__tests__/output-snapshots.test.ts` — Snapshot tests for all 30+ generated files
2. `packages/cli/src/lib/generators/__tests__/structural-contracts.test.ts` — Export/contract validation tests
3. Jest snapshot files committed to the repo
4. CI pipeline runs these tests on every PR

### Phase 1 Acceptance Criteria

- [ ] Every generated `.ts` file has a snapshot test
- [ ] Every generated `.ts` file has at least one structural contract test (verifying exports)
- [ ] All generated files pass TypeScript syntax validation
- [ ] Tests pass in CI (`yarn test` in packages/cli)
- [ ] Running `yarn generate` followed by `yarn test` produces zero failures

---

## Phase 2: Migrate to ts-morph AST Generation

### Goal

Replace all template literal code generation with ts-morph AST construction while keeping Phase 1 tests green.

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

**Migrate `module-di.ts`:**
- Replace the template literal with ts-morph calls
- Run Phase 1 tests — snapshot must match exactly (or update snapshot if formatting-only difference)
- If formatting differs, normalize both old and new output (strip trailing whitespace, normalize newlines) in the snapshot comparison

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

### Sub-Phase 2d: `module-registry.ts` — Routes Group

Extract route output construction into helper functions that use ts-morph:

```typescript
// ast/routes.ts
export function buildFrontendRoutesFile(entries: FrontendRouteEntry[]): string { ... }
export function buildBackendRoutesFile(entries: BackendRouteEntry[]): string { ... }
export function buildApiRoutesFile(entries: ApiRouteEntry[]): string { ... }
export function buildMiddlewareFile(kind: 'frontend' | 'backend', entries: MiddlewareEntry[]): string { ... }
```

Each function:
1. Creates a ts-morph SourceFile
2. Adds imports
3. Adds the typed array declaration
4. Returns `sourceFile.getFullText()`

The main `generateModuleRegistry()` function calls these helpers instead of concatenating template strings.

### Sub-Phase 2e: `module-registry.ts` — Config Group

Extract: `search.generated.ts`, `events.generated.ts`, `analytics.generated.ts`, `translations-fields.generated.ts`

These all follow the same pattern (import section + typed array + filter + re-export). Create a generic helper:

```typescript
// ast/config-registry.ts
export function buildConfigRegistryFile(options: {
  generator: string
  typeImport: { name: string; moduleSpecifier: string }
  entryType: string
  entries: Array<{ importName: string; importPath: string; moduleId: string; configExpr: string }>
  exports: { entriesName: string; valuesName: string }
}): string { ... }
```

### Sub-Phase 2f: `module-registry.ts` — Notifications & Messages Group

Most complex templates due to client-side component rendering logic. Extract:

```typescript
// ast/notifications.ts
export function buildNotificationsFile(...): string { ... }
export function buildNotificationsClientFile(...): string { ... }
export function buildNotificationHandlersFile(...): string { ... }

// ast/messages.ts
export function buildMessageTypesFile(...): string { ... }
export function buildMessageObjectsFile(...): string { ... }
export function buildMessagesClientFile(...): string { ... }
```

### Sub-Phase 2g: `module-registry.ts` — Widgets + Misc Group

Extract widget and miscellaneous generators:

```typescript
// ast/widgets.ts
export function buildDashboardWidgetsFile(...): string { ... }
export function buildInjectionWidgetsFile(...): string { ... }
export function buildInjectionTablesFile(...): string { ... }

// ast/misc-registries.ts
export function buildAiToolsFile(...): string { ... }
export function buildEnrichersFile(...): string { ... }
export function buildInterceptorsFile(...): string { ... }
export function buildGuardsFile(...): string { ... }
export function buildCommandInterceptorsFile(...): string { ... }
export function buildInboxActionsFile(...): string { ... }
export function buildComponentOverridesFile(...): string { ... }
```

### Sub-Phase 2h: `module-registry.ts` — Core Modules Files

The most complex output: `modules.generated.ts`, `modules.runtime.generated.ts`, `bootstrap-registrations.generated.ts`, `modules.app.generated.ts`, `modules.cli.generated.ts`.

These have the most conditional fields and the deepest object literal nesting. Extract:

```typescript
// ast/module-declarations.ts
export function buildModulesFile(modules: ModuleDeclaration[], imports: ImportDecl[]): string { ... }
export function buildRuntimeModulesFile(modules: RuntimeModuleDeclaration[], imports: ImportDecl[]): string { ... }
export function buildBootstrapRegistrationsFile(plugins: PluginRegistration[]): string { ... }
export function buildAppModulesFile(modules: AppModuleDeclaration[], imports: ImportDecl[]): string { ... }
export function buildCliModulesFile(modules: CliModuleDeclaration[], imports: ImportDecl[]): string { ... }
```

### Phase 2 Performance Validation

After full migration, benchmark generation time:

```bash
time yarn generate
```

**Acceptance threshold:** Total generation time must not exceed 2x the pre-migration baseline. If it does, apply these optimizations:
1. Reuse a single `Project` instance across all generators (already planned)
2. Use `sourceFile.getFullText()` directly, avoid `sourceFile.formatText()` (let the raw AST formatting be sufficient)
3. If still slow, fall back to using ts-morph only for complex templates and keep simple ones as template literals

### Phase 2 Deliverables

1. `ts-morph` added as dependency to `packages/cli/package.json`
2. `packages/cli/src/lib/generators/ast/` utility module with reusable helpers
3. All 6 generator files migrated (except `openapi.ts` and `module-package-sources.ts`)
4. Phase 1 snapshot tests updated (formatting-only deltas documented)
5. Phase 1 structural contract tests remain green with zero changes
6. Performance benchmark documented in PR description

### Phase 2 Acceptance Criteria

- [ ] All Phase 1 structural contract tests pass without modification
- [ ] Snapshot tests updated only for formatting differences (no semantic changes)
- [ ] `yarn generate` produces identical output (modulo whitespace normalization)
- [ ] `yarn build` succeeds after generation
- [ ] `yarn dev` starts successfully with generated files
- [ ] `yarn test` passes in packages/cli
- [ ] Generation time stays within 2x of pre-migration baseline
- [ ] No string template literals remain in generator output construction (except `openapi.ts` and `module-package-sources.ts`)
- [ ] Plugin system (`GeneratorPlugin.buildOutput`) continues to work unchanged

---

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Generated output differs semantically after migration | **Critical** | All downstream consumers | Phase 1 snapshot tests catch any diff; structural contract tests validate exports | Low — double safety net |
| ts-morph performance degrades generation time | **Medium** | Developer experience | Shared Project instance, skip formatting, benchmark gate | Low — fallback to hybrid approach |
| ts-morph dependency size impacts CI | **Low** | CI build time | It's a devDependency in CLI package only | Negligible |
| Plugin system breaks for custom `buildOutput` | **Medium** | Third-party module generators | Preserve string-based plugin API, insert plugin output as raw text | Low |
| Snapshot tests become flaky across environments | **Low** | CI reliability | Normalize line endings, sort deterministically, use `os.EOL` | Low |
| Migration takes longer than expected due to `module-registry.ts` complexity | **Medium** | Timeline | Sub-phase approach allows partial merges; each sub-phase is independently valuable | Low — incremental delivery |

---

## Backward Compatibility

This refactor changes **zero** contract surfaces:

- Generated file paths: unchanged
- Generated export names: unchanged
- Generated type signatures: unchanged
- Generated import paths: unchanged
- Plugin API (`GeneratorPlugin`): unchanged
- CLI commands (`mercato generate`): unchanged
- Checksum files: unchanged behavior (content checksums may change due to formatting, which triggers a one-time regeneration)

The only observable change is potential whitespace/formatting differences in generated files. Since these files are auto-generated and never hand-edited, and since they are gitignored in standalone apps, this has zero user impact.

---

## Files Modified

### Phase 1 (New Files)
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
- `packages/cli/src/lib/generators/ast/config-registry.ts`
- `packages/cli/src/lib/generators/ast/routes.ts`
- `packages/cli/src/lib/generators/ast/notifications.ts`
- `packages/cli/src/lib/generators/ast/messages.ts`
- `packages/cli/src/lib/generators/ast/widgets.ts`
- `packages/cli/src/lib/generators/ast/misc-registries.ts`
- `packages/cli/src/lib/generators/ast/module-declarations.ts`

### Phase 2 (Modified Files)
- `packages/cli/package.json` (add ts-morph dependency)
- `packages/cli/src/lib/generators/module-di.ts`
- `packages/cli/src/lib/generators/module-entities.ts`
- `packages/cli/src/lib/generators/entity-ids.ts`
- `packages/cli/src/lib/generators/module-registry.ts`

---

## Final Compliance Report

| Check | Status | Notes |
|-------|--------|-------|
| Backward compatibility | Pass | Zero contract surface changes |
| Generated file contracts | Pass | All exports, types, import paths preserved |
| Plugin system preserved | Pass | `GeneratorPlugin.buildOutput` API unchanged |
| Performance acceptable | TBD | Must benchmark after Phase 2 |
| Test coverage adequate | Pass | Snapshot + structural tests cover all 30+ files |
| No security implications | Pass | Code generation is a dev-time operation |
| No database changes | Pass | No entities or migrations involved |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-06 | Initial spec created |
