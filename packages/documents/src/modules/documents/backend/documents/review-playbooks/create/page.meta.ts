export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.review_playbooks.manage'],
  pageTitle: 'New review playbook',
  pageTitleKey: 'documents.reviewPlaybooks.create.title',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Review playbooks', labelKey: 'documents.reviewPlaybooks.nav.title', href: '/backend/documents/review-playbooks' },
    { label: 'New review playbook', labelKey: 'documents.reviewPlaybooks.create.title' },
  ],
}
