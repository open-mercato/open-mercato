export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Eval case',
  pageTitleKey: 'agent_orchestrator.evalCases.detail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Eval cases', labelKey: 'agent_orchestrator.nav.evalCases', href: '/backend/eval-cases' },
    { label: 'Eval case', labelKey: 'agent_orchestrator.evalCases.detail.title' },
  ],
}

export default metadata
