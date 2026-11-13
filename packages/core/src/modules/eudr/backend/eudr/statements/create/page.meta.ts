export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.statements.manage'],
  pageTitle: 'Create statement',
  pageTitleKey: 'eudr.statements.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Statements', labelKey: 'eudr.nav.statements', href: '/backend/eudr/statements' },
    { label: 'Create', labelKey: 'eudr.statements.create.title' },
  ],
}
