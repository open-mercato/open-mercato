export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'UMES Phase C Handlers',
  pageTitleKey: 'example.umes.handlers.title',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase C handlers', labelKey: 'example.umes.handlers.title' },
  ],
}

export default metadata
