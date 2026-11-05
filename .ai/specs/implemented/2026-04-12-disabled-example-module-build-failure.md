# Disabled Example Module Must Not Break Build

## TLDR

- Reproduced on April 12, 2026: removing `example` from [`apps/mercato/src/modules.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules.ts:52) and running `yarn generate` followed by `yarn workspace @open-mercato/app typecheck` still fails.
- The current failure is broader than issue #601 originally described:
  - missing generated entity modules such as `@/.mercato/generated/entities/todo`
  - missing generated entity ID registry members such as `E.example.todo`
  - cascading failures in `example_customers_sync`, because its source still exists even when `example` is disabled
- The root problem is not only generator output. The app TypeScript program still includes all `src/modules/**` source files via [`apps/mercato/tsconfig.json`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/tsconfig.json:14), while generation only emits artifacts for enabled modules.
- The collaborator hypothesis from February 19, 2026 is no longer fully accurate. Customers still contains legacy compatibility for `example:todo`, but the build failure today comes from compiling disabled app module source, not from Sales or Customers directly importing Example module implementation files.
- Recommended fix for this issue: **keep the current generator architecture and make disabled app modules compile safely**. Do not pursue a full TypeScript/Next compilation-graph exclusion strategy in this issue.

## Overview

Issue [#601](https://github.com/open-mercato/open-mercato/issues/601) reports that disabling the Example module causes the app build to fail. This remains reproducible in the current codebase.

The simplest accurate framing is:

1. `enabledModules` controls module discovery and code generation.
2. The app TypeScript config still compiles all source files under `src/`.
3. Disabled modules still contain imports of generated files and generated entity ID members that disappear when the module is removed from `enabledModules`.
4. TypeScript fails before runtime.

This spec proposes a focused fix that avoids changing Next.js compilation behavior or redesigning the generator system. The issue can be solved by preventing disabled modules from hard-failing compilation when their generated outputs are absent and by removing stale conditional-module coupling where appropriate.

## Problem Statement

### Reproduction

Observed on April 12, 2026:

1. Remove `{ id: 'example', from: '@app' }` from [`apps/mercato/src/modules.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules.ts:52).
2. Run `yarn generate`.
3. Run `yarn workspace @open-mercato/app typecheck`.

Result:

- TypeScript still compiles `src/modules/example/**` and `src/modules/example_customers_sync/**`.
- Generated example entity files are no longer emitted.
- `entities.ids.generated.ts` no longer contains `E.example.*`.
- Typecheck fails with `TS2307` and `TS2339`.

### Concrete current failure points

All files that fail typecheck when `example` is disabled:

- [`apps/mercato/src/modules/example/api/todos/route.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example/api/todos/route.ts:6) imports `@/.mercato/generated/entities/todo` (field selectors) and reads `E.example.todo` at 6 call sites
- [`apps/mercato/src/modules/example/api/customer-priorities/route.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example/api/customer-priorities/route.ts:5) imports `@/.mercato/generated/entities/example_customer_priority` and reads `E.example.example_customer_priority` at 2 call sites
- [`apps/mercato/src/modules/example/commands/todos.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example/commands/todos.ts:19) imports `E` and reads `E.example.todo` at 9 call sites (lines 63, 65, 71, 99, 163, 220, 306, 425, 535) — the heaviest user
- [`apps/mercato/src/modules/example/cli.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example/cli.ts:7) imports `E` and reads `E.example.todo` at line 110
- [`apps/mercato/src/modules/example_customers_sync/lib/sync.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example_customers_sync/lib/sync.ts:16) imports `E` via relative path and reads `E.example.todo` at line 315

Additionally, [`apps/mercato/src/modules/example_customers_sync/lib/sync.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example_customers_sync/lib/sync.ts:17) has a direct source import `import { Todo } from '../../example/data/entities'`. This does not cause a typecheck failure (entity source files exist regardless of enablement), but it represents tight cross-module coupling and a runtime dependency.

Note: [`apps/mercato/src/modules/example/api/organizations/route.ts`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/modules/example/api/organizations/route.ts:3) also imports from generated files, but uses `E.directory.organization` and `@/.mercato/generated/entities/organization` — both from the always-enabled directory module. It does not break when example is disabled.

### Why the original issue framing is incomplete

The original issue correctly identified that disabled-module source still compiles and references missing generated outputs. However, the failure is wider than “missing generated entity file for todo.”

There are now three separate break types:

1. Missing generated entity selector modules.
2. Missing `E.example.*` entity ID members.
3. Conditional companion module source (`example_customers_sync`) still compiling when its parent module is disabled.

## Current-State Analysis

### Is pkarw's February 19, 2026 comment still true?

Partially, but not enough to justify the larger architectural fix.

What is still true:

- Customers still contains legacy compatibility for `example:todo`.
- Legacy customer todo links still default to `example:todo` in some migration history and compatibility helpers.
- Customer dashboards and detail views can still resolve links for `example:todo`.
- `example_customers_sync` still exists as an optional bridge between canonical customer interactions and example todos.

Relevant examples:

- [`packages/core/src/modules/customers/lib/interactionCompatibility.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/lib/interactionCompatibility.ts:8)
- [`packages/core/src/modules/customers/lib/todoCompatibility.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/lib/todoCompatibility.ts:183)
- [`packages/core/src/modules/customers/components/detail/utils.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/components/detail/utils.ts:36)
- [`packages/core/src/modules/customers/api/dashboard/widgets/customer-todos/route.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/modules/customers/api/dashboard/widgets/customer-todos/route.ts:58)

What is no longer true in the way the comment implied:

- The reproduced build failure is not caused by Sales or Customers directly importing Example module implementation files.
- The failure occurs even before any runtime compatibility matters, because disabled app module source is still typechecked.
- Therefore, “remove Sales/Customers direct link to Example” would not, by itself, fix the current build failure.

Conclusion:

- The comment identifies real historical coupling that should continue to be reduced over time.
- It does **not** describe the primary root cause of issue #601 in the current codebase.
- Because of that, a generator/compilation architecture change is not justified as the default solution for this issue.

## Proposed Solution

Choose the simpler option:

### Option A — Recommended

Make disabled app modules compile safely without redesigning generator/Next.js compilation boundaries.

This fix has three parts:

1. Remove or guard direct generated-import usage in disabled-prone Example module files where the generated artifact disappears when the module is disabled.
2. Ensure companion app modules such as `example_customers_sync` do not produce type errors when `example` is disabled.
3. Add a regression test that explicitly disables `example`, regenerates module output, and verifies app typecheck succeeds.

### Explicitly not chosen in this spec

Do **not** implement “exclude disabled modules from the app TS/Next compilation graph” here.

Reasons:

- Higher complexity across TypeScript, Next.js, discovery conventions, and build tooling.
- Higher risk of accidental backward compatibility regressions on module auto-discovery.
- Solves a framework-level problem that is larger than the concrete issue being fixed.
- Not necessary to resolve the currently reproduced bug.

## Architecture

### Design direction

The architecture of the module generator remains unchanged.

We keep:

- `enabledModules` as the source of generated registry output
- existing auto-discovery conventions
- existing app TypeScript include behavior

We change only the disabled-module failure surface.

### Implementation strategy

#### 1. Example module code must not require absent generated artifacts to typecheck when disabled

Audit `apps/mercato/src/modules/example/**` for:

- imports from `@/.mercato/generated/entities/*`
- direct `E.example.*` usage that assumes the generated registry always contains Example

Replace these assumptions with one of the following patterns, preferring the least invasive option per file:

- use non-generated string entity IDs where the contract is static and already declared in source, for example `'example:todo'`
- resolve generated registry members at runtime only in enabled execution paths, not at import-time/module-evaluation time
- avoid importing generated field selector modules in files that remain in the app source tree when disabled

This issue does not require a universal abstraction for every module. The fix may stay scoped to `example` and its companion module.

#### 2. `example_customers_sync` must degrade safely when `example` is disabled

Today `example_customers_sync` is only pushed into `enabledModules` when `example` is enabled, but its source still compiles because it remains under `src/modules/`.

We must ensure:

- no file in `example_customers_sync` hard-depends on `E.example.*` at typecheck time when Example is disabled
- routes, workers, and subscribers in that module remain inert when not generated, without causing compile errors

#### 3. Preserve runtime behavior for enabled Example module

When `example` is enabled:

- current Example CRUD routes still work
- current Example widgets still work
- current Example customer sync still works
- generated entities and ID registries continue to be used where they are present and beneficial

### Non-goals

- Generalized disabled-module compilation filtering for every module in the framework
- Removing all `example:todo` compatibility from Customers
- Redesigning the generator output model
- Data migration away from historical `example:todo` records

## Data Models

No schema changes are required for the primary fix.

Existing data compatibility remains intact:

- `customer_todo_links.todo_source` may still contain `example:todo`
- customer compatibility helpers may still resolve `example` task links
- `example_customers_sync` data remains valid when the module is enabled

If future cleanup removes legacy Example coupling from Customers, that should happen under a separate spec with migration and compatibility review.

## API Contracts

No public API route URL changes are proposed.

When `example` is disabled:

- Example routes are not generated and therefore remain unavailable at runtime, as today.
- The app build/typecheck must still succeed.

When `example` is enabled:

- `/api/example/todos` behavior must remain unchanged
- `/api/example/customer-priorities` behavior must remain unchanged
- `example_customers_sync` routes must remain unchanged

This preserves backward compatibility on contract surfaces.

## Implementation Plan

### Phase 1 — Code audit and decoupling

Audit and patch:

- `apps/mercato/src/modules/example/api/*`
- `apps/mercato/src/modules/example/commands/*`
- `apps/mercato/src/modules/example/cli.ts`
- `apps/mercato/src/modules/example_customers_sync/**/*`

Acceptance criteria:

- disabling `example` no longer produces compile-time imports of absent generated entity selector modules
- disabling `example` no longer produces `E.example.*` type errors

### Phase 2 — Regression coverage

Add a regression test in CLI/app build tooling that:

1. temporarily disables `example`
2. runs generation
3. runs app typecheck
4. asserts success

Acceptance criteria:

- issue #601 becomes reproducible by test before the fix and green after the fix

### Phase 3 — Documentation refresh

Refresh references that imply a different root cause or outdated command shape where touched by this work.

Acceptance criteria:

- issue commentary in code/docs reflects the actual source of failure
- touched docs prefer `yarn generate` where appropriate instead of stale `yarn modules:prepare` wording

## Integration Coverage

This fix must cover the following affected paths.

### Build and generation paths

- `yarn generate`
- `yarn workspace @open-mercato/app typecheck`
- optionally `yarn build:app` as a final smoke check if practical

### API paths to verify when `example` is enabled

- `/api/example/todos`
- `/api/example/customer-priorities`
- `/api/example-customers-sync/mappings`
- `/api/example-customers-sync/reconcile`

### UI paths to verify when `example` is enabled

- `/backend/todos`
- `/backend/todos/create`
- `/backend/todos/:id/edit`
- customer dashboard/widget surfaces that show legacy or canonical todo links

### Disabled-module behavior to verify

- with `example` removed from `enabledModules`, app typecheck succeeds
- no Example API routes are generated
- no Example customer sync routes are generated
- unrelated modules continue to build

## Testing Strategy

### Automated

- Add a regression test covering disable-example → generate → app typecheck.
- Keep the test self-contained and restore any modified module-enable state in cleanup.
- Prefer a CLI/generator-oriented test if it can validate the real failure mode without over-coupling to Next build internals.

### Manual

1. Enable `example` and confirm Example routes/UI still work.
2. Disable `example` and run:
   - `yarn generate`
   - `yarn workspace @open-mercato/app typecheck`
3. Re-enable `example` and confirm the workspace returns to a healthy generated state.

## Risks & Impact Review

### Risk 1 — Hidden runtime dependency remains after compile-time fix

- Severity: Medium
- Affected area: Example module runtime behavior
- Scenario: code stops failing at typecheck but still assumes generated artifacts exist at runtime
- Mitigation: verify enabled-module paths with route smoke tests; keep changes scoped and explicit
- Residual risk: Low to medium

### Risk 2 — Over-scoped cleanup breaks Example module behavior when enabled

- Severity: Medium
- Affected area: Example CRUD, widgets, sync bridge
- Scenario: replacing generated references too aggressively alters query/indexing behavior
- Mitigation: prefer minimal edits and verify Example APIs after changes
- Residual risk: Medium

### Risk 3 — Regression test becomes flaky because it mutates module state

- Severity: Medium
- Affected area: test tooling
- Scenario: test modifies `enabledModules` and fails to restore state
- Mitigation: isolate via fixture copy or temporary file rewrite with guaranteed cleanup
- Residual risk: Low

### Risk 4 — Framework-level problem remains for other future modules

- Severity: Low to medium
- Affected area: future optional app modules
- Scenario: another disabled app module later reproduces the same pattern
- Mitigation: document the constrained fix honestly; if the pattern repeats, open a separate framework spec for compilation-graph exclusion
- Residual risk: Medium

## Migration & Backward Compatibility

- No API URL changes.
- No event ID changes.
- No ACL feature ID changes.
- No database schema changes.
- No generated file contract changes are required by this spec.

This is a backwards-compatible bug fix scoped to app-module disablement behavior.

## Final Compliance Report

### Simplicity First

Pass. The proposed fix resolves the reproduced issue without re-architecting module generation or app compilation.

### No Laziness

Pass. The spec reflects the actual April 12, 2026 repro instead of relying on the older issue summary alone.

### Minimal Impact

Pass. Changes are scoped to Example app module code, its companion sync module, and regression coverage.

### Backward Compatibility

Pass. No contract surfaces are intentionally changed.

### Recommendation

Proceed with the simple fix in this spec. If a second or third optional app module later hits the same pattern, open a follow-up framework spec for disabled-module compilation exclusion across the whole app.

## Changelog

- 2026-04-12: Created spec after reproducing issue #601 on current `develop`, confirming the bug still exists and narrowing the recommended fix to a local disabled-module compatibility change rather than a generator/Next.js architecture redesign.
- 2026-04-12: Spec review — added missing failure points (`commands/todos.ts` with 9 `E.example.todo` sites, `cli.ts` with 1 site), documented `sync.ts` direct source import of `Todo` entity, clarified that `organizations/route.ts` is unaffected (uses `E.directory.organization`). No architectural changes to proposed solution.
