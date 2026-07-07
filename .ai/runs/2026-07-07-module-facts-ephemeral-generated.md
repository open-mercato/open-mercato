# Make the monorepo module-facts artifact ephemeral (move out of `apps/mercato/src/`)

Source spec: .ai/specs/2026-06-27-ts-morph-module-fact-sheets.md (amends decision D4)

## Goal

Resolve the incoherent state of `apps/mercato/src/module-facts.generated.json` — simultaneously git-tracked, listed in `.gitignore` (line 146), and spec-mandated as a committed artifact — by making it **ephemeral**: `yarn generate` writes it to the standard git-ignored output directory `apps/mercato/.mercato/generated/`, and the committed copy is removed.

## Rationale (maintainer decision, 2026-07-07)

Spec D4 committed the file to `src/` "for first-party consumers (`om-onboarding`, the BC guard)". Verified on `origin/develop` that **no code consumes the committed copy**:

- The BC guard test (`packages/cli/src/lib/generators/__tests__/module-facts.bc-guard.test.ts`) re-extracts facts from `packages/core/src/modules` via `extractAllModuleFacts()` — it never reads the committed JSON.
- `agentic-setup.ts` reads the **create-app bundled** `module-facts.json` (`dist/agentic/guides/`), a different artifact on a different path — unaffected.
- No skill, script, or doc reads `apps/mercato/src/module-facts.generated.json`.

The maintainer (Piotr) explicitly decided to supersede D4's committed-artifact choice. The gitignore entry (added but ineffective for an already-tracked file) is what produced the permanent `M apps/mercato/src/module-facts.generated.json` churn in every working tree.

## Scope

- `packages/cli/src/lib/generators/module-facts-generate.ts` — output path + JSDoc.
- `apps/mercato/src/module-facts.generated.json` — `git rm`.
- `.gitignore` — drop the now-redundant line 146 (`.mercato` at line 70 already covers the new location).
- `.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md` — amend D4, §5 Invocation, §7 wiring line; add dated changelog entry.

## Non-goals

- The create-app bundle flow (`dist/agentic/guides/module-facts.json`, `build.mjs`, `shared.ts`, `agentic-setup.ts`) — untouched.
- Historical records (`.ai/runs/2026-06-30-ts-morph-module-fact-sheets/*`, `.ai/specs/analysis/ANALYSIS-2026-06-27-*.md`) — they document what was true at implementation time and are not rewritten.
- `official-modules.generated.ts` — a genuinely consumed versioned registry; stays in `src/` per its own spec.
- Extractor logic, allowlist, output shape — unchanged.

## Risks

- **Consumers added later that read the committed path**: mitigated by repo-wide grep for the old path in this run; none exist today.
- **`yarn clean-generated` wipes the artifact**: by design — `yarn generate` recreates it; nothing reads it between those points.
- **Spec/doc drift**: spec D4 amended in the same PR with a dated changelog entry.

## Implementation Plan

### Phase 1: Code + repo state

- 1.1 Point `generateModuleFacts` output at `resolver.getOutputDir()` (i.e. `apps/mercato/.mercato/generated/module-facts.generated.json`) and update its JSDoc.
- 1.2 `git rm apps/mercato/src/module-facts.generated.json` and delete `.gitignore` line `apps/mercato/src/module-facts.generated.json`.

### Phase 2: Spec amendment

- 2.1 Amend spec D4, §5 Invocation, and §7 wiring to record the ephemeral location; add 2026-07-07 changelog entry.

### Phase 3: Validation

- 3.1 Run `yarn generate` in the worktree; assert the file lands at `apps/mercato/.mercato/generated/module-facts.generated.json`, nothing writes to `apps/mercato/src/`, and `git status` is clean of it.
- 3.2 Run module-facts test suites (`packages/cli`, `packages/create-app`) + typecheck + full gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Code + repo state

- [x] 1.1 Point generateModuleFacts output at resolver.getOutputDir() and update JSDoc — 1b041eed1
- [x] 1.2 git rm the committed JSON and drop the .gitignore line — 1b041eed1

### Phase 2: Spec amendment

- [ ] 2.1 Amend spec D4/§5/§7 and add changelog entry

### Phase 3: Validation

- [ ] 3.1 yarn generate writes to .mercato/generated and git status is clean
- [ ] 3.2 Test suites, typecheck, and full gate pass
