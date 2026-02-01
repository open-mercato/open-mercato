export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.organizations.manage'],
  pageTitle: 'Create Organization',
  pageTitleKey: 'directory.nav.organizations.create',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  pageOrder: 31,
  navHidden: true,
  pageContext: 'admin' as const,
  breadcrumb: [
    { label: 'Organizations', labelKey: 'directory.nav.organizations', href: '/backend/directory/organizations' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
