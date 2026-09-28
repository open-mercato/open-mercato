export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.documents.manage'],
  pageTitle: 'Edit document',
  pageTitleKey: 'hr_management.documents.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 222,
  icon: 'file-text',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employee documents', labelKey: 'hr_management.documents.page.title', href: '/backend/hr/documents' },
    { label: 'Edit document', labelKey: 'hr_management.documents.form.edit.title' },
  ],
}
