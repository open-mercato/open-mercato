export const metadata = {
  requireAuth: true,
  requireFeatures: ['documents.view'],
  pageTitle: 'Document',
  pageTitleKey: 'documents.nav.document',
  pageGroup: 'Documents',
  pageGroupKey: 'documents.nav.group',
  breadcrumb: [
    { label: 'Documents', labelKey: 'documents.nav.documents', href: '/backend/documents' },
    { label: 'Document', labelKey: 'documents.nav.document' },
  ],
}
