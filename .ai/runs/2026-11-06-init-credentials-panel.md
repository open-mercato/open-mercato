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

## Verification and handoff

Runner: local. Implementation and code review complete; full gate remains incomplete.

- PASS: build:packages → generate → build:packages → i18n:check-sync → i18n:check-usage → typecheck.
- PASS: 11 CLI formatter tests, 17 log-policy tests, 15 standalone template tests; compiled CLI to template extraction across 10 width/color combinations; template:sync and diff whitespace check.
- FAIL: yarn test, in unchanged web-research-model Jest configuration: installed TypeScript 7.0.2 does not expose the JavaScript compiler API required by ts-jest. The ordered gate stopped; build:app was not run.
- Code review: prefix wrapping in verbose/classic was fixed centrally in the root initialize command. No remaining code findings; failed full gate remains a blocker.
- Visual evidence uses synthetic accounts, rendered from formatter output: https://raw.githubusercontent.com/open-mercato/open-mercato/qa-evidence-pr-8894/pr-8894/init-credentials-panel.png . This is a rendered preview, not a live database-reset run.
- A live Verdaccio/greenfield/setup initialization was not run. The draft remains in progress until validation can finish. Resume: om-auto-continue-pr 8894.
