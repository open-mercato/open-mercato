export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.organizations.manage'],
  pageTitle: 'Edit Organization',
  pageTitleKey: 'directory.organizations.form.title.edit',
  pageGroup: 'Directory',
  pageGroupKey: 'directory.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Organizations', labelKey: 'directory.nav.organizations', href: '/backend/directory/organizations' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}

