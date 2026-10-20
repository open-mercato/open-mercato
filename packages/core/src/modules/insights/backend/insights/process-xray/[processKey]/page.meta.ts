export const metadata = {
  requireAuth: true,
  requireFeatures: ['insights.xray.view'],
  pageTitle: 'Process',
  pageTitleKey: 'insights.xray.ui.nav.process',
  pageGroup: 'Insights',
  pageGroupKey: 'insights.module.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Process X-Ray', labelKey: 'insights.xray.ui.nav.title', href: '/backend/insights/process-xray' },
    { label: 'Process', labelKey: 'insights.xray.ui.nav.process' },
  ],
}

export default metadata
