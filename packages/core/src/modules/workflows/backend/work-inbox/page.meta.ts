export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  pageTitle: 'Work Inbox',
  pageTitleKey: 'workflows.workInbox.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 30,
  pageOrder: 120,
  icon: 'inbox',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Work Inbox', labelKey: 'workflows.workInbox.plural' },
  ],
}
