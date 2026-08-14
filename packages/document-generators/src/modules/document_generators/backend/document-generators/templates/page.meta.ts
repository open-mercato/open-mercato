export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Available templates',
  pageTitleKey: 'document_generators.page.title',
  pageGroup: 'Document Generators',
  pageGroupKey: 'document_generators.page.group',
  pageOrder: 901,
  breadcrumb: [
    {
      label: 'Document generator',
      labelKey: 'document_generators.overview.title',
      href: '/backend/document-generators/overview',
    },
    { label: 'Available templates', labelKey: 'document_generators.page.title' },
  ],
} as const
export default metadata
