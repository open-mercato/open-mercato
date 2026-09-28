export const metadata = {
  requireAuth: true,
  requireFeatures: ['approvals.config'],
  pageTitle: 'New approval step',
  pageTitleKey: 'hr_management.workflowConfig.steps.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 238,
  icon: 'workflow',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Approval steps', labelKey: 'hr_management.workflowConfig.steps.page.allTitle', href: '/backend/hr/approval-steps' },
    { label: 'New approval step', labelKey: 'hr_management.workflowConfig.steps.form.create.title' },
  ],
}
