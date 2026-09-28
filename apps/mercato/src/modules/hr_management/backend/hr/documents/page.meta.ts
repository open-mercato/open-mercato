export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.read'],
  pageTitle: 'Employee documents',
  pageTitleKey: 'hr_management.documents.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 219,
  icon: 'file-text',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employee documents', labelKey: 'hr_management.documents.page.title' },
  ],
}
