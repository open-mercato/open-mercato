export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Eval case',
  pageTitleKey: 'agent_orchestrator.evalCases.detail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Agents', labelKey: 'agent_orchestrator.nav.agents', href: '/backend/agents' },
    { label: 'Eval case', labelKey: 'agent_orchestrator.evalCases.detail.title' },
  ],
}

export default metadata
