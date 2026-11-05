# Module Registry Scanner Dedup

## Status
Proposed

## Context
`packages/cli/src/lib/generators/module-registry.ts` contains repeated filesystem scanning logic across multiple scanners (widgets, subscribers, workers, routes, etc.). The dashboard widget scan appears twice, and several other scanners repeat the same directory walk/pattern matching patterns. This duplication increases maintenance overhead and risks divergent behavior across scanners.

## Goals
- Centralize all filesystem scanners in module registry generation (widgets, subscribers, workers, routes, translations, and related scans).
- Preserve current behavior and output ordering (including app overrides, stable sorting, and metadata resolution).
- Make future scanners easy to add with minimal code and clear configuration.

## Non-Goals
- Changing the generated output format or registry semantics.
- Modifying module discovery rules outside widget scanning.
- Changing search, analytics, or other generator paths.

## Proposal
### 1) Introduce a shared scanner utility
Create a reusable helper in `packages/cli/src/lib/generators/module-registry.ts` (or a nearby utility) that encapsulates:
- Directory walk across app and package roots.
- Filtering (e.g., `__tests__`, `__mocks__`, file suffixes, and file-name patterns).
- De-duplication and sorting of found files.
- Source resolution (app wins over package) and import path generation.

Suggested shape:
```ts
type ScanEntry = {
  relPath: string
  source: 'app' | 'package'
  absPath: string
  importPath: string
}

function scanModuleFiles(options: {
  roots: { appBase: string; pkgBase: string }
  appImportBase: string
  pkgImportBase: string
  folder: string
  include: (relPath: string) => boolean
  exclude?: (relPath: string) => boolean
  preferApp?: boolean
}): ScanEntry[]
```

### 2) Replace duplicated blocks
Use the shared scanner for:
- Dashboard widgets and injection widgets.
- Subscribers and workers (with per-scan filters, e.g., `.test/.spec`).
- Frontend/backend route scans (with page/meta discovery).
- Translation locale collection (shared file listing).

### 3) Keep precedence behavior intact
- App entries override package entries when keys collide.
- The merged list stays stable by sorting unique entries before processing.

## Detailed Flow
1. Read `roots.appBase` and `roots.pkgBase`.
2. Walk the target folder under both roots.
3. Collect files matching scan-specific `include`/`exclude` predicates.
4. De-duplicate and sort relative paths.
5. For each relative path:
   - Detect whether the app version exists and choose source accordingly.
   - Build the import path from `appImportBase` or `pkgImportBase`.
   - Build any derived fields (registry keys, import names) in the caller.

## Acceptance Criteria
- All scanner outputs remain identical to current behavior.
- `module-registry.ts` uses a shared scanning helper for all filesystem scans (no duplicated directory walk logic).
- App overrides continue to win over package sources when keys collide.

## Testing
- Run module registry generation (`npm run modules:prepare`) and verify no diff in generated files for an unchanged workspace.
- Spot-check at least one module with app overrides for each scan type (widgets, subscribers, workers, routes, translations).

## Changelog

### 2026-01-29
- Expanded to centralize all module registry scanners, not only widgets.
