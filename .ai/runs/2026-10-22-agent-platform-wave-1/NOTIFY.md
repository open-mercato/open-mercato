# Notify — 2026-10-22-agent-platform-wave-1

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-22T11:19:34Z — run started
- Brief: implement wave 1 of the agent platform roadmap (MCP P1–P3 incl. approval mode, chat-tracing P1, identity P0, eval P1, document structure P1–P2) as one PR against open-mercato/open-mercato main.
- External skill URLs: none

## 2026-10-22T11:19:34Z — decisions
- Target repo/base changed by the user from the demo fork's develop to open-mercato/open-mercato main.
- Only generic specs go upstream: client/POC/fork references removed before the first commit.
- Identity Phase 1 is deferred to ship with Identity Phase 5 and MCP Phase 4 (ID-Q3 decision), so it is not in this wave.
- Triage found pending actions are not owner-scoped today; Step 3.4 fixes it (security behaviour change).

## 2026-10-22T11:19:34Z — subagent delegation
- Two read-only Explore agents verified spec code facts against upstream main (MCP P1–P3; chat P1, identity P0, eval P1, document P1–P2).
