// Area 01 owns `agents.view` / `agents.run`. Area 03 owns `proposals.view` /
// `proposals.dispose`. `workflows.author` is declared by area 02 — see
// mvp/00-overview.md §ACL features.
export const features = [
  { id: 'agent_orchestrator.agents.view', title: 'View agents and runs', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.agents.run',
    title: 'Run agents (playground)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.agents.view'],
  },
  { id: 'agent_orchestrator.proposals.view', title: 'View proposals', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.proposals.dispose',
    title: 'Dispose proposals (approve/edit/reject)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.proposals.view'],
  },
  // Trace + eval overlay.
  { id: 'agent_orchestrator.trace.view', title: 'View agent run traces', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.trace.correct',
    title: 'Record agent corrections',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.trace.view'],
  },
  {
    id: 'agent_orchestrator.eval.manage',
    title: 'Manage evaluation cases and assertions',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.trace.view'],
  },
  {
    id: 'agent_orchestrator.eval.export',
    title: 'Export the agent eval-case set',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.eval.manage'],
  },
  // Runtime guardrails overlay.
  { id: 'agent_orchestrator.guardrail.read', title: 'View guardrail checks', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.guardrail.manage',
    title: 'Manage guardrail sets',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.guardrail.read'],
  },
  // Context overlay — read the assembled context bundles (trace "context assembled" panel).
  { id: 'agent_orchestrator.context.read', title: 'View agent context bundles', module: 'agent_orchestrator' },
]

export default features
