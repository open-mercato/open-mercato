# Fix #7243 — translation-only registration must not replace the module registry under setup overrides

Source issue: https://github.com/open-mercato/open-mercato/issues/7243

## Goal

A translation-only `registerModules()` call (dictionary loader stubs `{ id, translations }`) always merges into the runtime registry, even when `modules.ts` declares a `setup` override for one of the stub modules.

## Scope

- `packages/shared/src/lib/modules/registry.ts` — classify the registration on the INPUT before `applyModuleOverridesToModules`; skip override application for translation-only batches (overrides target runtime contracts only; the runtime list already carries them).
- `packages/shared/src/lib/modules/__tests__/registry.test.ts` — regression (fails before the fix).

## Non-goals

- Override semantics for full registrations.
- The dictionary loader call contract.
- Any exported type/signature (no contract surface touched).

## Risks

- Translation-only batch registered before any full registration keeps raw stubs; the later full registration still applies overrides (unchanged path), so no behaviour lost.

## Progress

PR: #7245

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix and regression

- [x] 1.1 Add failing regression test for setup override + translation-only registration — 478eb76b6
- [x] 1.2 Classify translation-only registration before applying overrides — 440341ae6

### Phase 2: Validation and PR

- [x] 2.1 Run validation gate and open PR
