# InboxOps Local Dev — Fixes & Improvements

**Date**: 2026-04-11
**Status**: In Progress
**Module**: `inbox_ops` (`packages/core/src/modules/inbox_ops/`)
**Related**: SPEC-037 (InboxOps Agent)

---

## TLDR

During local setup of InboxOps with Resend + ngrok, several friction points were discovered. This spec documents the first fix: `.env.example` documents wrong AI provider env var names, causing silent misconfiguration.

---

## Fix `.env.example` — API key env var names don't match what code reads

**Type:** Bug fix
**Priority:** High — causes silent misconfiguration
**Issue:** #1430

**Problem:**
`packages/create-app/template/.env.example` documents these env var names:
```
OPENCODE_ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENCODE_OPENAI_API_KEY=your_openai_api_key_here
OPENCODE_GOOGLE_API_KEY=your_google_api_key_here
```

But `@open-mercato/shared/src/lib/ai/opencode-provider.ts` (line 14-33) reads:
```typescript
anthropic: { envKeys: ['ANTHROPIC_API_KEY'] },
openai:    { envKeys: ['OPENAI_API_KEY'] },
google:    { envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
```

Setting `OPENCODE_ANTHROPIC_API_KEY` does nothing — the provider resolver never reads it.

**Solution:** Option B — add `OPENCODE_*` prefixed variants as fallback entries in `envKeys`. This fixes existing installs without forcing env var renames.

```typescript
anthropic: { envKeys: ['ANTHROPIC_API_KEY', 'OPENCODE_ANTHROPIC_API_KEY'] },
openai:    { envKeys: ['OPENAI_API_KEY', 'OPENCODE_OPENAI_API_KEY'] },
google:    { envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY', 'OPENCODE_GOOGLE_API_KEY'] },
```

**Files:**
- `packages/shared/src/lib/ai/opencode-provider.ts` — add fallback env key names
- `packages/create-app/template/.env.example` — update to canonical names, note both accepted
- `packages/shared/src/lib/ai/__tests__/opencode-provider.test.ts` — add tests for `OPENCODE_*` variants
- `packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx` — fix hardcoded fallback `'OPENCODE_ANTHROPIC_API_KEY'` → `'ANTHROPIC_API_KEY'`

---

## Changelog

### 2026-04-12
- Implemented PR 1: env var fallback fix, .env.example update, settings UI fallback fix
- Scoped spec down to PR 1 only for this change

### 2026-04-11
- Initial draft
