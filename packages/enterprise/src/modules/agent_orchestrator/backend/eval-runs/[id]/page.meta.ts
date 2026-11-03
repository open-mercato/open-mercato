export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Evaluation run',
  pageTitleKey: 'agent_orchestrator.evalRuns.detail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Agents', labelKey: 'agent_orchestrator.nav.agents', href: '/backend/agents' },
    { label: 'Evaluation run', labelKey: 'agent_orchestrator.evalRuns.detail.title' },
  ],
}

export default metadata
