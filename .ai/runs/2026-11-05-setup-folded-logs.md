# Fold setup and infrastructure logs

## Goal
Make yarn setup and starter infrastructure output coherent with yarn dev and dev:greenfield: compact progress, a collapsible debug-log panel, and consistent emoji statuses.

## Scope
Starter step runner, subprocess output, infrastructure entry points, and focused Node tests/documentation. Preserve prompts, diagnostic guides, credentials shown at initialization, non-interactive logs, and process exit behavior.

Non-goals: changing service provisioning, database behavior, dev runtime behavior, dependencies, or provider configuration.

Source doc: .ai/specs/2026-07-19-unified-starter-package.md

## Implementation Plan

### Phase 1: Compact setup output
1.1 Add a stdlib-only collapsible log controller and consistent starter status styling.
1.2 Wire setup and infrastructure subprocesses into the controller while preserving interactive prompts and failure diagnostics.

### Phase 2: Verification and delivery
2.1 Add regression coverage and demonstrate compact, expanded, non-TTY, and failure behavior.
2.2 Run the configured validation gate, review the PR, and publish the result.

## Risks
Raw-mode input must be restored before prompts and dev handoff. Synchronous subprocesses cannot service keyboard input and must use asynchronous streaming where folding is active. Full repository validation may depend on local dependencies and services; report concrete blockers.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Compact setup output

- [ ] 1.1 Add a stdlib-only collapsible log controller and consistent starter status styling.
- [ ] 1.2 Wire setup and infrastructure subprocesses into the controller while preserving interactive prompts and failure diagnostics.

### Phase 2: Verification and delivery

- [ ] 2.1 Add regression coverage and demonstrate compact, expanded, non-TTY, and failure behavior.
- [ ] 2.2 Run the configured validation gate, review the PR, and publish the result.
