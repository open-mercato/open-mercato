export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.users.edit'],
  pageTitle: 'Edit User',
  pageContext: 'admin' as const,
  breadcrumb: [ { label: 'Users', href: '/backend/users' }, { label: 'Edit' } ],
}


