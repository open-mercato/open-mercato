# Notify — 2026-05-28-ai-chat-sessions-scope-isolation

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-28T11:09:00Z — run started
- Brief: Implement spec `.ai/specs/2026-05-28-ai-chat-sessions-scope-isolation.md` (fix GitHub issue #2123 — AiChatSessions localStorage cache does not react to tenant/org scope change).
- External skill URLs: none.
- Run mode: spec-implementation.
- Source spec: `.ai/specs/2026-05-28-ai-chat-sessions-scope-isolation.md`.
- Branch: `fix/ai-chat-sessions-scope-isolation` from `origin/develop`.

## 2026-05-28T11:24:00Z — checkpoint 1 (Steps 0.1 .. 2.2)
- SHA range: a762bca68 .. de1746a97
- `@open-mercato/ui` full test suite: 142 suites / 1105 tests / 0 failures
- Built `@open-mercato/ai-assistant` once to unblock pre-existing AiChat tests that depend on dist output. Not a regression introduced by this run.
- UI playwright skipped — no visible surface touched in this window.
- Phase 1 + Phase 2 complete. Phase 3 (self-healing 404 in useAiChat + AiChat + AiDock) begins next.
