# Notify — 2026-10-27-agent-platform-wave-4

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-27T16:59:59Z — run started
- Brief: agent platform wave 4 — Observability P2 (per-step gen_ai params/usage/cost, capture policy, om.capture) + OTel P1 (opt-in replay exporter to OTLP/HTTP JSON).
- External skill URLs: none
- Stacked on feat/agent-platform-wave-3 (11031e1e6) because #7794, #8011 and #8018 are unmerged.
- Decision: `full` capture is accepted by the policy but records metadata only until Observability P3 (`om.content.status = "disabled"`).
- Decision: OTel export has no job-id dedupe (the queue supports only `delayMs`); at-least-once with deterministic ids.
