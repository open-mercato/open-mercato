export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.proposals.view'],
  pageTitle: 'Proposal',
  pageTitleKey: 'agent_orchestrator.proposal.title',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [
    { label: 'Caseload', labelKey: 'agent_orchestrator.nav.caseload', href: '/backend/caseload' },
    { label: 'Proposal', labelKey: 'agent_orchestrator.proposal.title' },
  ],
}

export default metadata
