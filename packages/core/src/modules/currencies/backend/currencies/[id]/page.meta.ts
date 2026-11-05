export const metadata = {
  requireAuth: true,
  requireFeatures: ['currencies.manage'],
  pageTitle: 'Edit Currency',
  pageTitleKey: 'currencies.edit.title',
  breadcrumb: [
    { label: 'Currencies', labelKey: 'currencies.page.title', href: '/backend/currencies' },
    { label: 'Edit', labelKey: 'currencies.edit.title' },
  ],
}
