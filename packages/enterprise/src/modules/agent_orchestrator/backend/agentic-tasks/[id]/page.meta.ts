export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.tasks.view'],
  pageTitle: 'Agentic Task',
  pageTitleKey: 'agent_orchestrator.tasks.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Agentic Tasks', labelKey: 'agent_orchestrator.nav.tasks', href: '/backend/agentic-tasks' },
    { label: 'Task', labelKey: 'agent_orchestrator.tasks.detail.title' },
  ],
}

export default metadata
