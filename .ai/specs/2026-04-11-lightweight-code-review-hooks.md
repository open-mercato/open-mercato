## TLDR

Add a lightweight review workflow that uses a cheap LLM through the Vercel AI SDK to review local tracked changes before commit, with a slightly heavier `light` mode that adds typecheck.

The workflow has two layers:
- `yarn review:local` for fast local review
- `yarn review:light` for the same local review plus `yarn typecheck`

The `pre-commit` hook stays opt-in and only runs `review:local` when the env flag is enabled.

## Overview

The current repository already has Husky and pre-commit auto-fixes for i18n/template drift, but it still benefits from a fast branch-hygiene gate that catches:

- accidental secrets
- accidental personal data
- unprofessional or abusive language
- obvious dangerous sinks
- a few near-zero-ambiguity guideline regressions

The full `code-review` and `check-and-commit` workflows remain the correct path for release-quality verification, but they are intentionally heavier than what is reasonable on every commit.

## Proposed Solution

Use one script, `scripts/light-code-review.ts`, with two modes:

- `local`
  - reviews local tracked changes against `HEAD`
  - includes both staged and unstaged modifications in tracked files
  - sends only added lines to a cheap LLM prompt
  - also runs a few deterministic high-signal checks
- `push`
  - remains available for explicit outbound-diff inspection when needed

Package scripts:

- `yarn review:local`
- `yarn review:light`

Where:

- `review:local` runs the local review only
- `review:light` runs the same local review and then `yarn typecheck`

Git hook behavior:

- keep `pre-commit` silent by default
- run `yarn review:local` only when `OM_AI_LIGH_REVIEW_AUTOMATIC=true` or `OM_AI_LIGHT_REVIEW_AUTOMATIC=true`
- keep `pre-push` manual

## Detection Rules

The lightweight review is primarily LLM-based and intentionally biased toward high-confidence issues in these categories:

- Secrets
  - likely real API keys, tokens, passwords, private keys, or credentials
- PII
  - likely real personal email addresses, phone numbers, SSNs, payment card values, or similar sensitive identifiers
- Language
  - explicit curses, insults, or clearly unprofessional phrasing in comments, user-facing text, logs, or notes
- Security
  - dangerous sinks such as `dangerouslySetInnerHTML`, `.innerHTML =`, `eval()`, or `new Function()`
- Guideline
  - cheap rules with near-zero ambiguity such as explicit `any` types and empty catch blocks

The reviewer evaluates only added lines, not the full repository, to keep the hook focused on newly introduced risk and to control cost.

The prompt explicitly tells the model to ignore examples, placeholders, fixtures, and environment-variable references unless they still appear to expose real sensitive data.

For explicit profanity, dangerous sinks, `any`, and empty catch blocks, a small deterministic fallback is layered in so obvious misses do not slip through when the model under-flags them.

## Architecture

### Script contract

- uses Vercel AI SDK with Anthropic or OpenAI
- loads provider keys from common local env files before resolving provider choice
- deterministic exit codes for hook usage
- clear file and line references in output

### Hook contract

- `pre-commit` only runs the AI reviewer when explicitly enabled
- `pre-push` is manual only
- existing i18n/template auto-fixes stay intact

### Skill contract

- agents use `yarn review:local` for fast local review
- agents use `yarn review:light` when they also want typecheck
- agents report findings as likely issues, not formal DLP guarantees

## Risks And Impact Review

| Risk | Severity | Area | Mitigation | Residual Risk |
|------|----------|------|------------|---------------|
| False positives on fixture data or docs | Medium | Developer workflow | Prompt the model to ignore fake/example data and review only added lines | Some manual review may still be needed |
| False negatives for subtle leaks | Medium | Security | Keep the prompt narrow and high-confidence, and use cheap models only as an early gate | This is not a substitute for server-side secret scanning |
| LLM latency or provider outage blocks commits when automation is enabled | Medium | DX | Default automation to off and make the gate opt-in via env | Opted-in users still depend on provider availability |
| Fast deterministic checks become noisy | Medium | DX | Keep them limited to high-confidence rules and code-only file types | Some edge cases may still require refinement |
| Local hooks can be bypassed with `--no-verify` | High | Process | Document that hooks improve default behavior but do not replace CI or server-side enforcement | Intentional bypass remains possible |

## API And UX Surface

- `package.json` scripts
  - `review:local`
  - `review:light`
- `.husky/pre-commit`
- `.ai/skills/light-code-review/SKILL.md`
- `apps/mercato/.env.example`
- `packages/create-app/template/.env.example`
- root `AGENTS.md`
- standalone app docs AI tooling section

## Final Compliance Report

- No public runtime contract surfaces are removed or renamed.
- Change is additive and local to developer workflow.
- No database, API, widget, ACL, DI, or event contract is affected.

## Changelog

- 2026-04-11: Added spec for lightweight code review hooks and agent skill.
- 2026-04-11: Updated the workflow to use Vercel AI SDK LLM review, with env-gated `pre-commit` automation only.
- 2026-04-12: Simplified commands to `review:local` and `review:light`, and added deterministic quick checks for dangerous sinks, `any`, and empty catch blocks.
