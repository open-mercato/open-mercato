# Actionable Missing API Key Error

- **Date**: 2026-04-16
- **Status**: Implemented
- **Module**: `shared` (lib/ai), `inbox_ops` (consumers)
- **GitHub Issue**: #1433

## TLDR

Include the expected environment variable name(s) in the error thrown when an AI provider API key is missing, so the error is immediately actionable.

## Problem Statement

When the AI provider API key is missing, the error stored in `inbox_emails.processing_error` is:

```
LLM extraction failed: Missing API key for provider "anthropic"
```

This does not tell the user which env var to set. Users set the wrong variable and are stuck with no indication of what went wrong.

## Proposed Solution

Add a `requireOpenCodeProviderApiKey` function in `packages/shared/src/lib/ai/opencode-provider.ts` that either returns the API key or throws with an actionable error message including accepted env var names:

```
Missing API key for provider "anthropic". Set ANTHROPIC_API_KEY or OPENCODE_ANTHROPIC_API_KEY in your .env file.
```

This covers all three providers:
- **Anthropic**: `ANTHROPIC_API_KEY` / `OPENCODE_ANTHROPIC_API_KEY`
- **OpenAI**: `OPENAI_API_KEY` / `OPENCODE_OPENAI_API_KEY`
- **Google**: `GOOGLE_GENERATIVE_AI_API_KEY` / `OPENCODE_GOOGLE_API_KEY`

## Scope

| File | Change |
|------|--------|
| `packages/shared/src/lib/ai/opencode-provider.ts` | Add `requireOpenCodeProviderApiKey` function |
| `packages/shared/src/lib/ai/__tests__/opencode-provider.test.ts` | Add tests for the new function |
| `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` | Replace manual null-check with `requireOpenCodeProviderApiKey` |
| `packages/core/src/modules/inbox_ops/lib/translationProvider.ts` | Replace manual null-check with `requireOpenCodeProviderApiKey` |
| `packages/core/src/modules/inbox_ops/ai-tools.ts` | Replace manual null-check with `requireOpenCodeProviderApiKey` |

## Changelog

- **2026-04-16**: Initial spec created.
