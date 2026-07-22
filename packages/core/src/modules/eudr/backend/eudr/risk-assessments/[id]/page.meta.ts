export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.risk.manage'],
  pageTitle: 'Edit risk assessment',
  pageTitleKey: 'eudr.riskAssessments.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Risk assessments', labelKey: 'eudr.nav.riskAssessments', href: '/backend/eudr/risk-assessments' },
  ],
}
