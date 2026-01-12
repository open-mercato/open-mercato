export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.manage'],
  pageTitle: 'Create Currency',
  pageTitleKey: 'currencies.create.title',
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Create', labelKey: 'currencies.create.title' },
  ],
}
