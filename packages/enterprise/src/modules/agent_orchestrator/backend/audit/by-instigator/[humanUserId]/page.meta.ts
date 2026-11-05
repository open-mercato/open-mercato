export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.identity.read'],
  pageTitle: 'Instigator audit chain',
  pageTitleKey: 'agent_orchestrator.identity.audit.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Audit', labelKey: 'agent_orchestrator.audit.title' },
    { label: 'Instigator chain', labelKey: 'agent_orchestrator.identity.audit.title' },
  ],
}

export default metadata
