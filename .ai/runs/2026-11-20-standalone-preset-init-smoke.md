# Standalone preset initialization smoke test

## Goal

Verify that each shipped standalone preset can generate its registries, migrate a fresh database, and finish initialization using compiled Open Mercato packages.

## Scope

Cover classic, empty, CRM, and WMS through the standalone app runner. Address initialization failures reproduced on main within this scope.

Source doc: .ai/specs/2026-11-05-issue-8784-module-dependency-integrity.md

## Implementation plan

1. Compare the released bug with current main and exercise the four presets on isolated databases.
2. Add a reusable smoke test and run the focused and repository validation gates.

## Risks

Each preset needs an isolated database so previous setup runs cannot hide missing migrations or registrations. Package installation and PostgreSQL startup determine smoke-test runtime.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline

- [ ] 1.1 Verify standalone preset initialization on main

### Phase 2: Regression coverage

- [ ] 2.1 Add standalone initialization smoke coverage for the shipped presets
- [ ] 2.2 Run validation and review the PR
