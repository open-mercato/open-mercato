export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.statements.manage'],
  pageTitle: 'Edit statement',
  pageTitleKey: 'eudr.statements.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Statements', labelKey: 'eudr.nav.statements', href: '/backend/eudr/statements' },
  ],
}
