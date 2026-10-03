export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Generation history',
  pageTitleKey: 'document_generators.nav.history',
  pageGroup: 'Documents',
  pageGroupKey: 'document_generators.nav.group',
  pageOrder: 902,
  icon: 'history',
  breadcrumb: [
    { label: 'Documents', labelKey: 'document_generators.nav.root', href: '/backend/document-generators' },
    { label: 'Generation history', labelKey: 'document_generators.nav.history' },
  ],
}
