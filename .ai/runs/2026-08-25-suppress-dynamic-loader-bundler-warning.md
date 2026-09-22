# Suppress dynamic-loader bundler warning

## Goal

Stop Next.js/Turbopack from pulling the standalone bootstrap loader into the application graph and repeatedly reporting `Module not found: Can't resolve <dynamic>`, while preserving standalone MCP/CLI registry loading.

## Scope

- Keep the existing standalone loader and its public import path unchanged.
- Mark the AI generated-registry fallback import as runtime-only for Webpack and Turbopack.
- Add regression coverage for the bundler boundary.

## Non-goals

- Change authentication behavior behind the unrelated `feature-check` 401 responses.
- Change module override matching or the unrelated `example.manage` warning.
- Change generated registry formats, AI agent/tool contracts, or runtime API responses.

## Implementation Plan

### Phase 1: Protect the runtime-only boundary

- Keep the standalone compiler behind its established dynamic-loader import path.
- Exclude that runtime-only import from Webpack and Turbopack static traversal.
- Verify that the standalone fallback continues loading the compiler at runtime.

### Phase 2: Regression coverage and verification

- Add focused tests that protect the compiler-only dependency boundary and standalone registry behavior.
- Reproduce the affected Next.js route compilation without the dynamic import warning.
- Run the configured validation gate and complete both review passes.

## Risks

- The compiler remains loaded dynamically by standalone MCP/CLI flows, so the bundler hints must not alter native runtime import behavior.
- A source-only assertion could miss a warning introduced through another import path, so validation includes a real Next.js build/route compilation check.

## Progress

PR: #5590 (link: https://github.com/open-mercato/open-mercato/pull/5590)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Isolate the compiler boundary

- [x] 1.1 Extract the compiler-only module while preserving dynamicLoader compatibility — c3a5a29128
- [x] 1.2 Route the AI registry fallback through the compiler-only entry point — c3a5a29128

The extraction experiment was superseded by the narrower runtime-only import boundary in `e4a08d12c9`; the final diff preserves the original shared loader implementation and public path.

### Phase 2: Regression coverage and verification

- [x] 2.1 Add and run focused regression coverage — 8b23c68c8c
- [x] 2.2 Run the full validation and review gates — e4a08d12c9

Review follow-up `f1faae8172` guards both runtime-only import expressions and tightens the regression assertion to pin the bundler directives inside each `import()` call. The focused suite passed 21/21 and a forced Turbopack application build completed without `Can't resolve <dynamic>`.
