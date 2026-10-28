# Notify — 2026-10-28-agent-platform-wave-5

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-28T03:01:44Z — run started
- Brief: agent platform wave 5 — Integrity P3–P5, Identity P2–P4, Observability P3–P4, Chat P3–P4, Eval P3–P5, all in one PR (user decision).
- External skill URLs: none
- Stacked on feat/agent-platform-wave-4 (2d407b96f).
- Planning delegated to two read-only planners; their verified reports are research-*.md in this folder.
- Spec deviations adopted at planning (details in research files): audit correlation via a core projection column (encrypted context_json), no scripted provider, principal-denied tools in the manifest, effector correlation stamped by core workflows, citations in the tool-output uiParts envelope, citation registry as new ui code.

## 2026-10-28T04:01:22Z — checkpoint 1
- Phase 1 (Integrity P3–P5) verified: typecheck, AO jest 2515/2515, core guards, integration 16 passed / 3 skipped.
- Decision: checkpoints every 10+ Steps (user request).
- Fixes: 1.9-review-fix (optional ScorerRunView.guardrailChecks), 1.11-review-fix (guardrail row wrap).
- Delegations: executors for 1.1–1.11 (1.4 cheap tier).
