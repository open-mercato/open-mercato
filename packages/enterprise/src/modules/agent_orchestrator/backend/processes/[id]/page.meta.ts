export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.trace.view'],
  pageTitle: 'Process',
  pageTitleKey: 'agent_orchestrator.process.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Processes', labelKey: 'agent_orchestrator.nav.processes', href: '/backend/processes' },
    { label: 'Process', labelKey: 'agent_orchestrator.process.title' },
  ],
}

export default metadata
