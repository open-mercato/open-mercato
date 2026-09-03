/**
 * Bridge-route metadata for the retired agentic-task detail url. Same guards as
 * the page it forwards to; `navHidden` because it was never a nav entry.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.processes.view'],
  navHidden: true,
  pageTitle: 'Process definition',
  pageTitleKey: 'agent_orchestrator.processDefinitions.detail.title',
  breadcrumb: [
    { label: 'Process definitions', labelKey: 'agent_orchestrator.nav.processDefinitions', href: '/backend/processes/definitions' },
    { label: 'Process definition', labelKey: 'agent_orchestrator.processDefinitions.detail.title' },
  ],
}

export default metadata
