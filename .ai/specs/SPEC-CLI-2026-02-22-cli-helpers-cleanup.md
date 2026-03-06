# SPEC-XXX-2026-02-22-cli-helpers-cleanup.md

## CLI Helpers Cleanup - Centralization

**Scope:** Refactor scattered CLI helper functions across packages into centralized utilities in `@open-mercato/cli`

**Related Issue:** #310

---

## Overview

CLI helper functions are currently duplicated across multiple modules:
- `parseArgs()` - argument parsing (found in example/cli.ts, customers/cli.ts, etc.)
- Console logging patterns
- Error handling
- Progress indicators

## Proposed Solution

### 1. Create centralized CLI utilities in `@open-mercato/cli/src/lib/helpers/`

**Files to create:**
- `args.ts` - Argument parsing utilities
- `logger.ts` - Structured logging (info, error, warn, success)
- `progress.ts` - Progress bar and spinner utilities
- `validation.ts` - Input validation helpers
- `index.ts` - Re-exports

### 2. Refactor existing CLI modules to use centralized helpers

**Modules to update:**
- `apps/mercato/src/modules/example/cli.ts`
- `packages/core/src/modules/customers/cli.ts`
- `packages/core/src/modules/sales/cli.ts`
- `packages/core/src/modules/catalog/cli.ts`
- `packages/core/src/modules/workflows/cli.ts`
- `packages/core/src/modules/staff/cli.ts`
- `packages/core/src/modules/attachments/cli.ts`
- `packages/core/src/modules/configs/cli.ts`
- `packages/scheduler/src/modules/scheduler/cli.ts`
- `packages/search/src/modules/search/cli.ts`

### 3. Migration Strategy

1. Create centralized helpers
2. Add deprecation warnings to old patterns
3. Refactor one module as reference
4. Create codemod/script for bulk migration
5. Update remaining modules
6. Remove deprecated code

## Implementation Plan

### Phase 1: Core utilities
- Create `packages/cli/src/lib/helpers/args.ts`
- Create `packages/cli/src/lib/helpers/logger.ts`
- Create `packages/cli/src/lib/helpers/index.ts`

### Phase 2: Example module refactor
- Refactor `apps/mercato/src/modules/example/cli.ts`
- Add tests

### Phase 3: Core modules
- Refactor customers, sales, catalog CLI modules

### Phase 4: Remaining modules
- Refactor all remaining CLI modules

## Testing

- Unit tests for each helper
- Integration tests for refactored CLI commands
- Verify no regression in CLI behavior

## Acceptance Criteria

- [ ] No duplicate `parseArgs` implementations
- [ ] All CLI modules use centralized logger
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes to CLI interface

---

**Created by:** Jan Koperek  
**Date:** 2026-02-22
