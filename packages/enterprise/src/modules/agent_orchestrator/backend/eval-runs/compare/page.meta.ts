export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Compare evaluation runs',
  pageTitleKey: 'agent_orchestrator.evalRegression.compare.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Agents', labelKey: 'agent_orchestrator.nav.agents', href: '/backend/agents' },
    { label: 'Compare evaluation runs', labelKey: 'agent_orchestrator.evalRegression.compare.title' },
  ],
}

export default metadata
