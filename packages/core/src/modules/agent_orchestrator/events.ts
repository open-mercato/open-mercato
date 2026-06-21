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
  { id: 'agent_orchestrator.run.completed', label: 'Agent Run Completed', entity: 'run', category: 'lifecycle' },
  { id: 'agent_orchestrator.proposal.created', label: 'Agent Proposal Created', entity: 'proposal', category: 'lifecycle' },
  { id: 'agent_orchestrator.proposal.disposed', label: 'Agent Proposal Disposed', entity: 'proposal', category: 'lifecycle' },
  { id: 'agent_orchestrator.proposal.ready', label: 'Agent Proposal Ready', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
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
