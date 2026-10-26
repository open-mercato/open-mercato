# Notify — 2026-10-26-agent-platform-wave-2

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-26T19:30:00Z — run started
- Brief: agent platform roadmap wave 2 — Chat P2 + §6 model-call contract, Observability P0–P1 (run manifest), Eval P2 (frozen eval-set manifests); one PR to open-mercato/open-mercato `main`.
- External skill URLs: none

## 2026-10-26T19:30:00Z — decision: stacked base
- #7794 (wave 1) is open, conflicts with `main` and has a failing `test` check. The user chose to stack wave 2 on `feat/agent-platform-wave-1` now; wave-1 fixes are handled on #7794.

## 2026-10-26T19:30:00Z — decision: optional MCP P4 + Identity P1/P5 deferred
- ID-Q3 requires MCP P4, Identity P1 and Identity P5 in one release. The roadmap places them in wave 3; including them would roughly double this PR. Deferred to wave 3.

## 2026-10-26T19:30:00Z — decision: runs view ACL features deferred to Chat Phase 3
- `ai_assistant.runs.view` / `.view_all` are consumed only by the Phase 3 routes; adding them now would ship FROZEN feature ids with no consumer.

## 2026-10-26T19:30:00Z — environment: no agent pushes to upstream
- Executors commit locally without pushing; the user pushes at checkpoints. The per-Step "push" rule is replaced by "local HEAD contains the commit".
