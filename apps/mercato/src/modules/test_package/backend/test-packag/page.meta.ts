export const metadata = {
  requireAuth: true,
  requireFeatures: ['test_package.view'],
  pageTitle: 'Test Package',
  pageTitleKey: 'test_package.page.title',
  pageGroup: 'Examples',
  pageGroupKey: 'test_package.page.group',
  pageOrder: 900,
  breadcrumb: [
    { label: 'Test Package', labelKey: 'test_package.page.title' },
  ],
} as const

export default metadata
