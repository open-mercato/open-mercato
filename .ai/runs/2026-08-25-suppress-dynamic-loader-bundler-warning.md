# Suppress dynamic-loader bundler warning

## Goal

Stop Next.js/Turbopack from pulling the standalone bootstrap loader into the application graph and repeatedly reporting `Module not found: Can't resolve <dynamic>`, while preserving standalone MCP/CLI registry loading.

## Scope

- Separate the app-source compiler from the runtime module importer in `@open-mercato/shared`.
- Point the AI generated-registry fallback at the compiler-only entry point.
- Preserve the existing `dynamicLoader` exports for backward compatibility.
- Add regression coverage for the dependency boundary and existing standalone compilation behavior.

## Non-goals

- Change authentication behavior behind the unrelated `feature-check` 401 responses.
- Change module override matching or the unrelated `example.manage` warning.
- Change generated registry formats, AI agent/tool contracts, or runtime API responses.

## Implementation Plan

### Phase 1: Isolate the compiler boundary

- Move the reusable app-source compiler and its cache/esbuild lifecycle into a compiler-only bootstrap module.
- Keep compatibility re-exports on the established dynamic-loader import path.
- Update the AI generated-registry fallback to import only the compiler module.

### Phase 2: Regression coverage and verification

- Add focused tests that protect the compiler-only dependency boundary and standalone registry behavior.
- Reproduce the affected Next.js route compilation without the dynamic import warning.
- Run the configured validation gate and complete both review passes.

## Risks

- The compiler cache and esbuild lifecycle are shared by CLI bootstrap and standalone AI registry loading; moving them must preserve cache invalidation and service shutdown semantics.
- A source-only assertion could miss a warning introduced through another import path, so validation includes a real Next.js build/route compilation check.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Isolate the compiler boundary

- [ ] 1.1 Extract the compiler-only module while preserving dynamicLoader compatibility
- [ ] 1.2 Route the AI registry fallback through the compiler-only entry point

### Phase 2: Regression coverage and verification

- [ ] 2.1 Add and run focused regression coverage
- [ ] 2.2 Run the full validation and review gates
