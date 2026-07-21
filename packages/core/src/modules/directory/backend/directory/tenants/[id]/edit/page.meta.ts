export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.tenants.manage'],
  pageTitle: 'Edit Tenant',
  pageTitleKey: 'directory.tenants.form.title.edit',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Tenants', labelKey: 'directory.nav.tenants', href: '/backend/directory/tenants' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}

