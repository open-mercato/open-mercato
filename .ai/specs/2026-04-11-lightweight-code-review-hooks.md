## TLDR

Add a lightweight review workflow that uses a cheap LLM through the Vercel AI SDK to review added diff lines before commit or push.

The workflow has two layers:
- manual commands for staged and outbound review
- optional `pre-commit` automation, disabled by default and enabled only by env flag

Provide the same workflow to agents as a reusable `light-code-review` skill so humans and agents use one shared definition of "quick review".

## Overview

The current repository has Husky installed and a `pre-commit` hook, but it only auto-fixes i18n and template sync drift. There is no lightweight review gate for:

- accidental secrets
- accidental personal data
- unprofessional or abusive language
- type safety before push

The full `code-review` and `check-and-commit` workflows remain the correct path for release-quality verification, but they are intentionally heavier than what is reasonable on every commit.

## Proposed Solution

Introduce a single script, `scripts/light-code-review.ts`, with two operating modes:

- `staged`
  - reads staged added lines from `git diff --cached`
  - sends only added lines to a cheap LLM review prompt
  - returns structured findings for likely secrets, likely PII, or unprofessional language
- `push`
  - reads added lines from the outbound diff against `@{upstream}` and falls back safely when no upstream exists
  - runs the same LLM review manually
  - optionally runs `yarn typecheck`

Package scripts:

- `yarn review:light:staged`
- `yarn review:light`

Git hooks:

- keep `pre-commit` silent by default
- run `yarn review:light:staged` only when `OM_AI_LIGH_REVIEW_AUTOMATIC=true` or `OM_AI_LIGHT_REVIEW_AUTOMATIC=true`
- remove the automatic `pre-push` hook

Agent skill:

- add `.ai/skills/light-code-review/SKILL.md`
- scope: quick review, pre-push safety, hook failure diagnosis, lighter alternative to the full code-review workflow

## Detection Rules

The lightweight review is LLM-based and intentionally biased toward high-confidence issues in these categories:

- Secrets
  - likely real API keys, tokens, passwords, private keys, or credentials
- PII
  - likely real personal email addresses, phone numbers, SSNs, payment card values, or similar sensitive identifiers
- Language
  - explicit curses, insults, or clearly unprofessional phrasing in comments, user-facing text, logs, or notes

The reviewer evaluates only added lines, not the full repository, to keep the hook focused on newly introduced risk and to control cost.

The prompt explicitly tells the model to ignore examples, placeholders, fixtures, and environment-variable references unless they still appear to expose real sensitive data.

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

- agents use `yarn review:light` unless the user explicitly asks for full CI-grade verification
- agents report LLM findings as likely issues, not formal DLP guarantees

## Risks And Impact Review

| Risk | Severity | Area | Mitigation | Residual Risk |
|------|----------|------|------------|---------------|
| False positives on fixture data or docs | Medium | Developer workflow | Prompt the model to ignore fake/example data and review only added lines | Some manual review may still be needed |
| False negatives for subtle leaks | Medium | Security | Keep the prompt narrow and high-confidence, and use cheap models only as an early gate | This is not a substitute for server-side secret scanning |
| LLM latency or provider outage blocks commits when automation is enabled | Medium | DX | Default automation to off and make the gate opt-in via env | Opted-in users still depend on provider availability |
| Local hooks can be bypassed with `--no-verify` | High | Process | Document that hooks improve default behavior but do not replace CI or server-side enforcement | Intentional bypass remains possible |

## API And UX Surface

- `package.json` scripts
  - `review:light`
  - `review:light:staged`
- `.husky/pre-commit`
- `.ai/skills/light-code-review/SKILL.md`
- `apps/mercato/.env.example`
- `packages/create-app/template/.env.example`

## Final Compliance Report

- No public runtime contract surfaces are removed or renamed.
- Change is additive and local to developer workflow.
- No database, API, widget, ACL, DI, or event contract is affected.

## Changelog

- 2026-04-11: Added spec for lightweight code review hooks and agent skill.
- 2026-04-11: Updated the workflow to use Vercel AI SDK LLM review, with env-gated `pre-commit` automation only.
