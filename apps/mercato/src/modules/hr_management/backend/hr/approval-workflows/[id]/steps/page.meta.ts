export const metadata = {
  requireAuth: true,
  requireFeatures: ['approvals.config'],
  pageTitle: 'Approval steps',
  pageTitleKey: 'hr_management.workflowConfig.steps.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 236,
  icon: 'workflow',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Approval workflows', labelKey: 'hr_management.workflowConfig.page.title', href: '/backend/hr/approval-workflows' },
    { label: 'Approval steps', labelKey: 'hr_management.workflowConfig.steps.page.title' },
  ],
}
