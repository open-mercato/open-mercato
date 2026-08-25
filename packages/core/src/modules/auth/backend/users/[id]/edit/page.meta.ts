export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.users.edit'],
  pageTitle: 'Edit User',
  pageTitleKey: 'auth.users.form.title.edit',
  breadcrumb: [
    { label: 'Users', labelKey: 'auth.nav.users', href: '/backend/users' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}

