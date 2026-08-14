export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Document generator',
  pageTitleKey: 'document_generators.overview.title',
  pageGroup: 'Document Generators',
  pageGroupKey: 'document_generators.page.group',
  pageOrder: 900,
  navHidden: true,
  breadcrumb: [
    { label: 'Document generator', labelKey: 'document_generators.overview.title' },
  ],
} as const
export default metadata
