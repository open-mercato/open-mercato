---
name: om-integration-tests
description: Run and create QA integration tests (Playwright TypeScript), including executing the full suite, converting optional markdown scenarios, and generating new tests from specs or feature descriptions. Use when the user says "run integration tests", "test this feature", "create test for", "convert test case", "run QA tests", or "integration test".
---

# Integration Tests Skill

Run and author executable Playwright integration tests. Tests live in module-local `__integration__` directories (`src/modules/<module>/__integration__/TC-XXX.spec.ts`) and run against a live app via the config at `.ai/qa/tests/playwright.config.ts`. An optional markdown scenario (`.ai/qa/scenarios/TC-*.md`) documents a test but is never required.

## When to use

- The user says "run integration tests", "run QA tests", "test this feature", "create test for", "convert test case", or "integration test".
- Running-only mode: just execute a suite/category/single file, then diagnose any failures — skip authoring.
- Authoring mode: generate new `.spec.ts` tests from a spec, feature description, or recent changes by exploring the running app.

## What it contains

- **Run + diagnose**: commands, runtime policy (global config, no per-test overrides), and the mandatory per-test failure-analysis table.
- **Author**: a seven-phase flow (identify → TC number → verify dev server → explore via MCP → write `.spec.ts` → optional markdown scenario → verify) plus helper imports, module-gating metadata, default credentials, and the full MUST rules.
- **Derive from spec**: mapping spec sections to test cases with a worked example.

## Reference map — load the topic in play

| When | Load |
|------|------|
| Running a suite/category/single file, runtime policy, diagnosing failures | [`workflow/run-and-diagnose.md`](workflow/run-and-diagnose.md) |
| Authoring a new test — phases 1–7, helpers, metadata, credentials, MUST rules | [`workflow/author-test.md`](workflow/author-test.md) |
| Deriving test cases from a spec — section→test mapping, worked example | [`workflow/derive-from-spec.md`](workflow/derive-from-spec.md) |

## Non-negotiables

- MUST explore the running app (Playwright MCP snapshots) before writing — never guess selectors or flows; verify the dev server first.
- MUST NOT hardcode record IDs or rely on seeded/demo data — create fixtures at runtime (prefer API) and clean them up in `finally`/teardown.
- MUST keep tests deterministic; rely on global Playwright config (`timeout: 20s`, `retries: 1`) with no per-test timeout/retry overrides.
- MUST create the `.spec.ts` (markdown scenario optional), verify it passes before finishing, and report any failures in the per-test evidence/owner table.
