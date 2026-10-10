export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Overview',
  pageTitleKey: 'document_generators.nav.overview',
  pageGroup: 'Documents',
  pageGroupKey: 'document_generators.nav.group',
  pageOrder: 900,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Documents', labelKey: 'document_generators.nav.root', href: '/backend/document-generators' },
    { label: 'Overview', labelKey: 'document_generators.nav.overview' },
  ],
}
