import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'agent_governance.policy.created', label: 'Policy Created', entity: 'policy', category: 'crud' },
  { id: 'agent_governance.policy.updated', label: 'Policy Updated', entity: 'policy', category: 'crud' },
  { id: 'agent_governance.policy.deleted', label: 'Policy Deleted', entity: 'policy', category: 'crud' },

  { id: 'agent_governance.risk_band.created', label: 'Risk Band Created', entity: 'risk_band', category: 'crud' },
  { id: 'agent_governance.risk_band.updated', label: 'Risk Band Updated', entity: 'risk_band', category: 'crud' },
  { id: 'agent_governance.risk_band.deleted', label: 'Risk Band Deleted', entity: 'risk_band', category: 'crud' },

  { id: 'agent_governance.playbook.created', label: 'Playbook Created', entity: 'playbook', category: 'crud' },
  { id: 'agent_governance.playbook.updated', label: 'Playbook Updated', entity: 'playbook', category: 'crud' },
  { id: 'agent_governance.playbook.deleted', label: 'Playbook Deleted', entity: 'playbook', category: 'crud' },

  { id: 'agent_governance.run.started', label: 'Run Started', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.checkpoint_reached', label: 'Run Checkpoint Reached', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.paused', label: 'Run Paused', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.resumed', label: 'Run Resumed', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.rerouted', label: 'Run Rerouted', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.terminated', label: 'Run Terminated', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.completed', label: 'Run Completed', entity: 'run', category: 'lifecycle', clientBroadcast: true },
  { id: 'agent_governance.run.failed', label: 'Run Failed', entity: 'run', category: 'lifecycle', clientBroadcast: true },

  { id: 'agent_governance.approval.requested', label: 'Approval Requested', entity: 'approval', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.approval.approved', label: 'Approval Approved', entity: 'approval', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.approval.rejected', label: 'Approval Rejected', entity: 'approval', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.approval.resolved', label: 'Approval Resolved', entity: 'approval', category: 'custom', clientBroadcast: true },

  { id: 'agent_governance.decision.recorded', label: 'Decision Recorded', entity: 'decision', category: 'custom' },
  { id: 'agent_governance.telemetry.repair_flagged', label: 'Telemetry Repair Flagged', entity: 'telemetry', category: 'system', clientBroadcast: true },
  { id: 'agent_governance.precedent.indexed', label: 'Precedent Indexed', entity: 'precedent', category: 'custom' },
  { id: 'agent_governance.skill.created', label: 'Skill Created', entity: 'skill', category: 'crud' },
  { id: 'agent_governance.skill.captured', label: 'Skill Captured', entity: 'skill', category: 'custom' },
  { id: 'agent_governance.skill.updated', label: 'Skill Updated', entity: 'skill', category: 'crud' },
  { id: 'agent_governance.skill.deleted', label: 'Skill Deleted', entity: 'skill', category: 'crud' },
  { id: 'agent_governance.skill.validated', label: 'Skill Validated', entity: 'skill', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.skill.validation_rejected', label: 'Skill Validation Rejected', entity: 'skill', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.skill.promoted', label: 'Skill Promoted', entity: 'skill', category: 'custom', clientBroadcast: true },
  { id: 'agent_governance.anomaly.detected', label: 'Anomaly Detected', entity: 'anomaly', category: 'system', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'agent_governance',
  events,
})

export const emitAgentGovernanceEvent = eventsConfig.emit

export type AgentGovernanceEventId = typeof events[number]['id']

export default eventsConfig
