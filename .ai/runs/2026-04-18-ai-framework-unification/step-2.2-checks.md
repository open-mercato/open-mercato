# Step 2.2 — Verification

**Step:** 2.2 — Spec Phase 0, generator extension for `ai-agents.ts`; emit additive `ai-agents.generated.ts`.
**Code commit:** `89cbbe56a` — `feat(cli): add ai-agents.generated.ts generator extension`.
**Scope:** `packages/cli` only. One new extension, one registry wire-up, four test-file updates.

## What landed

- New `packages/cli/src/lib/generators/extensions/ai-agents.ts`. Mirrors
  the shape of `createAiToolsExtension()` (same scanner primitives, same
  emission pipeline), emits `ai-agents.generated.ts` with
  `aiAgentConfigEntriesRaw`, exported `aiAgentConfigEntries` (filtered to
  non-empty), and exported `allAiAgents` (flattened).
- Registered in `packages/cli/src/lib/generators/extensions/index.ts`
  (slotted right after `createAiToolsExtension()` so the registry module
  picks it up without any other wiring — `module-registry.ts` iterates
  `loadGeneratorExtensions()` and writes each extension's outputs).
- Fixture + assertions added to the three integration-style generator
  test suites:
  - `__tests__/structural-contracts.test.ts` — new
    `ai-agents.generated.ts` `describe` block (exports
    `aiAgentConfigEntries` + `allAiAgents`, orders module entry carries
    an `agents:` property).
  - `__tests__/module-subset.test.ts` — `ai-agents.generated.ts` added
    to the expected-files list; new "empty when no module provides
    `ai-agents.ts`" case.
  - `__tests__/output-snapshots.test.ts` — `ai-agents.generated.ts`
    added to the `registryFiles` stability list; orders fixture gains
    an `ai-agents.ts` export.
  - `__tests__/scanner.test.ts` — `ai-agents.ts` added to the
    convention-file override-precedence coverage list.

## BC contract surface review

Cross-checked the 13 categories in `BACKWARD_COMPATIBILITY.md`:

- §1 Auto-discovery file conventions: **additive** — `ai-agents.ts` is a
  new optional convention file; no existing file name / export name /
  routing algorithm moved or renamed.
- §13 Generated file contracts: **additive** — `ai-agents.generated.ts`
  is new. Existing `ai-tools.generated.ts` output is untouched (string
  diff of the `createAiToolsExtension` module: zero lines changed).
  Export names (`aiAgentConfigEntries`, `allAiAgents`) are new and
  follow the established `aiToolConfigEntries` / `allAiTools` pattern,
  so downstream callers can adopt them the same way.
- §2/§3/§4/§5/§6/§7/§8/§9/§10/§11/§12: no change — no types exported,
  no function signatures modified, no import paths moved, no event IDs,
  no widget spot IDs, no API routes, no schema, no DI service keys, no
  ACL features, no notification type IDs, no CLI commands touched.

## Verification

- **Unit tests:**
  - `yarn jest --config=jest.config.cjs src/lib/generators/__tests__/structural-contracts.test.ts`
    → **1 suite, 98 tests, all passing** (new `ai-agents.generated.ts`
    describe block: 2/2 green, full suite: 98/98 green, 5.787 s).
  - `yarn jest --config=jest.config.cjs src/lib/generators/__tests__/module-subset.test.ts
    src/lib/generators/__tests__/scanner.test.ts
    src/lib/generators/__tests__/output-snapshots.test.ts`
    → **3 suites, 78 tests, all passing** (1.751 s). Includes the new
    `module-subset.test.ts` empty-ai-agents case.
- **Typecheck:** package-level typecheck for `@open-mercato/cli` is
  `tsc --noEmit`; it was not re-run in this Step because the package
  currently carries pre-existing failures in unrelated files (same
  cross-package diagnostics already documented in Step 2.1). The
  touched files are internally consistent (Jest uses `ts-jest`, so the
  full test pass implies type-clean at least under the test runner's
  TS config). No new `any` types, no new BC-impact surface, no new
  cross-package imports.
- **Generate:** N/A. `yarn generate` would emit the new file into
  `apps/mercato/.mercato/generated/ai-agents.generated.ts`, but that
  output is itself generator output — committing it would bake a
  snapshot into this PR, which subsequent Steps (2.3+) would regenerate
  anyway. Current discipline for generator-extension-only Steps in this
  repo is to assert shape via tests and leave re-generation to the
  normal `yarn generate` lifecycle.
- **i18n:** N/A (no strings added).
- **Playwright:** N/A (no UI surface).

## Follow-ups / notes

- Step 2.3 will restore loading of `ai-tools.generated.ts` at runtime,
  then wire `ai-agents.generated.ts` through the Step 3.1 agent-registry
  loader. No changes to this Step's output shape are expected.
- `allAiAgents` is intentionally untyped in the generated file
  (`unknown[]` flattens into an untyped array) because the strong
  typing lives on the consumer side via the `AiAgentDefinition` type
  from `@open-mercato/ai-assistant` (Step 2.1). The loader in Step 3.1
  will do the runtime cast + validation.
