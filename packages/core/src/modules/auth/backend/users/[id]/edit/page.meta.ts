export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.users.edit'],
  pageTitle: 'Edit User',
  pageContext: 'settings' as const,
  breadcrumb: [ { label: 'Users', href: '/backend/users' }, { label: 'Edit' } ],
}


