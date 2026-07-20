export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Evaluation run',
  pageTitleKey: 'agent_orchestrator.evalRuns.detail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Evaluations', labelKey: 'agent_orchestrator.nav.evalRuns', href: '/backend/eval-runs' },
    { label: 'Evaluation run', labelKey: 'agent_orchestrator.evalRuns.detail.title' },
  ],
}

export default metadata
