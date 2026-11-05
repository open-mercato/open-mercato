export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.admin.manage'],
  pageTitle: 'Create enforcement policy',
  pageTitleKey: 'security.admin.enforcement.form.titleCreate',
  breadcrumb: [
    { label: 'Security', labelKey: 'security.label' },
    { label: 'MFA enforcement', labelKey: 'security.admin.enforcement.title', href: '/backend/security/enforcement' },
    { label: 'Create', labelKey: 'ui.actions.create' },
  ],
}
