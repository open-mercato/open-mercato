export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.manage'],
  pageTitle: 'Edit Tenant',
  pageGroup: 'Directory',
  navHidden: true,
  pageContext: 'admin' as const,
  breadcrumb: [
    { label: 'Tenants', href: '/backend/directory/tenants' },
    { label: 'Edit' },
  ],
}

