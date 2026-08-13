export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.submissions.manage'],
  pageTitle: 'Create evidence submission',
  pageTitleKey: 'eudr.evidenceSubmissions.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Evidence submissions', labelKey: 'eudr.nav.submissions', href: '/backend/eudr/evidence-submissions' },
    { label: 'Create', labelKey: 'eudr.evidenceSubmissions.create.title' },
  ],
}
