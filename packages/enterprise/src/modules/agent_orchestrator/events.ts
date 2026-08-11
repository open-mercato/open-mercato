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
  // Eval plane. The per-case pair carries live progress and is emitted by the
  // replay engine (Phase 3: a queue worker in another process — broadcast events
  // cross the process boundary via the pg LISTEN/NOTIFY bridge). Excluded from
  // triggers: a per-case echo is transient, not a domain fact worth automating on.
  { id: 'agent_orchestrator.eval_suite_run.started', label: 'Agent Eval Suite Run Started', entity: 'eval_suite_run', category: 'lifecycle' },
  { id: 'agent_orchestrator.eval_suite_run.completed', label: 'Agent Eval Suite Run Completed', entity: 'eval_suite_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.eval_case_run.started', label: 'Agent Eval Case Run Started', entity: 'eval_case_run', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
  { id: 'agent_orchestrator.eval_case_run.completed', label: 'Agent Eval Case Run Completed', entity: 'eval_case_run', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
  // Runtime guardrails overlay. Emitted for `block` AND `warn` results so the
  // cockpit live-updates (clientBroadcast) and business_rules ACTION rules react.
  { id: 'agent_orchestrator.guardrail.tripped', label: 'Agent Guardrail Tripped', entity: 'guardrail', category: 'lifecycle', clientBroadcast: true },
  // Identity overlay (Wave 4 Phase 3) — an external agent's delegation grant was
  // revoked; downstream auditors react and the cockpit live-updates.
  { id: 'agent_orchestrator.delegation_grant.revoked', label: 'Agent Delegation Grant Revoked', entity: 'delegation_grant', category: 'lifecycle', clientBroadcast: true },
  // Identity overlay (Wave 4 Phase 4) — an external agent self-registered via the
  // ID-JAG / auth.md flow (issuer-signed assertion → scoped principal + grant).
  { id: 'agent_orchestrator.agent_principal.registered', label: 'Agent Principal Registered (ID-JAG)', entity: 'agent_principal', category: 'lifecycle', clientBroadcast: true },
  // Triggered process model (spec 2026-08-11). `process_run.*` stay
  // clientBroadcast so the definition detail page's run-history table
  // live-updates after the async 202.
  { id: 'agent_orchestrator.process_definition.created', label: 'Process Definition Created', entity: 'process_definition', category: 'crud' },
  { id: 'agent_orchestrator.process_definition.updated', label: 'Process Definition Updated', entity: 'process_definition', category: 'crud' },
  { id: 'agent_orchestrator.process_definition.deleted', label: 'Process Definition Deleted', entity: 'process_definition', category: 'crud' },
  { id: 'agent_orchestrator.process_run.started', label: 'Process Run Started', entity: 'process_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.process_run.completed', label: 'Process Run Completed', entity: 'process_run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.process_run.failed', label: 'Process Run Failed', entity: 'process_run', category: 'lifecycle', clientBroadcast: true },
  // The event-trigger table survives Phase 1 unchanged — it collapses into the
  // definition's `triggers` jsonb in Phase 2, and only then do these events go.
  { id: 'agent_orchestrator.task_event_trigger.created', label: 'Process Event Trigger Created', entity: 'task_event_trigger', category: 'crud' },
  { id: 'agent_orchestrator.task_event_trigger.updated', label: 'Process Event Trigger Updated', entity: 'task_event_trigger', category: 'crud' },
  { id: 'agent_orchestrator.task_event_trigger.deleted', label: 'Process Event Trigger Deleted', entity: 'task_event_trigger', category: 'crud' },
  // Process projection (spec 2026-06-25). Emitted after every projection upsert
  // (clientBroadcast) so the open Processes list refetches the changed row.
  // excludeFromTriggers: it is a derived read-model echo, not a domain fact.
  { id: 'agent_orchestrator.process.updated', label: 'Agent Process Projection Updated', entity: 'process', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
  // Live run progress (per tool call). clientBroadcast so a UI trigger can show
  // step-by-step progress while a synchronous run is in flight (the run POST does
  // not return until the run finishes). Payload: { runId, agentId, tenantId,
  // organizationId, sequence, callId, tool, phase: 'started'|'finished', status,
  // label }. excludeFromTriggers: it is a transient per-step echo, not a domain
  // fact — like process.updated it must never drive workflow triggers.
  { id: 'agent_orchestrator.run.progress', label: 'Agent Run Progress', entity: 'run', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
  // Per-adapter web-search narration, one level below run.progress: which source
  // was queried, whether it answered, was blocked, or was cancelled, and why.
  // Emitted from the MCP process, which reaches the browser over pg NOTIFY -> SSE.
  // Payload is summary-only: the SSE route caps a frame at 4KB, so result lists
  // never travel here. excludeFromTriggers for the same reason as run.progress —
  // a transient echo must never drive a workflow.
  { id: 'agent_orchestrator.web_search.progress', label: 'Agent Web Search Progress', entity: 'run', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },
  // File plane overlay (spec 2026-06-26). `artifact.captured` fires after a
  // file-enabled OpenCode run's outputs are hashed + stored (clientBroadcast so
  // the run-detail Artifacts panel live-updates). `artifact.promoted` fires when
  // an approved `attachments.attach_artifact` proposal materializes a durable
  // Attachment from a captured artifact.
  { id: 'agent_orchestrator.artifact.captured', label: 'Agent Artifact Captured', entity: 'artifact', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_orchestrator.artifact.promoted', label: 'Agent Artifact Promoted', entity: 'artifact', category: 'lifecycle', clientBroadcast: true },
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
