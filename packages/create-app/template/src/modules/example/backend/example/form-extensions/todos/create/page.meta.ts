export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'Todo form extensions',
  pageTitleKey: 'example.todoShowcase.create',
  pageGroup: 'Work plan',
  pageGroupKey: 'example.workPlan.nav.group',
  pageOrder: 122,
  icon: 'file-text',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Todo form extensions', labelKey: 'example.todoShowcase.create' },
  ],
}
