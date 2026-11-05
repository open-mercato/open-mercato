export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.admin.manage'],
  pageTitle: 'Edit enforcement policy',
  pageTitleKey: 'security.admin.enforcement.form.titleEdit',
  breadcrumb: [
    { label: 'Security', labelKey: 'security.label' },
    { label: 'MFA enforcement', labelKey: 'security.admin.enforcement.title', href: '/backend/security/enforcement' },
    { label: 'Edit', labelKey: 'ui.actions.edit' },
  ],
}
