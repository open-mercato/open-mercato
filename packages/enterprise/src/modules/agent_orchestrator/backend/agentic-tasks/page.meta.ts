/**
 * Bridge-route metadata. `page.tsx` forwards to `/backend/processes/definitions`
 * (triggered process model spec, 2026-08-11 §Frontend architecture contract) and
 * the guards stay exactly what they were — a bridge that drops its RBAC guard is
 * a hole, not a redirect. `navHidden` keeps one entry in the sidebar.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.processes.view'],
  navHidden: true,
  pageTitle: 'Process definitions',
  pageTitleKey: 'agent_orchestrator.nav.processDefinitions',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  breadcrumb: [{ label: 'Process definitions', labelKey: 'agent_orchestrator.nav.processDefinitions' }],
}

export default metadata
