# Standalone Experimental Hooks Validator

## Goal

Make the standalone harness gate-evidence/typecheck validator hooks opt-in instead of installing them by default. Users can enable the experimental validator explicitly during agentic setup or through `OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR`.

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`

## Scope

- Add an additive `--experimental-hooks-validator` option to `create-mercato-app` and `mercato agentic:init`.
- Resolve the option from `OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR` when the flag is absent.
- Exclude gate-evidence registrations and scripts by default for Claude Code, Codex, and Cursor while preserving their non-validator agentic assets and hooks.
- Keep create-app and CLI agentic setup output in parity, including ownership-aware harness updates.
- Document the opt-in environment variable in the application and create-app template `.env.example` files.
- Add regression coverage for default-disabled, flag-enabled, and environment-enabled setup.

## Non-goals

- Change gate-evidence matching, recording, or stop-decision semantics.
- Remove the experimental hook implementations from the source distribution.
- Change the standalone harness evaluation catalog or release matrix.
- Apply database migrations or change runtime application behavior.

## Implementation Plan

### Phase 1: Option and generator contract

1. Add and propagate the experimental validator option through both setup entrypoints.
2. Gate emitted hook registrations, hook scripts, ownership manifests, and setup summaries while preserving tool parity.

### Phase 2: Documentation and regression coverage

1. Document the environment opt-in in both required `.env.example` surfaces and update the standalone harness spec changelog/compatibility notes.
2. Add focused tests for default-disabled and explicit/env-enabled generation across create-app and CLI setup.

### Phase 3: Verification and delivery

1. Run targeted package tests and the configured validation gate in the repository-selected runner mode.
2. Complete automated PR review/autofix, publish the final PR summary, and mark the PR ready.

## Risks

- Ownership-aware updates must retire only unmodified previously generated validator assets; locally modified files must remain preserved by the existing manifest conflict behavior.
- Configuration files that also register non-experimental hooks must be filtered without disabling those stable hooks.
- The additive CLI flag must behave identically in fresh scaffolds and later `agentic:init` runs.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Option and generator contract

- [x] 1.1 Add and propagate the experimental validator option through both setup entrypoints — 0977f8a39
- [x] 1.2 Gate emitted hook registrations, hook scripts, ownership manifests, and setup summaries while preserving tool parity — 0977f8a39

### Phase 2: Documentation and regression coverage

- [ ] 2.1 Document the environment opt-in and update the standalone harness spec
- [ ] 2.2 Add focused default-disabled and opt-in regression tests across create-app and CLI setup

### Phase 3: Verification and delivery

- [ ] 3.1 Run targeted package tests and the configured validation gate
- [ ] 3.2 Complete automated PR review/autofix and final PR handoff
