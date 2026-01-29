export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.roles.manage'],
  pageTitle: 'Edit Role',
  pageContext: 'settings' as const,
  breadcrumb: [ { label: 'Roles', href: '/backend/roles' }, { label: 'Edit' } ],
}


