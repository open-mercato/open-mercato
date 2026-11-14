export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.review_playbooks.manage'],
  pageTitle: 'Review playbook',
  pageTitleKey: 'documents.reviewPlaybooks.detail.title',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Review playbooks', labelKey: 'documents.reviewPlaybooks.nav.title', href: '/backend/documents/review-playbooks' },
    { label: 'Review playbook', labelKey: 'documents.reviewPlaybooks.detail.title' },
  ],
}
