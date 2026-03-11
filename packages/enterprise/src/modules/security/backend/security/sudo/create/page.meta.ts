export const metadata = {
  requireAuth: true,
  requireFeatures: ['security.sudo.manage'],
  pageTitleKey: 'security.admin.sudo.form.title.create',
  breadcrumb: [
    { labelKey: 'nav.primary.security', href: '/backend/security' },
    { labelKey: 'security.admin.sudo.title', href: '/backend/security/sudo' },
    { labelKey: 'ui.actions.create' },
  ],
}
