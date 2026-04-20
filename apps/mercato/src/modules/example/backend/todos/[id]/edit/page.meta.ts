export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todo.manage'],
  pageTitle: 'Edit Todo',
  pageTitleKey: 'example.todo.edit.title',
  pageGroup: 'Work plan',
  pageGroupKey: 'example.workPlan.nav.group',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todo.page.title', href: '/backend/todos' },
    { label: 'Edit', labelKey: 'example.todo.edit.title' },
  ],
}
