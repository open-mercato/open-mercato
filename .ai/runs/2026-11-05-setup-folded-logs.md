# Fold setup and infrastructure logs

## Goal
Make yarn setup and starter infrastructure output coherent with yarn dev and dev:greenfield: compact progress, a collapsible debug-log panel, consistent emoji statuses, and persistent files under .mercato/logs using the dev logging conventions.

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

## Verification

Runner: local. All eight configured validation commands passed. Starter suite: 83 tests passed after review fixes. Real PTY confirms live toggle, prompt input, failure replay, raw-mode restoration, and full saved output. Provider input is absent from the saved file.

Supplemental `yarn test:scripts`: 1337 passed, 17 failed, 3 skipped on this macOS host. Failures require GNU paste/grep/timeout or a Docker Compose plugin under an overridden HOME; no changed starter test failed. Current CI checks at the original implementation head passed.

## Risks
Raw-mode input must be restored before prompts and dev handoff. Synchronous subprocesses cannot service keyboard input and must use asynchronous streaming where folding is active. Full repository validation may depend on local dependencies and services; report concrete blockers.

## Progress
PR: #8838

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Compact setup output

- [x] 1.1 Add a stdlib-only collapsible log controller and consistent starter status styling. — 83b7080f85
- [x] 1.2 Wire setup and infrastructure subprocesses into the controller while preserving interactive prompts and failure diagnostics. — 83b7080f85

### Phase 2: Verification and delivery

- [x] 2.1 Add regression coverage and demonstrate compact, expanded, non-TTY, and failure behavior. — 83b7080f85
- [x] 2.2 Run the configured validation gate, review the PR, and publish the result. — 0b72be2886

Review follow-up: 0b72be2886 persists infrastructure preflight guidance and terminates streamed process trees; final code review has no remaining findings. GitHub blocks author self-approval; independent reviewer approval and manual QA remain required. Rendered real-PTY evidence: https://github.com/open-mercato/open-mercato/tree/qa-evidence-pr-8838/pr-8838.


### Phase 3: Approved stage presentation

- [x] 3.1 Restore original stage headings, emphasize only Expected:, and animate lowercase working… until completion. — f1538d2031
- [x] 3.2 Verify spinner lifecycle, log toggles and prompts; publish the follow-up on PR #8838. — f1538d2031

Phase 3 verification: all 89 starter tests passed; pre-commit translation/template parity and diff checks passed. Real PTY verified active working animation, log toggles, prompt handling, failure replay and terminal restoration. Follow-up review found no remaining issues after ensuring log-write warnings clear the spinner first. Full workspace gate was not repeated for this isolated terminal presentation follow-up; CI remains authoritative for the new head.


### Phase 4: Remove duplicate log output

- [x] 4.1 Replay only newly hidden output, fold silently, and remove the DEBUG LOGS heading from the initial hint. — 0b260251ad
- [x] 4.2 Verify toggles, partial lines, failure reveal and full saved logs; publish the cleanup. — 0b260251ad

Phase 4 verification: 91 starter tests passed; real PTY confirms the initial hint has no heading, hiding is silent and previously displayed compiler output appears only once after a failure reveal. Full saved output and partial-line handling remain covered. Review found no actionable findings.
