export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.manage'],
  pageTitle: 'Create Tenant',
  pageTitleKey: 'directory.nav.tenants.create',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  pageOrder: 21,
  navHidden: true,
  pageContext: 'admin' as const,
  breadcrumb: [
    { label: 'Tenants', labelKey: 'directory.nav.tenants', href: '/backend/directory/tenants' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
