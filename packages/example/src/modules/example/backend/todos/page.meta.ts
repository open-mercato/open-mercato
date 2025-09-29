export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Todos',
  pageGroup: 'Example',
  pageOrder: 1,
  icon: 'checklist',
  breadcrumb: [
    { label: 'Todos' },
  ],
}
