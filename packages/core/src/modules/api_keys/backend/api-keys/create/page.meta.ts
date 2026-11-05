export const metadata = {
  requireAuth: true,
  requireFeatures: ['api_keys.create'],
  pageTitle: 'Create API Key',
  pageTitleKey: 'api_keys.nav.apiKeys.create',
  pageGroup: 'Auth',
  pageGroupKey: 'auth.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'API Keys', labelKey: 'api_keys.nav.apiKeys', href: '/backend/api-keys' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
