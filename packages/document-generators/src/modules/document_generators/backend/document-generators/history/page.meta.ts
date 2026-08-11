export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.view'],
  pageTitle: 'Generation history',
  pageTitleKey: 'document_generators.history.title',
  pageGroup: 'Document Generators',
  pageGroupKey: 'document_generators.page.group',
  pageOrder: 902,
  breadcrumb: [
    {
      label: 'Document generator',
      labelKey: 'document_generators.overview.title',
      href: '/backend/document-generators/overview',
    },
    { label: 'Generation history', labelKey: 'document_generators.history.title' },
  ],
} as const
export default metadata
