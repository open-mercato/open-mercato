export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'UMES Phase A-D Handlers',
  pageTitleKey: 'example.umes.handlers.title',
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase A-D handlers', labelKey: 'example.umes.handlers.title' },
  ],
}

export default metadata
