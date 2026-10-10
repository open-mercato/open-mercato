export const metadata = {
  requireAuth: true,
  requireFeatures: ['insights.xray.view'],
  pageTitle: 'Automation suggestions',
  pageTitleKey: 'insights.xray.ui.nav.suggestions',
  pageGroup: 'Insights',
  pageGroupKey: 'insights.module.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Process X-Ray', labelKey: 'insights.xray.ui.nav.title', href: '/backend/insights/process-xray' },
    { label: 'Automation suggestions', labelKey: 'insights.xray.ui.nav.suggestions' },
  ],
}

export default metadata
