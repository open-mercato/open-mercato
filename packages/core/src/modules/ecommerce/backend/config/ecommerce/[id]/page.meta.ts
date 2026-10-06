export const metadata = {
  requireAuth: true,
  requireFeatures: ['ecommerce.stores.view'],
  navHidden: true,
  pageTitle: 'Store',
  pageTitleKey: 'ecommerce.backend.store.entityType',
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Stores', labelKey: 'ecommerce.module.title', href: '/backend/config/ecommerce' },
    { label: 'Store', labelKey: 'ecommerce.backend.store.entityType' },
  ],
} as const
