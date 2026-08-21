export const metadata = {
  requireAuth: true,
  requireFeatures: ['communication_channels.view'],
  pageTitle: 'Communication Channels',
  pageTitleKey: 'communication_channels.nav.title',
  pageGroup: 'Integrations',
  pageGroupKey: 'communication_channels.nav.group',
  pageOrder: 90,
  icon: 'mail',
  pageContext: 'main' as const,
  breadcrumb: [
    { label: 'Communication Channels', labelKey: 'communication_channels.nav.title' },
  ],
} as const
