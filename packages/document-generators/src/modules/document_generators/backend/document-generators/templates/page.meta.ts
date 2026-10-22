export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Templates',
  pageTitleKey: 'document_generators.nav.templates',
  pageGroup: 'Documents',
  pageGroupKey: 'document_generators.nav.group',
  pageOrder: 901,
  icon: 'file-text',
  breadcrumb: [
    { label: 'Documents', labelKey: 'document_generators.nav.root', href: '/backend/document-generators' },
    { label: 'Templates', labelKey: 'document_generators.nav.templates' },
  ],
}
