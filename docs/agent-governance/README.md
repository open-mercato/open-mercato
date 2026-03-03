# Agent Governance V2 Docs Index

Use this folder as the single documentation entrypoint for the `agent_governance` module.

## Read in order
1. `architecture.md` - System boundaries, core services, telemetry and control model.
2. `developer-onboarding.md` - How to extend module code safely.
3. `operator-runbook.md` - Human intervention procedures and incident handling.
4. `retrieval-adapters.md` - External retrieval adapter strategy and benchmark posture.
5. `phase-gate-report.md` - Delivery evidence by phase gate.
6. `board-handoff.md` - Executive summary, KPI baseline, and known gaps.

## Current runtime constraints
- Module tests/build are validated on this machine.
- App-level `yarn generate` remains Node 24 gated.
- Temporary local workaround used for generators: direct CLI runtime execution from `packages/cli/dist/mercato.js`.

## Canonical scope source
- `.ai/specs/SPEC-050-2026-03-03-agentic-operations-and-governance-module.md`
- `tasks/tasks-agent-governance-v2-full-prd.md`
