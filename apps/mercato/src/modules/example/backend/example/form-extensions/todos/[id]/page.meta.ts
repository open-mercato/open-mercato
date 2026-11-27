export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'Edit Todo form extensions',
  pageTitleKey: 'example.todoShowcase.edit',
  navHidden: true,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Todo form extensions', labelKey: 'example.todoShowcase.edit' },
  ],
}
