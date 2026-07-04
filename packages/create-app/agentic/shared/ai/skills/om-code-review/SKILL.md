---
name: om-code-review
description: Review code changes for architecture, security, conventions, and quality compliance. Use when reviewing pull requests, code changes, or auditing code quality.
---

# Code Review

Review code changes against Open Mercato architecture rules, security requirements, and quality standards.

## When to use

- Reviewing a PR, diff, or set of commits for architecture / security / convention / quality compliance.
- Auditing code quality before it merges, including running the CI/CD verification gate.
- Not for writing a spec (`om-spec-writing`) or implementing one (`om-implement-spec`).

## What it contains

A linear review procedure: scope + classify changed files → gather context → run the mandatory CI/CD gate (`yarn generate`/`typecheck`/`test`/`build`) → apply the checklist → assess test coverage + cross-module impact → emit a severity-classified report. Severity rules, output format, quick rule map, and per-layer heuristics live in `instructions.md`.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Running a review — full procedure, CI/CD gate, output format, severity rules, heuristics | [`instructions.md`](instructions.md) |
| Applying the pass/fail rule checklist against the diff | [`references/review-checklist.md`](references/review-checklist.md) |
| Canonical architecture, security, UI, and code-quality rules (single source of truth) | [`AGENTS.md`](../../../AGENTS.md) |

## Non-negotiables

- The CI/CD verification gate is **MANDATORY**: never call code "ready to merge" without running `yarn generate`, `yarn typecheck`, `yarn test`, and `yarn build` and reporting actual pass/fail. Every failure is a **Critical** finding.
- `AGENTS.md` is the single source of truth — map each review dimension to its owning section rather than relying on a stale copy.
- Flag every finding with severity, file, and a concrete fix suggestion; omit empty severity sections in the report.
