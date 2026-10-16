# Notify — 2026-10-16-ai-decision-model-port

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-16T17:11:12Z — run started
- Brief: implement `.ai/specs/2026-10-06-ai-decision-model-port.md` (decision model port: shared types, ai-assistant schemas/registry/adapters/service, env, docs).
- External skill URLs: none
- Decision: branch cut from `upstream/develop` (f9a5776a0, identical to the fork's `origin/develop`); pushes go to the fork (`origin`), PR targets `open-mercato/open-mercato:develop`.
- Decision: adapters land before the registry (spec order swapped, see PLAN.md Deviations).
- Limitation: account has pull-only permission upstream — label and assignee operations will be logged skips; the claim is the claim comment only.
