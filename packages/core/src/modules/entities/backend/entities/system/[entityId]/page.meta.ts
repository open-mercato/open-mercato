export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  requireFeatures: ['entities.definitions.manage'],
  pageTitle: 'Edit Definitions',
  pageGroup: 'Data designer',
  navHidden: true,
}
