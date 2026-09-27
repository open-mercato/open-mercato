---
id: deals.stage_playbook
moduleId: agent_orchestrator
label: Deal stage playbook
description: Pipeline-stage expertise (canonical stages and advance/hold criteria) plus the read-only deal analyzer.
tools:
  - customers.analyze_deals
---
# Deal stage playbook

The canonical sales stages, in order, are:

**Discovery → Qualification → Proposal → Negotiation → Closing → (Won | Lost)**

## When to advance

Advance a deal **one** stage when the current stage's exit criteria are clearly met — never skip stages:

- **Discovery → Qualification** — a confirmed need and an identified budget owner.
- **Qualification → Proposal** — agreed scope.
- **Proposal → Negotiation** — the proposal has been acknowledged.
- **Negotiation → Closing** — verbal agreement on price and terms.

## When to hold or move back

Hold the deal in place, or move it back a stage, when the signals are weak:

- Low probability.
- The champion has left.
- The deal has stalled — long time-in-stage with no recent activity.

## Tools

When you need pipeline-wide context to judge a single deal, you may call the
read-only `customers.analyze_deals` tool to compare it against the rest of the
pipeline. This is read-only: you can analyze, but you can never modify a deal —
the only way to change it is the proposal you return.
