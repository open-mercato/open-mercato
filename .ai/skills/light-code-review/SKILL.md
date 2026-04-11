---
name: light-code-review
description: Run the lightweight local review workflow for quick safety checks before commit or push. Use when the user asks for a simple code review, a pre-push check, hook-safe verification, or a faster alternative to the full CI-style code-review flow. Uses a cheap LLM through the Vercel AI SDK to review added diff lines for likely secrets, likely PII, and unprofessional language, with optional typecheck.
---

# Light Code Review

Use this skill when the user wants a fast safety gate instead of the full `code-review` or `check-and-commit` workflow.

## Workflow

1. Check scope with `git status --short` and `git diff --stat`.
2. Run the lightweight review command that matches the situation:

```bash
yarn review:light:staged
```

Use that when the user is preparing a commit or when only staged changes matter.

```bash
yarn review:light
```

Use that when the user is preparing to push or wants the full lightweight gate. This runs the outbound diff review and `yarn typecheck`.

3. If the command fails, inspect the reported file and line references and fix only the introduced issue.
4. Re-run the same lightweight command until it passes.
5. Only escalate to the heavier review workflow if the user asks for full CI-grade confidence.

## Automatic Hook

`pre-commit` runs this automatically only when one of these env flags is truthy:

```text
OM_AI_LIGHT_REVIEW_AUTOMATIC=true
OM_AI_LIGH_REVIEW_AUTOMATIC=true
```

The second spelling is supported as a compatibility alias.

The script auto-loads common local env files, including `apps/mercato/.env` and `apps/mercato/.env.local`, then uses the first available provider key from:

- `ANTHROPIC_API_KEY` or `OPENCODE_ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` or `OPENCODE_OPENAI_API_KEY`

Optional model override:

```text
OM_AI_LIGHT_REVIEW_MODEL=openai/gpt-4o-mini
```

## What This Catches

- likely secrets committed inline
- likely PII committed inline
- explicit curse words or clearly unprofessional phrasing
- repository-wide TypeScript type errors when using `yarn review:light`

## Boundaries

- This is an LLM-based screen, not a formal DLP or secret-management system.
- It intentionally does not run `build`, `generate`, or `test`.
- It should be the default quick gate before commit or push, not the only verification used before release work.
