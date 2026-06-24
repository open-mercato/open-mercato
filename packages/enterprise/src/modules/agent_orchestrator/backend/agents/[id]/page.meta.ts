export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.agents.view'],
  pageTitle: 'Agent',
  pageTitleKey: 'agent_orchestrator.agentDetail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Agents', labelKey: 'agent_orchestrator.nav.agents', href: '/backend/agents' },
    { label: 'Agent', labelKey: 'agent_orchestrator.agentDetail.title' },
  ],
}

export default metadata
