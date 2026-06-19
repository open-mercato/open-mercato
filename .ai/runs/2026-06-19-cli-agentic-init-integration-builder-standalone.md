# Execution Plan: copy om-integration-builder STANDALONE.md in agentic:init scaffolder

## Goal

Make the CLI agentic scaffolder (`mercato agentic:init` → `packages/cli/src/lib/agentic-setup.ts`) copy `ai/skills/om-integration-builder/STANDALONE.md` into scaffolded apps, so the integration test `TC-INT-008` passes again on `develop`.

## Scope

- `packages/cli/src/lib/agentic-setup.ts` — add a conditional copy of the `om-integration-builder` `STANDALONE.md` next to the existing `SKILL.md` / `references/adapter-contracts.md` copies.

### Non-goals

- No change to the create-app wizard scaffolder (`packages/create-app/src/setup/tools/shared.ts`) — it already copies this file (PR #3088).
- No change to `TC-INT-008.spec.ts` — the test is correct; the scaffolder is the defect.
- No change to the source skill files.

## Root cause (pre-diagnosed)

- PR #3085 added `packages/create-app/agentic/shared/ai/skills/om-integration-builder/STANDALONE.md` but taught neither scaffolder to copy it.
- PR #3088 patched only the create-app wizard scaffolder (`shared.ts`), missing the CLI scaffolder (`agentic-setup.ts`).
- `TC-INT-008` enumerates every file under `packages/create-app/agentic/shared` and asserts the CLI scaffolder copies each one; the uncopied STANDALONE.md makes `missingPaths` non-empty → deterministic failure on shard `ephemeral-integration (3/15)`, blocking unrelated PRs (#3338, #3334).

## Risks

- Very low. One-file, additive copy mirroring an already-shipped pattern. No contract surface touched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix scaffolder + verify

- [x] 1.1 Add conditional STANDALONE.md copy for om-integration-builder in agentic-setup.ts — 0699704b4
- [x] 1.2 Build CLI package and run affected unit + integration tests, typecheck — 0699704b4 (agentic-init.test.ts 12/12, TC-INT-008 passing, cli typecheck clean)
