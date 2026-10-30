export const metadata = {
  requireAuth: true,
  requireFeatures: ['forms.design'],
  pageTitle: 'New form',
  pageTitleKey: 'forms.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Forms', labelKey: 'forms.list.title', href: '/backend/forms' },
    { label: 'New form', labelKey: 'forms.create.title' },
  ],
}
