export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.view'],
  pageTitle: 'Available templates',
  pageTitleKey: 'document_generators.page.title',
  pageGroup: 'Document Generators',
  pageGroupKey: 'document_generators.page.group',
  pageOrder: 900,
  breadcrumb: [
    { label: 'Available templates', labelKey: 'document_generators.page.title' },
  ],
} as const
export default metadata
