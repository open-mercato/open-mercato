export const metadata = {
  requireAuth: true,
  requireFeatures: ['approvals.config'],
  pageTitle: 'Edit approval workflow',
  pageTitleKey: 'hr_management.workflowConfig.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 235,
  icon: 'workflow',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Approval workflows', labelKey: 'hr_management.workflowConfig.page.title', href: '/backend/hr/approval-workflows' },
    { label: 'Edit approval workflow', labelKey: 'hr_management.workflowConfig.form.edit.title' },
  ],
}
