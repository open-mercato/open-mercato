# Initialization credentials panel

Goal: replace misaligned initialization boxes with the approved dark gray terminal panel.

Scope: CLI initialization output and compact dev/setup summary extraction. Preserve account creation, passwords, startup flow, legacy summary extraction, and plain redirected output. No database, web UI, dependency or public CLI command changes.

## Implementation plan

1. Render a width-aware horizontal panel with emojis, dark gray background and light text; integrate into initialization and preserve compact-runner styling.
2. Verify narrow terminals, long values, plain output, startup hints and legacy extraction; run the configured validation gate and review the PR.

## Risks

Terminal widths and piped child output require explicit width/color propagation. Full monorepo validation may require unavailable local infrastructure/dependencies; disclose actual results.

## Progress

PR: #8894

- [x] 1.1 Implement panel and compact summary rendering — 595c7938c
- [ ] 1.2 Verify rendering, validation and code review
