# Agent Governance Operator Runbook

## What operators own
- approving/rejecting checkpoints,
- pausing/resuming/terminating runs,
- responding to anomaly signals,
- enforcing kill-switch and escalation policy.

## Standard operating sequence
1. Open `/backend/agent-governance` and review alert severity + pending approvals.
2. Inspect runs in `checkpoint` or `failed` status.
3. Use run timeline to verify policy/risk/evidence before taking action.
4. Resolve approval task with explicit comment.
5. Confirm resulting run transition and telemetry record.

## Manual intervention controls
- `Pause`: use for uncertainty, dependency outage, or suspected bad context.
- `Resume`: only after rationale is validated and preconditions are restored.
- `Terminate`: use for unsafe or invalid execution paths.
- `Reroute`: rebind run to safer policy/risk/playbook path.

## Kill-switch guidance
- Scope kill-switch by tenant/org where possible.
- Trigger when: repeated high-severity anomalies, data integrity uncertainty, or policy bypass suspicion.
- After kill-switch: capture incident summary, affected run IDs, and containment actions.

## Incident classes
- `telemetry_repair_required`: pause active runs and investigate persistence failures.
- `run_failed`: triage root cause, check provider/inputs, decide rerun vs terminate.
- `approval backlog`: apply temporary checkpoint threshold tuning and staffing escalation.

## Recovery checklist
1. Confirm durable telemetry path is healthy.
2. Confirm queue backlog is draining.
3. Validate no cross-tenant scope anomalies.
4. Resume paused runs only with documented rationale.
5. Record postmortem and extract reusable skill if pattern repeats.
