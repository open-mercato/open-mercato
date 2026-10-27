export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.trace.view'],
  pageTitle: 'Run trace',
  pageTitleKey: 'agent_orchestrator.traces.detail.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Traces', labelKey: 'agent_orchestrator.nav.traces', href: '/backend/traces' },
    { label: 'Run trace', labelKey: 'agent_orchestrator.traces.detail.title' },
  ],
}

export default metadata
