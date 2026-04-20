export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenant.manage'],
  pageTitle: 'Create Tenant',
  pageTitleKey: 'directory.nav.tenants.create',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  pageOrder: 21,
  navHidden: true,
  breadcrumb: [
    { label: 'Tenants', labelKey: 'directory.nav.tenants', href: '/backend/directory/tenants' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
