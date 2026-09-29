export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.roles.manage'],
  pageTitle: 'Edit Role',
  pageTitleKey: 'auth.roles.form.title.edit',
  breadcrumb: [
    { label: 'Roles', labelKey: 'auth.nav.roles', href: '/backend/roles' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}

