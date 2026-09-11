export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.processes.view'],
  pageTitle: 'Process definition',
  pageTitleKey: 'agent_orchestrator.processDefinitions.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Process definitions', labelKey: 'agent_orchestrator.nav.processDefinitions', href: '/backend/processes/definitions' },
    { label: 'Process definition', labelKey: 'agent_orchestrator.processDefinitions.detail.title' },
  ],
}

export default metadata
