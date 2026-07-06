export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.submissions.manage'],
  pageTitle: 'Edit evidence submission',
  pageTitleKey: 'eudr.evidenceSubmissions.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Evidence submissions', labelKey: 'eudr.nav.submissions', href: '/backend/eudr/evidence-submissions' },
  ],
}
