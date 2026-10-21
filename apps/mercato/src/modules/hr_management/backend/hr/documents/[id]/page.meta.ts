export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.documents.manage'],
  pageTitle: 'Employee document',
  pageTitleKey: 'hr_management.documents.detail.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 223,
  icon: 'file-text',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employee documents', labelKey: 'hr_management.documents.page.title', href: '/backend/hr/documents' },
    { label: 'Employee document', labelKey: 'hr_management.documents.detail.title' },
  ],
}
