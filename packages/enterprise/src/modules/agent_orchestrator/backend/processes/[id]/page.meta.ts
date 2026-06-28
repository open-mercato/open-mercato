export const metadata = {
  requireAuth: true,
  // Interim guard. Sample-driven preview predates the backend; switch to
  // `agent_orchestrator.processes.view` once the AgentProcess projection +
  // /api/agent_orchestrator/processes routes land (spec 2026-06-25 §Access Control).
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
