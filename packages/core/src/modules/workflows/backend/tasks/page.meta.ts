/**
 * Bridge-route metadata. The guards are UNCHANGED — `page.tsx` now forwards to
 * `/backend/work-inbox`, and a bridge that loses its RBAC guard is a hole, not
 * a redirect. The one addition is `navHidden`, so the sidebar lists the Work
 * Inbox once instead of listing the retired entry beside it.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  navHidden: true,
  pageTitle: 'User Tasks',
  pageTitleKey: 'workflows.tasks.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 30,
  pageOrder: 120,
  icon: 'check-square',
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Tasks', labelKey: 'workflows.tasks.plural' },
  ],
}
