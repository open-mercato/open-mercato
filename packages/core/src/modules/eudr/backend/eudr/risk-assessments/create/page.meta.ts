export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.risk.manage'],
  pageTitle: 'Create risk assessment',
  pageTitleKey: 'eudr.riskAssessments.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Risk assessments', labelKey: 'eudr.nav.riskAssessments', href: '/backend/eudr/risk-assessments' },
    { label: 'Create', labelKey: 'eudr.riskAssessments.create.title' },
  ],
}
