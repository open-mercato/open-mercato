import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Agent Orchestrator Module Events (areas 01 + 03).
 *
 * Area 01 declares the run/created lifecycle events. Area 03 adds
 * `proposal.disposed` (audit of every verdict — rule or human) and
 * `proposal.ready` (the human-path workflow resume signal consumed by area 02's
 * WAIT_FOR_SIGNAL; `clientBroadcast: true` so the cockpit live-updates).
 */
const events = [
  { id: 'agent_orchestrator.run.created', label: 'Agent Run Created', entity: 'run', category: 'lifecycle' },
  // clientBroadcast so the Traces list and an open "Running" trace detail
  // live-update on completion (UX consistency pass, Area 1). Org-scoped by the
  // DOM Event Bridge; every subscriber coalesces (5 s), bounding refetch rate.
  { id: 'agent_orchestrator.run.completed', label: 'Agent Run Completed', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.proposal.created', label: 'Agent Proposal Created', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.proposal.disposed', label: 'Agent Proposal Disposed', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.proposal.ready', label: 'Agent Proposal Ready', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  // Trace + eval overlay. run.ingested is clientBroadcast for the same
  // live-refresh reason as run.completed (spans/tool-calls arrive post-run).
  { id: 'agent_orchestrator.run.ingested', label: 'Agent Run Ingested', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.run.evaluated', label: 'Agent Run Evaluated', entity: 'run', category: 'lifecycle' },
  // Correction flywheel overlay.
  { id: 'agent_orchestrator.proposal.corrected', label: 'Agent Proposal Corrected', entity: 'proposal', category: 'lifecycle' },
  { id: 'agent_orchestrator.eval_case.created', label: 'Agent Eval Case Created', entity: 'eval_case', category: 'lifecycle' },
  { id: 'agent_orchestrator.eval_case.approved', label: 'Agent Eval Case Approved', entity: 'eval_case', category: 'lifecycle' },
  // Runtime guardrails overlay. Emitted for `block` AND `warn` results so the
  // cockpit live-updates (clientBroadcast) and business_rules ACTION rules react.
  { id: 'agent_orchestrator.guardrail.tripped', label: 'Agent Guardrail Tripped', entity: 'guardrail', category: 'lifecycle', clientBroadcast: true },
  // Identity overlay (Wave 4 Phase 3) — an external agent's delegation grant was
  // revoked; downstream auditors react and the cockpit live-updates.
  { id: 'agent_orchestrator.delegation_grant.revoked', label: 'Agent Delegation Grant Revoked', entity: 'delegation_grant', category: 'lifecycle', clientBroadcast: true },
  // Identity overlay (Wave 4 Phase 4) — an external agent self-registered via the
  // ID-JAG / auth.md flow (issuer-signed assertion → scoped principal + grant).
  { id: 'agent_orchestrator.agent_principal.registered', label: 'Agent Principal Registered (ID-JAG)', entity: 'agent_principal', category: 'lifecycle', clientBroadcast: true },
  // Agentic Tasks overlay (spec 2026-07-03). `task_run.*` are clientBroadcast so
  // the task detail page's run-history table live-updates after the async 202.
  { id: 'agent_orchestrator.task.created', label: 'Agentic Task Created', entity: 'task', category: 'crud' },
  { id: 'agent_orchestrator.task.updated', label: 'Agentic Task Updated', entity: 'task', category: 'crud' },
  { id: 'agent_orchestrator.task.deleted', label: 'Agentic Task Deleted', entity: 'task', category: 'crud' },
  { id: 'agent_orchestrator.task_run.started', label: 'Agentic Task Run Started', entity: 'task_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.task_run.completed', label: 'Agentic Task Run Completed', entity: 'task_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.task_run.failed', label: 'Agentic Task Run Failed', entity: 'task_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.task_event_trigger.created', label: 'Agentic Task Event Trigger Created', entity: 'task_event_trigger', category: 'crud' },
  { id: 'agent_orchestrator.task_event_trigger.updated', label: 'Agentic Task Event Trigger Updated', entity: 'task_event_trigger', category: 'crud' },
  { id: 'agent_orchestrator.task_event_trigger.deleted', label: 'Agentic Task Event Trigger Deleted', entity: 'task_event_trigger', category: 'crud' },
  // Process projection (spec 2026-06-25). Emitted after every projection upsert
  // (clientBroadcast) so the open Processes list refetches the changed row.
  // excludeFromTriggers: it is a derived read-model echo, not a domain fact.
  { id: 'agent_orchestrator.process.updated', label: 'Agent Process Projection Updated', entity: 'process', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'agent_orchestrator',
  events,
})

/** Type-safe event emitter for the agent_orchestrator module. */
export const emitAgentOrchestratorEvent = eventsConfig.emit

/** Event IDs that can be emitted by the agent_orchestrator module. */
export type AgentOrchestratorEventId = typeof events[number]['id']

export default eventsConfig
