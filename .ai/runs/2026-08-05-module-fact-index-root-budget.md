# Scale the generated standalone root past its module-fact ceiling

Fixes: #4986
Related: #4983, #4391

## Goal

Make the scaffolded app's generated `AGENTS.md` stay inside its 12 KiB root target no matter how many modules the template enables, and remove the hard-coded module-count tripwire that blocks any template addition (`channel_discord` being the module that hit it first).

## Scope

In scope — the budget mechanism itself:

- Budget-aware rendering of the enabled-module fact index in both harness generators.
- Enforcement at the only point where the final root size is known: after every tool generator has patched `AGENTS.md`, before the ownership manifest hashes it.
- Replacing `assert.equal(classicFactModules.length, 49)` with assertions that scale.

Out of scope:

- Enabling `channel_discord` in the template. `packages/channel-discord` does not exist on `develop` — PR #4391 is still open — so the template neither enables nor installs it here. The literal symptom described in #4986 lives on that PR's branch; this change removes the ceiling that blocks it.
- Trimming the Three-Axis Context Assembler section (7 440 B of the 12 257 B root). That is a harness-quality change with its own evaluation cost and belongs in its own PR.

## Measurements on `develop` (before the change)

| Scenario | Generated root | Target | Headroom |
|---|---|---|---|
| Classic scaffold (49 fact modules) | 12 257 B | 12 288 B | 31 B |
| + `channel_discord` (50) | 12 275 B | 12 288 B | 13 B |
| + 5 modules (54) | 12 338 B | 12 288 B | **−50 B** |

Worst routed chain (`root + contracts.md + om-module-scaffold + om-data-model-design`) is 27 338 B against Codex's 32 768 B default, so the 12 KiB root target is what binds, not `project_doc_max_bytes` itself.

## Implementation Plan

### Phase 1 — Budget-aware index rendering

1. Export `STANDALONE_ROOT_TARGET_BYTES` and add a `compact` render option to `renderModuleGuidesBlock`, which emits an O(1) pointer form instead of enumerating every id.
2. Thread the option through `injectModuleGuides` (the block stays marker-delimited and idempotent).
3. Add `enforceRootInstructionBudget(agentsMdPath, selected, maxBytes)` — a no-op while the root fits, otherwise a single re-injection in pointer form.

### Phase 2 — Wire it into both generators

4. Call it from the create-app wizard and from the CLI `agentic:init` harness generator, after the tool generators and before `finalizeHarnessManifest`.
5. Keep `packages/cli/src/lib/agentic-setup.ts` byte-identical in behavior to `packages/create-app/src/setup/tools/shared.ts` (generator parity is a hard rule in `packages/create-app/AGENTS.md`).

### Phase 3 — Tests that scale

6. Drop the module-count tripwire; assert instead that the classic scaffold still fits *with its inline index intact*.
7. Add a regression proving a 64-module overflow sheds the index rather than blowing the budget.
8. Add a test proving one more template module (`channel_discord`) still fits with the enumerated index.
9. Extend the create-app ↔ CLI parity test to the compact form and the new enforcement entry point.

## Progress

- [x] Phase 1 — budget-aware rendering in `packages/create-app/src/setup/tools/shared.ts`
- [x] Phase 2 — CLI mirror in `packages/cli/src/lib/agentic-setup.ts`
- [x] Phase 2 — wired into `wizard.ts` and the CLI `generateHarness`
- [x] Phase 3 — `agent-instruction-budget.test.ts` count tripwire replaced, two scaling tests added
- [x] Phase 3 — `agents-md.module-guides.test.ts` parity + enforcement tests added
- [x] Validation gate

## Notes

The generated output is unchanged for today's scaffold: at 49 modules the root still fits, so the enumerated index is kept and the fallback never fires. The mechanism only engages once an app genuinely outgrows the budget.
