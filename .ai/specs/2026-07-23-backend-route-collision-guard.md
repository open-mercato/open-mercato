# Backend Route Collision Guard (`mercato generate`)

## TLDR

`mercato generate` derives each backend page's URL from its folder path but never checks those URLs for uniqueness. Two modules that leave a page un-namespaced (e.g. both ship `backend/[id]/page.tsx`) both emit `/backend/[id]`; the build succeeds, and at runtime one page silently shadows the other while its links 404 — only discoverable by manual click-testing. This spec adds a build-time guard that fails loud on a same-tier cross-module duplicate backend route pattern, mirroring the existing `Duplicate command id` guard in the same generator.

## Status

Proposed — implementation complete on branch `feat/route-pattern-collision-guard`, pending PR against `develop`.

## Problem Statement

In `packages/cli/src/lib/generators/module-registry.ts`, backend page routes are built from the page's path relative to the module's `backend/` folder, and the module id is **not** prefixed for sub-pages:

```
<module>/backend/[id]/page.tsx      → /backend/[id]
<module>/backend/reports/page.tsx  → /backend/reports
```

Nothing tracks the set of emitted patterns, so two different modules can produce the **same URL**. The generated route manifest then contains two entries for one URL; at runtime the router serves one and the other's links 404, with no build-time signal. This was hit repeatedly during a real migration (four modules producing colliding `/backend/[id]`, `/backend/create`, etc.).

The generator already fails loud on the analogous problem for **command ids** (`renderCommandLoadersFile`: `throw new Error("[generate] Duplicate command id …")`), but never applied the same protection to route URLs.

## Proposed Solution

Add a module-scope helper and a per-generator `Map<pattern, moduleId>`:

```ts
function assertUniqueBackendRoutePattern(seen, moduleId, pattern): void {
  if (!pattern.startsWith('/backend/')) return
  const previous = seen.get(pattern)
  if (previous && previous !== moduleId) throw new Error(/* names both modules + fix hint */)
  seen.set(pattern, moduleId)
}
```

- `PageRouteGenerationResult` gains `routePatterns: string[]`; `processPageFiles` (string/registry path) and `processPageFilesAst` (AST/app path) collect each emitted `routePath`.
- Both generator functions — `generateModuleRegistryFromDiscovery` and `generateModuleRegistryAppFromDiscovery` — feed their backend patterns through the helper as modules are processed.
- The error names both colliding modules and tells the author to nest the page under a module-specific folder (`backend/<mod>/…`).

## Design Decisions

- **Backend only.** Frontend page routes derive from folders too, but their semantics differ (a legitimate multi-contributor `/` index) and are out of scope for this guard.
- **Collision detection, not "mis-prefix" warning.** Flat, non-module-prefixed backend routes are intentional (a module may deliberately own a top-level `/backend/<section>` that does not repeat its module id), so warning on a missing module prefix would be a false positive. Only an actual duplicate URL is an error.
- **Same-tier check via `previous !== moduleId`.** Mirrors the command-id guard; the same module re-emitting a pattern is not treated as a collision.

## Why route overrides are unaffected

Page overrides (`overrides.routes.pages`, `PageRouteOverrideDefinition = { loader?, metadata? } | null`) are a **metadata layer** applied to the manifest at **registry time** (`registerBackendRouteManifests` → `applyPageOverridesToManifests`). They never create a second folder-derived `page.tsx`, and the generator does not process them. The guard only inspects folder-derived patterns from the folder scan, so a legitimate override contributes no duplicate pattern and cannot trip the guard. Empirically verified: an override module (base page + metadata override, no duplicate folder page) generates clean, while an accidental dual-folder page throws.

## Alternatives Considered

- **Warn instead of throw.** Rejected — a silent warning is easy to miss, and the failure mode (runtime 404) is exactly what build-time errors exist to prevent. The command-id precedent throws.
- **Structural equivalence (`/backend/[id]` vs `/backend/[slug]`).** Deferred — exact-string equality catches the real, common case (bare folder names like `[id]`) with zero false-positive risk; param-name-only equivalence can be a follow-up.
- **Single instrumentation point via a refactor.** Rejected as scope creep; coordinated with the generator decomposition tracked in #3623 by keeping the change additive.

## Testing

`packages/cli/src/lib/generators/__tests__/route-collision-guard.test.ts`:
- Collision throws via `generateModuleRegistry` (string path) and `generateModuleRegistryApp` (AST path).
- Error names both colliding modules.
- Distinct, namespaced patterns generate unchanged (both emitted).
- A single module owning a pattern does not throw (no false positive).

Verification: 814 existing generator tests pass (including byte-for-byte output snapshots); `typecheck` and `build` clean; a real `yarn generate` on `apps/mercato` completes with no false positive on the live module set.

## Backward Compatibility

Fully backward compatible. The change is additive and only rejects already-broken configurations (two modules claiming one URL). Valid generation is unchanged (proven by unchanged output-snapshot tests and a clean real generate). The single signature change (`processPageFilesAst` now returns `{ routes, routePatterns }`) is internal to the file with both call sites updated.

## Changelog

- **2026-07-23** — Initial spec + implementation: build-time backend route-collision guard in both generator paths, with focused tests. Mirrors the existing duplicate-command-id guard.
