export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.manage'],
  pageTitle: 'Edit Tenant',
  pageGroup: 'Directory',
  navHidden: true,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Tenants', href: '/backend/directory/tenants' },
    { label: 'Edit' },
  ],
}

