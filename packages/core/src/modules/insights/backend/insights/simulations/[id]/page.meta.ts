export const metadata = {
  requireAuth: true,
  requireFeatures: ['insights.simulator.view'],
  pageTitle: 'Simulation result',
  pageTitleKey: 'insights.simulation.ui.nav.run',
  pageGroup: 'Insights',
  pageGroupKey: 'insights.module.title',
  navHidden: true,
  breadcrumb: [
    { label: 'My simulations', labelKey: 'insights.simulation.ui.nav.title', href: '/backend/insights/simulations' },
    { label: 'Simulation result', labelKey: 'insights.simulation.ui.nav.run' },
  ],
}

export default metadata
