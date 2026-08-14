export const metadata = {
  requireAuth: true,
  requireFeatures: ['document_generators.documents.view'],
  pageTitle: 'Overview',
  pageTitleKey: 'document_generators.overview.navTitle',
  pageGroup: 'Document Generators',
  pageGroupKey: 'document_generators.page.group',
  pageOrder: 900,
  breadcrumb: [
    { label: 'Overview', labelKey: 'document_generators.overview.navTitle' },
  ],
} as const
export default metadata
