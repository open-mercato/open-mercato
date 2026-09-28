export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.documents.manage'],
  pageTitle: 'New document',
  pageTitleKey: 'hr_management.documents.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 221,
  icon: 'file-text',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employee documents', labelKey: 'hr_management.documents.page.title', href: '/backend/hr/documents' },
    { label: 'New document', labelKey: 'hr_management.documents.form.create.title' },
  ],
}
