export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.organizations.manage'],
  pageTitle: 'Edit Organization',
  pageGroup: 'Directory',
  navHidden: true,
  pageContext: 'admin' as const,
  breadcrumb: [
    { label: 'Organizations', href: '/backend/directory/organizations' },
    { label: 'Edit' },
  ],
}

