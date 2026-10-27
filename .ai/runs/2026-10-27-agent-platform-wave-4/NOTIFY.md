# Notify — 2026-10-27-agent-platform-wave-4

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-27T16:59:59Z — run started
- Brief: agent platform wave 4 — Observability P2 (per-step gen_ai params/usage/cost, capture policy, om.capture) + OTel P1 (opt-in replay exporter to OTLP/HTTP JSON).
- External skill URLs: none
- Stacked on feat/agent-platform-wave-3 (11031e1e6) because #7794, #8011 and #8018 are unmerged.
- Decision: `full` capture is accepted by the policy but records metadata only until Observability P3 (`om.content.status = "disabled"`).
- Decision: OTel export has no job-id dedupe (the queue supports only `delayMs`); at-least-once with deterministic ids.

## 2026-10-27T17:14:38Z — checkpoint 1
- Steps 1.1..1.4 (+1.3-review-fix) verified: typecheck, AO jest 2048/2048, ai-assistant jest 2182/2182.
- Decision: additive `callerManaged?` on `AiAgentModelCallStartEvent` marks the caller-callback branch as `reconstructed`; SDK-synthesized object calls are `exact`.
- Delegations so far: executors for 1.1, 1.2 (cheap tier), 1.3, 1.4.

## 2026-10-27T17:36:39Z — checkpoint 2
- Draft PR #8061 opened and claimed after the user pushed the branch.
- Steps 2.1..2.5 verified: typecheck, AO jest 2111/2111, core guards, build:app --force.
- UI browser check deferred to checkpoint 3 (Step 3.3 writes the spec that captures the screenshots).
- Delegations: executors for 2.1, 2.2, 2.3 (cheap tier), 2.4, 2.5.

## 2026-10-27T17:56:10Z — checkpoint 3
- Steps 3.1..3.3 verified: typecheck, AO jest 2104 (+1 suite re-run alone after a worker SIGSEGV), TC-AGENT-TRACE-005 2 passed / 1 skipped (no LLM).
- Screenshots in checkpoint-3-artifacts/. Observability P2 complete.
- Delegations: executors for 3.1, 3.2, 3.3 (3.3 ran the spec against the ephemeral app started by the main session).
