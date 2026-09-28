export const metadata = {
  requireAuth: true,
  requireFeatures: ['approvals.config'],
  pageTitle: 'Edit approval step',
  pageTitleKey: 'hr_management.workflowConfig.steps.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 239,
  icon: 'workflow',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Approval steps', labelKey: 'hr_management.workflowConfig.steps.page.allTitle', href: '/backend/hr/approval-steps' },
    { label: 'Edit approval step', labelKey: 'hr_management.workflowConfig.steps.form.edit.title' },
  ],
}
