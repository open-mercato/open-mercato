export const metadata = {
  requireAuth: true,
  requireFeatures: ['approvals.config'],
  pageTitle: 'New approval workflow',
  pageTitleKey: 'hr_management.workflowConfig.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 234,
  icon: 'workflow',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Approval workflows', labelKey: 'hr_management.workflowConfig.page.title', href: '/backend/hr/approval-workflows' },
    { label: 'New approval workflow', labelKey: 'hr_management.workflowConfig.form.create.title' },
  ],
}
