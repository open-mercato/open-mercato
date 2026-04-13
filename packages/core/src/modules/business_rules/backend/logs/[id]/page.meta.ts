export const metadata = {
  requireAuth: true,
  requireFeatures: ['business_rules.view_logs'],
  pageTitle: 'Execution Log Details',
  pageTitleKey: 'business_rules.logs.detail.title',
  breadcrumb: [
    { label: 'Business Rules Logs', labelKey: 'rules.nav.rules_logs', href: '/backend/logs' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}
